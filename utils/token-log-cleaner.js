#!/usr/bin/env node
/**
 * Token Log Cleaner Utility
 * 
 * A utility script to clean and manage trade log files.
 * Features include log rotation, compression, backups, and analytics.
 * 
 * @author Advanced Coding AI
 * @version 1.0.0
 */

// Import required dependencies
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const chalk = require('chalk');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Configuration
const TRADE_LOG_PATH = process.env.TRADE_LOG_PATH || './logs/trade_logs.json';
const BACKUP_ENABLED = process.env.BACKUP_ENABLED !== 'false';
const VERBOSE = process.env.VERBOSE === 'true';
const DEBUG = process.env.DEBUG === 'true';

/**
 * Logger utility for consistent output
 * @type {Object}
 */
const logger = {
  /**
   * Log an informational message
   * @param {string} message - Message to log
   */
  info: (message) => {
    console.log(chalk.blue('ℹ INFO: ') + message);
  },
  
  /**
   * Log a success message
   * @param {string} message - Message to log
   */
  success: (message) => {
    console.log(chalk.green('✓ SUCCESS: ') + message);
  },
  
  /**
   * Log a warning message
   * @param {string} message - Message to log
   */
  warn: (message) => {
    console.log(chalk.yellow('⚠ WARNING: ') + message);
  },
  
  /**
   * Log an error message
   * @param {string} message - Message to log
   * @param {Error} [error] - Optional error object for stack trace
   */
  error: (message, error) => {
    console.log(chalk.red('✖ ERROR: ') + message);
    if (error && DEBUG) {
      console.log(chalk.red(error.stack));
    }
  },
  
  /**
   * Log a debug message (only when DEBUG is true)
   * @param {string} message - Message to log
   * @param {any} [data] - Optional data to display
   */
  debug: (message, data) => {
    if (DEBUG) {
      console.log(chalk.magenta('🔍 DEBUG: ') + message);
      if (data !== undefined) {
        console.log(chalk.gray(JSON.stringify(data, null, 2)));
      }
    }
  },
  
  /**
   * Log a verbose message (only when VERBOSE is true)
   * @param {string} message - Message to log
   */
  verbose: (message) => {
    if (VERBOSE) {
      console.log(chalk.cyan('🔊 VERBOSE: ') + message);
    }
  }
};

/**
 * Creates a backup of the trade log file
 * @param {string} logPath - Path to the log file
 * @returns {Promise<boolean>} True if backup was successful
 */
async function createBackup(logPath) {
  try {
    // Check if backup is disabled
    if (!BACKUP_ENABLED) {
      logger.verbose('Backup creation skipped (disabled in configuration)');
      return true;
    }
    
    // Check if original file exists
    if (!fs.existsSync(logPath)) {
      logger.warn(`Cannot create backup: File ${logPath} does not exist`);
      return false;
    }
    
    // Create backup directory
    const backupDir = path.join(path.dirname(logPath), 'backups');
    if (!fs.existsSync(backupDir)) {
      logger.verbose(`Creating backup directory: ${backupDir}`);
      fs.mkdirSync(backupDir, { recursive: true });
    }
    
    // Generate timestamp for the backup filename
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/..+/, '');
    const backupPath = path.join(backupDir, `${path.basename(logPath, '.json')}_${timestamp}.json.gz`);
    
    // Read the original file
    logger.debug(`Reading original log file: ${logPath}`);
    const fileContent = fs.readFileSync(logPath);
    
    // Compress the file content
    logger.debug('Compressing log file content');
    const compressed = zlib.gzipSync(fileContent);
    
    // Write the compressed backup
    logger.debug(`Writing compressed backup to: ${backupPath}`);
    fs.writeFileSync(backupPath, compressed);
    
    logger.success(`Backup created successfully: ${backupPath}`);
    return true;
  } catch (error) {
    logger.error('Failed to create backup', error);
    return false;
  }
}

/**
 * Cleans the trade log file by removing old entries
 * @param {string} logPath - Path to the log file
 * @param {number} [maxAgeDays=30] - Maximum age of entries to keep in days
 * @returns {Promise<boolean>} True if cleaning was successful
 */
async function cleanLogs(logPath, maxAgeDays = 30) {
  try {
    // Check if log file exists
    if (!fs.existsSync(logPath)) {
      logger.warn(`Log file ${logPath} does not exist, nothing to clean`);
      return false;
    }
    
    // Create backup before cleaning
    await createBackup(logPath);
    
    // Read and parse the log file
    logger.debug(`Reading log file: ${logPath}`);
    const fileContent = fs.readFileSync(logPath, 'utf8');
    const logs = JSON.parse(fileContent);
    
    logger.verbose(`Found ${logs.length} total log entries`);
    
    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);
    logger.debug(`Cutoff date for log cleaning: ${cutoffDate.toISOString()}`);
    
    // Filter logs to keep only recent entries
    const filteredLogs = logs.filter(log => {
      const logDate = new Date(log.timestamp);
      return logDate >= cutoffDate;
    });
    
    logger.verbose(`Keeping ${filteredLogs.length} entries (removing ${logs.length - filteredLogs.length})`);
    
    // Write filtered logs back to file
    logger.debug(`Writing cleaned logs back to: ${logPath}`);
    fs.writeFileSync(logPath, JSON.stringify(filteredLogs, null, 2), 'utf8');
    
    logger.success(`Log file cleaned successfully (removed ${logs.length - filteredLogs.length} old entries)`);
    return true;
  } catch (error) {
    logger.error('Failed to clean logs', error);
    return false;
  }
}

