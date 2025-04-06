// src/core/exitStrategyManager.js
import logger from '../services/logger.js';
import config from '../config/index.js';
import { getPairInfo } from '../api/dexscreener.js';

/**
 * Advanced exit strategy manager with dynamic trailing stops,
 * multi-stage take profits, and trend reversal detection
 */
class ExitStrategyManager {
  /**
   * Initialize exit strategy for a token position
   * @param {Object} position - Token position data
   * @param {Object} baseStrategy - Base strategy parameters
   */
  constructor(position, baseStrategy = {}) {
    this.position = position;
    
    // Set up base strategy with defaults
    this.strategy = {
      // Take profit levels (% gain)
      takeProfitLevels: baseStrategy.takeProfitLevels || [25, 50, 100],
      // Take profit amounts (% of position to sell at each level)
      takeProfitAmounts: baseStrategy.takeProfitAmounts || [0.25, 0.5, 0.25],
      // Stop loss level (% loss)
      stopLoss: baseStrategy.stopLoss || -15,
      // Trailing stop settings
      trailingStop: {
        enabled: baseStrategy.trailingStopEnabled !== false,
        activationPercent: baseStrategy.trailingStopActivation || 20,
        trailPercent: baseStrategy.trailingStopTrail || 10,
        active: false,
        price: 0
      },
      // Time-based exit (minutes)
      maxHoldTime: baseStrategy.maxHoldTime || 60,
      // Trend monitoring
      trendMonitoring: {
        enabled: baseStrategy.trendMonitoringEnabled !== false,
        reversalSensitivity: baseStrategy.reversalSensitivity || 3, // 1-5 scale
        inProfitExitOnReversal: baseStrategy.exitOnReversal !== false
      },
      // Completed take profit levels
      completedLevels: new Set(),
      // Execution tracking
      executionHistory: []
    };
    
    // Price tracking
    this.priceHistory = [];
    this.highestPrice = position.entryPrice || 0;
    this.lowestPrice = position.entryPrice || Infinity;
    this.lastPrice = position.entryPrice || 0;
    
    // Initialize
    this.initialize();
  }
  
  /**
   * Initialize strategy with entry price
   */
  initialize() {
    if (this.position.entryPrice) {
      this.highestPrice = this.position.entryPrice;
      this.lowestPrice = this.position.entryPrice;
      this.lastPrice = this.position.entryPrice;
      
      // Initialize trailing stop price
      if (this.strategy.trailingStop.enabled) {
        this.strategy.trailingStop.price = this.position.entryPrice * 
          (1 - (this.strategy.stopLoss / 100));
      }
      
      logger.debug(`Exit strategy initialized for ${this.position.tokenName} with entry price ${this.position.entryPrice}`);
    } else {
      logger.warn(`Unable to initialize exit strategy: missing entry price for ${this.position.tokenName}`);
    }
  }
  
  /**
   * Update current market price and related statistics
   * @param {number} currentPrice - Current token price
   * @returns {Object} Updated price metrics
   */
  updatePrice(currentPrice) {
    if (!currentPrice || currentPrice <= 0) return null;
    
    this.lastPrice = currentPrice;
    
    // Update highest/lowest prices
    if (currentPrice > this.highestPrice) {
      this.highestPrice = currentPrice;
      
      // If trailing stop is active, update stop price
      if (this.strategy.trailingStop.active) {
        this.updateTrailingStop();
      }
    }
    
    if (currentPrice < this.lowestPrice) {
      this.lowestPrice = currentPrice;
    }
    
    // Add to price history (max 50 points)
    this.priceHistory.push({
      price: currentPrice,
      timestamp: Date.now()
    });
    
    if (this.priceHistory.length > 50) {
      this.priceHistory.shift(); // Remove oldest
    }
    
    // Update ROI
    const currentRoi = this.getCurrentRoi();
    
    // Check if trailing stop should be activated
    if (this.strategy.trailingStop.enabled && 
        !this.strategy.trailingStop.active && 
        currentRoi >= this.strategy.trailingStop.activationPercent) {
      this.activateTrailingStop();
    }
    
    return {
      price: currentPrice,
      roi: currentRoi,
      highestPrice: this.highestPrice,
      lowestPrice: this.lowestPrice,
      trailingStopActive: this.strategy.trailingStop.active,
      trailingStopPrice: this.strategy.trailingStop.price
    };
  }
  
  /**
   * Gets current ROI based on entry price
   * @returns {number} Current ROI percentage
   */
  getCurrentRoi() {
    if (!this.position.entryPrice || this.position.entryPrice === 0) return 0;
    
    return ((this.lastPrice - this.position.entryPrice) / this.position.entryPrice) * 100;
  }
  
