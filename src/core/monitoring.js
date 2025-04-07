/**
 * Position monitoring system with advanced exit strategies
 * 
 * Provides real-time monitoring of token positions with various exit conditions:
 * - Take profit stages
 * - Stop loss protection
 * - Trailing stops with dynamic activation
 * - Time-based exits
 * - Trend reversal detection
 * 
 * @module monitoring
 * @requires ../services/logger
 * @requires ../config/index
 * @requires ../api/dexscreener
 * @requires ./execution
 * @requires ../services/tokenLogs
 * @requires ../services/metrics
 */

import logger from '../services/logger.js';
import config from '../config/index.js';
import { getPairInfo } from '../api/dexscreener.js';
import { sellToken } from './execution.js';
import tokenLogs from '../services/tokenLogs.js';
import metrics from '../services/metrics.js';

// Track active monitoring positions
const activePositions = new Map();

/**
 * Starts monitoring a token position with optimized exit strategy
 * @param {string} tokenAddress - Token address
 * @param {string} tokenName - Token name
 * @param {number} amount - Token amount
 * @param {Object} tradeParams - Trade parameters
 * @param {Connection} connection - Solana connection
 * @param {Object} wallet - Wallet keypair
 * @returns {Object} Monitor information
 */
export function startPositionMonitor(tokenAddress, tokenName, amount, tradeParams, connection, wallet) {
  // Check if already monitoring this token
  if (activePositions.has(tokenAddress)) {
    logger.warn(`Already monitoring ${tokenName} (${tokenAddress})`);
    return activePositions.get(tokenAddress);
  }
  
  const startTime = Date.now();
  logger.debug(`Starting monitoring for ${tokenName} (${tokenAddress})`);
  logger.debug(`Parameters: TP=${tradeParams.takeProfitPct}%, SL=${tradeParams.stopLossPct}%, MaxTime=${tradeParams.maxHoldTimeMinutes}min`);
  
  // Get token data from logs to know purchase price
  const tokenInfo = tokenLogs.getTokenInfo(tokenAddress);
  
  // Initialize monitoring data
  const monitorData = {
    tokenAddress,
    tokenName,
    amount,
    purchaseTime: startTime,
    purchasePrice: tokenInfo?.avgBuyPrice || 0,
    highestPrice: tokenInfo?.avgBuyPrice || 0,
    lowestPrice: tokenInfo?.avgBuyPrice || Infinity,
    currentPrice: tokenInfo?.avgBuyPrice || 0,
    lastPriceCheck: startTime,
    lastPriceChange: startTime,
    exitStages: [...tradeParams.exitStages],
    completedStages: new Set(),
    trailingStopActive: false,
    trailingStopPrice: 0,
    tradeParams,
    intervalId: null,
    connection,
    wallet,
    active: true,
    pricePrChecks: 0, // For performance monitoring
    priceHistory: [] // For trend analysis
  };
  
  // Set initial price
  updateTokenPrice(monitorData).catch(err => {
    logger.error(`Error getting initial price for ${tokenName}: ${err.message}`);
  });
  
  // Start the monitoring interval (check every 10 seconds)
  const intervalId = setInterval(() => monitorPrice(monitorData), 10000);
  monitorData.intervalId = intervalId;
  
  // Store in active positions
  activePositions.set(tokenAddress, monitorData);
  
  logger.debug(`Monitoring started for ${tokenName}`);
  
  return monitorData;
}

/**
 * Updates token price and related information
 * @param {Object} monitorData - Position monitoring data
 * @returns {Promise<number>} Current price
 */
async function updateTokenPrice(monitorData) {
  try {
    monitorData.pricePrChecks++;
    
    // Get pair information from DEXScreener
    const pairInfo = await getPairInfo('solana', monitorData.tokenAddress);
    if (!pairInfo || !pairInfo.priceNative) {
      logger.warn(`Could not get price for ${monitorData.tokenName}`);
      return monitorData.currentPrice;
    }
    
    // Update price data
    const currentPrice = parseFloat(pairInfo.priceNative);
    monitorData.currentPrice = currentPrice;
    
    // If it's first update, set purchase price if not already set
    if (monitorData.purchasePrice === 0) {
      monitorData.purchasePrice = currentPrice;
      monitorData.highestPrice = currentPrice;
      monitorData.lowestPrice = currentPrice;
    }
    
    // Check if price changed significantly (more than 0.5%)
    const priceChangePercent = Math.abs(
      ((currentPrice - monitorData.currentPrice) / monitorData.currentPrice) * 100
    );
    
    if (priceChangePercent > 0.5) {
      monitorData.lastPriceChange = Date.now();
    }
    
    // Update highest/lowest prices
    if (currentPrice > monitorData.highestPrice) {
      monitorData.highestPrice = currentPrice;
      
      // If trailing stop is active, update the stop price
      if (monitorData.trailingStopActive) {
        monitorData.trailingStopPrice = currentPrice * (1 - monitorData.tradeParams.trailingStopDistancePct / 100);
        logger.debug(`${monitorData.tokenName}: Trailing stop updated to ${monitorData.trailingStopPrice.toFixed(8)} SOL`);
      }
    }
    
    if (currentPrice < monitorData.lowestPrice) {
      monitorData.lowestPrice = currentPrice;
    }
    
    // Add to price history for trend analysis (max 20 points)
    monitorData.priceHistory.push({
      price: currentPrice,
      timestamp: Date.now()
    });
    
    if (monitorData.priceHistory.length > 20) {
      monitorData.priceHistory.shift(); // Remove oldest
    }
    
    monitorData.lastPriceCheck = Date.now();
    return currentPrice;
  } catch (error) {
    logger.error(`Error updating price for ${monitorData.tokenName}: ${error.message}`);
    return monitorData.currentPrice;
  }
}

