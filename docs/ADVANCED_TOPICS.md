# Advanced Resilience Topics

This guide covers advanced topics for building production-grade resilient systems:
- Observability (metrics, tracing, logging)
- Chaos engineering
- Microservices architecture patterns
- Real-world case studies

---

## 📊 1. Observability: Metrics, Tracing & Logging

Observability is essential for understanding resilience patterns in production. The three pillars are:

### The Three Pillars

| Pillar | Purpose | Tools |
|--------|---------|-------|
| **Metrics** | Quantitative measurements | Prometheus, StatsD, Datadog |
| **Traces** | Request flow across services | Jaeger, Zipkin, OpenTelemetry |
| **Logs** | Contextual event records | ELK Stack, Splunk, Loki |

### Key Metrics for Resilience Patterns

#### Circuit Breaker Metrics

```javascript
// Metrics to collect for circuit breakers
const circuitBreakerMetrics = {
  // State transitions
  'circuit_breaker_state': 'gauge',           // 0=closed, 1=half-open, 2=open
  'circuit_breaker_state_transitions_total': 'counter',
  
  // Request outcomes
  'circuit_breaker_requests_total': 'counter',         // Total requests
  'circuit_breaker_requests_success_total': 'counter', // Successful
  'circuit_breaker_requests_failure_total': 'counter', // Failed
  'circuit_breaker_requests_rejected_total': 'counter', // Rejected (circuit open)
  
  // Latency
  'circuit_breaker_request_duration_seconds': 'histogram',
  
  // Health
  'circuit_breaker_failure_rate': 'gauge',     // Current failure percentage
};
```

#### Retry Metrics

```javascript
const retryMetrics = {
  'retry_attempts_total': 'counter',           // Total retry attempts
  'retry_successes_total': 'counter',          // Retries that succeeded
  'retry_exhausted_total': 'counter',          // All retries failed
  'retry_delay_seconds': 'histogram',          // Backoff durations
};
```

#### Rate Limiter Metrics

```javascript
const rateLimiterMetrics = {
  'rate_limit_requests_total': 'counter',
  'rate_limit_rejected_total': 'counter',
  'rate_limit_tokens_remaining': 'gauge',
  'rate_limit_queue_size': 'gauge',
};
```

### Implementing Prometheus Metrics

```javascript
import { Counter, Gauge, Histogram, Registry } from 'prom-client';

class ObservableCircuitBreaker {
  constructor(options, metricsRegistry = new Registry()) {
    this.name = options.name;
    this.registry = metricsRegistry;
    
    // Define metrics
    this.metrics = {
      requests: new Counter({
        name: 'circuit_breaker_requests_total',
        help: 'Total requests through circuit breaker',
        labelNames: ['circuit', 'result'],
        registers: [this.registry],
      }),
      
      state: new Gauge({
        name: 'circuit_breaker_state',
        help: 'Current circuit breaker state',
        labelNames: ['circuit'],
        registers: [this.registry],
      }),
      
      duration: new Histogram({
        name: 'circuit_breaker_duration_seconds',
        help: 'Request duration through circuit breaker',
        labelNames: ['circuit'],
        buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
        registers: [this.registry],
      }),
    };
    
    // Initialize state
    this.metrics.state.set({ circuit: this.name }, 0);
  }

  async execute(fn) {
    const timer = this.metrics.duration.startTimer({ circuit: this.name });
    
    try {
      const result = await this._executeInternal(fn);
      this.metrics.requests.inc({ circuit: this.name, result: 'success' });
      return result;
    } catch (error) {
      if (error.message === 'Circuit breaker is OPEN') {
        this.metrics.requests.inc({ circuit: this.name, result: 'rejected' });
      } else {
        this.metrics.requests.inc({ circuit: this.name, result: 'failure' });
      }
      throw error;
    } finally {
      timer();
    }
  }

  _transitionTo(newState) {
    const stateMap = { 'CLOSED': 0, 'HALF_OPEN': 1, 'OPEN': 2 };
    this.metrics.state.set({ circuit: this.name }, stateMap[newState]);
    // ... rest of transition logic
  }
}
```

