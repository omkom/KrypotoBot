/**
 * strategy-analyzer.js
 * 
 * Analyzes the performance of different trading strategies across tokens
 * and market conditions. Identifies optimal strategies for specific
 * tokens and market environments.
 */

import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { createTable, calculateStats, readJsonFile, writeJsonFile } from './token-analyzer-utils.js';

// Configuration
const CONFIG = {
  STRATEGY_DATA_PATH: process.env.STRATEGY_DATA_PATH || path.join(process.cwd(), 'logs', 'strategy_analysis.json'),
  TRADE_LOG_PATH: process.env.TRADE_LOG_PATH || path.join(process.cwd(), 'logs', 'trade_logs.json'),
  PROFIT_REPORT_PATH: process.env.PROFIT_REPORT_PATH || path.join(process.cwd(), 'logs', 'profit_report.json'),
  OUTPUT_DIR: process.env.STRATEGY_OUTPUT_DIR || path.join(process.cwd(), 'logs', 'analysis', 'strategies'),
  MIN_TRADES_FOR_ANALYSIS: parseInt(process.env.MIN_TRADES_FOR_ANALYSIS || '5'),
  DEBUG: process.env.DEBUG === 'true'
};

/**
 * Stratifies trading data by market conditions
 * @param {Array} transactions - Trading transactions
 * @returns {Object} Data grouped by market conditions
 */
export function stratifyByMarketCondition(transactions) {
  // Groups for different market conditions
  const marketGroups = {
    bullish: [], // Strong uptrend (>5% price increase in 1h)
    bearish: [], // Strong downtrend (>5% price decrease in 1h)
    volatile: [], // High volatility (>10% price movement in either direction in 1h)
    neutral: [], // Sideways market (price movement <2% in 1h)
    unknown: [] // Insufficient data
  };
  
  if (CONFIG.DEBUG) {
    console.log(chalk.blue(`Stratifying ${transactions.length} transactions by market condition...`));
  }
  
  // Group transactions by market condition
  for (const tx of transactions) {
    // Skip transactions without market data
    if (!tx.marketData) {
      marketGroups.unknown.push(tx);
      continue;
    }
    
    // Get relevant market data
    const priceChange1h = tx.marketData.priceChange1h || 0;
    const volatility = tx.marketData.volatility || Math.abs(priceChange1h);
    
    // Assign to group based on market conditions
    if (volatility > 10) {
      marketGroups.volatile.push(tx);
    } else if (priceChange1h > 5) {
      marketGroups.bullish.push(tx);
    } else if (priceChange1h < -5) {
      marketGroups.bearish.push(tx);
    } else if (Math.abs(priceChange1h) < 2) {
      marketGroups.neutral.push(tx);
    } else {
      marketGroups.unknown.push(tx);
    }
  }
  
  // Count transactions per group
  const counts = {};
  for (const [condition, txs] of Object.entries(marketGroups)) {
    counts[condition] = txs.length;
  }
  
  if (CONFIG.DEBUG) {
    console.log(chalk.green(`Market stratification complete: ${JSON.stringify(counts)}`));
  }
  
  return {
    marketGroups,
    counts
  };
}

/**
 * Analyzes strategy performance for a specific market condition
 * @param {Array} transactions - Transactions for a specific market condition
 * @param {string} marketCondition - The market condition label
 * @returns {Object} Strategy performance for this market condition
 */
