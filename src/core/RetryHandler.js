/**
 * Retry Handler with Exponential Backoff
 * 
 * Design Patterns Used:
 * - Strategy Pattern: Configurable backoff strategies
 * - Template Method: Execute with customizable hooks
 * - Observer Pattern: Event notifications
 * 
 * @module RetryHandler
 */

/**
 * Backoff strategies
 */
export const BackoffStrategy = Object.freeze({
  EXPONENTIAL: 'exponential',
  LINEAR: 'linear',
  CONSTANT: 'constant',
  DECORRELATED_JITTER: 'decorrelated_jitter'
});

/**
 * @typedef {Object} RetryOptions
 * @property {number} maxAttempts - Maximum retry attempts
 * @property {number} baseDelay - Initial delay in ms
 * @property {number} maxDelay - Maximum delay cap in ms
 * @property {number} multiplier - Backoff multiplier
 * @property {boolean} jitter - Add randomness to delays
 * @property {BackoffStrategy} strategy - Backoff strategy
 * @property {(error: Error) => boolean} retryCondition - Custom retry condition
 */

/**
 * RetryHandler class implementing retry with backoff
 */
export class RetryHandler {
  /** @type {Map<string, Function[]>} */
  #listeners = new Map();

  /**
   * @param {RetryOptions} options
   */
  constructor(options = {}) {
    this.maxAttempts = options.maxAttempts ?? 3;
    this.baseDelay = options.baseDelay ?? 1000;
    this.maxDelay = options.maxDelay ?? 30000;
    this.multiplier = options.multiplier ?? 2;
    this.jitter = options.jitter ?? true;
    this.strategy = options.strategy ?? BackoffStrategy.EXPONENTIAL;
    this.retryCondition = options.retryCondition ?? (() => true);
    
    // Statistics
    this.stats = {
      totalAttempts: 0,
      successfulAttempts: 0,
      failedAttempts: 0,
      totalRetries: 0
    };
  }

  /**
   * Execute function with retry logic
   * @template T
   * @param {() => Promise<T>} fn - Function to execute
   * @param {Object} context - Optional context for logging
   * @returns {Promise<T>}
   */
  async execute(fn, context = {}) {
    let lastError;
    let attempt = 0;
    
    while (attempt < this.maxAttempts) {
      attempt++;
      this.stats.totalAttempts++;
      
      try {
        this.#emit('attempt', { attempt, maxAttempts: this.maxAttempts, context });
        const result = await fn();
        this.stats.successfulAttempts++;
        this.#emit('success', { attempt, result, context });
        return result;
      } catch (error) {
        lastError = error;
        this.stats.failedAttempts++;
        
        // Check if we should retry
        const shouldRetry = attempt < this.maxAttempts && this.retryCondition(error);
        
        this.#emit('failure', { 
          attempt, 
          error, 
          willRetry: shouldRetry,
          context 
        });
        
        if (!shouldRetry) {
          break;
        }
        
        // Calculate and wait for delay
        const delay = this.#calculateDelay(attempt);
        this.stats.totalRetries++;
        
        this.#emit('retry', { 
          attempt, 
          nextAttempt: attempt + 1, 
          delay,
          context 
        });
        
        await this.#sleep(delay);
      }
    }
    
    this.#emit('exhausted', { 
      totalAttempts: attempt, 
      error: lastError,
      context 
    });
    
    throw lastError;
  }

  /**
   * Calculate delay based on strategy
   * @private
   * @param {number} attempt - Current attempt number
   * @returns {number} Delay in ms
   */
  #calculateDelay(attempt) {
    let delay;
    
    switch (this.strategy) {
      case BackoffStrategy.LINEAR:
        delay = this.baseDelay * attempt;
        break;
      case BackoffStrategy.CONSTANT:
        delay = this.baseDelay;
        break;
      case BackoffStrategy.DECORRELATED_JITTER:
        // AWS-style decorrelated jitter
        delay = Math.min(
          this.maxDelay,
          Math.random() * (this.baseDelay * Math.pow(2, attempt) - this.baseDelay) + this.baseDelay
        );
        break;
      case BackoffStrategy.EXPONENTIAL:
      default:
        delay = this.baseDelay * Math.pow(this.multiplier, attempt - 1);
        break;
    }
    
    // Apply jitter to prevent thundering herd
    if (this.jitter && this.strategy !== BackoffStrategy.DECORRELATED_JITTER) {
      delay = delay * (0.5 + Math.random() * 0.5);
    }
    
    // Cap at maxDelay
    return Math.min(Math.floor(delay), this.maxDelay);
  }

  /**
   * Sleep for specified duration
   * @private
   * @param {number} ms
   * @returns {Promise<void>}
   */
  #sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Register event listener
   * @param {string} event
   * @param {Function} callback
   * @returns {() => void} Unsubscribe function
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
        console.error(`Error in retry handler listener: ${e.message}`);
      }
    });
  }

  /**
   * Get statistics
   * @returns {Object}
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      totalAttempts: 0,
      successfulAttempts: 0,
      failedAttempts: 0,
      totalRetries: 0
    };
  }
}

/**
 * Factory function to create retry handler with common configurations
 */
export const RetryHandlerFactory = {
  /**
   * Create handler for network operations
   */
  forNetwork(overrides = {}) {
    return new RetryHandler({
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 10000,
      strategy: BackoffStrategy.EXPONENTIAL,
      jitter: true,
      retryCondition: (error) => {
        // Retry on network errors
        const retryableCodes = ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EHOSTUNREACH'];
        return retryableCodes.some(code => error.code === code || error.message?.includes(code));
      },
      ...overrides
    });
  },

  /**
   * Create handler for database operations
   */
  forDatabase(overrides = {}) {
    return new RetryHandler({
      maxAttempts: 5,
      baseDelay: 500,
      maxDelay: 5000,
      strategy: BackoffStrategy.DECORRELATED_JITTER,
      ...overrides
    });
  },

  /**
   * Create handler for idempotent operations
   */
  forIdempotent(overrides = {}) {
    return new RetryHandler({
      maxAttempts: 5,
      baseDelay: 2000,
      maxDelay: 30000,
      strategy: BackoffStrategy.EXPONENTIAL,
      jitter: true,
      ...overrides
    });
  }
};

export default RetryHandler;