### Distributed Tracing with OpenTelemetry

```javascript
import { trace, context, SpanStatusCode } from '@opentelemetry/api';

class TracedCircuitBreaker {
  constructor(options) {
    this.tracer = trace.getTracer('resilience-patterns');
    this.circuitName = options.name;
  }

  async execute(fn) {
    return this.tracer.startActiveSpan(
      `circuit-breaker.${this.circuitName}`,
      { attributes: { 'circuit.name': this.circuitName } },
      async (span) => {
        try {
          span.setAttribute('circuit.state', this.state);
          
          if (this.isOpen) {
            span.setStatus({ code: SpanStatusCode.ERROR, message: 'Circuit Open' });
            span.setAttribute('circuit.rejected', true);
            throw new Error('Circuit breaker is OPEN');
          }

          const result = await fn();
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (error) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
          span.recordException(error);
          throw error;
        } finally {
          span.end();
        }
      }
    );
  }
}

// Tracing retry attempts
class TracedRetryHandler {
  async execute(fn) {
    return this.tracer.startActiveSpan('retry-handler', async (span) => {
      let lastError;
      
      for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
        const attemptSpan = this.tracer.startSpan(`retry.attempt.${attempt}`, {
          attributes: { 'retry.attempt': attempt }
        });
        
        try {
          const result = await fn();
          attemptSpan.setStatus({ code: SpanStatusCode.OK });
          span.setAttribute('retry.total_attempts', attempt);
          return result;
        } catch (error) {
          lastError = error;
          attemptSpan.setStatus({ code: SpanStatusCode.ERROR });
          attemptSpan.recordException(error);
          
          if (attempt < this.maxAttempts) {
            const delay = this.calculateDelay(attempt);
            attemptSpan.setAttribute('retry.delay_ms', delay);
            await this.sleep(delay);
          }
        } finally {
          attemptSpan.end();
        }
      }
      
      span.setAttribute('retry.exhausted', true);
      throw lastError;
    });
  }
}
```

### Structured Logging for Resilience Events

```javascript
import pino from 'pino';

const logger = pino({
  level: 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
});

class LoggedCircuitBreaker {
  constructor(options) {
    this.name = options.name;
    this.log = logger.child({ 
      component: 'circuit-breaker',
      circuit: this.name 
    });
  }

  _transitionTo(newState) {
    const previousState = this.state;
    this.state = newState;
    
    this.log.warn({
      event: 'state_transition',
      from: previousState,
      to: newState,
      failureCount: this.failureCount,
      timestamp: new Date().toISOString(),
    }, `Circuit ${this.name} transitioned from ${previousState} to ${newState}`);
  }

  _onFailure(error) {
    this.log.error({
      event: 'execution_failure',
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
      failureCount: this.failureCount,
      state: this.state,
    }, `Execution failed in circuit ${this.name}`);
  }
}
```

### Dashboard Recommendations

**Grafana Dashboard Panels:**

1. **Circuit Breaker Overview**
   - State timeline (CLOSED/HALF_OPEN/OPEN)
   - Request success/failure/rejected rates
   - P50/P95/P99 latency

2. **Retry Analysis**
   - Retry rate over time
   - Success by attempt number
   - Backoff distribution

3. **Rate Limiter Health**
   - Requests vs. rejections
   - Token bucket fill rate
   - Queue depth

4. **Alerts to Configure**
   ```yaml
   # Example Prometheus alert rules
   groups:
   - name: resilience
     rules:
     - alert: CircuitBreakerOpen
       expr: circuit_breaker_state == 2
       for: 1m
       labels:
         severity: warning
       annotations:
         summary: "Circuit breaker {{ $labels.circuit }} is open"
     
     - alert: HighRetryRate
       expr: rate(retry_attempts_total[5m]) > 10
       for: 5m
       labels:
         severity: warning
   ```

