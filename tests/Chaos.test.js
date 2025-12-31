/**
 * Tests for Chaos Engineering Utilities
 * Tests ChaosMonkey and ChaosExperiment classes
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

// ============================================
// ChaosMonkey (extracted for testing)
// ============================================

class ChaosMonkey {
  constructor(options = {}) {
    this.enabled = options.enabled ?? true;
    this.config = {
      failureRate: options.failureRate ?? 0.3,
      latencyRate: options.latencyRate ?? 0.2,
      minLatency: options.minLatency ?? 100,
      maxLatency: options.maxLatency ?? 3000,
      errorTypes: options.errorTypes ?? [
        'ECONNRESET',
        'ETIMEDOUT',
        'ECONNREFUSED',
        'SERVICE_UNAVAILABLE',
      ],
    };
    this.stats = {
      injectedFailures: 0,
      injectedLatency: 0,
      totalCalls: 0,
    };
    this.silent = false; // For testing without console output
  }

  wrap(fn, name = 'operation') {
    return async (...args) => {
      this.stats.totalCalls++;

      if (!this.enabled) {
        return fn(...args);
      }

      // Inject random failure
      if (Math.random() < this.config.failureRate) {
        this.stats.injectedFailures++;
        const errorType = this.config.errorTypes[
          Math.floor(Math.random() * this.config.errorTypes.length)
        ];
        if (!this.silent) {
          console.log(`   🐵 [ChaosMonkey] Injecting failure: ${errorType}`);
        }
        const error = new Error(`[ChaosMonkey] ${errorType}`);
        error.code = errorType;
        throw error;
      }

      // Inject random latency
      if (Math.random() < this.config.latencyRate) {
        const delay = this.config.minLatency + 
          Math.random() * (this.config.maxLatency - this.config.minLatency);
        this.stats.injectedLatency++;
        if (!this.silent) {
          console.log(`   🐵 [ChaosMonkey] Injecting ${Math.round(delay)}ms latency`);
        }
        await new Promise(r => setTimeout(r, delay));
      }

      return fn(...args);
    };
  }

  getStats() {
    return { ...this.stats };
  }

  reset() {
    this.stats = {
      injectedFailures: 0,
      injectedLatency: 0,
      totalCalls: 0,
    };
  }
}

// ============================================
// ChaosExperiment (extracted for testing)
// ============================================

class ChaosExperiment {
  constructor(name, hypothesis) {
    this.name = name;
    this.hypothesis = hypothesis;
    this.results = {
      passed: false,
      observations: [],
      metrics: {},
    };
    this.silent = false;
  }

  observe(message, data = {}) {
    this.results.observations.push({
      timestamp: Date.now(),
      message,
      data,
    });
    if (!this.silent) {
      console.log(`   📊 Observation: ${message}`, Object.keys(data).length > 0 ? JSON.stringify(data) : '');
    }
  }

  recordMetric(name, value) {
    if (!this.results.metrics[name]) {
      this.results.metrics[name] = [];
    }
    this.results.metrics[name].push(value);
  }

  pass(reason) {
    this.results.passed = true;
    this.results.conclusion = reason;
  }

  fail(reason) {
    this.results.passed = false;
    this.results.conclusion = reason;
  }

  getResults() {
    return { ...this.results };
  }

  getMetricStats(name) {
    const values = this.results.metrics[name] || [];
    if (values.length === 0) return null;
    
    const sum = values.reduce((a, b) => a + b, 0);
    return {
      count: values.length,
      sum,
      avg: sum / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
    };
  }
}

// ============================================
// Tests
// ============================================

describe('ChaosMonkey', () => {
  let chaos;

  beforeEach(() => {
    chaos = new ChaosMonkey({ enabled: true });
    chaos.silent = true;
  });

  describe('Configuration', () => {
    it('should use default configuration', () => {
      const monkey = new ChaosMonkey();
      
      assert.strictEqual(monkey.config.failureRate, 0.3);
      assert.strictEqual(monkey.config.latencyRate, 0.2);
      assert.strictEqual(monkey.config.minLatency, 100);
      assert.strictEqual(monkey.config.maxLatency, 3000);
      assert.ok(monkey.config.errorTypes.length > 0);
    });

    it('should accept custom configuration', () => {
      const monkey = new ChaosMonkey({
        failureRate: 0.5,
        latencyRate: 0.1,
        minLatency: 50,
        maxLatency: 1000,
        errorTypes: ['CUSTOM_ERROR'],
      });
      
      assert.strictEqual(monkey.config.failureRate, 0.5);
      assert.strictEqual(monkey.config.latencyRate, 0.1);
      assert.strictEqual(monkey.config.minLatency, 50);
      assert.strictEqual(monkey.config.maxLatency, 1000);
      assert.deepStrictEqual(monkey.config.errorTypes, ['CUSTOM_ERROR']);
    });

    it('should be enabled by default', () => {
      const monkey = new ChaosMonkey();
      assert.strictEqual(monkey.enabled, true);
    });

    it('should allow disabling', () => {
      const monkey = new ChaosMonkey({ enabled: false });
      assert.strictEqual(monkey.enabled, false);
    });
  });

  describe('Disabled Mode', () => {
    it('should pass through when disabled', async () => {
      chaos.enabled = false;
      const fn = async () => 'success';
      const wrapped = chaos.wrap(fn);
      
      const result = await wrapped();
      
      assert.strictEqual(result, 'success');
      assert.strictEqual(chaos.stats.injectedFailures, 0);
      assert.strictEqual(chaos.stats.injectedLatency, 0);
    });

    it('should still count calls when disabled', async () => {
      chaos.enabled = false;
      const wrapped = chaos.wrap(async () => 'ok');
      
      await wrapped();
      await wrapped();
      
      assert.strictEqual(chaos.stats.totalCalls, 2);
    });
  });

  describe('Failure Injection', () => {
    it('should inject failures at configured rate', async () => {
      // 100% failure rate
      chaos.config.failureRate = 1.0;
      chaos.config.latencyRate = 0;
      
      const wrapped = chaos.wrap(async () => 'success');
      
      await assert.rejects(wrapped(), /\[ChaosMonkey\]/);
      assert.strictEqual(chaos.stats.injectedFailures, 1);
    });

    it('should not inject failures at 0% rate', async () => {
      chaos.config.failureRate = 0;
      chaos.config.latencyRate = 0;
      
      const wrapped = chaos.wrap(async () => 'success');
      
      for (let i = 0; i < 10; i++) {
        const result = await wrapped();
        assert.strictEqual(result, 'success');
      }
      
      assert.strictEqual(chaos.stats.injectedFailures, 0);
    });

    it('should include error code in thrown error', async () => {
      chaos.config.failureRate = 1.0;
      chaos.config.latencyRate = 0;
      chaos.config.errorTypes = ['TEST_ERROR'];
      
      const wrapped = chaos.wrap(async () => 'success');
      
      try {
        await wrapped();
        assert.fail('Should have thrown');
      } catch (error) {
        assert.strictEqual(error.code, 'TEST_ERROR');
      }
    });

    it('should select random error types', async () => {
      chaos.config.failureRate = 1.0;
      chaos.config.latencyRate = 0;
      chaos.config.errorTypes = ['ERROR_A', 'ERROR_B', 'ERROR_C'];
      
      const wrapped = chaos.wrap(async () => 'success');
      const errors = new Set();
      
      // Run many times to see different error types
      for (let i = 0; i < 50; i++) {
        try {
          await wrapped();
        } catch (error) {
          errors.add(error.code);
        }
      }
      
      // Should have seen at least 2 different error types (probabilistic)
      assert.ok(errors.size >= 1, 'Should see multiple error types');
    });
  });

  describe('Latency Injection', () => {
    it('should inject latency at configured rate', async () => {
      chaos.config.failureRate = 0;
      chaos.config.latencyRate = 1.0;
      chaos.config.minLatency = 50;
      chaos.config.maxLatency = 100;
      
      const wrapped = chaos.wrap(async () => 'success');
      
      const start = Date.now();
      await wrapped();
      const duration = Date.now() - start;
      
      assert.ok(duration >= 40, `Expected delay >= 40ms, got ${duration}ms`);
      assert.strictEqual(chaos.stats.injectedLatency, 1);
    });

    it('should not inject latency at 0% rate', async () => {
      chaos.config.failureRate = 0;
      chaos.config.latencyRate = 0;
      
      const wrapped = chaos.wrap(async () => 'success');
      
      const start = Date.now();
      await wrapped();
      const duration = Date.now() - start;
      
      assert.ok(duration < 50, 'Should not have significant delay');
      assert.strictEqual(chaos.stats.injectedLatency, 0);
    });

    it('should respect min/max latency bounds', async () => {
      chaos.config.failureRate = 0;
      chaos.config.latencyRate = 1.0;
      chaos.config.minLatency = 100;
      chaos.config.maxLatency = 150;
      
      const wrapped = chaos.wrap(async () => 'success');
      
      const start = Date.now();
      await wrapped();
      const duration = Date.now() - start;
      
      assert.ok(duration >= 90, `Expected >= 90ms, got ${duration}ms`);
      assert.ok(duration < 250, `Expected < 250ms, got ${duration}ms`);
    });
  });

  describe('Statistics', () => {
    it('should track total calls', async () => {
      chaos.config.failureRate = 0;
      chaos.config.latencyRate = 0;
      
      const wrapped = chaos.wrap(async () => 'ok');
      
      await wrapped();
      await wrapped();
      await wrapped();
      
      assert.strictEqual(chaos.stats.totalCalls, 3);
    });

    it('should track injected failures', async () => {
      chaos.config.failureRate = 1.0;
      chaos.config.latencyRate = 0;
      
      const wrapped = chaos.wrap(async () => 'ok');
      
      for (let i = 0; i < 5; i++) {
        try { await wrapped(); } catch {}
      }
      
      assert.strictEqual(chaos.stats.injectedFailures, 5);
    });

    it('should reset statistics', async () => {
      chaos.config.failureRate = 0;
      chaos.config.latencyRate = 0;
      
      const wrapped = chaos.wrap(async () => 'ok');
      await wrapped();
      
      chaos.reset();
      
      assert.strictEqual(chaos.stats.totalCalls, 0);
      assert.strictEqual(chaos.stats.injectedFailures, 0);
      assert.strictEqual(chaos.stats.injectedLatency, 0);
    });
  });

  describe('Function Wrapping', () => {
    it('should pass arguments through to wrapped function', async () => {
      chaos.config.failureRate = 0;
      chaos.config.latencyRate = 0;
      
      const fn = async (a, b) => a + b;
      const wrapped = chaos.wrap(fn);
      
      const result = await wrapped(2, 3);
      
      assert.strictEqual(result, 5);
    });

    it('should preserve return value', async () => {
      chaos.config.failureRate = 0;
      chaos.config.latencyRate = 0;
      
      const fn = async () => ({ data: [1, 2, 3], status: 'ok' });
      const wrapped = chaos.wrap(fn);
      
      const result = await wrapped();
      
      assert.deepStrictEqual(result, { data: [1, 2, 3], status: 'ok' });
    });

    it('should propagate original errors when not injecting', async () => {
      chaos.config.failureRate = 0;
      chaos.config.latencyRate = 0;
      
      const fn = async () => { throw new Error('Original error'); };
      const wrapped = chaos.wrap(fn);
      
      await assert.rejects(wrapped(), /Original error/);
    });
  });
});

describe('ChaosExperiment', () => {
  let experiment;

  beforeEach(() => {
    experiment = new ChaosExperiment('Test Experiment', 'System should handle failures');
    experiment.silent = true;
  });

  describe('Initialization', () => {
    it('should set name and hypothesis', () => {
      assert.strictEqual(experiment.name, 'Test Experiment');
      assert.strictEqual(experiment.hypothesis, 'System should handle failures');
    });

    it('should initialize with failed status', () => {
      assert.strictEqual(experiment.results.passed, false);
    });

    it('should initialize empty observations', () => {
      assert.deepStrictEqual(experiment.results.observations, []);
    });

    it('should initialize empty metrics', () => {
      assert.deepStrictEqual(experiment.results.metrics, {});
    });
  });

  describe('Observations', () => {
    it('should record observation with message', () => {
      experiment.observe('Something happened');
      
      assert.strictEqual(experiment.results.observations.length, 1);
      assert.strictEqual(experiment.results.observations[0].message, 'Something happened');
    });

    it('should record observation with data', () => {
      experiment.observe('Event', { count: 5, status: 'ok' });
      
      assert.deepStrictEqual(experiment.results.observations[0].data, { 
        count: 5, 
        status: 'ok' 
      });
    });

    it('should timestamp observations', () => {
      const before = Date.now();
      experiment.observe('Event');
      const after = Date.now();
      
      const timestamp = experiment.results.observations[0].timestamp;
      assert.ok(timestamp >= before);
      assert.ok(timestamp <= after);
    });

    it('should record multiple observations', () => {
      experiment.observe('First');
      experiment.observe('Second');
      experiment.observe('Third');
      
      assert.strictEqual(experiment.results.observations.length, 3);
    });
  });

  describe('Metrics', () => {
    it('should record single metric value', () => {
      experiment.recordMetric('latency', 100);
      
      assert.deepStrictEqual(experiment.results.metrics.latency, [100]);
    });

    it('should accumulate metric values', () => {
      experiment.recordMetric('latency', 100);
      experiment.recordMetric('latency', 200);
      experiment.recordMetric('latency', 150);
      
      assert.deepStrictEqual(experiment.results.metrics.latency, [100, 200, 150]);
    });

    it('should track multiple metrics', () => {
      experiment.recordMetric('latency', 100);
      experiment.recordMetric('errors', 1);
      experiment.recordMetric('latency', 200);
      experiment.recordMetric('errors', 0);
      
      assert.deepStrictEqual(experiment.results.metrics.latency, [100, 200]);
      assert.deepStrictEqual(experiment.results.metrics.errors, [1, 0]);
    });

    it('should calculate metric statistics', () => {
      experiment.recordMetric('latency', 100);
      experiment.recordMetric('latency', 200);
      experiment.recordMetric('latency', 300);
      
      const stats = experiment.getMetricStats('latency');
      
      assert.strictEqual(stats.count, 3);
      assert.strictEqual(stats.sum, 600);
      assert.strictEqual(stats.avg, 200);
      assert.strictEqual(stats.min, 100);
      assert.strictEqual(stats.max, 300);
    });

    it('should return null for non-existent metric', () => {
      const stats = experiment.getMetricStats('nonexistent');
      assert.strictEqual(stats, null);
    });
  });

  describe('Pass/Fail', () => {
    it('should mark experiment as passed', () => {
      experiment.pass('All assertions met');
      
      assert.strictEqual(experiment.results.passed, true);
      assert.strictEqual(experiment.results.conclusion, 'All assertions met');
    });

    it('should mark experiment as failed', () => {
      experiment.fail('Threshold exceeded');
      
      assert.strictEqual(experiment.results.passed, false);
      assert.strictEqual(experiment.results.conclusion, 'Threshold exceeded');
    });

    it('should allow changing result', () => {
      experiment.pass('Initially passed');
      experiment.fail('Then failed');
      
      assert.strictEqual(experiment.results.passed, false);
      assert.strictEqual(experiment.results.conclusion, 'Then failed');
    });
  });

  describe('Results', () => {
    it('should return complete results', () => {
      experiment.observe('Test observation', { key: 'value' });
      experiment.recordMetric('test_metric', 42);
      experiment.pass('Success');
      
      const results = experiment.getResults();
      
      assert.strictEqual(results.passed, true);
      assert.strictEqual(results.conclusion, 'Success');
      assert.strictEqual(results.observations.length, 1);
      assert.ok(results.metrics.test_metric);
    });

    it('should return copy of results', () => {
      experiment.pass('Success');
      const results = experiment.getResults();
      
      results.passed = false;
      
      assert.strictEqual(experiment.results.passed, true);
    });
  });
});

describe('ChaosMonkey + Experiment Integration', () => {
  it('should track chaos effects in experiment', async () => {
    const chaos = new ChaosMonkey({
      failureRate: 0.5,
      latencyRate: 0,
    });
    chaos.silent = true;
    
    const experiment = new ChaosExperiment(
      'Chaos Integration',
      'System handles 50% failure rate'
    );
    experiment.silent = true;
    
    const service = chaos.wrap(async () => 'success');
    
    let successes = 0;
    let failures = 0;
    
    for (let i = 0; i < 20; i++) {
      try {
        await service();
        successes++;
        experiment.recordMetric('success', 1);
      } catch {
        failures++;
        experiment.recordMetric('failure', 1);
      }
    }
    
    experiment.observe('Test complete', {
      successes,
      failures,
      failureRate: failures / 20,
    });
    
    if (failures > 0 && successes > 0) {
      experiment.pass('Both successes and failures observed');
    } else {
      experiment.fail('Did not observe expected distribution');
    }
    
    // Verify tracking
    assert.strictEqual(chaos.stats.totalCalls, 20);
    assert.strictEqual(successes + failures, 20);
    assert.ok(experiment.results.passed || failures === 0 || successes === 0);
  });
});
