# 🚀 Quick Reference Guide - Resilience Patterns

> **Requirements:** Node.js 24.12.0+ — HTTP examples use the built-in `fetch` API

## Pattern Selection Matrix

### When to Use Which Pattern

| Scenario | Recommended Patterns | Priority |
|----------|---------------------|----------|
| **External API calls** | Circuit Breaker + Retry + Timeout + Fallback | HIGH |
| **Database queries** | Timeout + Retry + Bulkhead | HIGH |
| **Payment processing** | Circuit Breaker + Fallback + Retry | CRITICAL |
| **File uploads** | Timeout + Bulkhead + Rate Limiter | MEDIUM |
| **Public API endpoint** | Rate Limiter + Bulkhead + Timeout | CRITICAL |
| **Microservice calls** | Circuit Breaker + Timeout + Fallback | HIGH |
| **Background jobs** | Retry + Timeout | MEDIUM |
| **Cache operations** | Timeout + Fallback | MEDIUM |
| **Email sending** | Retry + Fallback + Rate Limiter | MEDIUM |
| **Webhook calls** | Circuit Breaker + Retry + Timeout | HIGH |

---

## Quick Start Templates

### Template 1: Basic API Call Protection
```javascript
import CircuitBreaker from 'opossum';

const breaker = new CircuitBreaker(apiCall, {
  timeout: 3000,
  errorThresholdPercentage: 50,
  resetTimeout: 5000
});

breaker.on('open', () => console.log('Circuit opened!'));

// Usage
try {
  const result = await breaker.fire(params);
} catch (error) {
  console.error('API call failed:', error);
}
```

### Template 2: Retry with Exponential Backoff
```javascript
async function retryOperation(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
    }
  }
}

// Usage
const result = await retryOperation(() => fetchData());
```

### Template 3: Timeout Protection
```javascript
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout')), ms)
    )
  ]);
}

// Usage
const result = await withTimeout(slowOperation(), 5000);
```

### Template 4: Fallback Pattern
```javascript
async function withFallback(primary, fallback) {
  try {
    return await primary();
  } catch (error) {
    return await fallback();
  }
}

// Usage
const data = await withFallback(
  () => fetchFromAPI(),
  () => getFromCache()
);
```

### Template 5: Complete Production Pattern
```javascript
import { ResilienceService } from './examples/resilience-service.js';

const service = new ResilienceService({
  serviceName: 'MyService',
  circuitBreaker: { enabled: true, timeout: 3000 },
  retry: { enabled: true, maxAttempts: 3 },
  timeout: { enabled: true, duration: 5000 },
  bulkhead: { enabled: true, maxConcurrent: 10 },
  rateLimit: { enabled: true, maxRequests: 100, windowMs: 60000 },
  fallback: async (error) => ({ cached: true, data: [] })
});

// Usage
const result = await service.execute(
  () => myOperation(),
  { operationName: 'MyOp' }
);
```

---

## Configuration Guidelines

### Circuit Breaker
```javascript
{
  timeout: 3000,              // Max execution time (ms)
  errorThresholdPercentage: 50, // % failures to open circuit
  resetTimeout: 5000,         // Time before retry (ms)
  rollingCountTimeout: 10000  // Window for error calculation
}
```

**Recommendations**:
- **Fast APIs**: timeout: 1000-2000ms
- **Slow APIs**: timeout: 5000-10000ms
- **Critical services**: errorThresholdPercentage: 25
- **Non-critical**: errorThresholdPercentage: 50

### Retry Pattern
```javascript
{
  maxAttempts: 3,            // Total attempts
  initialDelay: 1000,        // First retry delay (ms)
  backoffMultiplier: 2,      // Exponential factor
  maxDelay: 30000,          // Maximum delay cap
  jitter: true              // Add randomness
}
```

**Recommendations**:
- **Network errors**: maxAttempts: 3, initialDelay: 1000
- **Database timeouts**: maxAttempts: 5, initialDelay: 500
- **Rate limit errors**: maxAttempts: 2, initialDelay: 2000

### Timeout
```javascript
{
  duration: 5000  // Timeout in ms
}
```

**Recommendations**:
- **Database queries**: 2000-5000ms
- **API calls**: 3000-10000ms
- **File operations**: 10000-30000ms

### Bulkhead
```javascript
{
  maxConcurrent: 10,   // Max simultaneous operations
  maxQueueSize: 100,   // Max queued requests
  timeout: 30000       // Max queue wait time
}
```

**Recommendations**:
- **Database connections**: maxConcurrent: 10-20
- **External APIs**: maxConcurrent: 5-10
- **File processing**: maxConcurrent: 3-5

### Rate Limiter
```javascript
{
  maxRequests: 100,    // Max requests
  windowMs: 60000      // Time window (ms)
}
```

**Recommendations**:
- **Public API**: 100-1000 requests/minute
- **Internal API**: 1000-10000 requests/minute
- **User actions**: 10-100 requests/minute

---

## Common Pitfalls & Solutions

