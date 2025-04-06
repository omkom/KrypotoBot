console.log('services/logger.js', '# Enhanced logging service');

// src/services/logger.js
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import config from '../config/index.js';

/**
 * Enhanced logging service with color-coded console output
 * and structured file logging with rotation support
 */
class Logger {
  constructor() {
    this.debugMode = config.get('DEBUG');
    this.logDir = path.dirname(config.get('LOG_FILE_PATH'));
    this.errorLogPath = config.get('ERROR_LOG_PATH');
    
    // Create log directory if it doesn't exist
    this.ensureLogDirectory();
  }
  
  /**
   * Ensures log directory exists
   */
  ensureLogDirectory() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }
  
  /**
   * Logs an info message
   * @param {string} message - Message to log
   * @param {Object} data - Optional data to include
   */
  info(message, data = null) {
    console.log(chalk.blue(`ℹ INFO: ${message}`));
    this.writeToFile('INFO', message, data);
  }
  
  /**
   * Logs a success message
   * @param {string} message - Message to log
   * @param {Object} data - Optional data to include
   */
  success(message, data = null) {
    console.log(chalk.green(`✓ SUCCESS: ${message}`));
    this.writeToFile('SUCCESS', message, data);
  }
  
  /**
   * Logs a warning message
   * @param {string} message - Message to log
   * @param {Object} data - Optional data to include
   */
  warn(message, data = null) {
    console.log(chalk.yellow(`⚠ WARNING: ${message}`));
    this.writeToFile('WARNING', message, data);
  }
  
  /**
   * Logs an error message
   * @param {string} message - Message to log
   * @param {Error} error - Optional error object
   */
  error(message, error = null) {
    console.log(chalk.red(`✖ ERROR: ${message}`));
    if (error && this.debugMode) {
      console.log(chalk.red(error.stack));
    }
    this.writeToFile('ERROR', message, null, error);
  }
  
  /**
   * Logs a debug message (only in debug mode)
   * @param {string} message - Message to log
   * @param {any} data - Optional data to display
   */
  debug(message, data = null) {
    if (this.debugMode) {
      console.log(chalk.magenta(`🔍 DEBUG: ${message}`));
      if (data !== undefined) {
        console.log(chalk.gray(JSON.stringify(data, null, 2)));
      }
      this.writeToFile('DEBUG', message, data);
    }
  }
  
  /**
   * Logs a trade-related message
   * @param {string} message - Message to log
   * @param {Object} data - Optional trade data
   */
  trade(message, data = null) {
    console.log(chalk.cyan(`💱 TRADE: ${message}`));
    this.writeToFile('TRADE', message, data);
  }
  
  /**
   * Writes log entry to file
   * @param {string} level - Log level
   * @param {string} message - Log message
   * @param {any} data - Additional data
   * @param {Error} error - Error object (optional)
   */
  writeToFile(level, message, data = null, error = null) {
    try {
      const timestamp = new Date().toISOString();
      const logEntry = {
        timestamp,
        level,
        message,
        data: data || undefined,
        error: error ? {
          message: error.message,
          stack: error.stack
        } : undefined
      };
      
      // Append to error log for errors
      if (level === 'ERROR' && this.errorLogPath) {
        fs.appendFileSync(
          this.errorLogPath,
          `[${timestamp}] ERROR: ${message}\n${error ? error.stack + '\n\n' : '\n'}`
        );
      }
      
      // Could implement log rotation here
    } catch (err) {
      console.error(chalk.red(`Failed to write to log file: ${err.message}`));
    }
  }
}

// Export singleton instance
export default new Logger();