/**
 * Generate analytics from log data
 * @param {string} logPath - Path to the log file
 * @returns {Promise<Object>} Analytics data
 */
async function generateAnalytics(logPath) {
  try {
    // Check if log file exists
    if (!fs.existsSync(logPath)) {
      logger.warn(`Log file ${logPath} does not exist, cannot generate analytics`);
      return {};
    }
    
    // Read and parse the log file
    logger.debug(`Reading log file for analytics: ${logPath}`);
    const fileContent = fs.readFileSync(logPath, 'utf8');
    const logs = JSON.parse(fileContent);
    
    if (logs.length === 0) {
      logger.warn('No log entries found for analytics');
      return {};
    }
    
    // Initialize analytics object
    const analytics = {
      totalTrades: logs.length,
      successfulTrades: 0,
      failedTrades: 0,
      dryRunTrades: 0,
      totalInvested: 0,
      tokensByRiskScore: {},
      tokensByPotentialScore: {},
      tradesByDate: {},
      topTokens: []
    };
    
    // Process each log entry
    logs.forEach(log => {
      // Count trade types
      if (log.trade.dryRun) {
        analytics.dryRunTrades++;
      } else if (log.trade.success) {
        analytics.successfulTrades++;
      } else {
        analytics.failedTrades++;
      }
      
      // Sum up total investment
      if (log.trade.inputAmount) {
        analytics.totalInvested += parseFloat(log.trade.inputAmount);
      }
      
      // Group by risk score
      const riskScoreKey = Math.floor(log.analysis.riskScore / 10) * 10;
      analytics.tokensByRiskScore[riskScoreKey] = (analytics.tokensByRiskScore[riskScoreKey] || 0) + 1;
      
      // Group by potential score
      const potentialScoreKey = Math.floor(log.analysis.potentialScore / 10) * 10;
      analytics.tokensByPotentialScore[potentialScoreKey] = (analytics.tokensByPotentialScore[potentialScoreKey] || 0) + 1;
      
      // Group by date
      const dateKey = log.timestamp.split('T')[0];
      analytics.tradesByDate[dateKey] = (analytics.tradesByDate[dateKey] || 0) + 1;
    });
    
    // Get top tokens by trade volume
    const tokenMap = {};
    logs.forEach(log => {
      const symbol = log.token.symbol;
      if (!tokenMap[symbol]) {
        tokenMap[symbol] = {
          symbol,
          address: log.token.address,
          trades: 0,
          invested: 0
        };
      }
      
      tokenMap[symbol].trades++;
      if (log.trade.inputAmount) {
        tokenMap[symbol].invested += parseFloat(log.trade.inputAmount);
      }
    });
    
    // Convert to array and sort by trades
    analytics.topTokens = Object.values(tokenMap)
      .sort((a, b) => b.trades - a.trades)
      .slice(0, 10);
    
    logger.success('Analytics generated successfully');
    return analytics;
  } catch (error) {
    logger.error('Failed to generate analytics', error);
    return {};
  }
}

/**
 * Main function to execute the log cleaning and analytics
 */
async function main() {
  logger.info(chalk.bold('📋 Starting Token Log Cleaner Utility'));
  logger.info(`Log path: ${TRADE_LOG_PATH}`);
  logger.info(`Backup enabled: ${BACKUP_ENABLED ? 'Yes' : 'No'}`);
  
  try {
    // Clean old log entries
    await cleanLogs(TRADE_LOG_PATH);
    
    // Generate and display analytics
    const analytics = await generateAnalytics(TRADE_LOG_PATH);
    
    if (Object.keys(analytics).length > 0) {
      logger.info('📊 Trade Analytics Summary:');
      logger.info(`Total trades: ${analytics.totalTrades}`);
      logger.info(`Successful trades: ${analytics.successfulTrades}`);
      logger.info(`Failed trades: ${analytics.failedTrades}`);
      logger.info(`Dry run trades: ${analytics.dryRunTrades}`);
      logger.info(`Total invested: ${analytics.totalInvested.toFixed(4)} SOL`);
      
      if (VERBOSE) {
        logger.verbose('Top 5 traded tokens:');
        analytics.topTokens.slice(0, 5).forEach((token, index) => {
          logger.verbose(`${index + 1}. ${token.symbol}: ${token.trades} trades, ${token.invested.toFixed(4)} SOL invested`);
        });
      }
    }
    
    logger.success('Log cleaning and analytics completed successfully');
  } catch (error) {
    logger.error('An error occurred during execution', error);
    process.exit(1);
  }
}

// Execute if run directly
if (require.main === module) {
  main().catch(error => {
    logger.error('Fatal error in execution', error);
    process.exit(1);
  });
}

// Export functions for external use
module.exports = {
  cleanLogs,
  createBackup,
  generateAnalytics
};