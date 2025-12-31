// ============================================
// RATE LIMITER PATTERN - Detailed Example
// ============================================

console.log('🚦 Rate Limiter Pattern Demo\n');
console.log('This pattern controls the rate of requests to prevent');
console.log('overwhelming services and ensures fair resource usage.\n');

// ============================================
// Rate Limiter Implementations
// ============================================

// Token Bucket Algorithm
class TokenBucket {
  constructor(options = {}) {
    this.capacity = options.capacity || 10;
    this.refillRate = options.refillRate || 1; // tokens per interval
    this.refillInterval = options.refillInterval || 1000; // ms
    this.tokens = this.capacity;
    this.name = options.name || 'TokenBucket';
    
    this.stats = {
      allowed: 0,
      rejected: 0,
      tokensConsumed: 0
    };
    
    // Start refill timer
    this.refillTimer = setInterval(() => {
      this.refill();
    }, this.refillInterval);
  }

  refill() {
    const oldTokens = this.tokens;
    this.tokens = Math.min(this.capacity, this.tokens + this.refillRate);
    if (this.tokens > oldTokens) {
      console.log(`   🪙 [${this.name}] Refilled: ${this.tokens}/${this.capacity} tokens available`);
    }
  }

  async tryConsume(tokens = 1) {
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      this.stats.allowed++;
      this.stats.tokensConsumed += tokens;
      console.log(`   ✅ [${this.name}] Request allowed (${this.tokens}/${this.capacity} tokens remaining)`);
      return true;
    } else {
      this.stats.rejected++;
      console.log(`   ❌ [${this.name}] Request rejected - insufficient tokens (${this.tokens}/${this.capacity})`);
      return false;
    }
  }

  async execute(fn, tokens = 1) {
    const allowed = await this.tryConsume(tokens);
    if (!allowed) {
      throw new Error(`Rate limit exceeded for ${this.name}`);
    }
    return await fn();
  }

  getStats() {
    return {
      ...this.stats,
      tokensAvailable: this.tokens,
      capacity: this.capacity
    };
  }

  destroy() {
    clearInterval(this.refillTimer);
  }
}

// Sliding Window Rate Limiter
class SlidingWindowRateLimiter {
  constructor(options = {}) {
    this.maxRequests = options.maxRequests || 10;
    this.windowMs = options.windowMs || 60000;
    this.name = options.name || 'SlidingWindow';
    this.requests = [];
    
    this.stats = {
      allowed: 0,
      rejected: 0
    };
  }

  cleanup() {
    const cutoff = Date.now() - this.windowMs;
    this.requests = this.requests.filter(timestamp => timestamp > cutoff);
  }

  async tryAcquire() {
    this.cleanup();
    
    if (this.requests.length < this.maxRequests) {
      this.requests.push(Date.now());
      this.stats.allowed++;
      console.log(`   ✅ [${this.name}] Request allowed (${this.requests.length}/${this.maxRequests} in window)`);
      return true;
    } else {
      this.stats.rejected++;
      const oldestRequest = this.requests[0];
      const waitTime = Math.ceil((oldestRequest + this.windowMs - Date.now()) / 1000);
      console.log(`   ❌ [${this.name}] Rate limit exceeded (retry in ~${waitTime}s)`);
      return false;
    }
  }

  async execute(fn) {
    const allowed = await this.tryAcquire();
    if (!allowed) {
      throw new Error(`Rate limit exceeded for ${this.name}`);
    }
    return await fn();
  }

  getStats() {
    this.cleanup();
    return {
      ...this.stats,
      currentRequests: this.requests.length,
      maxRequests: this.maxRequests
    };
  }
}

// Leaky Bucket Rate Limiter
class LeakyBucket {
  constructor(options = {}) {
    this.capacity = options.capacity || 10;
    this.leakRate = options.leakRate || 1; // requests per interval
    this.leakInterval = options.leakInterval || 1000;
    this.name = options.name || 'LeakyBucket';
    this.queue = [];
    
    this.stats = {
      processed: 0,
      rejected: 0,
      queued: 0
    };
    
    // Start leak timer
    this.leakTimer = setInterval(() => {
      this.leak();
    }, this.leakInterval);
  }

