// ============================================
// BULKHEAD PATTERN - Detailed Example
// ============================================

console.log('🚧 Bulkhead Pattern Demo\n');
console.log('This pattern isolates critical resources to prevent failures');
console.log('in one part of the system from cascading to others.\n');

// ============================================
// Bulkhead Implementation
// ============================================

class Bulkhead {
  constructor(options = {}) {
    this.maxConcurrent = options.maxConcurrent || 10;
    this.maxQueueSize = options.maxQueueSize || 100;
    this.timeout = options.timeout || 30000;
    this.name = options.name || 'Bulkhead';
    
    this.activeCount = 0;
    this.queue = [];
    this.stats = {
      executed: 0,
      rejected: 0,
      queued: 0,
      timedOut: 0,
      succeeded: 0,
      failed: 0
    };
  }

  async execute(fn, context = '') {
    // Check if we can execute immediately
    if (this.activeCount < this.maxConcurrent) {
      return await this._executeImmediate(fn, context);
    }
    
    // Check if queue is full
    if (this.queue.length >= this.maxQueueSize) {
      this.stats.rejected++;
      throw new Error(`[${this.name}] Bulkhead queue is full. Request rejected.`);
    }
    
    // Add to queue
    console.log(`   ⏸️  [${this.name}] Request queued (${this.queue.length + 1}/${this.maxQueueSize})`);
    this.stats.queued++;
    
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        // Remove from queue if timeout
        const index = this.queue.findIndex(item => item.timeoutId === timeoutId);
        if (index !== -1) {
          this.queue.splice(index, 1);
          this.stats.timedOut++;
          reject(new Error(`[${this.name}] Request timed out in queue after ${this.timeout}ms`));
        }
      }, this.timeout);
      
      this.queue.push({
        fn,
        context,
        resolve,
        reject,
        timeoutId
      });
    });
  }

  async _executeImmediate(fn, context) {
    this.activeCount++;
    this.stats.executed++;
    
    console.log(`   ▶️  [${this.name}] Executing (${this.activeCount}/${this.maxConcurrent} active)${context ? ': ' + context : ''}`);
    
    try {
      const result = await fn();
      this.stats.succeeded++;
      console.log(`   ✅ [${this.name}] Success (${this.activeCount}/${this.maxConcurrent} active)`);
      return result;
    } catch (error) {
      this.stats.failed++;
      console.log(`   ❌ [${this.name}] Failed: ${error.message}`);
      throw error;
    } finally {
      this.activeCount--;
      this._processQueue();
    }
  }

  _processQueue() {
    if (this.queue.length > 0 && this.activeCount < this.maxConcurrent) {
      const item = this.queue.shift();
      clearTimeout(item.timeoutId);
      
      console.log(`   ⏯️  [${this.name}] Processing queued request (${this.queue.length} remaining)`);
      
      this._executeImmediate(item.fn, item.context)
        .then(item.resolve)
        .catch(item.reject);
    }
  }

  getStats() {
    return {
      ...this.stats,
      activeCount: this.activeCount,
      queueSize: this.queue.length,
      maxConcurrent: this.maxConcurrent,
      maxQueueSize: this.maxQueueSize
    };
  }
}

// ============================================
// Resource Pool Implementation
// ============================================

class ResourcePool {
  constructor(options = {}) {
    this.name = options.name || 'ResourcePool';
    this.resources = [];
    this.available = [];
    this.inUse = new Set();
    this.maxSize = options.maxSize || 10;
    this.createResource = options.createResource;
    this.validateResource = options.validateResource || (() => true);
    this.destroyResource = options.destroyResource || (() => {});
  }

  async acquire() {
    // Try to get an available resource
    if (this.available.length > 0) {
      const resource = this.available.pop();
      
      // Validate before using
      if (await this.validateResource(resource)) {
        this.inUse.add(resource);
        console.log(`   🔓 [${this.name}] Resource acquired (${this.inUse.size}/${this.maxSize} in use)`);
        return resource;
      } else {
        console.log(`   ♻️  [${this.name}] Invalid resource, creating new one`);
        await this.destroyResource(resource);
      }
    }
    
    // Create new resource if pool not at capacity
    if (this.resources.length < this.maxSize) {
      const resource = await this.createResource();
      this.resources.push(resource);
      this.inUse.add(resource);
      console.log(`   🆕 [${this.name}] New resource created (${this.inUse.size}/${this.maxSize} in use)`);
      return resource;
    }
    
    throw new Error(`[${this.name}] No resources available and pool at capacity`);
  }

  async release(resource) {
    if (this.inUse.has(resource)) {
      this.inUse.delete(resource);
      this.available.push(resource);
      console.log(`   🔒 [${this.name}] Resource released (${this.inUse.size}/${this.maxSize} in use)`);
    }
  }

  getStats() {
    return {
      total: this.resources.length,
      available: this.available.length,
      inUse: this.inUse.size,
      maxSize: this.maxSize
    };
  }
}

// ============================================
// Test Scenarios
// ============================================

