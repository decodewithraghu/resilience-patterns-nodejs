/**
 * Circuit Breaker Pattern Implementation
 * 
 * Design Patterns Used:
 * - State Pattern: Manages CLOSED, OPEN, HALF_OPEN states
 * - Observer Pattern: Event-driven state change notifications
 * - Strategy Pattern: Configurable failure detection
 * 
 * @module CircuitBreaker
 */

// Circuit states as constants (Flyweight Pattern)
export const CircuitState = Object.freeze({
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN'
});

/**
 * @typedef {Object} CircuitBreakerOptions
 * @property {number} failureThreshold - Number of failures before opening
 * @property {number} successThreshold - Successes needed to close from half-open
 * @property {number} timeout - Time in ms before trying half-open
 * @property {number} resetTimeout - Time window for failure counting
 */

/**
 * CircuitBreaker class implementing the Circuit Breaker pattern
 * Prevents cascading failures by failing fast when a service is unavailable
 */
export class CircuitBreaker {
  /** @type {Map<string, Function[]>} */
  #listeners = new Map();
  
  /** @type {CircuitState} */
  #state = CircuitState.CLOSED;
  
  /** @type {number} */
  #failureCount = 0;
  
  /** @type {number} */
  #successCount = 0;
  
  /** @type {number|null} */
  #lastFailureTime = null;
  
  /** @type {number|null} */
  #nextAttemptTime = null;

  /**
   * @param {CircuitBreakerOptions} options
   */
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.successThreshold = options.successThreshold ?? 2;
    this.timeout = options.timeout ?? 30000;
    this.resetTimeout = options.resetTimeout ?? 60000;
    
    // Statistics for monitoring
    this.stats = {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      rejectedCalls: 0,
      lastFailure: null,
      lastSuccess: null
    };
  }

  /**
   * Get current circuit state
   * @returns {CircuitState}
   */
  get state() {
    return this.#state;
  }

  /**
   * Check if circuit is open
   * @returns {boolean}
   */
  get isOpen() {
    return this.#state === CircuitState.OPEN;
  }

  /**
   * Check if circuit is closed
   * @returns {boolean}
   */
  get isClosed() {
    return this.#state === CircuitState.CLOSED;
  }

  /**
   * Execute a function through the circuit breaker
   * @template T
   * @param {() => Promise<T>} fn - Async function to execute
   * @returns {Promise<T>}
   * @throws {Error} If circuit is open
   */
  async execute(fn) {
    this.stats.totalCalls++;
    
    // Check if we should transition from OPEN to HALF_OPEN
    if (this.#state === CircuitState.OPEN) {
      if (Date.now() >= this.#nextAttemptTime) {
        this.#transitionTo(CircuitState.HALF_OPEN);
      } else {
        this.stats.rejectedCalls++;
        this.#emit('reject', { state: this.#state });
        throw new Error('Circuit breaker is OPEN');
      }
    }

    try {
      const result = await fn();
      this.#onSuccess();
      return result;
    } catch (error) {
      this.#onFailure(error);
      throw error;
    }
  }

  /**
   * Handle successful execution
   * @private
   */
  #onSuccess() {
    this.stats.successfulCalls++;
    this.stats.lastSuccess = Date.now();
    
    if (this.#state === CircuitState.HALF_OPEN) {
      this.#successCount++;
      if (this.#successCount >= this.successThreshold) {
        this.#transitionTo(CircuitState.CLOSED);
      }
    }
    
    this.#emit('success', { state: this.#state });
  }

  /**
   * Handle failed execution
   * @private
   * @param {Error} error
   */
  #onFailure(error) {
    this.stats.failedCalls++;
    this.stats.lastFailure = Date.now();
    this.#lastFailureTime = Date.now();
    
    if (this.#state === CircuitState.HALF_OPEN) {
      this.#transitionTo(CircuitState.OPEN);
    } else if (this.#state === CircuitState.CLOSED) {
      this.#failureCount++;
      if (this.#failureCount >= this.failureThreshold) {
        this.#transitionTo(CircuitState.OPEN);
      }
    }
    
    this.#emit('failure', { error, state: this.#state });
  }

  /**
   * Transition to a new state
   * @private
   * @param {CircuitState} newState
   */
  #transitionTo(newState) {
    const oldState = this.#state;
    this.#state = newState;
    
    switch (newState) {
      case CircuitState.OPEN:
        this.#nextAttemptTime = Date.now() + this.timeout;
        this.#emit('open', { previousState: oldState });
        break;
      case CircuitState.HALF_OPEN:
        this.#successCount = 0;
        this.#emit('halfOpen', { previousState: oldState });
        break;
      case CircuitState.CLOSED:
        this.#failureCount = 0;
        this.#successCount = 0;
        this.#emit('close', { previousState: oldState });
        break;
    }
    
    this.#emit('stateChange', { from: oldState, to: newState });
  }

  /**
   * Register event listener (Observer Pattern)
   * @param {string} event
   * @param {Function} callback
   * @returns {() => void} Unsubscribe function
   */
  on(event, callback) {
    if (!this.#listeners.has(event)) {
      this.#listeners.set(event, []);
    }
    this.#listeners.get(event).push(callback);
    
    // Return unsubscribe function
    return () => {
      const listeners = this.#listeners.get(event);
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    };
  }

  /**
   * Emit event to listeners
   * @private
   * @param {string} event
   * @param {Object} data
   */
  #emit(event, data) {
    const listeners = this.#listeners.get(event) || [];
    listeners.forEach(callback => {
      try {
        callback(data);
      } catch (e) {
        console.error(`Error in circuit breaker listener: ${e.message}`);
      }
    });
  }

  /**
   * Manually reset the circuit breaker
   */
  reset() {
    this.#failureCount = 0;
    this.#successCount = 0;
    this.#transitionTo(CircuitState.CLOSED);
  }

  /**
   * Get circuit breaker statistics
   * @returns {Object}
   */
  getStats() {
    return {
      ...this.stats,
      state: this.#state,
      failureCount: this.#failureCount,
      successCount: this.#successCount
    };
  }
}

export default CircuitBreaker;
