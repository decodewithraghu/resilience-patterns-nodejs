/**
 * Resilient HTTP Client Service
 * 
 * A generic REST API client that utilizes all resilience patterns:
 * - Circuit Breaker: Prevents cascading failures
 * - Retry Handler: Automatic retries with backoff
 * - Timeout: Prevents hanging requests
 * - Fallback: Graceful degradation
 * - Bulkhead: Resource isolation
 * - Rate Limiter: Request throttling
 * 
 * Design Patterns Used:
 * - Decorator Pattern: Wraps HTTP calls with resilience
 * - Builder Pattern: Fluent configuration API
 * - Strategy Pattern: Configurable resilience strategies
 * - Observer Pattern: Event-driven monitoring
 * 
 * @module ResilientHttpClient
 */

import {
  CircuitBreaker,
  CircuitState,
  RetryHandler,
  BackoffStrategy,
  TimeoutHandler,
  TimeoutError,
  FallbackHandler,
  Bulkhead,
  BulkheadError,
  TokenBucketRateLimiter,
  RateLimitError
} from '../core/index.js';

/**
 * @typedef {Object} ResilientHttpClientOptions
 * @property {string} baseUrl - Base URL for API requests
 * @property {Object} circuitBreaker - Circuit breaker options
 * @property {Object} retry - Retry handler options
 * @property {Object} timeout - Timeout handler options
 * @property {Object} bulkhead - Bulkhead options
 * @property {Object} rateLimiter - Rate limiter options
 * @property {Object} headers - Default headers
 */

/**
 * @typedef {Object} RequestOptions
 * @property {string} method - HTTP method
 * @property {string} path - Request path
 * @property {Object} body - Request body
 * @property {Object} headers - Request headers
 * @property {Object} queryParams - URL query parameters
 * @property {Function} fallback - Fallback function
 * @property {boolean} skipCircuitBreaker - Skip circuit breaker
 * @property {boolean} skipRetry - Skip retry logic
 * @property {boolean} skipRateLimiter - Skip rate limiter
 * @property {number} customTimeout - Custom timeout for this request
 */

/**
 * HTTP errors with enhanced information
 */
export class HttpError extends Error {
  constructor(message, statusCode, response = null) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.response = response;
    this.isRetryable = statusCode >= 500 || statusCode === 408 || statusCode === 429;
  }
}

/**
 * ResilientHttpClient class - A production-ready HTTP client with built-in resilience
 */
export class ResilientHttpClient {
  /** @type {Map<string, Function[]>} */
  #listeners = new Map();

  /**
   * Constructor - Initializes the resilient HTTP client with all patterns
   * 
   * Flow:
   * 1. Set up base configuration (URL, headers)
   * 2. Initialize all 6 resilience patterns
   * 3. Set up statistics tracking
   * 4. Configure HTTP client (fetch or custom)
   * 
   * @param {ResilientHttpClientOptions} options - Configuration options
   */
  constructor(options = {}) {
    // Store base URL for all requests (e.g., 'https://api.example.com')
    this.baseUrl = options.baseUrl ?? '';
    
    // Set default headers that will be sent with every request
    // Can be overridden per-request
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    // Initialize all resilience patterns in sequence
    // Each pattern wraps the HTTP call with specific protection
    this.#initCircuitBreaker(options.circuitBreaker);  // Prevents cascading failures
    this.#initRetryHandler(options.retry);              // Retries failed requests
    this.#initTimeoutHandler(options.timeout);          // Prevents hanging requests
    this.#initFallbackHandler(options.fallback);        // Provides alternative responses
    this.#initBulkhead(options.bulkhead);              // Limits concurrent requests
    this.#initRateLimiter(options.rateLimiter);        // Throttles request rate

    // Initialize statistics object to track client behavior
    // These metrics help monitor system health and resilience effectiveness
    this.stats = {
      totalRequests: 0,           // All requests attempted
      successfulRequests: 0,      // Requests that succeeded
      failedRequests: 0,          // Requests that failed completely
      fallbacksUsed: 0,           // Times fallback was triggered
      retries: 0,                 // Number of retry attempts
      circuitBreakerTrips: 0,     // Times circuit opened
      rateLimitHits: 0,           // Requests rejected by rate limiter
      timeouts: 0,                // Requests that timed out
      bulkheadRejections: 0       // Requests rejected by bulkhead
    };

    // Set HTTP client implementation
    // Can use custom client (e.g., axios) or default (native fetch)
    this.httpClient = options.httpClient ?? this.#defaultHttpClient.bind(this);
  }