export function analyzeStrategyForMarketCondition(transactions, marketCondition) {
  // Group by strategy
  const strategyGroups = {};
  
  for (const tx of transactions) {
    const strategy = tx.strategy || 'unknown';
    
    if (!strategyGroups[strategy]) {
      strategyGroups[strategy] = [];
    }
    
    strategyGroups[strategy].push(tx);
  }
  
  // Calculate performance metrics for each strategy
  const strategyPerformance = {};
  
  for (const [strategy, txs] of Object.entries(strategyGroups)) {
    // Skip strategies with too few trades
    if (txs.length < CONFIG.MIN_TRADES_FOR_ANALYSIS) {
      continue;
    }
    
    // Extract ROI values
    const roiValues = txs.map(tx => tx.roi || 0);
    
    // Calculate performance statistics
    const stats = calculateStats(roiValues);
    
    // Calculate win rate
    const winners = txs.filter(tx => (tx.roi || 0) > 0).length;
    const winRate = txs.length > 0 ? (winners / txs.length) * 100 : 0;
    
    // Store strategy performance
    strategyPerformance[strategy] = {
      trades: txs.length,
      winRate,
      meanROI: stats.mean,
      medianROI: stats.median,
      maxROI: stats.max,
      minROI: stats.min,
      stdDevROI: stats.stdDev,
      profitFactor: calculateProfitFactor(txs),
      netProfitLoss: txs.reduce((sum, tx) => sum + (tx.profitLoss || 0), 0),
      tokens: countUniqueTokens(txs)
    };
  }
  
  if (CONFIG.DEBUG) {
    console.log(chalk.green(`Analyzed ${Object.keys(strategyPerformance).length} strategies for ${marketCondition} market condition`));
  }
  
  // Sort by mean ROI
  const rankedStrategies = Object.entries(strategyPerformance)
    .sort((a, b) => b[1].meanROI - a[1].meanROI)
    .map(([strategy, perf]) => ({ strategy, ...perf }));
  
  return {
    marketCondition,
    tradeCounts: transactions.length,
    strategyPerformance,
    rankedStrategies
  };
}

/**
 * Calculates profit factor (sum of profits / sum of losses)
 * @param {Array} transactions - Array of transactions
 * @returns {number} Profit factor
 */
function calculateProfitFactor(transactions) {
  let totalProfit = 0;
  let totalLoss = 0;
  
  for (const tx of transactions) {
    const pl = tx.profitLoss || 0;
    
    if (pl > 0) {
      totalProfit += pl;
    } else if (pl < 0) {
      totalLoss += Math.abs(pl);
    }
  }
  
  return totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? Infinity : 0;
}

/**
 * Counts the number of unique tokens in transactions
 * @param {Array} transactions - Array of transactions
 * @returns {number} Count of unique tokens
 */
function countUniqueTokens(transactions) {
  const tokens = new Set();
  
  for (const tx of transactions) {
    if (tx.tokenAddress) {
      tokens.add(tx.tokenAddress);
    }
  }
  
  return tokens.size;
}

/**
 * Analyzes strategy performance per token
 * @param {Object} tokenData - Data for tokens with transactions
 * @returns {Object} Strategy performance by token
 */