---

## 🔥 2. Chaos Engineering

Chaos engineering is the discipline of experimenting on a system to build confidence in its capability to withstand turbulent conditions in production.

### Principles of Chaos Engineering

1. **Build a Hypothesis** - Define steady state behavior
2. **Vary Real-World Events** - Inject failures that could happen
3. **Run Experiments in Production** - Test where it matters
4. **Automate Experiments** - Run continuously
5. **Minimize Blast Radius** - Start small, expand gradually

### Chaos Experiments for Resilience Patterns

#### Testing Circuit Breakers

```javascript
class ChaosCircuitBreakerTester {
  constructor(circuitBreaker, targetService) {
    this.breaker = circuitBreaker;
    this.service = targetService;
    this.originalFn = targetService.call.bind(targetService);
  }

  // Experiment 1: Sudden failure spike
  async testSuddenFailureSpike(failureCount = 10) {
    console.log('🔬 Experiment: Sudden Failure Spike');
    console.log(`   Hypothesis: Circuit opens after ${this.breaker.failureThreshold} failures`);
    
    let failures = 0;
    
    // Inject failures
    this.service.call = async () => {
      if (failures < failureCount) {
        failures++;
        throw new Error('Injected failure');
      }
      return this.originalFn();
    };

    // Execute requests
    const results = { success: 0, failure: 0, rejected: 0 };
    
    for (let i = 0; i < failureCount + 5; i++) {
      try {
        await this.breaker.execute(() => this.service.call());
        results.success++;
      } catch (error) {
        if (error.message.includes('OPEN')) {
          results.rejected++;
        } else {
          results.failure++;
        }
      }
    }

    // Verify hypothesis
    const circuitOpened = this.breaker.isOpen;
    console.log(`   Result: Circuit is ${circuitOpened ? 'OPEN ✅' : 'CLOSED ❌'}`);
    console.log(`   Stats: ${results.failure} failures, ${results.rejected} rejected`);
    
    // Restore
    this.service.call = this.originalFn;
    return circuitOpened;
  }

  // Experiment 2: Latency injection
  async testLatencyInjection(delayMs = 5000) {
    console.log('🔬 Experiment: Latency Injection');
    console.log(`   Hypothesis: Timeouts trigger circuit breaker`);
    
    this.service.call = async () => {
      await new Promise(resolve => setTimeout(resolve, delayMs));
      return this.originalFn();
    };

    const startState = this.breaker.state;
    
    // Make requests that will timeout
    for (let i = 0; i < 10; i++) {
      try {
        await this.breaker.execute(() => this.service.call());
      } catch (error) {
        // Expected
      }
    }

    console.log(`   Result: State changed from ${startState} to ${this.breaker.state}`);
    
    this.service.call = this.originalFn;
  }

  // Experiment 3: Intermittent failures
  async testIntermittentFailures(failureRate = 0.5) {
    console.log('🔬 Experiment: Intermittent Failures');
    console.log(`   Hypothesis: ${failureRate * 100}% failure rate triggers circuit`);
    
    this.service.call = async () => {
      if (Math.random() < failureRate) {
        throw new Error('Random failure');
      }
      return this.originalFn();
    };

    const iterations = 100;
    let circuitOpenedCount = 0;
    
    for (let i = 0; i < iterations; i++) {
      try {
        await this.breaker.execute(() => this.service.call());
      } catch (error) {
        if (this.breaker.isOpen) circuitOpenedCount++;
      }
    }

    console.log(`   Result: Circuit was open for ${circuitOpenedCount}/${iterations} requests`);
    
    this.service.call = this.originalFn;
  }
}
```

#### Testing Retry Handlers

