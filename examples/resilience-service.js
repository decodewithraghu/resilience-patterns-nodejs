// ============================================
// RESILIENCE SERVICE - Composition Pattern
// ============================================

/**
 * Enterprise-grade Resilience Service that composes multiple patterns
 * Implements: Circuit Breaker, Retry, Timeout, Fallback, Bulkhead, and Rate Limiting
 */

import CircuitBreaker from 'opossum';

console.log('🏢 Enterprise Resilience Service - Composition Pattern\n');
console.log('Demonstrates how to combine multiple resilience patterns\n');

// ============================================
// Composable Resilience Service
// ============================================

class ResilienceService {
  constructor(options = {}) {
    this.serviceName = options.serviceName || 'Service';
    this.config = {
      // Circuit Breaker
      circuitBreaker: {
        enabled: options.circuitBreaker?.enabled !== false,
        timeout: options.circuitBreaker?.timeout || 3000,
        errorThresholdPercentage: options.circuitBreaker?.errorThresholdPercentage || 50,
        resetTimeout: options.circuitBreaker?.resetTimeout || 5000,
        volumeThreshold: options.circuitBreaker?.volumeThreshold || 10,
      },
      // Retry
      retry: {
        enabled: options.retry?.enabled !== false,
        maxAttempts: options.retry?.maxAttempts || 3,
        backoffMultiplier: options.retry?.backoffMultiplier || 2,
        initialDelay: options.retry?.initialDelay || 1000,
        maxDelay: options.retry?.maxDelay || 10000,
      },
      // Timeout
      timeout: {
        enabled: options.timeout?.enabled !== false,
        duration: options.timeout?.duration || 5000,
      },
      // Bulkhead
      bulkhead: {
        enabled: options.bulkhead?.enabled !== false,
        maxConcurrent: options.bulkhead?.maxConcurrent || 10,
        maxQueueSize: options.bulkhead?.maxQueueSize || 100,
      },
      // Rate Limiting
      rateLimit: {
        enabled: options.rateLimit?.enabled !== false,
        maxRequests: options.rateLimit?.maxRequests || 100,
        windowMs: options.rateLimit?.windowMs || 60000,
      },
      // Fallback
      fallback: options.fallback || null,
      // Monitoring
      monitoring: {
        enabled: options.monitoring?.enabled !== false,
        logLevel: options.monitoring?.logLevel || 'info',
      }
    };
    
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      retriedRequests: 0,
      timeouts: 0,
      circuitBreakerTrips: 0,
      fallbacksUsed: 0,
      rateLimitRejections: 0,
      bulkheadRejections: 0,
    };
    
    this.activeTasks = 0;
    this.taskQueue = [];
    this.rateLimitWindow = [];
    
