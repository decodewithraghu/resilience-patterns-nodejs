/**
 * Circuit Breaker Tests
 * 
 * Test-Driven Development approach:
 * - Each test describes expected behavior
 * - Tests cover happy path, error cases, and edge cases
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { CircuitBreaker, CircuitState } from '../src/core/CircuitBreaker.js';

describe('CircuitBreaker', () => {
  let breaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 1000
    });
  });

  describe('Initial State', () => {
    it('should start in CLOSED state', () => {
      assert.strictEqual(breaker.state, CircuitState.CLOSED);
      assert.strictEqual(breaker.isClosed, true);
      assert.strictEqual(breaker.isOpen, false);
    });

    it('should have zero stats initially', () => {
      const stats = breaker.getStats();
      assert.strictEqual(stats.totalCalls, 0);
      assert.strictEqual(stats.successfulCalls, 0);
      assert.strictEqual(stats.failedCalls, 0);
    });
  });

  describe('Successful Executions', () => {
    it('should execute function and return result', async () => {
      const result = await breaker.execute(async () => 'success');
      assert.strictEqual(result, 'success');
    });

    it('should increment success stats', async () => {
      await breaker.execute(async () => 'success');
      const stats = breaker.getStats();
      assert.strictEqual(stats.totalCalls, 1);
      assert.strictEqual(stats.successfulCalls, 1);
    });

    it('should emit success event', async () => {
      let eventFired = false;
      breaker.on('success', () => { eventFired = true; });
      
      await breaker.execute(async () => 'success');
      assert.strictEqual(eventFired, true);
    });

    it('should stay CLOSED after successful executions', async () => {
      for (let i = 0; i < 10; i++) {
        await breaker.execute(async () => 'success');
      }
      assert.strictEqual(breaker.state, CircuitState.CLOSED);
    });
  });

  describe('Failed Executions', () => {
    it('should throw original error on failure', async () => {
      const error = new Error('Test error');
      
      await assert.rejects(
        () => breaker.execute(async () => { throw error; }),
        { message: 'Test error' }
      );
    });

    it('should increment failure stats', async () => {
      try {
        await breaker.execute(async () => { throw new Error('fail'); });
      } catch (e) {}
      
      const stats = breaker.getStats();
      assert.strictEqual(stats.failedCalls, 1);
    });

    it('should emit failure event', async () => {
      let eventData = null;
      breaker.on('failure', (data) => { eventData = data; });
      
      try {
        await breaker.execute(async () => { throw new Error('fail'); });
      } catch (e) {}
      
      assert.notStrictEqual(eventData, null);
      assert.strictEqual(eventData.error.message, 'fail');
    });
  });

  describe('Circuit Opening', () => {
    it('should open circuit after failure threshold', async () => {
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => { throw new Error('fail'); });
        } catch (e) {}
      }
      
      assert.strictEqual(breaker.state, CircuitState.OPEN);
      assert.strictEqual(breaker.isOpen, true);
    });

    it('should emit open event when circuit opens', async () => {
      let openEvent = null;
      breaker.on('open', (data) => { openEvent = data; });
      
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => { throw new Error('fail'); });
        } catch (e) {}
      }
      
      assert.notStrictEqual(openEvent, null);
    });

    it('should reject requests when circuit is open', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => { throw new Error('fail'); });
        } catch (e) {}
      }
      
      // Next request should be rejected
      await assert.rejects(
        () => breaker.execute(async () => 'success'),
        { message: 'Circuit breaker is OPEN' }
      );
    });

    it('should increment rejected stats when open', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => { throw new Error('fail'); });
        } catch (e) {}
      }
      
      try {
        await breaker.execute(async () => 'success');
      } catch (e) {}
      
      const stats = breaker.getStats();
      assert.strictEqual(stats.rejectedCalls, 1);
    });
  });

  describe('Half-Open State', () => {
    it('should transition to HALF_OPEN after timeout', async () => {
      const fastBreaker = new CircuitBreaker({
        failureThreshold: 1,
        timeout: 50
      });
      
      try {
        await fastBreaker.execute(async () => { throw new Error('fail'); });
      } catch (e) {}
      
      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 60));
      
      // Next execution should transition to HALF_OPEN
      try {
        await fastBreaker.execute(async () => 'success');
      } catch (e) {}
      
      // After success in HALF_OPEN, should close
      assert.notStrictEqual(fastBreaker.state, CircuitState.OPEN);
    });
  });

  describe('Circuit Closing', () => {
    it('should close after success threshold in HALF_OPEN', async () => {
      const fastBreaker = new CircuitBreaker({
        failureThreshold: 1,
        successThreshold: 2,
        timeout: 50
      });
      
      // Open circuit
      try {
        await fastBreaker.execute(async () => { throw new Error('fail'); });
      } catch (e) {}
      
      await new Promise(resolve => setTimeout(resolve, 60));
      
      // Two successes should close the circuit
      await fastBreaker.execute(async () => 'success');
      await fastBreaker.execute(async () => 'success');
      
      assert.strictEqual(fastBreaker.state, CircuitState.CLOSED);
    });
  });

  describe('Event Handling', () => {
    it('should allow unsubscribing from events', async () => {
      let count = 0;
      const unsubscribe = breaker.on('success', () => { count++; });
      
      await breaker.execute(async () => 'success');
      assert.strictEqual(count, 1);
      
      unsubscribe();
      
      await breaker.execute(async () => 'success');
      assert.strictEqual(count, 1); // Should not increment
    });

    it('should emit stateChange event', async () => {
      const changes = [];
      breaker.on('stateChange', (data) => { changes.push(data); });
      
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => { throw new Error('fail'); });
        } catch (e) {}
      }
      
      assert.strictEqual(changes.length, 1);
      assert.strictEqual(changes[0].from, CircuitState.CLOSED);
      assert.strictEqual(changes[0].to, CircuitState.OPEN);
    });
  });

  describe('Reset', () => {
    it('should reset circuit to CLOSED state', async () => {
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => { throw new Error('fail'); });
        } catch (e) {}
      }
      
      assert.strictEqual(breaker.state, CircuitState.OPEN);
      
      breaker.reset();
      
      assert.strictEqual(breaker.state, CircuitState.CLOSED);
    });
  });

  describe('Configuration', () => {
    it('should use default values when no options provided', () => {
      const defaultBreaker = new CircuitBreaker();
      assert.strictEqual(defaultBreaker.failureThreshold, 5);
      assert.strictEqual(defaultBreaker.timeout, 30000);
    });

    it('should accept custom configuration', () => {
      const customBreaker = new CircuitBreaker({
        failureThreshold: 10,
        timeout: 5000
      });
      assert.strictEqual(customBreaker.failureThreshold, 10);
      assert.strictEqual(customBreaker.timeout, 5000);
    });
  });
});
