/**
 * Retry Handler Tests
 * 
 * TDD approach with comprehensive test coverage
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { RetryHandler, BackoffStrategy, RetryHandlerFactory } from '../src/core/RetryHandler.js';

describe('RetryHandler', () => {
  let handler;

  beforeEach(() => {
    handler = new RetryHandler({
      maxAttempts: 3,
      baseDelay: 100, // Short delays for testing
      maxDelay: 1000,
      jitter: false // Disable for predictable tests
    });
  });

  describe('Successful Execution', () => {
    it('should return result on first successful attempt', async () => {
      const result = await handler.execute(async () => 'success');
      assert.strictEqual(result, 'success');
    });

    it('should increment success stats', async () => {
      await handler.execute(async () => 'success');
      const stats = handler.getStats();
      assert.strictEqual(stats.successfulAttempts, 1);
      assert.strictEqual(stats.totalAttempts, 1);
    });

    it('should emit success event', async () => {
      let eventFired = false;
      handler.on('success', () => { eventFired = true; });
      
      await handler.execute(async () => 'success');
      assert.strictEqual(eventFired, true);
    });

    it('should not retry on success', async () => {
      let attemptCount = 0;
      await handler.execute(async () => {
        attemptCount++;
        return 'success';
      });
      assert.strictEqual(attemptCount, 1);
    });
  });

  describe('Retry Logic', () => {
    it('should retry on failure up to maxAttempts', async () => {
      let attempts = 0;
      
      await assert.rejects(
        () => handler.execute(async () => {
          attempts++;
          throw new Error('fail');
        })
      );
      
      assert.strictEqual(attempts, 3);
    });

    it('should succeed after retries', async () => {
      let attempts = 0;
      
      const result = await handler.execute(async () => {
        attempts++;
        if (attempts < 3) throw new Error('fail');
        return 'success';
      });
      
      assert.strictEqual(result, 'success');
      assert.strictEqual(attempts, 3);
    });

    it('should emit retry event between attempts', async () => {
      const retryEvents = [];
      handler.on('retry', (data) => { retryEvents.push(data); });
      
      let attempts = 0;
      await handler.execute(async () => {
        attempts++;
        if (attempts < 3) throw new Error('fail');
        return 'success';
      });
      
      assert.strictEqual(retryEvents.length, 2);
      assert.strictEqual(retryEvents[0].attempt, 1);
      assert.strictEqual(retryEvents[1].attempt, 2);
    });

    it('should emit exhausted event when all retries fail', async () => {
      let exhaustedEvent = null;
      handler.on('exhausted', (data) => { exhaustedEvent = data; });
      
      try {
        await handler.execute(async () => { throw new Error('fail'); });
      } catch (e) {}
      
      assert.notStrictEqual(exhaustedEvent, null);
      assert.strictEqual(exhaustedEvent.totalAttempts, 3);
    });
  });

  describe('Backoff Strategies', () => {
    it('should use exponential backoff by default', async () => {
      const delays = [];
      handler.on('retry', (data) => { delays.push(data.delay); });
      
      let attempts = 0;
      await handler.execute(async () => {
        attempts++;
        if (attempts < 3) throw new Error('fail');
        return 'success';
      });
      
      // First retry: 100ms, Second retry: 200ms (exponential)
      assert.strictEqual(delays[0], 100);
      assert.strictEqual(delays[1], 200);
    });

    it('should use linear backoff when configured', async () => {
      const linearHandler = new RetryHandler({
        maxAttempts: 4,
        baseDelay: 100,
        strategy: BackoffStrategy.LINEAR,
        jitter: false
      });
      
      const delays = [];
      linearHandler.on('retry', (data) => { delays.push(data.delay); });
      
      let attempts = 0;
      await linearHandler.execute(async () => {
        attempts++;
        if (attempts < 4) throw new Error('fail');
        return 'success';
      });
      
      // Linear: 100, 200, 300
      assert.strictEqual(delays[0], 100);
      assert.strictEqual(delays[1], 200);
      assert.strictEqual(delays[2], 300);
    });

    it('should use constant backoff when configured', async () => {
      const constantHandler = new RetryHandler({
        maxAttempts: 4,
        baseDelay: 100,
        strategy: BackoffStrategy.CONSTANT,
        jitter: false
      });
      
      const delays = [];
      constantHandler.on('retry', (data) => { delays.push(data.delay); });
      
      let attempts = 0;
      await constantHandler.execute(async () => {
        attempts++;
        if (attempts < 4) throw new Error('fail');
        return 'success';
      });
      
      // Constant: all 100ms
      delays.forEach(delay => assert.strictEqual(delay, 100));
    });

    it('should cap delay at maxDelay', async () => {
      const cappedHandler = new RetryHandler({
        maxAttempts: 10,
        baseDelay: 100,
        maxDelay: 250,
        multiplier: 2,
        jitter: false
      });
      
      const delays = [];
      cappedHandler.on('retry', (data) => { delays.push(data.delay); });
      
      let attempts = 0;
      await cappedHandler.execute(async () => {
        attempts++;
        if (attempts < 6) throw new Error('fail');
        return 'success';
      });
      
      // Should be capped at 250ms
      delays.slice(2).forEach(delay => {
        assert.ok(delay <= 250, `Delay ${delay} exceeds maxDelay 250`);
      });
    });
  });

  describe('Retry Condition', () => {
    it('should respect custom retry condition', async () => {
      const conditionalHandler = new RetryHandler({
        maxAttempts: 5,
        baseDelay: 100,
        retryCondition: (error) => error.message === 'retryable'
      });
      
      let attempts = 0;
      
      // Should retry on retryable errors
      try {
        await conditionalHandler.execute(async () => {
          attempts++;
          throw new Error('retryable');
        });
      } catch (e) {}
      
      assert.strictEqual(attempts, 5);
      
      // Reset
      attempts = 0;
      
      // Should not retry on non-retryable errors
      try {
        await conditionalHandler.execute(async () => {
          attempts++;
          throw new Error('fatal');
        });
      } catch (e) {}
      
      assert.strictEqual(attempts, 1);
    });
  });

  describe('Statistics', () => {
    it('should track retry statistics', async () => {
      let attempts = 0;
      await handler.execute(async () => {
        attempts++;
        if (attempts < 3) throw new Error('fail');
        return 'success';
      });
      
      const stats = handler.getStats();
      assert.strictEqual(stats.totalRetries, 2);
      assert.strictEqual(stats.successfulAttempts, 1);
      assert.strictEqual(stats.failedAttempts, 2);
    });

    it('should reset statistics', async () => {
      await handler.execute(async () => 'success');
      handler.resetStats();
      
      const stats = handler.getStats();
      assert.strictEqual(stats.totalAttempts, 0);
    });
  });

  describe('Factory', () => {
    it('should create network handler with appropriate defaults', () => {
      const networkHandler = RetryHandlerFactory.forNetwork();
      assert.strictEqual(networkHandler.maxAttempts, 3);
      assert.strictEqual(networkHandler.jitter, true);
    });

    it('should create database handler with appropriate defaults', () => {
      const dbHandler = RetryHandlerFactory.forDatabase();
      assert.strictEqual(dbHandler.maxAttempts, 5);
      assert.strictEqual(dbHandler.strategy, BackoffStrategy.DECORRELATED_JITTER);
    });

    it('should allow overriding factory defaults', () => {
      const customHandler = RetryHandlerFactory.forNetwork({ maxAttempts: 10 });
      assert.strictEqual(customHandler.maxAttempts, 10);
    });
  });

  describe('Event Unsubscription', () => {
    it('should allow unsubscribing from events', async () => {
      let count = 0;
      const unsubscribe = handler.on('success', () => { count++; });
      
      await handler.execute(async () => 'success');
      assert.strictEqual(count, 1);
      
      unsubscribe();
      
      await handler.execute(async () => 'success');
      assert.strictEqual(count, 1);
    });
  });
});