  /**
   * Activates trailing stop
   */
  activateTrailingStop() {
    this.strategy.trailingStop.active = true;
    this.updateTrailingStop();
    
    logger.debug(
      `Trailing stop activated for ${this.position.tokenName} at ${this.lastPrice} ` +
      `(ROI: ${this.getCurrentRoi().toFixed(2)}%)`
    );
  }
  
  /**
   * Updates trailing stop price based on highest price
   */
  updateTrailingStop() {
    if (!this.strategy.trailingStop.active) return;
    
    const trailAmount = (this.strategy.trailingStop.trailPercent / 100) * this.highestPrice;
    this.strategy.trailingStop.price = this.highestPrice - trailAmount;
    
    logger.debug(
      `Trailing stop updated for ${this.position.tokenName} to ${this.strategy.trailingStop.price} ` +
      `(${this.strategy.trailingStop.trailPercent}% below ${this.highestPrice})`
    );
  }
  
  /**
   * Detects price trend reversal
   * @returns {Object|null} Reversal details if detected, null otherwise
   */
  detectReversal() {
    // Need enough price history for analysis
    if (this.priceHistory.length < 6) return null;
    
    // Get recent price points (last 6 data points)
    const recentPrices = this.priceHistory.slice(-6);
    
    // Calculate short-term trend (last 3 points)
    const shortTermPoints = recentPrices.slice(-3);
    const shortTermStart = shortTermPoints[0].price;
    const shortTermEnd = shortTermPoints[shortTermPoints.length - 1].price;
    const shortTermChange = ((shortTermEnd - shortTermStart) / shortTermStart) * 100;
    
    // Calculate medium-term trend (all 6 points)
    const mediumTermStart = recentPrices[0].price;
    const mediumTermChange = ((shortTermEnd - mediumTermStart) / mediumTermStart) * 100;
    
    // Detect potential reversal (short-term trend opposite of medium-term)
    if (Math.sign(shortTermChange) !== Math.sign(mediumTermChange) && 
        Math.abs(shortTermChange) > 2) {
      
      const sensitivity = this.strategy.trendMonitoring.reversalSensitivity;
      const significanceThreshold = 6 - sensitivity; // Higher sensitivity = lower threshold
      
      // Only report significant reversals
      if (Math.abs(shortTermChange) >= significanceThreshold) {
        return {
          detected: true,
          shortTermChange,
          mediumTermChange,
          severity: Math.min(5, Math.floor(Math.abs(shortTermChange) / 2)), // 1-5 scale
          timestamp: Date.now()
        };
      }
    }
    
    return null;
  }

  /**
   * Checks if any take profit levels have been reached
   * @returns {Object|null} Take profit details if triggered, null otherwise
   */
  checkTakeProfitLevels() {
    const currentRoi = this.getCurrentRoi();
    
    // If not in profit, no take profit to check
    if (currentRoi <= 0) return null;
    
    // Check each take profit level that hasn't been completed
    for (let i = 0; i < this.strategy.takeProfitLevels.length; i++) {
      const level = this.strategy.takeProfitLevels[i];
      
      // Skip completed levels
      if (this.strategy.completedLevels.has(level)) continue;
      
      // Check if this level has been reached
      if (currentRoi >= level) {
        const sellAmount = this.strategy.takeProfitAmounts[i] * this.position.amount;
        
        return {
          triggered: true,
          level,
          roi: currentRoi,
          sellAmount,
          sellPortion: this.strategy.takeProfitAmounts[i],
          reason: `Take Profit Level ${level}% reached (${currentRoi.toFixed(2)}%)`,
          type: 'TAKE_PROFIT'
        };
      }
    }
    
    return null;
  }
  
  /**
   * Checks if stop loss has been triggered
   * @returns {Object|null} Stop loss details if triggered, null otherwise
   */
  checkStopLoss() {
    const currentRoi = this.getCurrentRoi();
    
    // Check if ROI is below stop loss level
    if (currentRoi <= this.strategy.stopLoss) {
      return {
        triggered: true,
        level: this.strategy.stopLoss,
        roi: currentRoi,
        sellAmount: this.position.amount, // Sell entire position
        sellPortion: 1.0,
        reason: `Stop Loss triggered at ${currentRoi.toFixed(2)}% (threshold: ${this.strategy.stopLoss}%)`,
        type: 'STOP_LOSS'
      };
    }
    
    return null;
  }
  
