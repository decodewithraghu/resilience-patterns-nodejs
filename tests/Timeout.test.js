/**
 * Timeout Handler Tests
 * 
 * TDD approach with comprehensive test coverage
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { TimeoutHandler, TimeoutError } from '../src/core/Timeout.js';

describe('TimeoutHandler', () => {
  let handler;

  beforeEach(() => {
    handler = new TimeoutHandler({
      duration: 200,
      name: 'TestOperation'
    });
  });

  describe('Successful Execution', () => {
    it('should return result when operation completes in time', async () => {
      const result = await handler.execute(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return 'success';
      });
      assert.strictEqual(result, 'success');
    });

    it('should increment success stats', async () => {
      await handler.execute(async () => 'success');
      const stats = handler.getStats();
      assert.strictEqual(stats.successfulCalls, 1);
      assert.strictEqual(stats.totalCalls, 1);
    });

    it('should emit success event', async () => {
      let eventData = null;
      handler.on('success', (data) => { eventData = data; });
      
      await handler.execute(async () => 'success');
      
      assert.notStrictEqual(eventData, null);
      assert.ok(eventData.duration >= 0);
    });
  });

  describe('Timeout Behavior', () => {
    it('should throw TimeoutError when operation exceeds duration', async () => {
      await assert.rejects(
        () => handler.execute(async () => {
          await new Promise(resolve => setTimeout(resolve, 500));
          return 'late';
        }),
        TimeoutError
      );
    });

    it('should include duration in TimeoutError', async () => {
      try {
        await handler.execute(async () => {
          await new Promise(resolve => setTimeout(resolve, 500));
        });
        assert.fail('Should have thrown');
      } catch (error) {
        assert.ok(error instanceof TimeoutError);
        assert.strictEqual(error.duration, 200);
      }
    });

    it('should increment timeout stats', async () => {
      try {
        await handler.execute(async () => {
          await new Promise(resolve => setTimeout(resolve, 500));
        });
      } catch (e) {}
      
      const stats = handler.getStats();
      assert.strictEqual(stats.timeouts, 1);
    });

    it('should emit timeout event', async () => {
      let eventData = null;
      handler.on('timeout', (data) => { eventData = data; });
      
      try {
        await handler.execute(async () => {
          await new Promise(resolve => setTimeout(resolve, 500));
        });
      } catch (e) {}
      
      assert.notStrictEqual(eventData, null);
      assert.strictEqual(eventData.duration, 200);
      assert.strictEqual(eventData.name, 'TestOperation');
    });
  });

  describe('Custom Duration', () => {
    it('should accept custom duration per execution', async () => {
      // Should succeed with longer timeout
      const result = await handler.execute(
        async () => {
          await new Promise(resolve => setTimeout(resolve, 300));
          return 'success';
        },
        500 // Custom longer timeout
      );
      assert.strictEqual(result, 'success');
    });

    it('should timeout with shorter custom duration', async () => {
      await assert.rejects(
        () => handler.execute(
          async () => {
            await new Promise(resolve => setTimeout(resolve, 200));
            return 'success';
          },
          50 // Custom shorter timeout
        ),
        TimeoutError
      );
    });
  });

  describe('Static withTimeout', () => {
    it('should wrap promise with timeout', async () => {
      const promise = new Promise(resolve => {
        setTimeout(() => resolve('success'), 50);
      });
      
      const result = await TimeoutHandler.withTimeout(promise, 200);
      assert.strictEqual(result, 'success');
    });

    it('should reject slow promises', async () => {
      const slowPromise = new Promise(resolve => {
        setTimeout(() => resolve('late'), 500);
      });
      
      await assert.rejects(
        () => TimeoutHandler.withTimeout(slowPromise, 100),
        TimeoutError
      );
    });

    it('should pass through original errors', async () => {
      const failingPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Original error')), 50);
      });
      
      await assert.rejects(
        () => TimeoutHandler.withTimeout(failingPromise, 200),
        { message: 'Original error' }
      );
    });
  });

  describe('Statistics', () => {
    it('should calculate timeout rate', async () => {
      // One success
      await handler.execute(async () => 'success');
      
      // One timeout
      try {
        await handler.execute(async () => {
          await new Promise(resolve => setTimeout(resolve, 500));
        });
      } catch (e) {}
      
      const stats = handler.getStats();
      assert.strictEqual(stats.totalCalls, 2);
      assert.strictEqual(stats.timeoutRate, '50.00%');
    });

    it('should reset statistics', async () => {
      await handler.execute(async () => 'success');
      handler.resetStats();
      
      const stats = handler.getStats();
      assert.strictEqual(stats.totalCalls, 0);
      assert.strictEqual(stats.timeoutRate, '0%');
    });
  });

  describe('Configuration', () => {
    it('should use default values when no options provided', () => {
      const defaultHandler = new TimeoutHandler();
      assert.strictEqual(defaultHandler.duration, 5000);
      assert.strictEqual(defaultHandler.name, 'Operation');
    });
  });

  describe('Error Propagation', () => {
    it('should propagate non-timeout errors', async () => {
      await assert.rejects(
        () => handler.execute(async () => {
          throw new Error('Custom error');
        }),
        { message: 'Custom error' }
      );
    });
  });
});