/**
 * Analyzes price trend using recent price history
 * @param {Object} monitorData - Monitor data with price history
 * @returns {Object} Trend analysis
 */
function analyzePriceTrend(monitorData) {
  const history = monitorData.priceHistory;
  if (history.length < 5) return { trend: 'unknown', strength: 0 };
  
  // Calculate trend over different timeframes
  const latestPrice = history[history.length - 1].price;
  const mediumIndex = Math.floor(history.length / 2);
  const mediumPrice = history[mediumIndex].price;
  const oldestPrice = history[0].price;
  
  // Calculate percentage changes
  const recentChange = ((latestPrice - mediumPrice) / mediumPrice) * 100;
  const overallChange = ((latestPrice - oldestPrice) / oldestPrice) * 100;
  
  // Determine trend direction and strength
  let trend = 'neutral';
  let strength = 0;
  
  if (recentChange > 1 && overallChange > 2) {
    trend = 'upward';
    strength = Math.min(10, Math.max(recentChange, overallChange) / 2);
  } else if (recentChange < -1 && overallChange < -2) {
    trend = 'downward';
    strength = Math.min(10, Math.abs(Math.min(recentChange, overallChange)) / 2);
  } else if (Math.abs(recentChange) < 0.5 && Math.abs(overallChange) < 1) {
    trend = 'consolidating';
    strength = 10 - Math.max(Math.abs(recentChange), Math.abs(overallChange)) * 2;
  } else if (recentChange * overallChange < 0) {
    trend = 'reversal';
    strength = Math.min(10, Math.abs(recentChange - overallChange));
  }
  
  return { trend, strength };
}

/**
 * Monitors token price and executes exit strategy when conditions are met
 * @param {Object} monitorData - Position monitoring data
 */
