/**
 * Timeout Handler Implementation
 * 
 * Design Patterns Used:
 * - Decorator Pattern: Wraps operations with timeout
 * - Observer Pattern: Event notifications
 * 
 * @module Timeout
 */

/**
 * @typedef {Object} TimeoutOptions
 * @property {number} duration - Timeout duration in ms
 * @property {string} name - Operation name for logging
 */

/**
 * Custom timeout error class
 */
export class TimeoutError extends Error {
  /**
   * @param {string} message
   * @param {number} duration
   */
  constructor(message, duration) {
    super(message);
    this.name = 'TimeoutError';
    this.duration = duration;
    this.code = 'ETIMEDOUT';
  }
}

/**
 * TimeoutHandler class for managing operation timeouts
 */
export class TimeoutHandler {
  /** @type {Map<string, Function[]>} */
  #listeners = new Map();

  /**
   * @param {TimeoutOptions} options
   */
  constructor(options = {}) {
    this.duration = options.duration ?? 5000;
    this.name = options.name ?? 'Operation';
    
    // Statistics
    this.stats = {
      totalCalls: 0,
      successfulCalls: 0,
      timeouts: 0
    };
  }

  /**
   * Execute function with timeout
   * @template T
   * @param {() => Promise<T>} fn - Async function to execute
   * @param {number} [customDuration] - Override default duration
   * @returns {Promise<T>}
   */
  async execute(fn, customDuration) {
    const timeout = customDuration ?? this.duration;
    this.stats.totalCalls++;
    
    const startTime = Date.now();
    
    // Create abort controller for cleanup
    const abortController = new AbortController();
    
    const timeoutPromise = new Promise((_, reject) => {
      const timeoutId = setTimeout(() => {
        this.stats.timeouts++;
        const error = new TimeoutError(
          `${this.name} timed out after ${timeout}ms`,
          timeout
        );
        this.#emit('timeout', { 
          duration: timeout, 
          name: this.name,
          elapsed: Date.now() - startTime 
        });
        reject(error);
      }, timeout);
      
      // Cleanup timeout on abort
      abortController.signal.addEventListener('abort', () => {
        clearTimeout(timeoutId);
      });
    });

    try {
      const result = await Promise.race([fn(), timeoutPromise]);
      
      // Abort the timeout
      abortController.abort();
      
      this.stats.successfulCalls++;
      this.#emit('success', { 
        duration: Date.now() - startTime,
        name: this.name 
      });
      
      return result;
    } catch (error) {
      // Abort the timeout if it wasn't a timeout error
      abortController.abort();
      throw error;
    }
  }

  /**
   * Static method for one-off timeout wrapping
   * @template T
   * @param {Promise<T>} promise
   * @param {number} duration
   * @param {string} [name]
   * @returns {Promise<T>}
   */
  static withTimeout(promise, duration, name = 'Operation') {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new TimeoutError(`${name} timed out after ${duration}ms`, duration));
      }, duration);

      promise
        .then(result => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * Register event listener
   * @param {string} event
   * @param {Function} callback
   * @returns {() => void}
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
        console.error(`Error in timeout handler listener: ${e.message}`);
      }
    });
  }

  /**
   * Get statistics
   * @returns {Object}
   */
  getStats() {
    return {
      ...this.stats,
      timeoutRate: this.stats.totalCalls > 0 
        ? ((this.stats.timeouts / this.stats.totalCalls) * 100).toFixed(2) + '%'
        : '0%'
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      totalCalls: 0,
      successfulCalls: 0,
      timeouts: 0
    };
  }
}

export default TimeoutHandler;
