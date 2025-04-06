// src/analyzers/advancedRoiAnalyzer.js
import logger from '../services/logger.js';
import config from '../config/index.js';

/**
 * Advanced token ROI analysis with market manipulation detection
 * @param {Object} token - Token data including market and transaction metrics
 * @returns {Object} Comprehensive ROI analysis with manipulation detection
 */
export function analyzeAdvancedROI(token) {
  // Initialize scoring components
  const scoreComponents = {
    liquidityScore: 0,       // 0-20 points
    volumeScore: 0,          // 0-20 points
    buyPressureScore: 0,     // 0-25 points
    priceActionScore: 0,     // 0-25 points
    momentumScore: 0,        // 0-10 points
    manipulationFlags: []    // List of detected manipulation patterns
  };
  
  // Extract key metrics with safe fallbacks
  const liquidityUsd = token.liquidity?.usd || 0;
  const volume24h = token.volume?.h24 || 0;
  const volumeH1 = token.volume?.h1 || 0;
  const priceChange24h = token.priceChange?.h24 || 0;
  const priceChange1h = token.priceChange?.h1 || 0;
  const priceChange5m = token.priceChange?.m5 || 0;
  const pairCreatedAt = token.pairCreatedAt || Date.now();
  const tokenAge = (Date.now() - pairCreatedAt) / (1000 * 60 * 60 * 24);
  
  // Extract transaction data for buy/sell analysis
  const txns = token.txns || { h1: {}, h24: {}, m5: {} };
  const buys1h = txns.h1?.buys || 0;
  const sells1h = txns.h1?.sells || 0;
  const buys5m = txns.m5?.buys || 0;
  const sells5m = txns.m5?.sells || 0;
  
  // =====================================================
  // 1. LIQUIDITY ANALYSIS - Optimal range 10K-100K USD
  // =====================================================
  if (liquidityUsd >= 10000 && liquidityUsd <= 100000) {
    // Ideal liquidity range - enough for trading but still room for growth
    scoreComponents.liquidityScore = 20;
  } else if (liquidityUsd > 5000 && liquidityUsd < 10000) {
    // Good liquidity but slightly lower
    scoreComponents.liquidityScore = 15;
  } else if (liquidityUsd > 100000 && liquidityUsd <= 250000) {
    // Higher liquidity - established token, less growth potential
    scoreComponents.liquidityScore = 10;
  } else if (liquidityUsd > 250000) {
    // Very high liquidity - established token with limited growth potential
    scoreComponents.liquidityScore = 5;
  } else if (liquidityUsd > 1000 && liquidityUsd <= 5000) {
    // Lower liquidity - higher risk but still tradeable
    scoreComponents.liquidityScore = 5;
  } else if (liquidityUsd <= 1000) {
    // Very low liquidity - extremely high risk
    scoreComponents.liquidityScore = 0;
    scoreComponents.manipulationFlags.push('EXTREMELY_LOW_LIQUIDITY');
  }
  
  // =====================================================
  // 2. VOLUME ANALYSIS - Healthy activity levels
  // =====================================================
  const volumeToLiquidityRatio = liquidityUsd > 0 ? volume24h / liquidityUsd : 0;
  
  if (volumeToLiquidityRatio >= 0.5 && volumeToLiquidityRatio <= 3) {
    // Optimal activity level - high enough for profit opportunities but not suspicious
    scoreComponents.volumeScore = 20;
  } else if (volumeToLiquidityRatio > 3 && volumeToLiquidityRatio <= 5) {
    // High activity - good but approaching suspicious levels
    scoreComponents.volumeScore = 15;
  } else if (volumeToLiquidityRatio > 0.2 && volumeToLiquidityRatio < 0.5) {
    // Moderate activity - some interest but not high
    scoreComponents.volumeScore = 10;
  } else if (volumeToLiquidityRatio > 5) {
    // Excessive volume compared to liquidity - possibly manipulated
    scoreComponents.volumeScore = 0;
    scoreComponents.manipulationFlags.push('EXCESSIVE_VOLUME_RATIO');
  } else if (volume24h > 1000) {
    // Low activity relative to liquidity but not dead
    scoreComponents.volumeScore = 5;
  } else {
    // Very low volume - likely no active trading
    scoreComponents.volumeScore = 0;
  }
  
  // Check for suspicious volume spikes (hourly vs 24h)
  if (volumeH1 > volume24h * 0.4) { // More than 40% of 24h volume in last hour
    scoreComponents.manipulationFlags.push('VOLUME_SPIKE');
  }
  
  // =====================================================
  // 3. BUY PRESSURE ANALYSIS - Market interest indicators
  // =====================================================
  // Calculate buy/sell ratios for different timeframes
  const buySellRatio1h = sells1h > 0 ? buys1h / sells1h : (buys1h > 0 ? 3 : 1);
  const buySellRatio5m = sells5m > 0 ? buys5m / sells5m : (buys5m > 0 ? 3 : 1);
  
  // Very strong buy pressure in last 5 minutes
  if (buySellRatio5m > 3) {
    scoreComponents.buyPressureScore += 15;
  } else if (buySellRatio5m > 2) {
    // Strong buy pressure
    scoreComponents.buyPressureScore += 10;
  } else if (buySellRatio5m > 1.2) {
    // Moderate buy pressure
    scoreComponents.buyPressureScore += 5;
  }
  
  // Sustained hourly buy pressure
  if (buySellRatio1h > 2) {
    scoreComponents.buyPressureScore += 10;
  } else if (buySellRatio1h > 1.2) {
    scoreComponents.buyPressureScore += 5;
  }
  
  // Check for suspicious buying patterns (wash trading)
  if (buySellRatio5m > 10 || buySellRatio1h > 8) {
    scoreComponents.manipulationFlags.push('SUSPICIOUS_BUY_PATTERN');
  }
  
  // Cap at maximum score
  scoreComponents.buyPressureScore = Math.min(25, scoreComponents.buyPressureScore);
  
  // =====================================================
  // 4. PRICE ACTION ANALYSIS - Multi-timeframe momentum
  // =====================================================
  
  // Recent momentum (5 min)
  if (priceChange5m > 10) {
    scoreComponents.priceActionScore += 15;
    // Check for potential pump
    if (priceChange5m > 25) {
      scoreComponents.manipulationFlags.push('EXTREME_SHORT_PUMP');
    }
  } else if (priceChange5m > 5) {
    scoreComponents.priceActionScore += 10;
  } else if (priceChange5m > 2) {
    scoreComponents.priceActionScore += 5;
  }
  
  // Hourly trend
  if (priceChange1h > 15) {
    scoreComponents.priceActionScore += 10;
    // Check for potential pump
    if (priceChange1h > 40) {
      scoreComponents.manipulationFlags.push('EXTREME_HOURLY_PUMP');
    }
  } else if (priceChange1h > 5) {
    scoreComponents.priceActionScore += 5;
  }
  
  // Daily context
  if (priceChange24h > 30) {
    scoreComponents.priceActionScore += 5;
  } else if (priceChange24h < -30) {
    // Large daily loss - could be dump phase
    scoreComponents.priceActionScore -= 5;
    scoreComponents.manipulationFlags.push('POSSIBLE_DUMP_PHASE');
  }
  
  // =====================================================
  // 5. MOMENTUM ANALYSIS - Trend consistency & acceleration
  // =====================================================
  
  // Check trend consistency across timeframes (bullish)
  const isMultiTimeframeUptrend = priceChange5m > 0 && priceChange1h > 0 && priceChange24h > 0;
  
  if (isMultiTimeframeUptrend) {
    // Consistent uptrend across all timeframes - very bullish
    scoreComponents.momentumScore += 5;
  }
  
  // Check for price acceleration (stronger short-term than long-term)
  const isPriceAccelerating = (priceChange5m > priceChange1h / 12) && (priceChange1h > priceChange24h / 24);
  
  if (isPriceAccelerating && isMultiTimeframeUptrend) {
    // Price is accelerating upward - very bullish signal
    scoreComponents.momentumScore += 5;
  }
  
  // =====================================================
  // 6. MARKET MANIPULATION DETECTION - Advanced checks
  // =====================================================
  
  // Check for suspiciously new token with high activity
  if (tokenAge < 1 && volume24h > 10000) {
    scoreComponents.manipulationFlags.push('NEW_HIGH_VOLUME');
  }
  
  // Check for extreme price movements without corresponding volume
  if (Math.abs(priceChange1h) > 20 && volumeH1 < liquidityUsd * 0.05) {
    scoreComponents.manipulationFlags.push('PRICE_VOLUME_MISMATCH');
  }
  
  // =====================================================
  // FINAL SCORE CALCULATION
  // =====================================================
  
  // Base score from components (max theoretical 100)
  const baseScore = (
    scoreComponents.liquidityScore +
    scoreComponents.volumeScore +
    scoreComponents.buyPressureScore +
    scoreComponents.priceActionScore +
    scoreComponents.momentumScore
  );
  
  // Apply manipulation penalty (each flag reduces score)
  const manipulationPenalty = scoreComponents.manipulationFlags.length * 10;
  
  // Calculate final score (ensure it's between 0-100)
  const finalScore = Math.max(0, Math.min(100, baseScore - manipulationPenalty));
  
  // Generate assessment based on score and flags
  let roiAssessment;
  if (finalScore >= 80) {
    roiAssessment = 'Exceptional Potential';
  } else if (finalScore >= 65) {
    roiAssessment = 'Strong Potential';
  } else if (finalScore >= 50) {
    roiAssessment = 'Good Potential';
  } else if (finalScore >= 35) {
    roiAssessment = 'Moderate Potential';
  } else if (finalScore >= 20) {
    roiAssessment = 'Limited Potential';
  } else {
    roiAssessment = 'Poor Potential';
  }
  
  // Log analysis in debug mode
  if (config.get('DEBUG')) {
    logger.debug(`Advanced ROI Analysis for ${token.baseToken?.symbol || 'Unknown'}:`, {
      metrics: {
        liquidityUsd,
        volume24h,
        priceChange5m,
        priceChange1h,
        priceChange24h,
        buySellRatio5m,
        buySellRatio1h,
        tokenAge
      },
      scoreComponents,
      manipulationFlags: scoreComponents.manipulationFlags,
      finalScore,
      assessment: roiAssessment
    });
  }
  
  // Return comprehensive analysis
  return {
    token: {
      address: token.baseToken?.address || '',
      name: token.baseToken?.symbol || 'Unknown',
      price: token.priceUsd || 0,
      age: tokenAge
    },
    scoreComponents,
    manipulationFlags: scoreComponents.manipulationFlags,
    potentialScore: finalScore,
    potentialAssessment: roiAssessment,
    manipulationRisk: scoreComponents.manipulationFlags.length > 2 ? 'High' :
                     scoreComponents.manipulationFlags.length > 0 ? 'Medium' : 'Low',
    tradingRecommendation: finalScore >= 70 ? 'Strong Buy' :
                         finalScore >= 50 ? 'Buy' :
                         finalScore >= 35 ? 'Watch' : 'Avoid',
    timestamp: new Date().toISOString()
  };
}

export default {
  analyzeAdvancedROI
};