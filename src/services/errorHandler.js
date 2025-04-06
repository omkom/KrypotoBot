console.log('services/errorHandler.js', '# Error handling system');

// src/services/errorHandler.js
import logger from './logger.js';
import config from '../config/index.js';

/**
 * Error severity levels
 * @enum {number}
 */
export const ErrorSeverity = {
  CRITICAL: 3,  // System cannot continue, requires immediate attention
  HIGH: 2,      // Feature broken but system can continue
  MEDIUM: 1,    // Degraded functionality but still works
  LOW: 0        // Minor issue that doesn't affect functionality
};

/**
 * Advanced error handling system with severity classification,
 * recovery mechanisms, and error reporting
 */
class ErrorHandler {
  constructor() {
    // Track errors by category for analysis
    this.errorStats = {
      api: { count: 0, lastOccurred: null },
      blockchain: { count: 0, lastOccurred: null },
      trading: { count: 0, lastOccurred: null },
      system: { count: 0, lastOccurred: null }
    };
    
    // Track consecutive errors for circuit breaking
    this.consecutiveErrors = {
      api: 0,
      blockchain: 0,
      trading: 0
    };
    
    // Circuit breaker thresholds
    this.circuitBreakerThresholds = {
      api: 5,        // Break after 5 consecutive API errors
      blockchain: 3,  // Break after 3 consecutive blockchain errors
      trading: 3      // Break after 3 consecutive trading errors
    };
    
    // Circuit breaker status
    this.circuitStatus = {
      api: { broken: false, until: null },
      blockchain: { broken: false, until: null },
      trading: { broken: false, until: null }
    };
  }
  
  /**
   * Handle an error with appropriate logging and recovery steps
   * @param {Error} error - The error object
   * @param {string} category - Error category (api, blockchain, trading, system)
   * @param {number} severity - Error severity from ErrorSeverity enum
   * @param {Object} context - Additional context about the error
   * @returns {Object} Error handling result including recovery steps
   */
  handleError(error, category = 'system', severity = ErrorSeverity.MEDIUM, context = {}) {
    // Update error statistics
    if (this.errorStats[category]) {
      this.errorStats[category].count++;
      this.errorStats[category].lastOccurred = new Date();
    }
    
    // Update consecutive error count
    if (['api', 'blockchain', 'trading'].includes(category)) {
      this.consecutiveErrors[category]++;
    }
    
    // Log the error with appropriate level
    const errorMessage = `[${category.toUpperCase()}] ${error.message}`;
    switch (severity) {
      case ErrorSeverity.CRITICAL:
        logger.error(`CRITICAL: ${errorMessage}`, error);
        break;
      case ErrorSeverity.HIGH:
        logger.error(`HIGH: ${errorMessage}`, error);
        break;
      case ErrorSeverity.MEDIUM:
        logger.warn(`MEDIUM: ${errorMessage}`);
        break;
      case ErrorSeverity.LOW:
        logger.debug(`LOW: ${errorMessage}`);
        break;
    }
    
    // Check if we need to trip circuit breaker
    const circuitBroken = this.checkCircuitBreaker(category);
    
    // Generate recovery steps based on category and severity
    const recoverySteps = this.generateRecoverySteps(category, severity, circuitBroken);
    
    // For critical errors, we might want to trigger alerts
    if (severity === ErrorSeverity.CRITICAL) {
      this.triggerAlert(errorMessage, category, context);
    }
    
    // Return handling result
    return {
      handled: true,
      severity,
      category,
      circuitBroken,
      recoverySteps,
      error: {
        message: error.message,
        stack: config.get('DEBUG') ? error.stack : undefined,
        context
      }
    };
  }
  