```javascript
class ChaosRetryTester {
  async testExponentialBackoff(retryHandler) {
    console.log('🔬 Experiment: Exponential Backoff Timing');
    
    const delays = [];
    let attempts = 0;
    
    const failingFn = async () => {
      attempts++;
      if (attempts < retryHandler.maxAttempts) {
        delays.push(Date.now());
        throw new Error('Temporary failure');
      }
      return 'success';
    };

    const start = Date.now();
    await retryHandler.execute(failingFn);
    
    // Verify exponential growth
    for (let i = 1; i < delays.length; i++) {
      const gap = delays[i] - delays[i-1];
      const expectedMin = retryHandler.baseDelay * Math.pow(2, i - 1);
      console.log(`   Delay ${i}: ${gap}ms (expected ~${expectedMin}ms)`);
    }
  }

  async testRetryExhaustion(retryHandler) {
    console.log('🔬 Experiment: Retry Exhaustion');
    
    const alwaysFails = async () => {
      throw new Error('Permanent failure');
    };

    try {
      await retryHandler.execute(alwaysFails);
      console.log('   ❌ Should have thrown');
    } catch (error) {
      console.log(`   ✅ Error thrown after max attempts`);
    }
  }
}
```

#### Testing Bulkheads

```javascript
class ChaosBulkheadTester {
  async testConcurrencyIsolation(bulkhead) {
    console.log('🔬 Experiment: Bulkhead Concurrency Isolation');
    console.log(`   Max concurrent: ${bulkhead.maxConcurrent}`);
    
    const slowOperation = () => new Promise(r => setTimeout(r, 2000));
    const results = { acquired: 0, rejected: 0 };
    
    // Try to acquire more than max concurrent
    const promises = [];
    for (let i = 0; i < bulkhead.maxConcurrent + 5; i++) {
      promises.push(
        bulkhead.execute(slowOperation)
          .then(() => results.acquired++)
          .catch(() => results.rejected++)
      );
    }
    
    // Don't wait for all - check immediate rejection
    await new Promise(r => setTimeout(r, 100));
    
    console.log(`   In-flight: ${bulkhead.activeTasks}`);
    console.log(`   Queued: ${bulkhead.queueSize}`);
    
    await Promise.allSettled(promises);
    console.log(`   ✅ Acquired: ${results.acquired}, Rejected: ${results.rejected}`);
  }
}
```

### Chaos Engineering Tools Integration

#### Using Chaos Toolkit

```yaml
# chaos-experiment.yaml
version: 1.0.0
title: Circuit Breaker Resilience Test
description: Verify circuit breaker protects against cascade failures

steady-state-hypothesis:
  title: Service responds normally
  probes:
    - type: probe
      name: service-responds
      tolerance: 200
      provider:
        type: http
        url: http://localhost:3000/health

method:
  - type: action
    name: inject-downstream-failure
    provider:
      type: process
      path: node
      arguments: ["./chaos/kill-downstream.js"]
    pauses:
      after: 10

  - type: probe
    name: circuit-is-open
    provider:
      type: http
      url: http://localhost:3000/circuit-status
    tolerance:
      type: jsonpath
      path: $.state
      expect: OPEN

rollbacks:
  - type: action
    name: restore-downstream
    provider:
      type: process
      path: node
      arguments: ["./chaos/restore-downstream.js"]
```

#### Chaos Monkey for Node.js

```javascript
class ChaosMonkey {
  constructor(options = {}) {
    this.enabled = options.enabled ?? process.env.CHAOS_ENABLED === 'true';
    this.failureRate = options.failureRate ?? 0.1;
    this.latencyRate = options.latencyRate ?? 0.2;
    this.maxLatency = options.maxLatency ?? 3000;
  }

  wrap(fn) {
    if (!this.enabled) return fn;
    
    return async (...args) => {
      // Random failure injection
      if (Math.random() < this.failureRate) {
        throw new Error('[ChaosMonkey] Injected failure');
      }
      
      // Random latency injection
      if (Math.random() < this.latencyRate) {
        const delay = Math.random() * this.maxLatency;
        await new Promise(r => setTimeout(r, delay));
      }
      
      return fn(...args);
    };
  }
}

// Usage
const chaos = new ChaosMonkey({ enabled: process.env.NODE_ENV !== 'production' });

const originalFetch = fetch;
globalThis.fetch = chaos.wrap(originalFetch);
```

