/**
 * Resilient REST API Service Example
 * 
 * This example demonstrates real-world usage of the ResilientHttpClient
 * with various resilience patterns for a production-ready API service.
 * 
 * Demonstrates SOLID principles:
 * - Single Responsibility: Each class has one clear purpose
 * - Open/Closed: Extensible through interfaces and composition
 * - Liskov Substitution: Services can be swapped with compatible implementations
 * - Interface Segregation: Minimal, focused interfaces
 * - Dependency Inversion: Depends on abstractions (ICache, ILogger, IHttpClient)
 * 
 * Demonstrates DRY principle:
 * - Shared base classes and utilities
 * - Configuration factories
 * - Reusable event handling
 * 
 * @example
 * Run: node examples/resilient-rest-api.js
 */

import {
  ResilientHttpClient,
  ResilientHttpClientBuilder,
  HttpError,
  createResilientClient
} from '../src/services/ResilientHttpClient.js';

// ============================================================================
// Interfaces (Using JSDoc for type documentation)
// ============================================================================

/**
 * @typedef {Object} ICache
 * @property {function(string, *): void} set - Store value in cache
 * @property {function(string): *} get - Retrieve value from cache
 * @property {function(string): boolean} has - Check if key exists
 */

/**
 * @typedef {Object} ILogger
 * @property {function(string): void} info - Log info message
 * @property {function(string): void} warn - Log warning message
 * @property {function(string): void} error - Log error message
 */

// ============================================================================
// Shared Utilities (DRY Principle)
// ============================================================================

/**
 * Console Logger Implementation
 * 
 * PURPOSE: Centralize logging logic with consistent formatting
 * WHY: Follows Single Responsibility Principle - one class for logging
 * BENEFIT: Easy to swap with different logger (file, cloud, etc.) without changing services
 * 
 * Pattern: Dependency Injection - Services depend on ILogger interface, not concrete implementation
 */
class ConsoleLogger {
  constructor(prefix = '') {
    // Prefix helps identify which service is logging (e.g., "[UserService]")
    this.prefix = prefix;
  }

  // Standard log methods with emoji icons for visual distinction
  info(message) {
    console.log(`${this.prefix}${message}`);
  }

  warn(message) {
    console.log(`⚠️  ${this.prefix}${message}`);
  }

  error(message) {
    console.error(`❌ ${this.prefix}${message}`);
  }

  success(message) {
    console.log(`✅ ${this.prefix}${message}`);
  }

  retry(message) {
    console.log(`🔄 ${this.prefix}${message}`);
  }
}

/**
 * Client Configuration Factory
 * 
 * PURPOSE: Centralize HTTP client configuration (DRY Principle)
 * WHY: Prevents duplicating config across multiple service creations
 * BENEFIT: Change defaults once, affects all services
 * 
 * Pattern: Factory Pattern + Template Method
 * - createDefaultConfig() provides base configuration
 * - Service-specific methods override only what's different
 */
class ClientConfigFactory {
  /**
   * Create default configuration for ResilientHttpClient
   * 
   * STEP 1: Define baseline resilience settings
   * These are reasonable defaults for most services
   */
  static createDefaultConfig(baseUrl, httpClient) {
    return {
      baseUrl,        // API base URL
      httpClient,     // Custom HTTP implementation (for mocking)
      
      // Circuit Breaker: Fail fast when service is down
      circuitBreaker: {
        failureThreshold: 5,    // Open after 5 failures
        successThreshold: 2,    // Close after 2 successes
        timeout: 10000          // Try half-open after 10s
      },
      
      // Retry: Handle transient failures
      retry: {
        maxAttempts: 3,         // Try up to 3 times
        baseDelay: 100,         // Start with 100ms delay
        maxDelay: 2000          // Cap delay at 2s
      },
      
      // Timeout: Prevent hanging requests
      timeout: { duration: 5000 },  // 5s timeout
      
      // Bulkhead: Limit concurrent requests
      bulkhead: { 
        maxConcurrent: 10,      // Max 10 simultaneous requests
        maxQueueSize: 50        // Queue up to 50 waiting requests
      },
      
      // Rate Limiter: Throttle request rate
      rateLimiter: { 
        limit: 100,             // 100 requests
        windowMs: 60000         // per 60 seconds
      }
    };
  }

  /**
   * User Service Configuration
   * 
   * STEP 2: Customize for User Service needs
   * WHY: User service is critical - use stricter circuit breaker and shorter timeouts
   * BENEFIT: Faster failure detection for user-facing operations
   */
  static createUserServiceConfig(baseUrl, httpClient) {
    return {
      ...this.createDefaultConfig(baseUrl, httpClient),  // Start with defaults
      circuitBreaker: { 
        failureThreshold: 3,    // Open after 3 failures (stricter than default)
        timeout: 5000           // Faster recovery attempts
      },
      timeout: { duration: 3000 }  // Shorter timeout for user operations
    };
  }

  /**
   * Product Service Configuration
   * 
   * STEP 2: Customize for Product Service needs
   * WHY: Product service has strict API rate limits
   * BENEFIT: Prevents hitting external API quotas
   */
  static createProductServiceConfig(baseUrl, httpClient) {
    return {
      ...this.createDefaultConfig(baseUrl, httpClient),
      rateLimiter: { 
        limit: 5,               // Only 5 requests
        windowMs: 10000,        // per 10 seconds (strict limit)
        capacity: 5,            // Bucket size
        refillRate: 0.5         // 0.5 tokens/second refill
      }
    };
  }

  /**
   * Order Service Configuration
   * 
   * STEP 2: Customize for Order Service needs
   * WHY: Order processing is resource-intensive, needs isolation
   * BENEFIT: Prevents order operations from exhausting all resources
   */
  static createOrderServiceConfig(baseUrl, httpClient) {
    return {
      ...this.createDefaultConfig(baseUrl, httpClient),
      bulkhead: { 
        maxConcurrent: 3,       // Only 3 concurrent orders (resource-intensive)
        maxQueueSize: 5,        // Small queue
        queueTimeout: 2000      // Don't wait too long
      }
    };
  }
}