  /**
   * Checks if circuit breaker should be tripped
   * @param {string} category - Error category
   * @returns {boolean} Whether circuit was broken
   */
  checkCircuitBreaker(category) {
    // Skip if category doesn't have circuit breaker
    if (!this.circuitBreakerThresholds[category]) return false;
    
    // Check if already broken
    if (this.circuitStatus[category].broken) {
      // Check if circuit break time has expired
      if (this.circuitStatus[category].until && Date.now() > this.circuitStatus[category].until) {
        // Reset circuit breaker
        this.circuitStatus[category].broken = false;
        this.circuitStatus[category].until = null;
        this.consecutiveErrors[category] = 0;
        logger.info(`Circuit breaker for ${category} reset after cooling period`);
        return false;
      }
      return true; // Still broken
    }
    
    // Check if we need to trip the breaker
    if (this.consecutiveErrors[category] >= this.circuitBreakerThresholds[category]) {
      // Trip the breaker with exponential backoff based on frequency
      const backoffMinutes = Math.min(
        5 * Math.pow(2, Math.floor(this.consecutiveErrors[category] / this.circuitBreakerThresholds[category])), 
        60 // Cap at 60 minutes
      );
      
      this.circuitStatus[category].broken = true;
      this.circuitStatus[category].until = Date.now() + (backoffMinutes * 60 * 1000);
      
      logger.warn(`Circuit breaker tripped for ${category} for ${backoffMinutes} minutes due to ${this.consecutiveErrors[category]} consecutive errors`);
      return true;
    }
    
    return false;
  }
  
  /**
   * Generates recovery steps based on error category and severity
   * @param {string} category - Error category
   * @param {number} severity - Error severity
   * @param {boolean} circuitBroken - Whether circuit breaker was tripped
   * @returns {Array<string>} Recovery steps
   */
  generateRecoverySteps(category, severity, circuitBroken) {
    const steps = [];
    
    if (circuitBroken) {
      const cooldownMs = this.circuitStatus[category].until - Date.now();
      const cooldownMinutes = Math.ceil(cooldownMs / 60000);
      steps.push(`Wait for circuit breaker cooldown: ${cooldownMinutes} minutes`);
    }
    
    switch (category) {
      case 'api':
        steps.push('Check API endpoint health and rate limits');
        steps.push('Verify API credentials and permissions');
        if (severity >= ErrorSeverity.HIGH) {
          steps.push('Switch to fallback API endpoint if available');
        }
        break;
        
      case 'blockchain':
        steps.push('Verify RPC endpoint connectivity');
        steps.push('Check wallet balance and permissions');
        if (severity >= ErrorSeverity.HIGH) {
          steps.push('Switch to backup RPC provider');
          steps.push('Verify transaction confirmation status');
        }
        break;
        
      case 'trading':
        steps.push('Verify token contract validity');
        steps.push('Check for sufficient liquidity');
        steps.push('Adjust slippage parameters');
        if (severity >= ErrorSeverity.HIGH) {
          steps.push('Pause trading temporarily');
          steps.push('Review trading parameters');
        }
        break;
        
      case 'system':
        steps.push('Check system resources (memory, CPU, disk)');
        if (severity >= ErrorSeverity.HIGH) {
          steps.push('Restart application');
          steps.push('Check for system updates or configuration issues');
        }
        break;
    }
    
    return steps;
  }
  
  /**
   * Resets the consecutive error counter for a category
   * @param {string} category - Error category
   */
  resetErrorCount(category) {
    if (this.consecutiveErrors[category] !== undefined) {
      this.consecutiveErrors[category] = 0;
      
      // Also reset circuit breaker if it was tripped
      if (this.circuitStatus[category]?.broken) {
        this.circuitStatus[category].broken = false;
        this.circuitStatus[category].until = null;
        logger.info(`Circuit breaker for ${category} manually reset`);
      }
    }
  }
  
  /**
   * Checks if a circuit breaker is active for a category
   * @param {string} category - Error category to check
   * @returns {boolean} Whether the circuit is broken
   */
  isCircuitBroken(category) {
    return this.circuitStatus[category]?.broken || false;
  }
  
  /**
   * Trigger an alert for critical errors
   * @param {string} message - Error message
   * @param {string} category - Error category
   * @param {Object} context - Error context
   */
  triggerAlert(message, category, context) {
    // In a production environment, this would send to an alert system
    // Here we just log it prominently
    logger.error(`🚨 ALERT: ${message}`, { category, context });
    
    // TODO: Implement external alerting via webhook, email, etc.
    // if (config.get('ALERT_WEBHOOK')) { ... }
  }
  
  /**
   * Gets error statistics for monitoring
   * @returns {Object} Error statistics
   */
  getErrorStats() {
    return {
      ...this.errorStats,
      circuitStatus: this.circuitStatus,
      consecutiveErrors: this.consecutiveErrors
    };
  }
}

// Export singleton instance
export default new ErrorHandler();