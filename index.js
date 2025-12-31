/**
 * Resilience Patterns Library - Main Entry Point
 * 
 * This file demonstrates the resilience patterns library
 * and re-exports all core modules for convenient imports.
 * 
 * @example
 * // Import everything
 * import * as resilience from 'resilience-based-example';
 * 
 * // Or import specific patterns
 * import { CircuitBreaker, RetryHandler } from 'resilience-based-example';
 */

// Re-export all core modules
export * from './src/core/index.js';

// Import for demonstration
import {
  CircuitBreaker,
  CircuitState,
  RetryHandler,
  RetryHandlerFactory,
  BackoffStrategy,
  TimeoutHandler,
  TimeoutError,
  FallbackHandler,
  Bulkhead,
  BulkheadError,
  TokenBucketRateLimiter,
  RateLimiterFactory,
  RateLimitError
} from './src/core/index.js';

/**
 * Quick demo function to showcase all patterns
 */
export async function runDemo() {
  console.log('🚀 Resilience Patterns Library Demo\n');
  console.log('='.repeat(60));
  
  // 1. Circuit Breaker Demo
  console.log('\n📌 1. CIRCUIT BREAKER PATTERN');
  console.log('   Protects against cascading failures\n');
  
  const breaker = new CircuitBreaker({
    failureThreshold: 3,
    successThreshold: 2,
    timeout: 5000
  });
  
  breaker.on('open', () => console.log('   ⚠️  Circuit OPENED'));
  breaker.on('close', () => console.log('   ✅ Circuit CLOSED'));
  
  // Simulate failures to open circuit
  for (let i = 0; i < 5; i++) {
    try {
      await breaker.execute(async () => {
        if (i < 3) throw new Error('Service down');
        return 'Success';
      });
    } catch (e) {
      console.log(`   ❌ Request ${i + 1}: ${e.message}`);
    }
  }
  
  console.log(`   📊 Stats: ${JSON.stringify(breaker.getStats())}\n`);
  
  // 2. Retry Pattern Demo
  console.log('\n📌 2. RETRY PATTERN');
  console.log('   Automatically retries failed operations\n');
  
  const retryHandler = new RetryHandler({
    maxAttempts: 3,
    baseDelay: 100,
    strategy: BackoffStrategy.EXPONENTIAL
  });
  
  let attemptCount = 0;
  try {
    const result = await retryHandler.execute(async () => {
      attemptCount++;
      if (attemptCount < 3) throw new Error('Temporary failure');
      return 'Succeeded after retries!';
    });
    console.log(`   ✅ ${result} (attempts: ${attemptCount})`);
  } catch (e) {
    console.log(`   ❌ All retries failed`);
  }
  
  // 3. Timeout Pattern Demo
  console.log('\n📌 3. TIMEOUT PATTERN');
  console.log('   Prevents hanging operations\n');
  
  const timeout = new TimeoutHandler({ duration: 500 });
  
  try {
    await timeout.execute(async () => {
      await new Promise(resolve => setTimeout(resolve, 1000));
      return 'Slow response';
    });
  } catch (e) {
    if (e instanceof TimeoutError) {
      console.log(`   ⏱️  Operation timed out after ${e.duration}ms`);
    }
  }
  
  // 4. Fallback Pattern Demo
  console.log('\n📌 4. FALLBACK PATTERN');
  console.log('   Provides graceful degradation\n');
  
  const fallback = new FallbackHandler();
  
  const result = await fallback.execute(
    async () => { throw new Error('Primary failed'); },
    async () => 'Fallback data'
  );
  console.log(`   📥 Result: ${result}`);
  
  // 5. Bulkhead Pattern Demo
  console.log('\n📌 5. BULKHEAD PATTERN');
  console.log('   Isolates resources to prevent cascade failures\n');
  
  const bulkhead = new Bulkhead({
    maxConcurrent: 2,
    maxQueueSize: 3
  });
  
  const tasks = Array(5).fill(null).map((_, i) =>
    bulkhead.execute(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
      return `Task ${i + 1} complete`;
    }).then(r => console.log(`   ✅ ${r}`))
      .catch(e => console.log(`   ❌ Task ${i + 1}: ${e.message}`))
  );
  
  await Promise.all(tasks);
  console.log(`   📊 Peak concurrent: ${bulkhead.getStats().peakConcurrent}`);
  
  // 6. Rate Limiter Demo
  console.log('\n📌 6. RATE LIMITER PATTERN');
  console.log('   Controls request rate\n');
  
  const rateLimiter = RateLimiterFactory.forUserActions({ capacity: 3 });
  
  for (let i = 0; i < 5; i++) {
    if (rateLimiter.tryConsume()) {
      console.log(`   ✅ Request ${i + 1}: Allowed`);
    } else {
      console.log(`   🚫 Request ${i + 1}: Rate limited`);
    }
  }
  
  rateLimiter.destroy();
  
  console.log('\n' + '='.repeat(60));
  console.log('✨ Demo complete! See examples/ folder for more use cases.\n');
}

// Run demo if this is the main module
import { fileURLToPath } from 'url';
import { argv } from 'process';

const isMainModule = argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  runDemo().catch(console.error);
}