async function monitorPrice(monitorData) {
  try {
    if (!monitorData.active) return;
    
    // Update token price
    await updateTokenPrice(monitorData);
    
    // Calculate current ROI
    const roi = (
      (monitorData.currentPrice - monitorData.purchasePrice) / 
      monitorData.purchasePrice
    ) * 100;
    
    // Calculate time elapsed
    const timeElapsedMs = Date.now() - monitorData.purchaseTime;
    const timeElapsedMinutes = timeElapsedMs / (1000 * 60);
    
    // Get trend analysis
    const trendAnalysis = analyzePriceTrend(monitorData);
    
    // Log monitoring status at reasonable intervals (not every check)
    if (monitorData.pricePrChecks % 6 === 0) { // Log every ~1 minute (6 * 10s)
      logger.debug(
        `${monitorData.tokenName}: ROI=${roi.toFixed(2)}%, ` +
        `Price=${monitorData.currentPrice.toFixed(8)}, ` +
        `Time=${timeElapsedMinutes.toFixed(1)}min, ` +
        `Trend=${trendAnalysis.trend}`
      );
    }
    
    // Check exit conditions
    let sellAmount = 0;
    let sellReason = '';
    
    // 1. Check if trailing stop should be activated
    if (!monitorData.trailingStopActive && 
        roi >= monitorData.tradeParams.trailingStopActivationPct) {
      monitorData.trailingStopActive = true;
      monitorData.trailingStopPrice = monitorData.currentPrice * 
        (1 - monitorData.tradeParams.trailingStopDistancePct / 100);
      
      logger.debug(
        `${monitorData.tokenName}: Trailing stop activated at ${roi.toFixed(2)}%, ` +
        `Stop price: ${monitorData.trailingStopPrice.toFixed(8)} SOL`
      );
    }
    
    // 2. Check trailing stop (if active)
    if (monitorData.trailingStopActive && monitorData.currentPrice <= monitorData.trailingStopPrice) {
      sellAmount = monitorData.amount;
      sellReason = `Trailing Stop (${monitorData.trailingStopPrice.toFixed(8)} SOL)`;
    }
    
    // 3. Check stop loss
    if (!sellAmount && roi <= monitorData.tradeParams.stopLossPct) {
      sellAmount = monitorData.amount;
      sellReason = `Stop Loss (${monitorData.tradeParams.stopLossPct}%)`;
    }
    
    // 4. Check staged exit strategy (take profit levels)
    for (const exitStage of monitorData.exitStages) {
      // Skip if this stage is already completed
      if (monitorData.completedStages.has(exitStage.percent)) continue;
      
      if (roi >= exitStage.percent) {
        sellAmount = monitorData.amount * exitStage.sellPortion;
        sellReason = `Take Profit Stage (${exitStage.percent}%)`;
        monitorData.completedStages.add(exitStage.percent);
        break;
      }
    }
    
    // 5. Check max hold time
    if (!sellAmount && timeElapsedMinutes >= monitorData.tradeParams.maxHoldTimeMinutes) {
      sellAmount = monitorData.amount;
      sellReason = `Max Hold Time (${monitorData.tradeParams.maxHoldTimeMinutes}min)`;
    }
    
    // 6. Check for trend reversal (if in profit and trend reverses sharply)
    if (!sellAmount && roi > 10 && trendAnalysis.trend === 'reversal' && 
        trendAnalysis.strength > 7) {
      sellAmount = monitorData.amount * 0.5; // Sell half on reversal
      sellReason = `Trend Reversal (${trendAnalysis.strength.toFixed(1)}/10)`;
    }
    
    // Execute sale if conditions met
    if (sellAmount > 0) {
      logger.trade(`${sellReason} triggered for ${monitorData.tokenName} at ${roi.toFixed(2)}%`);
      
      // Execute sale
      const saleResult = await sellToken(
        monitorData.tokenAddress,
        monitorData.tokenName,
        sellAmount,
        monitorData.connection,
        monitorData.wallet
      );
      
      if (saleResult.success) {
        logger.trade(
          `Sold ${sellAmount} ${monitorData.tokenName} for ${saleResult.solReceived} SOL ` +
          `(${sellReason})`
        );
        
        // Log the sale
        tokenLogs.logTokenSale(
          monitorData.tokenAddress,
          monitorData.tokenName,
          sellAmount,
          saleResult.solReceived,
          { reason: sellReason, exitStrategy: true },
          config.get('DRY_RUN')
        );
        
        // Update monitored amount
        monitorData.amount -= sellAmount;
        
        // Update metrics
        metrics.recordSale({
          tokenAddress: monitorData.tokenAddress,
          tokenName: monitorData.tokenName,
          amount: sellAmount,
          solReceived: saleResult.solReceived,
          reason: sellReason
        });
        
        // If all sold, stop monitoring
        if (monitorData.amount <= 0) {
          stopMonitoring(monitorData.tokenAddress);
        }
      } else {
        logger.error(`Failed to sell ${monitorData.tokenName}: ${saleResult.error}`);
      }
    }
  } catch (error) {
    logger.error(`Error in price monitoring for ${monitorData.tokenName}: ${error.message}`);
  }
}

/**
 * Stops monitoring a token position
 * @param {string} tokenAddress - Token address to stop monitoring
 * @returns {boolean} Whether monitoring was successfully stopped
 */
export function stopMonitoring(tokenAddress) {
  const monitorData = activePositions.get(tokenAddress);
  
  if (!monitorData) {
    logger.warn(`No active monitoring found for ${tokenAddress}`);
    return false;
  }
  
  // Clear the monitoring interval
  if (monitorData.intervalId) {
    clearInterval(monitorData.intervalId);
  }
  
  // Mark as inactive
  monitorData.active = false;
  
  // Remove from active positions
  activePositions.delete(tokenAddress);
  
  logger.debug(`Monitoring stopped for ${monitorData.tokenName} (${tokenAddress})`);
  return true;
}

/**
 * Get active positions data
 * @returns {Array} All active positions
 */
export function getActivePositions() {
  return Array.from(activePositions.values()).map(position => ({
    id: `${position.tokenAddress}-${position.purchaseTime}`,
    tokenName: position.tokenName,
    tokenAddress: position.tokenAddress,
    amount: position.amount,
    entryPrice: position.purchasePrice,
    entryTime: position.purchaseTime,
    currentPrice: position.currentPrice,
    currentROI: position.purchasePrice > 0 
      ? ((position.currentPrice - position.purchasePrice) / position.purchasePrice) * 100 
      : 0,
    highestPrice: position.highestPrice,
    timeActive: (Date.now() - position.purchaseTime) / (1000 * 60), // minutes
    status: position.active ? 'active' : 'closing',
    trailingStopActive: position.trailingStopActive,
    trailingStopPrice: position.trailingStopPrice,
    completedStages: Array.from(position.completedStages)
  }));
}

