console.log('analyzers/roiAnalyzer.js', '# Optimized ROI analysis');

// This module analyzes the potential ROI of tokens based on various metrics
// src/analyzers/roiAnalyzer.js
import logger from '../services/logger.js';
import config from '../config/index.js';

/**
 * Evaluates a token's potential ROI with enhanced precision
 * Uses multi-factor scoring with dynamic weights and momentum analysis
 * @param {Object} token - Token data including liquidity, volume, and price metrics
 * @returns {Object} Detailed analysis with score, evaluation factors, and recommendation
 */
export function evaluateTokenROI(token) {
  // Initialize scoring components with empty values
  const scoreComponents = {
    liquidityScore: 0,    // 0-20 points
    volumeScore: 0,       // 0-20 points
    buyPressureScore: 0,  // 0-25 points
    priceActionScore: 0,  // 0-25 points
    momentumScore: 0,     // 0-10 points
    manipulationRisk: 0   // 0-20 points (higher is worse, subtracted from total)
  };
  
  // Extract key metrics with safe fallbacks
  const liquidityUsd = token.liquidity?.usd || 0;
  const volume24h = token.volume?.h24 || 0;
  const priceChange24h = token.priceChange?.h24 || 0;
  const priceChange1h = token.priceChange?.h1 || 0;
  const priceChange5m = token.priceChange?.m5 || 0;
  const tokenAge = token.pairCreatedAt ? 
    (Date.now() - token.pairCreatedAt) / (1000 * 60 * 60 * 24) : 999;
  
  // Extract transaction data with safe fallbacks
  const txns = token.txns || { h1: {}, h24: {}, m5: {} };
  const buys1h = txns.h1?.buys || 0;
  const sells1h = txns.h1?.sells || 0;
  const buys5m = txns.m5?.buys || 0;
  const sells5m = txns.m5?.sells || 0;
  
  // =====================================================
  // 1. LIQUIDITY ANALYSIS - Optimal range 10K-100K USD
  // =====================================================
  if (liquidityUsd >= 10000 && liquidityUsd <= 100000) {
    // Ideal liquidity range - not too small (risky), not too large (limited growth)
    scoreComponents.liquidityScore = 20;
  } else if (liquidityUsd > 5000 && liquidityUsd < 10000) {
    // Good liquidity but slightly lower
    scoreComponents.liquidityScore = 15;
  } else if (liquidityUsd > 100000 && liquidityUsd <= 250000) {
    // Higher liquidity - established token, less growth potential
    scoreComponents.liquidityScore = 10;
  } else if (liquidityUsd > 250000 || (liquidityUsd > 1000 && liquidityUsd <= 5000)) {
    // Very high liquidity or very low but not negligible
    scoreComponents.liquidityScore = 5;
  }
  
  // =====================================================
  // 2. VOLUME ANALYSIS - Looking for healthy activity levels
  // =====================================================
  // Calculate volume-to-liquidity ratio (key indicator for activity)
  const volumeToLiquidityRatio = liquidityUsd > 0 ? volume24h / liquidityUsd : 0;
  
  // Score based on volume/liquidity ratio - ideal is 0.5-3x liquidity
  if (volumeToLiquidityRatio >= 0.5 && volumeToLiquidityRatio <= 3) {
    // Optimal activity - high enough for profit opportunities but not suspicious
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
    // Add manipulation risk factor
    scoreComponents.manipulationRisk += 10;
  } else if (volume24h > 1000) {
    // Low activity relative to liquidity but not dead
    scoreComponents.volumeScore = 5;
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
    // Extremely one-sided trades are suspicious
    scoreComponents.manipulationRisk += 15;
  }
  
  // Cap at maximum score
  scoreComponents.buyPressureScore = Math.min(25, scoreComponents.buyPressureScore);
  
  // =====================================================
  // 4. PRICE ACTION ANALYSIS - Multi-timeframe momentum
  // =====================================================
  // Recent price momentum (5 minutes)
  if (priceChange5m > 8) {
    // Strong positive recent momentum
    scoreComponents.priceActionScore += 15;
    // But extreme gains might indicate pump & dump
    if (priceChange5m > 20) scoreComponents.manipulationRisk += 10;
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
    if (priceChange1h > 40) scoreComponents.manipulationRisk += 5;
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
  // New tokens have higher growth potential
  if (tokenAge < 1) {
    // Less than 1 day old - highest potential
    scoreComponents.momentumScore += 5;
    // But also higher risk of being a scam
    scoreComponents.manipulationRisk += 5;
  } else if (tokenAge < 7) {
    // Less than 1 week old - still high potential
    scoreComponents.momentumScore += 3;
  }
  
  // =====================================================
  // 7. MANIPULATION DETECTION - Final checks
  // =====================================================
  // Check for suspicious volume spikes compared to history
  const volumeH1 = token.volume?.h1 || 0;
  const volumeH6 = token.volume?.h6 || 0;
  
  if (volumeH1 > volumeH6 * 2) {
    // Recent volume spike - possible pump scheme
    scoreComponents.manipulationRisk += 8;
  }
  
  // Check for extreme price movements without corresponding volume
  if (Math.abs(priceChange1h) > 30 && volume24h < liquidityUsd * 0.1) {
    // Large price move with low volume - possibly manipulated
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
  
  // Subtract manipulation risk (with a cap to avoid negative scores)
  const manipulationPenalty = Math.min(scoreComponents.manipulationRisk, rawTotal * 0.8);
  const finalScore = Math.max(0, Math.min(100, rawTotal - manipulationPenalty));
  
  // Log analysis results in debug mode
  if (config.get('DEBUG')) {
    logger.debug(`ROI Analysis for ${token.baseToken?.symbol || 'Unknown token'}`, {
      metrics: {
        liquidityUsd,
        volume24h,
        priceChange5m,
        priceChange1h,
        priceChange24h,
        buySellRatio5m,
        buySellRatio1h
      },
      scoreComponents,
      finalScore
    });
  }
  
  // =====================================================
  // 9. GENERATE EVALUATION & RECOMMENDATION
  // =====================================================
  // Determine potential assessment based on score
  let potentialAssessment;
  if (finalScore >= 80) {
    potentialAssessment = 'Excellent Potential';
  } else if (finalScore >= 60) {
    potentialAssessment = 'Strong Potential';
  } else if (finalScore >= 40) {
    potentialAssessment = 'Moderate Potential';
  } else if (finalScore >= 20) {
    potentialAssessment = 'Limited Potential';
  } else {
    potentialAssessment = 'Very Limited Potential';
  }
  
  // Return comprehensive analysis result
  return {
    token: {
      address: token.baseToken?.address || '',
      name: token.baseToken?.symbol || 'Unknown',
      price: token.priceUsd || 0,
      age: tokenAge
    },
    potentialScore: finalScore,
    scoreComponents,
    potentialAssessment,
    manipulationRisk: scoreComponents.manipulationRisk > 15 ? 'High' : 
                      scoreComponents.manipulationRisk > 8 ? 'Medium' : 'Low',
    tradingRecommendation: finalScore >= 70 ? 'Strong Buy' :
                          finalScore >= 50 ? 'Buy' :
                          finalScore >= 35 ? 'Watch' : 'Avoid',
    timestamp: new Date().toISOString()
  };
}

export default {
  evaluateTokenROI
};