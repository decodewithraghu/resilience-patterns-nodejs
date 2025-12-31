import CircuitBreaker from 'opossum';

// ============================================
// CIRCUIT BREAKER PATTERN - Detailed Example
// ============================================

console.log('🔌 Circuit Breaker Pattern Demo\n');
console.log('This pattern prevents cascading failures by "opening" the circuit');
console.log('when too many failures occur, giving the system time to recover.\n');

// Simulate an unreliable microservice
let requestCount = 0;
async function callMicroservice(data) {
  requestCount++;
  const shouldFail = requestCount % 3 !== 0; // Fail 2 out of 3 times initially
  
  console.log(`   📡 Request #${requestCount}: Calling microservice...`);
  
  if (shouldFail) {
    throw new Error('Service error: Database connection timeout');
  }
  
  return {
    success: true,
    data: `Processed: ${data}`,
    timestamp: Date.now()
  };
}

// Fallback function when circuit is open
async function fallbackResponse(data) {
  console.log('   💾 Using fallback response');
  return {
    success: true,
    data: `Cached fallback for: ${data}`,
    cached: true
  };
}

// Configure the circuit breaker
const options = {
  timeout: 3000,                    // If request takes longer than 3s, fail
  errorThresholdPercentage: 50,     // Open circuit if 50% of requests fail
  resetTimeout: 10000,              // Try again after 10 seconds
  rollingCountTimeout: 10000,       // Time window for calculating error rate
  rollingCountBuckets: 10,          // Number of buckets in the window
  name: 'microserviceBreaker',      // Name for monitoring
  fallback: fallbackResponse,       // Fallback function
};

const breaker = new CircuitBreaker(callMicroservice, options);

// Monitor circuit breaker events
breaker.on('open', () => {
  console.log('\n⚠️  CIRCUIT OPENED - Too many failures detected!');
  console.log('   Stopping all requests to give the service time to recover.\n');
});

breaker.on('halfOpen', () => {
  console.log('\n🔄 CIRCUIT HALF-OPEN - Testing if service recovered...\n');
});

breaker.on('close', () => {
  console.log('\n✅ CIRCUIT CLOSED - Service is healthy again!\n');
});

breaker.on('success', (result) => {
  console.log(`   ✅ Success: ${result.data}`);
});

breaker.on('failure', (error) => {
  console.log(`   ❌ Failure: ${error.message}`);
});

breaker.on('fallback', (result) => {
  console.log(`   🔀 Fallback executed: ${result.data}`);
});

breaker.on('reject', () => {
  console.log('   🚫 Request rejected - circuit is open');
});

// Run the demonstration
async function runDemo() {
  console.log('Starting 15 requests to demonstrate circuit breaker behavior...\n');
  
  for (let i = 1; i <= 15; i++) {
    console.log(`\n--- Request ${i} ---`);
    try {
      const result = await breaker.fire(`Request-${i}`);
      console.log(`   Response: ${JSON.stringify(result)}`);
    } catch (error) {
      console.log(`   Error caught: ${error.message}`);
    }
    
    // Add delay between requests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Print statistics
  console.log('\n\n📊 Final Statistics:');
  console.log('====================');
  console.log(`Total fires: ${breaker.stats.fires}`);
  console.log(`Successes: ${breaker.stats.successes}`);
  console.log(`Failures: ${breaker.stats.failures}`);
  console.log(`Fallbacks: ${breaker.stats.fallbacks}`);
  console.log(`Rejections: ${breaker.stats.rejects}`);
  console.log(`Timeouts: ${breaker.stats.timeouts}`);
  console.log(`Cache hits: ${breaker.stats.cacheHits}`);
  console.log(`Circuit state: ${breaker.opened ? 'OPEN' : breaker.halfOpen ? 'HALF-OPEN' : 'CLOSED'}`);
  
  console.log('\n✨ Demo completed!\n');
}

runDemo().catch(console.error);
