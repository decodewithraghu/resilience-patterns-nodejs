/**
 * Fallback Handler Tests
 * 
 * TDD approach with comprehensive test coverage
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { FallbackHandler } from '../src/core/Fallback.js';

describe('FallbackHandler', () => {
  let handler;

  beforeEach(() => {
    handler = new FallbackHandler({
      name: 'TestFallback'
    });
  });

  describe('Primary Success', () => {
    it('should return primary result when successful', async () => {
      const result = await handler.execute(
        async () => 'primary',
        async () => 'fallback'
      );
      assert.strictEqual(result, 'primary');
    });

    it('should increment primary success stats', async () => {
      await handler.execute(
        async () => 'primary',
        async () => 'fallback'
      );
      
      const stats = handler.getStats();
      assert.strictEqual(stats.primarySuccesses, 1);
      assert.strictEqual(stats.fallbacksUsed, 0);
    });

    it('should emit primarySuccess event', async () => {
      let eventFired = false;
      handler.on('primarySuccess', () => { eventFired = true; });
      
      await handler.execute(
        async () => 'primary',
        async () => 'fallback'
      );
      
      assert.strictEqual(eventFired, true);
    });

    it('should not call fallback when primary succeeds', async () => {
      let fallbackCalled = false;
      
      await handler.execute(
        async () => 'primary',
        async () => {
          fallbackCalled = true;
          return 'fallback';
        }
      );
      
      assert.strictEqual(fallbackCalled, false);
    });
  });

  describe('Fallback Execution', () => {
    it('should return fallback result when primary fails', async () => {
      const result = await handler.execute(
        async () => { throw new Error('primary failed'); },
        async () => 'fallback'
      );
      assert.strictEqual(result, 'fallback');
    });

    it('should pass error to fallback function', async () => {
      let receivedError = null;
      
      await handler.execute(
        async () => { throw new Error('primary error'); },
        async (error) => {
          receivedError = error;
          return 'fallback';
        }
      );
      
      assert.strictEqual(receivedError.message, 'primary error');
    });

    it('should increment fallback stats', async () => {
      await handler.execute(
        async () => { throw new Error('fail'); },
        async () => 'fallback'
      );
      
      const stats = handler.getStats();
      assert.strictEqual(stats.fallbacksUsed, 1);
    });

    it('should emit events in correct order', async () => {
      const events = [];
      handler.on('primaryFailure', () => { events.push('primaryFailure'); });
      handler.on('fallbackSuccess', () => { events.push('fallbackSuccess'); });
      
      await handler.execute(
        async () => { throw new Error('fail'); },
        async () => 'fallback'
      );
      
      assert.deepStrictEqual(events, ['primaryFailure', 'fallbackSuccess']);
    });
  });

  describe('Total Failure', () => {
    it('should throw when both primary and fallback fail', async () => {
      await assert.rejects(
        () => handler.execute(
          async () => { throw new Error('primary failed'); },
          async () => { throw new Error('fallback failed'); }
        ),
        { message: 'fallback failed' }
      );
    });

    it('should increment total failures stat', async () => {
      try {
        await handler.execute(
          async () => { throw new Error('primary'); },
          async () => { throw new Error('fallback'); }
        );
      } catch (e) {}
      
      const stats = handler.getStats();
      assert.strictEqual(stats.totalFailures, 1);
    });
  });

  describe('Cascading Fallbacks', () => {
    it('should try strategies in order', async () => {
      const order = [];
      
      const result = await handler.executeWithCascade([
        { name: 'first', fn: async () => { order.push('first'); throw new Error('fail'); } },
        { name: 'second', fn: async () => { order.push('second'); throw new Error('fail'); } },
        { name: 'third', fn: async () => { order.push('third'); return 'success'; } }
      ]);
      
      assert.deepStrictEqual(order, ['first', 'second', 'third']);
      assert.strictEqual(result.result, 'success');
      assert.strictEqual(result.strategyUsed, 'third');
    });

    it('should return on first success', async () => {
      let thirdCalled = false;
      
      const result = await handler.executeWithCascade([
        { name: 'first', fn: async () => { throw new Error('fail'); } },
        { name: 'second', fn: async () => 'success' },
        { name: 'third', fn: async () => { thirdCalled = true; return 'too late'; } }
      ]);
      
      assert.strictEqual(result.result, 'success');
      assert.strictEqual(thirdCalled, false);
    });

    it('should collect errors from all attempts', async () => {
      const result = await handler.executeWithCascade([
        { name: 'first', fn: async () => { throw new Error('error1'); } },
        { name: 'second', fn: async () => { throw new Error('error2'); } },
        { name: 'third', fn: async () => 'success' }
      ]);
      
      assert.strictEqual(result.errors.length, 2);
      assert.strictEqual(result.errors[0].strategy, 'first');
      assert.strictEqual(result.errors[1].strategy, 'second');
    });

    it('should throw when all strategies fail', async () => {
      try {
        await handler.executeWithCascade([
          { name: 'first', fn: async () => { throw new Error('fail1'); } },
          { name: 'second', fn: async () => { throw new Error('fail2'); } }
        ]);
        assert.fail('Should have thrown');
      } catch (error) {
        assert.ok(error.message.includes('2 strategies failed'));
        assert.strictEqual(error.errors.length, 2);
      }
    });

    it('should require at least one strategy', async () => {
      await assert.rejects(
        () => handler.executeWithCascade([]),
        { message: 'At least one strategy is required' }
      );
    });
  });

  describe('Cache Fallback', () => {
    it('should use cached value on failure', async () => {
      const result = await handler.executeWithCache(
        async () => { throw new Error('fail'); },
        { data: 'cached' }
      );
      
      assert.deepStrictEqual(result, { data: 'cached' });
    });

    it('should return primary result when successful', async () => {
      const result = await handler.executeWithCache(
        async () => ({ data: 'fresh' }),
        { data: 'cached' }
      );
      
      assert.deepStrictEqual(result, { data: 'fresh' });
    });

    it('should throw when no cache available', async () => {
      await assert.rejects(
        () => handler.executeWithCache(
          async () => { throw new Error('fail'); },
          undefined
        ),
        { message: 'fail' }
      );
    });
  });

  describe('Default Value Fallback', () => {
    it('should use default value on failure', async () => {
      const result = await handler.executeWithDefault(
        async () => { throw new Error('fail'); },
        'default'
      );
      
      assert.strictEqual(result, 'default');
    });

    it('should return primary result when successful', async () => {
      const result = await handler.executeWithDefault(
        async () => 'primary',
        'default'
      );
      
      assert.strictEqual(result, 'primary');
    });
  });

  describe('Statistics', () => {
    it('should calculate fallback rate', async () => {
      await handler.execute(async () => 'success', async () => 'fallback');
      await handler.execute(async () => { throw new Error(); }, async () => 'fallback');
      
      const stats = handler.getStats();
      assert.strictEqual(stats.fallbackRate, '50.00%');
    });

    it('should reset statistics', async () => {
      await handler.execute(async () => 'success', async () => 'fallback');
      handler.resetStats();
      
      const stats = handler.getStats();
      assert.strictEqual(stats.totalCalls, 0);
    });
  });
});