  async leak() {
    for (let i = 0; i < this.leakRate && this.queue.length > 0; i++) {
      const item = this.queue.shift();
      console.log(`   💧 [${this.name}] Processing request (${this.queue.length} remaining in queue)`);
      
      try {
        const result = await item.fn();
        this.stats.processed++;
        item.resolve(result);
      } catch (error) {
        item.reject(error);
      }
    }
  }

  async execute(fn) {
    if (this.queue.length >= this.capacity) {
      this.stats.rejected++;
      console.log(`   ❌ [${this.name}] Queue full - request rejected (${this.queue.length}/${this.capacity})`);
      throw new Error(`Leaky bucket queue full for ${this.name}`);
    }
    
    this.stats.queued++;
    console.log(`   ⏸️  [${this.name}] Request queued (${this.queue.length + 1}/${this.capacity})`);
    
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
    });
  }

  getStats() {
    return {
      ...this.stats,
      queueSize: this.queue.length,
      capacity: this.capacity
    };
  }

  destroy() {
    clearInterval(this.leakTimer);
  }
}

// ============================================
// Test Scenarios
// ============================================

// Scenario 1: Token Bucket for API rate limiting
async function scenario1() {
  console.log('📌 Scenario 1: Token Bucket for API calls');
  console.log('═══════════════════════════════════════════\n');
  
  const apiBucket = new TokenBucket({
    capacity: 5,
    refillRate: 2,
    refillInterval: 2000,
    name: 'API-TokenBucket'
  });
  
  async function apiCall(id) {
    await new Promise(resolve => setTimeout(resolve, 100));
    return { id, status: 'success', timestamp: Date.now() };
  }
  
  // Make 10 rapid requests
  console.log('   🔥 Making 10 rapid API calls...\n');
  for (let i = 1; i <= 10; i++) {
    try {
      const result = await apiBucket.execute(() => apiCall(i));
      console.log(`      ✅ Call ${i} completed`);
    } catch (error) {
      console.log(`      ⛔ Call ${i} blocked: ${error.message}`);
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  
  // Wait for refill
  console.log('\n   ⏳ Waiting 3 seconds for token refill...\n');
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Try a few more requests
  console.log('   🔄 Trying 3 more requests after refill...\n');
  for (let i = 11; i <= 13; i++) {
    try {
      await apiBucket.execute(() => apiCall(i));
      console.log(`      ✅ Call ${i} completed`);
    } catch (error) {
      console.log(`      ⛔ Call ${i} blocked`);
    }
  }
  
  console.log('\n   📊 Token Bucket Stats:');
  const stats = apiBucket.getStats();
  Object.entries(stats).forEach(([key, value]) => {
    console.log(`   - ${key}: ${value}`);
  });
  
  apiBucket.destroy();
  console.log();
}

// Scenario 2: Sliding Window for user actions
async function scenario2() {
  console.log('📌 Scenario 2: Sliding Window for user rate limiting');
  console.log('═══════════════════════════════════════════════════════\n');
  
  const userLimiter = new SlidingWindowRateLimiter({
    maxRequests: 5,
    windowMs: 5000, // 5 seconds
    name: 'User-Actions'
  });
  
  async function userAction(action) {
    await new Promise(resolve => setTimeout(resolve, 100));
    return { action, timestamp: Date.now() };
  }
  
  // Simulate 8 user actions
  console.log('   👤 User performing 8 actions rapidly...\n');
  for (let i = 1; i <= 8; i++) {
    try {
      await userLimiter.execute(() => userAction(`Action-${i}`));
      console.log(`      ✅ Action ${i} completed`);
    } catch (error) {
      console.log(`      ⛔ Action ${i} rate limited`);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log('\n   ⏳ Waiting 6 seconds for window to slide...\n');
  await new Promise(resolve => setTimeout(resolve, 6000));
  
  console.log('   🔄 Trying 3 more actions after window reset...\n');
  for (let i = 9; i <= 11; i++) {
    try {
      await userLimiter.execute(() => userAction(`Action-${i}`));
      console.log(`      ✅ Action ${i} completed`);
    } catch (error) {
      console.log(`      ⛔ Action ${i} rate limited`);
    }
  }
  
  console.log('\n   📊 Sliding Window Stats:');
  const stats = userLimiter.getStats();
  Object.entries(stats).forEach(([key, value]) => {
    console.log(`   - ${key}: ${value}`);
  });
  console.log();
}

// Scenario 3: Leaky Bucket for smooth request processing
async function scenario3() {
  console.log('📌 Scenario 3: Leaky Bucket for traffic shaping');
  console.log('═══════════════════════════════════════════════════\n');
  
  const bucket = new LeakyBucket({
    capacity: 8,
    leakRate: 2,
    leakInterval: 1000,
    name: 'Traffic-Shaper'
  });
  
  async function processRequest(id) {
    return { id, processed: true, timestamp: Date.now() };
  }
  
  // Submit 12 requests rapidly
  console.log('   📤 Submitting 12 requests rapidly...\n');
  const promises = [];
  
  for (let i = 1; i <= 12; i++) {
    const promise = bucket.execute(() => processRequest(i))
      .then(result => {
        console.log(`      ✅ Request ${result.id} processed`);
        return result;
      })
      .catch(error => {
        console.log(`      ⛔ Request ${i} rejected: ${error.message}`);
        return { id: i, rejected: true };
      });
    
    promises.push(promise);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // Wait for all to complete
  await Promise.all(promises);
  
  console.log('\n   📊 Leaky Bucket Stats:');
  const stats = bucket.getStats();
  Object.entries(stats).forEach(([key, value]) => {
    console.log(`   - ${key}: ${value}`);
  });
  
  bucket.destroy();
  console.log();
}

// Scenario 4: Combined rate limiting strategies
async function scenario4() {
  console.log('📌 Scenario 4: Multi-tier rate limiting');
  console.log('═══════════════════════════════════════════\n');
  
  const perSecondLimiter = new TokenBucket({
    capacity: 3,
    refillRate: 3,
    refillInterval: 1000,
    name: 'PerSecond'
  });
  
  const perMinuteLimiter = new SlidingWindowRateLimiter({
    maxRequests: 10,
    windowMs: 10000,
    name: 'PerMinute'
  });
  
  async function tieredApiCall(id) {
    // Must pass both rate limiters
    await perSecondLimiter.execute(() => Promise.resolve());
    await perMinuteLimiter.execute(() => Promise.resolve());
    
    // Actual operation
    await new Promise(resolve => setTimeout(resolve, 100));
    return { id, status: 'success' };
  }
  
  console.log('   🎯 Making requests with multi-tier rate limiting...\n');
  
  for (let i = 1; i <= 15; i++) {
    try {
      await tieredApiCall(i);
      console.log(`   ✅ Request ${i} passed both limiters`);
    } catch (error) {
      console.log(`   ⛔ Request ${i} blocked: ${error.message}`);
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  
  console.log('\n   📊 Per-Second Limiter Stats:');
  const stats1 = perSecondLimiter.getStats();
  Object.entries(stats1).forEach(([key, value]) => {
    console.log(`   - ${key}: ${value}`);
  });
  
  console.log('\n   📊 Per-Minute Limiter Stats:');
  const stats2 = perMinuteLimiter.getStats();
  Object.entries(stats2).forEach(([key, value]) => {
    console.log(`   - ${key}: ${value}`);
  });
  
  perSecondLimiter.destroy();
  console.log();
}

// ============================================
// Run All Scenarios
// ============================================

async function runAllScenarios() {
  console.log('Starting rate limiter pattern demonstrations...\n');
  
  await scenario1();
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  await scenario2();
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  await scenario3();
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  await scenario4();
  
  console.log('✨ All scenarios completed!\n');
}

runAllScenarios().catch(console.error);
