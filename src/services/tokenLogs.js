/**
 * Token Logs Service - Manages persistent storage of trading activity
 * 
 * Provides atomic file operations, error recovery, and consistent data structure
 * for tracking token purchases, sales, and overall performance metrics
 */

import fs from 'fs';
import path from 'path';
import logger from './logger.js';
import config from '../config/index.js';
import errorHandler, { ErrorSeverity } from './errorHandler.js';

// Default log path from configuration
const DEFAULT_LOG_PATH = config.get('LOG_FILE_PATH') || './logs/trade_logs.json';

/**
 * Reads token logs from JSON file with robust error handling and recovery
 * @param {string} logFilePath Path to the log file (optional)
 * @returns {Object} Object with tokens indexed by address
 */
function readTokenLogs(logFilePath = DEFAULT_LOG_PATH) {
  try {
    // Check if file exists
    if (!fs.existsSync(logFilePath)) {
      logger.info(`Creating new log file: ${logFilePath}`);
      
      // Create parent directory if needed
      const dirPath = path.dirname(logFilePath);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      
      // Initialize with empty structure
      const initialData = {
        lastUpdate: new Date().toISOString(),
        tokens: {},
        stats: {
          totalInvested: 0,
          totalReturned: 0,
          successfulTrades: 0,
          failedTrades: 0,
          startDate: new Date().toISOString()
        }
      };
      
      fs.writeFileSync(logFilePath, JSON.stringify(initialData, null, 2));
      return initialData;
    }
    
    // Read existing file
    const data = fs.readFileSync(logFilePath, 'utf8');
    const parsedData = JSON.parse(data);
    
    // Ensure consistent structure
    if (!parsedData.stats) {
      parsedData.stats = {
        totalInvested: 0,
        totalReturned: 0,
        successfulTrades: 0,
        failedTrades: 0,
        startDate: parsedData.lastUpdate || new Date().toISOString()
      };
    }

    if (!parsedData.tokens) {
      parsedData.tokens = {};
    }
    
    return parsedData;
  } catch (error) {
    logger.error(`Error reading JSON file (${logFilePath}):`, error);
    
    // Create backup of corrupted file
    if (fs.existsSync(logFilePath)) {
      const backupPath = `${logFilePath}.backup.${Date.now()}`;
      try {
        fs.copyFileSync(logFilePath, backupPath);
        logger.warn(`Corrupted log file. Backup created: ${backupPath}`);
      } catch (backupError) {
        logger.error(`Unable to create backup:`, backupError);
      }
    }
    
    // Return empty structure as fallback
    return {
      lastUpdate: new Date().toISOString(),
      tokens: {},
      stats: {
        totalInvested: 0,
        totalReturned: 0,
        successfulTrades: 0,
        failedTrades: 0,
        startDate: new Date().toISOString()
      }
    };
  }
}

/**
 * Writes token logs to JSON file with atomic write operation
 * @param {Object} tokenData Token data to write
 * @param {string} logFilePath Path to the log file (optional)
 * @returns {boolean} Success status
 */
