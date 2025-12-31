# Resilience Patterns Guide

This document explains each resilience pattern, when to use it, and real-world examples.

## Overview

| Pattern | Purpose | Use When |
|---------|---------|----------|
| **Circuit Breaker** | Stop cascading failures | External service calls |
| **Retry** | Handle transient failures | Network issues, timeouts |
| **Timeout** | Prevent indefinite waits | Any external call |
| **Fallback** | Graceful degradation | Need backup data source |
| **Bulkhead** | Isolate resources | Protect shared resources |
| **Rate Limiter** | Control throughput | API rate limits, abuse prevention |

---

## Circuit Breaker Pattern

### Problem
When a downstream service fails, continuing to send requests:
- Wastes resources
- Increases latency
- Can cause cascading failures

### Solution
The circuit breaker monitors failures and "trips" when threshold is exceeded, immediately rejecting requests instead of waiting for failures.

### States
```
CLOSED → (failures exceed threshold) → OPEN
                                         ↓
                                    (timeout expires)
                                         ↓
                                    HALF_OPEN
                                    ↙       ↘
                            (success)    (failure)
                                ↓            ↓
                            CLOSED        OPEN
```

### When to Use
- External HTTP API calls
- Database connections
- Third-party service integrations
- Microservice communication

### Example: External API Protection

```javascript
import { CircuitBreaker } from 'resilience-based-example';

const paymentBreaker = new CircuitBreaker({
  failureThreshold: 3,    // Open after 3 failures
  successThreshold: 2,    // Close after 2 successes
  timeout: 30000          // Try again after 30s
});

// Monitor state changes
paymentBreaker.on('open', () => {
  alertOps('Payment service circuit opened!');
});

async function processPayment(order) {
  return paymentBreaker.execute(async () => {
    return await paymentApi.charge(order);
  });
}
```

---

## Retry Pattern

### Problem
Transient failures (network blips, temporary overload) cause unnecessary errors when a simple retry would succeed.

### Solution
Automatically retry failed operations with intelligent backoff to avoid overwhelming recovering services.

### Backoff Strategies

| Strategy | Formula | Best For |
|----------|---------|----------|
| Exponential | `delay * 2^attempt` | Most cases |
| Linear | `delay * attempt` | Predictable delays |
| Constant | `delay` | Testing, simple retries |
| Decorrelated Jitter | Random within range | High concurrency |

### When to Use
- Network requests
- Database queries (deadlocks, timeouts)
- Message queue operations
- File I/O operations

### Example: Database Retry

```javascript
import { RetryHandler, BackoffStrategy } from 'resilience-based-example';

const dbRetry = new RetryHandler({
  maxAttempts: 5,
  baseDelay: 100,
  maxDelay: 5000,
  strategy: BackoffStrategy.EXPONENTIAL,
  jitter: true,
  retryCondition: (error) => {
    // Only retry specific errors
    return error.code === 'DEADLOCK' || 
           error.code === 'CONNECTION_RESET';
  }
});

async function saveUser(user) {
  return dbRetry.execute(async () => {
    return await db.users.insert(user);
  });
}
```

---

## Timeout Pattern

### Problem
Operations that hang indefinitely:
- Block threads/connections
- Degrade user experience
- Can cause resource exhaustion

### Solution
Set maximum wait times and fail fast when exceeded.

### When to Use
- **Always** for external calls
- Database queries
- File operations
- Any I/O operation

### Example: API Call with Timeout

```javascript
import { TimeoutHandler, TimeoutError } from 'resilience-based-example';

const apiTimeout = new TimeoutHandler({
  duration: 5000,
  name: 'UserAPI'
});

async function getUser(id) {
  try {
    return await apiTimeout.execute(async () => {
      return await fetch(`/api/users/${id}`).then(r => r.json());
    });
  } catch (error) {
    if (error instanceof TimeoutError) {
      console.log(`Request timed out after ${error.duration}ms`);
      return null;
    }
    throw error;
  }
}
```

---

## Fallback Pattern

### Problem
When primary operations fail, users see errors instead of degraded but functional service.

### Solution
Provide alternative data sources or default values when primary fails.

### Strategies

| Strategy | Description | Example |
|----------|-------------|---------|
| Cache | Return stale data | Cached user profile |
| Default | Return safe defaults | Default config |
| Secondary | Try backup service | Read replica |
| Degraded | Reduced functionality | Basic search |

### When to Use
- Read operations with caching
- Non-critical features
- Configuration loading
- Search/recommendations

### Example: Multi-Level Fallback

```javascript
import { FallbackHandler } from 'resilience-based-example';

const fallback = new FallbackHandler();

async function getProductRecommendations(userId) {
  const { result, strategyUsed } = await fallback.executeWithCascade([
    {
      name: 'ml-service',
      fn: async () => await mlService.getPersonalized(userId)
    },
    {
      name: 'cache',
      fn: async () => await cache.get(`recs:${userId}`)
    },
    {
      name: 'popular',
      fn: async () => await db.getPopularProducts(10)
    },
    {
      name: 'default',
      fn: async () => DEFAULT_PRODUCTS
    }
  ]);

  analytics.track('recommendations', { strategy: strategyUsed });
  return result;
}
```

---

## Bulkhead Pattern

### Problem
One slow/failing operation consumes all resources (threads, connections), affecting unrelated operations.

