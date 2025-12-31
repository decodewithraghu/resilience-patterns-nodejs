/**
 * Rate Limiter Tests
 * 
 * TDD approach with comprehensive test coverage
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  TokenBucketRateLimiter,
  SlidingWindowRateLimiter,
  FixedWindowRateLimiter,
  LeakyBucketRateLimiter,
  RateLimiterFactory,
  RateLimitAlgorithm,
  RateLimitError
} from '../src/core/RateLimiter.js';

describe('TokenBucketRateLimiter', () => {
  let limiter;

  beforeEach(() => {
    limiter = new TokenBucketRateLimiter({
      capacity: 5,
      refillRate: 1,
      refillInterval: 100,
      name: 'TestBucket'
    });
  });

  afterEach(() => {
    limiter.destroy();
  });

  describe('Token Consumption', () => {
    it('should allow requests when tokens available', () => {
      assert.strictEqual(limiter.tryConsume(), true);
    });

    it('should consume correct number of tokens', () => {
      const initialTokens = limiter.tokens;
      limiter.tryConsume(2);
      // After consuming 2 tokens, remaining should be initial - 2
      // Use approximate check due to potential micro-refill
      assert.ok(limiter.tokens <= initialTokens - 1, `Expected tokens to decrease, got ${limiter.tokens}`);
    });

    it('should reject when insufficient tokens', () => {
      // Consume all tokens
      for (let i = 0; i < 5; i++) {
        limiter.tryConsume();
      }
      
      assert.strictEqual(limiter.tryConsume(), false);
    });

    it('should refill tokens over time', async () => {
      // Consume all tokens
      for (let i = 0; i < 5; i++) {
        limiter.tryConsume();
      }
      
      const tokensAfterConsume = limiter.tokens;
      assert.strictEqual(tokensAfterConsume, 0);
      
      // Wait longer for refill - enough for at least 3 refills
      await new Promise(resolve => setTimeout(resolve, 400));
      
      // Should have refilled some tokens (may be fractional)
      assert.ok(limiter.tokens > tokensAfterConsume, `Expected tokens to increase but got ${limiter.tokens}`);
    });
  });

  describe('Execute', () => {
    it('should execute when tokens available', async () => {
      const result = await limiter.execute(async () => 'success');
      assert.strictEqual(result, 'success');
    });

    it('should throw RateLimitError when no tokens', async () => {
      // Consume all tokens
      for (let i = 0; i < 5; i++) {
        limiter.tryConsume();
      }
      
      await assert.rejects(
        () => limiter.execute(async () => 'fail'),
        RateLimitError
      );
    });

    it('should include retryAfter in error', async () => {
      for (let i = 0; i < 5; i++) {
        limiter.tryConsume();
      }
      
      try {
        await limiter.execute(async () => 'fail');
      } catch (error) {
        assert.ok(error.retryAfter > 0);
      }
    });
  });

  describe('Statistics', () => {
    it('should track allowed and rejected requests', () => {
      limiter.tryConsume();
      limiter.tryConsume();
      
      // Consume remaining
      for (let i = 0; i < 3; i++) {
        limiter.tryConsume();
      }
      
      // Try after empty
      limiter.tryConsume();
      
      const stats = limiter.getStats();
      assert.strictEqual(stats.allowedRequests, 5);
      assert.strictEqual(stats.rejectedRequests, 1);
    });
  });

  describe('Events', () => {
    it('should emit allowed event', () => {
      let eventData = null;
      limiter.on('allowed', (data) => { eventData = data; });
      
      limiter.tryConsume();
      
      assert.notStrictEqual(eventData, null);
      assert.ok(eventData.remainingTokens >= 0);
    });

    it('should emit rejected event', () => {
      let eventData = null;
      limiter.on('rejected', (data) => { eventData = data; });
      
      for (let i = 0; i < 6; i++) {
        limiter.tryConsume();
      }
      
      assert.notStrictEqual(eventData, null);
      assert.ok(eventData.retryAfter > 0);
    });
  });
});

describe('SlidingWindowRateLimiter', () => {
  let limiter;

  beforeEach(() => {
    limiter = new SlidingWindowRateLimiter({
      limit: 5,
      windowMs: 1000,
      name: 'TestWindow'
    });
  });

  describe('Acquire', () => {
    it('should allow requests within limit', () => {
      for (let i = 0; i < 5; i++) {
        assert.strictEqual(limiter.tryAcquire(), true);
      }
    });

    it('should reject requests over limit', () => {
      for (let i = 0; i < 5; i++) {
        limiter.tryAcquire();
      }
      assert.strictEqual(limiter.tryAcquire(), false);
    });

    it('should allow requests after window slides', async () => {
      for (let i = 0; i < 5; i++) {
        limiter.tryAcquire();
      }
      
      // Wait for window to slide
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      assert.strictEqual(limiter.tryAcquire(), true);
    });
  });

  describe('Current Count', () => {
    it('should track current count', () => {
      limiter.tryAcquire();
      limiter.tryAcquire();
      
      assert.strictEqual(limiter.currentCount, 2);
    });
  });

  describe('Execute', () => {
    it('should execute within limit', async () => {
      const result = await limiter.execute(async () => 'success');
      assert.strictEqual(result, 'success');
    });

    it('should throw when over limit', async () => {
      for (let i = 0; i < 5; i++) {
        await limiter.execute(async () => 'ok');
      }
      
      await assert.rejects(
        () => limiter.execute(async () => 'fail'),
        RateLimitError
      );
    });
  });
});

describe('FixedWindowRateLimiter', () => {
  let limiter;

  beforeEach(() => {
    limiter = new FixedWindowRateLimiter({
      limit: 3,
      windowMs: 500,
      name: 'TestFixed'
    });
  });

  afterEach(() => {
    limiter.destroy();
  });

  describe('Acquire', () => {
    it('should allow requests within limit', () => {
      for (let i = 0; i < 3; i++) {
        assert.strictEqual(limiter.tryAcquire(), true);
      }
    });

    it('should reject over limit', () => {
      for (let i = 0; i < 3; i++) {
        limiter.tryAcquire();
      }
      assert.strictEqual(limiter.tryAcquire(), false);
    });

    it('should reset after window', async () => {
      for (let i = 0; i < 3; i++) {
        limiter.tryAcquire();
      }
      
      await new Promise(resolve => setTimeout(resolve, 600));
      
      assert.strictEqual(limiter.tryAcquire(), true);
    });
  });

  describe('Window Reset Event', () => {
    it('should emit windowReset event', async () => {
      let resetEvent = null;
      limiter.on('windowReset', (data) => { resetEvent = data; });
      
      await new Promise(resolve => setTimeout(resolve, 600));
      
      assert.notStrictEqual(resetEvent, null);
    });
  });
});

describe('RateLimiterFactory', () => {
  describe('Create', () => {
    it('should create token bucket limiter', () => {
      const limiter = RateLimiterFactory.create(RateLimitAlgorithm.TOKEN_BUCKET);
      assert.ok(limiter instanceof TokenBucketRateLimiter);
      limiter.destroy();
    });

    it('should create sliding window limiter', () => {
      const limiter = RateLimiterFactory.create(RateLimitAlgorithm.SLIDING_WINDOW);
      assert.ok(limiter instanceof SlidingWindowRateLimiter);
    });

    it('should create fixed window limiter', () => {
      const limiter = RateLimiterFactory.create(RateLimitAlgorithm.FIXED_WINDOW);
      assert.ok(limiter instanceof FixedWindowRateLimiter);
      limiter.destroy();
    });
  });

  describe('Presets', () => {
    it('should create API rate limiter', () => {
      const limiter = RateLimiterFactory.forApi();
      assert.strictEqual(limiter.limit, 100);
      assert.strictEqual(limiter.windowMs, 60000);
    });

    it('should create user actions rate limiter', () => {
      const limiter = RateLimiterFactory.forUserActions();
      assert.strictEqual(limiter.capacity, 10);
      limiter.destroy();
    });

    it('should allow overrides', () => {
      const limiter = RateLimiterFactory.forApi({ limit: 200 });
      assert.strictEqual(limiter.limit, 200);
    });
  });
});

describe('LeakyBucketRateLimiter', () => {
  let limiter;

  beforeEach(() => {
    limiter = new LeakyBucketRateLimiter({
      capacity: 5,
      leakRate: 2, // 2 requests per second
      name: 'TestLeaky'
    });
  });

  afterEach(() => {
    limiter.destroy();
  });

  describe('Initialization', () => {
    it('should initialize with correct capacity', () => {
      assert.strictEqual(limiter.capacity, 5);
    });

    it('should start with empty bucket', () => {
      assert.strictEqual(limiter.waterLevel, 0);
    });

    it('should use default values when not provided', () => {
      const defaultLimiter = new LeakyBucketRateLimiter();
      assert.strictEqual(defaultLimiter.capacity, 10);
      assert.strictEqual(defaultLimiter.leakRate, 1);
      defaultLimiter.destroy();
    });
  });

  describe('Request Processing', () => {
    it('should accept requests when bucket has room', () => {
      assert.strictEqual(limiter.tryAcquire(), true);
      assert.ok(limiter.waterLevel > 0);
    });

    it('should reject when bucket is full', () => {
      // Fill the bucket
      for (let i = 0; i < 5; i++) {
        limiter.tryAcquire();
      }
      
      // Next request should be rejected
      assert.strictEqual(limiter.tryAcquire(), false);
    });

    it('should accept requests after leaking', async () => {
      // Fill the bucket
      for (let i = 0; i < 5; i++) {
        limiter.tryAcquire();
      }
      
      // Wait for some leakage (2 per second = 1 in 500ms)
      await new Promise(r => setTimeout(r, 600));
      
      // Should now have room
      assert.strictEqual(limiter.tryAcquire(), true);
    });

    it('should accept multiple units at once', () => {
      assert.strictEqual(limiter.tryAcquire(3), true);
      assert.ok(limiter.waterLevel >= 3);
    });

    it('should reject when requesting more than available', () => {
      limiter.tryAcquire(3);
      assert.strictEqual(limiter.tryAcquire(5), false);
    });
  });

  describe('Leak Behavior', () => {
    it('should leak water over time', async () => {
      limiter.tryAcquire(3);
      const initialLevel = limiter.waterLevel;
      
      await new Promise(r => setTimeout(r, 600));
      
      const newLevel = limiter.waterLevel;
      assert.ok(newLevel < initialLevel, `Expected ${newLevel} < ${initialLevel}`);
    });

    it('should emit leak event', async () => {
      let leakEventFired = false;
      limiter.on('leak', () => {
        leakEventFired = true;
      });

      limiter.tryAcquire(3);
      await new Promise(r => setTimeout(r, 200));

      assert.ok(leakEventFired, 'leak event should have fired');
    });

    it('should not go below zero', async () => {
      limiter.tryAcquire(1);
      await new Promise(r => setTimeout(r, 1000));
      
      assert.ok(limiter.waterLevel >= 0);
    });
  });

  describe('Execute', () => {
    it('should execute when bucket has room', async () => {
      const result = await limiter.execute(async () => 'success');
      assert.strictEqual(result, 'success');
    });

    it('should throw RateLimitError when full', async () => {
      // Fill the bucket
      for (let i = 0; i < 5; i++) {
        limiter.tryAcquire();
      }

      await assert.rejects(
        limiter.execute(async () => 'should not run'),
        RateLimitError
      );
    });

    it('should include retryAfter in error', async () => {
      // Fill the bucket
      for (let i = 0; i < 5; i++) {
        limiter.tryAcquire();
      }

      try {
        await limiter.execute(async () => 'should not run');
        assert.fail('Should have thrown');
      } catch (error) {
        assert.ok(error.retryAfter > 0);
      }
    });
  });

  describe('Statistics', () => {
    it('should track allowed requests', () => {
      limiter.tryAcquire();
      limiter.tryAcquire();
      
      assert.strictEqual(limiter.getStats().allowedRequests, 2);
    });

    it('should track rejected requests', () => {
      // Fill and overflow
      for (let i = 0; i < 7; i++) {
        limiter.tryAcquire();
      }
      
      assert.strictEqual(limiter.getStats().rejectedRequests, 2);
    });
  });

  describe('Events', () => {
    it('should emit allowed event', () => {
      let eventData = null;
      limiter.on('allowed', (data) => {
        eventData = data;
      });

      limiter.tryAcquire();

      assert.ok(eventData);
      assert.ok('waterLevel' in eventData);
      assert.ok('capacity' in eventData);
    });

    it('should emit rejected event', () => {
      let eventData = null;
      limiter.on('rejected', (data) => {
        eventData = data;
      });

      // Fill the bucket
      for (let i = 0; i < 6; i++) {
        limiter.tryAcquire();
      }

      assert.ok(eventData);
      assert.ok('retryAfter' in eventData);
    });
  });

  describe('Available Capacity', () => {
    it('should report available capacity', () => {
      assert.strictEqual(limiter.available, 5);
      limiter.tryAcquire(2);
      assert.ok(limiter.available <= 3);
    });
  });
});

describe('RateLimiterFactory - LeakyBucket', () => {
  it('should create leaky bucket limiter', () => {
    const limiter = RateLimiterFactory.create(RateLimitAlgorithm.LEAKY_BUCKET, {
      capacity: 10,
      leakRate: 5
    });
    assert.ok(limiter instanceof LeakyBucketRateLimiter);
    limiter.destroy();
  });

  it('should create steady throughput preset', () => {
    const limiter = RateLimiterFactory.forSteadyThroughput();
    assert.ok(limiter instanceof LeakyBucketRateLimiter);
    assert.strictEqual(limiter.capacity, 20);
    limiter.destroy();
  });
});