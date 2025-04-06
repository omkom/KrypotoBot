console.log('api/utils.js', '# Shared API utilities (retry, caching)');

// src/api/utils.js
import axios from 'axios';
import config from '../config/index.js';
import logger from '../services/logger.js';

/**
 * Creates an axios instance with optimized configuration for API calls
 * Includes retries, timeouts, and detailed error handling
 * @param {Object} options - Additional axios options
 * @returns {Object} Configured axios instance
 */
export function createApiClient(options = {}) {
  const client = axios.create({
    timeout: config.get('API_TIMEOUT'),
    ...options
  });
  
  // Request interceptor for logging
  client.interceptors.request.use(
    (config) => {
      logger.debug(`API Request: ${config.method?.toUpperCase() || 'GET'} ${config.url}`);
      return config;
    },
    (error) => {
      logger.error(`API Request Error: ${error.message}`);
      return Promise.reject(error);
    }
  );
  
  // Response interceptor for error handling
  client.interceptors.response.use(
    (response) => {
      logger.debug(`API Response: ${response.status} from ${response.config.url}`);
      return response;
    },
    async (error) => {
      // Extract relevant error information
      const originalRequest = error.config;
      const errorStatus = error.response?.status;
      const errorMessage = error.response?.data?.message || error.message;
      
      logger.error(`API Error: ${errorStatus} - ${errorMessage} from ${originalRequest.url}`);
      
      // Retry logic for specific errors (timeouts, rate limiting, etc)
      if (
        (errorStatus === 429 || // Rate limit
         errorStatus === 503 || // Service unavailable
         error.code === 'ECONNABORTED' || // Timeout
         error.code === 'ETIMEDOUT') && // Another timeout case
        originalRequest._retry !== true && // Haven't retried yet
        originalRequest.method === 'get' // Only retry GET requests 
      ) {
        // Mark as retried
        originalRequest._retry = true;
        
        // Calculate backoff time (exponential with jitter)
        const retryCount = originalRequest._retryCount || 0;
        originalRequest._retryCount = retryCount + 1;
        
        // Limit max retries
        if (retryCount >= config.get('MAX_RETRIES')) {
          logger.warn(`Max retry attempts (${config.get('MAX_RETRIES')}) reached for ${originalRequest.url}`);
          return Promise.reject(error);
        }
        
        // Calculate backoff with exponential delay and jitter
        const delay = Math.min(
          1000 * Math.pow(2, retryCount) * (0.8 + Math.random() * 0.4), // Exponential with ±20% jitter
          60000 // Cap at 60 seconds
        );
        
        logger.debug(`Retrying request to ${originalRequest.url} in ${delay}ms (attempt ${retryCount + 1})`);
        
        // Wait for backoff period
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // Retry request
        return client(originalRequest);
      }
      
      return Promise.reject(error);
    }
  );
  
  return client;
}

/**
 * Executes an API call with advanced retry logic and error handling
 * @param {Function} apiCall - Async function containing API call
 * @param {Object} options - Retry options
 * @returns {Promise} API call result or error
 */
export async function safeApiCall(apiCall, options = {}) {
  const {
    retries = config.get('MAX_RETRIES'),
    retryableErrors = [429, 503, 502, 500, 'ECONNABORTED', 'ETIMEDOUT'],
    initialDelay = 1000,
    onRetry = null
  } = options;
  
  let lastError;
  let attempt = 0;
  
  while (attempt <= retries) {
    try {
      // Execute the API call
      return await apiCall();
    } catch (error) {
      lastError = error;
      attempt++;
      
      // Determine if error is retryable
      const errorStatus = error.response?.status;
      const errorCode = error.code;
      const isRetryable = retryableErrors.includes(errorStatus) || 
                          retryableErrors.includes(errorCode);
      
      // If error is not retryable or we've used all retries, throw
      if (!isRetryable || attempt > retries) {
        throw error;
      }
      
      // Calculate exponential backoff with jitter
      const delay = Math.min(
        initialDelay * Math.pow(2, attempt - 1) * (0.8 + Math.random() * 0.4),
        60000 // Maximum 60 second delay
      );
      
      // Log retry attempt
      logger.warn(
        `API call failed with ${errorStatus || errorCode}, retrying in ${Math.round(delay)}ms ` +
        `(${attempt}/${retries})`
      );
      
      // Execute onRetry callback if provided
      if (onRetry) {
        onRetry(error, attempt);
      }
      
      // Wait for backoff period
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  // Should never reach here due to throw in catch block, but just in case
  throw lastError;
}

export default {
  createApiClient,
  safeApiCall
};