### Game Days

**Running a Resilience Game Day:**

1. **Preparation**
   - Define success criteria
   - Set up monitoring dashboards
   - Prepare rollback procedures
   - Notify stakeholders

2. **Execution Phases**
   ```
   Phase 1: Baseline (10 min)
   - Capture normal metrics
   - Verify all systems healthy
   
   Phase 2: Inject Failures (30 min)
   - Start with single service failure
   - Escalate to multiple failures
   - Monitor circuit breaker behavior
   
   Phase 3: Recovery (15 min)
   - Remove failure injection
   - Monitor recovery time
   - Verify no data loss
   
   Phase 4: Analysis (30 min)
   - Review timeline
   - Document findings
   - Create improvement tickets
   ```

3. **Metrics to Track**
   - Time to detect failure
   - Time for circuit to open
   - Recovery time
   - Error rate during failure
   - Impact on end users

---

## 🏗️ 3. Resilience in Microservices Architecture

### Service Mesh Integration

Modern microservices often delegate resilience to a service mesh:

```
┌─────────────────────────────────────────────────────┐
│                    Service Mesh                      │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐         │
│  │ Envoy   │    │ Envoy   │    │ Envoy   │         │
│  │ Proxy   │◄──►│ Proxy   │◄──►│ Proxy   │         │
│  └────┬────┘    └────┬────┘    └────┬────┘         │
│       │              │              │               │
│  ┌────┴────┐    ┌────┴────┐    ┌────┴────┐         │
│  │Service A│    │Service B│    │Service C│         │
│  └─────────┘    └─────────┘    └─────────┘         │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │ Control Plane (Istio, Linkerd)               │   │
│  │ - Circuit Breaker Policies                   │   │
│  │ - Retry Policies                             │   │
│  │ - Timeout Configuration                      │   │
│  │ - Rate Limiting Rules                        │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

#### Istio Resilience Configuration

```yaml
# DestinationRule with circuit breaker
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: payment-service
spec:
  host: payment-service
  trafficPolicy:
    connectionPool:
      tcp:
        maxConnections: 100
      http:
        h2UpgradePolicy: UPGRADE
        http1MaxPendingRequests: 100
        http2MaxRequests: 1000
        maxRequestsPerConnection: 10
        maxRetries: 3
    outlierDetection:
      consecutive5xxErrors: 5
      interval: 30s
      baseEjectionTime: 30s
      maxEjectionPercent: 50
      minHealthPercent: 30
```

```yaml
# VirtualService with retries and timeout
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: payment-service
spec:
  hosts:
  - payment-service
  http:
  - route:
    - destination:
        host: payment-service
    timeout: 5s
    retries:
      attempts: 3
      perTryTimeout: 2s
      retryOn: 5xx,reset,connect-failure,retriable-4xx
```

### Application vs Infrastructure Resilience

| Layer | Responsibility | Tools |
|-------|---------------|-------|
| **Application** | Business logic resilience | This library, Polly, Hystrix |
| **Infrastructure** | Network resilience | Istio, Linkerd, Envoy |
| **Platform** | Compute resilience | Kubernetes, AWS ECS |

**When to use each:**

- **Application-level**: When you need business-aware fallbacks, custom retry conditions
- **Infrastructure-level**: When you need uniform policies, language-agnostic
- **Both**: Defense in depth - combine both for critical services

### Distributed Circuit Breaker

For microservices, circuit breaker state often needs to be shared:

```javascript
import Redis from 'ioredis';

class DistributedCircuitBreaker {
  constructor(options) {
    this.redis = new Redis(options.redisUrl);
    this.name = options.name;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.timeout = options.timeout ?? 30000;
    this.key = `circuit:${this.name}`;
  }