export function analyzeStrategyPerToken(tokenData) {
  const tokenStrategies = {};
  
  if (CONFIG.DEBUG) {
    console.log(chalk.blue(`Analyzing strategy performance across ${Object.keys(tokenData).length} tokens...`));
  }
  
  for (const [tokenAddress, token] of Object.entries(tokenData)) {
    // Skip tokens without name or transactions
    if (!token.tokenName || !token.transactions || token.transactions.length < CONFIG.MIN_TRADES_FOR_ANALYSIS) {
      continue;
    }
    
    // Group transactions by strategy
    const strategyGroups = {};
    
    for (const tx of token.transactions) {
      const strategy = tx.strategy || 'unknown';
      
      if (!strategyGroups[strategy]) {
        strategyGroups[strategy] = [];
      }
      
      strategyGroups[strategy].push(tx);
    }
    
    // Calculate performance for each strategy
    const strategyPerformance = {};
    
    for (const [strategy, txs] of Object.entries(strategyGroups)) {
      // Skip strategies with too few trades
      if (txs.length < CONFIG.MIN_TRADES_FOR_ANALYSIS) {
        continue;
      }
      
      // Get buy and sell transactions
      const buys = txs.filter(tx => tx.type?.toLowerCase() === 'buy');
      const sells = txs.filter(tx => tx.type?.toLowerCase() === 'sell');
      
      // Extract ROI values from sell transactions
      const roiValues = sells.map(tx => tx.roi || 0);
      
      // Calculate performance statistics
      const stats = calculateStats(roiValues);
      
      // Calculate win rate
      const winners = sells.filter(tx => (tx.roi || 0) > 0).length;
      const winRate = sells.length > 0 ? (winners / sells.length) * 100 : 0;
      
      // Store strategy performance
      strategyPerformance[strategy] = {
        buys: buys.length,
        sells: sells.length,
        winRate,
        meanROI: stats.mean,
        medianROI: stats.median,
        maxROI: stats.max,
        minROI: stats.min,
        stdDevROI: stats.stdDev,
        profitFactor: calculateProfitFactor(sells),
        netProfitLoss: sells.reduce((sum, tx) => sum + (tx.profitLoss || 0), 0)
      };
    }
    
    // Find best strategy for this token
    let bestStrategy = null;
    let bestROI = -Infinity;
    
    for (const [strategy, perf] of Object.entries(strategyPerformance)) {
      if (perf.meanROI > bestROI) {
        bestROI = perf.meanROI;
        bestStrategy = strategy;
      }
    }
    
    // Store token strategy analysis
    tokenStrategies[tokenAddress] = {
      tokenName: token.tokenName,
      tokenAddress,
      transactionCount: token.transactions.length,
      bestStrategy,
      bestROI,
      strategies: strategyPerformance
    };
  }
  
  if (CONFIG.DEBUG) {
    console.log(chalk.green(`Analyzed strategy performance for ${Object.keys(tokenStrategies).length} tokens`));
  }
  
  return tokenStrategies;
}

/**
 * Analyzes overall strategy performance across all tokens
 * @param {Array} transactions - All trading transactions
 * @returns {Object} Performance analysis for each strategy
 */
