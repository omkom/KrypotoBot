/**
 * token-analyzer.js
 * 
 * Advanced token analysis module for KryptoBot.
 * Analyzes tokens based on liquidity, volume, price action, and other metrics
 * to determine trade worthiness and optimal entry/exit points.
 */

import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import dotenv from 'dotenv';
import { createTable, calculateStats, calculateRSI, calculateEMA } from './token-analyzer-utils.js';

// Load environment variables
dotenv.config();

// Configuration with defaults and environment variable overrides
const CONFIG = {
  // Analysis thresholds
  MIN_LIQUIDITY_USD: Number(process.env.MIN_LIQUIDITY_USD || 5000),
  MIN_VOLUME_24H: Number(process.env.MIN_VOLUME_24H || 1000),
  MIN_BUY_SELL_RATIO: Number(process.env.MIN_BUY_SELL_RATIO || 0.8),
  
  // Risk scoring weights
  LIQUIDITY_WEIGHT: Number(process.env.LIQUIDITY_WEIGHT || 0.3),
  VOLUME_WEIGHT: Number(process.env.VOLUME_WEIGHT || 0.2),
  BUY_PRESSURE_WEIGHT: Number(process.env.BUY_PRESSURE_WEIGHT || 0.2),
  PRICE_ACTION_WEIGHT: Number(process.env.PRICE_ACTION_WEIGHT || 0.3),
  
  // Output and reporting
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  EXPORT_ANALYSIS: process.env.EXPORT_ANALYSIS === 'true',
  ANALYSIS_OUTPUT_DIR: process.env.ANALYSIS_OUTPUT_DIR || path.join(process.cwd(), 'logs', 'analysis'),
  
  // Debug
  DEBUG: process.env.DEBUG === 'true'
};

/**
 * Analyzes token risk factors and assigns a risk score
 * @param {Object} tokenData - Token data including liquidity, volume, and transactions
 * @returns {Object} Risk analysis with score (0-100, lower is safer)
 */
