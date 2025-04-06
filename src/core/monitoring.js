console.log('core/monitoring.js', '# Position monitoring');

// src/core/monitoring.js
import logger from '../services/logger.js';
import { sellToken } from './execution.js';
import { getPairInfo } from '../api/dexscreener.js';

/**
 * Active token positions being monitored
 * @type {Map<string, Object>}
 */
const activePositions = new Map();

/**
 * Starts monitoring a token position with optimized exit strategy
 * @param {string} tokenAddress - Token address
 * @param {string} tokenName - Token name
 * @param {number} amount - Token amount
 * @param {Object} tradeParams - Trade parameters
 * @param {Object} connection - Solana connection
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
  
  // Initialize monitoring data
  const monitorData = {
    tokenAddress,
    tokenName,
    amount,
    purchaseTime: startTime,
    purchasePrice: 0,
    highestPrice: 0,
    lowestPrice: Infinity,
    currentPrice: 0,
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
    pricePrChecks: 0, // For prformance monitoring
    priceHistory: [] // For trend analysis
  };
  
  // Set initial price
  updateTokenPrice(monitorData).catch(err => {
    logger.error(`Error getting initial price for ${tokenName}: ${err.message}`);
  });
  
  // Start the monitoring interval
  const intervalId = setInterval(() => monitorPrice(monitorData), 5000); // Check every 5 seconds
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
    
    // If it's first update, set purchase price
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
    if (monitorData.pricePrChecks % 6 === 0) { // Log every ~30 seconds
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
    
    // 1. Check staged exit strategy (take profit levels)
    for (const exitStage of monitorData.exitStages) {
      if (!monitorData.completedStages.has(exitStage.percent) && roi >= exitStage.percent) {
        sellAmount = monitorData.amount * exitStage.sellPortion;
        sellReason = `Take Profit Stage (${exitStage.percent}%)`;
        monitorData.completedStages.add(exitStage.percent);
        break;
      }
    }
    
    // 2. Check trailing stop (if active)
    if (!sellAmount && monitorData.trailingStopActive && 
        monitorData.currentPrice <= monitorData.trailingStopPrice) {
      sellAmount = monitorData.amount;
      sellReason = `Trailing Stop (${monitorData.trailingStopPrice.toFixed(8)} SOL)`;
    }
    
    // 3. Check stop loss
    if (!sellAmount && roi <= monitorData.tradeParams.stopLossPct) {
      sellAmount = monitorData.amount;
      sellReason = `Stop Loss (${monitorData.tradeParams.stopLossPct}%)`;
    }
    
    // 4. Check max hold time
    if (!sellAmount && timeElapsedMinutes >= monitorData.tradeParams.maxHoldTimeMinutes) {
      sellAmount = monitorData.amount;
      sellReason = `Max Hold Time (${monitorData.tradeParams.maxHoldTimeMinutes}min)`;
    }
    
    // 5. Check trend reversal (if in profit and trend reverses sharply)
    if (!sellAmount && roi > 10 && trendAnalysis.trend === 'reversal' && 
        trendAnalysis.strength > 7) {
      sellAmount = monitorData.amount * 0.5; // Sell half on reversal
      sellReason = `Trend Reversal (${trendAnalysis.strength.toFixed(1)}/10)`;
    }
    
    // 6. Check for trailing stop activation (if not already active)
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
          
          // Update monitored amount
          monitorData.amount -= sellAmount;
          
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
   * Gets data for all currently monitored positions
   * @returns {Array} Array of monitored position data
   */
  export function getActivePositions() {
    return Array.from(activePositions.values()).map(position => ({
      tokenAddress: position.tokenAddress,
      tokenName: position.tokenName,
      amount: position.amount,
      purchaseTime: position.purchaseTime,
      purchasePrice: position.purchasePrice,
      currentPrice: position.currentPrice,
      lastUpdate: position.lastPriceCheck,
      roi: position.purchasePrice > 0 
        ? ((position.currentPrice - position.purchasePrice) / position.purchasePrice) * 100 
        : 0,
      highestPrice: position.highestPrice,
      active: position.active,
      trailingStopActive: position.trailingStopActive,
      completedStages: Array.from(position.completedStages)
    }));
  }
  
  /**
   * Gets monitoring data for a specific token
   * @param {string} tokenAddress - Token address
   * @returns {Object|null} Monitoring data or null if not found
   */
  export function getPositionData(tokenAddress) {
    return activePositions.get(tokenAddress) || null;
  }
  
  /**
   * Manually updates trailing stop parameters for a monitored token
   * @param {string} tokenAddress - Token address
   * @param {Object} params - New trailing stop parameters
   * @returns {boolean} Whether update was successful
   */
  export function updateTrailingStop(tokenAddress, params) {
    const monitorData = activePositions.get(tokenAddress);
    
    if (!monitorData) {
      logger.warn(`No active monitoring found for ${tokenAddress}`);
      return false;
    }
    
    // Update parameters
    if (params.active !== undefined) {
      monitorData.trailingStopActive = !!params.active;
    }
    
    if (params.activationPct !== undefined && params.activationPct > 0) {
      monitorData.tradeParams.trailingStopActivationPct = params.activationPct;
    }
    
    if (params.distancePct !== undefined && params.distancePct > 0) {
      monitorData.tradeParams.trailingStopDistancePct = params.distancePct;
      
      // Update trailing stop price if active
      if (monitorData.trailingStopActive && monitorData.highestPrice > 0) {
        monitorData.trailingStopPrice = monitorData.highestPrice * 
          (1 - monitorData.tradeParams.trailingStopDistancePct / 100);
      }
    }
    
    // If manually activating trailing stop
    if (params.active === true && !monitorData.trailingStopActive) {
      monitorData.trailingStopActive = true;
      monitorData.trailingStopPrice = monitorData.currentPrice * 
        (1 - monitorData.tradeParams.trailingStopDistancePct / 100);
      
      logger.debug(
        `Trailing stop manually activated for ${monitorData.tokenName} at ${monitorData.currentPrice.toFixed(8)} SOL, ` +
        `Stop price: ${monitorData.trailingStopPrice.toFixed(8)} SOL`
      );
    }
    
    logger.debug(`Trailing stop updated for ${monitorData.tokenName}`);
    return true;
  }
  
  export default {
    startPositionMonitor,
    stopMonitoring,
    getActivePositions,
    getPositionData,
    updateTrailingStop
  };