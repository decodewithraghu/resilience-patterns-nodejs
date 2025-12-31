// ============================================
// CHAOS ENGINEERING - Testing Resilience
// ============================================

/**
 * Demonstrates chaos engineering principles for testing resilience patterns
 * - Failure injection
 * - Latency injection
 * - Random fault injection (Chaos Monkey)
 * - Game Day scenarios
 */

import {
  CircuitBreaker,
  RetryHandler,
  BackoffStrategy,
  Bulkhead,
  TimeoutHandler
} from '../src/core/index.js';

console.log('🔥 Chaos Engineering Demo - Testing Resilience\n');
console.log('Verifying system behavior under failure conditions\n');

// ============================================
// Chaos Monkey - Random Fault Injector
// ============================================

class ChaosMonkey {
  constructor(options = {}) {
    this.enabled = options.enabled ?? true;
    this.config = {
      failureRate: options.failureRate ?? 0.3,      // 30% of calls fail
      latencyRate: options.latencyRate ?? 0.2,      // 20% get delayed
      minLatency: options.minLatency ?? 100,        // Min delay
      maxLatency: options.maxLatency ?? 3000,       // Max delay
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
        console.log(`   🐵 [ChaosMonkey] Injecting failure: ${errorType}`);
        const error = new Error(`[ChaosMonkey] ${errorType}`);
        error.code = errorType;
        throw error;
      }

      // Inject random latency
      if (Math.random() < this.config.latencyRate) {
        const delay = this.config.minLatency + 
          Math.random() * (this.config.maxLatency - this.config.minLatency);
        this.stats.injectedLatency++;
        console.log(`   🐵 [ChaosMonkey] Injecting ${Math.round(delay)}ms latency`);
        await new Promise(r => setTimeout(r, delay));
      }

      return fn(...args);
    };
  }

  printStats() {
    console.log('\n🐵 Chaos Monkey Statistics:');
    console.log(`   Total calls: ${this.stats.totalCalls}`);
    console.log(`   Injected failures: ${this.stats.injectedFailures} (${(this.stats.injectedFailures / this.stats.totalCalls * 100).toFixed(1)}%)`);
    console.log(`   Injected latency: ${this.stats.injectedLatency} (${(this.stats.injectedLatency / this.stats.totalCalls * 100).toFixed(1)}%)`);
  }
}

