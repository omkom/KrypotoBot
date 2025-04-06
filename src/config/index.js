console.log('config/index.js', '# Main config loader');

// src/config/index.js
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';

/**
 * Configuration management with environment variable loading, 
 * validation, and dynamic reconfiguration support
 */
class Config {
  constructor() {
    this.config = {};
    this.loadEnvironment();
    this.setupDefaults();
  }

  /**
   * Loads environment variables from .env file
   */
  loadEnvironment() {
    dotenv.config();
    console.log(chalk.blue('Environment variables loaded'));
  }

  /**
   * Sets up default configuration with environment variable overrides
   */
  setupDefaults() {
    this.config = {
      // API endpoints
      DEXSCREENER_API: process.env.DEXSCREENER_API_URL || 'https://api.dexscreener.com/latest/dex',
      JUPITER_API_BASE: process.env.JUPITER_API_BASE || 'https://quote-api.jup.ag/v6',
      
      // Trading parameters
      SLIPPAGE: Number(process.env.SLIPPAGE || '2'),
      MAX_SOL_PER_TRADE: Number(process.env.MAX_SOL_PER_TRADE || '0.1'),
      RISK_PERCENTAGE: Number(process.env.RISK_PERCENTAGE || '0.03'),
      
      // Analysis thresholds
      MIN_LIQUIDITY_USD: Number(process.env.MIN_LIQUIDITY_USD || 10000),
      MIN_VOLUME_24H: Number(process.env.MIN_VOLUME_24H || 5000),
      
      // Exit strategies
      TAKE_PROFIT: Number(process.env.TAKE_PROFIT || '25'),
      STOP_LOSS: Number(process.env.STOP_LOSS || '-20'),
      
      // Performance settings
      MAX_RETRIES: Number(process.env.MAX_RETRIES || '3'),
      API_TIMEOUT: Number(process.env.API_TIMEOUT || '10000'),
      PRIORITY_FEE: Number(process.env.PRIORITY_FEE || '1000000'),
      
      // Environment settings
      DRY_RUN: process.env.DRY_RUN === 'true',
      ENV: process.env.ENV || 'production',
      DEBUG: process.env.DEBUG === 'true',
      
      // File paths
      LOG_FILE_PATH: process.env.LOG_FILE_PATH || path.join(process.cwd(), 'logs', 'trade_logs.json'),
      PROFIT_REPORT_PATH: process.env.PROFIT_REPORT_PATH || path.join(process.cwd(), 'logs', 'profit_report.json'),
      ERROR_LOG_PATH: process.env.ERROR_LOG_PATH || path.join(process.cwd(), 'logs', 'error_log.txt'),
      
      // Token blacklist
      BLACKLISTED_TOKENS: (process.env.BLACKLISTED_TOKENS || '').split(',').filter(Boolean),
    };
  }

  /**
   * Gets configuration value
   * @param {string} key - Configuration key to retrieve
   * @param {any} defaultValue - Default value if key not found
   * @returns {any} Configuration value
   */
  get(key, defaultValue = null) {
    return this.config[key] !== undefined ? this.config[key] : defaultValue;
  }
  
  /**
   * Updates configuration value
   * @param {string} key - Configuration key to update
   * @param {any} value - New value
   */
  set(key, value) {
    this.config[key] = value;
    if (this.config.DEBUG) {
      console.log(chalk.yellow(`Configuration updated: ${key} = ${value}`));
    }
  }
  
  /**
   * Returns all configuration as an object
   * @returns {Object} Complete configuration object
   */
  getAll() {
    return {...this.config};
  }
}

// Export singleton instance
export default new Config();