### ❌ Pitfall 1: Too Aggressive Timeouts
```javascript
// BAD: Timeout too short
const breaker = new CircuitBreaker(slowAPI, { timeout: 100 });

// GOOD: Allow reasonable time
const breaker = new CircuitBreaker(slowAPI, { timeout: 5000 });
```

### ❌ Pitfall 2: No Jitter in Retries
```javascript
// BAD: Thundering herd problem
const delay = baseDelay * Math.pow(2, attempt);

// GOOD: Add jitter
const delay = (baseDelay * Math.pow(2, attempt)) * (0.5 + Math.random() * 0.5);
```

### ❌ Pitfall 3: Forgetting to Clean Up
```javascript
// BAD: Memory leak
setInterval(() => refill(), 1000);

// GOOD: Store reference and clean up
this.timer = setInterval(() => refill(), 1000);
// Later: clearInterval(this.timer);
```

### ❌ Pitfall 4: No Fallback
```javascript
// BAD: Fails completely
const result = await breaker.fire(apiCall);

// GOOD: Graceful degradation
try {
  const result = await breaker.fire(apiCall);
} catch (error) {
  return cachedData; // Fallback
}
```

### ❌ Pitfall 5: Combining Patterns Incorrectly
```javascript
// BAD: Retry wraps circuit breaker (circuit opens on every retry)
await retry(() => breaker.fire(fn));

// GOOD: Circuit breaker wraps retry
await breaker.fire(() => retry(fn));
```

---

## Testing Strategies

### Test Circuit Breaker
```javascript
// Force failures to open circuit
for (let i = 0; i < 10; i++) {
  try {
    await breaker.fire(() => Promise.reject('Error'));
  } catch (e) {}
}

// Verify circuit is open
assert(breaker.opened === true);
```

### Test Retry Logic
```javascript
let attempts = 0;
const fn = () => {
  attempts++;
  if (attempts < 3) throw new Error('Fail');
  return 'Success';
};

await retryWithBackoff(fn, 5);
assert(attempts === 3); // Succeeded on 3rd attempt
```

### Test Rate Limiter
```javascript
const limiter = new TokenBucket({ capacity: 5 });

// Use all tokens
for (let i = 0; i < 5; i++) {
  assert(await limiter.tryConsume() === true);
}

// Next should fail
assert(await limiter.tryConsume() === false);
```

---

## Monitoring Checklist

### Essential Metrics
- ✅ Total requests
- ✅ Success/failure rates
- ✅ Circuit breaker state
- ✅ Retry attempts
- ✅ Timeout occurrences
- ✅ Fallback usage
- ✅ Queue sizes
- ✅ Rate limit rejections

### Alerting Thresholds
```javascript
// Alert if:
- Success rate < 95%
- Circuit breaker open > 5 minutes
- Retry rate > 30%
- Timeout rate > 10%
- Bulkhead queue > 80% full
- Rate limit rejections > 5%
```

---

## Performance Impact

### Overhead by Pattern

| Pattern | Overhead | Impact |
|---------|----------|--------|
| Circuit Breaker | ~1-2ms | Negligible |
| Retry | Variable | Depends on retries |
| Timeout | <1ms | Negligible |
| Fallback | Variable | Depends on fallback |
| Bulkhead | <1ms | Negligible |
| Rate Limiter | <1ms | Negligible |

### Memory Usage

| Component | Memory |
|-----------|--------|
| Circuit Breaker | ~1KB per instance |
| Rate Limiter (1000 req) | ~16KB |
| Bulkhead Queue (100 items) | ~8KB |
| Statistics | ~2KB per service |

---

## Production Deployment Checklist

- [ ] All patterns configured with environment-specific values
- [ ] Monitoring and alerting set up
- [ ] Health check endpoints exposed
- [ ] Logging configured (appropriate levels)
- [ ] Resource cleanup verified (no memory leaks)
- [ ] Load testing completed
- [ ] Failure scenarios tested
- [ ] Fallback strategies defined
- [ ] Documentation updated
- [ ] Team trained on patterns

---

## Quick Debugging

### Circuit Breaker Not Opening?
1. Check `errorThresholdPercentage` - is it too high?
2. Verify enough requests are being made
3. Check `rollingCountTimeout` window

### Retries Not Working?
1. Ensure errors are being thrown properly
2. Check `maxAttempts` configuration
3. Verify delay calculations
4. Add logging to see actual retries

### Timeouts Too Aggressive?
1. Profile actual operation times
2. Consider network latency
3. Increase timeout duration
4. Check if timeout is applied correctly

### Rate Limiter Too Strict?
1. Review `maxRequests` and `windowMs`
2. Check if cleanup is running
3. Verify timestamp tracking
4. Consider using different algorithm

---

**Quick Tips**:
1. 🎯 Start with circuit breaker + timeout + fallback
2. 📊 Add monitoring from day one
3. 🧪 Test failure scenarios regularly
4. 🔄 Use exponential backoff with jitter
5. 🚦 Always have a fallback strategy
6. 📈 Monitor and adjust based on metrics
7. 🏗️ Use ResilienceService for production

---

**Last Updated**: December 30, 2025
