/**
 * Integration Tests - Resilience Patterns Working Together
 * 
 * Tests that verify patterns work correctly when combined
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  CircuitBreaker,
  RetryHandler,
  TimeoutHandler,
  FallbackHandler,
  Bulkhead,
  TokenBucketRateLimiter
} from '../src/core/index.js';

describe('Integration Tests', () => {
  
  describe('Circuit Breaker + Retry', () => {
    it('should retry until circuit opens', async () => {
      const circuitBreaker = new CircuitBreaker({
        failureThreshold: 3,
        timeout: 1000
      });
      
      const retryHandler = new RetryHandler({
        maxAttempts: 5,
        baseDelay: 10,
        jitter: false
      });
      
      let attempts = 0;
      
      try {
        await retryHandler.execute(async () => {
          attempts++;
          await circuitBreaker.execute(async () => {
            throw new Error('Service unavailable');
          });
        });
      } catch (error) {
        // Expected to fail
      }
      
      // Should have stopped at circuit breaker opening (3 failures)
      // plus the circuit already open rejection
      assert.ok(circuitBreaker.isOpen);
      assert.ok(attempts >= 3);
    });
  });
  
  describe('Timeout + Fallback', () => {
    it('should fallback on timeout', async () => {
      const timeout = new TimeoutHandler({ duration: 50 });
      const fallback = new FallbackHandler();
      
      const result = await fallback.execute(
        async () => {
          return await timeout.execute(async () => {
            await new Promise(resolve => setTimeout(resolve, 200));
            return 'slow response';
          });
        },
        async () => 'cached response'
      );
      
      assert.strictEqual(result, 'cached response');
    });
    
    it('should use primary when fast enough', async () => {
      const timeout = new TimeoutHandler({ duration: 200 });
      const fallback = new FallbackHandler();
      
      const result = await fallback.execute(
        async () => {
          return await timeout.execute(async () => {
            await new Promise(resolve => setTimeout(resolve, 50));
            return 'fast response';
          });
        },
        async () => 'cached response'
      );
      
      assert.strictEqual(result, 'fast response');
    });
  });
  
  describe('Bulkhead + Rate Limiter', () => {
    it('should limit both concurrency and rate', async () => {
      const bulkhead = new Bulkhead({
        maxConcurrent: 2,
        maxQueueSize: 5
      });
      
      const rateLimiter = new TokenBucketRateLimiter({
        capacity: 5,
        refillRate: 1,
        refillInterval: 1000
      });
      
      const results = [];
      const errors = [];
      
      // Execute 10 requests
      const promises = Array(10).fill(null).map(async (_, i) => {
        try {
          // First check rate limit
          if (!rateLimiter.tryConsume()) {
            errors.push(`Rate limited: ${i}`);
            return;
          }
          
          // Then check bulkhead
          const result = await bulkhead.execute(async () => {
            await new Promise(resolve => setTimeout(resolve, 50));
            return `completed: ${i}`;
          });
          
          results.push(result);
        } catch (error) {
          errors.push(`Error: ${error.message}`);
        }
      });
      
      await Promise.all(promises);
      
      // Should have some completed and some rate limited
      assert.ok(results.length > 0);
      assert.ok(errors.length > 0);
      
      rateLimiter.destroy();
    });
  });
  
  describe('Full Resilience Stack', () => {
    it('should chain all patterns together', async () => {
      // Create all patterns
      const rateLimiter = new TokenBucketRateLimiter({
        capacity: 10,
        refillRate: 10
      });
      
      const bulkhead = new Bulkhead({
        maxConcurrent: 3,
        maxQueueSize: 10
      });
      
      const timeout = new TimeoutHandler({ duration: 500 });
      
      const circuitBreaker = new CircuitBreaker({
        failureThreshold: 3,
        timeout: 1000
      });
      
      const retryHandler = new RetryHandler({
        maxAttempts: 2,
        baseDelay: 50,
        jitter: false
      });
      
      const fallback = new FallbackHandler();
      
      // Chain them together
      async function resilientCall(operation, fallbackValue) {
        // Rate limit first
        if (!rateLimiter.tryConsume()) {
          return fallbackValue;
        }
        
        // Fallback wrapper
        return fallback.execute(
          async () => {
            // Retry with circuit breaker and timeout
            return retryHandler.execute(async () => {
              return circuitBreaker.execute(async () => {
                return bulkhead.execute(async () => {
                  return timeout.execute(operation);
                });
              });
            });
          },
          async () => fallbackValue
        );
      }
      
      // Test successful call
      const success = await resilientCall(
        async () => 'primary data',
        'fallback data'
      );
      assert.strictEqual(success, 'primary data');
      
      // Test fallback on timeout
      const timedOut = await resilientCall(
        async () => {
          await new Promise(resolve => setTimeout(resolve, 1000));
          return 'slow data';
        },
        'fallback data'
      );
      assert.strictEqual(timedOut, 'fallback data');
      
      rateLimiter.destroy();
    });
  });
  
  describe('Event Coordination', () => {
    it('should propagate events across patterns', async () => {
      const events = [];
      
      const circuitBreaker = new CircuitBreaker({
        failureThreshold: 2,
        timeout: 100
      });
      
      const fallback = new FallbackHandler();
      
      circuitBreaker.on('failure', () => events.push('circuit:failure'));
      circuitBreaker.on('open', () => events.push('circuit:open'));
      fallback.on('primaryFailure', () => events.push('fallback:primaryFailed'));
      fallback.on('fallbackSuccess', () => events.push('fallback:success'));
      
      // First failure
      await fallback.execute(
        async () => circuitBreaker.execute(() => { throw new Error('fail'); }),
        async () => 'backup'
      );
      
      // Second failure opens circuit
      await fallback.execute(
        async () => circuitBreaker.execute(() => { throw new Error('fail'); }),
        async () => 'backup'
      );
      
      assert.ok(events.includes('circuit:failure'));
      assert.ok(events.includes('circuit:open'));
      assert.ok(events.includes('fallback:primaryFailed'));
      assert.ok(events.includes('fallback:success'));
    });
  });
  
  describe('Statistics Aggregation', () => {
    it('should provide combined statistics', async () => {
      const circuitBreaker = new CircuitBreaker({ failureThreshold: 5 });
      const retryHandler = new RetryHandler({ maxAttempts: 3, baseDelay: 10, jitter: false });
      
      // Execute some operations
      for (let i = 0; i < 5; i++) {
        try {
          await retryHandler.execute(async () => {
            return circuitBreaker.execute(async () => {
              if (i < 2) throw new Error('fail');
              return 'success';
            });
          });
        } catch (e) {}
      }
      
      const cbStats = circuitBreaker.getStats();
      const retryStats = retryHandler.getStats();
      
      // Combined view
      const combinedStats = {
        circuitBreaker: cbStats,
        retry: retryStats,
        overall: {
          totalAttempts: cbStats.totalCalls,
          successRate: `${((cbStats.successfulCalls / cbStats.totalCalls) * 100).toFixed(2)}%`
        }
      };
      
      assert.ok(combinedStats.circuitBreaker.totalCalls > 0);
      assert.ok(combinedStats.retry.totalAttempts > 0);
    });
  });
});