  /**
   * Checks if trailing stop has been triggered
   * @returns {Object|null} Trailing stop details if triggered, null otherwise
   */
  checkTrailingStop() {
    // Only check if trailing stop is active
    if (!this.strategy.trailingStop.active) return null;
    
    // Check if price dropped below trailing stop level
    if (this.lastPrice <= this.strategy.trailingStop.price) {
      const currentRoi = this.getCurrentRoi();
      
      return {
        triggered: true,
        level: this.strategy.trailingStop.price,
        roi: currentRoi,
        sellAmount: this.position.amount, // Sell entire position
        sellPortion: 1.0,
        reason: `Trailing Stop triggered at ${this.lastPrice.toFixed(8)} (${currentRoi.toFixed(2)}%)`,
        type: 'TRAILING_STOP'
      };
    }
    
    return null;
  }
  
  /**
   * Checks if maximum hold time has been reached
   * @returns {Object|null} Time exit details if triggered, null otherwise
   */
  checkTimeExit() {
    if (!this.position.entryTime) return null;
    
    const holdingTimeMs = Date.now() - this.position.entryTime;
    const holdingTimeMinutes = holdingTimeMs / (1000 * 60);
    
    // Check if we've exceeded maximum hold time
    if (holdingTimeMinutes >= this.strategy.maxHoldTime) {
      const currentRoi = this.getCurrentRoi();
      
      return {
        triggered: true,
        holdingTimeMinutes,
        roi: currentRoi,
        sellAmount: this.position.amount, // Sell entire position
        sellPortion: 1.0,
        reason: `Maximum hold time reached: ${holdingTimeMinutes.toFixed(1)} minutes (${this.strategy.maxHoldTime} min limit)`,
        type: 'TIME_EXIT'
      };
    }
    
    return null;
  }
  
  /**
   * Checks if trend reversal warrants an exit
   * @returns {Object|null} Trend exit details if triggered, null otherwise
   */
  checkTrendExit() {
    // Only check if trend monitoring is enabled
    if (!this.strategy.trendMonitoring.enabled) return null;
    
    // Check for reversal
    const reversal = this.detectReversal();
    
    // Only exit on reversal if in profit and reversal is significant
    if (reversal && reversal.detected && 
        this.strategy.trendMonitoring.inProfitExitOnReversal) {
      
      const currentRoi = this.getCurrentRoi();
      
      // Only exit if we're in profit and reversal severity is high enough
      if (currentRoi > 5 && reversal.severity >= 3) {
        // Scale sell amount based on severity and ROI
        const sellPortion = Math.min(0.75, 0.25 * reversal.severity * (currentRoi / 20));
        const sellAmount = this.position.amount * sellPortion;
        
        return {
          triggered: true,
          reversal,
          roi: currentRoi,
          sellAmount,
          sellPortion,
          reason: `Trend reversal detected (severity: ${reversal.severity}/5) while in profit (${currentRoi.toFixed(2)}%)`,
          type: 'TREND_REVERSAL'
        };
      }
    }
    
    return null;
  }
  
  /**
   * Checks all exit conditions and returns the recommended action
   * @returns {Object} Exit recommendation
   */
  checkExitConditions() {
    // Update current price from market if not already updated
    if (this.position.getCurrentPrice) {
      const currentPrice = this.position.getCurrentPrice();
      this.updatePrice(currentPrice);
    }
    
    // Check all exit conditions in priority order
    
    // 1. Check stop loss (highest priority)
    const stopLoss = this.checkStopLoss();
    if (stopLoss) return stopLoss;
    
    // 2. Check trailing stop
    const trailingStop = this.checkTrailingStop();
    if (trailingStop) return trailingStop;
    
    // 3. Check take profit levels
    const takeProfit = this.checkTakeProfitLevels();
    if (takeProfit) return takeProfit;
    
    // 4. Check trend reversal exit
    const trendExit = this.checkTrendExit();
    if (trendExit) return trendExit;
    
    // 5. Check time-based exit (lowest priority)
    const timeExit = this.checkTimeExit();
    if (timeExit) return timeExit;
    
    // No exit condition triggered
    return {
      triggered: false,
      roi: this.getCurrentRoi(),
      holdingTimeMinutes: this.position.entryTime 
        ? (Date.now() - this.position.entryTime) / (1000 * 60) 
        : 0
    };
  }
  