  async getState() {
    const data = await this.redis.hgetall(this.key);
    if (!data.state) return 'CLOSED';
    
    // Check if should transition from OPEN to HALF_OPEN
    if (data.state === 'OPEN' && Date.now() > parseInt(data.nextAttempt)) {
      await this.redis.hset(this.key, 'state', 'HALF_OPEN');
      return 'HALF_OPEN';
    }
    
    return data.state;
  }

  async execute(fn) {
    const state = await this.getState();
    
    if (state === 'OPEN') {
      throw new Error('Circuit breaker is OPEN');
    }

    try {
      const result = await fn();
      await this.recordSuccess();
      return result;
    } catch (error) {
      await this.recordFailure();
      throw error;
    }
  }

  async recordFailure() {
    const failures = await this.redis.hincrby(this.key, 'failures', 1);
    
    if (failures >= this.failureThreshold) {
      await this.redis.hmset(this.key, {
        state: 'OPEN',
        nextAttempt: Date.now() + this.timeout,
        failures: 0,
      });
      await this.redis.expire(this.key, Math.ceil(this.timeout / 1000) + 60);
    }
  }

  async recordSuccess() {
    const state = await this.getState();
    
    if (state === 'HALF_OPEN') {
      const successes = await this.redis.hincrby(this.key, 'successes', 1);
      if (successes >= 2) {
        await this.redis.hmset(this.key, {
          state: 'CLOSED',
          failures: 0,
          successes: 0,
        });
      }
    }
  }
}
```

### Event-Driven Resilience

For async microservices communication:

```javascript
class ResilientEventHandler {
  constructor(options) {
    this.circuitBreaker = new CircuitBreaker(options.circuit);
    this.retry = new RetryHandler(options.retry);
    this.dlq = options.deadLetterQueue;
  }

  async handleEvent(event) {
    try {
      return await this.circuitBreaker.execute(async () => {
        return await this.retry.execute(async () => {
          return await this.processEvent(event);
        });
      });
    } catch (error) {
      // Send to dead letter queue for manual review
      await this.dlq.send({
        originalEvent: event,
        error: error.message,
        timestamp: new Date().toISOString(),
        attempts: this.retry.maxAttempts,
      });
      
      // Don't throw - acknowledge the message to prevent infinite retry
      console.error('Event moved to DLQ:', event.id);
    }
  }
}
```

### Health Check Patterns

```javascript
class ServiceHealth {
  constructor(dependencies) {
    this.dependencies = dependencies;
  }

  async check() {
    const results = await Promise.allSettled(
      Object.entries(this.dependencies).map(async ([name, checker]) => ({
        name,
        status: await this.checkWithTimeout(checker, 5000),
      }))
    );

    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      dependencies: {},
    };

    for (const result of results) {
      if (result.status === 'fulfilled') {
        health.dependencies[result.value.name] = result.value.status;
        if (result.value.status.status === 'unhealthy') {
          health.status = 'degraded';
        }
      } else {
        health.dependencies[result.reason.name] = { status: 'unhealthy' };
        health.status = 'unhealthy';
      }
    }

    return health;
  }

  async checkWithTimeout(checker, timeout) {
    try {
      return await Promise.race([
        checker(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Health check timeout')), timeout)
        ),
      ]);
    } catch (error) {
      return { status: 'unhealthy', error: error.message };
    }
  }
}

// Usage
const health = new ServiceHealth({
  database: async () => {
    await db.query('SELECT 1');
    return { status: 'healthy', latency: '5ms' };
  },
  cache: async () => {
    await redis.ping();
    return { status: 'healthy' };
  },
  paymentService: async () => {
    return paymentCircuitBreaker.isOpen
      ? { status: 'degraded', reason: 'Circuit open' }
      : { status: 'healthy' };
  },
});

