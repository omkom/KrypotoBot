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
  