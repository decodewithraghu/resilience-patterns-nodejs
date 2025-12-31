/**
 * Rate Limiter Implementation
 * 
 * Design Patterns Used:
 * - Strategy Pattern: Multiple rate limiting algorithms
 * - Observer Pattern: Event notifications
 * - Template Method: Common execution pattern
 * 
 * @module RateLimiter
 */

/**
 * Rate limiting algorithms
 */
export const RateLimitAlgorithm = Object.freeze({
  TOKEN_BUCKET: 'token_bucket',
  SLIDING_WINDOW: 'sliding_window',
  FIXED_WINDOW: 'fixed_window',
  LEAKY_BUCKET: 'leaky_bucket'
});

/**
 * @typedef {Object} RateLimiterOptions
 * @property {RateLimitAlgorithm} algorithm - Rate limiting algorithm
 * @property {number} limit - Maximum requests
 * @property {number} windowMs - Time window in ms
 * @property {string} name - Rate limiter name
 */

/**
 * Custom rate limit error
 */
export class RateLimitError extends Error {
  constructor(message, retryAfter) {
    super(message);
    this.name = 'RateLimitError';
    this.code = 'RATE_LIMITED';
    this.retryAfter = retryAfter;
  }
}

/**
 * Base RateLimiter class
 */
class BaseRateLimiter {
  /** @type {Map<string, Function[]>} */
  #listeners = new Map();

  constructor(options = {}) {
    this.limit = options.limit ?? 100;
    this.windowMs = options.windowMs ?? 60000;
    this.name = options.name ?? 'RateLimiter';
    
    this.stats = {
      totalRequests: 0,
      allowedRequests: 0,
      rejectedRequests: 0
    };
  }

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

  _emit(event, data) {
    const listeners = this.#listeners.get(event) || [];
    listeners.forEach(callback => {
      try {
        callback({ ...data, name: this.name });
      } catch (e) {
        console.error(`Error in rate limiter listener: ${e.message}`);
      }
    });
  }

  getStats() {
    return {
      ...this.stats,
      rejectionRate: this.stats.totalRequests > 0
        ? ((this.stats.rejectedRequests / this.stats.totalRequests) * 100).toFixed(2) + '%'
        : '0%'
    };
  }

  resetStats() {
    this.stats = {
      totalRequests: 0,
      allowedRequests: 0,
      rejectedRequests: 0
    };
  }
}

/**
 * Token Bucket Rate Limiter
 * Allows bursts up to bucket capacity, then rate-limits
 */
export class TokenBucketRateLimiter extends BaseRateLimiter {
  #tokens;
  #lastRefill;
  #refillTimer;

  constructor(options = {}) {
    super(options);
    this.capacity = options.capacity ?? this.limit;
    this.refillRate = options.refillRate ?? this.limit / (this.windowMs / 1000);
    this.refillInterval = options.refillInterval ?? 1000;
    
    this.#tokens = this.capacity;
    this.#lastRefill = Date.now();
    
    // Auto-refill timer
    this.#refillTimer = setInterval(() => this.#refill(), this.refillInterval);
  }

  #refill() {
    const now = Date.now();
    const elapsed = (now - this.#lastRefill) / 1000;
    const tokensToAdd = elapsed * this.refillRate;
    
    this.#tokens = Math.min(this.capacity, this.#tokens + tokensToAdd);
    this.#lastRefill = now;
  }