  /**
   * Records execution of an exit strategy
   * @param {Object} exit - Exit details
   * @param {Object} result - Execution result
   * @returns {Object} Recorded exit with execution result
   */
  recordExit(exit, result) {
    // Record in execution history
    this.strategy.executionHistory.push({
      timestamp: Date.now(),
      type: exit.type,
      reason: exit.reason,
      roi: exit.roi,
      sellAmount: exit.sellAmount,
      sellPortion: exit.sellPortion,
      result: {
        success: result.success,
        actualAmount: result.amount || 0,
        solReceived: result.solReceived || 0,
        signature: result.signature || '',
        error: result.error || null
      }
    });
    
    // If take profit, mark level as completed
    if (exit.type === 'TAKE_PROFIT') {
      this.strategy.completedLevels.add(exit.level);
    }
    
    logger.debug(
      `Exit executed for ${this.position.tokenName}: ${exit.type}, ${result.success ? 'SUCCESS' : 'FAILED'}, ` +
      `ROI: ${exit.roi.toFixed(2)}%, Amount: ${exit.sellAmount}`
    );
    
    return {
      ...exit,
      executionResult: result,
      timestamp: Date.now()
    };
  }
  
  /**
   * Adjusts strategy parameters based on market conditions and performance
   * @param {Object} params - New strategy parameters
   * @returns {Object} Updated strategy configuration
   */
  adjustStrategy(params = {}) {
    // Update stop loss
    if (params.stopLoss !== undefined && params.stopLoss < 0) {
      this.strategy.stopLoss = params.stopLoss;
    }
    
    // Update take profit levels
    if (params.takeProfitLevels && Array.isArray(params.takeProfitLevels)) {
      this.strategy.takeProfitLevels = params.takeProfitLevels;
    }
    
    // Update take profit amounts
    if (params.takeProfitAmounts && Array.isArray(params.takeProfitAmounts)) {
      this.strategy.takeProfitAmounts = params.takeProfitAmounts;
    }
    
    // Update trailing stop settings
    if (params.trailingStop) {
      if (params.trailingStop.activationPercent !== undefined) {
        this.strategy.trailingStop.activationPercent = params.trailingStop.activationPercent;
      }
      
      if (params.trailingStop.trailPercent !== undefined) {
        this.strategy.trailingStop.trailPercent = params.trailingStop.trailPercent;
        
        // If already active, update trail price
        if (this.strategy.trailingStop.active) {
          this.updateTrailingStop();
        }
      }
      
      if (params.trailingStop.enabled !== undefined) {
        this.strategy.trailingStop.enabled = params.trailingStop.enabled;
      }
    }
    
    // Update max hold time
    if (params.maxHoldTime !== undefined && params.maxHoldTime > 0) {
      this.strategy.maxHoldTime = params.maxHoldTime;
    }
    
    // Update trend monitoring settings
    if (params.trendMonitoring) {
      if (params.trendMonitoring.enabled !== undefined) {
        this.strategy.trendMonitoring.enabled = params.trendMonitoring.enabled;
      }
      
      if (params.trendMonitoring.reversalSensitivity !== undefined) {
        this.strategy.trendMonitoring.reversalSensitivity = params.trendMonitoring.reversalSensitivity;
      }
      
      if (params.trendMonitoring.inProfitExitOnReversal !== undefined) {
        this.strategy.trendMonitoring.inProfitExitOnReversal = params.trendMonitoring.inProfitExitOnReversal;
      }
    }
    
    logger.debug(`Strategy adjusted for ${this.position.tokenName}`, params);
    
    return { ...this.strategy };
  }
  
  /**
   * Gets current strategy settings and status
   * @returns {Object} Strategy details and current state
   */
  getStrategyStatus() {
    return {
      tokenName: this.position.tokenName,
      tokenAddress: this.position.tokenAddress,
      entryPrice: this.position.entryPrice,
      currentPrice: this.lastPrice,
      highestPrice: this.highestPrice,
      lowestPrice: this.lowestPrice,
      currentRoi: this.getCurrentRoi(),
      trailingStop: {
        enabled: this.strategy.trailingStop.enabled,
        active: this.strategy.trailingStop.active,
        activationPercent: this.strategy.trailingStop.activationPercent,
        trailPercent: this.strategy.trailingStop.trailPercent,
        currentPrice: this.strategy.trailingStop.price
      },
      takeProfitLevels: this.strategy.takeProfitLevels,
      completedLevels: Array.from(this.strategy.completedLevels),
      stopLoss: this.strategy.stopLoss,
      maxHoldTime: this.strategy.maxHoldTime,
      holdingTime: this.position.entryTime 
        ? (Date.now() - this.position.entryTime) / (1000 * 60) 
        : 0,
      executionHistory: this.strategy.executionHistory
    };
  }
}

// Export the class
export default ExitStrategyManager;