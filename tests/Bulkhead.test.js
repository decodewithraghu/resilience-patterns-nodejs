/**
 * Bulkhead Tests
 * 
 * TDD approach with comprehensive test coverage
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Bulkhead, BulkheadError } from '../src/core/Bulkhead.js';

describe('Bulkhead', () => {
  let bulkhead;

  beforeEach(() => {
    bulkhead = new Bulkhead({
      maxConcurrent: 2,
      maxQueueSize: 3,
      queueTimeout: 1000,
      name: 'TestBulkhead'
    });
  });

  afterEach(() => {
    bulkhead.drain();
  });

  describe('Initialization', () => {
    it('should initialize with correct defaults', () => {
      const defaultBulkhead = new Bulkhead();
      assert.strictEqual(defaultBulkhead.maxConcurrent, 10);
      assert.strictEqual(defaultBulkhead.maxQueueSize, 100);
    });

    it('should throw on invalid maxConcurrent', () => {
      assert.throws(
        () => new Bulkhead({ maxConcurrent: 0 }),
        { message: 'maxConcurrent must be at least 1' }
      );
    });

    it('should throw on invalid maxQueueSize', () => {
      assert.throws(
        () => new Bulkhead({ maxQueueSize: -1 }),
        { message: 'maxQueueSize cannot be negative' }
      );
    });
  });

  describe('Immediate Execution', () => {
    it('should execute immediately when slots available', async () => {
      const result = await bulkhead.execute(async () => 'success');
      assert.strictEqual(result, 'success');
    });

    it('should track active count', async () => {
      const promise = bulkhead.execute(async () => {
        assert.strictEqual(bulkhead.activeCount, 1);
        return 'success';
      });
      
      await promise;
      assert.strictEqual(bulkhead.activeCount, 0);
    });

    it('should emit acquired and released events', async () => {
      const events = [];
      bulkhead.on('acquired', () => events.push('acquired'));
      bulkhead.on('released', () => events.push('released'));
      
      await bulkhead.execute(async () => 'success');
      
      assert.deepStrictEqual(events, ['acquired', 'released']);
    });
  });

  describe('Concurrency Control', () => {
    it('should limit concurrent executions', async () => {
      let maxConcurrent = 0;
      let currentConcurrent = 0;
      
      const tasks = Array(5).fill(null).map(() =>
        bulkhead.execute(async () => {
          currentConcurrent++;
          maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
          await new Promise(resolve => setTimeout(resolve, 50));
          currentConcurrent--;
          return 'done';
        })
      );
      
      await Promise.all(tasks);
      assert.strictEqual(maxConcurrent, 2); // maxConcurrent setting
    });

    it('should queue excess requests', async () => {
      let queueEventFired = false;
      bulkhead.on('queued', () => { queueEventFired = true; });
      
      // Start 2 slow tasks (fills slots)
      const task1 = bulkhead.execute(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return 1;
      });
      const task2 = bulkhead.execute(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return 2;
      });
      
      // Third task should queue
      const task3 = bulkhead.execute(async () => 3);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      assert.strictEqual(queueEventFired, true);
      
      await Promise.all([task1, task2, task3]);
    });

    it('should process queue when slots become available', async () => {
      const completionOrder = [];
      
      const task1 = bulkhead.execute(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        completionOrder.push(1);
        return 1;
      });
      
      const task2 = bulkhead.execute(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        completionOrder.push(2);
        return 2;
      });
      
      // Small delay to ensure tasks start before queuing
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // This will be queued since both slots are taken
      const task3 = bulkhead.execute(async () => {
        completionOrder.push(3);
        return 3;
      });
      
      await Promise.all([task1, task2, task3]);
      
      // task3 should complete after task1 or task2 finishes
      // Since task3 is queued and runs instantly, it should complete after
      // at least one of the slow tasks
      assert.strictEqual(completionOrder.length, 3);
      assert.ok(completionOrder.includes(1));
      assert.ok(completionOrder.includes(2));
      assert.ok(completionOrder.includes(3));
    });
  });

  describe('Queue Full Rejection', () => {
    it('should reject when queue is full', async () => {
      // Create a new bulkhead for isolation
      const isolatedBulkhead = new Bulkhead({
        maxConcurrent: 2,
        maxQueueSize: 3,
        queueTimeout: 1000,
        name: 'IsolatedBulkhead'
      });
      
      let resolveSlots;
      const slotsPromise = new Promise(r => { resolveSlots = r; });
      
      // Fill slots with controlled promises
      const slot1 = isolatedBulkhead.execute(() => slotsPromise);
      const slot2 = isolatedBulkhead.execute(() => slotsPromise);
      
      // Fill queue
      const queue1 = isolatedBulkhead.execute(() => Promise.resolve('q1')).catch(() => {});
      const queue2 = isolatedBulkhead.execute(() => Promise.resolve('q2')).catch(() => {});
      const queue3 = isolatedBulkhead.execute(() => Promise.resolve('q3')).catch(() => {});
      
      // This should be rejected immediately
      await assert.rejects(
        () => isolatedBulkhead.execute(() => Promise.resolve()),
        BulkheadError
      );
      
      // Resolve and cleanup
      resolveSlots('done');
      await Promise.allSettled([slot1, slot2, queue1, queue2, queue3]);
    });

    it('should increment rejection stats', async () => {
      // Create a new bulkhead for isolation
      const isolatedBulkhead = new Bulkhead({
        maxConcurrent: 2,
        maxQueueSize: 3,
        queueTimeout: 1000,
        name: 'StatsBulkhead'
      });
      
      let resolveSlots;
      const slotsPromise = new Promise(r => { resolveSlots = r; });
      
      // Fill slots and queue with controlled promises
      const tasks = [
        isolatedBulkhead.execute(() => slotsPromise),
        isolatedBulkhead.execute(() => slotsPromise),
        isolatedBulkhead.execute(() => Promise.resolve('q1')).catch(() => {}),
        isolatedBulkhead.execute(() => Promise.resolve('q2')).catch(() => {}),
        isolatedBulkhead.execute(() => Promise.resolve('q3')).catch(() => {})
      ];
      
      // Try one more - should be rejected
      try {
        await isolatedBulkhead.execute(() => Promise.resolve());
      } catch (e) {}
      
      const stats = isolatedBulkhead.getStats();
      assert.strictEqual(stats.rejections, 1);
      
      // Cleanup
      resolveSlots('done');
      await Promise.allSettled(tasks);
    });
  });

  describe('Queue Timeout', () => {
    it('should timeout queued requests', async () => {
      const fastBulkhead = new Bulkhead({
        maxConcurrent: 1,
        maxQueueSize: 5,
        queueTimeout: 100
      });
      
      // Fill slot with slow task
      const slowTask = fastBulkhead.execute(() => 
        new Promise(resolve => setTimeout(resolve, 500))
      );
      
      // Queue a task that will timeout
      await assert.rejects(
        () => fastBulkhead.execute(() => Promise.resolve()),
        BulkheadError
      );
      
      fastBulkhead.drain();
    });
  });

  describe('Statistics', () => {
    it('should track execution statistics', async () => {
      await bulkhead.execute(async () => 'success');
      
      try {
        await bulkhead.execute(async () => { throw new Error('fail'); });
      } catch (e) {}
      
      const stats = bulkhead.getStats();
      assert.strictEqual(stats.totalExecutions, 2);
      assert.strictEqual(stats.successfulExecutions, 1);
      assert.strictEqual(stats.failedExecutions, 1);
    });

    it('should track peak concurrent', async () => {
      const tasks = Array(3).fill(null).map(() =>
        bulkhead.execute(async () => {
          await new Promise(resolve => setTimeout(resolve, 50));
        })
      );
      
      await Promise.all(tasks);
      
      const stats = bulkhead.getStats();
      assert.strictEqual(stats.peakConcurrent, 2);
    });

    it('should calculate utilization', async () => {
      const task = bulkhead.execute(async () => {
        const stats = bulkhead.getStats();
        assert.strictEqual(stats.utilization, '50.00%'); // 1 of 2 slots
        return 'done';
      });
      
      await task;
    });
  });

  describe('Drain', () => {
    it('should reject all queued items on drain', async () => {
      // Fill slots
      const slot = bulkhead.execute(() => new Promise(resolve => setTimeout(resolve, 500)));
      const slot2 = bulkhead.execute(() => new Promise(resolve => setTimeout(resolve, 500)));
      
      // Queue items
      const queuedPromises = [
        bulkhead.execute(() => Promise.resolve()).catch(e => e),
        bulkhead.execute(() => Promise.resolve()).catch(e => e)
      ];
      
      bulkhead.drain();
      
      const results = await Promise.all(queuedPromises);
      results.forEach(result => {
        assert.ok(result instanceof BulkheadError);
        assert.strictEqual(result.code, 'BULKHEAD_DRAINED');
      });
    });
  });

  describe('Getters', () => {
    it('should return available slots', () => {
      assert.strictEqual(bulkhead.availableSlots, 2);
    });

    it('should return queue size', () => {
      assert.strictEqual(bulkhead.queueSize, 0);
    });
  });
});
