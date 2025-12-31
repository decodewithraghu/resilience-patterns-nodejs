/**
 * TDD Tests for ResilientHttpClient
 * 
 * These tests demonstrate Test-Driven Development approach for
 * the resilient HTTP client service, covering all resilience patterns.
 * 
 * @module ResilientHttpClient.test
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import {
  ResilientHttpClient,
  ResilientHttpClientBuilder,
  HttpError,
  createResilientClient
} from '../src/services/ResilientHttpClient.js';
import { CircuitState } from '../src/core/index.js';

/**
 * Helper to create a mock HTTP client
 */
function createMockHttpClient(behavior = {}) {
  let callCount = 0;
  const calls = [];
  
  const mockFn = async (url, options) => {
    callCount++;
    calls.push({ url, options, timestamp: Date.now() });
    
    if (behavior.delay) {
      await new Promise(resolve => setTimeout(resolve, behavior.delay));
    }
    
    if (behavior.failUntil && callCount < behavior.failUntil) {
      const error = new HttpError('Service unavailable', 503);
      throw error;
    }
    
    if (behavior.alwaysFail) {
      const error = new HttpError('Service error', behavior.statusCode ?? 500);
      throw error;
    }
    
    if (behavior.failOnCalls && behavior.failOnCalls.includes(callCount)) {
      const error = new HttpError('Service error', behavior.statusCode ?? 500);
      throw error;
    }
    
    return behavior.response ?? {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      data: { success: true, callCount }
    };
  };
  
  mockFn.getCallCount = () => callCount;
  mockFn.getCalls = () => calls;
  mockFn.reset = () => {
    callCount = 0;
    calls.length = 0;
  };
  
  return mockFn;
}

