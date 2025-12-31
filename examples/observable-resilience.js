// ============================================
// OBSERVABLE RESILIENCE - Metrics & Tracing
// ============================================

/**
 * Demonstrates integrating resilience patterns with observability
 * - Prometheus metrics
 * - OpenTelemetry tracing
 * - Structured logging
 */

import {
  CircuitBreaker,
  RetryHandler,
  BackoffStrategy,
  Bulkhead,
  TokenBucketRateLimiter
} from '../src/core/index.js';

console.log('📊 Observable Resilience Patterns Demo\n');
console.log('Demonstrates metrics, tracing, and logging integration\n');

// ============================================
// Metrics Collection (Prometheus-style)
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

  // Export in Prometheus format
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

  printSummary() {
    console.log('\n📈 Metrics Summary:');
    console.log('─'.repeat(50));
    
    console.log('\nCounters:');
    for (const [key, value] of this.counters) {
      console.log(`  ${key}: ${value}`);
    }
    
    console.log('\nGauges:');
    for (const [key, value] of this.gauges) {
      console.log(`  ${key}: ${value}`);
    }
    
    console.log('\nHistograms:');
    for (const [key, values] of this.histograms) {
      if (values.length > 0) {
        const sorted = [...values].sort((a, b) => a - b);
        const p50 = sorted[Math.floor(values.length * 0.5)];
        const p95 = sorted[Math.floor(values.length * 0.95)];
        const p99 = sorted[Math.floor(values.length * 0.99)];
        console.log(`  ${key}: p50=${p50}ms p95=${p95}ms p99=${p99}ms count=${values.length}`);
      }
    }
  }
}

// ============================================
// Tracing (OpenTelemetry-style)
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

  printTraces() {
    console.log('\n🔍 Distributed Traces:');
    console.log('─'.repeat(50));
    
    for (const span of this.spans.slice(-10)) {
      const status = span.status === 'OK' ? '✅' : '❌';
      console.log(`\n${status} [${span.traceId}] ${span.name}`);
      console.log(`   Duration: ${span.duration}ms`);
      console.log(`   Attributes: ${JSON.stringify(span.attributes)}`);
      if (span.events.length > 0) {
        console.log(`   Events:`);
        for (const event of span.events) {
          console.log(`     - ${event.name}: ${JSON.stringify(event.attributes)}`);
        }
      }
    }
  }
}

// ============================================
// Structured Logger
// ============================================

class StructuredLogger {
  constructor(context = {}) {
    this.context = context;
    this.logs = [];
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
    
    const emoji = { debug: '🔧', info: 'ℹ️', warn: '⚠️', error: '❌' };
    console.log(`${emoji[level] || '📝'} [${level.toUpperCase()}] ${message}`, 
      Object.keys(data).length > 0 ? JSON.stringify(data) : '');
  }

  info(message, data) { this.log('info', message, data); }
  warn(message, data) { this.log('warn', message, data); }
  error(message, data) { this.log('error', message, data); }
  debug(message, data) { this.log('debug', message, data); }
}

// ============================================
// Observable Circuit Breaker
// ============================================

class ObservableCircuitBreaker extends CircuitBreaker {
  constructor(options, metrics, tracer, logger) {
    super(options);
    this.metrics = metrics;
    this.tracer = tracer;
    this.logger = logger;
    this.circuitName = options.name || 'default';
    
    // Update gauge on state change
    this._updateStateGauge();
  }

  async execute(fn) {
    const span = this.tracer.startSpan(`circuit_breaker.${this.circuitName}.execute`, {
      'circuit.name': this.circuitName,
      'circuit.state': this.state,
    });
    
    const startTime = Date.now();
    
    try {
      const result = await super.execute(fn);
      
      this.metrics.incCounter('circuit_breaker_requests_total', {
        circuit: this.circuitName,
        result: 'success'
      });
      this.metrics.observeHistogram('circuit_breaker_duration_ms', Date.now() - startTime, {
        circuit: this.circuitName
      });
      
      this.tracer.endSpan(span, 'OK');
      return result;
    } catch (error) {
      const result = error.message.includes('OPEN') ? 'rejected' : 'failure';
      
      this.metrics.incCounter('circuit_breaker_requests_total', {
        circuit: this.circuitName,
        result
      });
      
      this.tracer.addEvent(span, 'error', { message: error.message });
      this.tracer.endSpan(span, 'ERROR');
      
      if (result === 'rejected') {
        this.logger.warn('Circuit breaker rejected request', {
          circuit: this.circuitName,
          state: this.state,
        });
      }
      
      throw error;
    }
  }

  _updateStateGauge() {
    const stateMap = { 'CLOSED': 0, 'HALF_OPEN': 1, 'OPEN': 2 };
    this.metrics.setGauge('circuit_breaker_state', stateMap[this.state], {
      circuit: this.circuitName
    });
  }

  // Override state transitions to emit metrics
  on(event, handler) {
    super.on(event, (...args) => {
      if (event === 'open' || event === 'close' || event === 'halfOpen') {
        this.metrics.incCounter('circuit_breaker_state_transitions_total', {
          circuit: this.circuitName,
          to_state: event === 'halfOpen' ? 'HALF_OPEN' : event.toUpperCase()
        });
        this._updateStateGauge();
        
        this.logger.info(`Circuit breaker state changed`, {
          circuit: this.circuitName,
          event,
          newState: this.state,
        });
      }
      handler(...args);
    });
  }
}

// ============================================
// Observable Retry Handler
// ============================================

class ObservableRetryHandler extends RetryHandler {
  constructor(options, metrics, tracer, logger) {
    super(options);
    this.metrics = metrics;
    this.tracer = tracer;
    this.logger = logger;
    this.operationName = options.name || 'default';
  }