function writeTokenLogs(tokenData, logFilePath = DEFAULT_LOG_PATH) {
  try {
    // Update timestamp
    tokenData.lastUpdate = new Date().toISOString();
    
    // Create directory if it doesn't exist
    const dirPath = path.dirname(logFilePath);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    
    // Write to temporary file first (atomic write)
    const tempPath = `${logFilePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(tokenData, null, 2));
    
    // Rename for atomic replace
    fs.renameSync(tempPath, logFilePath);
    return true;
  } catch (error) {
    errorHandler.handleError(
      error,
      'system',
      ErrorSeverity.HIGH,
      { operation: 'writeTokenLogs', path: logFilePath }
    );
    
    // Try writing to alternative location if main write fails
    try {
      const altPath = './trade_logs_backup.json';
      fs.writeFileSync(altPath, JSON.stringify(tokenData, null, 2));
      logger.warn(`Logs written to alternative location: ${altPath}`);
      return true;
    } catch (altError) {
      logger.error('Failed to write logs to alternative location:', altError);
      return false;
    }
  }
}

/**
 * Records a token purchase in the log with detailed metrics
 * @param {string} tokenAddress Token address
 * @param {string} tokenName Token name/symbol
 * @param {number} amount Amount of tokens acquired
 * @param {number} priceSol Price paid in SOL
 * @param {number} tokensBought Tokens bought
 * @param {Object} metadata Additional metadata
 * @returns {boolean} Success status
 */
function logTokenPurchase(tokenAddress, tokenName, amount, priceSol, tokensBought, metadata = {}) {
  if (!tokenAddress) {
    logger.error('Missing parameters for logTokenPurchase');
    return false;
  }

  try {
    const timestamp = new Date().toISOString();
    const pricePerToken = tokensBought > 0 ? priceSol / tokensBought : 0;
    
    // Read existing data
    const tokenData = readTokenLogs();
    
    // Update or create entry for this token
    if (!tokenData.tokens[tokenAddress]) {
      // New entry
      tokenData.tokens[tokenAddress] = {
        tokenAddress,
        tokenName,
        initialAmount: amount,
        currentAmount: amount,
        initialInvestment: priceSol,
        totalSold: 0,
        totalReceived: 0,
        avgBuyPrice: pricePerToken,
        avgSellPrice: 0,
        firstPurchaseTime: timestamp,
        lastUpdateTime: timestamp,
        transactions: [
          {
            type: "BUY",
            amount: tokensBought,
            priceSOL: priceSol,
            pricePerToken,
            timestamp,
            metadata: Object.keys(metadata).length > 0 ? metadata : undefined
          }
        ]
      };
      
      // Update global stats
      if (tokenData.stats) {
        tokenData.stats.totalInvested += priceSol;
      }
    } else {
      // Update existing entry
      const token = tokenData.tokens[tokenAddress];
      
      token.initialAmount = Number(token.initialAmount || 0) + amount;
      token.currentAmount = Number(token.currentAmount || 0) + amount;
      token.initialInvestment = Number(token.initialInvestment || 0) + priceSol;
      
      // Update weighted average buy price
      if (token.initialAmount > 0) {
        token.avgBuyPrice = token.initialInvestment / token.initialAmount;
      }
      
      token.lastUpdateTime = timestamp;
      
      // Add transaction
      token.transactions.push({
        type: "BUY",
        amount: tokensBought,
        priceSOL: priceSol,
        pricePerToken,
        timestamp,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined
      });
      
      // Update global stats
      if (tokenData.stats) {
        tokenData.stats.totalInvested += priceSol;
      }
    }
    
    // Write updated data
    return writeTokenLogs(tokenData);
  } catch (error) {
    logger.error('Error recording purchase:', error);
    errorHandler.handleError(
      error, 
      'trading', 
      ErrorSeverity.MEDIUM, 
      { operation: 'logTokenPurchase', tokenAddress, tokenName }
    );
    return false;
  }
}

/**
 * Records a token sale with detailed ROI calculation
 * @param {string} tokenAddress Token address
 * @param {string} tokenName Token name/symbol
 * @param {number} amount Amount sold
 * @param {number} solReceived SOL received from sale
 * @param {Object} metadata Additional metadata
 * @param {boolean} isDryRun Indicates if this is a simulation
 * @returns {Object} Sale information and ROI
 */
function logTokenSale(tokenAddress, tokenName, amount, solReceived, metadata = {}, isDryRun = false) {
  if (!tokenAddress) {
    logger.error('Missing parameters for logTokenSale');
    return {
      success: false,
      error: "MISSING_PARAMETERS",
      roi: 0
    };
  }

  try {
    const timestamp = new Date().toISOString();
    
    // Read existing data
    const tokenData = readTokenLogs();
    
    // Check if token exists in logs
    if (!tokenData.tokens[tokenAddress]) {
      logger.error(`Token ${tokenAddress} not found in logs`);
      return {
        success: false,
        error: "TOKEN_NOT_FOUND",
        roi: 0
      };
    }
    
    const token = tokenData.tokens[tokenAddress];
    
    // Ensure we have enough tokens to sell
    if (Number(token.currentAmount) < amount) {
      logger.warn(`Warning: Trying to sell ${amount} tokens but only ${token.currentAmount} available`);
      amount = Number(token.currentAmount);
    }
    
    // Calculate price per token for this sale
    const salePerToken = amount > 0 ? solReceived / amount : 0;
    
    // Calculate ROI for this specific sale
    let avgBuyPrice = Number(token.avgBuyPrice) || 0;
    
    // Calculate ROI
    const roi = avgBuyPrice > 0 ? ((salePerToken - avgBuyPrice) / avgBuyPrice) * 100 : 0;
    
    // Update token metrics
    token.currentAmount = Number(token.currentAmount) - amount;
    token.totalSold = Number(token.totalSold || 0) + amount;
    token.totalReceived = Number(token.totalReceived || 0) + solReceived;
    
    // Update average sale price
    if (token.totalSold > 0) {
      token.avgSellPrice = token.totalReceived / token.totalSold;
    }
    
    token.lastUpdateTime = timestamp;
    
    // Add transaction
    token.transactions.push({
      type: "SELL",
      amount,
      priceSOL: solReceived,
      pricePerToken: salePerToken,
      timestamp,
      roi,
      isDryRun,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined
    });
    
    // Update global stats
    if (tokenData.stats) {
      tokenData.stats.totalReturned += solReceived;
      tokenData.stats.successfulTrades++;
    }
    
    // Write updated data
    writeTokenLogs(tokenData);
    
    // Return sale information
    return {
      success: true,
      tokenAddress,
      tokenName,
      amount,
      solReceived,
      salePerToken,
      avgBuyPrice,
      roi,
      remainingAmount: token.currentAmount,
      isDryRun
    };
  } catch (error) {
    logger.error('Error recording sale:', error);
    errorHandler.handleError(
      error, 
      'trading', 
      ErrorSeverity.MEDIUM, 
      { operation: 'logTokenSale', tokenAddress, tokenName }
    );
    return {
      success: false,
      error: error.message,
      roi: 0,
      isDryRun
    };
  }
}

/**
 * Gets token information from logs
 * @param {string} tokenAddress Token address to look up
 * @returns {Object|null} Token information or null if not found
 */
function getTokenInfo(tokenAddress) {
  try {
    const tokenData = readTokenLogs();
    return tokenData.tokens[tokenAddress] || null;
  } catch (error) {
    logger.error(`Error getting token info for ${tokenAddress}:`, error);
    return null;
  }
}

/**
 * Gets global trading statistics
 * @returns {Object} Trading statistics
 */
function getTradingStats() {
  try {
    const tokenData = readTokenLogs();
    
    // Calculate additional metrics
    const stats = { ...tokenData.stats };
    
    // Calculate profit/loss
    stats.netProfit = stats.totalReturned - stats.totalInvested;
    stats.profitPercentage = stats.totalInvested > 0 
      ? (stats.netProfit / stats.totalInvested) * 100
      : 0;
    
    // Calculate active positions
    const activePositions = Object.values(tokenData.tokens)
      .filter(token => token.currentAmount > 0)
      .length;
    
    stats.activePositions = activePositions;
    stats.completedTrades = stats.successfulTrades;
    
    return stats;
  } catch (error) {
    logger.error('Error getting trading stats:', error);
    return {
      totalInvested: 0,
      totalReturned: 0,
      successfulTrades: 0,
      failedTrades: 0,
      netProfit: 0,
      profitPercentage: 0,
      activePositions: 0,
      completedTrades: 0
    };
  }
}

export default {
  readTokenLogs,
  writeTokenLogs,
  logTokenPurchase,
  logTokenSale,
  getTokenInfo,
  getTradingStats
};