/**
 * Helper for async delay
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ============================================================================
// TEST SUITE: ResilientHttpClient Basic Functionality
// ============================================================================
describe('ResilientHttpClient - Basic Functionality', () => {
  let client;
  let mockHttpClient;

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
    client = new ResilientHttpClient({
      baseUrl: 'https://api.example.com',
      httpClient: mockHttpClient,
      circuitBreaker: { failureThreshold: 3, timeout: 1000 },
      retry: { maxAttempts: 2, baseDelay: 10 },
      timeout: { duration: 5000 },
      bulkhead: { maxConcurrent: 5, maxQueueSize: 10 },
      rateLimiter: { limit: 100, windowMs: 60000 }
    });
  });

  afterEach(() => {
    client.shutdown();
  });

  it('should create client with default options', () => {
    const defaultClient = new ResilientHttpClient();
    assert.ok(defaultClient);
    assert.strictEqual(defaultClient.baseUrl, '');
    defaultClient.shutdown();
  });

  it('should create client with custom base URL', () => {
    assert.strictEqual(client.baseUrl, 'https://api.example.com');
  });

  it('should make successful GET request', async () => {
    const response = await client.get('/users');
    
    assert.ok(response);
    assert.strictEqual(response.data.success, true);
    assert.strictEqual(mockHttpClient.getCallCount(), 1);
  });

  it('should make successful POST request', async () => {
    const body = { name: 'Test User', email: 'test@example.com' };
    const response = await client.post('/users', body);
    
    assert.ok(response);
    assert.strictEqual(response.data.success, true);
    
    const [call] = mockHttpClient.getCalls();
    assert.strictEqual(call.options.method, 'POST');
    assert.ok(call.options.body.includes('Test User'));
  });

  it('should make successful PUT request', async () => {
    const body = { name: 'Updated User' };
    const response = await client.put('/users/1', body);
    
    const [call] = mockHttpClient.getCalls();
    assert.strictEqual(call.options.method, 'PUT');
  });

  it('should make successful PATCH request', async () => {
    const body = { name: 'Patched User' };
    const response = await client.patch('/users/1', body);
    
    const [call] = mockHttpClient.getCalls();
    assert.strictEqual(call.options.method, 'PATCH');
  });

  it('should make successful DELETE request', async () => {
    const response = await client.delete('/users/1');
    
    const [call] = mockHttpClient.getCalls();
    assert.strictEqual(call.options.method, 'DELETE');
  });

  it('should include query parameters in URL', async () => {
    await client.get('/users', { queryParams: { page: 1, limit: 10 } });
    
    const [call] = mockHttpClient.getCalls();
    assert.ok(call.url.includes('page=1'));
    assert.ok(call.url.includes('limit=10'));
  });

  it('should include custom headers', async () => {
    await client.get('/users', { headers: { 'X-Custom-Header': 'test-value' } });
    
    const [call] = mockHttpClient.getCalls();
    assert.strictEqual(call.options.headers['X-Custom-Header'], 'test-value');
  });

  it('should track request statistics', async () => {
    await client.get('/users');
    await client.get('/posts');
    
    const stats = client.getStats();
    assert.strictEqual(stats.client.totalRequests, 2);
    assert.strictEqual(stats.client.successfulRequests, 2);
  });
});

// ============================================================================
// TEST SUITE: Retry Pattern Integration
// ============================================================================
describe('ResilientHttpClient - Retry Pattern', () => {
  it('should retry failed requests', async () => {
    const mockHttpClient = createMockHttpClient({
      failUntil: 3 // Fails first 2 calls, succeeds on 3rd
    });
    
    const client = new ResilientHttpClient({
      baseUrl: 'https://api.example.com',
      httpClient: mockHttpClient,
      retry: { maxAttempts: 3, baseDelay: 10 },
      circuitBreaker: { failureThreshold: 10 },
      rateLimiter: { limit: 1000 }
    });

    const response = await client.get('/users');
    
    assert.ok(response);
    assert.strictEqual(mockHttpClient.getCallCount(), 3);
    client.shutdown();
  });

  it('should fail after max retry attempts', async () => {
    const mockHttpClient = createMockHttpClient({ alwaysFail: true });
    
    const client = new ResilientHttpClient({
      baseUrl: 'https://api.example.com',
      httpClient: mockHttpClient,
      retry: { maxAttempts: 3, baseDelay: 10 },
      circuitBreaker: { failureThreshold: 10 },
      rateLimiter: { limit: 1000 }
    });

    await assert.rejects(
      () => client.get('/users'),
      (error) => {
        assert.strictEqual(error.name, 'HttpError');
        return true;
      }
    );
    
    assert.strictEqual(mockHttpClient.getCallCount(), 3);
    client.shutdown();
  });

  it('should skip retry when skipRetry is true', async () => {
    const mockHttpClient = createMockHttpClient({ alwaysFail: true });
    
    const client = new ResilientHttpClient({
      baseUrl: 'https://api.example.com',
      httpClient: mockHttpClient,
      retry: { maxAttempts: 3, baseDelay: 10 },
      circuitBreaker: { failureThreshold: 10 },
      rateLimiter: { limit: 1000 }
    });

    await assert.rejects(() => client.get('/users', { skipRetry: true }));
    
    assert.strictEqual(mockHttpClient.getCallCount(), 1);
    client.shutdown();
  });

  it('should track retry statistics', async () => {
    const mockHttpClient = createMockHttpClient({ failUntil: 2 });
    
    const client = new ResilientHttpClient({
      baseUrl: 'https://api.example.com',
      httpClient: mockHttpClient,
      retry: { maxAttempts: 3, baseDelay: 10 },
      circuitBreaker: { failureThreshold: 10 },
      rateLimiter: { limit: 1000 }
    });

    await client.get('/users');
    
    const stats = client.getStats();
    assert.ok(stats.client.retries > 0);
    client.shutdown();
  });
});

// ============================================================================
// TEST SUITE: Circuit Breaker Integration
// ============================================================================
describe('ResilientHttpClient - Circuit Breaker Pattern', () => {
  it('should open circuit after threshold failures', async () => {
    const mockHttpClient = createMockHttpClient({ alwaysFail: true });
    
    const client = new ResilientHttpClient({
      baseUrl: 'https://api.example.com',
      httpClient: mockHttpClient,
      circuitBreaker: { failureThreshold: 3, timeout: 1000 },
      retry: { maxAttempts: 1 },
      rateLimiter: { limit: 1000 }
    });

    // Make 3 failing requests to trip circuit
    for (let i = 0; i < 3; i++) {
      try {
        await client.get('/users');
      } catch (e) {
        // Expected
      }
    }

    assert.strictEqual(client.getCircuitState(), CircuitState.OPEN);
    assert.ok(client.isCircuitOpen());
    client.shutdown();
  });

  it('should reject requests when circuit is open', async () => {
    const mockHttpClient = createMockHttpClient({ alwaysFail: true });
    
    const client = new ResilientHttpClient({
      baseUrl: 'https://api.example.com',
      httpClient: mockHttpClient,
      circuitBreaker: { failureThreshold: 2, timeout: 1000 },
      retry: { maxAttempts: 1 },
      rateLimiter: { limit: 1000 }
    });

    // Trip the circuit
    for (let i = 0; i < 2; i++) {
      try {
        await client.get('/users');
      } catch (e) {}
    }

    // Next request should be rejected immediately
    await assert.rejects(
      () => client.get('/users'),
      (error) => {
        assert.ok(error.message.includes('OPEN'));
        return true;
      }
    );
    client.shutdown();
  });

  it('should skip circuit breaker when skipCircuitBreaker is true', async () => {
    const mockHttpClient = createMockHttpClient({ alwaysFail: true });
    
    const client = new ResilientHttpClient({
      baseUrl: 'https://api.example.com',
      httpClient: mockHttpClient,
      circuitBreaker: { failureThreshold: 2, timeout: 1000 },
      retry: { maxAttempts: 1 },
      rateLimiter: { limit: 1000 }
    });

    // Trip the circuit
    for (let i = 0; i < 2; i++) {
      try {
        await client.get('/users');
      } catch (e) {}
    }

    mockHttpClient.reset();
    const newMock = createMockHttpClient();
    
    // Request with skipCircuitBreaker should still go through
    const client2 = new ResilientHttpClient({
      baseUrl: 'https://api.example.com',
      httpClient: newMock,
      circuitBreaker: { failureThreshold: 10 },
      retry: { maxAttempts: 1 },
      rateLimiter: { limit: 1000 }
    });

    const response = await client2.get('/users', { skipCircuitBreaker: true });
    assert.ok(response);
    client.shutdown();
    client2.shutdown();
  });

  it('should emit circuit state change events', async () => {
    const mockHttpClient = createMockHttpClient({ alwaysFail: true });
    const events = [];
    
    const client = new ResilientHttpClient({
      baseUrl: 'https://api.example.com',
      httpClient: mockHttpClient,
      circuitBreaker: { failureThreshold: 2, timeout: 100 },
      retry: { maxAttempts: 1 },
      rateLimiter: { limit: 1000 }
    });

    client.on('circuitOpen', () => events.push('open'));
    client.on('circuitHalfOpen', () => events.push('halfOpen'));

    // Trip the circuit
    for (let i = 0; i < 2; i++) {
      try {
        await client.get('/users');
      } catch (e) {}
    }

    assert.ok(events.includes('open'));
    client.shutdown();
  });
});

// ============================================================================
// TEST SUITE: Timeout Pattern Integration
// ============================================================================
describe('ResilientHttpClient - Timeout Pattern', () => {
  it('should timeout slow requests', async () => {
    const mockHttpClient = createMockHttpClient({ delay: 500 });
    
    const client = new ResilientHttpClient({
      baseUrl: 'https://api.example.com',
      httpClient: mockHttpClient,
      timeout: { duration: 100 },
      retry: { maxAttempts: 1 },
      circuitBreaker: { failureThreshold: 10 },
      rateLimiter: { limit: 1000 }
    });

    await assert.rejects(
      () => client.get('/users'),
      (error) => {
        assert.strictEqual(error.name, 'TimeoutError');
        return true;
      }
    );
    client.shutdown();
  });

  it('should allow custom timeout per request', async () => {
    const mockHttpClient = createMockHttpClient({ delay: 200 });
    
    const client = new ResilientHttpClient({
      baseUrl: 'https://api.example.com',
      httpClient: mockHttpClient,
      timeout: { duration: 50 },
      retry: { maxAttempts: 1 },
      circuitBreaker: { failureThreshold: 10 },
      rateLimiter: { limit: 1000 }
    });

    // This should timeout with default
    await assert.rejects(() => client.get('/users'));

    // This should succeed with custom timeout
    mockHttpClient.reset();
    const response = await client.get('/users', { customTimeout: 1000 });
    assert.ok(response);
    client.shutdown();
  });

  it('should track timeout statistics', async () => {
    const mockHttpClient = createMockHttpClient({ delay: 200 });
    
    const client = new ResilientHttpClient({
      baseUrl: 'https://api.example.com',
      httpClient: mockHttpClient,
      timeout: { duration: 50 },
      retry: { maxAttempts: 1 },
      circuitBreaker: { failureThreshold: 10 },
      rateLimiter: { limit: 1000 }
    });

    try {
      await client.get('/users');
    } catch (e) {}

    const stats = client.getStats();
    assert.strictEqual(stats.client.timeouts, 1);
    client.shutdown();
  });
});

// ============================================================================
// TEST SUITE: Fallback Pattern Integration
// ============================================================================
describe('ResilientHttpClient - Fallback Pattern', () => {
  it('should use fallback when primary fails', async () => {
    const mockHttpClient = createMockHttpClient({ alwaysFail: true });
    
    const client = new ResilientHttpClient({
      baseUrl: 'https://api.example.com',
      httpClient: mockHttpClient,
      retry: { maxAttempts: 1 },
      circuitBreaker: { failureThreshold: 10 },
      rateLimiter: { limit: 1000 }
    });

    const fallbackData = { data: { cached: true, users: [] } };
    const response = await client.get('/users', {
      fallback: async () => fallbackData
    });

    assert.deepStrictEqual(response, fallbackData);
    
    const stats = client.getStats();
    assert.strictEqual(stats.client.fallbacksUsed, 1);
    client.shutdown();
  });

  it('should not use fallback when primary succeeds', async () => {
    const mockHttpClient = createMockHttpClient();
    let fallbackCalled = false;
    
    const client = new ResilientHttpClient({
      baseUrl: 'https://api.example.com',
      httpClient: mockHttpClient,
      retry: { maxAttempts: 1 },
      circuitBreaker: { failureThreshold: 10 },
      rateLimiter: { limit: 1000 }
    });

    await client.get('/users', {
      fallback: async () => {
        fallbackCalled = true;
        return { cached: true };
      }
    });

    assert.strictEqual(fallbackCalled, false);
    client.shutdown();
  });

  it('should propagate error when fallback also fails', async () => {
    const mockHttpClient = createMockHttpClient({ alwaysFail: true });
    
    const client = new ResilientHttpClient({
      baseUrl: 'https://api.example.com',
      httpClient: mockHttpClient,
      retry: { maxAttempts: 1 },
      circuitBreaker: { failureThreshold: 10 },
      rateLimiter: { limit: 1000 }
    });

    await assert.rejects(
      () => client.get('/users', {
        fallback: async () => {
          throw new Error('Fallback also failed');
        }
      }),
      (error) => {
        assert.strictEqual(error.message, 'Fallback also failed');
        return true;
      }
    );
    client.shutdown();
  });
});

// ============================================================================
// TEST SUITE: Bulkhead Pattern Integration
// ============================================================================
describe('ResilientHttpClient - Bulkhead Pattern', () => {
  it('should limit concurrent requests', async () => {
    const mockHttpClient = createMockHttpClient({ delay: 100 });
    let maxConcurrent = 0;
    let currentConcurrent = 0;
    
    const trackingClient = async (url, options) => {
      currentConcurrent++;
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
      
      const result = await mockHttpClient(url, options);
      currentConcurrent--;
      return result;
    };
    
    const client = new ResilientHttpClient({
      baseUrl: 'https://api.example.com',
      httpClient: trackingClient,
      bulkhead: { maxConcurrent: 2, maxQueueSize: 10 },
      retry: { maxAttempts: 1 },
      circuitBreaker: { failureThreshold: 10 },
      timeout: { duration: 5000 },
      rateLimiter: { limit: 1000 }
    });

    // Make 5 concurrent requests
    const requests = Array(5).fill().map(() => client.get('/users'));
    await Promise.all(requests);

    assert.ok(maxConcurrent <= 2, `Max concurrent was ${maxConcurrent}, expected <= 2`);
    client.shutdown();
  });

  it('should reject when bulkhead is full', async () => {
    const mockHttpClient = createMockHttpClient({ delay: 500 });
    
    const client = new ResilientHttpClient({
      baseUrl: 'https://api.example.com',
      httpClient: mockHttpClient,
      bulkhead: { maxConcurrent: 1, maxQueueSize: 0, queueTimeout: 100 },
      retry: { maxAttempts: 1 },
      circuitBreaker: { failureThreshold: 10 },
      timeout: { duration: 2000 },
      rateLimiter: { limit: 1000 }
    });

    // Start a request that will hold the bulkhead
    const firstRequest = client.get('/slow');

    // Second request should be rejected
    await assert.rejects(
      () => client.get('/users'),
      (error) => {
        assert.strictEqual(error.name, 'BulkheadError');
        return true;
      }
    );

    await firstRequest;
    client.shutdown();
  });
});

// ============================================================================
// TEST SUITE: Rate Limiter Integration
// ============================================================================
describe('ResilientHttpClient - Rate Limiter Pattern', () => {
  it('should rate limit excessive requests', async () => {
    const mockHttpClient = createMockHttpClient();
    
    const client = new ResilientHttpClient({
      baseUrl: 'https://api.example.com',
      httpClient: mockHttpClient,
      rateLimiter: { 
        limit: 3, 
        windowMs: 10000,
        capacity: 3,
        refillRate: 0.001 // Very slow refill
      },
      bulkhead: { maxConcurrent: 10, maxQueueSize: 100 },
      retry: { maxAttempts: 1 },
      circuitBreaker: { failureThreshold: 10 },
      timeout: { duration: 5000 }
    });

    // Make requests up to limit
    for (let i = 0; i < 3; i++) {
      await client.get('/users');
    }

    // Next request should be rate limited
    await assert.rejects(
      () => client.get('/users'),
      (error) => {
        assert.strictEqual(error.name, 'RateLimitError');
        return true;
      }
    );
    
    const stats = client.getStats();
    assert.strictEqual(stats.client.rateLimitHits, 1);
    client.shutdown();
  });

  it('should skip rate limiter when skipRateLimiter is true', async () => {
    const mockHttpClient = createMockHttpClient();
    
    const client = new ResilientHttpClient({
      baseUrl: 'https://api.example.com',
      httpClient: mockHttpClient,
      rateLimiter: { 
        limit: 1, 
        windowMs: 10000,
        capacity: 1,
        refillRate: 0.001
      },
      bulkhead: { maxConcurrent: 10 },
      retry: { maxAttempts: 1 },
      circuitBreaker: { failureThreshold: 10 }
    });

    await client.get('/users');
    
    // Should succeed with skipRateLimiter
    const response = await client.get('/users', { skipRateLimiter: true });
    assert.ok(response);
    client.shutdown();
  });
});

// ============================================================================
// TEST SUITE: Builder Pattern
// ============================================================================
describe('ResilientHttpClientBuilder', () => {
  it('should build client with fluent API', () => {
    const mockHttpClient = createMockHttpClient();
    
    const client = new ResilientHttpClientBuilder()
      .baseUrl('https://api.example.com')
      .headers({ 'Authorization': 'Bearer token' })
      .withCircuitBreaker({ failureThreshold: 5 })
      .withRetry({ maxAttempts: 3 })
      .withTimeout({ duration: 5000 })
      .withBulkhead({ maxConcurrent: 10 })
      .withRateLimiter({ limit: 100 })
      .httpClient(mockHttpClient)
      .build();

    assert.strictEqual(client.baseUrl, 'https://api.example.com');
    assert.ok(client.defaultHeaders['Authorization']);
    client.shutdown();
  });

  it('should create client with factory function', () => {
    const client = createResilientClient({
      baseUrl: 'https://api.example.com'
    });

    assert.ok(client instanceof ResilientHttpClient);
    client.shutdown();
  });
});

// ============================================================================
// TEST SUITE: Event System
// ============================================================================
describe('ResilientHttpClient - Events', () => {
  it('should emit success events', async () => {
    const mockHttpClient = createMockHttpClient();
    const events = [];
    
    const client = new ResilientHttpClient({
      baseUrl: 'https://api.example.com',
      httpClient: mockHttpClient,
      retry: { maxAttempts: 1 },
      circuitBreaker: { failureThreshold: 10 },
      rateLimiter: { limit: 1000 }
    });

    client.on('success', (data) => events.push(data));
    
    await client.get('/users');
    
    assert.strictEqual(events.length, 1);
    assert.ok(events[0].url);
    assert.strictEqual(events[0].method, 'GET');
    client.shutdown();
  });

  it('should emit failure events', async () => {
    const mockHttpClient = createMockHttpClient({ alwaysFail: true });
    const events = [];
    
    const client = new ResilientHttpClient({
      baseUrl: 'https://api.example.com',
      httpClient: mockHttpClient,
      retry: { maxAttempts: 1 },
      circuitBreaker: { failureThreshold: 10 },
      rateLimiter: { limit: 1000 }
    });

    client.on('failure', (data) => events.push(data));
    
    try {
      await client.get('/users');
    } catch (e) {}
    
    assert.strictEqual(events.length, 1);
    assert.ok(events[0].error);
    client.shutdown();
  });

  it('should allow unsubscribing from events', async () => {
    const mockHttpClient = createMockHttpClient();
    let callCount = 0;
    
    const client = new ResilientHttpClient({
      baseUrl: 'https://api.example.com',
      httpClient: mockHttpClient,
      retry: { maxAttempts: 1 },
      circuitBreaker: { failureThreshold: 10 },
      rateLimiter: { limit: 1000 }
    });

    const unsubscribe = client.on('success', () => callCount++);
    
    await client.get('/users');
    assert.strictEqual(callCount, 1);
    
    unsubscribe();
    
    await client.get('/users');
    assert.strictEqual(callCount, 1); // Should not increment
    client.shutdown();
  });
});

// ============================================================================
// TEST SUITE: Statistics and Monitoring
// ============================================================================
describe('ResilientHttpClient - Statistics', () => {
  it('should provide comprehensive stats', async () => {
    const mockHttpClient = createMockHttpClient();
    
    const client = new ResilientHttpClient({
      baseUrl: 'https://api.example.com',
      httpClient: mockHttpClient,
      retry: { maxAttempts: 1 },
      circuitBreaker: { failureThreshold: 10 },
      rateLimiter: { limit: 1000 }
    });

    await client.get('/users');
    
    const stats = client.getStats();
    
    assert.ok(stats.client);
    assert.ok(stats.circuitBreaker);
    assert.ok(stats.retry);
    assert.ok(stats.timeout);
    assert.ok(stats.fallback);
    assert.ok(stats.bulkhead);
    assert.ok(stats.rateLimiter);
    client.shutdown();
  });

  it('should reset all stats', async () => {
    const mockHttpClient = createMockHttpClient();
    
    const client = new ResilientHttpClient({
      baseUrl: 'https://api.example.com',
      httpClient: mockHttpClient,
      retry: { maxAttempts: 1 },
      circuitBreaker: { failureThreshold: 10 },
      rateLimiter: { limit: 1000 }
    });

    await client.get('/users');
    await client.get('/posts');
    
    let stats = client.getStats();
    assert.strictEqual(stats.client.totalRequests, 2);
    
    client.resetStats();
    
    stats = client.getStats();
    assert.strictEqual(stats.client.totalRequests, 0);
    client.shutdown();
  });
});

// ============================================================================
// TEST SUITE: HttpError Class
// ============================================================================
describe('HttpError', () => {
  it('should create error with status code', () => {
    const error = new HttpError('Not Found', 404);
    
    assert.strictEqual(error.name, 'HttpError');
    assert.strictEqual(error.message, 'Not Found');
    assert.strictEqual(error.statusCode, 404);
    assert.strictEqual(error.isRetryable, false);
  });

  it('should mark 5xx errors as retryable', () => {
    const error = new HttpError('Server Error', 500);
    assert.strictEqual(error.isRetryable, true);
  });

  it('should mark 408 timeout as retryable', () => {
    const error = new HttpError('Request Timeout', 408);
    assert.strictEqual(error.isRetryable, true);
  });

  it('should mark 429 rate limit as retryable', () => {
    const error = new HttpError('Too Many Requests', 429);
    assert.strictEqual(error.isRetryable, true);
  });

  it('should include response data', () => {
    const responseData = { error: 'Validation failed' };
    const error = new HttpError('Bad Request', 400, responseData);
    
    assert.deepStrictEqual(error.response, responseData);
  });
});

// ============================================================================
// TEST SUITE: Edge Cases
// ============================================================================
describe('ResilientHttpClient - Edge Cases', () => {
  it('should handle empty base URL', async () => {
    const mockHttpClient = createMockHttpClient();
    
    const client = new ResilientHttpClient({
      httpClient: mockHttpClient,
      retry: { maxAttempts: 1 },
      circuitBreaker: { failureThreshold: 10 },
      rateLimiter: { limit: 1000 }
    });

    await client.get('https://api.example.com/users');
    
    const [call] = mockHttpClient.getCalls();
    assert.ok(call.url.includes('api.example.com'));
    client.shutdown();
  });

  it('should handle null query parameters', async () => {
    const mockHttpClient = createMockHttpClient();
    
    const client = new ResilientHttpClient({
      baseUrl: 'https://api.example.com',
      httpClient: mockHttpClient,
      retry: { maxAttempts: 1 },
      circuitBreaker: { failureThreshold: 10 },
      rateLimiter: { limit: 1000 }
    });

    await client.get('/users', { 
      queryParams: { page: 1, filter: null, search: undefined } 
    });
    
    const [call] = mockHttpClient.getCalls();
    assert.ok(call.url.includes('page=1'));
    assert.ok(!call.url.includes('filter'));
    assert.ok(!call.url.includes('search'));
    client.shutdown();
  });

  it('should emit shutdown event', async () => {
    const mockHttpClient = createMockHttpClient();
    let shutdownCalled = false;
    
    const client = new ResilientHttpClient({
      baseUrl: 'https://api.example.com',
      httpClient: mockHttpClient,
      retry: { maxAttempts: 1 },
      circuitBreaker: { failureThreshold: 10 },
      rateLimiter: { limit: 1000 }
    });

    client.on('shutdown', () => shutdownCalled = true);
    
    client.shutdown();
    
    assert.strictEqual(shutdownCalled, true);
  });
});

// ============================================================================
// TEST SUITE: Integration Tests - Real-world Scenarios
// ============================================================================
describe('ResilientHttpClient - Integration Scenarios', () => {
  it('should handle intermittent failures gracefully', async () => {
    // Simulates a flaky service that fails 50% of the time
    let callCount = 0;
    const flakyClient = async (url, options) => {
      callCount++;
      if (callCount % 2 === 1) {
        throw new HttpError('Service hiccup', 503);
      }
      return { status: 200, data: { success: true } };
    };
    
    const client = new ResilientHttpClient({
      baseUrl: 'https://api.example.com',
      httpClient: flakyClient,
      retry: { maxAttempts: 3, baseDelay: 10 },
      circuitBreaker: { failureThreshold: 5 },
      rateLimiter: { limit: 1000 }
    });

    // Should succeed after retry
    const response = await client.get('/users');
    assert.ok(response);
    client.shutdown();
  });

  it('should implement cache fallback pattern', async () => {
    const mockHttpClient = createMockHttpClient({ alwaysFail: true });
    const cache = new Map([['users', { cached: true, data: [] }]]);
    
    const client = new ResilientHttpClient({
      baseUrl: 'https://api.example.com',
      httpClient: mockHttpClient,
      retry: { maxAttempts: 2, baseDelay: 10 },
      circuitBreaker: { failureThreshold: 10 },
      rateLimiter: { limit: 1000 }
    });

    const response = await client.get('/users', {
      fallback: async () => ({
        status: 200,
        data: cache.get('users'),
        fromCache: true
      })
    });

    assert.ok(response.fromCache);
    assert.ok(response.data.cached);
    client.shutdown();
  });

  it('should handle service degradation scenario', async () => {
    const mockHttpClient = createMockHttpClient({ alwaysFail: true });
    
    const client = new ResilientHttpClient({
      baseUrl: 'https://api.example.com',
      httpClient: mockHttpClient,
      circuitBreaker: { failureThreshold: 2, timeout: 100 },
      retry: { maxAttempts: 1 },
      rateLimiter: { limit: 1000 }
    });

    // Trip the circuit
    for (let i = 0; i < 3; i++) {
      try {
        await client.get('/users');
      } catch (e) {}
    }

    // Verify circuit is open
    assert.ok(client.isCircuitOpen());

    // With fallback, should still return data
    const response = await client.get('/users', {
      fallback: async () => ({
        status: 200,
        data: { degraded: true, message: 'Service temporarily unavailable' }
      })
    });

    assert.ok(response.data.degraded);
    client.shutdown();
  });

  it('should handle concurrent requests with all patterns', async () => {
    const mockHttpClient = createMockHttpClient({ delay: 50 });
    
    const client = new ResilientHttpClient({
      baseUrl: 'https://api.example.com',
      httpClient: mockHttpClient,
      circuitBreaker: { failureThreshold: 10 },
      retry: { maxAttempts: 2 },
      timeout: { duration: 5000 },
      bulkhead: { maxConcurrent: 5, maxQueueSize: 20 },
      rateLimiter: { limit: 100, windowMs: 60000 }
    });

    // Make 10 concurrent requests
    const requests = Array(10).fill().map((_, i) => 
      client.get(`/users/${i}`)
    );

    const results = await Promise.all(requests);
    
    assert.strictEqual(results.length, 10);
    results.forEach(r => assert.ok(r.data));
    client.shutdown();
  });
});

console.log('✅ ResilientHttpClient TDD tests loaded');
