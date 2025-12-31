/**
 * Bulkhead Pattern Implementation
 * 
 * Design Patterns Used:
 * - Bulkhead Pattern: Resource isolation
 * - Object Pool Pattern: Manage limited resources
 * - Observer Pattern: Event notifications
 * - Semaphore Pattern: Concurrency control
 * 
 * @module Bulkhead
 */

/**
 * @typedef {Object} BulkheadOptions
 * @property {number} maxConcurrent - Maximum concurrent executions
 * @property {number} maxQueueSize - Maximum queue size
 * @property {number} queueTimeout - Queue wait timeout in ms
 * @property {string} name - Bulkhead name for logging
 */

/**
 * Custom bulkhead error
 */
export class BulkheadError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'BulkheadError';
    this.code = code;
  }
}

/**
 * Bulkhead class for resource isolation
 */
export class Bulkhead {
  /** @type {Map<string, Function[]>} */
  #listeners = new Map();
  
  /** @type {number} */
  #activeCount = 0;
  
  /** @type {Array<{resolve: Function, reject: Function, timeoutId: NodeJS.Timeout}>} */
  #queue = [];

  /**
   * @param {BulkheadOptions} options
   */
  constructor(options = {}) {
    this.maxConcurrent = options.maxConcurrent ?? 10;
    this.maxQueueSize = options.maxQueueSize ?? 100;
    this.queueTimeout = options.queueTimeout ?? 30000;
    this.name = options.name ?? 'Bulkhead';
    
    // Validate options
    if (this.maxConcurrent < 1) {
      throw new Error('maxConcurrent must be at least 1');
    }
    if (this.maxQueueSize < 0) {
      throw new Error('maxQueueSize cannot be negative');
    }
    
    // Statistics
    this.stats = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      rejections: 0,
      queueTimeouts: 0,
      peakConcurrent: 0,
      peakQueueSize: 0
    };
  }

  /**
   * Get current active count
   * @returns {number}
   */
  get activeCount() {
    return this.#activeCount;
  }

  /**
   * Get current queue size
   * @returns {number}
   */
  get queueSize() {
    return this.#queue.length;
  }

  /**
   * Get available slots
   * @returns {number}
   */
  get availableSlots() {
    return this.maxConcurrent - this.#activeCount;
  }

  /**
   * Execute function with bulkhead protection
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async execute(fn) {
    this.stats.totalExecutions++;
    
    // Try to acquire slot
    if (this.#activeCount < this.maxConcurrent) {
      return this.#executeImmediate(fn);
    }
    
    // Check if queue is full
    if (this.#queue.length >= this.maxQueueSize) {
      this.stats.rejections++;
      this.#emit('rejected', { 
        reason: 'queue_full',
        queueSize: this.#queue.length,
        activeCount: this.#activeCount
      });
      throw new BulkheadError(
        `${this.name}: Queue is full (${this.maxQueueSize})`,
        'BULKHEAD_QUEUE_FULL'
      );
    }
    
    // Add to queue
    return this.#enqueue(fn);
  }

  /**
   * Execute immediately
   * @private
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async #executeImmediate(fn) {
    this.#activeCount++;
    
    // Track peak
    if (this.#activeCount > this.stats.peakConcurrent) {
      this.stats.peakConcurrent = this.#activeCount;
    }
    
    this.#emit('acquired', { 
      activeCount: this.#activeCount,
      queueSize: this.#queue.length
    });
    
    try {
      const result = await fn();
      this.stats.successfulExecutions++;
      this.#emit('success', { activeCount: this.#activeCount });
      return result;
    } catch (error) {
      this.stats.failedExecutions++;
      this.#emit('failure', { error, activeCount: this.#activeCount });
      throw error;
    } finally {
      this.#release();
    }
  }

  /**
   * Release slot and process queue
   * @private
   */
  #release() {
    this.#activeCount--;
    
    this.#emit('released', { 
      activeCount: this.#activeCount,
      queueSize: this.#queue.length
    });
    
    // Process next item in queue
    this.#processQueue();
  }

  /**
   * Process next queue item
   * @private
   */
  #processQueue() {
    if (this.#queue.length > 0 && this.#activeCount < this.maxConcurrent) {
      const item = this.#queue.shift();
      clearTimeout(item.timeoutId);
      
      this.#emit('dequeued', { 
        queueSize: this.#queue.length,
        activeCount: this.#activeCount
      });
      
      item.resolve();
    }
  }

  /**
   * Add to queue
   * @private
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async #enqueue(fn) {
    return new Promise((resolve, reject) => {
      const queueItem = {
        resolve: async () => {
          try {
            const result = await this.#executeImmediate(fn);
            resolve(result);
          } catch (error) {
            reject(error);
          }
        },
        reject,
        timeoutId: null
      };
      
      // Set queue timeout
      queueItem.timeoutId = setTimeout(() => {
        const index = this.#queue.indexOf(queueItem);
        if (index > -1) {
          this.#queue.splice(index, 1);
          this.stats.queueTimeouts++;
          this.#emit('queueTimeout', { 
            queueSize: this.#queue.length 
          });
          reject(new BulkheadError(
            `${this.name}: Queue wait timeout (${this.queueTimeout}ms)`,
            'BULKHEAD_QUEUE_TIMEOUT'
          ));
        }
      }, this.queueTimeout);
      
      this.#queue.push(queueItem);
      
      // Track peak queue size
      if (this.#queue.length > this.stats.peakQueueSize) {
        this.stats.peakQueueSize = this.#queue.length;
      }
      
      this.#emit('queued', { 
        queueSize: this.#queue.length,
        activeCount: this.#activeCount
      });
    });
  }

  /**
   * Drain the queue (reject all pending)
   */
  drain() {
    while (this.#queue.length > 0) {
      const item = this.#queue.shift();
      clearTimeout(item.timeoutId);
      item.reject(new BulkheadError(
        `${this.name}: Bulkhead drained`,
        'BULKHEAD_DRAINED'
      ));
    }
    this.#emit('drained', {});
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
        callback({ ...data, name: this.name });
      } catch (e) {
        console.error(`Error in bulkhead listener: ${e.message}`);
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
      activeCount: this.#activeCount,
      queueSize: this.#queue.length,
      availableSlots: this.availableSlots,
      utilization: ((this.#activeCount / this.maxConcurrent) * 100).toFixed(2) + '%'
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      rejections: 0,
      queueTimeouts: 0,
      peakConcurrent: 0,
      peakQueueSize: 0
    };
  }
}

export default Bulkhead;