  async execute(fn) {
    const span = this.tracer.startSpan(`retry.${this.operationName}.execute`, {
      'retry.max_attempts': this.maxAttempts,
      'retry.strategy': this.strategy,
    });
    
    let lastError;
    let attemptNumber = 0;
    
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      attemptNumber = attempt;
      
      this.tracer.addEvent(span, 'attempt_start', { attempt });
      
      try {
        const result = await fn();
        
        this.metrics.incCounter('retry_requests_total', {
          operation: this.operationName,
          result: 'success'
        });
        
        if (attempt > 1) {
          this.metrics.incCounter('retry_attempts_total', {
            operation: this.operationName,
          });
          this.logger.info('Retry succeeded', {
            operation: this.operationName,
            attemptNumber: attempt,
          });
        }
        
        span.attributes['retry.attempts'] = attempt;
        this.tracer.endSpan(span, 'OK');
        return result;
      } catch (error) {
        lastError = error;
        
        this.tracer.addEvent(span, 'attempt_failed', {
          attempt,
          error: error.message,
        });
        
        if (attempt < this.maxAttempts) {
          const delay = this._calculateDelay(attempt);
          
          this.metrics.observeHistogram('retry_delay_ms', delay, {
            operation: this.operationName
          });
          
          this.logger.debug('Retrying after delay', {
            operation: this.operationName,
            attempt,
            delay,
            error: error.message,
          });
          
          await this._sleep(delay);
        }
      }
    }
    
    this.metrics.incCounter('retry_requests_total', {
      operation: this.operationName,
      result: 'exhausted'
    });
    
    this.logger.error('Retry exhausted', {
      operation: this.operationName,
      attempts: attemptNumber,
      error: lastError.message,
    });
    
    span.attributes['retry.exhausted'] = true;
    this.tracer.endSpan(span, 'ERROR');
    throw lastError;
  }

  _calculateDelay(attempt) {
    const baseDelay = this.baseDelay || 100;
    return baseDelay * Math.pow(2, attempt - 1);
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================
// Demo
// ============================================

async function runDemo() {
  // Initialize observability
  const metrics = new MetricsCollector();
  const tracer = new Tracer('resilience-demo');
  const logger = new StructuredLogger({ service: 'demo' });

  console.log('1️⃣  Creating observable circuit breaker...\n');
  
  const circuitBreaker = new ObservableCircuitBreaker({
    name: 'payment-service',
    failureThreshold: 3,
    successThreshold: 2,
    timeout: 5000,
  }, metrics, tracer, logger);

  // Set up state change handlers
  circuitBreaker.on('open', () => {
    console.log('   🔴 Circuit OPENED!');
  });
  circuitBreaker.on('halfOpen', () => {
    console.log('   🟡 Circuit HALF-OPEN');
  });
  circuitBreaker.on('close', () => {
    console.log('   🟢 Circuit CLOSED');
  });

  // Simulate some requests
  console.log('\n2️⃣  Simulating requests through circuit breaker...\n');

  const simulateRequest = async (shouldFail = false) => {
    return circuitBreaker.execute(async () => {
      await new Promise(r => setTimeout(r, Math.random() * 100));
      if (shouldFail) {
        throw new Error('Service unavailable');
      }
      return { success: true };
    });
  };

  // Successful requests
  for (let i = 0; i < 5; i++) {
    try {
      await simulateRequest(false);
      console.log(`   Request ${i + 1}: ✅ Success`);
    } catch (error) {
      console.log(`   Request ${i + 1}: ❌ ${error.message}`);
    }
  }

  // Failing requests to trip circuit
  console.log('\n   Injecting failures...');
  for (let i = 0; i < 5; i++) {
    try {
      await simulateRequest(true);
    } catch (error) {
      console.log(`   Failure ${i + 1}: ❌ ${error.message}`);
    }
  }

  // Requests while circuit is open
  console.log('\n   Requests while circuit is open...');
  for (let i = 0; i < 3; i++) {
    try {
      await simulateRequest(false);
    } catch (error) {
      console.log(`   Rejected ${i + 1}: ⛔ ${error.message}`);
    }
  }

  // Demo retry with observability
  console.log('\n3️⃣  Creating observable retry handler...\n');

  const retryHandler = new ObservableRetryHandler({
    name: 'database-query',
    maxAttempts: 3,
    baseDelay: 100,
    strategy: BackoffStrategy.EXPONENTIAL,
  }, metrics, tracer, logger);

  // Simulate retry scenario
  let failCount = 0;
  const flakyOperation = async () => {
    failCount++;
    if (failCount < 3) {
      throw new Error('Temporary database error');
    }
    return { data: 'success' };
  };

  try {
    console.log('   Executing flaky operation with retries...');
    const result = await retryHandler.execute(flakyOperation);
    console.log(`   ✅ Operation succeeded: ${JSON.stringify(result)}`);
  } catch (error) {
    console.log(`   ❌ Operation failed: ${error.message}`);
  }

  // Demo exhausted retries
  console.log('\n   Executing always-failing operation...');
  try {
    await retryHandler.execute(async () => {
      throw new Error('Permanent failure');
    });
  } catch (error) {
    console.log(`   ❌ Expected exhaustion: ${error.message}`);
  }

  // Print observability data
  console.log('\n' + '═'.repeat(60));
  metrics.printSummary();
  tracer.printTraces();

  console.log('\n' + '═'.repeat(60));
  console.log('\n📊 Prometheus Export Format:');
  console.log('─'.repeat(50));
  console.log(metrics.export());
}

// Run the demo
runDemo().catch(console.error);
