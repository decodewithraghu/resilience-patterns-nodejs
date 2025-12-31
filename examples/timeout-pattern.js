// ============================================
// TIMEOUT PATTERN - Detailed Example
// ============================================

console.log('⏱️  Timeout Pattern Demo\n');
console.log('This pattern prevents operations from hanging indefinitely');
console.log('by setting maximum execution time limits.\n');

// ============================================
// Timeout Implementation
// ============================================

class TimeoutHandler {
  /**
   * Execute a promise with a timeout
   * @param {Promise} promise - The promise to execute
   * @param {number} timeoutMs - Timeout in milliseconds
   * @param {string} operationName - Name for logging
   */
  static async withTimeout(promise, timeoutMs, operationName = 'Operation') {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]);
  }

  /**
   * Execute a function with timeout and optional retry
   * @param {Function} fn - Async function to execute
   * @param {Object} options - Configuration options
   */
  static async executeWithTimeout(fn, options = {}) {
    const {
      timeout = 5000,
      retries = 0,
      operationName = 'Operation',
      onTimeout = null
    } = options;

    let lastError;
    
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`   🔄 Retry attempt ${attempt}/${retries}`);
        }
        
        const result = await this.withTimeout(fn(), timeout, operationName);
        return result;
      } catch (error) {
        lastError = error;
        
        if (error.message.includes('timed out')) {
          console.log(`   ⏰ ${error.message}`);
          if (onTimeout) {
            await onTimeout(attempt);
          }
        } else {
          console.log(`   ❌ Error: ${error.message}`);
        }
        
        if (attempt < retries) {
          const delay = 1000 * (attempt + 1);
          console.log(`   ⏳ Waiting ${delay}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError;
  }
}

// ============================================
// Test Scenarios
// ============================================

// Scenario 1: Fast operation (completes before timeout)
async function scenario1() {
  console.log('📌 Scenario 1: Fast operation (success)');
  console.log('═══════════════════════════════════════\n');
  
  async function fastOperation() {
    console.log('   🚀 Starting fast operation...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    return { result: 'Completed successfully', duration: '1s' };
  }
  
  try {
    const result = await TimeoutHandler.withTimeout(
      fastOperation(),
      3000,
      'Fast API Call'
    );
    console.log(`   ✅ Success: ${JSON.stringify(result)}\n`);
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}\n`);
  }
}

// Scenario 2: Slow operation (times out)
async function scenario2() {
  console.log('📌 Scenario 2: Slow operation (timeout)');
  console.log('═══════════════════════════════════════\n');
  
  async function slowOperation() {
    console.log('   🐌 Starting slow operation...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    return { result: 'This will never return' };
  }
  
  try {
    const result = await TimeoutHandler.withTimeout(
      slowOperation(),
      2000,
      'Slow Database Query'
    );
    console.log(`   ✅ Success: ${JSON.stringify(result)}\n`);
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}\n`);
  }
}

// Scenario 3: Multiple operations with different timeouts
async function scenario3() {
  console.log('📌 Scenario 3: Multiple operations with different timeouts');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  const operations = [
    { name: 'User Service', duration: 500, timeout: 1000 },
    { name: 'Product Service', duration: 2000, timeout: 1500 },
    { name: 'Payment Service', duration: 800, timeout: 2000 },
    { name: 'Analytics Service', duration: 3000, timeout: 2500 },
  ];
  
  const results = await Promise.allSettled(
    operations.map(async (op) => {
      console.log(`   📡 Calling ${op.name}...`);
      const startTime = Date.now();
      
      try {
        const result = await TimeoutHandler.withTimeout(
          new Promise(resolve => 
            setTimeout(() => resolve({ service: op.name, status: 'success' }), op.duration)
          ),
          op.timeout,
          op.name
        );
        
        const elapsed = Date.now() - startTime;
        console.log(`   ✅ ${op.name} completed in ${elapsed}ms`);
        return result;
      } catch (error) {
        const elapsed = Date.now() - startTime;
        console.log(`   ❌ ${op.name} failed after ${elapsed}ms: ${error.message}`);
        throw error;
      }
    })
  );
  
  console.log('\n   📊 Summary:');
  results.forEach((result, index) => {
    const op = operations[index];
    if (result.status === 'fulfilled') {
      console.log(`   ✅ ${op.name}: Success`);
    } else {
      console.log(`   ❌ ${op.name}: Failed`);
    }
  });
  console.log();
}

// Scenario 4: Timeout with retry
async function scenario4() {
  console.log('📌 Scenario 4: Timeout with automatic retry');
  console.log('═══════════════════════════════════════════════\n');
  
  let attemptNumber = 0;
  async function unreliableOperation() {
    attemptNumber++;
    console.log(`      🎲 Executing attempt ${attemptNumber}...`);
    
    // First two attempts are slow (will timeout), third is fast
    const delay = attemptNumber < 3 ? 4000 : 500;
    await new Promise(resolve => setTimeout(resolve, delay));
    
    return { success: true, attempt: attemptNumber };
  }
  
  try {
    const result = await TimeoutHandler.executeWithTimeout(
      unreliableOperation,
      {
        timeout: 2000,
        retries: 3,
        operationName: 'Unreliable Service',
        onTimeout: async (attempt) => {
          console.log(`      ⚠️  Timeout occurred on attempt ${attempt + 1}`);
        }
      }
    );
    console.log(`   ✅ Final result: ${JSON.stringify(result)}\n`);
  } catch (error) {
    console.log(`   💥 All attempts failed: ${error.message}\n`);
  }
}

// Scenario 5: Graceful degradation with timeout
async function scenario5() {
  console.log('📌 Scenario 5: Graceful degradation (timeout with fallback)');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  async function primaryDataSource() {
    console.log('   🔍 Fetching from primary source...');
    await new Promise(resolve => setTimeout(resolve, 5000)); // Too slow
    return { data: 'Fresh data', source: 'primary' };
  }
  
  async function fallbackDataSource() {
    console.log('   💾 Fetching from cache...');
    await new Promise(resolve => setTimeout(resolve, 100));
    return { data: 'Cached data', source: 'cache', warning: 'Using stale data' };
  }
  
  try {
    const result = await TimeoutHandler.withTimeout(
      primaryDataSource(),
      2000,
      'Primary Data Source'
    );
    console.log(`   ✅ Result: ${JSON.stringify(result)}\n`);
  } catch (error) {
    console.log(`   ⚠️  ${error.message}`);
    console.log('   🔄 Falling back to cache...');
    const fallbackResult = await fallbackDataSource();
    console.log(`   ✅ Fallback result: ${JSON.stringify(fallbackResult)}\n`);
  }
}

// ============================================
// Run All Scenarios
// ============================================

async function runAllScenarios() {
  console.log('Starting timeout pattern demonstrations...\n');
  
  await scenario1();
  await new Promise(resolve => setTimeout(resolve, 500));
  
  await scenario2();
  await new Promise(resolve => setTimeout(resolve, 500));
  
  await scenario3();
  await new Promise(resolve => setTimeout(resolve, 500));
  
  await scenario4();
  await new Promise(resolve => setTimeout(resolve, 500));
  
  await scenario5();
  
  console.log('✨ All scenarios completed!\n');
}

runAllScenarios().catch(console.error);