// ============================================================================
// Mock HTTP Server Simulation
// ============================================================================

/**
 * Mock API Server - Simulates real API behavior
 * 
 * PURPOSE: Demonstrate resilience patterns without external dependencies
 * WHY: Makes example self-contained and reproducible
 * FEATURES:
 * - Normal responses (successful)
 * - Controlled failures (failureMode)
 * - Slow responses (slowMode)
 * - Random failures (10% chance)
 * 
 * This simulates real-world scenarios:
 * - Network issues (random failures)
 * - Service outages (failureMode)
 * - Slow responses (slowMode)
 */
class MockApiServer {
  constructor() {
    this.requestCount = 0;       // Track total requests
    this.failureMode = false;    // Simulate service outage
    this.slowMode = false;       // Simulate slow responses
    
    // Mock data - simulates database
    this.users = [
      { id: 1, name: 'John Doe', email: 'john@example.com' },
      { id: 2, name: 'Jane Smith', email: 'jane@example.com' },
      { id: 3, name: 'Bob Wilson', email: 'bob@example.com' }
    ];
    this.products = [
      { id: 1, name: 'Laptop', price: 999.99 },
      { id: 2, name: 'Phone', price: 699.99 },
      { id: 3, name: 'Tablet', price: 499.99 }
    ];
  }

  /**
   * Handle incoming HTTP requests
   * 
   * FLOW:
   * 1. Increment request counter
   * 2. Apply slow mode if enabled (simulates network latency)
   * 3. Check failure mode (simulates service outage)
   * 4. Random failures (simulates real-world unpredictability)
   * 5. Route to appropriate handler
   * 
   * WHY: Demonstrates how resilience patterns handle different failure scenarios
   */
  async handle(url, options) {
    this.requestCount++;  // Track all requests
    
    // SCENARIO 1: Slow responses (timeout pattern will catch this)
    if (this.slowMode) {
      await this.delay(2000);  // Delay 2 seconds
    }
    
    // SCENARIO 2: Service outage (circuit breaker and fallback will handle)
    if (this.failureMode) {
      throw new HttpError('Service temporarily unavailable', 503);
    }
    
    // SCENARIO 3: Random failures (retry pattern will handle)
    // 10% failure rate simulates real-world transient errors
    if (Math.random() < 0.1) {
      throw new HttpError('Random server error', 500);
    }
    
    // Route to appropriate handler based on path
    const path = new URL(url).pathname;
    
    if (path.startsWith('/api/users')) {
      return this.handleUsers(path, options);
    }
    if (path.startsWith('/api/products')) {
      return this.handleProducts(path, options);
    }
    if (path.startsWith('/api/orders')) {
      return this.handleOrders(path, options);
    }
    
    // 404 for unknown routes
    throw new HttpError('Not found', 404);
  }

  handleUsers(path, options) {
    const match = path.match(/\/api\/users\/(\d+)/);
    if (match) {
      const user = this.users.find(u => u.id === parseInt(match[1]));
      if (!user) throw new HttpError('User not found', 404);
      return { status: 200, data: user };
    }
    return { status: 200, data: this.users };
  }

  handleProducts(path, options) {
    const match = path.match(/\/api\/products\/(\d+)/);
    if (match) {
      const product = this.products.find(p => p.id === parseInt(match[1]));
      if (!product) throw new HttpError('Product not found', 404);
      return { status: 200, data: product };
    }
    return { status: 200, data: this.products };
  }

  handleOrders(path, options) {
    if (options.method === 'POST') {
      const body = JSON.parse(options.body);
      return { 
        status: 201, 
        data: { 
          id: Date.now(), 
          ...body, 
          status: 'created',
          timestamp: new Date().toISOString()
        }
      };
    }
    return { status: 200, data: [] };
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  setFailureMode(enabled) {
    this.failureMode = enabled;
  }

  setSlowMode(enabled) {
    this.slowMode = enabled;
  }
}

// ============================================================================
// Cache Implementation (Single Responsibility + Interface Segregation)
// ============================================================================

/**
 * Time-To-Live (TTL) Cache Implementation
 * 
 * PURPOSE: Store responses temporarily to use as fallback when API fails
 * WHY: Enables graceful degradation - serve stale data instead of failing
 * PATTERN: Cache-Aside Pattern
 * 
 * FLOW:
 * 1. Try to fetch from API
 * 2. If success -> Cache the response
 * 3. If failure -> Return cached version (if available)
 * 
 * TTL (Time-To-Live): Cached data expires after specified time
 * - Prevents serving extremely stale data
 * - Default: 60 seconds (configurable)
 * 
 * @implements {ICache}
 */
class SimpleCache {
  constructor(ttlMs = 60000) {
    this.cache = new Map();  // In-memory storage (Map for O(1) access)
    this.ttl = ttlMs;        // Time-to-live in milliseconds
  }

  /**
   * Store value in cache with current timestamp
   * WHY: Timestamp lets us check if data is too old
   */
  set(key, value) {
    this.cache.set(key, {
      value,
      timestamp: Date.now()  // Record when cached
    });
  }

  /**
   * Retrieve value from cache
   * BEHAVIOR: Returns null if expired or not found
   * WHY: Automatic cleanup of stale data
   */
  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;  // Not in cache
    
    // Check if expired
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);  // Remove stale data
      return null;
    }
    
    return entry.value;  // Return fresh data
  }

  /**
   * Check if key exists and is not expired
   */
  has(key) {
    return this.get(key) !== null;
  }

  /**
   * Clear all cached data
   */
  clear() {
    this.cache.clear();
  }
}

// ============================================================================
// Base Service Class (DRY Principle)
// ============================================================================