    this.breaker = this._createCircuitBreaker();
  }

  _createCircuitBreaker() {
    if (!this.config.circuitBreaker.enabled) return null;
    
    const breaker = new CircuitBreaker(
      async (fn) => await fn(),
      {
        timeout: this.config.circuitBreaker.timeout,
        errorThresholdPercentage: this.config.circuitBreaker.errorThresholdPercentage,
        resetTimeout: this.config.circuitBreaker.resetTimeout,
        volumeThreshold: this.config.circuitBreaker.volumeThreshold,
        name: this.serviceName,
      }
    );
    
    breaker.on('open', () => {
      this.stats.circuitBreakerTrips++;
      this._log('warn', '⚠️  Circuit breaker opened');
    });
    
    breaker.on('halfOpen', () => {
      this._log('info', '🔄 Circuit breaker half-open');
    });
    
    breaker.on('close', () => {
      this._log('info', '✅ Circuit breaker closed');
    });
    
    return breaker;
  }

  async execute(fn, context = {}) {
    this.stats.totalRequests++;
    const startTime = Date.now();
    
    this._log('debug', `📡 Request started: ${context.operationName || 'Operation'}`);
    
    try {
      // 1. Check rate limit
      if (this.config.rateLimit.enabled && !this._checkRateLimit()) {
        this.stats.rateLimitRejections++;
        throw new Error('Rate limit exceeded');
      }
      
      // 2. Check bulkhead (concurrency limit)
      await this._acquireBulkhead();
      
      try {
        // 3. Apply retry logic
        const result = await this._executeWithRetry(async () => {
          // 4. Apply timeout
          const operation = this.config.timeout.enabled
            ? this._executeWithTimeout(fn)
            : fn();
          
          // 5. Execute with circuit breaker
          return this.config.circuitBreaker.enabled
            ? await this.breaker.fire(async () => await operation)
            : await operation;
        });
        
        this.stats.successfulRequests++;
        const duration = Date.now() - startTime;
        this._log('info', `✅ Request completed in ${duration}ms`);
        
        return result;
      } finally {
        this._releaseBulkhead();
      }
    } catch (error) {
      this.stats.failedRequests++;
      this._log('error', `❌ Request failed: ${error.message}`);
      
      // 6. Try fallback if available
      if (this.config.fallback) {
        this.stats.fallbacksUsed++;
        this._log('warn', '🔀 Using fallback');
        return await this.config.fallback(error, context);
      }
      
      throw error;
    }
  }

  async _executeWithRetry(fn) {
    if (!this.config.retry.enabled) {
      return await fn();
    }
    
    let lastError;
    const { maxAttempts, backoffMultiplier, initialDelay, maxDelay } = this.config.retry;
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        if (attempt > 0) {
          this.stats.retriedRequests++;
          this._log('warn', `🔄 Retry attempt ${attempt + 1}/${maxAttempts}`);
        }
        return await fn();
      } catch (error) {
        lastError = error;
        
        if (attempt < maxAttempts - 1) {
          const delay = Math.min(
            initialDelay * Math.pow(backoffMultiplier, attempt),
            maxDelay
          );
          this._log('debug', `⏳ Waiting ${delay}ms before retry`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError;
  }

  async _executeWithTimeout(fn) {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        this.stats.timeouts++;
        reject(new Error(`Operation timed out after ${this.config.timeout.duration}ms`));
      }, this.config.timeout.duration);
    });
    
    return Promise.race([fn(), timeoutPromise]);
  }

  _checkRateLimit() {
    if (!this.config.rateLimit.enabled) return true;
    
    const now = Date.now();
    const cutoff = now - this.config.rateLimit.windowMs;
    
    // Clean old entries
    this.rateLimitWindow = this.rateLimitWindow.filter(timestamp => timestamp > cutoff);
    
    if (this.rateLimitWindow.length >= this.config.rateLimit.maxRequests) {
      this._log('warn', '🚫 Rate limit exceeded');
      return false;
    }
    
    this.rateLimitWindow.push(now);
    return true;
  }

  async _acquireBulkhead() {
    if (!this.config.bulkhead.enabled) return;
    
    if (this.activeTasks >= this.config.bulkhead.maxConcurrent) {
      if (this.taskQueue.length >= this.config.bulkhead.maxQueueSize) {
        this.stats.bulkheadRejections++;
        throw new Error('Bulkhead queue full');
      }
      
      this._log('debug', `⏸️  Queued (${this.taskQueue.length + 1}/${this.config.bulkhead.maxQueueSize})`);
      
      await new Promise((resolve) => {
        this.taskQueue.push(resolve);
      });
    }
    
    this.activeTasks++;
  }

  _releaseBulkhead() {
    if (!this.config.bulkhead.enabled) return;
    
    this.activeTasks--;
    
    if (this.taskQueue.length > 0) {
      const resolve = this.taskQueue.shift();
      resolve();
    }
  }

  _log(level, message) {
    if (!this.config.monitoring.enabled) return;
    
    const levels = { debug: 0, info: 1, warn: 2, error: 3 };
    const configLevel = levels[this.config.monitoring.logLevel] || 1;
    const messageLevel = levels[level] || 1;
    
    if (messageLevel >= configLevel) {
      console.log(`   [${this.serviceName}] ${message}`);
    }
  }

  getStats() {
    return {
      ...this.stats,
      successRate: this.stats.totalRequests > 0
        ? ((this.stats.successfulRequests / this.stats.totalRequests) * 100).toFixed(2) + '%'
        : '0%',
      circuitBreakerState: this.breaker
        ? (this.breaker.opened ? 'OPEN' : this.breaker.halfOpen ? 'HALF-OPEN' : 'CLOSED')
        : 'N/A',
      activeTasks: this.activeTasks,
      queuedTasks: this.taskQueue.length,
    };
  }

  getHealth() {
    const stats = this.getStats();
    const successRate = parseFloat(stats.successRate);
    
    return {
      status: successRate >= 95 ? 'healthy' : successRate >= 80 ? 'degraded' : 'unhealthy',
      stats,
      timestamp: new Date().toISOString(),
    };
  }
}

// ============================================
// Test Scenarios
// ============================================