  /**
   * Initialize circuit breaker pattern
   * 
   * Purpose: Prevents cascading failures by "opening" the circuit after too many failures,
   * stopping requests to a failing service and giving it time to recover.
   * 
   * Flow:
   * 1. CLOSED (normal) -> Requests pass through
   * 2. After N failures -> OPEN (failing) -> Requests rejected immediately
   * 3. After timeout -> HALF_OPEN (testing) -> Allow limited requests
   * 4. If successful -> CLOSED, if failed -> OPEN again
   * 
   * @private
   */
  #initCircuitBreaker(options = {}) {
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: options.failureThreshold ?? 5,    // Open after 5 failures
      successThreshold: options.successThreshold ?? 2,    // Close after 2 successes in half-open
      timeout: options.timeout ?? 30000,                  // Try half-open after 30s
      resetTimeout: options.resetTimeout ?? 60000,        // Reset failure count after 60s
      ...options
    });

    // Circuit opened - service is failing, requests will be rejected
    this.circuitBreaker.on('open', () => {
      this.stats.circuitBreakerTrips++;  // Track how often this happens
      this.#emit('circuitOpen', { stats: this.circuitBreaker.getStats() });
    });

    // Circuit closed - service recovered, normal operation resumed
    this.circuitBreaker.on('close', () => {
      this.#emit('circuitClose', { stats: this.circuitBreaker.getStats() });
    });

    // Circuit half-open - testing if service recovered
    this.circuitBreaker.on('halfOpen', () => {
      this.#emit('circuitHalfOpen', { stats: this.circuitBreaker.getStats() });
    });
  }

  /**
   * Initialize retry handler pattern
   * 
   * Purpose: Automatically retries failed requests with exponential backoff,
   * handling transient failures (temporary network issues, server hiccups).
   * 
   * Exponential Backoff Example:
   * - Attempt 1: fails, wait 1s
   * - Attempt 2: fails, wait 2s (1s * 2)
   * - Attempt 3: fails, wait 4s (2s * 2)
   * 
   * Jitter: Adds randomness to prevent "thundering herd" (all clients retrying at once)
   * 
   * @private
   */
  #initRetryHandler(options = {}) {
    this.retryHandler = new RetryHandler({
      maxAttempts: options.maxAttempts ?? 3,              // Try up to 3 times
      baseDelay: options.baseDelay ?? 1000,               // Start with 1s delay
      maxDelay: options.maxDelay ?? 10000,                // Cap delay at 10s
      multiplier: options.multiplier ?? 2,                // Double delay each time
      jitter: options.jitter ?? true,                     // Add randomness
      strategy: options.strategy ?? BackoffStrategy.EXPONENTIAL,
      
      // Determine which errors should trigger a retry
      retryCondition: options.retryCondition ?? ((error) => {
        // Retry on network errors or retryable HTTP errors (5xx, 408, 429)
        return error.isRetryable ||                       // HTTP 5xx, 408, 429
               error.code === 'ECONNRESET' ||            // Connection reset
               error.code === 'ETIMEDOUT' ||             // Network timeout
               error.code === 'ENOTFOUND';               // DNS lookup failed
      }),
      ...options
    });

    // Track retry attempts for monitoring
    this.retryHandler.on('retry', (data) => {
      this.stats.retries++;
      this.#emit('retry', data);  // Emit event so users can log/monitor retries
    });
  }

  /**
   * Initialize timeout handler pattern
   * 
   * Purpose: Prevents requests from hanging indefinitely by setting a maximum duration.
   * If a request takes longer than the timeout, it's cancelled and an error is thrown.
   * 
   * Why Important:
   * - Frees up resources (connections, threads)
   * - Provides faster feedback to users
   * - Prevents cascade of slow requests
   * 
   * @private
   */
  #initTimeoutHandler(options = {}) {
    this.timeoutHandler = new TimeoutHandler({
      duration: options.duration ?? 10000,      // Default 10s timeout
      name: options.name ?? 'HTTP Request',     // For logging/debugging
      ...options
    });

    // Track timeout occurrences for monitoring
    this.timeoutHandler.on('timeout', (data) => {
      this.stats.timeouts++;  // Count how many requests timed out
      this.#emit('timeout', data);  // Alert users about timeout
    });
  }

  /**
   * Initialize fallback handler
   * @private
   */
  #initFallbackHandler(options = {}) {
    this.fallbackHandler = new FallbackHandler({
      name: options.name ?? 'HTTP Fallback',
      logFailures: options.logFailures ?? true,
      ...options
    });

    this.fallbackHandler.on('fallbackSuccess', (data) => {
      this.stats.fallbacksUsed++;
      this.#emit('fallbackUsed', data);
    });
  }

  /**
   * Initialize bulkhead pattern
   * 
   * Purpose: Limits concurrent requests to prevent resource exhaustion.
   * Like compartments in a ship, isolates failures to prevent entire system collapse.
   * 
   * Flow:
   * 1. Request arrives
   * 2. If slots available (< maxConcurrent) -> Execute immediately
   * 3. If no slots but queue not full -> Add to queue
   * 4. If queue full -> Reject immediately with BulkheadError
   * 
   * Example: If maxConcurrent=10, request #11 waits in queue
   * 
   * @private
   */
  #initBulkhead(options = {}) {
    this.bulkhead = new Bulkhead({
      maxConcurrent: options.maxConcurrent ?? 10,       // Max 10 requests at once
      maxQueueSize: options.maxQueueSize ?? 50,         // Queue up to 50 waiting requests
      queueTimeout: options.queueTimeout ?? 30000,      // Wait max 30s in queue
      name: options.name ?? 'HTTP Bulkhead',
      ...options
    });

    // Track bulkhead rejections (important for capacity planning)
    this.bulkhead.on('rejected', () => {
      this.stats.bulkheadRejections++;  // Count rejections
      this.#emit('bulkheadRejected', { stats: this.bulkhead.getStats() });
    });
  }

  /**
   * Initialize rate limiter pattern (Token Bucket Algorithm)
   * 
   * Purpose: Controls request rate to prevent overwhelming external APIs
   * and avoid hitting API rate limits.
   * 
   * Token Bucket Algorithm:
   * - Bucket starts with N tokens (capacity)
   * - Each request consumes 1 token
   * - Tokens refill at constant rate (refillRate per second)
   * - If no tokens available -> Request rejected
   * 
   * Example: capacity=100, refillRate=10
   * - Can burst up to 100 requests immediately
   * - Then limited to 10 requests/second
   * 
   * @private
   */
  #initRateLimiter(options = {}) {
    this.rateLimiter = new TokenBucketRateLimiter({
      limit: options.limit ?? 100,                      // Total requests allowed
      windowMs: options.windowMs ?? 60000,              // Per 60s window
      capacity: options.capacity ?? 100,                // Bucket capacity (burst size)
      refillRate: options.refillRate ?? 10,            // Tokens added per second
      name: options.name ?? 'HTTP Rate Limiter',
      ...options
    });

    // Track rate limit hits (important for API quota management)
    this.rateLimiter.on('rejected', () => {
      this.stats.rateLimitHits++;  // Count how often we hit the limit
      this.#emit('rateLimited', { stats: this.rateLimiter.getStats() });
    });
  }

  /**
   * Default HTTP client using fetch
   * @private
   */
  async #defaultHttpClient(url, options) {
    const response = await fetch(url, options);
    
    const contentType = response.headers.get('content-type');
    let data;
    
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      throw new HttpError(
        `HTTP ${response.status}: ${response.statusText}`,
        response.status,
        data
      );
    }

    return {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      data
    };
  }

  /**
   * Build full URL with query parameters
   * @private
   */
  #buildUrl(path, queryParams = {}) {
    // Handle both absolute URLs and relative paths with baseUrl
    const url = this.baseUrl 
      ? new URL(path, this.baseUrl)
      : new URL(path);
    
    Object.entries(queryParams).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, String(value));
      }
    });

    return url.toString();
  }

  /**
   * Execute HTTP request with all resilience patterns
   * 
   * This is the core method that applies ALL resilience patterns in layers:
   * 
   * Request Flow (Onion/Decorator Pattern):
   * ┌─────────────────────────────────────────────────────────────┐
   * │ 6. Fallback (Outermost - catches all failures)             │
   * │  ┌──────────────────────────────────────────────────────┐  │
   * │  │ 5. Bulkhead (Limits concurrent requests)             │  │
   * │  │  ┌───────────────────────────────────────────────┐  │  │
   * │  │  │ 4. Rate Limiter (Throttles request rate)      │  │  │
   * │  │  │  ┌────────────────────────────────────────┐  │  │  │
   * │  │  │  │ 3. Circuit Breaker (Fails fast)        │  │  │  │
   * │  │  │  │  ┌─────────────────────────────────┐  │  │  │  │
   * │  │  │  │  │ 2. Retry (Retries on failure)   │  │  │  │  │
   * │  │  │  │  │  ┌──────────────────────────┐  │  │  │  │  │
   * │  │  │  │  │  │ 1. Timeout (Innermost)   │  │  │  │  │  │
   * │  │  │  │  │  │    HTTP Call              │  │  │  │  │  │
   * │  │  │  │  │  └──────────────────────────┘  │  │  │  │  │
   * │  │  │  │  └─────────────────────────────────┘  │  │  │  │
   * │  │  │  └────────────────────────────────────────┘  │  │  │
   * │  │  └───────────────────────────────────────────────┘  │  │
   * │  └──────────────────────────────────────────────────────┘  │
   * └─────────────────────────────────────────────────────────────┘
   * 
   * Each layer can be skipped individually (skipRetry, skipCircuitBreaker, etc.)
   * 
   * @param {RequestOptions} requestOptions - Request configuration
   * @returns {Promise<Object>} Response data
   */
  async request(requestOptions) {
    // Extract and set defaults for all request options
    const {
      method = 'GET',
      path,
      body,
      headers = {},
      queryParams = {},
      fallback,                          // Optional fallback function
      skipCircuitBreaker = false,        // Skip circuit breaker if true
      skipRetry = false,                 // Skip retry if true
      skipRateLimiter = false,          // Skip rate limiter if true
      customTimeout                      // Override default timeout
    } = requestOptions;

    this.stats.totalRequests++;  // Track every request attempt

    // Build complete URL with query parameters
    const url = this.#buildUrl(path, queryParams);
    
    // Prepare request configuration with headers and body
    const requestConfig = {
      method,
      headers: { ...this.defaultHeaders, ...headers },  // Merge default + custom headers
      ...(body && { body: JSON.stringify(body) })       // Add body if present
    };

    // ═══════════════════════════════════════════════════════════════
    // LAYER 1: Core HTTP call wrapped with timeout
    // ═══════════════════════════════════════════════════════════════
    const httpCall = async () => {
      // Timeout wraps the actual HTTP client call
      // If request takes longer than duration, TimeoutError is thrown
      return this.timeoutHandler.execute(
        () => this.httpClient(url, requestConfig),
        customTimeout  // Can override default timeout per request
      );
    };

    // ═══════════════════════════════════════════════════════════════
    // LAYER 2: Wrap with retry (if not skipped)
    // ═══════════════════════════════════════════════════════════════
    const withRetry = skipRetry
      ? httpCall  // Skip retry, use raw HTTP call
      : () => this.retryHandler.execute(httpCall, { url, method });
    // Retry will call httpCall multiple times (up to maxAttempts)
    // with exponential backoff between attempts

    // ═══════════════════════════════════════════════════════════════
    // LAYER 3: Wrap with circuit breaker (if not skipped)
    // ═══════════════════════════════════════════════════════════════
    const withCircuitBreaker = skipCircuitBreaker
      ? withRetry  // Skip circuit breaker
      : () => this.circuitBreaker.execute(withRetry);
    // Circuit breaker tracks failures and "opens" to fail fast
    // If circuit is OPEN, request rejected immediately without calling withRetry

    // ═══════════════════════════════════════════════════════════════
    // LAYER 4: Wrap with rate limiter (if not skipped)
    // ═══════════════════════════════════════════════════════════════
    const withRateLimiter = skipRateLimiter
      ? withCircuitBreaker  // Skip rate limiter
      : async () => {
          // Try to consume 1 token from the bucket
          if (!this.rateLimiter.tryConsume(1)) {
            // No tokens available - rate limit exceeded
            const error = new RateLimitError('Rate limit exceeded', this.rateLimiter.windowMs);
            error.isRetryable = false;  // Don't retry rate limit errors
            throw error;
          }
          // Token consumed successfully, proceed with request
          return withCircuitBreaker();
        };

    // ═══════════════════════════════════════════════════════════════
    // LAYER 5: Wrap with bulkhead
    // ═══════════════════════════════════════════════════════════════
    const withBulkhead = () => this.bulkhead.execute(withRateLimiter);
    // Bulkhead limits concurrent executions
    // If too many requests in flight, this request waits in queue or is rejected

    // ═══════════════════════════════════════════════════════════════
    // LAYER 6: Execute with fallback (outermost layer)
    // ═══════════════════════════════════════════════════════════════
    try {
      const result = fallback
        ? await this.fallbackHandler.execute(withBulkhead, fallback)
        : await withBulkhead();
      // If fallback provided:
      //   - Try withBulkhead() first (all inner layers)
      //   - If it fails, call fallback function
      //   - Return fallback result instead of throwing error

      // Request succeeded!
      this.stats.successfulRequests++;
      this.#emit('success', { url, method, result });
      return result;
      
    } catch (error) {
      // Request failed even after all resilience attempts
      this.stats.failedRequests++;
      this.#emit('failure', { url, method, error });
      throw error;  // Propagate error to caller
    }
  }

  /**
   * HTTP GET request
   * @param {string} path
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async get(path, options = {}) {
    return this.request({ ...options, method: 'GET', path });
  }

  /**
   * HTTP POST request
   * @param {string} path
   * @param {Object} body
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async post(path, body, options = {}) {
    return this.request({ ...options, method: 'POST', path, body });
  }

  /**
   * HTTP PUT request
   * @param {string} path
   * @param {Object} body
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async put(path, body, options = {}) {
    return this.request({ ...options, method: 'PUT', path, body });
  }

  /**
   * HTTP PATCH request
   * @param {string} path
   * @param {Object} body
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async patch(path, body, options = {}) {
    return this.request({ ...options, method: 'PATCH', path, body });
  }

  /**
   * HTTP DELETE request
   * @param {string} path
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async delete(path, options = {}) {
    return this.request({ ...options, method: 'DELETE', path });
  }

  /**
   * Get comprehensive stats
   * @returns {Object}
   */
  getStats() {
    return {
      client: { ...this.stats },
      circuitBreaker: this.circuitBreaker.getStats(),
      retry: this.retryHandler.getStats(),
      timeout: this.timeoutHandler.getStats(),
      fallback: this.fallbackHandler.getStats(),
      bulkhead: this.bulkhead.getStats(),
      rateLimiter: this.rateLimiter.getStats()
    };
  }

  /**
   * Reset all stats
   */
  resetStats() {
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      fallbacksUsed: 0,
      retries: 0,
      circuitBreakerTrips: 0,
      rateLimitHits: 0,
      timeouts: 0,
      bulkheadRejections: 0
    };
    // Reset stats for each pattern (if method exists)
    this.circuitBreaker.resetStats?.();
    this.retryHandler.resetStats?.();
    this.timeoutHandler.resetStats?.();
    this.fallbackHandler.resetStats?.();
    this.bulkhead.resetStats?.();
    this.rateLimiter.resetStats?.();
  }

  /**
   * Get circuit breaker state
   * @returns {CircuitState}
   */
  getCircuitState() {
    return this.circuitBreaker.state;
  }

  /**
   * Check if circuit is open
   * @returns {boolean}
   */
  isCircuitOpen() {
    return this.circuitBreaker.isOpen;
  }

  /**
   * Event subscription
   * @param {string} event
   * @param {Function} callback
   * @returns {Function} Unsubscribe function
   */
  on(event, callback) {
    if (!this.#listeners.has(event)) {
      this.#listeners.set(event, []);
    }
    this.#listeners.get(event).push(callback);

    return () => {
      const listeners = this.#listeners.get(event);
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    };
  }

  /**
   * Emit event
   * @private
   */
  #emit(event, data) {
    const listeners = this.#listeners.get(event) || [];
    listeners.forEach(callback => {
      try {
        callback(data);
      } catch (e) {
        console.error(`Error in listener: ${e.message}`);
      }
    });
  }

  /**
   * Shutdown and cleanup resources
   */
  shutdown() {
    this.bulkhead.shutdown?.();
    this.rateLimiter.shutdown?.();
    this.#emit('shutdown', { stats: this.getStats() });
  }
}