export function analyzeOverallStrategyPerformance(transactions) {
  // Group by strategy
  const strategyGroups = {};
  
  for (const tx of transactions) {
    const strategy = tx.strategy || 'unknown';
    
    if (!strategyGroups[strategy]) {
      strategyGroups[strategy] = [];
    }
    
    strategyGroups[strategy].push(tx);
  }
  
  // Calculate performance metrics for each strategy
  const strategyPerformance = {};
  
  for (const [strategy, txs] of Object.entries(strategyGroups)) {
    // Skip strategies with too few trades
    if (txs.length < CONFIG.MIN_TRADES_FOR_ANALYSIS) {
      continue;
    }
    
    // Get buy and sell transactions
    const buys = txs.filter(tx => tx.type?.toLowerCase() === 'buy');
    const sells = txs.filter(tx => tx.type?.toLowerCase() === 'sell');
    
    // Extract ROI values from sell transactions
    const roiValues = sells.map(tx => tx.roi || 0);
    
    // Calculate performance statistics
    const stats = calculateStats(roiValues);
    
    // Calculate win rate
    const winners = sells.filter(tx => (tx.roi || 0) > 0).length;
    const winRate = sells.length > 0 ? (winners / sells.length) * 100 : 0;
    
    // Count unique tokens traded
    const uniqueTokens = new Set();
    for (const tx of txs) {
      if (tx.tokenAddress) {
        uniqueTokens.add(tx.tokenAddress);
      }
    }
    
    // Calculate average hold time
    let totalHoldTime = 0;
    let holdTimeCount = 0;
    
    for (const token of uniqueTokens) {
      const tokenTxs = txs.filter(tx => tx.tokenAddress === token);
      const buys = tokenTxs.filter(tx => tx.type?.toLowerCase() === 'buy');
      const sells = tokenTxs.filter(tx => tx.type?.toLowerCase() === 'sell');
      
      for (const sell of sells) {
        const sellTime = new Date(sell.timestamp).getTime();
        
        // Find the most recent buy before this sell
        const previousBuys = buys.filter(buy => 
          new Date(buy.timestamp).getTime() < sellTime
        ).sort((a, b) => 
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        
        if (previousBuys.length > 0) {
          const buyTime = new Date(previousBuys[0].timestamp).getTime();
          const holdTimeMs = sellTime - buyTime;
          totalHoldTime += holdTimeMs;
          holdTimeCount++;
        }
      }
    }
    
    const avgHoldTimeMs = holdTimeCount > 0 ? totalHoldTime / holdTimeCount : 0;
    const avgHoldTimeMin = avgHoldTimeMs / (1000 * 60); // Convert to minutes
    
    // Store strategy performance
    strategyPerformance[strategy] = {
      totalTrades: txs.length,
      buys: buys.length,
      sells: sells.length,
      uniqueTokens: uniqueTokens.size,
      winRate,
      meanROI: stats.mean,
      medianROI: stats.median,
      maxROI: stats.max,
      minROI: stats.min,
      stdDevROI: stats.stdDev,
      profitFactor: calculateProfitFactor(sells),
      netProfitLoss: sells.reduce((sum, tx) => sum + (tx.profitLoss || 0), 0),
      avgHoldTimeMin
    };
  }
  
  if (CONFIG.DEBUG) {
    console.log(chalk.green(`Analyzed overall performance for ${Object.keys(strategyPerformance).length} strategies`));
  }
  
  // Sort strategies by mean ROI
  const rankedStrategies = Object.entries(strategyPerformance)
    .sort((a, b) => b[1].meanROI - a[1].meanROI)
    .map(([strategy, perf]) => ({ strategy, ...perf }));
  
  return {
    totalTransactions: transactions.length,
    strategyPerformance,
    rankedStrategies
  };
}

/**
 * Extracts transactions from trade logs
 * @param {string} logPath - Path to trade logs
 * @returns {Array} Extracted transactions
 */
export function extractTransactions(logPath = CONFIG.TRADE_LOG_PATH) {
  try {
    // Read trade logs
    const tradeLogData = readJsonFile(logPath, { tokens: {} });
    const tokens = tradeLogData.tokens || {};
    
    // Extract all transactions
    const allTransactions = [];
    
    for (const [tokenAddress, token] of Object.entries(tokens)) {
      if (!token.transactions) continue;
      
      // Add token info to each transaction
      for (const tx of token.transactions) {
        allTransactions.push({
          ...tx,
          tokenAddress,
          tokenName: token.tokenName || 'Unknown'
        });
      }
    }
    
    if (CONFIG.DEBUG) {
      console.log(chalk.blue(`Extracted ${allTransactions.length} transactions from trade logs`));
    }
    
    return allTransactions;
  } catch (error) {
    console.error(chalk.red(`Error extracting transactions: ${error.message}`));
    return [];
  }
}

/**
 * Generates comprehensive strategy recommendations
 * @param {Object} analysis - Complete strategy analysis
 * @returns {Object} Strategy recommendations
 */
export function generateStrategyRecommendations(analysis) {
  // Extract key components from analysis
  const { overallPerformance, tokenStrategies, marketConditionAnalysis } = analysis;
  
  // Best overall strategies (top 3)
  const bestOverallStrategies = overallPerformance.rankedStrategies
    .filter(s => s.sells >= CONFIG.MIN_TRADES_FOR_ANALYSIS)
    .slice(0, 3);
  
  // Best strategies by market condition
  const bestByMarketCondition = {};
  
  for (const [condition, data] of Object.entries(marketConditionAnalysis)) {
    if (data.rankedStrategies?.length > 0) {
      bestByMarketCondition[condition] = data.rankedStrategies
        .filter(s => s.trades >= CONFIG.MIN_TRADES_FOR_ANALYSIS)
        .slice(0, 2); // Top 2 for each market condition
    }
  }
  
  // Token-specific strategy recommendations
  const tokenRecommendations = Object.entries(tokenStrategies)
    .filter(([_, data]) => data.bestStrategy && data.bestROI > 0)
    .map(([address, data]) => ({
      token: data.tokenName,
      address,
      recommendedStrategy: data.bestStrategy,
      expectedROI: data.bestROI,
      confidence: calculateConfidence(data)
    }))
    .sort((a, b) => b.expectedROI - a.expectedROI);
  
  return {
    timestamp: new Date().toISOString(),
    bestOverallStrategies,
    bestByMarketCondition,
    tokenRecommendations: tokenRecommendations.slice(0, 10), // Top 10 token recommendations
    summary: {
      analyzedStrategies: Object.keys(overallPerformance.strategyPerformance).length,
      analyzedTokens: Object.keys(tokenStrategies).length,
      totalTransactions: overallPerformance.totalTransactions
    }
  };
}

/**
 * Calculates confidence level for a token strategy recommendation
 * @param {Object} tokenData - Token strategy data
 * @returns {string} Confidence level (high, medium, low)
 */
function calculateConfidence(tokenData) {
  const strategy = tokenData.strategies[tokenData.bestStrategy];
  
  if (!strategy) return 'low';
  
  // Consider sample size, win rate, and consistency (stdDev)
  if (strategy.sells >= 10 && strategy.winRate >= 65 && strategy.stdDevROI < 20) {
    return 'high';
  } else if (strategy.sells >= 5 && strategy.winRate >= 50 && strategy.stdDevROI < 40) {
    return 'medium';
  } else {
    return 'low';
  }
}

/**
 * Performs comprehensive strategy analysis
 * @returns {Object} Complete analysis results
 */
export async function analyzeAllStrategies() {
  console.log(chalk.blue('Starting comprehensive strategy analysis...'));
  
  // Ensure output directory exists
  if (!fs.existsSync(CONFIG.OUTPUT_DIR)) {
    fs.mkdirSync(CONFIG.OUTPUT_DIR, { recursive: true });
  }
  
  // Extract transactions
  const transactions = extractTransactions();
  
  if (transactions.length === 0) {
    console.log(chalk.yellow('No transactions found for analysis'));
    return null;
  }
  
  // Read trade log data for token-level analysis
  const tradeLogData = readJsonFile(CONFIG.TRADE_LOG_PATH, { tokens: {} });
  const tokens = tradeLogData.tokens || {};
  
  // Analyze overall strategy performance
  const overallPerformance = analyzeOverallStrategyPerformance(transactions);
  
  // Analyze strategy performance by token
  const tokenStrategies = analyzeStrategyPerToken(tokens);
  
  // Stratify by market condition
  const { marketGroups } = stratifyByMarketCondition(transactions);
  
  // Analyze strategy performance by market condition
  const marketConditionAnalysis = {};
  
  for (const [condition, txs] of Object.entries(marketGroups)) {
    if (txs.length >= CONFIG.MIN_TRADES_FOR_ANALYSIS) {
      marketConditionAnalysis[condition] = analyzeStrategyForMarketCondition(txs, condition);
    }
  }
  
  // Generate recommendations
  const recommendations = generateStrategyRecommendations({
    overallPerformance,
    tokenStrategies,
    marketConditionAnalysis
  });
  
  // Compile complete analysis
  const analysis = {
    timestamp: new Date().toISOString(),
    summary: {
      totalTransactions: transactions.length,
      analyzedTokens: Object.keys(tokenStrategies).length,
      analyzedStrategies: Object.keys(overallPerformance.strategyPerformance).length
    },
    overallPerformance,
    tokenStrategies,
    marketConditionAnalysis,
    recommendations
  };
  
  // Save analysis results
  const outputPath = path.join(CONFIG.OUTPUT_DIR, `strategy_analysis_${Date.now()}.json`);
  writeJsonFile(outputPath, analysis);
  
  // Display summary
  displayStrategySummary(analysis);
  
  console.log(chalk.green(`\nAnalysis complete. Results saved to ${outputPath}`));
  return analysis;
}

/**
 * Displays a summary of strategy analysis results
 * @param {Object} analysis - Complete strategy analysis
 */
function displayStrategySummary(analysis) {
  console.log(chalk.cyan.bold('=== TRADING STRATEGY ANALYSIS ==='));
  
  // Display overall strategy performance
  console.log(chalk.yellow('\nOverall Strategy Performance:'));
  
  if (analysis.overallPerformance?.rankedStrategies?.length > 0) {
    const table = createTable(['Strategy', 'Trades', 'Win Rate', 'Avg ROI', 'Profit Factor', 'Net P/L']);
    
    for (const strategy of analysis.overallPerformance.rankedStrategies.slice(0, 5)) {
      const roiText = strategy.meanROI > 0 
        ? chalk.green(`+${strategy.meanROI.toFixed(2)}%`) 
        : chalk.red(`${strategy.meanROI.toFixed(2)}%`);
      
      const plText = strategy.netProfitLoss > 0 
        ? chalk.green(`+${strategy.netProfitLoss.toFixed(4)}`) 
        : chalk.red(`${strategy.netProfitLoss.toFixed(4)}`);
      
      table.push([
        strategy.strategy,
        `${strategy.sells}/${strategy.totalTrades}`,
        `${strategy.winRate.toFixed(1)}%`,
        roiText,
        strategy.profitFactor.toFixed(2),
        plText
      ]);
    }
    
    console.log(table.toString());
  } else {
    console.log(chalk.yellow('No strategy performance data available.'));
  }
  
  // Display market condition analysis
  console.log(chalk.yellow('\nBest Strategies by Market Condition:'));
  
  if (Object.keys(analysis.marketConditionAnalysis || {}).length > 0) {
    const table = createTable(['Market Condition', 'Best Strategy', 'Win Rate', 'Avg ROI', 'Trade Count']);
    
    for (const [condition, data] of Object.entries(analysis.marketConditionAnalysis)) {
      if (data.rankedStrategies?.length > 0) {
        const bestStrategy = data.rankedStrategies[0];
        
        const roiText = bestStrategy.meanROI > 0 
          ? chalk.green(`+${bestStrategy.meanROI.toFixed(2)}%`) 
          : chalk.red(`${bestStrategy.meanROI.toFixed(2)}%`);
        
        table.push([
          condition,
          bestStrategy.strategy,
          `${bestStrategy.winRate.toFixed(1)}%`,
          roiText,
          bestStrategy.trades.toString()
        ]);
      }
    }
    
    console.log(table.toString());
  } else {
    console.log(chalk.yellow('No market condition analysis available.'));
  }
  
  // Display token-specific recommendations
  console.log(chalk.yellow('\nTop Token-Specific Strategy Recommendations:'));
  
  if (analysis.recommendations?.tokenRecommendations?.length > 0) {
    const table = createTable(['Token', 'Strategy', 'Expected ROI', 'Confidence']);
    
    for (const rec of analysis.recommendations.tokenRecommendations.slice(0, 5)) {
      const roiText = rec.expectedROI > 0 
        ? chalk.green(`+${rec.expectedROI.toFixed(2)}%`) 
        : chalk.red(`${rec.expectedROI.toFixed(2)}%`);
      
      const confidenceText = 
        rec.confidence === 'high' ? chalk.green('High') :
        rec.confidence === 'medium' ? chalk.yellow('Medium') :
        chalk.red('Low');
      
      table.push([
        rec.token,
        rec.recommendedStrategy,
        roiText,
        confidenceText
      ]);
    }
    
    console.log(table.toString());
  } else {
    console.log(chalk.yellow('No token-specific recommendations available.'));
  }
}

// Run analysis if this script is run directly
if (import.meta.url === process.argv[1]) {
  analyzeAllStrategies().catch(err => {
    console.error(chalk.red('Error in strategy analyzer:'), err);
  });
}

// Export all functions
export default {
  stratifyByMarketCondition,
  analyzeStrategyForMarketCondition,
  analyzeStrategyPerToken,
  analyzeOverallStrategyPerformance,
  extractTransactions,
  generateStrategyRecommendations,
  analyzeAllStrategies,
  displayStrategySummary
};