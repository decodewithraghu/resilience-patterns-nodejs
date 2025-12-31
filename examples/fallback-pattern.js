// ============================================
// FALLBACK PATTERN - Detailed Example
// ============================================

console.log('🔀 Fallback Pattern Demo\n');
console.log('This pattern provides alternative responses when primary');
console.log('operations fail, ensuring graceful degradation.\n');

// ============================================
// Fallback Implementation
// ============================================

class FallbackHandler {
  /**
   * Execute with single fallback
   */
  static async withFallback(primaryFn, fallbackFn, options = {}) {
    const { operationName = 'Operation', logDetails = true } = options;
    
    try {
      if (logDetails) console.log(`   🎯 Trying primary: ${operationName}`);
      const result = await primaryFn();
      if (logDetails) console.log(`   ✅ Primary succeeded`);
      return { ...result, source: 'primary' };
    } catch (primaryError) {
      if (logDetails) {
        console.log(`   ❌ Primary failed: ${primaryError.message}`);
        console.log(`   🔄 Executing fallback...`);
      }
      
      try {
        const result = await fallbackFn();
        if (logDetails) console.log(`   ✅ Fallback succeeded`);
        return { ...result, source: 'fallback', primaryError: primaryError.message };
      } catch (fallbackError) {
        if (logDetails) console.log(`   💥 Fallback also failed: ${fallbackError.message}`);
        throw new Error(`Both primary and fallback failed. Primary: ${primaryError.message}, Fallback: ${fallbackError.message}`);
      }
    }
  }

  /**
   * Execute with cascading fallbacks (try multiple alternatives)
   */
  static async withCascadingFallbacks(strategies, operationName = 'Operation') {
    const errors = [];
    
    for (let i = 0; i < strategies.length; i++) {
      const strategy = strategies[i];
      try {
        console.log(`   🎯 Trying strategy ${i + 1}/${strategies.length}: ${strategy.name}`);
        const result = await strategy.fn();
        console.log(`   ✅ Strategy "${strategy.name}" succeeded`);
        return {
          ...result,
          strategy: strategy.name,
          attemptNumber: i + 1,
          errors: errors
        };
      } catch (error) {
        console.log(`   ❌ Strategy "${strategy.name}" failed: ${error.message}`);
        errors.push({ strategy: strategy.name, error: error.message });
        
        if (i === strategies.length - 1) {
          throw new Error(`All ${strategies.length} strategies failed: ${errors.map(e => e.strategy).join(', ')}`);
        }
      }
    }
  }
}

// ============================================
// Test Scenarios
// ============================================

