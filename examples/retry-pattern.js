// ============================================
// RETRY PATTERN - Detailed Example
// ============================================

console.log('🔄 Retry Pattern with Exponential Backoff\n');
console.log('This pattern automatically retries failed operations with');
console.log('increasing delays between attempts.\n');

// ============================================
// Retry Implementation
// ============================================

class RetryHandler {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || 3;
    this.baseDelay = options.baseDelay || 1000;
    this.maxDelay = options.maxDelay || 30000;
    this.backoffMultiplier = options.backoffMultiplier || 2;
    this.jitter = options.jitter !== false; // Add randomness to prevent thundering herd
  }

  async execute(fn, context = '') {
    let lastError;
    
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        console.log(`   🎯 Attempt ${attempt + 1}/${this.maxRetries}${context ? ': ' + context : ''}`);
        const result = await fn();
        console.log(`   ✅ Success on attempt ${attempt + 1}`);
        return result;
      } catch (error) {
        lastError = error;
        console.log(`   ❌ Attempt ${attempt + 1} failed: ${error.message}`);
        
        if (attempt < this.maxRetries - 1) {
          const delay = this.calculateDelay(attempt);
          console.log(`   ⏳ Waiting ${delay}ms before retry...`);
          await this.sleep(delay);
        }
      }
    }
    
    console.log(`   💥 All ${this.maxRetries} attempts failed`);
    throw lastError;
  }

  calculateDelay(attempt) {
    // Exponential backoff: delay = baseDelay * (backoffMultiplier ^ attempt)
    let delay = this.baseDelay * Math.pow(this.backoffMultiplier, attempt);
    
    // Cap at maxDelay
    delay = Math.min(delay, this.maxDelay);
    
    // Add jitter (random variation) to prevent thundering herd
    if (this.jitter) {
      delay = delay * (0.5 + Math.random() * 0.5); // Random between 50% and 100%
    }
    
    return Math.floor(delay);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================
// Test Scenarios
// ============================================

// Scenario 1: Service recovers after 2 failures
async function scenario1() {
  console.log('\n📌 Scenario 1: Service recovers after 2 failures');
  console.log('═══════════════════════════════════════════════\n');
  
  let attemptCount = 0;
  async function flakeyService() {
    attemptCount++;
    if (attemptCount < 3) {
      throw new Error('Connection timeout');
    }
    return { data: 'Success!', attempts: attemptCount };
  }
  
  const retry = new RetryHandler({ maxRetries: 5, baseDelay: 500 });
  
  try {
    const result = await retry.execute(flakeyService, 'Flakey Service');
    console.log(`   📦 Result: ${JSON.stringify(result)}\n`);
  } catch (error) {
    console.log(`   ❌ Final error: ${error.message}\n`);
  }
}

// Scenario 2: Service never recovers
async function scenario2() {
  console.log('📌 Scenario 2: Service never recovers (all retries fail)');
  console.log('═══════════════════════════════════════════════\n');
  
  async function alwaysFailingService() {
    throw new Error('Service permanently down');
  }
  
  const retry = new RetryHandler({ maxRetries: 3, baseDelay: 500 });
  
  try {
    await retry.execute(alwaysFailingService, 'Broken Service');
  } catch (error) {
    console.log(`   🚨 Caught final error: ${error.message}\n`);
  }
}

// Scenario 3: Network call with retry
async function scenario3() {
  console.log('📌 Scenario 3: Simulated network call with transient failures');
  console.log('═══════════════════════════════════════════════\n');
  
  let callCount = 0;
  async function networkCall() {
    callCount++;
    const shouldSucceed = Math.random() > 0.4 || callCount >= 3;
    
    if (!shouldSucceed) {
      throw new Error('Network error: ETIMEDOUT');
    }
    
    return {
      status: 200,
      body: { message: 'Data fetched successfully', id: 12345 }
    };
  }
  
  const retry = new RetryHandler({
    maxRetries: 5,
    baseDelay: 1000,
    maxDelay: 10000,
    backoffMultiplier: 2
  });
  
  try {
    const response = await retry.execute(networkCall, 'API Call');
    console.log(`   📦 Response: ${JSON.stringify(response)}\n`);
  } catch (error) {
    console.log(`   🚨 Failed to fetch data: ${error.message}\n`);
  }
}

// Scenario 4: Database connection retry
async function scenario4() {
  console.log('📌 Scenario 4: Database connection with retry');
  console.log('═══════════════════════════════════════════════\n');
  
  let connectionAttempts = 0;
  async function connectToDatabase() {
    connectionAttempts++;
    console.log(`      🔌 Connecting to database...`);
    
    // Simulate: database starts accepting connections after 2 failures
    if (connectionAttempts < 3) {
      throw new Error('ECONNREFUSED: Database not ready');
    }
    
    return { connected: true, host: 'localhost:5432', dbName: 'myapp' };
  }
  
  const retry = new RetryHandler({
    maxRetries: 4,
    baseDelay: 2000,
    jitter: true
  });
  
  try {
    const connection = await retry.execute(connectToDatabase, 'Database Connection');
    console.log(`   📦 Connected: ${JSON.stringify(connection)}\n`);
  } catch (error) {
    console.log(`   🚨 Connection failed: ${error.message}\n`);
  }
}

// ============================================
// Run All Scenarios
// ============================================

async function runAllScenarios() {
  console.log('Starting retry pattern demonstrations...\n');
  
  await scenario1();
  await new Promise(resolve => setTimeout(resolve, 500));
  
  await scenario2();
  await new Promise(resolve => setTimeout(resolve, 500));
  
  await scenario3();
  await new Promise(resolve => setTimeout(resolve, 500));
  
  await scenario4();
  
  console.log('✨ All scenarios completed!\n');
}

runAllScenarios().catch(console.error);