app.get('/health', async (req, res) => {
  const result = await health.check();
  res.status(result.status === 'healthy' ? 200 : 503).json(result);
});
```

---

## 📖 4. Real-World Case Studies

### Case Study 1: Netflix - Hystrix and Chaos Engineering

**Challenge:** Netflix serves 200+ million subscribers with thousands of microservices. A single service failure could cascade across the entire system.

**Solution:**
- **Hystrix Library**: Netflix created Hystrix for circuit breaking
- **Chaos Monkey**: Random instance termination in production
- **Fallbacks**: Every service has graceful degradation

**Key Learnings:**
```javascript
// Netflix-style command pattern
class GetMovieCommand {
  constructor(movieId) {
    this.movieId = movieId;
    this.circuitBreaker = new CircuitBreaker({
      name: 'MovieService',
      timeout: 1000,
      errorThreshold: 50,
      requestVolumeThreshold: 20,
    });
  }

  async run() {
    return this.circuitBreaker.execute(async () => {
      return await movieService.getMovie(this.movieId);
    });
  }

  async getFallback() {
    // Return cached or stubbed data
    return await cacheService.get(`movie:${this.movieId}`) 
      || { id: this.movieId, title: 'Unknown', available: false };
  }
}
```

**Results:**
- 99.99% availability
- Graceful degradation instead of outages
- Engineers confident deploying changes

---

### Case Study 2: Amazon - Exponential Backoff with Jitter

**Challenge:** When AWS services recovered from an outage, the "thundering herd" of retries caused immediate re-failure.

**Solution:**
```javascript
// AWS-recommended retry with full jitter
class AWSRetryStrategy {
  static async execute(fn, options = {}) {
    const maxAttempts = options.maxAttempts ?? 10;
    const baseDelay = options.baseDelay ?? 100;
    const maxDelay = options.maxDelay ?? 20000;
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        if (attempt === maxAttempts - 1 || !this.isRetryable(error)) {
          throw error;
        }
        
        // Full jitter: random between 0 and exponential cap
        const exponentialDelay = Math.min(maxDelay, baseDelay * Math.pow(2, attempt));
        const jitteredDelay = Math.random() * exponentialDelay;
        
        await new Promise(r => setTimeout(r, jitteredDelay));
      }
    }
  }

  static isRetryable(error) {
    const retryableCodes = [
      'ProvisionedThroughputExceededException',
      'ThrottlingException',
      'ServiceUnavailable',
    ];
    return retryableCodes.includes(error.code);
  }
}
```

**Key Insight:** Full jitter spreads retry traffic more evenly than equal jitter or no jitter.

---

### Case Study 3: Stripe - Idempotency for Financial Operations

**Challenge:** Payment retries could result in duplicate charges.

**Solution:**
```javascript
class IdempotentPaymentProcessor {
  constructor() {
    this.retry = new RetryHandler({
      maxAttempts: 3,
      retryCondition: (error) => this.isRetryable(error),
    });
  }

