# API Reference

Complete API documentation for the Resilience Patterns Library.

## Table of Contents

- [CircuitBreaker](#circuitbreaker)
- [RetryHandler](#retryhandler)
- [TimeoutHandler](#timeouthandler)
- [FallbackHandler](#fallbackhandler)
- [Bulkhead](#bulkhead)
- [RateLimiter](#ratelimiter)

---

## CircuitBreaker

Prevents cascading failures by stopping requests to failing services.

### Import

```javascript
import { CircuitBreaker, CircuitState } from 'resilience-based-example';
```

### Constructor

```javascript
new CircuitBreaker(options?)
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `failureThreshold` | number | 5 | Failures before opening circuit |
| `successThreshold` | number | 2 | Successes in half-open to close |
| `timeout` | number | 30000 | Time (ms) before trying again |

### Methods

#### `execute(fn)`
Execute a function with circuit breaker protection.

```javascript
const result = await breaker.execute(async () => {
  return await fetchData();
});
```

#### `on(event, callback)`
Subscribe to events. Returns unsubscribe function.

```javascript
const unsubscribe = breaker.on('open', ({ failureCount }) => {
  console.log('Circuit opened after', failureCount, 'failures');
});
```

#### `reset()`
Reset circuit to CLOSED state.

#### `getStats()`
Get circuit breaker statistics.

### Events

| Event | Payload | Description |
|-------|---------|-------------|
| `success` | `{ result, duration }` | Successful execution |
| `failure` | `{ error, failureCount }` | Failed execution |
| `open` | `{ failureCount }` | Circuit opened |
| `halfOpen` | `{}` | Circuit half-opened |
| `close` | `{}` | Circuit closed |
| `stateChange` | `{ from, to }` | State transition |

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `state` | CircuitState | Current state |
| `isOpen` | boolean | True if OPEN |
| `isClosed` | boolean | True if CLOSED |
| `isHalfOpen` | boolean | True if HALF_OPEN |

---

## RetryHandler

Automatically retries failed operations with configurable backoff.

### Import

```javascript
import { 
  RetryHandler, 
  RetryHandlerFactory, 
  BackoffStrategy 
} from 'resilience-based-example';
```

### Constructor

```javascript
new RetryHandler(options?)
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxAttempts` | number | 3 | Maximum retry attempts |
| `baseDelay` | number | 1000 | Base delay in ms |
| `maxDelay` | number | 30000 | Maximum delay cap |
| `multiplier` | number | 2 | Exponential multiplier |
| `jitter` | boolean | true | Add randomness to delays |
| `strategy` | BackoffStrategy | EXPONENTIAL | Backoff algorithm |
| `retryCondition` | function | null | Custom retry condition |

### BackoffStrategy Enum

```javascript
BackoffStrategy.EXPONENTIAL      // delay * multiplier^attempt
BackoffStrategy.LINEAR           // delay * attempt
BackoffStrategy.CONSTANT         // fixed delay
BackoffStrategy.DECORRELATED_JITTER // AWS-style jitter
```

### Methods

#### `execute(fn)`
Execute with automatic retries.

```javascript
const result = await retry.execute(async () => {
  return await unreliableCall();
});
```

### Factory Methods

```javascript
// Preset for network calls
const networkRetry = RetryHandlerFactory.forNetwork();

// Preset for database operations
const dbRetry = RetryHandlerFactory.forDatabase();
```

### Events

| Event | Payload | Description |
|-------|---------|-------------|
| `retry` | `{ attempt, delay, error }` | Before retry |
| `success` | `{ result, attempts }` | Successful execution |
| `exhausted` | `{ error, totalAttempts }` | All retries failed |

---

## TimeoutHandler

Prevents operations from hanging indefinitely.

### Import

```javascript
import { TimeoutHandler, TimeoutError } from 'resilience-based-example';
```

### Constructor

```javascript
new TimeoutHandler(options?)
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `duration` | number | 5000 | Timeout in ms |
| `name` | string | 'Operation' | Name for error messages |

### Methods

#### `execute(fn, customDuration?)`
Execute with timeout protection.

```javascript
const result = await timeout.execute(async () => {
  return await slowOperation();
}, 3000); // Optional custom duration
```

#### `static withTimeout(promise, duration)`
Wrap any promise with timeout.

```javascript
const result = await TimeoutHandler.withTimeout(
  fetch('/api/data'),
  5000
);
```

### TimeoutError

```javascript
try {
  await timeout.execute(slowFn);
} catch (error) {
  if (error instanceof TimeoutError) {
    console.log(error.duration); // The timeout duration
    console.log(error.name);     // 'TimeoutError'
  }
}
```

---

## FallbackHandler

Provides graceful degradation when primary operations fail.

### Import

```javascript
import { FallbackHandler } from 'resilience-based-example';
```

### Methods

#### `execute(primaryFn, fallbackFn)`
Execute with single fallback.

```javascript
const result = await fallback.execute(
  async () => await fetchFromApi(),
  async (error) => await getFromCache()
);
```

#### `executeWithCascade(strategies)`
Try multiple strategies in order.

```javascript
const { result, strategyUsed, errors } = await fallback.executeWithCascade([
  { name: 'primary', fn: async () => fetchPrimary() },
  { name: 'replica', fn: async () => fetchReplica() },
  { name: 'cache', fn: async () => getCache() }
]);
```

#### `executeWithCache(fn, cachedValue)`
Use cached value on failure.

```javascript
const result = await fallback.executeWithCache(
  async () => fetchFresh(),
  previouslyCachedData
);
```

#### `executeWithDefault(fn, defaultValue)`
Use default value on failure.

```javascript
const result = await fallback.executeWithDefault(
  async () => fetchConfig(),
  { theme: 'light', lang: 'en' }
);
```

### Events

| Event | Payload | Description |
|-------|---------|-------------|
| `primarySuccess` | `{ result }` | Primary succeeded |
| `primaryFailure` | `{ error }` | Primary failed |
| `fallbackSuccess` | `{ result }` | Fallback succeeded |
| `fallbackFailure` | `{ error }` | Fallback failed |

---

## Bulkhead

Isolates resources to prevent cascade failures through concurrency control.

### Import

```javascript
import { Bulkhead, BulkheadError } from 'resilience-based-example';
```

### Constructor

```javascript
new Bulkhead(options?)
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxConcurrent` | number | 10 | Max concurrent executions |
| `maxQueueSize` | number | 100 | Max queued requests |
| `queueTimeout` | number | 30000 | Queue wait timeout (ms) |
| `name` | string | 'Bulkhead' | Name for errors |

### Methods

#### `execute(fn)`
Execute with bulkhead protection.

```javascript
const result = await bulkhead.execute(async () => {
  return await processRequest();
});
```

#### `drain()`
Reject all queued items and reset.

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `activeCount` | number | Currently executing |
| `queueSize` | number | Currently queued |
| `availableSlots` | number | Free execution slots |

### BulkheadError Codes

| Code | Description |
|------|-------------|
| `BULKHEAD_QUEUE_FULL` | Queue capacity reached |
| `BULKHEAD_QUEUE_TIMEOUT` | Waited too long in queue |
| `BULKHEAD_DRAINED` | Bulkhead was drained |

---

## RateLimiter

Controls request rate using various algorithms.

### Import

```javascript
import {
  TokenBucketRateLimiter,
  SlidingWindowRateLimiter,
  FixedWindowRateLimiter,
  RateLimiterFactory,
  RateLimitAlgorithm,
  RateLimitError
} from 'resilience-based-example';
```

### TokenBucketRateLimiter

Best for bursty traffic with sustained rate limits.

```javascript
const limiter = new TokenBucketRateLimiter({
  capacity: 100,        // Max tokens
  refillRate: 10,       // Tokens per interval
  refillInterval: 1000  // Interval in ms
});

if (limiter.tryConsume()) {
  // Allowed
}

// Or with execute
await limiter.execute(async () => processRequest());

limiter.destroy(); // Cleanup
```

### SlidingWindowRateLimiter

Smooth rate limiting over rolling window.

```javascript
const limiter = new SlidingWindowRateLimiter({
  limit: 100,      // Max requests per window
  windowMs: 60000  // Window size in ms
});

if (limiter.tryAcquire()) {
  // Allowed
}
```

### FixedWindowRateLimiter

Simple time-window based limiting.

```javascript
const limiter = new FixedWindowRateLimiter({
  limit: 100,      // Max requests per window
  windowMs: 60000  // Window size in ms
});
```

### Factory Methods

```javascript
// For API endpoints (100 req/min sliding window)
const apiLimiter = RateLimiterFactory.forApi();

// For user actions (token bucket)
const userLimiter = RateLimiterFactory.forUserActions();

// Custom algorithm
const custom = RateLimiterFactory.create(
  RateLimitAlgorithm.TOKEN_BUCKET,
  { capacity: 50 }
);
```

### RateLimitError

```javascript
try {
  await limiter.execute(fn);
} catch (error) {
  if (error instanceof RateLimitError) {
    console.log(error.retryAfter); // ms until retry
  }
}
```

---

## Combined Usage Example

```javascript
import {
  CircuitBreaker,
  RetryHandler,
  TimeoutHandler,
  FallbackHandler,
  Bulkhead,
  TokenBucketRateLimiter
} from 'resilience-based-example';

// Create resilient service
class ResilientApiClient {
  constructor() {
    this.rateLimiter = new TokenBucketRateLimiter({ capacity: 100 });
    this.bulkhead = new Bulkhead({ maxConcurrent: 10 });
    this.timeout = new TimeoutHandler({ duration: 5000 });
    this.circuitBreaker = new CircuitBreaker({ failureThreshold: 5 });
    this.retry = new RetryHandler({ maxAttempts: 3 });
    this.fallback = new FallbackHandler();
  }

  async fetch(url, cachedData) {
    if (!this.rateLimiter.tryConsume()) {
      return cachedData; // Rate limited
    }

    return this.fallback.execute(
      () => this.retry.execute(
        () => this.circuitBreaker.execute(
          () => this.bulkhead.execute(
            () => this.timeout.execute(
              () => fetch(url).then(r => r.json())
            )
          )
        )
      ),
      () => cachedData
    );
  }
}
```