// Scenario 1: Database connection pool with bulkhead
async function scenario1() {
  console.log('📌 Scenario 1: Database connection pool with bulkhead');
  console.log('═══════════════════════════════════════════════════════\n');
  
  const dbBulkhead = new Bulkhead({
    maxConcurrent: 3,
    maxQueueSize: 5,
    timeout: 5000,
    name: 'DB-Pool'
  });
  
  async function databaseQuery(queryId) {
    // Simulate database query taking random time
    const duration = 1000 + Math.random() * 2000;
    await new Promise(resolve => setTimeout(resolve, duration));
    return { queryId, duration: Math.round(duration), result: 'success' };
  }
  
  // Fire 10 concurrent requests
  const requests = [];
  for (let i = 1; i <= 10; i++) {
    requests.push(
      dbBulkhead.execute(
        () => databaseQuery(i),
        `Query-${i}`
      ).catch(error => ({ error: error.message, queryId: i }))
    );
  }
  
  const results = await Promise.all(requests);
  
  console.log('\n   📊 Results:');
  results.forEach((result, index) => {
    if (result.error) {
      console.log(`   ❌ Query ${index + 1}: ${result.error}`);
    } else {
      console.log(`   ✅ Query ${index + 1}: Completed in ${result.duration}ms`);
    }
  });
  
  console.log('\n   📈 Bulkhead Stats:');
  const stats = dbBulkhead.getStats();
  Object.entries(stats).forEach(([key, value]) => {
    console.log(`   - ${key}: ${value}`);
  });
  console.log();
}

// Scenario 2: Separate bulkheads for critical vs non-critical operations
async function scenario2() {
  console.log('📌 Scenario 2: Isolated bulkheads for different priorities');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  const criticalBulkhead = new Bulkhead({
    maxConcurrent: 5,
    maxQueueSize: 10,
    name: 'Critical-Operations'
  });
  
  const nonCriticalBulkhead = new Bulkhead({
    maxConcurrent: 2,
    maxQueueSize: 5,
    name: 'NonCritical-Operations'
  });
  
  async function criticalOperation(id) {
    await new Promise(resolve => setTimeout(resolve, 500));
    return { id, type: 'critical', status: 'completed' };
  }
  
  async function nonCriticalOperation(id) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    return { id, type: 'non-critical', status: 'completed' };
  }
  
  // Fire mixed requests
  const requests = [];
  
  // 5 critical operations
  for (let i = 1; i <= 5; i++) {
    requests.push(
      criticalBulkhead.execute(
        () => criticalOperation(i),
        `Critical-${i}`
      )
    );
  }
  
  // 5 non-critical operations
  for (let i = 1; i <= 5; i++) {
    requests.push(
      nonCriticalBulkhead.execute(
        () => nonCriticalOperation(i),
        `NonCritical-${i}`
      ).catch(error => ({ error: error.message }))
    );
  }
  
  await Promise.all(requests);
  
  console.log('\n   📊 Critical Bulkhead Stats:');
  const critStats = criticalBulkhead.getStats();
  Object.entries(critStats).forEach(([key, value]) => {
    console.log(`   - ${key}: ${value}`);
  });
  
  console.log('\n   📊 Non-Critical Bulkhead Stats:');
  const nonCritStats = nonCriticalBulkhead.getStats();
  Object.entries(nonCritStats).forEach(([key, value]) => {
    console.log(`   - ${key}: ${value}`);
  });
  console.log();
}

// Scenario 3: Connection pool with bulkhead
async function scenario3() {
  console.log('📌 Scenario 3: Connection pool with resource management');
  console.log('════════════════════════════════════════════════════════\n');
  
  let connectionIdCounter = 0;
  
  const connectionPool = new ResourcePool({
    name: 'DB-Connections',
    maxSize: 3,
    createResource: async () => {
      const id = ++connectionIdCounter;
      console.log(`      🔧 Creating connection ${id}...`);
      await new Promise(resolve => setTimeout(resolve, 200));
      return { id, created: Date.now() };
    },
    validateResource: async (conn) => {
      // Simulate validation
      return Date.now() - conn.created < 60000;
    },
    destroyResource: async (conn) => {
      console.log(`      🗑️  Destroying connection ${conn.id}`);
    }
  });
  
  async function performQuery(queryId) {
    const connection = await connectionPool.acquire();
    try {
      console.log(`      📡 Executing query ${queryId} on connection ${connection.id}`);
      await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 500));
      return { queryId, connectionId: connection.id, success: true };
    } finally {
      await connectionPool.release(connection);
    }
  }
  
  // Execute 8 queries with only 3 connections
  const queries = [];
  for (let i = 1; i <= 8; i++) {
    queries.push(performQuery(i));
    await new Promise(resolve => setTimeout(resolve, 100)); // Stagger requests
  }
  
  await Promise.all(queries);
  
  console.log('\n   📊 Connection Pool Stats:');
  const stats = connectionPool.getStats();
  Object.entries(stats).forEach(([key, value]) => {
    console.log(`   - ${key}: ${value}`);
  });
  console.log();
}

// Scenario 4: Overload protection
async function scenario4() {
  console.log('📌 Scenario 4: Overload protection with rejection');
  console.log('═══════════════════════════════════════════════════\n');
  
  const bulkhead = new Bulkhead({
    maxConcurrent: 2,
    maxQueueSize: 3,
    timeout: 2000,
    name: 'Overload-Protection'
  });
  
  async function slowOperation(id) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    return { id, status: 'completed' };
  }
  
  // Fire 10 requests quickly - some should be rejected
  const requests = [];
  for (let i = 1; i <= 10; i++) {
    const request = bulkhead.execute(
      () => slowOperation(i),
      `Op-${i}`
    ).then(result => {
      console.log(`   ✅ Operation ${result.id} completed`);
      return result;
    }).catch(error => {
      console.log(`   ⛔ Operation ${i} rejected/failed: ${error.message}`);
      return { id: i, error: error.message };
    });
    
    requests.push(request);
    await new Promise(resolve => setTimeout(resolve, 50)); // Small delay between requests
  }
  
  await Promise.all(requests);
  
  console.log('\n   📊 Final Stats:');
  const stats = bulkhead.getStats();
  Object.entries(stats).forEach(([key, value]) => {
    console.log(`   - ${key}: ${value}`);
  });
  console.log();
}

// ============================================
// Run All Scenarios
// ============================================

async function runAllScenarios() {
  console.log('Starting bulkhead pattern demonstrations...\n');
  
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