### Solution
Isolate resources into pools, limiting how many concurrent operations can affect shared resources.

### Types

| Type | Isolation | Example |
|------|-----------|---------|
| Thread Pool | Separate thread pools | Java ExecutorService |
| Semaphore | Limit concurrent access | Connection limits |
| Queue | Limit pending requests | Request queue |

### When to Use
- Database connection pools
- External service calls
- Resource-intensive operations
- Multi-tenant systems

### Example: API Endpoint Protection

```javascript
import { Bulkhead } from 'resilience-based-example';

// Separate bulkheads for different operations
const searchBulkhead = new Bulkhead({
  maxConcurrent: 20,
  maxQueueSize: 100,
  name: 'Search'
});

const checkoutBulkhead = new Bulkhead({
  maxConcurrent: 50,  // Higher priority
  maxQueueSize: 200,
  name: 'Checkout'
});

// Search slowdown won't affect checkout
app.get('/search', async (req, res) => {
  const results = await searchBulkhead.execute(() => 
    searchService.query(req.query.q)
  );
  res.json(results);
});

app.post('/checkout', async (req, res) => {
  const order = await checkoutBulkhead.execute(() => 
    orderService.process(req.body)
  );
  res.json(order);
});
```

---

## Rate Limiter Pattern

### Problem
- Too many requests overwhelm services
- Unfair resource distribution
- DoS vulnerability
- API quota exceeded

### Solution
Control request rate using algorithms suited to different scenarios.

### Algorithms

| Algorithm | Behavior | Best For |
|-----------|----------|----------|
| Token Bucket | Allows bursts, smooth average | API rate limits |
| Sliding Window | Smooth, no edge spikes | User actions |
| Fixed Window | Simple, predictable | Basic limiting |

### When to Use
- Public API endpoints
- User action limits (login, signup)
- Resource-intensive operations
- Third-party API calls

### Example: API Rate Limiting

```javascript
import { 
  RateLimiterFactory,
  RateLimitError 
} from 'resilience-based-example';

// Per-user rate limiting
const userLimiters = new Map();

function getUserLimiter(userId) {
  if (!userLimiters.has(userId)) {
    userLimiters.set(userId, RateLimiterFactory.forApi({
      limit: 100,      // 100 requests
      windowMs: 60000  // per minute
    }));
  }
  return userLimiters.get(userId);
}

app.use(async (req, res, next) => {
  const limiter = getUserLimiter(req.user.id);
  
  if (!limiter.tryAcquire()) {
    res.status(429).json({
      error: 'Too many requests',
      retryAfter: 60
    });
    return;
  }
  
  next();
});
```

---

## Pattern Combinations

### Recommended Stack Order

```
Request → Rate Limiter → Bulkhead → Timeout → Circuit Breaker → Retry → Fallback → Service
```

### Why This Order?

1. **Rate Limiter First**: Reject excess traffic immediately
2. **Bulkhead**: Limit concurrent processing
3. **Timeout**: Fail fast on slow operations
4. **Circuit Breaker**: Stop calling failing services
5. **Retry**: Handle transient failures
6. **Fallback**: Last resort for user experience

### Complete Example

```javascript
class ResilientService {
  constructor() {
    this.rateLimiter = new TokenBucketRateLimiter({ capacity: 100 });
    this.bulkhead = new Bulkhead({ maxConcurrent: 10 });
    this.timeout = new TimeoutHandler({ duration: 5000 });
    this.breaker = new CircuitBreaker({ failureThreshold: 5 });
    this.retry = new RetryHandler({ maxAttempts: 3 });
    this.fallback = new FallbackHandler();
  }

  async call(operation, fallbackValue) {
    // 1. Rate limit
    if (!this.rateLimiter.tryConsume()) {
      return fallbackValue;
    }

    // 2-6. Chain remaining patterns
    return this.fallback.execute(
      () => this.retry.execute(
        () => this.breaker.execute(
          () => this.bulkhead.execute(
            () => this.timeout.execute(operation)
          )
        )
      ),
      () => fallbackValue
    );
  }
}
```

---

## Anti-Patterns to Avoid

### ❌ Retrying Non-Idempotent Operations
```javascript
// BAD: May charge twice!
await retry.execute(() => paymentApi.charge(order));

// GOOD: Make idempotent with idempotency key
await retry.execute(() => paymentApi.charge(order, idempotencyKey));
```

### ❌ Infinite Retries
```javascript
// BAD: Never gives up
new RetryHandler({ maxAttempts: Infinity });

// GOOD: Set reasonable limits
new RetryHandler({ maxAttempts: 5 });
```

### ❌ Timeout Longer Than Circuit Breaker Reset
```javascript
// BAD: Timeout defeats circuit breaker purpose
const timeout = new TimeoutHandler({ duration: 60000 });
const breaker = new CircuitBreaker({ timeout: 5000 });

// GOOD: Timeout < Circuit breaker reset
const timeout = new TimeoutHandler({ duration: 3000 });
const breaker = new CircuitBreaker({ timeout: 30000 });
```

### ❌ No Fallback for Critical Paths
```javascript
// BAD: User sees error
const data = await fetchData(); // throws on failure

// GOOD: Graceful degradation
const data = await fallback.execute(
  () => fetchData(),
  () => getCachedData()
);
```