  /**
   * Try to consume tokens
   * @param {number} tokens - Tokens to consume
   * @returns {boolean}
   */
  tryConsume(tokens = 1) {
    this.stats.totalRequests++;
    this.#refill();
    
    if (this.#tokens >= tokens) {
      this.#tokens -= tokens;
      this.stats.allowedRequests++;
      this._emit('allowed', { 
        remainingTokens: this.#tokens,
        consumed: tokens
      });
      return true;
    }
    
    this.stats.rejectedRequests++;
    const retryAfter = Math.ceil((tokens - this.#tokens) / this.refillRate * 1000);
    this._emit('rejected', { 
      remainingTokens: this.#tokens,
      requested: tokens,
      retryAfter
    });
    return false;
  }

  /**
   * Execute with rate limiting
   * @template T
   * @param {() => Promise<T>} fn
   * @param {number} tokens
   * @returns {Promise<T>}
   */
  async execute(fn, tokens = 1) {
    if (!this.tryConsume(tokens)) {
      const retryAfter = Math.ceil((tokens - this.#tokens) / this.refillRate * 1000);
      throw new RateLimitError(
        `${this.name}: Rate limit exceeded`,
        retryAfter
      );
    }
    return fn();
  }

  get tokens() {
    this.#refill();
    return this.#tokens;
  }

  destroy() {
    clearInterval(this.#refillTimer);
  }
}

/**
 * Sliding Window Rate Limiter
 * Tracks requests in a sliding time window
 */
export class SlidingWindowRateLimiter extends BaseRateLimiter {
  #requests = [];

  constructor(options = {}) {
    super(options);
  }

  #cleanup() {
    const cutoff = Date.now() - this.windowMs;
    this.#requests = this.#requests.filter(time => time > cutoff);
  }

  /**
   * Try to acquire permit
   * @returns {boolean}
   */
  tryAcquire() {
    this.stats.totalRequests++;
    this.#cleanup();
    
    if (this.#requests.length < this.limit) {
      this.#requests.push(Date.now());
      this.stats.allowedRequests++;
      this._emit('allowed', { 
        currentCount: this.#requests.length,
        limit: this.limit
      });
      return true;
    }
    
    this.stats.rejectedRequests++;
    const oldestRequest = this.#requests[0];
    const retryAfter = oldestRequest + this.windowMs - Date.now();
    this._emit('rejected', { 
      currentCount: this.#requests.length,
      limit: this.limit,
      retryAfter
    });
    return false;
  }

  /**
   * Execute with rate limiting
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async execute(fn) {
    if (!this.tryAcquire()) {
      this.#cleanup();
      const oldestRequest = this.#requests[0];
      const retryAfter = oldestRequest ? oldestRequest + this.windowMs - Date.now() : 0;
      throw new RateLimitError(
        `${this.name}: Rate limit exceeded`,
        Math.max(0, retryAfter)
      );
    }
    return fn();
  }

  get currentCount() {
    this.#cleanup();
    return this.#requests.length;
  }
}

/**
 * Leaky Bucket Rate Limiter
 * Processes requests at a constant rate, queueing or rejecting excess
 * 
 * The bucket has a capacity and "leaks" at a constant rate.
 * Requests fill the bucket; if bucket overflows, requests are rejected.
 */
export class LeakyBucketRateLimiter extends BaseRateLimiter {
  #waterLevel = 0;
  #lastLeak;
  #leakTimer;

  /**
   * @param {Object} options
   * @param {number} options.capacity - Maximum bucket capacity (requests)
   * @param {number} options.leakRate - Requests processed per second
   */
  constructor(options = {}) {
    super(options);
    this.capacity = options.capacity ?? options.limit ?? 10;
    this.leakRate = options.leakRate ?? 1; // requests per second
    this.#lastLeak = Date.now();
    
    // Periodic leak timer
    this.#leakTimer = setInterval(() => this.#leak(), 100);
  }

  /**
   * Leak water from the bucket based on elapsed time
   * @private
   */
  #leak() {
    const now = Date.now();
    const elapsed = (now - this.#lastLeak) / 1000; // Convert to seconds
    const leakedAmount = elapsed * this.leakRate;
    
    const previousLevel = this.#waterLevel;
    this.#waterLevel = Math.max(0, this.#waterLevel - leakedAmount);
    this.#lastLeak = now;
    
    if (previousLevel > 0 && this.#waterLevel < previousLevel) {
      this._emit('leak', { 
        leaked: previousLevel - this.#waterLevel,
        currentLevel: this.#waterLevel 
      });
    }
  }

  /**
   * Try to add a request to the bucket
   * @param {number} amount - Amount to add (default 1)
   * @returns {boolean} True if request was accepted
   */
  tryAcquire(amount = 1) {
    this.stats.totalRequests++;
    this.#leak(); // Update water level first

    if (this.#waterLevel + amount <= this.capacity) {
      this.#waterLevel += amount;
      this.stats.allowedRequests++;
      this._emit('allowed', { 
        waterLevel: this.#waterLevel,
        capacity: this.capacity
      });
      return true;
    }

    this.stats.rejectedRequests++;
    // Calculate when there will be room
    const excessAmount = (this.#waterLevel + amount) - this.capacity;
    const retryAfter = Math.ceil((excessAmount / this.leakRate) * 1000);
    this._emit('rejected', { 
      waterLevel: this.#waterLevel,
      capacity: this.capacity,
      retryAfter
    });
    return false;
  }

  /**
   * Execute with rate limiting
   * @template T
   * @param {() => Promise<T>} fn
   * @param {number} amount - Request weight
   * @returns {Promise<T>}
   */
  async execute(fn, amount = 1) {
    if (!this.tryAcquire(amount)) {
      const excessAmount = (this.#waterLevel + amount) - this.capacity;
      const retryAfter = Math.ceil((excessAmount / this.leakRate) * 1000);
      throw new RateLimitError(
        `${this.name}: Rate limit exceeded (bucket full)`,
        retryAfter
      );
    }
    return fn();
  }

  /**
   * Get current water level
   */
  get waterLevel() {
    this.#leak();
    return this.#waterLevel;
  }

  /**
   * Get available capacity
   */
  get available() {
    this.#leak();
    return this.capacity - this.#waterLevel;
  }

  /**
   * Clean up timer
   */
  destroy() {
    clearInterval(this.#leakTimer);
  }
}

/**
 * Fixed Window Rate Limiter
 * Simple counter that resets at fixed intervals
 */
export class FixedWindowRateLimiter extends BaseRateLimiter {
  #count = 0;
  #windowStart;
  #resetTimer;

  constructor(options = {}) {
    super(options);
    this.#windowStart = Date.now();
    
    // Auto-reset timer
    this.#resetTimer = setInterval(() => this.#reset(), this.windowMs);
  }

  #reset() {
    this.#count = 0;
    this.#windowStart = Date.now();
    this._emit('windowReset', { newWindowStart: this.#windowStart });
  }

  #checkWindow() {
    if (Date.now() - this.#windowStart >= this.windowMs) {
      this.#reset();
    }
  }

  /**
   * Try to acquire permit
   * @returns {boolean}
   */
  tryAcquire() {
    this.stats.totalRequests++;
    this.#checkWindow();
    
    if (this.#count < this.limit) {
      this.#count++;
      this.stats.allowedRequests++;
      this._emit('allowed', { 
        currentCount: this.#count,
        limit: this.limit
      });
      return true;
    }
    
    this.stats.rejectedRequests++;
    const retryAfter = this.#windowStart + this.windowMs - Date.now();
    this._emit('rejected', { 
      currentCount: this.#count,
      limit: this.limit,
      retryAfter
    });
    return false;
  }

  /**
   * Execute with rate limiting
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async execute(fn) {
    if (!this.tryAcquire()) {
      const retryAfter = this.#windowStart + this.windowMs - Date.now();
      throw new RateLimitError(
        `${this.name}: Rate limit exceeded`,
        Math.max(0, retryAfter)
      );
    }
    return fn();
  }

  get currentCount() {
    this.#checkWindow();
    return this.#count;
  }

  destroy() {
    clearInterval(this.#resetTimer);
  }
}

/**
 * Factory for creating rate limiters
 */
export const RateLimiterFactory = {
  create(algorithm, options = {}) {
    switch (algorithm) {
      case RateLimitAlgorithm.TOKEN_BUCKET:
        return new TokenBucketRateLimiter(options);
      case RateLimitAlgorithm.SLIDING_WINDOW:
        return new SlidingWindowRateLimiter(options);
      case RateLimitAlgorithm.FIXED_WINDOW:
        return new FixedWindowRateLimiter(options);
      case RateLimitAlgorithm.LEAKY_BUCKET:
        return new LeakyBucketRateLimiter(options);
      default:
        return new SlidingWindowRateLimiter(options);
    }
  },

  /**
   * Create rate limiter for API endpoints
   */
  forApi(overrides = {}) {
    return new SlidingWindowRateLimiter({
      limit: 100,
      windowMs: 60000,
      name: 'API',
      ...overrides
    });
  },

  /**
   * Create rate limiter for user actions
   */
  forUserActions(overrides = {}) {
    return new TokenBucketRateLimiter({
      capacity: 10,
      refillRate: 1,
      name: 'UserActions',
      ...overrides
    });
  },

  /**
   * Create rate limiter for steady throughput (leaky bucket)
   */
  forSteadyThroughput(overrides = {}) {
    return new LeakyBucketRateLimiter({
      capacity: 20,
      leakRate: 5,
      name: 'SteadyThroughput',
      ...overrides
    });
  }
};

export default RateLimiterFactory;
