# SOLID & DRY Principles Implementation

This document explains how the Resilient REST API example demonstrates SOLID and DRY principles for clean, maintainable code.

## Table of Contents
1. [SOLID Principles](#solid-principles)
2. [DRY Principle](#dry-principle)
3. [Benefits](#benefits)
4. [Code Examples](#code-examples)

---

## SOLID Principles

### 1. Single Responsibility Principle (SRP)
> A class should have only one reason to change.

**Implementation:**

- **`ConsoleLogger`**: Only handles logging concerns
- **`SimpleCache`**: Only manages caching with TTL
- **`UserService`**: Only handles user-related API operations
- **`ProductService`**: Only handles product-related API operations
- **`OrderService`**: Only handles order-related API operations
- **`ServiceFactory`**: Only handles service instantiation
- **`ClientConfigFactory`**: Only handles client configuration

**Before (Violation):**
```javascript
class UserService {
  constructor(client, cache) {
    this.client = client;
    this.cache = cache;
    this.setupEventListeners(); // Mixing concerns
  }

  setupEventListeners() {
    this.client.on('circuitOpen', () => {
      console.log('Circuit opened!'); // Direct logging
    });
  }

  async getUsers() {
    // Mixed: Business logic + caching + error handling + logging
  }
}
```

**After (SRP Compliant):**
```javascript
class BaseApiService {
  constructor(client, cache, logger) {
    this.client = client;
    this.cache = cache;
    this.logger = logger; // Dependency injection
    this.setupEventListeners();
  }

  setupEventListeners() {
    this.client.on('circuitOpen', () => {
      this.logger.warn('Circuit breaker OPENED'); // Delegated
    });
  }
}

class UserService extends BaseApiService {
  async getUsers() {
    // Only business logic for users
  }
}
```

---

### 2. Open/Closed Principle (OCP)
> Software entities should be open for extension, but closed for modification.

**Implementation:**

**`ClientConfigFactory`** - Easy to add new configurations without modifying existing ones:
```javascript
class ClientConfigFactory {
  static createDefaultConfig(baseUrl, httpClient) {
    return { /* base config */ };
  }

  // Extend without modifying
  static createUserServiceConfig(baseUrl, httpClient) {
    return {
      ...this.createDefaultConfig(baseUrl, httpClient),
      circuitBreaker: { failureThreshold: 3 } // Override specific settings
    };
  }

  // Add new configurations easily
  static createPaymentServiceConfig(baseUrl, httpClient) {
    return {
      ...this.createDefaultConfig(baseUrl, httpClient),
      timeout: { duration: 10000 } // New service config
    };
  }
}
```

**`BaseApiService`** - Services can extend and customize behavior:
```javascript
class BaseApiService {
  setupEventListeners() {
    // Default event handling
  }
}

class UserService extends BaseApiService {
  setupEventListeners() {
    super.setupEventListeners(); // Reuse parent
    // Add custom event handling
    this.client.on('customEvent', () => {});
  }
}
```

---

### 3. Liskov Substitution Principle (LSP)
> Objects of a superclass should be replaceable with objects of its subclasses.

**Implementation:**

All service classes extend `BaseApiService` and can be used interchangeably:

```javascript
class BaseApiService {
  constructor(client, cache, logger) {}
  setupEventListeners() {}
  createCacheFallback(cacheKey) {}
  cacheResponse(response, cacheKey) {}
}

class UserService extends BaseApiService {
  async getUsers() { /* specific implementation */ }
}

class ProductService extends BaseApiService {
  async getProducts() { /* specific implementation */ }
}

// LSP in action - any service can be used wherever BaseApiService is expected
function processWithService(service: BaseApiService) {
  // service can be UserService, ProductService, or OrderService
  const stats = service.client.getStats();
  service.client.shutdown();
}

processWithService(new UserService(...));
processWithService(new ProductService(...));
```

---

### 4. Interface Segregation Principle (ISP)
> Clients should not be forced to depend on interfaces they don't use.

**Implementation:**

Defined minimal, focused interfaces using JSDoc:

```javascript
/**
 * @typedef {Object} ICache
 * @property {function(string, *): void} set
 * @property {function(string): *} get
 * @property {function(string): boolean} has
 */

/**
 * @typedef {Object} ILogger
 * @property {function(string): void} info
 * @property {function(string): void} warn
 * @property {function(string): void} error
 */
```

Services only depend on what they need:
```javascript
class UserService extends BaseApiService {
  constructor(client, cache, logger) {
    // Only requires ICache and ILogger interfaces
    // Not forced to implement unnecessary methods
  }
}
```

---

### 5. Dependency Inversion Principle (DIP)
> Depend on abstractions, not concretions.

**Implementation:**

Services depend on interfaces/abstractions rather than concrete implementations:

**Before (Violation):**
```javascript
class UserService {
  constructor(client, cache) {
    this.client = client; // Direct dependency on concrete class
    this.cache = new SimpleCache(); // Creating concrete instance
  }
}
```

**After (DIP Compliant):**
```javascript
class BaseApiService {
  /**
   * @param {ResilientHttpClient} client - Abstraction
   * @param {ICache} cache - Interface/Abstraction
   * @param {ILogger} logger - Interface/Abstraction
   */
  constructor(client, cache, logger) {
    this.client = client;
    this.cache = cache;
    this.logger = logger;
  }
}

// Factory handles concrete implementations
class ServiceFactory {
  createUserService() {
    const client = new ResilientHttpClient(...); // Concrete
    const cache = new SimpleCache(); // Concrete
    const logger = new ConsoleLogger(); // Concrete
    
    // Inject dependencies - service depends on abstractions
    return new UserService(client, cache, logger);
  }
}
```

**Benefits:**
- Easy to swap implementations (e.g., `RedisCache` instead of `SimpleCache`)
- Testability - can inject mock dependencies
- Loose coupling between components

---

## DRY Principle
> Don't Repeat Yourself - Every piece of knowledge should have a single, unambiguous representation.

### 1. Eliminated Repetitive Event Listeners

**Before (Violation):**
```javascript
class UserService {
  setupEventListeners() {
    this.client.on('circuitOpen', () => {
      console.log('[UserService] Circuit opened');
    });
    this.client.on('retry', ({ attempt }) => {
      console.log(`[UserService] Retry ${attempt}`);
    });
  }
}

class ProductService {
  setupEventListeners() {
    this.client.on('circuitOpen', () => {
      console.log('[ProductService] Circuit opened'); // DUPLICATE
    });
    this.client.on('retry', ({ attempt }) => {
      console.log(`[ProductService] Retry ${attempt}`); // DUPLICATE
    });
  }
}
```

**After (DRY Compliant):**
```javascript
class BaseApiService {
  setupEventListeners() {
    // Single definition - reused by all services
    this.client.on('circuitOpen', () => {
      this.logger.warn('Circuit breaker OPENED');
    });
    this.client.on('retry', ({ attempt, delay }) => {
      this.logger.retry(`Retry attempt ${attempt}, waiting ${delay}ms`);
    });
    // ... other events
  }
}

class UserService extends BaseApiService {} // Inherits event handling
class ProductService extends BaseApiService {} // Inherits event handling
```

---

### 2. Eliminated Repetitive Client Configuration

**Before (Violation):**
```javascript
// Demo 1
const userClient = new ResilientHttpClientBuilder()
  .baseUrl('https://api.example.com')
  .withCircuitBreaker({ failureThreshold: 3 })
  .withRetry({ maxAttempts: 3 })
  .withTimeout({ duration: 3000 })
  .build();

// Demo 2
const productClient = new ResilientHttpClientBuilder()
  .baseUrl('https://api.example.com') // DUPLICATE
  .withCircuitBreaker({ failureThreshold: 3 }) // SIMILAR
  .withRetry({ maxAttempts: 3 }) // SIMILAR
  .withTimeout({ duration: 3000 }) // SIMILAR
  .build();
```

**After (DRY Compliant):**
```javascript
class ClientConfigFactory {
  static createDefaultConfig(baseUrl, httpClient) {
    return {
      baseUrl,
      httpClient,
      circuitBreaker: { failureThreshold: 5 },
      retry: { maxAttempts: 3 },
      timeout: { duration: 5000 },
      // ... other defaults
    };
  }

  static createUserServiceConfig(baseUrl, httpClient) {
    return {
      ...this.createDefaultConfig(baseUrl, httpClient),
      // Only override what's different
      timeout: { duration: 3000 }
    };
  }
}
```

---

### 3. Eliminated Repetitive Caching Logic

**Before (Violation):**
```javascript
class UserService {
  async getUsers() {
    const response = await this.client.get('/api/users', {
      fallback: async () => {
        const cached = this.cache.get('users:all');
        if (cached) {
          return { data: cached, fromCache: true };
        }
        throw new Error('No cache');
      }
    });
    
    if (!response.fromCache) {
      this.cache.set('users:all', response.data); // DUPLICATE PATTERN
    }
  }

  async getUser(id) {
    const response = await this.client.get(`/api/users/${id}`, {
      fallback: async () => {
        const cached = this.cache.get(`users:${id}`); // DUPLICATE PATTERN
        if (cached) {
          return { data: cached, fromCache: true };
        }
        throw new Error('No cache');
      }
    });
    
    if (!response.fromCache) {
      this.cache.set(`users:${id}`, response.data); // DUPLICATE PATTERN
    }
  }
}
```

**After (DRY Compliant):**
```javascript
class BaseApiService {
  // Reusable cache fallback creation
  createCacheFallback(cacheKey, errorMessage = 'No cached data') {
    return async () => {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        this.logger.info('Returning cached data');
        return { status: 200, data: cached, fromCache: true };
      }
      throw new Error(errorMessage);
    };
  }

  // Reusable cache storage
  cacheResponse(response, cacheKey) {
    if (response && !response.fromCache && response.data) {
      this.cache.set(cacheKey, response.data);
    }
  }
}

class UserService extends BaseApiService {
  async getUsers() {
    const response = await this.client.get('/api/users', {
      fallback: this.createCacheFallback('users:all') // Reuse
    });
    this.cacheResponse(response, 'users:all'); // Reuse
    return response.data;
  }

  async getUser(id) {
    const response = await this.client.get(`/api/users/${id}`, {
      fallback: this.createCacheFallback(`users:${id}`) // Reuse
    });
    this.cacheResponse(response, `users:${id}`); // Reuse
    return response.data;
  }
}
```

---

### 4. Service Factory Pattern

**Before (Violation):**
```javascript
// Repeated in every demo
const client = new ResilientHttpClient({
  baseUrl: 'https://api.example.com',
  httpClient: (url, opts) => mockServer.handle(url, opts),
  circuitBreaker: { ... },
  retry: { ... },
  // ... more config
});

const cache = new SimpleCache();
const logger = new ConsoleLogger('[Service] ');
const service = new UserService(client, cache, logger);
```

**After (DRY Compliant):**
```javascript
class ServiceFactory {
  constructor(mockServer, cache) {
    this.mockServer = mockServer;
    this.cache = cache;
  }

  createUserService() {
    const config = ClientConfigFactory.createUserServiceConfig(
      'https://api.example.com',
      (url, opts) => this.mockServer.handle(url, opts)
    );
    const client = new ResilientHttpClient(config);
    const logger = new ConsoleLogger('[UserService] ');
    return new UserService(client, this.cache, logger);
  }

  // Similar for other services...
}

// Usage
const factory = new ServiceFactory(mockServer, cache);
const userService = factory.createUserService(); // One line!
```

---

## Benefits

### Code Quality Improvements

1. **Reduced Code Duplication**
   - Before: ~600 lines with repetition
   - After: ~500 lines, more maintainable

2. **Better Testability**
   - Services accept dependencies (easy to mock)
   - Single responsibility makes unit testing focused
   - Interface-based design allows test doubles

3. **Enhanced Maintainability**
   - Changes to logging affect one place (ConsoleLogger)
   - New event handlers added in BaseApiService
   - Configuration changes in ClientConfigFactory

4. **Improved Extensibility**
   - Add new services by extending BaseApiService
   - Add new configurations without modifying existing ones
   - Swap implementations (e.g., RedisCache, FileLogger)

5. **Better Separation of Concerns**
   - Services focus on business logic
   - Logging, caching, events handled separately
   - Configuration isolated from implementation

---

## Code Examples

### Example 1: Adding a New Service

**Before (Complex):**
```javascript
class PaymentService {
  constructor(client, cache) {
    this.client = client;
    this.cache = cache;
    
    // Duplicate event setup
    this.client.on('circuitOpen', () => {
      console.log('[PaymentService] Circuit opened');
    });
    // ... more events
  }
  
  async processPayment() {
    // Duplicate caching logic
    const response = await this.client.post('/api/payments', {
      fallback: async () => {
        const cached = this.cache.get('payment:pending');
        // ... duplicate fallback logic
      }
    });
    
    if (!response.fromCache) {
      this.cache.set('payment:pending', response.data);
    }
  }
}
```

**After (Simple):**
```javascript
class PaymentService extends BaseApiService {
  async processPayment(paymentData) {
    const cacheKey = `payment:${paymentData.id}`;
    const response = await this.client.post('/api/payments', paymentData, {
      fallback: this.createCacheFallback(cacheKey)
    });
    this.cacheResponse(response, cacheKey);
    return response.data;
  }
}

// Factory method
class ServiceFactory {
  createPaymentService() {
    const config = ClientConfigFactory.createPaymentServiceConfig(
      this.baseUrl,
      this.httpClient
    );
    const client = new ResilientHttpClient(config);
    const logger = new ConsoleLogger('[PaymentService] ');
    return new PaymentService(client, this.cache, logger);
  }
}
```

---

### Example 2: Swapping Implementations

**Easy Cache Implementation Swap:**
```javascript
// Original
class SimpleCache implements ICache {
  // In-memory cache
}

// New implementation
class RedisCache implements ICache {
  constructor(redisClient) {
    this.redis = redisClient;
  }
  
  async set(key, value) {
    await this.redis.set(key, JSON.stringify(value));
  }
  
  async get(key) {
    const data = await this.redis.get(key);
    return data ? JSON.parse(data) : null;
  }
  
  async has(key) {
    return await this.redis.exists(key);
  }
}

// No changes to services needed!
const cache = new RedisCache(redisClient);
const factory = new ServiceFactory(mockServer, cache);
```

---

## Summary

The refactored code demonstrates:

✅ **Single Responsibility** - Each class has one clear purpose  
✅ **Open/Closed** - Easy to extend without modification  
✅ **Liskov Substitution** - Services are interchangeable  
✅ **Interface Segregation** - Minimal, focused interfaces  
✅ **Dependency Inversion** - Depends on abstractions  
✅ **DRY** - No code duplication  

This results in:
- **More maintainable** code
- **Better testability**
- **Easier to extend**
- **Reduced bugs** from duplication
- **Clearer architecture**

---

## Additional Resources

- [SOLID Principles Explained](https://en.wikipedia.org/wiki/SOLID)
- [Clean Code by Robert C. Martin](https://www.oreilly.com/library/view/clean-code-a/9780136083238/)
- [The Pragmatic Programmer](https://pragprog.com/titles/tpp20/the-pragmatic-programmer-20th-anniversary-edition/)