async function scenario1() {
  console.log('📌 Scenario 1: E-commerce checkout service with full resilience');
  console.log('════════════════════════════════════════════════════════════════\n');
  
  const checkoutService = new ResilienceService({
    serviceName: 'Checkout-Service',
    circuitBreaker: {
      enabled: true,
      timeout: 2000,
      errorThresholdPercentage: 50,
      resetTimeout: 5000,
    },
    retry: {
      enabled: true,
      maxAttempts: 3,
      initialDelay: 500,
    },
    timeout: {
      enabled: true,
      duration: 3000,
    },
    bulkhead: {
      enabled: true,
      maxConcurrent: 5,
      maxQueueSize: 10,
    },
    rateLimit: {
      enabled: true,
      maxRequests: 20,
      windowMs: 10000,
    },
    fallback: async (error, context) => {
      return {
        orderId: 'PENDING-' + Date.now(),
        status: 'queued',
        message: 'Order queued for processing',
        fallback: true,
      };
    },
    monitoring: {
      enabled: true,
      logLevel: 'info',
    },
  });
  
  async function processCheckout(orderId) {
    // Simulate varying success rates
    const shouldFail = Math.random() > 0.7;
    const isSlowResponse = Math.random() > 0.8;
    
    if (isSlowResponse) {
      await new Promise(resolve => setTimeout(resolve, 4000)); // Will timeout
    } else {
      await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 800));
    }
    
    if (shouldFail) {
      throw new Error('Payment gateway error');
    }
    
    return {
      orderId,
      status: 'completed',
      amount: 99.99,
      timestamp: Date.now(),
    };
  }
  
  // Process 20 checkout requests
  const checkouts = [];
  for (let i = 1; i <= 20; i++) {
    checkouts.push(
      checkoutService.execute(
        () => processCheckout(`ORDER-${1000 + i}`),
        { operationName: `Checkout-${i}` }
      ).catch(error => ({
        error: error.message,
        orderId: `ORDER-${1000 + i}`,
      }))
    );
    
    // Stagger requests slightly
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  const results = await Promise.all(checkouts);
  
  console.log('\n   📊 Results Summary:');
  const successful = results.filter(r => !r.error && !r.fallback).length;
  const fallbacks = results.filter(r => r.fallback).length;
  const failed = results.filter(r => r.error).length;
  
  console.log(`   ✅ Successful: ${successful}`);
  console.log(`   🔀 Fallback: ${fallbacks}`);
  console.log(`   ❌ Failed: ${failed}`);
  
  console.log('\n   📈 Service Stats:');
  const stats = checkoutService.getStats();
  Object.entries(stats).forEach(([key, value]) => {
    console.log(`   - ${key}: ${value}`);
  });
  
  console.log('\n   🏥 Health Check:');
  const health = checkoutService.getHealth();
  console.log(`   Status: ${health.status.toUpperCase()}`);
  console.log(`   Success Rate: ${health.stats.successRate}`);
  console.log();
}

async function scenario2() {
  console.log('📌 Scenario 2: Microservice with selective pattern usage');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  const microservice = new ResilienceService({
    serviceName: 'Data-Service',
    circuitBreaker: {
      enabled: true,
      errorThresholdPercentage: 75, // Allow more failures before opening
      resetTimeout: 5000,
      volumeThreshold: 5, // Require at least 5 requests before opening
    },
    retry: {
      enabled: true,
      maxAttempts: 3,
    },
    timeout: {
      enabled: false, // No timeout needed
    },
    bulkhead: {
      enabled: true,
      maxConcurrent: 3,
    },
    rateLimit: {
      enabled: false, // No rate limiting
    },
    monitoring: {
      logLevel: 'info',
    },
  });
  
  let callCount = 0;
  async function fetchData(id) {
    callCount++;
    // Fail first 2 calls, then succeed
    if (callCount <= 2) {
      throw new Error('Temporary database connection issue');
    }
    return { id, data: 'Retrieved data', timestamp: Date.now() };
  }
  
  try {
    const result = await microservice.execute(
      () => fetchData(123),
      { operationName: 'FetchData' }
    );
    console.log(`   📦 Result: ${JSON.stringify(result)}\n`);
  } catch (error) {
    console.log(`   ❌ Failed: ${error.message}\n`);
  }
  
  console.log('   📈 Service Stats:');
  const stats = microservice.getStats();
  Object.entries(stats).forEach(([key, value]) => {
    console.log(`   - ${key}: ${value}`);
  });
  console.log();
}

// ============================================
// Run All Scenarios
// ============================================

async function runAllScenarios() {
  console.log('Starting enterprise resilience service demonstrations...\n');
  
  await scenario1();
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  await scenario2();
  
  console.log('✨ All scenarios completed!\n');
}

runAllScenarios().catch(console.error);