/**
 * Base API Service Class
 * 
 * PURPOSE: Eliminate code duplication across services (DRY Principle)
 * WHY: All services need:
 * - HTTP client
 * - Caching for fallbacks
 * - Logging for monitoring
 * - Event handling for resilience patterns
 * 
 * BENEFITS:
 * 1. Single Responsibility: Base class handles common concerns
 * 2. Open/Closed: Services extend without modifying base
 * 3. Dependency Inversion: Depends on interfaces (ICache, ILogger)
 * 4. DRY: Event handling written once, reused by all services
 * 
 * INHERITANCE HIERARCHY:
 * BaseApiService (common functionality)
 *   ├── UserService (user-specific operations)
 *   ├── ProductService (product-specific operations)
 *   └── OrderService (order-specific operations)
 */
class BaseApiService {
  /**
   * Constructor - Inject all dependencies
   * 
   * STEP 1: Store dependencies (Dependency Injection Pattern)
   * STEP 2: Setup event listeners for monitoring
   * 
   * @param {ResilientHttpClient} client - HTTP client with resilience patterns
   * @param {ICache} cache - Cache for fallback data
   * @param {ILogger} logger - Logger for monitoring
   */
  constructor(client, cache, logger) {
    // Store injected dependencies
    this.client = client;  // ResilientHttpClient instance
    this.cache = cache;    // Cache instance (SimpleCache)
    this.logger = logger;  // Logger instance (ConsoleLogger)
    
    // Setup event listeners to monitor resilience pattern behavior
    this.setupEventListeners();
  }

  /**
   * Setup Event Listeners - Monitor resilience pattern behavior
   * 
   * PURPOSE: React to events from ResilientHttpClient
   * WHY: Provides visibility into:
   * - When circuit breaker opens/closes
   * - When retries happen
   * - When rate limits are hit
   * - When bulkhead rejects requests
   * 
   * PATTERN: Observer Pattern
   * - ResilientHttpClient emits events
   * - Services subscribe to those events
   * - Loose coupling between client and services
   * 
   * BENEFIT: Centralized event handling - all services get same monitoring
   * 
   * Can be overridden by subclasses for custom behavior (Template Method Pattern)
   */
  setupEventListeners() {
    // Circuit breaker opened - service is failing
    // ACTION: Log warning, fallbacks will be used
    this.client.on('circuitOpen', () => {
      this.logger.warn('Circuit breaker OPENED - using fallbacks');
    });
    
    // Circuit breaker closed - service recovered
    // ACTION: Log success, normal operation resumed
    this.client.on('circuitClose', () => {
      this.logger.success('Circuit breaker CLOSED - service recovered');
    });
    
    // Retry attempt in progress
    // ACTION: Log retry info for debugging
    this.client.on('retry', ({ attempt, delay }) => {
      this.logger.retry(`Retry attempt ${attempt}, waiting ${delay}ms`);
    });

    // Rate limit exceeded
    // ACTION: Log warning, request was throttled
    this.client.on('rateLimited', () => {
      this.logger.warn('Rate limit hit - throttling requests');
    });

    // Bulkhead rejected request (too many concurrent)
    // ACTION: Log warning, system at capacity
    this.client.on('bulkheadRejected', () => {
      this.logger.warn('Request rejected - bulkhead full');
    });
  }

  /**
   * Create cache fallback handler (DRY Principle)
   * 
   * PURPOSE: Generate fallback function for when API fails
   * WHY: Every service needs cache fallback - write once, reuse everywhere
   * 
   * FLOW:
   * 1. Primary request fails (API down, timeout, etc.)
   * 2. Fallback function called
   * 3. Check cache for data
   * 4. If found -> Return cached data (graceful degradation)
   * 5. If not found -> Throw error (no fallback available)
   * 
   * BENEFIT: Users get stale data instead of error page
   * 
   * @param {string} cacheKey - Key to lookup in cache
   * @param {string} errorMessage - Error if no cache available
   * @returns {function(): Promise<Object>} Fallback function
   */
  createCacheFallback(cacheKey, errorMessage = 'No cached data available') {
    return async () => {
      // Try to get from cache
      const cached = this.cache.get(cacheKey);
      
      if (cached) {
        // Cache hit! Return stale data
        this.logger.info('Returning cached data');
        return { 
          status: 200, 
          data: cached, 
          fromCache: true  // Flag indicating this is cached
        };
      }
      throw new Error(errorMessage);
    };
  }

  /**
   * Cache response if successful and not from cache
   * 
   * PURPOSE: Store fresh responses for future fallback use
   * WHY: Only cache fresh responses, not cached responses (prevents recursive caching)
   * 
   * FLOW:
   * 1. Check if response exists
   * 2. Check if NOT from cache (fromCache flag)
   * 3. Check if has data
   * 4. Store in cache for future fallback
   * 
   * @param {Object} response - HTTP response
   * @param {string} cacheKey - Key to store in cache
   */
  cacheResponse(response, cacheKey) {
    if (response && !response.fromCache && response.data) {
      this.cache.set(cacheKey, response.data);
    }
  }
}

// ============================================================================
// API Service Classes (Single Responsibility + Liskov Substitution)
// ============================================================================

/**
 * User Service - Handles user-related API operations
 * 
 * PURPOSE: Manage user data with resilience patterns
 * WHY: User operations are critical - need circuit breaker and cache fallback
 * 
 * PATTERNS DEMONSTRATED:
 * 1. Single Responsibility: Only handles user operations
 * 2. Liskov Substitution: Can replace BaseApiService anywhere
 * 3. Dependency Inversion: Depends on abstractions (ICache, ILogger, ResilientHttpClient)
 * 4. Open/Closed: Can extend with new methods without modifying base
 * 
 * RESILIENCE FEATURES:
 * - Circuit Breaker: Opens after 3 failures (stricter than default)
 * - Retry: 3 attempts with exponential backoff
 * - Timeout: 3 seconds (shorter for user-facing operations)
 * - Fallback: Returns cached data when API fails
 * - Cache: 60-second TTL for user data
 */