/**
 * Builder for ResilientHttpClient
 * 
 * Provides fluent API for configuration (Builder Pattern)
 * Allows chaining method calls for clean, readable configuration:
 * 
 * @example
 * const client = new ResilientHttpClientBuilder()
 *   .baseUrl('https://api.example.com')
 *   .withCircuitBreaker({ failureThreshold: 5 })
 *   .withRetry({ maxAttempts: 3 })
 *   .build();
 * 
 * Benefits:
 * - More readable than passing large config object
 * - Type-safe configuration
 * - Easy to see what's configured
 * - Can set defaults and override specific values
 */
export class ResilientHttpClientBuilder {
  #options = {};  // Accumulated configuration options

  /**
   * Set base URL for all requests
   * @param {string} url - Base URL (e.g., 'https://api.example.com')
   * @returns {ResilientHttpClientBuilder} - Returns this for chaining
   */
  baseUrl(url) {
    this.#options.baseUrl = url;
    return this;  // Enable method chaining
  }

  /**
   * Set default headers
   * @param {Object} headers
   * @returns {ResilientHttpClientBuilder}
   */
  headers(headers) {
    this.#options.headers = headers;
    return this;
  }

  /**
   * Configure circuit breaker
   * @param {Object} options
   * @returns {ResilientHttpClientBuilder}
   */
  withCircuitBreaker(options = {}) {
    this.#options.circuitBreaker = options;
    return this;
  }

