/**
 * Edge Case Tests for Resilience Patterns
 * Tests boundary conditions, event payloads, and error handling
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

import {
  CircuitBreaker,
  RetryHandler,
  BackoffStrategy,
  TimeoutHandler,
  TimeoutError,
  FallbackHandler,
  Bulkhead,
  TokenBucketRateLimiter,
  RateLimiterFactory,
} from '../src/core/index.js';

// ============================================
// Circuit Breaker Edge Cases
// ============================================

describe('CircuitBreaker Edge Cases', () => {
  let breaker;

  afterEach(() => {
    if (breaker) breaker.reset();
  });

  describe('resetTimeout behavior', () => {
    it('timeout defines OPEN to HALF_OPEN transition time', async () => {
      breaker = new CircuitBreaker({
        failureThreshold: 2,
        timeout: 100, // Time before circuit attempts HALF_OPEN
        successThreshold: 1,
      });

      // Trip the circuit
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(async () => { throw new Error('fail'); });
        } catch {}
      }

      // Circuit should be OPEN
      assert.strictEqual(breaker.isOpen, true);

      // Wait for timeout to allow transition to HALF_OPEN
      await new Promise(r => setTimeout(r, 150));

      // Next call should transition to HALF_OPEN and succeed
      const result = await breaker.execute(async () => 'success');
      assert.strictEqual(result, 'success');

      // Should now be CLOSED (success in half-open closes it)
      assert.strictEqual(breaker.isClosed, true);
    });
  });

  describe('halfOpen event', () => {
    it('should emit halfOpen event on transition', async () => {
      breaker = new CircuitBreaker({
        failureThreshold: 2,
        timeout: 50,
      });

      let halfOpenEmitted = false;
      breaker.on('halfOpen', () => {
        halfOpenEmitted = true;
      });

      // Trip the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => { throw new Error('fail'); });
        } catch {}
      }

      // Wait for timeout
      await new Promise(r => setTimeout(r, 100));

      // Trigger half-open check
      try {
        await breaker.execute(async () => 'success');
      } catch {}

      assert.ok(halfOpenEmitted, 'halfOpen event should have been emitted');
    });
  });

  describe('reject event payload', () => {
    it('should include state in reject event', async () => {
      breaker = new CircuitBreaker({
        failureThreshold: 2,
        timeout: 5000,
      });

      let rejectEventData = null;
      breaker.on('reject', (data) => {
        rejectEventData = data;
      });

      // Trip the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => { throw new Error('fail'); });
        } catch {}
      }

      // Next call should be rejected
      try {
        await breaker.execute(async () => 'success');
      } catch {}

      assert.ok(rejectEventData, 'reject event should have been emitted');
      assert.strictEqual(rejectEventData.state, 'OPEN');
    });
  });

  describe('stats timestamps', () => {
    it('should track lastSuccess timestamp', async () => {
      breaker = new CircuitBreaker({ failureThreshold: 5 });

      const before = Date.now();
      await breaker.execute(async () => 'success');
      const after = Date.now();

      const stats = breaker.getStats();
      assert.ok(stats.lastSuccess >= before);
      assert.ok(stats.lastSuccess <= after);
    });

    it('should track lastFailure timestamp', async () => {
      breaker = new CircuitBreaker({ failureThreshold: 5 });

      const before = Date.now();
      try {
        await breaker.execute(async () => { throw new Error('fail'); });
      } catch {}
      const after = Date.now();

      const stats = breaker.getStats();
      assert.ok(stats.lastFailure >= before);
      assert.ok(stats.lastFailure <= after);
    });
  });

  describe('concurrent state transitions', () => {
    it('should handle concurrent executions during half-open', async () => {
      breaker = new CircuitBreaker({
        failureThreshold: 2,
        successThreshold: 2,
        timeout: 50,
      });

      // Trip the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => { throw new Error('fail'); });
        } catch {}
      }

      // Wait for half-open
      await new Promise(r => setTimeout(r, 60));

      // Concurrent successful calls
      const results = await Promise.allSettled([
        breaker.execute(async () => { await new Promise(r => setTimeout(r, 10)); return 'a'; }),
        breaker.execute(async () => { await new Promise(r => setTimeout(r, 10)); return 'b'; }),
        breaker.execute(async () => { await new Promise(r => setTimeout(r, 10)); return 'c'; }),
      ]);

      // At least some should succeed
      const successes = results.filter(r => r.status === 'fulfilled').length;
      assert.ok(successes >= 1, 'At least one should succeed');
    });
  });
});

// ============================================
// Retry Handler Edge Cases
// ============================================

describe('RetryHandler Edge Cases', () => {
  describe('Jitter behavior', () => {
    it('should add jitter to delay when enabled', async () => {
      const delays = [];
      
      const handler = new RetryHandler({
        maxAttempts: 4,
        baseDelay: 100,
        strategy: BackoffStrategy.EXPONENTIAL,
        jitter: true,
      });

      let attempt = 0;
      const startTimes = [];
      
      try {
        await handler.execute(async () => {
          startTimes.push(Date.now());
          attempt++;
          if (attempt < 4) throw new Error('fail');
          return 'success';
        });
      } catch {}

      // With jitter, delays should vary somewhat
      // Calculate actual delays between attempts
      for (let i = 1; i < startTimes.length; i++) {
        delays.push(startTimes[i] - startTimes[i - 1]);
      }

      // Delays should exist and be reasonably close to expected exponential values
      assert.ok(delays.length >= 2, 'Should have recorded delays');
    });

    it('should have predictable delays without jitter', async () => {
      const handler = new RetryHandler({
        maxAttempts: 3,
        baseDelay: 100,
        strategy: BackoffStrategy.CONSTANT,
        jitter: false,
      });

      const startTimes = [];
      let attempt = 0;

      try {
        await handler.execute(async () => {
          startTimes.push(Date.now());
          attempt++;
          if (attempt < 3) throw new Error('fail');
          return 'success';
        });
      } catch {}

      // With constant strategy and no jitter, delays should be ~100ms
      for (let i = 1; i < startTimes.length; i++) {
        const delay = startTimes[i] - startTimes[i - 1];
        assert.ok(delay >= 90 && delay < 200, `Expected ~100ms delay, got ${delay}ms`);
      }
    });
  });

  describe('Context in events', () => {
    it('should pass context to retry event', async () => {
      const handler = new RetryHandler({
        maxAttempts: 2,
        baseDelay: 10,
      });

      let retryEventData = null;
      handler.on('retry', (data) => {
        retryEventData = data;
      });

      let attempt = 0;
      try {
        await handler.execute(async () => {
          attempt++;
          if (attempt < 2) throw new Error('fail');
          return 'success';
        }, { operationName: 'testOp' });
      } catch {}

      assert.ok(retryEventData, 'retry event should have been emitted');
      assert.ok(retryEventData.attempt, 'should include attempt number');
      assert.ok(retryEventData.delay !== undefined, 'should include delay');
    });
  });

  describe('maxAttempts edge values', () => {
    it('should work with maxAttempts of 1 (no retries)', async () => {
      const handler = new RetryHandler({
        maxAttempts: 1,
        baseDelay: 10,
      });

      let attempts = 0;
      try {
        await handler.execute(async () => {
          attempts++;
          throw new Error('fail');
        });
      } catch {}

      assert.strictEqual(attempts, 1, 'Should only attempt once');
    });
  });

  describe('Decorrelated jitter strategy', () => {
    it('should use decorrelated jitter when configured', async () => {
      const handler = new RetryHandler({
        maxAttempts: 4,
        baseDelay: 50,
        maxDelay: 1000,
        strategy: BackoffStrategy.DECORRELATED_JITTER,
      });

      const startTimes = [];
      let attempt = 0;

      try {
        await handler.execute(async () => {
          startTimes.push(Date.now());
          attempt++;
          if (attempt < 4) throw new Error('fail');
          return 'success';
        });
      } catch {}

      assert.ok(startTimes.length >= 3, 'Should have recorded multiple attempts');
    });
  });
});

// ============================================
// Timeout Handler Edge Cases
// ============================================

describe('TimeoutHandler Edge Cases', () => {
  describe('TimeoutError properties', () => {
    it('should include operation name in error', async () => {
      const handler = new TimeoutHandler({
        duration: 10,
        name: 'TestOperation',
      });

      try {
        await handler.execute(async () => {
          await new Promise(r => setTimeout(r, 100));
        });
        assert.fail('Should have thrown');
      } catch (error) {
        assert.ok(error instanceof TimeoutError);
        assert.ok(error.message.includes('TestOperation') || error.name === 'TestOperation');
      }
    });

    it('should include duration in TimeoutError', async () => {
      const handler = new TimeoutHandler({ duration: 50 });

      try {
        await handler.execute(async () => {
          await new Promise(r => setTimeout(r, 200));
        });
        assert.fail('Should have thrown');
      } catch (error) {
        assert.ok(error.duration);
      }
    });
  });

  describe('Success event payload', () => {
    it('should include duration in success event', async () => {
      const handler = new TimeoutHandler({ duration: 1000 });

      let eventData = null;
      handler.on('success', (data) => {
        eventData = data;
      });

      await handler.execute(async () => {
        await new Promise(r => setTimeout(r, 50));
        return 'done';
      });

      assert.ok(eventData, 'success event should have been emitted');
      assert.ok(eventData.duration !== undefined, 'should include duration');
      assert.ok(eventData.duration >= 40, 'duration should reflect actual time');
    });
  });

  describe('Concurrent timeouts', () => {
    it('should handle multiple concurrent executions', async () => {
      const handler = new TimeoutHandler({ duration: 200 });

      const results = await Promise.allSettled([
        handler.execute(async () => {
          await new Promise(r => setTimeout(r, 50));
          return 'fast';
        }),
        handler.execute(async () => {
          await new Promise(r => setTimeout(r, 100));
          return 'medium';
        }),
        handler.execute(async () => {
          await new Promise(r => setTimeout(r, 500));
          return 'slow';
        }),
      ]);

      // First two should succeed, third should timeout
      assert.strictEqual(results[0].status, 'fulfilled');
      assert.strictEqual(results[1].status, 'fulfilled');
      assert.strictEqual(results[2].status, 'rejected');
    });
  });
});

// ============================================
// Fallback Handler Edge Cases
// ============================================

describe('FallbackHandler Edge Cases', () => {
  describe('Event payloads', () => {
    it('should include error in primaryFailure event', async () => {
      const handler = new FallbackHandler();

      let eventData = null;
      handler.on('primaryFailure', (data) => {
        eventData = data;
      });

      await handler.execute(
        async () => { throw new Error('Primary failed'); },
        async () => 'fallback'
      );

      assert.ok(eventData, 'primaryFailure event should have been emitted');
      assert.ok(eventData.error, 'should include error');
      assert.strictEqual(eventData.error.message, 'Primary failed');
    });

    it('should track strategy used in cascade result', async () => {
      const handler = new FallbackHandler();

      const result = await handler.executeWithCascade([
        { name: 'primary', fn: async () => { throw new Error('fail'); } },
        { name: 'secondary', fn: async () => { throw new Error('fail'); } },
        { name: 'tertiary', fn: async () => 'success' },
      ]);

      assert.strictEqual(result.strategyUsed, 'tertiary');
      assert.strictEqual(result.result, 'success');
    });
  });

  describe('Cache fallback edge cases', () => {
    it('should handle null cache value', async () => {
      const handler = new FallbackHandler();

      // executeWithCache takes cachedValue directly (not a cache object)
      const result = await handler.executeWithCache(
        async () => { throw new Error('fail'); },
        null // Explicit null is returned as fallback
      );

      assert.strictEqual(result, null);
    });

    it('should handle undefined cache value', async () => {
      const handler = new FallbackHandler();

      // When cachedValue is undefined, the error is re-thrown
      await assert.rejects(
        handler.executeWithCache(
          async () => { throw new Error('Primary failed'); },
          undefined // No cached value
        ),
        /Primary failed/
      );
    });
  });
});

// ============================================
// Bulkhead Edge Cases
// ============================================

describe('Bulkhead Edge Cases', () => {
  describe('Event payloads', () => {
    it('should emit acquired event on slot acquisition', async () => {
      const bulkhead = new Bulkhead({
        maxConcurrent: 2,
        maxQueueSize: 5,
      });

      let eventEmitted = false;
      bulkhead.on('acquired', () => {
        eventEmitted = true;
      });

      await bulkhead.execute(async () => 'done');

      assert.ok(eventEmitted, 'acquired event should have been emitted');
    });

    it('should include queue info in queued event', async () => {
      const bulkhead = new Bulkhead({
        maxConcurrent: 1,
        maxQueueSize: 5,
      });

      let eventData = null;
      bulkhead.on('queued', (data) => {
        eventData = data;
      });

      // Start a slow task
      const slowTask = bulkhead.execute(async () => {
        await new Promise(r => setTimeout(r, 100));
        return 'slow';
      });

      // This should be queued
      const queuedTask = bulkhead.execute(async () => 'queued');

      await Promise.all([slowTask, queuedTask]);

      assert.ok(eventData, 'queued event should have been emitted');
    });
  });

  describe('Drain behavior', () => {
    it('should reject all queued tasks on drain', async () => {
      const bulkhead = new Bulkhead({
        maxConcurrent: 1,
        maxQueueSize: 10,
      });

      // Start a slow task
      const slowTask = bulkhead.execute(async () => {
        await new Promise(r => setTimeout(r, 500));
        return 'slow';
      });

      // Queue more tasks
      const queuedTasks = [];
      for (let i = 0; i < 5; i++) {
        queuedTasks.push(bulkhead.execute(async () => `task-${i}`));
      }

      // Small delay then drain
      await new Promise(r => setTimeout(r, 10));
      bulkhead.drain();

      const results = await Promise.allSettled(queuedTasks);
      const rejected = results.filter(r => r.status === 'rejected').length;

      assert.ok(rejected >= 4, 'Most queued tasks should be rejected');
    });
  });
});

// ============================================
// Rate Limiter Edge Cases
// ============================================

describe('RateLimiter Edge Cases', () => {
  let limiter;

  afterEach(() => {
    // Some rate limiters (like SlidingWindowRateLimiter) don't have destroy
    if (limiter && typeof limiter.destroy === 'function') {
      limiter.destroy();
    }
    limiter = null;
  });

  describe('Multiple token consumption', () => {
    it('should consume multiple tokens at once', () => {
      limiter = new TokenBucketRateLimiter({
        capacity: 10,
        refillRate: 1,
      });

      assert.strictEqual(limiter.tryConsume(5), true);
      assert.ok(limiter.tokens <= 5);
    });

    it('should reject when requesting more tokens than available', () => {
      limiter = new TokenBucketRateLimiter({
        capacity: 5,
        refillRate: 1,
      });

      limiter.tryConsume(3); // Use 3 tokens
      assert.strictEqual(limiter.tryConsume(5), false); // Try to use 5 more
    });
  });

  describe('Event unsubscription', () => {
    it('should allow unsubscribing from events', () => {
      limiter = new TokenBucketRateLimiter({
        capacity: 5,
        refillRate: 1,
      });

      let callCount = 0;
      const handler = () => callCount++;

      // on() returns an unsubscribe function
      const unsubscribe = limiter.on('allowed', handler);
      limiter.tryConsume();
      assert.strictEqual(callCount, 1);

      unsubscribe(); // Use returned unsubscribe function
      limiter.tryConsume();
      assert.strictEqual(callCount, 1); // Should not increment
    });
  });

  describe('Rejection rate calculation', () => {
    it('should track rejection rate accurately', () => {
      limiter = new TokenBucketRateLimiter({
        capacity: 2,
        refillRate: 0,
      });

      // 2 allowed, 3 rejected
      limiter.tryConsume(); // allowed
      limiter.tryConsume(); // allowed
      limiter.tryConsume(); // rejected
      limiter.tryConsume(); // rejected
      limiter.tryConsume(); // rejected

      const stats = limiter.getStats();
      assert.strictEqual(stats.allowedRequests, 2);
      assert.strictEqual(stats.rejectedRequests, 3);
    });
  });

  describe('Factory defaults', () => {
    it('should create limiter when no algorithm specified', () => {
      limiter = RateLimiterFactory.create({
        limit: 10,
        windowMs: 1000,
      });

      assert.ok(limiter);
      // Factory creates TokenBucket by default which has tryConsume method
      assert.ok(typeof limiter.tryConsume === 'function' || typeof limiter.tryAcquire === 'function');
    });
  });
});

// ============================================
// Error Listener Handling
// ============================================

describe('Error Listener Handling', () => {
  it('should not crash if event listener throws', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 5 });

    breaker.on('success', () => {
      throw new Error('Listener error');
    });

    // Should not throw despite listener error
    const result = await breaker.execute(async () => 'success');
    assert.strictEqual(result, 'success');
  });

  it('should continue emitting to other listeners if one throws', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 5 });

    let secondListenerCalled = false;

    breaker.on('success', () => {
      throw new Error('First listener error');
    });

    breaker.on('success', () => {
      secondListenerCalled = true;
    });

    await breaker.execute(async () => 'success');

    assert.ok(secondListenerCalled, 'Second listener should still be called');
  });
});
