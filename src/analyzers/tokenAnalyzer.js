console.log('analyzers/tokenAnalyzer.js', '# Main token analysis');

// src/analyzers/tokenAnalyzer.js
import logger from '../services/logger.js';
import config from '../config/index.js';
import { evaluateTokenROI } from './tokenROIAnalyzer.js';

/**
 * Analyzes a token using multiple factors to determine trade worthiness
 * Combines risk assessment with ROI potential for a comprehensive evaluation
 * @param {Object} tokenData - Token data from DEX APIs
 * @param {Object} options - Analysis options
 * @returns {Object} Complete analysis with tradeable assessment
 */
export function analyzeToken(tokenData, options = {}) {
  const tokenName = tokenData.baseToken?.symbol || 'Unknown';
  const tokenAddress = tokenData.baseToken?.address || '';
  
  logger.debug(`Analyzing token: ${tokenName} (${tokenAddress})`);
  
  // Extract basic token metrics
  const tokenMetrics = {
    name: tokenName,
    address: tokenAddress,
    price: tokenData.priceUsd || 0,
    liquidity: tokenData.liquidity?.usd || 0,
    volume24h: tokenData.volume?.h24 || 0,
    priceChange24h: tokenData.priceChange?.h24 || 0,
    priceChange1h: tokenData.priceChange?.h1 || 0,
    priceChange5m: tokenData.priceChange?.m5 || 0,
    pairCreatedAt: tokenData.pairCreatedAt || null
  };
  
  // Perform risk analysis
  const riskAnalysis = analyzeTokenRisk(tokenData);
  
  // Get ROI potential analysis
  const potentialAnalysis = evaluateTokenROI(tokenData);
  
  // Calculate tradeable score (balancing risk and potential)
  // Higher potential and lower risk = better tradeable score
  let tradeableScore = potentialAnalysis.potentialScore - (riskAnalysis.riskScore / 2);
  
  // Ensure score is within 0-100 range
  tradeableScore = Math.max(0, Math.min(100, tradeableScore));
  
  // Determine if token is tradeable based on score and thresholds
  const minTradeableScore = options.minTradeableScore || 30;
  const isTradeable = tradeableScore >= minTradeableScore;
  
  // Calculate optimal position size as percentage of max allocation
  // Higher tradeable score = higher percentage of maximum position
  let optimalPositionPct = tradeableScore / 100;
  
  // Trade feasibility assessment
  let tradeAssessment = '';
  if (tradeableScore >= 70) {
    tradeAssessment = 'Highly Recommended';
  } else if (tradeableScore >= 50) {
    tradeAssessment = 'Recommended';
  } else if (tradeableScore >= 30) {
    tradeAssessment = 'Cautiously Recommended';
  } else if (tradeableScore >= 10) {
    tradeAssessment = 'High Risk / Low Confidence';
  } else {
    tradeAssessment = 'Not Recommended';
  }
  
  // Complete analysis results
  const analysis = {
    token: tokenMetrics,
    risk: riskAnalysis,
    potential: potentialAnalysis,
    tradeable: {
      score: tradeableScore,
      isTradeable,
      assessment: tradeAssessment,
      optimalPositionPct
    },
    timestamp: new Date().toISOString()
  };
  
  // Log analysis results
  logger.debug(`Analysis for ${tokenName} complete`, {
    riskScore: riskAnalysis.riskScore, 
    potentialScore: potentialAnalysis.potentialScore,
    tradeableScore
  });
  
  return analysis;
}

/**
 * Analyzes token risk factors and assigns a risk score
 * @param {Object} tokenData - Token data including liquidity, volume, and transactions
 * @returns {Object} Risk analysis with score (0-100, lower is safer)
 */