class UserService extends BaseApiService {
  /**
   * Get all users
   * 
   * FLOW:
   * 1. Make GET request to /api/users
   * 2. If fails -> Use cache fallback
   * 3. If succeeds -> Cache response for future fallbacks
   * 4. Return user data
   * 
   * RESILIENCE: Circuit breaker + retry + timeout + cache fallback
   */
  async getUsers() {
    const cacheKey = 'users:all';  // Cache key for all users
    
    try {
      // Make request with fallback function
      const response = await this.client.get('/api/users', {
        fallback: this.createCacheFallback(cacheKey)  // Use cached data if API fails
      });
      
      // Cache successful response for future use
      this.cacheResponse(response, cacheKey);
      return response.data;
    } catch (error) {
      // Log and re-throw (caller can handle)
      this.logger.error(`Failed to get users: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get single user by ID
   * 
   * FLOW: Same as getUsers but for single user
   * CACHE KEY: users:{id} - separate cache entry per user
   * 
   * @param {number|string} id - User ID
   */
  async getUser(id) {
    const cacheKey = `users:${id}`;  // Unique cache key per user
    
    const response = await this.client.get(`/api/users/${id}`, {
      fallback: this.createCacheFallback(cacheKey, 'User not found in cache')
    });
    
    this.cacheResponse(response, cacheKey);
    return response.data;
  }
}

/**
 * Product Service - Handles product-related API operations
 * 
 * PURPOSE: Manage product data with rate limiting
 * WHY: External product API has strict rate limits - need throttling
 * 
 * PATTERNS DEMONSTRATED:
 * 1. Single Responsibility: Only handles product operations
 * 2. Interface Segregation: Only implements methods it needs
 * 
 * RESILIENCE FEATURES:
 * - Rate Limiter: 5 requests per 10 seconds (strict limit)
 * - Token Bucket: Capacity 5, refill 0.5 tokens/second
 * - Circuit Breaker: Default settings (5 failures)
 * - Retry: 3 attempts
 * - Timeout: 5 seconds
 * 
 * NOTE: No caching - product data changes frequently
 */
class ProductService extends BaseApiService {
  /**
   * Get all products
   * 
   * FLOW:
   * 1. Check rate limiter (will throw RateLimitError if exceeded)
   * 2. Make GET request
   * 3. Return product data
   * 
   * RATE LIMIT: Will throttle after 5 requests in 10 seconds
   */
  async getProducts() {
    return (await this.client.get('/api/products')).data;
  }

  /**
   * Get single product by ID
   * 
   * @param {number|string} id - Product ID
   */
  async getProduct(id) {
    return (await this.client.get(`/api/products/${id}`)).data;
  }

  /**
   * Search products by query
   * 
   * FEATURE: Demonstrates query parameter handling
   * 
   * @param {string} query - Search query
   */
  async searchProducts(query) {
    return (await this.client.get('/api/products', {
      queryParams: { search: query }  // ResilientHttpClient handles query params
    })).data;
  }
}

/**
 * Order Service - Handles order-related API operations
 * 
 * PURPOSE: Manage order processing with bulkhead pattern
 * WHY: Order operations are resource-intensive - need isolation
 * 
 * PATTERNS DEMONSTRATED:
 * 1. Single Responsibility: Only handles order operations
 * 2. Resource Isolation: Bulkhead prevents order processing from exhausting resources
 * 
 * RESILIENCE FEATURES:
 * - Bulkhead: Only 3 concurrent orders, queue size 5
 * - Queue Timeout: 2 seconds max wait in queue
 * - Circuit Breaker: Default settings
 * - Retry: 3 attempts
 * - Timeout: 5 seconds
 * 
 * WHY BULKHEAD: Order processing involves:
 * - Payment processing
 * - Inventory updates
 * - Email notifications
 * Limiting concurrency prevents system overload
 */
class OrderService extends BaseApiService {
  /**
   * Create new order
   * 
   * FLOW:
   * 1. Check bulkhead (max 3 concurrent)
   * 2. If slot available -> Process order
   * 3. If full -> Queue (max 5, timeout 2s)
   * 4. If queue full -> Throw BulkheadRejectedError
   * 
   * RESILIENCE: Prevents order surge from overwhelming system
   * 
   * @param {Object} order - Order details
   */
  async createOrder(order) {
    const response = await this.client.post('/api/orders', order);
    return response.data;
  }

  /**
   * Get all orders
   * 
   * NOTE: Also protected by bulkhead
   */
  async getOrders() {
    return (await this.client.get('/api/orders')).data;
  }
}

// ============================================================================
// Service Factory (DRY Principle + Dependency Inversion)
// ============================================================================

/**
 * Service Factory - Creates services with proper dependencies
 * 
 * PURPOSE: Centralize service creation (Factory Pattern)
 * WHY: Eliminates duplication in service initialization
 * 
 * PATTERNS DEMONSTRATED:
 * 1. Factory Pattern: Encapsulates object creation
 * 2. Single Responsibility: Only creates services
 * 3. Dependency Inversion: All services depend on abstractions
 * 4. DRY: Service creation logic in one place
 * 
 * BENEFITS:
 * - Easy to add new services
 * - Consistent dependency injection
 * - Easy to swap implementations (mock vs real)
 * - Testability: Can inject mocks
 * 
 * USAGE:
 * ```javascript
 * const factory = new ServiceFactory(mockServer, cache);
 * const userService = factory.createUserService();
 * ```
 */
class ServiceFactory {
  /**
   * Constructor - Store shared dependencies
   * 
   * @param {MockApiServer} mockServer - HTTP server implementation
   * @param {ICache} cache - Cache implementation
   */
  constructor(mockServer, cache) {
    this.mockServer = mockServer;  // Shared HTTP server
    this.cache = cache;            // Shared cache instance
  }

  /**
   * Create UserService with user-specific configuration
   * 
   * CONFIGURATION:
   * - Stricter circuit breaker (3 failures)
   * - Shorter timeout (3s)
   * - Cache fallback enabled
   * 
   * STEP 1: Create config with ClientConfigFactory
   * STEP 2: Create ResilientHttpClient with config
   * STEP 3: Create logger with service prefix
   * STEP 4: Create service with dependencies
   */
  createUserService() {
    // STEP 1: Get user-specific configuration
    const config = ClientConfigFactory.createUserServiceConfig(
      'https://api.example.com',
      (url, opts) => this.mockServer.handle(url, opts)  // Inject mock server
    );
    
    // STEP 2: Create HTTP client with resilience patterns
    const client = new ResilientHttpClient(config);
    
    // STEP 3: Create logger with service prefix
    const logger = new ConsoleLogger('[UserService] ');
    
    // STEP 4: Create service (Dependency Injection)
    return new UserService(client, this.cache, logger);
  }

  /**
   * Create ProductService with rate limiting configuration
   * 
   * CONFIGURATION:
   * - Strict rate limiting (5 req/10s)
   * - No caching (data changes frequently)
   * - Default circuit breaker
   */
  createProductService() {
    const config = ClientConfigFactory.createProductServiceConfig(
      'https://api.example.com',
      (url, opts) => this.mockServer.handle(url, opts)
    );
    
    const client = createResilientClient(config);  // Alternative builder syntax
    const logger = new ConsoleLogger('[ProductService] ');
    
    return new ProductService(client, this.cache, logger);
  }

  /**
   * Create OrderService with bulkhead configuration
   * 
   * CONFIGURATION:
   * - Bulkhead (3 concurrent, queue 5)
   * - Simulated latency (100ms)
   * - Default patterns
   * 
   * NOTE: Adds 100ms latency to simulate processing time
   */
  createOrderService() {
    const config = ClientConfigFactory.createOrderServiceConfig(
      'https://api.example.com',
      async (url, opts) => {
        // Simulate order processing latency
        await new Promise(r => setTimeout(r, 100));
        return this.mockServer.handle(url, opts);
      }
    );
    
    const client = createResilientClient(config);
    const logger = new ConsoleLogger('[OrderService] ');
    
    return new OrderService(client, this.cache, logger);
  }
}

/**
 * Main Demo Function
 * 
 * PURPOSE: Demonstrate all resilience patterns in realistic scenarios
 * WHY: Shows how patterns work together in production-like situations
 * 
 * DEMO STRUCTURE:
 * 1. User Service Demo - Circuit breaker, retry, cache fallback
 * 2. Product Service Demo - Rate limiting
 * 3. Order Service Demo - Bulkhead pattern
 * 4. Combined Stress Test - All patterns under load
 * 
 * PATTERNS DEMONSTRATED:
 * - Circuit Breaker: Fail fast when service is down
 * - Retry: Handle transient failures automatically
 * - Timeout: Prevent hanging requests
 * - Fallback: Graceful degradation with cached data
 * - Rate Limiter: Throttle request rate
 * - Bulkhead: Isolate resources and prevent cascading failures
 * 
 * EXECUTION: node examples/resilient-rest-api.js
 */
async function runDemo() {
  console.log('═'.repeat(70));
  console.log('🚀 RESILIENT REST API SERVICE DEMO');
  console.log('═'.repeat(70));
  console.log();

  // =========================================================================
  // STEP 0: Initialize Shared Dependencies
  // =========================================================================
  // 
  // PATTERN: Dependency Inversion Principle
  // - Services depend on interfaces, not concrete implementations
  // - Easy to swap mock server with real HTTP client
  // - Easy to swap cache with Redis, Memcached, etc.
  // 
  // WHY SHARED:
  // - mockServer: One server handles all services (simulates microservices)
  // - cache: Shared cache across services (like Redis in production)
  // - serviceFactory: Consistent service creation
  
  const mockServer = new MockApiServer();    // Mock HTTP server
  const cache = new SimpleCache(60000);       // 60-second TTL cache
  const serviceFactory = new ServiceFactory(mockServer, cache);

  // =========================================================================
  // DEMO 1: User Service - Circuit Breaker, Retry, Cache Fallback
  // =========================================================================
  //
  // PURPOSE: Demonstrate circuit breaker and cache fallback patterns
  // 
  // SCENARIO:
  // 1. Normal operation - Success
  // 2. Single user fetch - Success
  // 3. Service failure - Cache fallback (graceful degradation)
  // 
  // PATTERNS DEMONSTRATED:
  // - Circuit Breaker: Opens after 3 failures (UserService config)
  // - Retry: Automatic retries on transient failures
  // - Cache Fallback: Returns cached data when API fails
  // - Timeout: 3-second timeout for user operations
  // 
  // WHY THIS MATTERS:
  // In production, if user service goes down:
  // - Without resilience: Users see error page
  // - With resilience: Users see cached data (stale but functional)
  
  console.log('📌 DEMO 1: User Service with Circuit Breaker & Retry');
  console.log('-'.repeat(50));

  const userService = serviceFactory.createUserService();

  try {
    // STEP 1.1: Normal operation - demonstrate successful request
    // FLOW: Request → Timeout → Retry → Circuit Breaker → Rate Limiter → Bulkhead → Fallback → HTTP
    console.log('\n1.1 Fetching users (normal operation):');
    const users = await userService.getUsers();
    console.log(`   ✅ Retrieved ${users.length} users`);
    users.forEach(u => console.log(`      - ${u.name} (${u.email})`));
    // RESULT: Data cached for future fallback use

    // STEP 1.2: Single user fetch - demonstrate parameterized requests
    // FLOW: Same resilience layers as above
    console.log('\n1.2 Fetching single user:');
    const user = await userService.getUser(1);
    console.log(`   ✅ User: ${user.name}`);
    // RESULT: Individual user cached separately (cache key: users:1)

    // STEP 1.3: Simulate service failure - demonstrate cache fallback
    // SCENARIO: API is down (503 Service Unavailable)
    // FLOW: Request → Fails → Retry (fails again) → Circuit opens → Fallback triggered → Cache hit
    console.log('\n1.3 Simulating service failure (cache fallback):');
    mockServer.setFailureMode(true);  // Make all requests fail with 503
    
    const cachedUsers = await userService.getUsers();
    console.log(`   ✅ Retrieved ${cachedUsers.length} users from cache`);
    // RESULT: Users see stale data instead of error - graceful degradation!
    
    mockServer.setFailureMode(false);  // Restore normal operation
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }

  // Display statistics - shows circuit breaker state, retry counts, etc.
  console.log('\n   📊 User Service Stats:', JSON.stringify(userService.client.getStats().client, null, 2));
  userService.client.shutdown();  // Cleanup: stop timers and event listeners

  // =========================================================================
  // DEMO 2: Product Service - Rate Limiting
  // =========================================================================
  //
  // PURPOSE: Demonstrate rate limiting pattern
  // 
  // SCENARIO: Make 7 requests when limit is 5 requests/10 seconds
  // EXPECTED: First 5 succeed, requests 6-7 fail with RateLimitError
  // 
  // PATTERNS DEMONSTRATED:
  // - Rate Limiter: Token bucket algorithm
  //   * Capacity: 5 tokens
  //   * Refill: 0.5 tokens/second
  //   * Window: 10 seconds
  // - Retry: Will NOT retry rate limit errors (by design)
  // 
  // WHY THIS MATTERS:
  // External APIs often have strict rate limits:
  // - Without rate limiter: Get banned or charged overages
  // - With rate limiter: Gracefully handle limits, queue requests
  // 
  // REAL-WORLD EXAMPLE:
  // - Stripe API: 100 requests/second
  // - GitHub API: 5000 requests/hour
  // - Twitter API: 300 requests/15 minutes
  
  console.log('\n');
  console.log('📌 DEMO 2: Product Service with Rate Limiting');
  console.log('-'.repeat(50));

  const productService = serviceFactory.createProductService();

  try {
    console.log('\n2.1 Making multiple product requests (rate limiting demo):');
    
    // STEP 2.1: Burst of 7 requests
    // EXPECTED RESULTS:
    // - Requests 1-5: Success (tokens available)
    // - Requests 6-7: RateLimitError (bucket empty)
    // 
    // FLOW for each request:
    // Request → Check rate limiter → If tokens available: proceed, else: throw RateLimitError
    
    for (let i = 0; i < 7; i++) {
      try {
        const products = await productService.getProducts();
        console.log(`   ✅ Request ${i + 1}: Retrieved ${products.length} products`);
        // SUCCESS: Token consumed, ${5-i} tokens remaining
      } catch (error) {
        if (error.name === 'RateLimitError') {
          console.log(`   🚫 Request ${i + 1}: Rate limited!`);
          // RATE LIMITED: No tokens available, must wait for refill
          // Refill rate: 0.5 tokens/second ≈ 2 seconds per token
        } else {
          console.log(`   ❌ Request ${i + 1}: ${error.message}`);
        }
      }
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }

  console.log('\n   📊 Product Service Stats:', JSON.stringify(productService.client.getStats().rateLimiter, null, 2));
  productService.client.shutdown();

  // =========================================================================
  // DEMO 3: Order Service - Bulkhead Pattern
  // =========================================================================
  //
  // PURPOSE: Demonstrate resource isolation with bulkhead pattern
  // 
  // SCENARIO: Create 6 orders concurrently when limit is 3 concurrent + 5 queued
  // EXPECTED: First 3 execute, next 3 queue (if room) or fail
  // 
  // PATTERNS DEMONSTRATED:
  // - Bulkhead: Limits concurrent operations
  //   * Max Concurrent: 3 orders at once
  //   * Max Queue: 5 waiting orders
  //   * Queue Timeout: 2 seconds
  // - Resource Isolation: Order failures don't affect other services
  // 
  // WHY THIS MATTERS:
  // Order processing is resource-intensive (payment, inventory, emails):
  // - Without bulkhead: Order surge exhausts all resources
  // - With bulkhead: Order service isolated, other services unaffected
  // 
  // REAL-WORLD ANALOGY:
  // Ship bulkheads prevent one leak from sinking entire ship
  // Service bulkheads prevent one service from taking down entire system
  
  console.log('\n');
  console.log('📌 DEMO 3: Order Service with Bulkhead Pattern');
  console.log('-'.repeat(50));

  const orderService = serviceFactory.createOrderService();

  try {
    console.log('\n3.1 Creating concurrent orders (bulkhead demo):');
    
    // STEP 3.1: Create 6 orders concurrently
    // EXPECTED RESULTS:
    // - Orders 1-3: Execute immediately (slots available)
    // - Orders 4-6: Queue or fail (depends on queue size and timeout)
    // 
    // FLOW for each order:
    // Request → Bulkhead check → If slot available: execute
    //                           → Else if queue has room: wait in queue
    //                           → Else: throw BulkheadRejectedError
    
    const orders = Array(6).fill().map((_, i) => ({
      userId: i + 1,
      productId: (i % 3) + 1,              // Rotate through 3 products
      quantity: Math.floor(Math.random() * 5) + 1  // Random quantity 1-5
    }));

    // Use Promise.allSettled to see all results (success and failure)
    const results = await Promise.allSettled(
      orders.map((order, i) => 
        orderService.createOrder(order)
          .then(result => ({ success: true, index: i, order: result }))
          .catch(err => ({ success: false, index: i, error: err.message }))
      )
    );

    // Display results
    results.forEach(({ value }) => {
      if (value.success) {
        console.log(`   ✅ Order ${value.index + 1}: Created (ID: ${value.order.id})`);
        // SUCCESS: Order processed within bulkhead limits
      } else {
        console.log(`   ❌ Order ${value.index + 1}: Failed - ${value.error}`);
        // FAILED: Either bulkhead full or queue timeout exceeded
      }
    });
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }

  console.log('\n   📊 Order Service Stats:', JSON.stringify(orderService.client.getStats().bulkhead, null, 2));
  orderService.client.shutdown();

  // =========================================================================
  // DEMO 4: Timeout Pattern
  // =========================================================================
  //
  // PURPOSE: Demonstrate timeout pattern for slow responses
  // 
  // SCENARIO:
  // 1. Fast request - completes normally
  // 2. Slow request - times out after 500ms
  // 
  // PATTERNS DEMONSTRATED:
  // - Timeout: Prevents hanging requests
  //   * Duration: 500ms (very short for demo)
  //   * Behavior: Throws TimeoutError if exceeded
  // - Retry: Works with timeout (retries timeout errors)
  // 
  // WHY THIS MATTERS:
  // Slow responses can cascade into system-wide issues:
  // - Without timeout: Threads/connections exhausted waiting
  // - With timeout: Fail fast, free resources, try again or fallback
  // 
  // REAL-WORLD EXAMPLE:
  // - Database query taking minutes instead of milliseconds
  // - External API with network issues
  // - Deadlocked resources
  
  console.log('\n');
  console.log('📌 DEMO 4: Timeout Pattern');
  console.log('-'.repeat(50));

  // Create custom client with SHORT timeout (500ms) for demo
  const timeoutConfig = ClientConfigFactory.createDefaultConfig(
    'https://api.example.com',
    (url, opts) => mockServer.handle(url, opts)
  );
  timeoutConfig.timeout.duration = 500;  // 500ms timeout (very aggressive)
  
  const timeoutClient = createResilientClient(timeoutConfig);

  try {
    // STEP 4.1: Normal request (fast response)
    // EXPECTED: Completes in < 500ms, success
    console.log('\n4.1 Normal request (fast response):');
    const response = await timeoutClient.get('/api/users');
    console.log(`   ✅ Received response with ${response.data.length} users`);
    // SUCCESS: Request completed within timeout

    // STEP 4.2: Slow request (will timeout)
    // SCENARIO: Mock server delays 2 seconds, timeout is 500ms
    // EXPECTED: TimeoutError after 500ms
    console.log('\n4.2 Slow request (will timeout):');
    mockServer.setSlowMode(true);  // Enable 2-second delay
    
    await timeoutClient.get('/api/users');
    console.log('   ✅ Received response');
  } catch (error) {
    if (error.name === 'TimeoutError') {
      console.log(`   ⏱️  Request timed out after ${error.duration}ms`);
      // TIMEOUT: Request took longer than 500ms, aborted
      // In production: Could retry, use fallback, or show error
    } else {
      console.log(`   ❌ Error: ${error.message}`);
    }
  }
  
  mockServer.setSlowMode(false);  // Restore normal speed
  console.log('\n   📊 Timeout Stats:', JSON.stringify(timeoutClient.getStats().timeout, null, 2));
  timeoutClient.shutdown();

  // =========================================================================
  // DEMO 5: Complete Resilient Service - All Patterns Together
  // =========================================================================
  //
  // PURPOSE: Demonstrate all 6 resilience patterns working together
  // 
  // PATTERNS COMBINED:
  // 1. Circuit Breaker: Fail fast when service is down
  // 2. Retry: Handle transient failures automatically
  // 3. Timeout: Prevent hanging requests
  // 4. Fallback: Graceful degradation with custom fallback
  // 5. Rate Limiter: Throttle request rate
  // 6. Bulkhead: Isolate resources
  // 
  // FLOW (Onion/Decorator Pattern):
  // Request → Timeout wraps → Retry wraps → CircuitBreaker wraps → 
  // RateLimiter wraps → Bulkhead wraps → Fallback wraps → HTTP Call
  // 
  // WHY THIS MATTERS:
  // In production, you want multiple layers of defense:
  // - First line: Timeout prevents hanging
  // - Second line: Retry handles transient errors
  // - Third line: Circuit breaker prevents cascading failures
  // - Fourth line: Rate limiter protects external APIs
  // - Fifth line: Bulkhead isolates resources
  // - Last line: Fallback provides graceful degradation
  // 
  // REAL-WORLD: This is how Netflix, Amazon, Google handle microservices
  
  console.log('\n');
  console.log('📌 DEMO 5: Complete Resilient Service (All Patterns)');
  console.log('-'.repeat(50));

  // STEP 5.1: Build client with ALL patterns using fluent builder
  // 
  // BUILDER PATTERN BENEFITS:
  // - Fluent interface (method chaining)
  // - Clear configuration
  // - Optional patterns (can skip any)
  // - Immutable configuration once built
  // 
  // EACH METHOD CONFIGURES A PATTERN:
  const resilientClient = new ResilientHttpClientBuilder()
    .baseUrl('https://api.example.com')  // Base URL for all requests
    .headers({ 
      'Authorization': 'Bearer demo-token',     // Authentication
      'X-Client-Version': '2.0'                  // Client version header
    })
    // PATTERN 1: Circuit Breaker - fail fast when service is down
    .withCircuitBreaker({
      failureThreshold: 5,    // Open after 5 consecutive failures
      successThreshold: 3,    // Close after 3 consecutive successes
      timeout: 10000          // Try half-open after 10 seconds
    })
    // PATTERN 2: Retry - handle transient failures
    .withRetry({
      maxAttempts: 3,         // Try up to 3 times total
      baseDelay: 200,         // Start with 200ms delay
      maxDelay: 5000          // Cap delay at 5 seconds
    })
    // PATTERN 3: Timeout - prevent hanging requests
    .withTimeout({ duration: 5000 })  // 5-second timeout
    
    // PATTERN 4: Bulkhead - isolate resources
    .withBulkhead({ 
      maxConcurrent: 10,      // Max 10 concurrent requests
      maxQueueSize: 50        // Queue up to 50 waiting requests
    })
    // PATTERN 5: Rate Limiter - throttle requests
    .withRateLimiter({
      limit: 100,             // 100 requests
      windowMs: 60000         // per 60 seconds
    })
    .httpClient((url, opts) => mockServer.handle(url, opts))  // Inject HTTP implementation
    .build();  // Build final client (immutable)
  // PATTERN 6: Fallback - configured per-request (see below)

  // STEP 5.2: Setup event monitoring (Observer Pattern)
  // 
  // PURPOSE: Track what patterns are triggered during execution
  // WHY: Provides visibility into resilience behavior
  // BENEFIT: Can alert, log, or visualize pattern activation
  // 
  // EVENTS TRACKED:
  const events = [];
  resilientClient.on('success', () => events.push('success'));      // Request succeeded
  resilientClient.on('failure', () => events.push('failure'));      // Request failed
  resilientClient.on('retry', () => events.push('retry'));          // Retry triggered
  resilientClient.on('timeout', () => events.push('timeout'));      // Request timed out
  resilientClient.on('circuitOpen', () => events.push('circuitOpen')); // Circuit opened
  resilientClient.on('rateLimited', () => events.push('rateLimited')); // Rate limited

  try {
    // STEP 5.3: Execute mixed workload
    // 
    // PURPOSE: Simulate real-world API usage patterns
    // WHY: Production APIs receive mix of GET, POST, different endpoints
    // 
    // WORKLOAD INCLUDES:
    // - GET /api/users (list all users)
    // - GET /api/products (list all products)
    // - POST /api/orders (create order)
    // - GET /api/users/1 (single user)
    // - GET /api/products/2 (single product)
    // 
    // RESILIENCE IN ACTION:
    // Each request flows through all 6 patterns:
    // 1. Timeout checks if request takes too long
    // 2. Retry handles any transient failures
    // 3. Circuit breaker fails fast if service is down
    // 4. Rate limiter throttles if too many requests
    // 5. Bulkhead limits concurrency
    // 6. Fallback provides graceful degradation (if configured)
    
    console.log('\n5.1 Running mixed workload:');
    
    const workload = [
      () => resilientClient.get('/api/users'),
      () => resilientClient.get('/api/products'),
      () => resilientClient.post('/api/orders', { userId: 1, productId: 1, quantity: 2 }),
      () => resilientClient.get('/api/users/1'),
      () => resilientClient.get('/api/products/2'),
    ];

    // Execute each task sequentially (could also use Promise.all for concurrent)
    for (const task of workload) {
      try {
        const result = await task();
        console.log(`   ✅ Request succeeded`);
      } catch (error) {
        console.log(`   ❌ Request failed: ${error.message}`);
        // Even failures are handled gracefully - no crash!
      }
    }

    // STEP 5.4: Display monitoring data
    // 
    // PURPOSE: Show what patterns were activated
    // BENEFIT: Real-time visibility into resilience behavior
    console.log('\n5.2 Events recorded:', events);
    
    // STEP 5.5: Display comprehensive statistics
    // 
    // PURPOSE: Show metrics from all patterns
    // INCLUDES:
    // - Circuit breaker state and failure counts
    // - Retry attempt counts
    // - Timeout counts
    // - Rate limiter token usage
    // - Bulkhead concurrency metrics
    // - Overall success/failure rates
    console.log('\n5.3 Complete Statistics:');
    const stats = resilientClient.getStats();
    console.log(JSON.stringify(stats, null, 2));

  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }

  resilientClient.shutdown();  // Cleanup: stop all timers and event listeners

  // =========================================================================
  // DEMO SUMMARY
  // =========================================================================
  //
  // WHAT WE DEMONSTRATED:
  // 1. Each resilience pattern in isolation
  // 2. All patterns working together
  // 3. SOLID and DRY principles in action
  // 4. Event-driven monitoring (Observer Pattern)
  // 5. Dependency Injection and Factory patterns
  // 6. Builder pattern for configuration
  // 7. Graceful degradation strategies
  // 
  // KEY TAKEAWAYS:
  // - Resilience is about multiple layers of defense
  // - Each pattern solves specific failure mode
  // - Patterns work together seamlessly (Decorator/Onion pattern)
  // - Proper architecture makes system self-healing
  // - Monitoring is critical for production
  // 
  // PRODUCTION READINESS:
  // ✅ Circuit Breaker: Prevents cascading failures
  // ✅ Retry Handler: Handles transient errors automatically
  // ✅ Timeout Handler: Prevents resource exhaustion
  // ✅ Fallback Pattern: Graceful degradation with cache
  // ✅ Bulkhead Pattern: Resource isolation
  // ✅ Rate Limiter: API quota management
  // ✅ Event System: Real-time monitoring
  // ✅ Statistics: Metrics for observability
  // ✅ TDD: 47+ tests ensuring correctness
  // ✅ SOLID/DRY: Maintainable and extensible code
  
  console.log('\n');
  console.log('═'.repeat(70));
  console.log('📊 DEMO SUMMARY');
  console.log('═'.repeat(70));
  console.log(`
  ✅ Circuit Breaker: Prevents cascading failures
  ✅ Retry Handler: Automatic retries with exponential backoff  
  ✅ Timeout Handler: Prevents hanging requests
  ✅ Fallback Pattern: Cache-based graceful degradation
  ✅ Bulkhead Pattern: Resource isolation and concurrency control
  ✅ Rate Limiter: Request throttling
  ✅ Event System: Real-time monitoring and alerting
  ✅ Statistics: Comprehensive metrics collection
  `);

  console.log('🎉 Demo completed successfully!\n');
}

// ============================================================================
// EXECUTION
// ============================================================================
// 
// RUN THIS DEMO: node examples/resilient-rest-api.js
// 
// EXPECTED OUTPUT:
// - 5 demo sections showing each pattern
// - Success and failure scenarios
// - Statistics from all patterns
// - Event logs showing pattern activation
// 
// LEARN MORE:
// - docs/PATTERNS.md - Detailed pattern explanations
// - docs/API.md - Full API reference
// - docs/BEST_PRACTICES_REVIEW.md - Production guidelines
// - tests/ResilientHttpClient.test.js - TDD examples

runDemo().catch(console.error);
