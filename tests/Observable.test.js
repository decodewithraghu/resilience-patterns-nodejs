/**
 * Tests for Observable Resilience Utilities
 * Tests MetricsCollector, Tracer, and StructuredLogger classes
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

// ============================================
// MetricsCollector (extracted for testing)
// ============================================

class MetricsCollector {
  constructor() {
    this.counters = new Map();
    this.gauges = new Map();
    this.histograms = new Map();
  }

  incCounter(name, labels = {}) {
    const key = this._key(name, labels);
    this.counters.set(key, (this.counters.get(key) || 0) + 1);
  }

  setGauge(name, value, labels = {}) {
    const key = this._key(name, labels);
    this.gauges.set(key, value);
  }

  observeHistogram(name, value, labels = {}) {
    const key = this._key(name, labels);
    if (!this.histograms.has(key)) {
      this.histograms.set(key, []);
    }
    this.histograms.get(key).push(value);
  }

  _key(name, labels) {
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    return labelStr ? `${name}{${labelStr}}` : name;
  }

  export() {
    const lines = [];
    
    for (const [key, value] of this.counters) {
      lines.push(`${key} ${value}`);
    }
    
    for (const [key, value] of this.gauges) {
      lines.push(`${key} ${value}`);
    }
    
    for (const [key, values] of this.histograms) {
      const sum = values.reduce((a, b) => a + b, 0);
      const count = values.length;
      const sorted = [...values].sort((a, b) => a - b);
      
      lines.push(`${key}_sum ${sum}`);
      lines.push(`${key}_count ${count}`);
      lines.push(`${key}_p50 ${sorted[Math.floor(count * 0.5)] || 0}`);
      lines.push(`${key}_p95 ${sorted[Math.floor(count * 0.95)] || 0}`);
      lines.push(`${key}_p99 ${sorted[Math.floor(count * 0.99)] || 0}`);
    }
    
    return lines.join('\n');
  }

  reset() {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }
}

// ============================================
// Tracer (extracted for testing)
// ============================================

class Tracer {
  constructor(serviceName) {
    this.serviceName = serviceName;
    this.spans = [];
  }

  startSpan(name, attributes = {}) {
    const span = {
      traceId: Math.random().toString(36).substring(7),
      spanId: Math.random().toString(36).substring(7),
      name,
      serviceName: this.serviceName,
      startTime: Date.now(),
      endTime: null,
      attributes,
      status: 'OK',
      events: [],
    };
    this.spans.push(span);
    return span;
  }

  endSpan(span, status = 'OK') {
    span.endTime = Date.now();
    span.status = status;
    span.duration = span.endTime - span.startTime;
  }

  addEvent(span, name, attributes = {}) {
    span.events.push({
      name,
      timestamp: Date.now(),
      attributes,
    });
  }

  getSpans() {
    return this.spans;
  }

  clear() {
    this.spans = [];
  }
}

// ============================================
// StructuredLogger (extracted for testing)
// ============================================

class StructuredLogger {
  constructor(context = {}) {
    this.context = context;
    this.logs = [];
    this.silent = false; // For testing without console output
  }

  log(level, message, data = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...this.context,
      ...data,
    };
    this.logs.push(entry);
    
    if (!this.silent) {
      const emoji = { debug: '🔧', info: 'ℹ️', warn: '⚠️', error: '❌' };
      console.log(`${emoji[level] || '📝'} [${level.toUpperCase()}] ${message}`, 
        Object.keys(data).length > 0 ? JSON.stringify(data) : '');
    }
  }

  info(message, data) { this.log('info', message, data); }
  warn(message, data) { this.log('warn', message, data); }
  error(message, data) { this.log('error', message, data); }
  debug(message, data) { this.log('debug', message, data); }

  getLogs() { return this.logs; }
  clear() { this.logs = []; }
}

// ============================================
// Tests
// ============================================

describe('MetricsCollector', () => {
  let metrics;

  beforeEach(() => {
    metrics = new MetricsCollector();
  });

  describe('Counters', () => {
    it('should increment counter by 1', () => {
      metrics.incCounter('requests_total');
      assert.strictEqual(metrics.counters.get('requests_total'), 1);
    });

    it('should increment counter multiple times', () => {
      metrics.incCounter('requests_total');
      metrics.incCounter('requests_total');
      metrics.incCounter('requests_total');
      assert.strictEqual(metrics.counters.get('requests_total'), 3);
    });

    it('should handle counters with labels', () => {
      metrics.incCounter('requests_total', { method: 'GET', status: '200' });
      metrics.incCounter('requests_total', { method: 'POST', status: '201' });
      
      assert.strictEqual(metrics.counters.get('requests_total{method="GET",status="200"}'), 1);
      assert.strictEqual(metrics.counters.get('requests_total{method="POST",status="201"}'), 1);
    });

    it('should sort labels alphabetically', () => {
      metrics.incCounter('requests_total', { status: '200', method: 'GET' });
      // Labels should be sorted: method before status
      assert.strictEqual(metrics.counters.get('requests_total{method="GET",status="200"}'), 1);
    });
  });

  describe('Gauges', () => {
    it('should set gauge value', () => {
      metrics.setGauge('temperature', 42);
      assert.strictEqual(metrics.gauges.get('temperature'), 42);
    });

    it('should overwrite gauge value', () => {
      metrics.setGauge('temperature', 42);
      metrics.setGauge('temperature', 100);
      assert.strictEqual(metrics.gauges.get('temperature'), 100);
    });

    it('should handle gauges with labels', () => {
      metrics.setGauge('circuit_state', 0, { circuit: 'payment' });
      metrics.setGauge('circuit_state', 2, { circuit: 'inventory' });
      
      assert.strictEqual(metrics.gauges.get('circuit_state{circuit="payment"}'), 0);
      assert.strictEqual(metrics.gauges.get('circuit_state{circuit="inventory"}'), 2);
    });
  });

  describe('Histograms', () => {
    it('should observe histogram values', () => {
      metrics.observeHistogram('latency_ms', 100);
      metrics.observeHistogram('latency_ms', 200);
      
      const values = metrics.histograms.get('latency_ms');
      assert.deepStrictEqual(values, [100, 200]);
    });

    it('should handle histograms with labels', () => {
      metrics.observeHistogram('latency_ms', 100, { endpoint: '/api' });
      metrics.observeHistogram('latency_ms', 50, { endpoint: '/health' });
      
      assert.deepStrictEqual(metrics.histograms.get('latency_ms{endpoint="/api"}'), [100]);
      assert.deepStrictEqual(metrics.histograms.get('latency_ms{endpoint="/health"}'), [50]);
    });

    it('should accumulate multiple observations', () => {
      for (let i = 1; i <= 100; i++) {
        metrics.observeHistogram('latency_ms', i);
      }
      
      const values = metrics.histograms.get('latency_ms');
      assert.strictEqual(values.length, 100);
    });
  });

  describe('Export', () => {
    it('should export counters in Prometheus format', () => {
      metrics.incCounter('requests_total');
      metrics.incCounter('requests_total');
      
      const output = metrics.export();
      assert.ok(output.includes('requests_total 2'));
    });

    it('should export gauges in Prometheus format', () => {
      metrics.setGauge('circuit_state', 2, { name: 'payment' });
      
      const output = metrics.export();
      assert.ok(output.includes('circuit_state{name="payment"} 2'));
    });

    it('should export histogram percentiles', () => {
      // Add 100 values from 1 to 100
      for (let i = 1; i <= 100; i++) {
        metrics.observeHistogram('latency_ms', i);
      }
      
      const output = metrics.export();
      assert.ok(output.includes('latency_ms_sum 5050')); // Sum of 1 to 100
      assert.ok(output.includes('latency_ms_count 100'));
      assert.ok(output.includes('latency_ms_p50'));
      assert.ok(output.includes('latency_ms_p95'));
      assert.ok(output.includes('latency_ms_p99'));
    });

    it('should handle empty metrics', () => {
      const output = metrics.export();
      assert.strictEqual(output, '');
    });
  });

  describe('Key Generation', () => {
    it('should generate key without labels', () => {
      const key = metrics._key('metric_name', {});
      assert.strictEqual(key, 'metric_name');
    });

    it('should generate key with single label', () => {
      const key = metrics._key('metric_name', { env: 'prod' });
      assert.strictEqual(key, 'metric_name{env="prod"}');
    });

    it('should generate key with multiple sorted labels', () => {
      const key = metrics._key('metric_name', { z: '1', a: '2', m: '3' });
      assert.strictEqual(key, 'metric_name{a="2",m="3",z="1"}');
    });
  });
});

describe('Tracer', () => {
  let tracer;

  beforeEach(() => {
    tracer = new Tracer('test-service');
  });

  describe('Span Creation', () => {
    it('should create span with name', () => {
      const span = tracer.startSpan('operation');
      
      assert.strictEqual(span.name, 'operation');
      assert.strictEqual(span.serviceName, 'test-service');
      assert.ok(span.traceId);
      assert.ok(span.spanId);
    });

    it('should create span with attributes', () => {
      const span = tracer.startSpan('operation', { key: 'value' });
      
      assert.deepStrictEqual(span.attributes, { key: 'value' });
    });

    it('should set start time', () => {
      const before = Date.now();
      const span = tracer.startSpan('operation');
      const after = Date.now();
      
      assert.ok(span.startTime >= before);
      assert.ok(span.startTime <= after);
    });

    it('should initialize span with OK status', () => {
      const span = tracer.startSpan('operation');
      assert.strictEqual(span.status, 'OK');
    });

    it('should store spans', () => {
      tracer.startSpan('op1');
      tracer.startSpan('op2');
      
      assert.strictEqual(tracer.spans.length, 2);
    });
  });

  describe('Span Completion', () => {
    it('should end span with OK status by default', () => {
      const span = tracer.startSpan('operation');
      tracer.endSpan(span);
      
      assert.strictEqual(span.status, 'OK');
      assert.ok(span.endTime);
    });

    it('should end span with custom status', () => {
      const span = tracer.startSpan('operation');
      tracer.endSpan(span, 'ERROR');
      
      assert.strictEqual(span.status, 'ERROR');
    });

    it('should calculate duration', async () => {
      const span = tracer.startSpan('operation');
      await new Promise(r => setTimeout(r, 50));
      tracer.endSpan(span);
      
      assert.ok(span.duration >= 40); // Allow some timing variance
      assert.ok(span.duration < 200);
    });
  });

  describe('Span Events', () => {
    it('should add event to span', () => {
      const span = tracer.startSpan('operation');
      tracer.addEvent(span, 'checkpoint');
      
      assert.strictEqual(span.events.length, 1);
      assert.strictEqual(span.events[0].name, 'checkpoint');
    });

    it('should add event with attributes', () => {
      const span = tracer.startSpan('operation');
      tracer.addEvent(span, 'error', { message: 'Something failed' });
      
      assert.deepStrictEqual(span.events[0].attributes, { message: 'Something failed' });
    });

    it('should timestamp events', () => {
      const span = tracer.startSpan('operation');
      const before = Date.now();
      tracer.addEvent(span, 'checkpoint');
      const after = Date.now();
      
      assert.ok(span.events[0].timestamp >= before);
      assert.ok(span.events[0].timestamp <= after);
    });

    it('should support multiple events', () => {
      const span = tracer.startSpan('operation');
      tracer.addEvent(span, 'start');
      tracer.addEvent(span, 'middle');
      tracer.addEvent(span, 'end');
      
      assert.strictEqual(span.events.length, 3);
    });
  });

  describe('Trace IDs', () => {
    it('should generate unique trace IDs', () => {
      const span1 = tracer.startSpan('op1');
      const span2 = tracer.startSpan('op2');
      
      assert.notStrictEqual(span1.traceId, span2.traceId);
    });

    it('should generate unique span IDs', () => {
      const span1 = tracer.startSpan('op1');
      const span2 = tracer.startSpan('op2');
      
      assert.notStrictEqual(span1.spanId, span2.spanId);
    });
  });
});

describe('StructuredLogger', () => {
  let logger;

  beforeEach(() => {
    logger = new StructuredLogger({ service: 'test-service' });
    logger.silent = true; // Suppress console output in tests
  });

  describe('Log Levels', () => {
    it('should log info messages', () => {
      logger.info('Test message');
      
      assert.strictEqual(logger.logs.length, 1);
      assert.strictEqual(logger.logs[0].level, 'info');
      assert.strictEqual(logger.logs[0].message, 'Test message');
    });

    it('should log warn messages', () => {
      logger.warn('Warning message');
      
      assert.strictEqual(logger.logs[0].level, 'warn');
    });

    it('should log error messages', () => {
      logger.error('Error message');
      
      assert.strictEqual(logger.logs[0].level, 'error');
    });

    it('should log debug messages', () => {
      logger.debug('Debug message');
      
      assert.strictEqual(logger.logs[0].level, 'debug');
    });
  });

  describe('Context', () => {
    it('should include context in all logs', () => {
      logger.info('Test');
      logger.warn('Test');
      
      assert.strictEqual(logger.logs[0].service, 'test-service');
      assert.strictEqual(logger.logs[1].service, 'test-service');
    });

    it('should support multiple context fields', () => {
      const multiLogger = new StructuredLogger({ 
        service: 'api', 
        version: '1.0',
        env: 'test'
      });
      multiLogger.silent = true;
      multiLogger.info('Test');
      
      assert.strictEqual(multiLogger.logs[0].service, 'api');
      assert.strictEqual(multiLogger.logs[0].version, '1.0');
      assert.strictEqual(multiLogger.logs[0].env, 'test');
    });
  });

  describe('Additional Data', () => {
    it('should merge additional data into log entry', () => {
      logger.info('Request received', { requestId: '123', method: 'GET' });
      
      assert.strictEqual(logger.logs[0].requestId, '123');
      assert.strictEqual(logger.logs[0].method, 'GET');
    });

    it('should override context with additional data', () => {
      logger.info('Test', { service: 'overridden' });
      
      assert.strictEqual(logger.logs[0].service, 'overridden');
    });
  });

  describe('Timestamp', () => {
    it('should add ISO timestamp to logs', () => {
      logger.info('Test');
      
      assert.ok(logger.logs[0].timestamp);
      // Verify it's a valid ISO date
      const date = new Date(logger.logs[0].timestamp);
      assert.ok(!isNaN(date.getTime()));
    });
  });

  describe('Log Retrieval', () => {
    it('should retrieve all logs', () => {
      logger.info('First');
      logger.warn('Second');
      logger.error('Third');
      
      const logs = logger.getLogs();
      assert.strictEqual(logs.length, 3);
    });

    it('should clear logs', () => {
      logger.info('Test');
      logger.clear();
      
      assert.strictEqual(logger.logs.length, 0);
    });
  });
});