/**
 * Updates exit strategy parameters for a monitored token
 * @param {string} tokenAddress - Token address
 * @param {Object} params - New parameters
 * @returns {boolean} Whether update was successful
 */
export function updateExitStrategy(tokenAddress, params) {
  const monitorData = activePositions.get(tokenAddress);
  
  if (!monitorData) {
    logger.warn(`No active monitoring found for ${tokenAddress}`);
    return false;
  }
  
  // Update parameters
  if (params.takeProfitPct !== undefined) {
    monitorData.tradeParams.takeProfitPct = params.takeProfitPct;
  }
  
  if (params.stopLossPct !== undefined) {
    monitorData.tradeParams.stopLossPct = params.stopLossPct;
  }
  
  if (params.trailingStopActivationPct !== undefined) {
    monitorData.tradeParams.trailingStopActivationPct = params.trailingStopActivationPct;
  }
  
  if (params.trailingStopDistancePct !== undefined) {
    monitorData.tradeParams.trailingStopDistancePct = params.trailingStopDistancePct;
    
    // Update trailing stop price if already active
    if (monitorData.trailingStopActive) {
      monitorData.trailingStopPrice = monitorData.highestPrice * 
        (1 - monitorData.tradeParams.trailingStopDistancePct / 100);
      
      logger.debug(`Updated trailing stop price for ${monitorData.tokenName} to ${monitorData.trailingStopPrice.toFixed(8)}`);
    }
  }
  
  if (params.maxHoldTimeMinutes !== undefined) {
    monitorData.tradeParams.maxHoldTimeMinutes = params.maxHoldTimeMinutes;
  }
  
  // Manually activate trailing stop if requested
  if (params.activateTrailingStop === true && !monitorData.trailingStopActive) {
    monitorData.trailingStopActive = true;
    monitorData.trailingStopPrice = monitorData.currentPrice * 
      (1 - monitorData.tradeParams.trailingStopDistancePct / 100);
    
    logger.debug(
      `Manually activated trailing stop for ${monitorData.tokenName} at ${monitorData.currentPrice.toFixed(8)} SOL, ` +
      `Stop price: ${monitorData.trailingStopPrice.toFixed(8)} SOL`
    );
  }
  
  // Update exit stages if provided
  if (params.exitStages && Array.isArray(params.exitStages)) {
    monitorData.exitStages = [...params.exitStages];
    
    // Keep completed stages that still exist in the new configuration
    const newCompletedStages = new Set();
    for (const completedStage of monitorData.completedStages) {
      if (params.exitStages.some(stage => stage.percent === completedStage)) {
        newCompletedStages.add(completedStage);
      }
    }
    monitorData.completedStages = newCompletedStages;
  }
  
  logger.debug(`Updated exit strategy for ${monitorData.tokenName} (${tokenAddress})`);
  return true;
}

/**
 * Gets the status of a specific monitoring position
 * @param {string} tokenAddress - Token address to check
 * @returns {Object|null} Position status or null if not found
 */
export function getPositionStatus(tokenAddress) {
  const monitorData = activePositions.get(tokenAddress);
  if (!monitorData) return null;
  
  // Calculate current ROI
  const roi = monitorData.purchasePrice > 0 
    ? ((monitorData.currentPrice - monitorData.purchasePrice) / monitorData.purchasePrice) * 100 
    : 0;
  
  // Calculate active time
  const timeActiveMin = (Date.now() - monitorData.purchaseTime) / (1000 * 60);
  
  return {
    tokenAddress: monitorData.tokenAddress,
    tokenName: monitorData.tokenName,
    amount: monitorData.amount,
    purchasePrice: monitorData.purchasePrice,
    currentPrice: monitorData.currentPrice,
    highestPrice: monitorData.highestPrice,
    lowestPrice: monitorData.lowestPrice,
    roi: roi,
    timeActive: timeActiveMin,
    lastUpdate: monitorData.lastPriceCheck,
    tradeParams: { ...monitorData.tradeParams },
    exitStages: [...monitorData.exitStages],
    completedStages: Array.from(monitorData.completedStages),
    trailingStop: {
      active: monitorData.trailingStopActive,
      price: monitorData.trailingStopPrice,
      activationPct: monitorData.tradeParams.trailingStopActivationPct,
      distancePct: monitorData.tradeParams.trailingStopDistancePct
    }
  };
}

export default {
  startPositionMonitor,
  stopMonitoring,
  getActivePositions,
  updateExitStrategy,
  getPositionStatus
};