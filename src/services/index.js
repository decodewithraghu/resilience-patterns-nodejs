/**
 * Services module exports
 * 
 * This module provides production-ready service implementations
 * that utilize the resilience patterns.
 * 
 * @module services
 */

export {
  ResilientHttpClient,
  ResilientHttpClientBuilder,
  HttpError,
  createResilientClient
} from './ResilientHttpClient.js';