export function analyzeTokenRisk(tokenData) {
  // Initialize risk factors
  const riskFactors = {
    lowLiquidity: 0,
    highVolatility: 0,
    sellPressure: 0,
    priceDrops: 0,
    suspiciousActivity: 0,
    miscRisks: 0
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
  
  if (CONFIG.DEBUG) {
    console.log(chalk.blue(`Liquidity risk: ${riskFactors.lowLiquidity} points (${liquidityUsd.toFixed(2)} USD)`));
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
  
  if (CONFIG.DEBUG) {
    console.log(chalk.blue(`Volatility risk: ${riskFactors.highVolatility} points (24h change: ${priceChange24h.toFixed(2)}%, 1h change: ${priceChange1h.toFixed(2)}%)`));
  }
  
  // 3. Sell pressure risk (0-25 points)
  const txns = tokenData.txns || { h1: {}, h24: {} };
  const sells1h = txns.h1?.sells || 0;
  const buys1h = txns.h1?.buys || 0;
  const buySellRatio = buys1h > 0 ? sells1h / buys1h : 999;
  
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
  
  if (CONFIG.DEBUG) {
    console.log(chalk.blue(`Sell pressure risk: ${riskFactors.sellPressure} points (Buy/Sell ratio: ${buySellRatio.toFixed(2)})`));
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
  
  if (CONFIG.DEBUG) {
    console.log(chalk.blue(`Price action risk: ${riskFactors.priceDrops} points (1h change: ${tokenData.priceChange?.h1 || 0}%, 5m change: ${tokenData.priceChange?.m5 || 0}%)`));
  }
  
  // 5. Suspicious activity risk (0-15 points)
  // Analyze token age, volume spikes, and other suspicious indicators
  const tokenAgeDays = tokenData.pairCreatedAt 
    ? (Date.now() - tokenData.pairCreatedAt) / (1000 * 60 * 60 * 24)
    : 0;
  
  if (tokenAgeDays < 1) {
    riskFactors.suspiciousActivity += 5; // Very new token
  }
  
  // Unusual volume relative to liquidity
  const volumeToLiquidityRatio = (tokenData.volume?.h24 || 0) / (liquidityUsd || 1);
  if (volumeToLiquidityRatio > 5) {
    riskFactors.suspiciousActivity += 10; // Volume over 5x liquidity is suspicious
  } else if (volumeToLiquidityRatio > 2) {
    riskFactors.suspiciousActivity += 5;
  }
  
  if (CONFIG.DEBUG) {
    console.log(chalk.blue(`Suspicious activity risk: ${riskFactors.suspiciousActivity} points (Token age: ${tokenAgeDays.toFixed(2)} days, Vol/Liq ratio: ${volumeToLiquidityRatio.toFixed(2)})`));
  }
  
  // Calculate total risk score (0-100)
  const riskScore = Math.min(100, 
    riskFactors.lowLiquidity + 
    riskFactors.highVolatility + 
    riskFactors.sellPressure + 
    riskFactors.priceDrops + 
    riskFactors.suspiciousActivity +
    riskFactors.miscRisks
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

/**
 * Analyzes token potential for profit
 * @param {Object} tokenData - Token data including liquidity, volume, and transactions
 * @returns {Object} Potential analysis with score (0-100, higher is better)
 */
export function analyzeTokenPotential(tokenData) {
  // Initialize potential factors
  const potentialFactors = {
    liquidityScore: 0,    // 0-20 points
    volumeScore: 0,       // 0-20 points
    buyPressureScore: 0,  // 0-25 points
    priceActionScore: 0,  // 0-25 points
    momentumScore: 0,     // 0-10 points
  };
  
  // 1. Liquidity score (0-20 points)
  // Optimal liquidity range is 10K-100K USD (not too small, not too large)
  const liquidityUsd = tokenData.liquidity?.usd || 0;
  if (liquidityUsd >= 10000 && liquidityUsd <= 100000) {
    potentialFactors.liquidityScore = 20;
  } else if (liquidityUsd > 5000 && liquidityUsd < 10000) {
    potentialFactors.liquidityScore = 15;
  } else if (liquidityUsd > 100000 && liquidityUsd <= 250000) {
    potentialFactors.liquidityScore = 10;
  } else if (liquidityUsd > 250000) {
    potentialFactors.liquidityScore = 5; // Too much liquidity may mean less potential for growth
  } else if (liquidityUsd > 1000) {
    potentialFactors.liquidityScore = 5; // Very low but not negligible
  }
  
  if (CONFIG.DEBUG) {
    console.log(chalk.green(`Liquidity potential: ${potentialFactors.liquidityScore} points (${liquidityUsd.toFixed(2)} USD)`));
  }
  
  // 2. Volume score (0-20 points)
  const volume24h = tokenData.volume?.h24 || 0;
  const volumeToLiquidityRatio = liquidityUsd > 0 ? volume24h / liquidityUsd : 0;
  
  // Healthy volume but not excessive
  if (volumeToLiquidityRatio >= 0.5 && volumeToLiquidityRatio <= 3) {
    potentialFactors.volumeScore = 20;
  } else if (volumeToLiquidityRatio > 3 && volumeToLiquidityRatio <= 5) {
    potentialFactors.volumeScore = 15;
  } else if (volumeToLiquidityRatio > 0.2 && volumeToLiquidityRatio < 0.5) {
    potentialFactors.volumeScore = 10;
  } else if (volumeToLiquidityRatio > 5) {
    potentialFactors.volumeScore = 5; // Too much volume relative to liquidity could be pump and dump
  } else if (volume24h > 1000) {
    potentialFactors.volumeScore = 5; // Some activity but low relative to liquidity
  }
  
  if (CONFIG.DEBUG) {
    console.log(chalk.green(`Volume potential: ${potentialFactors.volumeScore} points (${volume24h.toFixed(2)} USD, ratio: ${volumeToLiquidityRatio.toFixed(2)})`));
  }
  
  // 3. Buy pressure score (0-25 points)
  const txns = tokenData.txns || { h1: {}, h24: {}, m5: {} };
  const buys1h = txns.h1?.buys || 0;
  const sells1h = txns.h1?.sells || 0;
  const buys5m = txns.m5?.buys || 0;
  const sells5m = txns.m5?.sells || 0;
  
  // Calculate buy/sell ratios (values > 1 mean more buys than sells)
  const buySellRatio1h = sells1h > 0 ? buys1h / sells1h : (buys1h > 0 ? 999 : 1);
  const buySellRatio5m = sells5m > 0 ? buys5m / sells5m : (buys5m > 0 ? 999 : 1);
  
  // Strong recent buy pressure
  if (buySellRatio5m > 2) {
    potentialFactors.buyPressureScore += 15;
  } else if (buySellRatio5m > 1.5) {
    potentialFactors.buyPressureScore += 10;
  } else if (buySellRatio5m > 1) {
    potentialFactors.buyPressureScore += 5;
  }
  
  // Sustained buy pressure over 1h
  if (buySellRatio1h > 1.5) {
    potentialFactors.buyPressureScore += 10;
  } else if (buySellRatio1h > 1) {
    potentialFactors.buyPressureScore += 5;
  }
  
  // Cap at max score
  potentialFactors.buyPressureScore = Math.min(25, potentialFactors.buyPressureScore);
  
  if (CONFIG.DEBUG) {
    console.log(chalk.green(`Buy pressure potential: ${potentialFactors.buyPressureScore} points (1h: ${buySellRatio1h.toFixed(2)}, 5m: ${buySellRatio5m.toFixed(2)})`));
  }
  
  // 4. Price action score (0-25 points)
  const priceChange24h = tokenData.priceChange?.h24 || 0;
  const priceChange1h = tokenData.priceChange?.h1 || 0;
  const priceChange5m = tokenData.priceChange?.m5 || 0;
  
  // Recent positive momentum
  if (priceChange5m > 5) {
    potentialFactors.priceActionScore += 10;
  } else if (priceChange5m > 2) {
    potentialFactors.priceActionScore += 5;
  }
  
  // Hourly uptrend
  if (priceChange1h > 10) {
    potentialFactors.priceActionScore += 10;
  } else if (priceChange1h > 5) {
    potentialFactors.priceActionScore += 5;
  }
  
  // Daily trend context
  if (priceChange24h > 20) {
    potentialFactors.priceActionScore += 5;
  }
  
  // Cap at max score
  potentialFactors.priceActionScore = Math.min(25, potentialFactors.priceActionScore);
  
  if (CONFIG.DEBUG) {
    console.log(chalk.green(`Price action potential: ${potentialFactors.priceActionScore} points (24h: ${priceChange24h.toFixed(2)}%, 1h: ${priceChange1h.toFixed(2)}%, 5m: ${priceChange5m.toFixed(2)}%)`));
  }
  
  // 5. Momentum score (0-10 points)
  // Analyze trend consistency and acceleration
  let consistentUptrend = false;
  
  if (priceChange5m > 0 && priceChange1h > 0 && priceChange24h > 0) {
    // All timeframes showing positive momentum
    consistentUptrend = true;
    potentialFactors.momentumScore += 5;
  }
  
  // Acceleration means recent performance is stronger than longer timeframes
  const showsAcceleration = priceChange5m > priceChange1h / 12; // 5min change proportionally stronger
  
  if (showsAcceleration && consistentUptrend) {
    potentialFactors.momentumScore += 5;
  }
  
  if (CONFIG.DEBUG) {
    console.log(chalk.green(`Momentum score: ${potentialFactors.momentumScore} points (Consistent uptrend: ${consistentUptrend}, Acceleration: ${showsAcceleration})`));
  }
  
  // Calculate total potential score (0-100)
  const potentialScore = Math.min(100,
    potentialFactors.liquidityScore +
    potentialFactors.volumeScore +
    potentialFactors.buyPressureScore +
    potentialFactors.priceActionScore +
    potentialFactors.momentumScore
  );
  
  // Potential assessment text
  let potentialAssessment = '';
  if (potentialScore >= 80) {
    potentialAssessment = 'Excellent Potential';
  } else if (potentialScore >= 60) {
    potentialAssessment = 'Strong Potential';
  } else if (potentialScore >= 40) {
    potentialAssessment = 'Moderate Potential';
  } else if (potentialScore >= 20) {
    potentialAssessment = 'Limited Potential';
  } else {
    potentialAssessment = 'Very Limited Potential';
  }
  
  return {
    potentialScore,
    potentialFactors,
    potentialAssessment
  };
}

/**
 * Performs comprehensive token analysis incorporating risk and potential
 * @param {Object} tokenData - Token data from DEXs
 * @param {Object} options - Analysis options
 * @returns {Object} Complete analysis with tradeable assessment
 */
export function analyzeToken(tokenData, options = {}) {
  const tokenName = tokenData.baseToken?.symbol || 'Unknown';
  const tokenAddress = tokenData.baseToken?.address || '';
  
  if (CONFIG.DEBUG) {
    console.log(chalk.yellow(`\n===== Analyzing Token: ${tokenName} (${tokenAddress}) =====`));
  }
  
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
  
  // Perform potential analysis
  const potentialAnalysis = analyzeTokenPotential(tokenData);
  
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
  
  // Log analysis results if debug is enabled
  if (CONFIG.DEBUG) {
    console.log(chalk.cyan('\n----- Analysis Results -----'));
    console.log(chalk.cyan(`Token: ${tokenName} (${tokenAddress})`));
    console.log(chalk.cyan(`Price: ${tokenMetrics.price.toFixed(8)}`));
    console.log(chalk.cyan(`Liquidity: ${tokenMetrics.liquidity.toFixed(2)}`));
    console.log(chalk.cyan(`24h Volume: ${tokenMetrics.volume24h.toFixed(2)}`));
    console.log(chalk.cyan(`Risk Score: ${riskAnalysis.riskScore.toFixed(1)} (${riskAnalysis.riskAssessment})`));
    console.log(chalk.cyan(`Potential Score: ${potentialAnalysis.potentialScore.toFixed(1)} (${potentialAnalysis.potentialAssessment})`));
    console.log(chalk.cyan(`Tradeable Score: ${tradeableScore.toFixed(1)} (${tradeAssessment})`));
    console.log(chalk.cyan(`Recommended Position: ${(optimalPositionPct * 100).toFixed(1)}% of maximum allocation`));
    console.log(chalk.cyan(`Tradeable: ${isTradeable ? 'YES' : 'NO'}`));
    console.log(chalk.cyan('---------------------------\n'));
  }
  
  // Export analysis to file if enabled
  if (CONFIG.EXPORT_ANALYSIS) {
    exportAnalysis(analysis);
  }
  
  return analysis;
}

/**
 * Exports analysis results to JSON file for record keeping
 * @param {Object} analysis - Complete token analysis
 */
function exportAnalysis(analysis) {
  try {
    const outputDir = CONFIG.ANALYSIS_OUTPUT_DIR;
    
    // Ensure directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Generate filename with token address and timestamp
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const tokenAddress = analysis.token.address || 'unknown';
    const tokenSymbol = analysis.token.name || 'unknown';
    const filename = `${tokenSymbol}_${tokenAddress.substring(0, 8)}_${timestamp}.json`;
    
    // Write to file
    const filePath = path.join(outputDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(analysis, null, 2));
    
    if (CONFIG.DEBUG) {
      console.log(chalk.green(`Analysis exported to ${filePath}`));
    }
  } catch (error) {
    console.error(chalk.red(`Error exporting analysis: ${error.message}`));
  }
}

/**
 * Batches multiple token analyses and ranks them by tradeable score
 * @param {Array<Object>} tokens - Array of token data objects
 * @param {Object} options - Analysis options
 * @returns {Array<Object>} Analyzed and ranked tokens
 */
export function batchAnalyzeTokens(tokens, options = {}) {
  console.log(chalk.blue(`Batch analyzing ${tokens.length} tokens...`));
  
  const results = [];
  
  // Process each token
  for (const token of tokens) {
    try {
      const analysis = analyzeToken(token, options);
      results.push(analysis);
    } catch (error) {
      console.error(chalk.red(`Error analyzing token ${token.baseToken?.symbol || 'unknown'}: ${error.message}`));
      if (CONFIG.DEBUG) {
        console.error(error.stack);
      }
    }
  }
  
  // Sort by tradeable score (highest first)
  const sortedResults = results.sort((a, b) => b.tradeable.score - a.tradeable.score);
  
  // Print top opportunities if debug enabled
  if (CONFIG.DEBUG && sortedResults.length > 0) {
    console.log(chalk.yellow('\n===== Top Trading Opportunities ====='));
    
    // Create a table for display
    const table = createTable(['Token', 'Price', 'Risk', 'Potential', 'Score', 'Action']);
    
    // Add rows for top 5 tokens
    for (let i = 0; i < Math.min(5, sortedResults.length); i++) {
      const result = sortedResults[i];
      const token = result.token;
      
      // Format action text with color based on score
      let actionText;
      if (result.tradeable.score >= 70) {
        actionText = chalk.green('BUY');
      } else if (result.tradeable.score >= 50) {
        actionText = chalk.cyan('CONSIDER');
      } else if (result.tradeable.score >= 30) {
        actionText = chalk.yellow('MONITOR');
      } else {
        actionText = chalk.red('AVOID');
      }
      
      table.push([
        token.name,
        `${token.price.toFixed(8)}`,
        `${result.risk.riskScore.toFixed(1)}`,
        `${result.potential.potentialScore.toFixed(1)}`,
        `${result.tradeable.score.toFixed(1)}`,
        actionText
      ]);
    }
    
    console.log(table.toString());
    console.log(chalk.yellow('=====================================\n'));
  }
  
  return sortedResults;
}

/**
 * Determines optimal stop loss and take profit levels based on token analysis
 * @param {Object} analysis - Complete token analysis from analyzeToken
 * @returns {Object} Optimized trade parameters
 */
export function optimizeTradeParameters(analysis) {
  // Extract key metrics
  const { risk, potential, tradeable } = analysis;
  
  // Default parameters
  const defaults = {
    takeProfitPct: 50,
    stopLossPct: -20,
    trailingStopActivationPct: 20,
    trailingStopDistancePct: 10,
    entryScalePct: 1.0, // 100% of calculated position size
    maxHoldTimeMinutes: 60
  };
  
  // Adjust based on risk profile
  let takeProfitPct = defaults.takeProfitPct;
  let stopLossPct = defaults.stopLossPct;
  let trailingStopActivationPct = defaults.trailingStopActivationPct;
  let trailingStopDistancePct = defaults.trailingStopDistancePct;
  let entryScalePct = defaults.entryScalePct;
  let maxHoldTimeMinutes = defaults.maxHoldTimeMinutes;
  
  // Higher risk requires larger profit target and tighter stop loss
  if (risk.riskScore >= 70) {
    // High risk token
    takeProfitPct = 100; // Need higher reward for the risk
    stopLossPct = -10; // Tighter stop loss
    trailingStopActivationPct = 30;
    trailingStopDistancePct = 15;
    entryScalePct = 0.6; // Reduce position size
    maxHoldTimeMinutes = 30;
  } else if (risk.riskScore >= 50) {
    // Medium-high risk
    takeProfitPct = 75;
    stopLossPct = -15;
    trailingStopActivationPct = 25;
    trailingStopDistancePct = 12;
    entryScalePct = 0.8;
    maxHoldTimeMinutes = 45;
  } else if (risk.riskScore >= 30) {
    // Medium risk
    takeProfitPct = 50;
    stopLossPct = -20;
    trailingStopActivationPct = 20;
    trailingStopDistancePct = 10;
    entryScalePct = 1.0;
    maxHoldTimeMinutes = 60;
  } else {
    // Low risk
    takeProfitPct = 35;
    stopLossPct = -25;
    trailingStopActivationPct = 15;
    trailingStopDistancePct = 8;
    entryScalePct = 1.2;
    maxHoldTimeMinutes = 90;
  }
  
  // Adjust based on potential score
  if (potential.potentialScore >= 80) {
    // Very high potential - set more ambitious targets
    takeProfitPct += 25;
    maxHoldTimeMinutes += 30;
  } else if (potential.potentialScore >= 60) {
    // High potential
    takeProfitPct += 15;
    maxHoldTimeMinutes += 15;
  }
  
  // Calculate optimal exit stages
  const exitStages = [];
  
  // For higher potential tokens, use staged profit taking
  if (potential.potentialScore >= 60) {
    exitStages.push({ percent: takeProfitPct * 0.25, sellPortion: 0.2 }); // Sell 20% at 1/4 of take profit
    exitStages.push({ percent: takeProfitPct * 0.5, sellPortion: 0.3 }); // Sell 30% at 1/2 of take profit
    exitStages.push({ percent: takeProfitPct * 0.75, sellPortion: 0.3 }); // Sell 30% at 3/4 of take profit
    exitStages.push({ percent: takeProfitPct, sellPortion: 0.2 }); // Sell final 20% at full take profit
  } else {
    exitStages.push({ percent: takeProfitPct * 0.5, sellPortion: 0.5 }); // Sell 50% at half take profit
    exitStages.push({ percent: takeProfitPct, sellPortion: 0.5 }); // Sell remaining 50% at full take profit
  }
  
  // Calculate actual position size in SOL based on max allocation and risk
  const maxSolPerTrade = process.env.MAX_SOL_PER_TRADE ? parseFloat(process.env.MAX_SOL_PER_TRADE) : 0.1;
  const positionSizeSol = maxSolPerTrade * tradeable.optimalPositionPct * entryScalePct;
  
  return {
    token: analysis.token.name,
    address: analysis.token.address,
    takeProfitPct,
    stopLossPct,
    trailingStopActivationPct,
    trailingStopDistancePct,
    entryScalePct,
    positionSizeSol,
    maxHoldTimeMinutes,
    exitStages,
    tradeSummary: {
      riskScore: risk.riskScore,
      potentialScore: potential.potentialScore,
      tradeableScore: tradeable.score,
      assessment: tradeable.assessment
    }
  };
}

/**
 * Exports a trade recommendation after token analysis
 * @param {Object} analysisResult - Complete analysis from analyzeToken
 * @param {string} outputPath - Path to export the recommendation
 * @returns {boolean} True if export was successful
 */
export function exportTradeRecommendation(analysisResult, outputPath) {
  try {
    // Generate optimized trade parameters
    const tradeParams = optimizeTradeParameters(analysisResult);
    
    // Create full recommendation object
    const recommendation = {
      timestamp: new Date().toISOString(),
      token: analysisResult.token,
      tradeParameters: tradeParams,
      analysis: {
        riskScore: analysisResult.risk.riskScore,
        potentialScore: analysisResult.potential.potentialScore,
        tradeableScore: analysisResult.tradeable.score,
        riskAssessment: analysisResult.risk.riskAssessment,
        potentialAssessment: analysisResult.potential.potentialAssessment,
        tradeAssessment: analysisResult.tradeable.assessment
      }
    };
    
    // Ensure directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Write to file
    fs.writeFileSync(outputPath, JSON.stringify(recommendation, null, 2));
    
    console.log(chalk.green(`Trade recommendation exported to ${outputPath}`));
    return true;
  } catch (error) {
    console.error(chalk.red(`Error exporting trade recommendation: ${error.message}`));
    return false;
  }
}

// Export all functions for external use
export default {
  analyzeTokenRisk,
  analyzeTokenPotential,
  analyzeToken,
  batchAnalyzeTokens,
  optimizeTradeParameters,
  exportTradeRecommendation
};