function analyzeTokenRisk(tokenData) {
  // Initialize risk factors
  const riskFactors = {
    lowLiquidity: 0,
    highVolatility: 0,
    sellPressure: 0,
    priceDrops: 0,
    suspiciousActivity: 0,
    newToken: 0
  };
  
  // 1. Liquidity risk (0-25 points)
  const liquidityUsd = tokenData.liquidity?.usd || 0;
  if (liquidityUsd < 1000) {
    riskFactors.lowLiquidity = 25; // Extremely low liquidity
  } else if (liquidityUsd < 5000) {
    riskFactors.lowLiquidity = 20;
  } else if (liquidityUsd < 10000) {
    riskFactors.lowLiquidity = 15;
  } else if (liquidityUsd < 25000) {
    riskFactors.lowLiquidity = 10;
  } else if (liquidityUsd < 50000) {
    riskFactors.lowLiquidity = 5;
  }
  
  // 2. Volatility risk (0-20 points)
  const priceChange24h = Math.abs(tokenData.priceChange?.h24 || 0);
  const priceChange1h = Math.abs(tokenData.priceChange?.h1 || 0);
  
  if (priceChange24h > 80) {
    riskFactors.highVolatility += 10;
  } else if (priceChange24h > 50) {
    riskFactors.highVolatility += 5;
  }
  
  if (priceChange1h > 30) {
    riskFactors.highVolatility += 10;
  } else if (priceChange1h > 15) {
    riskFactors.highVolatility += 5;
  }
  
  // 3. Sell pressure risk (0-25 points)
  const txns = tokenData.txns || { h1: {}, h24: {} };
  const sells1h = txns.h1?.sells || 0;
  const buys1h = txns.h1?.buys || 0;
  const buySellRatio = buys1h > 0 && sells1h > 0 ? sells1h / buys1h : 1;
  
  if (buySellRatio > 2) {
    // More than twice as many sells as buys in the last hour
    riskFactors.sellPressure = 25;
  } else if (buySellRatio > 1.5) {
    riskFactors.sellPressure = 20;
  } else if (buySellRatio > 1.2) {
    riskFactors.sellPressure = 15;
  } else if (buySellRatio > 1) {
    riskFactors.sellPressure = 10;
  }
  
  // 4. Price action risk (0-15 points)
  if ((tokenData.priceChange?.h1 || 0) < -10) {
    riskFactors.priceDrops += 10;
  } else if ((tokenData.priceChange?.h1 || 0) < -5) {
    riskFactors.priceDrops += 5;
  }
  
  // Recent sharp drops in shorter timeframes
  if ((tokenData.priceChange?.m5 || 0) < -5) {
    riskFactors.priceDrops += 5;
  }
  
  // 5. Token age & suspicious activity risk (0-15 points)
  const tokenAgeDays = tokenData.pairCreatedAt 
    ? (Date.now() - tokenData.pairCreatedAt) / (1000 * 60 * 60 * 24)
    : 999;
  
  if (tokenAgeDays < 1) {
    riskFactors.newToken += 15; // Brand new token (<24h)
  } else if (tokenAgeDays < 3) {
    riskFactors.newToken += 10; // Very new token (<3d)
  } else if (tokenAgeDays < 7) {
    riskFactors.newToken += 5;  // New token (<7d)
  }
  
  // Unusual volume relative to liquidity (possible manipulation)
  const volumeToLiquidityRatio = (tokenData.volume?.h24 || 0) / (liquidityUsd || 1);
  if (volumeToLiquidityRatio > 5) {
    riskFactors.suspiciousActivity += 10; // Volume over 5x liquidity is suspicious
  } else if (volumeToLiquidityRatio > 2) {
    riskFactors.suspiciousActivity += 5;
  }
  
  // Calculate total risk score (0-100)
  const riskScore = Math.min(100, 
    riskFactors.lowLiquidity + 
    riskFactors.highVolatility + 
    riskFactors.sellPressure + 
    riskFactors.priceDrops + 
    riskFactors.suspiciousActivity +
    riskFactors.newToken
  );
  
  // Risk assessment text
  let riskAssessment = '';
  if (riskScore < 20) {
    riskAssessment = 'Very Low Risk';
  } else if (riskScore < 40) {
    riskAssessment = 'Low Risk';
  } else if (riskScore < 60) {
    riskAssessment = 'Moderate Risk';
  } else if (riskScore < 80) {
    riskAssessment = 'High Risk';
  } else {
    riskAssessment = 'Very High Risk';
  }
  
  return {
    riskScore,
    riskFactors,
    riskAssessment,
    tokenAge: tokenAgeDays
  };
}

export default {
  analyzeToken
};