import CircuitBreaker from 'opossum';
import axios from 'axios';

// ============================================
// RESILIENCE PATTERNS DEMONSTRATION
// ============================================

console.log('🚀 Resilience Patterns Demo Starting...\n');

// ============================================
// 1. CIRCUIT BREAKER PATTERN
// ============================================
console.log('📌 1. Circuit Breaker Pattern');
console.log('   Protects against cascading failures by stopping requests to failing services\n');

// Simulate an unreliable API call
async function unreliableApiCall() {
  // 70% chance of failure to demonstrate circuit breaker
  if (Math.random() > 0.3) {
    throw new Error('Service temporarily unavailable');
  }
  return { data: 'Success!', timestamp: new Date().toISOString() };
}

// Configure circuit breaker
const circuitBreakerOptions = {
  timeout: 3000, // If function takes longer than 3s, trigger a failure
  errorThresholdPercentage: 50, // When 50% of requests fail, open circuit
  resetTimeout: 5000, // After 5s, try again
  rollingCountTimeout: 10000, // Rolling window for error calculation
};

const breaker = new CircuitBreaker(unreliableApiCall, circuitBreakerOptions);

// Event listeners for monitoring
breaker.on('open', () => console.log('   ⚠️  Circuit breaker opened - stopping requests'));
breaker.on('halfOpen', () => console.log('   🔄 Circuit breaker half-open - testing service'));
breaker.on('close', () => console.log('   ✅ Circuit breaker closed - service healthy'));
breaker.on('failure', (error) => console.log(`   ❌ Request failed: ${error.message}`));
breaker.on('success', (result) => console.log(`   ✅ Request succeeded: ${result.data}`));

// ============================================
// 2. RETRY PATTERN
// ============================================
async function retryWithExponentialBackoff(fn, maxRetries = 3, baseDelay = 1000) {
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt); // Exponential backoff
        console.log(`   🔄 Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

// ============================================
// 3. TIMEOUT PATTERN
// ============================================
function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
}

// ============================================
// 4. FALLBACK PATTERN
// ============================================
async function withFallback(primaryFn, fallbackFn) {
  try {
    return await primaryFn();
  } catch (error) {
    console.log(`   ⚠️  Primary failed: ${error.message}, using fallback`);
    return await fallbackFn();
  }
}

// ============================================
// DEMONSTRATION FUNCTIONS
// ============================================

async function demonstrateCircuitBreaker() {
  console.log('\n🔧 Testing Circuit Breaker...');
  
  // Make multiple requests to trigger circuit breaker
  for (let i = 0; i < 10; i++) {
    try {
      await breaker.fire();
    } catch (error) {
      // Errors are logged by event listeners
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log(`\n📊 Circuit Breaker Stats:`);
  console.log(`   - State: ${breaker.opened ? 'OPEN' : breaker.halfOpen ? 'HALF-OPEN' : 'CLOSED'}`);
  console.log(`   - Total requests: ${breaker.stats.fires}`);
  console.log(`   - Successes: ${breaker.stats.successes}`);
  console.log(`   - Failures: ${breaker.stats.failures}`);
  console.log(`   - Fallbacks: ${breaker.stats.fallbacks}`);
}

async function demonstrateRetry() {
  console.log('\n🔧 Testing Retry Pattern with Exponential Backoff...');
  
  let attemptCount = 0;
  async function flakeyOperation() {
    attemptCount++;
    console.log(`   📡 Attempt ${attemptCount}: Calling service...`);
    
    // Succeed on 3rd attempt
    if (attemptCount < 3) {
      throw new Error('Connection refused');
    }
    return { success: true, message: 'Operation completed' };
  }
  
  try {
    const result = await retryWithExponentialBackoff(flakeyOperation, 5, 500);
    console.log(`   ✅ Success: ${result.message}`);
  } catch (error) {
    console.log(`   ❌ All retries failed: ${error.message}`);
  }
}

async function demonstrateTimeout() {
  console.log('\n🔧 Testing Timeout Pattern...');
  
  async function slowOperation() {
    console.log('   ⏳ Starting slow operation...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    return 'Completed';
  }
  
  try {
    const result = await withTimeout(slowOperation(), 2000);
    console.log(`   ✅ ${result}`);
  } catch (error) {
    console.log(`   ❌ ${error.message}`);
  }
}

async function demonstrateFallback() {
  console.log('\n🔧 Testing Fallback Pattern...');
  
  async function primaryDatabase() {
    console.log('   🔍 Trying primary database...');
    throw new Error('Primary database unavailable');
  }
  
  async function fallbackCache() {
    console.log('   💾 Using cache as fallback...');
    return { data: 'Cached data', source: 'cache' };
  }
  
  try {
    const result = await withFallback(primaryDatabase, fallbackCache);
    console.log(`   ✅ Result: ${JSON.stringify(result)}`);
  } catch (error) {
    console.log(`   ❌ Both primary and fallback failed`);
  }
}

async function demonstrateRealWorldExample() {
  console.log('\n🌐 Real-World Example: API Call with Circuit Breaker + Fallback...');
  
  // Simulate API call with circuit breaker and fallback
  async function fetchUserData(userId) {
    // Simulating external API call
    if (Math.random() > 0.5) {
      throw new Error('API unavailable');
    }
    return { id: userId, name: 'John Doe', email: 'john@example.com' };
  }
  
  async function getCachedUserData(userId) {
    return { id: userId, name: 'Cached User', email: 'cached@example.com', cached: true };
  }
  
  const userBreaker = new CircuitBreaker(fetchUserData, {
    timeout: 2000,
    errorThresholdPercentage: 50,
    resetTimeout: 3000,
    fallback: getCachedUserData
  });
  
  // Try fetching user data multiple times
  for (let i = 0; i < 5; i++) {
    try {
      const user = await userBreaker.fire(123);
      console.log(`   ${i + 1}. User: ${user.name} ${user.cached ? '(from cache)' : '(from API)'}`);
    } catch (error) {
      console.log(`   ${i + 1}. ❌ Failed to get user data`);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

// ============================================
// RUN ALL DEMONSTRATIONS
// ============================================
async function runAllDemos() {
  try {
    await demonstrateCircuitBreaker();
    await demonstrateRetry();
    await demonstrateTimeout();
    await demonstrateFallback();
    await demonstrateRealWorldExample();
    
    console.log('\n✨ All resilience pattern demonstrations completed!\n');
  } catch (error) {
    console.error('Demo error:', error);
  }
}

// Start the demonstration
runAllDemos();