  async charge(payment, idempotencyKey) {
    return this.retry.execute(async () => {
      const response = await fetch('https://api.stripe.com/v1/charges', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.STRIPE_KEY}`,
          'Idempotency-Key': idempotencyKey, // Critical!
        },
        body: JSON.stringify(payment),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new PaymentError(error);
      }
      
      return response.json();
    });
  }

  isRetryable(error) {
    // Only retry network errors and rate limits
    // Never retry card_declined, invalid_request, etc.
    return error.type === 'api_connection_error' 
        || error.code === 'rate_limit';
  }
}

// Usage - same key ensures single charge
const result = await processor.charge(
  { amount: 1000, currency: 'usd' },
  `order_${orderId}_${Date.now()}`
);
```

---

### Case Study 4: Uber - Request Hedging

**Challenge:** P99 latencies were 10x worse than P50 due to tail latency.

**Solution:**
```javascript
class HedgedRequest {
  constructor(options) {
    this.percentile = options.percentile ?? 95; // Trigger hedge at P95
    this.latencyTracker = new LatencyPercentile();
  }

  async execute(fn) {
    const hedgeDelay = this.latencyTracker.getPercentile(this.percentile);
    
    return new Promise((resolve, reject) => {
      let completed = false;
      
      // Primary request
      fn().then(result => {
        if (!completed) {
          completed = true;
          resolve(result);
        }
      }).catch(reject);
      
      // Hedged request after P95 latency
      setTimeout(() => {
        if (!completed) {
          fn().then(result => {
            if (!completed) {
              completed = true;
              resolve(result);
            }
          }).catch(() => {}); // Ignore hedge failures
        }
      }, hedgeDelay);
    });
  }
}
```

**Result:** P99 latency reduced by 75%.

---

### Case Study 5: Google - Load Shedding & Adaptive Throttling

**Challenge:** During traffic spikes, services needed to protect themselves.

**Solution:**
```javascript
class AdaptiveLoadShedder {
  constructor(options) {
    this.targetLatency = options.targetLatency ?? 100; // Target P99 in ms
    this.acceptRate = 1.0; // Accept 100% of traffic initially
    this.latencyWindow = [];
    this.windowSize = 100;
  }

  shouldAccept() {
    // Probabilistic acceptance based on load
    return Math.random() < this.acceptRate;
  }

  recordLatency(latencyMs) {
    this.latencyWindow.push(latencyMs);
    if (this.latencyWindow.length > this.windowSize) {
      this.latencyWindow.shift();
    }
    this.adjustAcceptRate();
  }

  adjustAcceptRate() {
    const p99 = this.calculateP99();
    
    if (p99 > this.targetLatency * 1.5) {
      // Latency too high - shed more load
      this.acceptRate = Math.max(0.1, this.acceptRate * 0.9);
    } else if (p99 < this.targetLatency * 0.8) {
      // Latency good - accept more
      this.acceptRate = Math.min(1.0, this.acceptRate * 1.1);
    }
  }

  calculateP99() {
    const sorted = [...this.latencyWindow].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.99)];
  }
}

// Middleware usage
app.use((req, res, next) => {
  if (!loadShedder.shouldAccept()) {
    return res.status(503).json({ 
      error: 'Service overloaded',
      retryAfter: 5 
    });
  }
  
  const start = Date.now();
  res.on('finish', () => {
    loadShedder.recordLatency(Date.now() - start);
  });
  
  next();
});
```

---

## 📋 Summary & Recommendations

### Observability Checklist

- [ ] Metrics exported to Prometheus/DataDog
- [ ] Distributed tracing with correlation IDs
- [ ] Structured JSON logging
- [ ] Dashboards for each resilience pattern
- [ ] Alerts for circuit breaker opens

### Chaos Engineering Checklist

- [ ] Failure injection framework in staging
- [ ] Game day procedures documented
- [ ] Runbooks for common failure scenarios
- [ ] Automated chaos tests in CI/CD
- [ ] Blast radius controls in place

### Microservices Checklist

- [ ] Circuit breakers on all outbound calls
- [ ] Retries with exponential backoff + jitter
- [ ] Timeouts on all I/O operations
- [ ] Health check endpoints
- [ ] Service mesh evaluation completed

### Production Readiness Checklist

- [ ] All patterns have appropriate timeouts
- [ ] Fallbacks provide business value
- [ ] Idempotency keys for mutating operations
- [ ] Load shedding for traffic spikes
- [ ] Dead letter queues for async operations

---

## 📚 Further Reading

- [Release It!](https://pragprog.com/titles/mnee2/release-it-second-edition/) by Michael Nygard
- [Chaos Engineering](https://www.oreilly.com/library/view/chaos-engineering/9781491988459/) by Casey Rosenthal
- [Building Microservices](https://www.oreilly.com/library/view/building-microservices-2nd/9781492034018/) by Sam Newman
- [Site Reliability Engineering](https://sre.google/sre-book/table-of-contents/) by Google
- [AWS Builders Library](https://aws.amazon.com/builders-library/)
- [Netflix Tech Blog](https://netflixtechblog.com/)