// ============================================
// Experiment Runner
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
  }

  observe(message, data = {}) {
    this.results.observations.push({
      timestamp: Date.now(),
      message,
      data,
    });
    console.log(`   📊 Observation: ${message}`, Object.keys(data).length > 0 ? JSON.stringify(data) : '');
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

  printReport() {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`🔬 Experiment: ${this.name}`);
    console.log(`${'─'.repeat(60)}`);
    console.log(`Hypothesis: ${this.hypothesis}`);
    console.log(`Result: ${this.results.passed ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`Conclusion: ${this.results.conclusion}`);
    
    if (Object.keys(this.results.metrics).length > 0) {
      console.log('\nMetrics:');
      for (const [name, values] of Object.entries(this.results.metrics)) {
        const sum = values.reduce((a, b) => a + b, 0);
        const avg = sum / values.length;
        console.log(`  ${name}: count=${values.length}, avg=${avg.toFixed(2)}`);
      }
    }
    console.log(`${'═'.repeat(60)}\n`);
  }
}

// ============================================
// Experiments
// ============================================

async function experiment1_CircuitBreakerTrip() {
  const experiment = new ChaosExperiment(
    'Circuit Breaker Trip Under Load',
    'Circuit breaker opens after consecutive failures exceed threshold'
  );

  console.log('\n🔬 Running Experiment 1: Circuit Breaker Trip\n');

  const breaker = new CircuitBreaker({
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 5000,
  });

  let circuitOpenedAt = null;
  breaker.on('open', () => {
    circuitOpenedAt = Date.now();
    experiment.observe('Circuit opened', { failureCount: 5 });
  });

  // Inject 100% failure
  const failingService = async () => {
    throw new Error('Service down');
  };

  let consecutiveFailures = 0;
  let rejectedRequests = 0;

  for (let i = 0; i < 20; i++) {
    try {
      await breaker.execute(failingService);
    } catch (error) {
      if (error.message.includes('OPEN')) {
        rejectedRequests++;
        experiment.recordMetric('rejected_requests', 1);
      } else {
        consecutiveFailures++;
        experiment.recordMetric('failures', 1);
      }
    }
  }

  experiment.observe('Final state', {
    failures: consecutiveFailures,
    rejected: rejectedRequests,
    circuitState: breaker.state,
  });

  if (breaker.isOpen && rejectedRequests > 0) {
    experiment.pass('Circuit correctly opened and rejected subsequent requests');
  } else {
    experiment.fail('Circuit did not behave as expected');
  }

  experiment.printReport();
  return experiment.results.passed;
}

async function experiment2_RetryRecovery() {
  const experiment = new ChaosExperiment(
    'Retry Recovery After Transient Failure',
    'Retries should successfully complete when service recovers mid-attempt'
  );

  console.log('\n🔬 Running Experiment 2: Retry Recovery\n');

  const retry = new RetryHandler({
    maxAttempts: 5,
    baseDelay: 100,
    maxDelay: 2000,
    strategy: BackoffStrategy.EXPONENTIAL,
    jitter: true,
  });

  // Service that fails first 2 times then succeeds
  let attemptCount = 0;
  const flakyService = async () => {
    attemptCount++;
    experiment.observe(`Attempt ${attemptCount}`);
    
    if (attemptCount <= 2) {
      throw new Error('Transient failure');
    }
    return { success: true, attempt: attemptCount };
  };

  const startTime = Date.now();
  
  try {
    const result = await retry.execute(flakyService);
    const duration = Date.now() - startTime;
    
    experiment.observe('Operation succeeded', {
      attempts: attemptCount,
      duration,
      result,
    });
    experiment.recordMetric('total_attempts', attemptCount);
    experiment.recordMetric('recovery_time_ms', duration);
    
    if (result.success && attemptCount === 3) {
      experiment.pass('Retry successfully recovered after transient failures');
    } else {
      experiment.fail('Unexpected recovery behavior');
    }
  } catch (error) {
    experiment.fail(`Operation failed: ${error.message}`);
  }

  experiment.printReport();
  return experiment.results.passed;
}

async function experiment3_BulkheadIsolation() {
  const experiment = new ChaosExperiment(
    'Bulkhead Resource Isolation',
    'Bulkhead should prevent resource exhaustion by limiting concurrency'
  );

  console.log('\n🔬 Running Experiment 3: Bulkhead Isolation\n');

  const bulkhead = new Bulkhead({
    maxConcurrent: 3,
    maxQueue: 5,
    queueTimeout: 1000,
  });

  // Slow operation
  const slowOperation = async () => {
    await new Promise(r => setTimeout(r, 500));
    return 'completed';
  };

  const results = { acquired: 0, queued: 0, rejected: 0 };

  // Fire many concurrent requests
  experiment.observe('Starting 15 concurrent requests', { maxConcurrent: 3, maxQueue: 5 });
  
  const promises = [];
  for (let i = 0; i < 15; i++) {
    promises.push(
      bulkhead.execute(slowOperation)
        .then(() => {
          results.acquired++;
          experiment.recordMetric('acquired', 1);
        })
        .catch((error) => {
          if (error.message.includes('queue')) {
            results.rejected++;
            experiment.recordMetric('rejected', 1);
          }
        })
    );
  }

  // Small delay to let some acquire
  await new Promise(r => setTimeout(r, 100));
  
  experiment.observe('Mid-execution status', {
    activeTasks: bulkhead.activeTasks,
    queueSize: bulkhead.queueSize,
  });

  await Promise.allSettled(promises);

  experiment.observe('Final results', results);

  // Verify isolation
  if (results.rejected > 0 && results.acquired > 0) {
    experiment.pass('Bulkhead correctly isolated resources and rejected overflow');
  } else {
    experiment.fail('Bulkhead did not provide expected isolation');
  }

  experiment.printReport();
  return experiment.results.passed;
}

async function experiment4_ChaosMonkeyResilience() {
  const experiment = new ChaosExperiment(
    'System Resilience Under Random Faults',
    'System should remain functional with resilience patterns despite random failures'
  );

  console.log('\n🔬 Running Experiment 4: Chaos Monkey Resilience\n');

  // Create resilient stack
  const breaker = new CircuitBreaker({
    failureThreshold: 10,  // Higher threshold for chaos testing
    successThreshold: 3,
    timeout: 10000,
  });

  const retry = new RetryHandler({
    maxAttempts: 3,
    baseDelay: 50,
    strategy: BackoffStrategy.EXPONENTIAL,
  });

  const timeout = new TimeoutHandler({
    duration: 2000,  // 2 second timeout
  });

  // The actual service (would be HTTP call, DB query, etc.)
  const realService = async () => {
    await new Promise(r => setTimeout(r, 50));
    return { data: 'success' };
  };

  // Wrap with Chaos Monkey
  const chaos = new ChaosMonkey({
    enabled: true,
    failureRate: 0.4,   // 40% failure rate
    latencyRate: 0.3,   // 30% latency injection
    maxLatency: 500,    // Up to 500ms delay
  });

  const chaosService = chaos.wrap(realService, 'external-service');

  // Resilient wrapper combining all patterns
  const resilientCall = async () => {
    return breaker.execute(async () => {
      return retry.execute(async () => {
        return timeout.execute(chaosService);
      });
    });
  };

  const results = { success: 0, failure: 0, rejected: 0 };
  const latencies = [];

  experiment.observe('Starting 50 requests through chaos + resilience stack');

  for (let i = 0; i < 50; i++) {
    const start = Date.now();
    try {
      await resilientCall();
      results.success++;
      latencies.push(Date.now() - start);
      experiment.recordMetric('latency_ms', Date.now() - start);
    } catch (error) {
      if (error.message.includes('OPEN')) {
        results.rejected++;
      } else {
        results.failure++;
      }
    }
    
    // Small gap between requests
    await new Promise(r => setTimeout(r, 20));
  }

  chaos.printStats();

  experiment.observe('Request outcomes', results);
  
  const successRate = results.success / 50 * 100;
  experiment.observe('Success rate', { rate: `${successRate.toFixed(1)}%` });

  // With 40% failure and 3 retries, we expect reasonable success
  if (successRate > 30) {
    experiment.pass(`System maintained ${successRate.toFixed(1)}% success rate under chaos`);
  } else {
    experiment.fail(`Success rate ${successRate.toFixed(1)}% is below acceptable threshold`);
  }

  experiment.printReport();
  return experiment.results.passed;
}

async function experiment5_CascadeFailurePrevention() {
  const experiment = new ChaosExperiment(
    'Cascade Failure Prevention',
    'Circuit breaker should prevent cascade failures to dependent services'
  );

  console.log('\n🔬 Running Experiment 5: Cascade Failure Prevention\n');

  // Simulate service dependency chain: A -> B -> C
  // Service C fails, we verify A and B don't cascade fail

  const serviceCBreaker = new CircuitBreaker({
    failureThreshold: 3,
    successThreshold: 2,
    timeout: 5000,
  });

  let serviceCStatus = 'down';
  let serviceBCalls = 0;
  let serviceACalls = 0;

  const serviceC = async () => {
    if (serviceCStatus === 'down') {
      throw new Error('Service C unavailable');
    }
    return { service: 'C', status: 'ok' };
  };

  const serviceB = async () => {
    serviceBCalls++;
    try {
      const cResult = await serviceCBreaker.execute(serviceC);
      return { service: 'B', status: 'ok', downstream: cResult };
    } catch (error) {
      // Graceful degradation
      return { service: 'B', status: 'degraded', reason: 'C unavailable' };
    }
  };

  const serviceA = async () => {
    serviceACalls++;
    const bResult = await serviceB();
    return { service: 'A', status: 'ok', downstream: bResult };
  };

  experiment.observe('Starting cascade test - Service C is DOWN');

  // Phase 1: Service C is down
  const phase1Results = [];
  for (let i = 0; i < 10; i++) {
    const result = await serviceA();
    phase1Results.push(result);
  }

  const degradedCount = phase1Results.filter(r => r.downstream.status === 'degraded').length;
  experiment.observe('Phase 1 complete', {
    serviceCStatus: 'down',
    circuitState: serviceCBreaker.state,
    degradedResponses: degradedCount,
    serviceACalls,
    serviceBCalls,
  });

  // Phase 2: Service C recovers
  serviceCStatus = 'up';
  experiment.observe('Service C recovered - waiting for circuit half-open...');
  
  // Wait for circuit to allow retry
  await new Promise(r => setTimeout(r, 6000));

  const phase2Results = [];
  for (let i = 0; i < 10; i++) {
    const result = await serviceA();
    phase2Results.push(result);
  }

  const recoveredCount = phase2Results.filter(
    r => r.downstream.status === 'ok' && r.downstream.downstream?.status === 'ok'
  ).length;

  experiment.observe('Phase 2 complete', {
    serviceCStatus: 'up',
    circuitState: serviceCBreaker.state,
    fullyOperational: recoveredCount,
  });

  // Verify no cascade failure occurred (Service A always responded)
  if (serviceACalls === 20 && degradedCount > 0 && recoveredCount > 0) {
    experiment.pass('Cascade failure prevented - graceful degradation worked');
  } else {
    experiment.fail('Cascade failure prevention not working as expected');
  }

  experiment.printReport();
  return experiment.results.passed;
}

// ============================================
// Game Day Runner
// ============================================

async function runGameDay() {
  console.log('═'.repeat(60));
  console.log('🎮 RESILIENCE GAME DAY');
  console.log('═'.repeat(60));
  console.log('\nRunning automated chaos experiments to validate resilience...\n');

  const experiments = [
    { name: 'Circuit Breaker Trip', fn: experiment1_CircuitBreakerTrip },
    { name: 'Retry Recovery', fn: experiment2_RetryRecovery },
    { name: 'Bulkhead Isolation', fn: experiment3_BulkheadIsolation },
    { name: 'Chaos Monkey Resilience', fn: experiment4_ChaosMonkeyResilience },
    { name: 'Cascade Failure Prevention', fn: experiment5_CascadeFailurePrevention },
  ];

  const results = [];

  for (const exp of experiments) {
    console.log(`\n${'─'.repeat(60)}`);
    try {
      const passed = await exp.fn();
      results.push({ name: exp.name, passed });
    } catch (error) {
      console.error(`Experiment error: ${error.message}`);
      results.push({ name: exp.name, passed: false, error: error.message });
    }
  }

  // Final Report
  console.log('\n' + '═'.repeat(60));
  console.log('📋 GAME DAY SUMMARY');
  console.log('═'.repeat(60));

  const passed = results.filter(r => r.passed).length;
  const total = results.length;

  for (const result of results) {
    console.log(`${result.passed ? '✅' : '❌'} ${result.name}`);
  }

  console.log('\n' + '─'.repeat(60));
  console.log(`Overall: ${passed}/${total} experiments passed`);
  
  if (passed === total) {
    console.log('🎉 All resilience patterns validated successfully!');
  } else {
    console.log('⚠️  Some experiments failed - review and improve resilience');
  }
  console.log('═'.repeat(60) + '\n');
}

// Run the game day
runGameDay().catch(console.error);
