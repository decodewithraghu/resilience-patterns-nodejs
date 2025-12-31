/**
 * Fallback Handler Implementation
 * 
 * Design Patterns Used:
 * - Chain of Responsibility: Cascading fallbacks
 * - Strategy Pattern: Different fallback strategies
 * - Observer Pattern: Event notifications
 * 
 * @module Fallback
 */

/**
 * @typedef {Object} FallbackOptions
 * @property {string} name - Fallback handler name
 * @property {boolean} logFailures - Whether to log primary failures
 */

/**
 * FallbackHandler class for graceful degradation
 */
export class FallbackHandler {
  /** @type {Map<string, Function[]>} */
  #listeners = new Map();

  /**
   * @param {FallbackOptions} options
   */
  constructor(options = {}) {
    this.name = options.name ?? 'Fallback';
    this.logFailures = options.logFailures ?? true;
    
    // Statistics
    this.stats = {
      totalCalls: 0,
      primarySuccesses: 0,
      fallbacksUsed: 0,
      totalFailures: 0
    };
  }

  /**
   * Execute with single fallback
   * @template T
   * @param {() => Promise<T>} primaryFn
   * @param {(error: Error) => Promise<T>} fallbackFn
   * @returns {Promise<T>}
   */
  async execute(primaryFn, fallbackFn) {
    this.stats.totalCalls++;
    
    try {
      const result = await primaryFn();
      this.stats.primarySuccesses++;
      this.#emit('primarySuccess', { result });
      return result;
    } catch (primaryError) {
      this.#emit('primaryFailure', { error: primaryError });
      
      try {
        const fallbackResult = await fallbackFn(primaryError);
        this.stats.fallbacksUsed++;
        this.#emit('fallbackSuccess', { 
          result: fallbackResult, 
          primaryError 
        });
        return fallbackResult;
      } catch (fallbackError) {
        this.stats.totalFailures++;
        this.#emit('fallbackFailure', { 
          primaryError, 
          fallbackError 
        });
        throw fallbackError;
      }
    }
  }

  /**
   * Execute with cascading fallbacks (Chain of Responsibility)
   * @template T
   * @param {Array<{name: string, fn: () => Promise<T>}>} strategies
   * @returns {Promise<{result: T, strategyUsed: string, errors: Array}>}
   */
  async executeWithCascade(strategies) {
    if (!strategies || strategies.length === 0) {
      throw new Error('At least one strategy is required');
    }
    
    this.stats.totalCalls++;
    const errors = [];
    
    for (let i = 0; i < strategies.length; i++) {
      const strategy = strategies[i];
      
      try {
        this.#emit('strategyAttempt', { 
          index: i, 
          name: strategy.name,
          isLast: i === strategies.length - 1 
        });
        
        const result = await strategy.fn();
        
        if (i === 0) {
          this.stats.primarySuccesses++;
        } else {
          this.stats.fallbacksUsed++;
        }
        
        this.#emit('strategySuccess', { 
          index: i, 
          name: strategy.name, 
          result,
          errors 
        });
        
        return { 
          result, 
          strategyUsed: strategy.name, 
          strategyIndex: i,
          errors 
        };
      } catch (error) {
        errors.push({ strategy: strategy.name, error: error.message });
        this.#emit('strategyFailure', { 
          index: i, 
          name: strategy.name, 
          error 
        });
      }
    }
    
    this.stats.totalFailures++;
    const error = new Error(`All ${strategies.length} strategies failed`);
    error.errors = errors;
    throw error;
  }

  /**
   * Create a cached fallback
   * @template T
   * @param {() => Promise<T>} primaryFn
   * @param {T} cachedValue
   * @param {Object} options
   * @returns {Promise<T>}
   */
  async executeWithCache(primaryFn, cachedValue, options = {}) {
    const { maxAge = Infinity, onStale } = options;
    
    return this.execute(
      primaryFn,
      async (error) => {
        if (cachedValue !== undefined) {
          this.#emit('cacheUsed', { cachedValue, error });
          if (onStale) onStale(cachedValue, error);
          return cachedValue;
        }
        throw error;
      }
    );
  }

  /**
   * Create a default value fallback
   * @template T
   * @param {() => Promise<T>} primaryFn
   * @param {T} defaultValue
   * @returns {Promise<T>}
   */
  async executeWithDefault(primaryFn, defaultValue) {
    return this.execute(
      primaryFn,
      async () => {
        this.#emit('defaultUsed', { defaultValue });
        return defaultValue;
      }
    );
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
        console.error(`Error in fallback handler listener: ${e.message}`);
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
      fallbackRate: this.stats.totalCalls > 0
        ? ((this.stats.fallbacksUsed / this.stats.totalCalls) * 100).toFixed(2) + '%'
        : '0%'
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      totalCalls: 0,
      primarySuccesses: 0,
      fallbacksUsed: 0,
      totalFailures: 0
    };
  }
}

export default FallbackHandler;
