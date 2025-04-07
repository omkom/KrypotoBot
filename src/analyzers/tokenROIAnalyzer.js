/**
 * Advanced Token ROI Analyzer with Market Manipulation Detection
 * Provides sophisticated analysis of token potential using multi-factor scoring
 * 
 * @module tokenROIAnalyzer
 * @requires ../services/logger
 * @requires ../config/index
 */

import logger from '../services/logger.js';
import config from '../config/index.js';
import chalk from 'chalk';

/**
 * Analyzes token's potential ROI using weighted scoring algorithm with manipulation detection
 * @param {Object} token - Token data including liquidity, volume, and price metrics
 * @param {Object} options - Optional configuration parameters
 * @returns {Object} Comprehensive analysis with potential score and risk assessment
 */
export function evaluateTokenROI(token, options = {}) {
  try {
    // Initialize scoring components with weighted factors
    const scoreComponents = {
      liquidityScore: 0,    // 0-20 points - Balanced liquidity assessment
      volumeScore: 0,       // 0-20 points - Activity level analysis
      buyPressureScore: 0,  // 0-25 points - Market interest assessment
      priceActionScore: 0,  // 0-25 points - Multi-timeframe momentum
      momentumScore: 0,     // 0-10 points - Trend consistency and acceleration
      manipulationRisk: 0   // Subtracted from total (higher is worse)
    };
    
    // Initialize manipulation flags to track suspicious patterns
    const manipulationFlags = [];
    
    // Extract key metrics with safe fallbacks to prevent runtime errors
    const liquidityUsd = token.liquidity?.usd || 0;
    const volume24h = token.volume?.h24 || 0;
    const volumeH1 = token.volume?.h1 || 0;
    const volumeH6 = token.volume?.h6 || 0;
    const priceChange24h = token.priceChange?.h24 || 0;
    const priceChange1h = token.priceChange?.h1 || 0;
    const priceChange5m = token.priceChange?.m5 || 0;
    const tokenAge = token.pairCreatedAt ? 
      (Date.now() - token.pairCreatedAt) / (1000 * 60 * 60 * 24) : 999;
    
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
      manipulationFlags.push('EXTREMELY_LOW_LIQUIDITY');
      scoreComponents.manipulationRisk += 15; // Severe penalty
    }
    
    // =====================================================
    // 2. VOLUME ANALYSIS - Healthy activity levels
    // =====================================================
    // Calculate volume-to-liquidity ratio (key indicator for activity)
    const volumeToLiquidityRatio = liquidityUsd > 0 ? volume24h / liquidityUsd : 0;
    
    // Score based on volume/liquidity ratio - ideal is 0.5-3x liquidity
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
      scoreComponents.volumeScore = 5;
      manipulationFlags.push('EXCESSIVE_VOLUME_RATIO');
      scoreComponents.manipulationRisk += 10;
    } else if (volume24h > 1000) {
      // Low activity relative to liquidity but not dead
      scoreComponents.volumeScore = 5;
    }
    
    // Check for suspicious volume spikes (hourly vs 24h)
    const hourlyVolumeRatio = volumeH1 > 0 && volume24h > 0 ? (volumeH1 / volume24h) * 24 : 0;
    if (hourlyVolumeRatio > 3) {
      // Recent volume spike - more than 3x the average hourly volume
      manipulationFlags.push('VOLUME_SPIKE');
      scoreComponents.manipulationRisk += 5;
    }
    
    // =====================================================
    // 3. BUY PRESSURE ANALYSIS - Market interest indicators
    // =====================================================
    // Calculate buy/sell ratios for different timeframes
    const buySellRatio1h = sells1h > 0 ? buys1h / sells1h : (buys1h > 0 ? 3 : 1);
    const buySellRatio5m = sells5m > 0 ? buys5m / sells5m : (buys5m > 0 ? 3 : 1);
    
    // Analyze recent buy pressure (5 minutes)
    if (buySellRatio5m > 3) {
      // Very strong recent buy pressure
      scoreComponents.buyPressureScore += 15;
    } else if (buySellRatio5m > 2) {
      // Strong recent buy pressure
      scoreComponents.buyPressureScore += 10;
    } else if (buySellRatio5m > 1.2) {
      // Moderate recent buy pressure
      scoreComponents.buyPressureScore += 5;
    }
    
    // Add sustained buy pressure over 1 hour
    if (buySellRatio1h > 2) {
      // Strong sustained buy pressure
      scoreComponents.buyPressureScore += 10;
    } else if (buySellRatio1h > 1.2) {
      // Moderate sustained buy pressure
      scoreComponents.buyPressureScore += 5;
    }
    
    // Check for suspicious buy pattern (possibly wash trading)
    if (buySellRatio5m > 10 || buySellRatio1h > 8) {
      // Extremely one-sided trading pattern
      manipulationFlags.push('SUSPICIOUS_BUY_PATTERN');
      scoreComponents.manipulationRisk += 15;
    }
    
    // Cap at maximum score
    scoreComponents.buyPressureScore = Math.min(25, scoreComponents.buyPressureScore);
    
    // =====================================================
    // 4. PRICE ACTION ANALYSIS - Multi-timeframe momentum
    // =====================================================
    // Recent momentum (5 min)
    if (priceChange5m > 8) {
      // Strong positive recent momentum
      scoreComponents.priceActionScore += 15;
      // But extreme gains might indicate pump & dump
      if (priceChange5m > 20) {
        manipulationFlags.push('EXTREME_SHORT_PUMP');
        scoreComponents.manipulationRisk += 10;
      }
    } else if (priceChange5m > 3) {
      // Moderate positive recent momentum
      scoreComponents.priceActionScore += 10;
    } else if (priceChange5m > 1) {
      // Slight positive recent momentum
      scoreComponents.priceActionScore += 5;
    }
    
    // Medium-term momentum (1 hour)
    if (priceChange1h > 15) {
      // Strong hourly uptrend
      scoreComponents.priceActionScore += 10;
      // But extreme gains might indicate pump & dump
      if (priceChange1h > 40) {
        manipulationFlags.push('EXTREME_HOURLY_PUMP');
        scoreComponents.manipulationRisk += 5;
      }
    } else if (priceChange1h > 5) {
      // Moderate hourly uptrend
      scoreComponents.priceActionScore += 5;
    }
    
    // Longer-term context (24 hours)
    if (priceChange24h > 30) {
      // Strong daily uptrend
      scoreComponents.priceActionScore += 5;
    } else if (priceChange24h < -30) {
      // Strong daily downtrend - recovery opportunity or dying token?
      scoreComponents.priceActionScore -= 5;
      manipulationFlags.push('POSSIBLE_DUMP_PHASE');
    }
    
    // Cap at maximum score
    scoreComponents.priceActionScore = Math.min(25, Math.max(0, scoreComponents.priceActionScore));
    
    // =====================================================
    // 5. MOMENTUM ANALYSIS - Trend consistency & acceleration
    // =====================================================
    // Check trend consistency across timeframes
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
    // 6. TOKEN AGE & LIFECYCLE ANALYSIS
    // =====================================================
    // Analyze token age as risk factor
    if (tokenAge < 1) {
      // Less than 1 day old - extremely high risk but potentially high reward
      scoreComponents.manipulationRisk += 10;
      manipulationFlags.push('EXTREMELY_NEW_TOKEN');
    } else if (tokenAge < 3) {
      // Less than 3 days old - high risk
      scoreComponents.manipulationRisk += 5;
    }
    
    // Check for suspicious new token with high volume
    if (tokenAge < 1 && volume24h > 10000) {
      manipulationFlags.push('NEW_HIGH_VOLUME');
      scoreComponents.manipulationRisk += 8;
    }
    
    // =====================================================
    // 7. ADVANCED MANIPULATION DETECTION
    // =====================================================
    // Check for suspicious volume spikes compared to history
    if (volumeH1 > volumeH6 * 0.5 && volumeH6 > 0) {
      // Recent volume spike - possible pump scheme
      scoreComponents.manipulationRisk += 8;
    }
    
    // Check for extreme price movements without corresponding volume
    if (Math.abs(priceChange1h) > 30 && volume24h < liquidityUsd * 0.1) {
      // Large price move with low volume - possibly manipulated
      manipulationFlags.push('PRICE_VOLUME_MISMATCH');
      scoreComponents.manipulationRisk += 12;
    }
    
    // =====================================================
    // 8. FINAL SCORE CALCULATION
    // =====================================================
    // Calculate raw total (max theoretical 100)
    const rawTotal = (
      scoreComponents.liquidityScore +
      scoreComponents.volumeScore +
      scoreComponents.buyPressureScore +
      scoreComponents.priceActionScore +
      scoreComponents.momentumScore
    );
    
    // Apply manipulation penalty (cap to avoid negative scores)
    const manipulationPenalty = Math.min(scoreComponents.manipulationRisk, rawTotal * 0.8);
    const finalScore = Math.max(0, Math.min(100, rawTotal - manipulationPenalty));
    
    // Generate assessment based on score
    let potentialAssessment;
    if (finalScore >= 80) {
      potentialAssessment = 'Exceptional Potential';
    } else if (finalScore >= 65) {
      potentialAssessment = 'Strong Potential';
    } else if (finalScore >= 50) {
      potentialAssessment = 'Moderate Potential';
    } else if (finalScore >= 35) {
      potentialAssessment = 'Limited Potential';
    } else if (finalScore >= 20) {
      potentialAssessment = 'Low Potential';
    } else {
      potentialAssessment = 'Very Low Potential';
    }
    
    // Log analysis if in debug mode
    if (config.get('DEBUG')) {
      const tokenSymbol = token.baseToken?.symbol || 'Unknown';
      logger.debug(`ROI Analysis for ${tokenSymbol}:`, {
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
        manipulationFlags,
        finalScore
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
      potentialScore: finalScore,
      scoreComponents,
      manipulationFlags,
      potentialAssessment,
      manipulationRisk: manipulationFlags.length > 2 ? 'High' : 
                       manipulationFlags.length > 0 ? 'Medium' : 'Low',
      tradingRecommendation: finalScore >= 70 ? 'Strong Buy' :
                           finalScore >= 50 ? 'Buy' :
                           finalScore >= 35 ? 'Watch' : 'Avoid',
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    // Handle unexpected errors gracefully
    logger.error(`Error analyzing ROI for token: ${error.message}`);
    if (config.get('DEBUG')) {
      logger.debug(`Analysis error stack: ${error.stack}`);
    }
    
    // Return safe fallback response
    return {
      token: {
        address: token.baseToken?.address || '',
        name: token.baseToken?.symbol || 'Unknown',
        price: token.priceUsd || 0,
        age: 0
      },
      potentialScore: 0,
      manipulationFlags: ['ANALYSIS_ERROR'],
      potentialAssessment: 'Analysis Failed',
      manipulationRisk: 'High',
      tradingRecommendation: 'Avoid',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Quick ROI assessment for high-performance screening of many tokens
 * Simplified version of full analysis for rapid filtering
 * @param {Object} token - Token market data
 * @returns {Object} Basic assessment with score and recommendation
 */
export function quickROIAssessment(token) {
  try {
    // Extract essential metrics with safe fallbacks
    const liquidityUsd = token.liquidity?.usd || 0;
    const volume24h = token.volume?.h24 || 0;
    const priceChange1h = token.priceChange?.h1 || 0;
    
    // Quick scoring - prioritize liquidity and recent price action
    let score = 0;
    
    // Liquidity check (0-40 points)
    if (liquidityUsd >= 10000 && liquidityUsd <= 200000) {
      score += 40;
    } else if (liquidityUsd > 5000) {
      score += 25;
    } else if (liquidityUsd > 1000) {
      score += 10;
    }
    
    // Volume check (0-30 points)
    const volumeToLiquidityRatio = liquidityUsd > 0 ? volume24h / liquidityUsd : 0;
    if (volumeToLiquidityRatio >= 0.3 && volumeToLiquidityRatio <= 5) {
      score += 30;
    } else if (volumeToLiquidityRatio > 0 && volumeToLiquidityRatio <= 10) {
      score += 15;
    }
    
    // Recent momentum (0-30 points)
    if (priceChange1h >= 5 && priceChange1h <= 50) {
      score += 30;
    } else if (priceChange1h > 0) {
      score += 15;
    }
    
    // Apply quick manipulation check penalty
    if (liquidityUsd < 1000 || priceChange1h > 100) {
      score = Math.max(0, score - 40);
    }
    
    return {
      address: token.baseToken?.address || '',
      name: token.baseToken?.symbol || 'Unknown',
      quickScore: score,
      recommendation: score >= 70 ? 'Analyze' : 'Skip'
    };
  } catch (error) {
    return {
      address: token.baseToken?.address || '',
      name: token.baseToken?.symbol || 'Unknown',
      quickScore: 0,
      recommendation: 'Skip',
      error: error.message
    };
  }
}

export default {
  evaluateTokenROI,
  quickROIAssessment
};