  /**
   * Configure retry handler
   * @param {Object} options
   * @returns {ResilientHttpClientBuilder}
   */
  withRetry(options = {}) {
    this.#options.retry = options;
    return this;
  }

  /**
   * Configure timeout handler
   * @param {Object} options
   * @returns {ResilientHttpClientBuilder}
   */
  withTimeout(options = {}) {
    this.#options.timeout = options;
    return this;
  }

  /**
   * Configure fallback handler
   * @param {Object} options
   * @returns {ResilientHttpClientBuilder}
   */
  withFallback(options = {}) {
    this.#options.fallback = options;
    return this;
  }

  /**
   * Configure bulkhead
   * @param {Object} options
   * @returns {ResilientHttpClientBuilder}
   */
  withBulkhead(options = {}) {
    this.#options.bulkhead = options;
    return this;
  }

  /**
   * Configure rate limiter
   * @param {Object} options
   * @returns {ResilientHttpClientBuilder}
   */
  withRateLimiter(options = {}) {
    this.#options.rateLimiter = options;
    return this;
  }

  /**
   * Set custom HTTP client
   * @param {Function} httpClient
   * @returns {ResilientHttpClientBuilder}
   */
  httpClient(httpClient) {
    this.#options.httpClient = httpClient;
    return this;
  }

  /**
   * Build the client
   * @returns {ResilientHttpClient}
   */
  build() {
    return new ResilientHttpClient(this.#options);
  }
}

// Factory function for quick creation
export function createResilientClient(options = {}) {
  return new ResilientHttpClient(options);
}

// Default export
export default ResilientHttpClient;