// Scenario 1: API with cache fallback
async function scenario1() {
  console.log('📌 Scenario 1: API call with cache fallback');
  console.log('═══════════════════════════════════════════\n');
  
  async function fetchFromAPI() {
    // Simulate API failure
    throw new Error('API rate limit exceeded');
  }
  
  async function fetchFromCache() {
    return {
      data: { id: 1, name: 'Product A', price: 29.99 },
      timestamp: new Date(Date.now() - 3600000).toISOString(),
      cached: true
    };
  }
  
  try {
    const result = await FallbackHandler.withFallback(
      fetchFromAPI,
      fetchFromCache,
      { operationName: 'Product Data' }
    );
    console.log(`   📦 Result: ${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.log(`   💥 Error: ${error.message}\n`);
  }
}

// Scenario 2: Database with multiple fallbacks
async function scenario2() {
  console.log('📌 Scenario 2: Database with read replica fallbacks');
  console.log('═══════════════════════════════════════════════════\n');
  
  const strategies = [
    {
      name: 'Primary Database',
      fn: async () => {
        throw new Error('Primary DB connection timeout');
      }
    },
    {
      name: 'Read Replica 1',
      fn: async () => {
        throw new Error('Replica 1 is lagging behind');
      }
    },
    {
      name: 'Read Replica 2',
      fn: async () => {
        return {
          users: [
            { id: 1, name: 'Alice' },
            { id: 2, name: 'Bob' }
          ],
          count: 2
        };
      }
    }
  ];
  
  try {
    const result = await FallbackHandler.withCascadingFallbacks(
      strategies,
      'User Query'
    );
    console.log(`   📦 Result: ${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.log(`   💥 Error: ${error.message}\n`);
  }
}

// Scenario 3: Payment processing with fallback
async function scenario3() {
  console.log('📌 Scenario 3: Payment gateway with fallback');
  console.log('═══════════════════════════════════════════════\n');
  
  let primaryCalled = false;
  
  async function primaryPaymentGateway(amount) {
    primaryCalled = true;
    // Simulate gateway down
    throw new Error('Payment gateway unavailable');
  }
  
  async function backupPaymentGateway(amount) {
    return {
      transactionId: 'TXN-' + Math.random().toString(36).substr(2, 9).toUpperCase(),
      amount: amount,
      status: 'completed',
      gateway: 'backup'
    };
  }
  
  const amount = 99.99;
  console.log(`   💳 Processing payment of $${amount}`);
  
  try {
    const result = await FallbackHandler.withFallback(
      () => primaryPaymentGateway(amount),
      () => backupPaymentGateway(amount),
      { operationName: 'Payment Processing' }
    );
    console.log(`   📦 Payment result: ${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.log(`   💥 Payment failed: ${error.message}\n`);
  }
}

// Scenario 4: Configuration with defaults
async function scenario4() {
  console.log('📌 Scenario 4: Configuration loading with defaults');
  console.log('═══════════════════════════════════════════════════\n');
  
  async function loadRemoteConfig() {
    throw new Error('Config server unreachable');
  }
  
  async function loadLocalConfig() {
    throw new Error('Local config file not found');
  }
  
  async function useDefaultConfig() {
    return {
      config: {
        apiUrl: 'https://api.default.com',
        timeout: 5000,
        retries: 3,
        environment: 'production'
      },
      source: 'defaults',
      warning: 'Using built-in defaults'
    };
  }
  
  const strategies = [
    { name: 'Remote Config', fn: loadRemoteConfig },
    { name: 'Local Config', fn: loadLocalConfig },
    { name: 'Default Config', fn: useDefaultConfig }
  ];
  
  try {
    const result = await FallbackHandler.withCascadingFallbacks(
      strategies,
      'Configuration'
    );
    console.log(`   📦 Configuration loaded: ${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.log(`   💥 Error: ${error.message}\n`);
  }
}

// Scenario 5: Content delivery with CDN fallback
async function scenario5() {
  console.log('📌 Scenario 5: Content delivery with CDN fallback');
  console.log('═══════════════════════════════════════════════════\n');
  
  const strategies = [
    {
      name: 'Primary CDN (US-East)',
      fn: async () => {
        throw new Error('CDN node unavailable');
      }
    },
    {
      name: 'Secondary CDN (EU-West)',
      fn: async () => {
        return {
          content: 'Video stream data...',
          url: 'https://cdn-eu.example.com/video/12345',
          latency: 250,
          quality: 'HD'
        };
      }
    },
    {
      name: 'Origin Server',
      fn: async () => {
        return {
          content: 'Video stream data...',
          url: 'https://origin.example.com/video/12345',
          latency: 800,
          quality: 'SD',
          warning: 'Higher latency - using origin server'
        };
      }
    }
  ];
  
  try {
    const result = await FallbackHandler.withCascadingFallbacks(
      strategies,
      'Video Delivery'
    );
    console.log(`   📦 Content delivered: ${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.log(`   💥 Error: ${error.message}\n`);
  }
}

// Scenario 6: Successful primary (no fallback needed)
async function scenario6() {
  console.log('📌 Scenario 6: Primary succeeds (fallback not needed)');
  console.log('═══════════════════════════════════════════════════\n');
  
  async function healthyService() {
    return {
      data: 'Real-time data',
      timestamp: new Date().toISOString(),
      fresh: true
    };
  }
  
  async function fallbackService() {
    return {
      data: 'This should not be called',
      cached: true
    };
  }
  
  try {
    const result = await FallbackHandler.withFallback(
      healthyService,
      fallbackService,
      { operationName: 'Healthy Service' }
    );
    console.log(`   📦 Result: ${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.log(`   💥 Error: ${error.message}\n`);
  }
}

// ============================================
// Run All Scenarios
// ============================================

async function runAllScenarios() {
  console.log('Starting fallback pattern demonstrations...\n');
  
  await scenario1();
  await new Promise(resolve => setTimeout(resolve, 500));
  
  await scenario2();
  await new Promise(resolve => setTimeout(resolve, 500));
  
  await scenario3();
  await new Promise(resolve => setTimeout(resolve, 500));
  
  await scenario4();
  await new Promise(resolve => setTimeout(resolve, 500));
  
  await scenario5();
  await new Promise(resolve => setTimeout(resolve, 500));
  
  await scenario6();
  
  console.log('✨ All scenarios completed!\n');
}

runAllScenarios().catch(console.error);
