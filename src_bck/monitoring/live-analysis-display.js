/**
 * live-analysis-display.js
 * 
 * Provides a real-time console-based visualization of trading data
 * with live updates and interactive components. Displays current
 * trades, performance metrics, and strategy effectiveness.
 */

import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { createTable, readJsonFile } from './token-analyzer-utils.js';
import { gatherInstanceData } from './performance-analyzer.js';
import { analyzeOverallStrategyPerformance, extractTransactions } from './strategy-analyzer.js';

// Configuration
const CONFIG = {
  TRADE_LOG_PATH: process.env.TRADE_LOG_PATH || path.join(process.cwd(), 'logs', 'trade_logs.json'),
  PROFIT_REPORT_PATH: process.env.PROFIT_REPORT_PATH || path.join(process.cwd(), 'logs', 'profit_report.json'),
  UPDATE_INTERVAL: parseInt(process.env.LIVE_UPDATE_INTERVAL || '5000'),
  MAX_RECENT_TRADES: parseInt(process.env.MAX_RECENT_TRADES || '10'),
  DEBUG: process.env.DEBUG === 'true'
};

// Track state between updates
let lastUpdateTime = 0;
let lastTxCount = 0;
let priceAlerts = [];

/**
 * Main function for displaying the live trading dashboard
 * @param {boolean} keepRunning - Whether to keep the display updating
 */
export async function startLiveMonitor(keepRunning = true) {
  console.clear();
  console.log(chalk.cyan.bold('=== KRYPTOBOT LIVE TRADING MONITOR ==='));
  console.log(chalk.gray(`Started at: ${new Date().toLocaleString()}`));
  console.log(chalk.gray('Press Ctrl+C to exit'));
  console.log('');
  
  try {
    // Get latest data
    const tradeLogData = readJsonFile(CONFIG.TRADE_LOG_PATH, { tokens: {}, stats: {} });
    const profitData = readJsonFile(CONFIG.PROFIT_REPORT_PATH, { summary: {}, tokens: [] });
    
    // Count transactions and tokens
    const allTransactions = extractTransactions(CONFIG.TRADE_LOG_PATH);
    const currentTxCount = allTransactions.length;
    const tokenCount = Object.keys(tradeLogData.tokens || {}).length;
    
    // Check for new transactions
    const newTxCount = currentTxCount - lastTxCount;
    lastTxCount = currentTxCount;
    
    // Display header with key stats
    console.log(chalk.yellow(`Active Tokens: ${tokenCount} | Total Trades: ${currentTxCount}${newTxCount > 0 ? ` (+${newTxCount} new)` : ''} | Last Update: ${new Date().toLocaleTimeString()}`));
    console.log('─'.repeat(process.stdout.columns || 80));
    
    // Display portfolio summary
    displayPortfolioSummary(profitData);
    
    // Display active positions
    displayActivePositions(tradeLogData);
    
    // Display recent trades
    displayRecentTrades(allTransactions);
    
    // Display alerts
    displayPriceAlerts();
    
    // Update timestamp
    lastUpdateTime = Date.now();
    
    // Schedule next update if in continuous mode
    if (keepRunning) {
      setTimeout(() => startLiveMonitor(true), CONFIG.UPDATE_INTERVAL);
    }
  } catch (error) {
    console.error(chalk.red(`Error in live monitor: ${error.message}`));
    
    if (keepRunning) {
      // Try to recover
      setTimeout(() => startLiveMonitor(true), CONFIG.UPDATE_INTERVAL);
    }
  }
}

/**
 * Displays overall portfolio summary
 * @param {Object} profitData - Data from profit report
 */
function displayPortfolioSummary(profitData) {
  const summary = profitData.summary || {};
  
  console.log(chalk.cyan.bold('\n📊 Portfolio Summary'));
  
  const table = createTable(['Metric', 'Value', 'Details']);
  
  // Total profit/loss
  const totalPL = summary.totalProfitLoss || 0;
  const plText = totalPL > 0 
    ? chalk.green(`+${totalPL.toFixed(4)} SOL`) 
    : chalk.red(`${totalPL.toFixed(4)} SOL`);
  
  // Total ROI
  const totalROI = summary.totalROI || 0;
  const roiText = totalROI > 0 
    ? chalk.green(`+${totalROI.toFixed(2)}%`) 
    : chalk.red(`${totalROI.toFixed(2)}%`);
  
  // Win rate
  const winRate = summary.winRate || 0;
  const winRateText = winRate >= 60 
    ? chalk.green(`${winRate.toFixed(1)}%`) 
    : winRate >= 45 
      ? chalk.yellow(`${winRate.toFixed(1)}%`) 
      : chalk.red(`${winRate.toFixed(1)}%`);
  
  // Add rows
  table.push(
    ['Total P/L', plText, `Invested: ${(summary.totalInvested || 0).toFixed(4)} SOL`],
    ['ROI', roiText, `Realized: ${(summary.totalRealizedPL || 0).toFixed(4)} SOL`],
    ['Win Rate', winRateText, `${summary.winningTrades || 0} wins / ${summary.losingTrades || 0} losses`]
  );
  
  console.log(table.toString());
}

/**
 * Displays active token positions
 * @param {Object} tradeLogData - Data from trade logs
 */
function displayActivePositions(tradeLogData) {
  const tokens = tradeLogData.tokens || {};
  const activeTokens = [];
  
  // Find tokens with non-zero current amount
  for (const [address, token] of Object.entries(tokens)) {
    if (token.currentAmount > 0) {
      activeTokens.push({
        address,
        name: token.tokenName || 'Unknown',
        amount: token.currentAmount,
        invested: token.initialInvestment || 0,
        avgBuyPrice: token.avgBuyPrice || 0,
        lastUpdateTime: token.lastUpdateTime || ''
      });
    }
  }
  
  console.log(chalk.cyan.bold(`\n💰 Active Positions (${activeTokens.length})`));
  
  if (activeTokens.length === 0) {
    console.log(chalk.gray('No active positions'));
    return;
  }
  
  // Sort by investment amount (highest first)
  activeTokens.sort((a, b) => b.invested - a.invested);
  
  const table = createTable(['Token', 'Amount', 'Invested', 'Avg Buy Price', 'Hold Time']);
  
  for (const token of activeTokens) {
    // Calculate hold time
    const holdTime = token.lastUpdateTime
      ? Math.floor((Date.now() - new Date(token.lastUpdateTime).getTime()) / (1000 * 60))
      : 0;
    
    const holdTimeText = holdTime >= 60
      ? `${Math.floor(holdTime / 60)}h ${holdTime % 60}m`
      : `${holdTime}m`;
    
    table.push([
      token.name,
      token.amount.toFixed(2),
      `${token.invested.toFixed(4)} SOL`,
      `${token.avgBuyPrice.toFixed(8)} SOL`,
      holdTimeText
    ]);
  }
  
  console.log(table.toString());
}

/**
 * Displays recent trades
 * @param {Array} transactions - All extracted transactions
 */
function displayRecentTrades(transactions) {
  // Sort by timestamp (newest first)
  const sortedTx = [...transactions].sort((a, b) => 
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
  
  // Take most recent trades
  const recentTrades = sortedTx.slice(0, CONFIG.MAX_RECENT_TRADES);
  
  console.log(chalk.cyan.bold(`\n📈 Recent Trades (${recentTrades.length})`));
  
  if (recentTrades.length === 0) {
    console.log(chalk.gray('No recent trades'));
    return;
  }
  
  const table = createTable(['Time', 'Token', 'Type', 'Amount', 'Price', 'Value']);
  
  for (const tx of recentTrades) {
    const time = new Date(tx.timestamp).toLocaleTimeString();
    const type = tx.type?.toLowerCase() || '';
    
    // Format type with colors
    const typeText = type === 'buy'
      ? chalk.blue('BUY')
      : type === 'sell'
        ? chalk.magenta('SELL')
        : type;
    
    // Format price and value
    const price = tx.pricePerToken || 0;
    const amount = tx.amount || 0;
    const value = price * amount;
    
    // Add row to table
    table.push([
      time,
      tx.tokenName || 'Unknown',
      typeText,
      amount.toFixed(2),
      `${price.toFixed(8)} SOL`,
      `${value.toFixed(4)} SOL`
    ]);
  }
  
  console.log(table.toString());
}

/**
 * Displays price alerts for monitored tokens
 */
function displayPriceAlerts() {
  if (priceAlerts.length === 0) {
    return;
  }
  
  console.log(chalk.cyan.bold(`\n⚠️ Price Alerts (${priceAlerts.length})`));
  
  const table = createTable(['Token', 'Alert Type', 'Current Price', 'Threshold', 'Time']);
  
  // Sort by time (newest first)
  const sortedAlerts = [...priceAlerts].sort((a, b) => b.time - a.time);
  
  // Take the 5 most recent alerts
  for (const alert of sortedAlerts.slice(0, 5)) {
    const time = new Date(alert.time).toLocaleTimeString();
    
    // Format alert type with colors
    const alertTypeText = alert.type === 'price_increase'
      ? chalk.green('PRICE ↑')
      : alert.type === 'price_decrease'
        ? chalk.red('PRICE ↓')
        : alert.type === 'take_profit'
          ? chalk.green('TAKE PROFIT')
          : alert.type === 'stop_loss'
            ? chalk.red('STOP LOSS')
            : alert.type;
    
    table.push([
      alert.tokenName,
      alertTypeText,
      `${alert.currentPrice.toFixed(8)} SOL`,
      `${alert.threshold.toFixed(8)} SOL`,
      time
    ]);
  }
  
  console.log(table.toString());
}

/**
 * Adds a new price alert
 * @param {string} tokenName - Token name
 * @param {string} type - Alert type (price_increase, price_decrease, take_profit, stop_loss)
 * @param {number} currentPrice - Current token price
 * @param {number} threshold - Alert threshold
 */
export function addPriceAlert(tokenName, type, currentPrice, threshold) {
  priceAlerts.push({
    tokenName,
    type,
    currentPrice,
    threshold,
    time: Date.now()
  });
  
  // Keep only last 20 alerts
  if (priceAlerts.length > 20) {
    priceAlerts = priceAlerts.slice(-20);
  }
}

/**
 * Displays a detailed analysis of a specific token
 * @param {string} tokenAddress - Token address to analyze
 */
export function showTokenDetails(tokenAddress) {
  try {
    console.clear();
    
    // Get trade data
    const tradeLogData = readJsonFile(CONFIG.TRADE_LOG_PATH, { tokens: {} });
    const token = tradeLogData.tokens[tokenAddress];
    
    if (!token) {
      console.log(chalk.red(`Token ${tokenAddress} not found in logs`));
      return;
    }
    
    // Display token header
    console.log(chalk.cyan.bold(`=== DETAILED ANALYSIS: ${token.tokenName} (${tokenAddress}) ===`));
    
    // Basic token info
    console.log(chalk.yellow('\nBasic Information:'));
    console.log(`Name: ${token.tokenName}`);
    console.log(`Current Amount: ${token.currentAmount}`);
    console.log(`Initial Investment: ${token.initialInvestment} SOL`);
    console.log(`Average Buy Price: ${token.avgBuyPrice} SOL`);
    
    // Trade history
    console.log(chalk.yellow('\nTrade History:'));
    
    if (!token.transactions || token.transactions.length === 0) {
      console.log(chalk.gray('No transactions found'));
    } else {
      const table = createTable(['Time', 'Type', 'Amount', 'Price', 'Value', 'ROI']);
      
      // Sort by timestamp (newest first)
      const sortedTx = [...token.transactions].sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      
      for (const tx of sortedTx) {
        const time = new Date(tx.timestamp).toLocaleTimeString();
        const type = tx.type?.toLowerCase() || '';
        
        // Format type with colors
        const typeText = type === 'buy'
          ? chalk.blue('BUY')
          : type === 'sell'
            ? chalk.magenta('SELL')
            : type;
        
        // Format price and value
        const price = tx.pricePerToken || 0;
        const amount = tx.amount || 0;
        const value = price * amount;
        
        // Format ROI if available (for sell transactions)
        let roiText = '';
        if (type === 'sell' && tx.roi !== undefined) {
          roiText = tx.roi > 0 
            ? chalk.green(`+${tx.roi.toFixed(2)}%`) 
            : chalk.red(`${tx.roi.toFixed(2)}%`);
        }
        
        // Add row to table
        table.push([
          time,
          typeText,
          amount.toFixed(2),
          `${price.toFixed(8)} SOL`,
          `${value.toFixed(4)} SOL`,
          roiText
        ]);
      }
      
      console.log(table.toString());
    }
    
    // Performance metrics
    console.log(chalk.yellow('\nPerformance Metrics:'));
    
    // Calculate metrics
    let totalBought = 0;
    let totalSold = 0;
    let buyCount = 0;
    let sellCount = 0;
    let profitableSells = 0;
    
    if (token.transactions) {
      for (const tx of token.transactions) {
        const type = tx.type?.toLowerCase() || '';
        const amount = tx.amount || 0;
        
        if (type === 'buy') {
          totalBought += amount;
          buyCount++;
        } else if (type === 'sell') {
          totalSold += amount;
          sellCount++;
          if ((tx.roi || 0) > 0) {
            profitableSells++;
          }
        }
      }
    }
    
    const winRate = sellCount > 0 ? (profitableSells / sellCount) * 100 : 0;
    
    // Display metrics
    console.log(`Total Bought: ${totalBought.toFixed(2)} tokens (${buyCount} transactions)`);
    console.log(`Total Sold: ${totalSold.toFixed(2)} tokens (${sellCount} transactions)`);
    console.log(`Win Rate: ${winRate.toFixed(1)}% (${profitableSells}/${sellCount} profitable sells)`);
    
    console.log('\nPress any key to return to the main monitor...');
    process.stdin.once('data', () => {
      startLiveMonitor(true);
    });
  } catch (error) {
    console.error(chalk.red(`Error displaying token details: ${error.message}`));
    setTimeout(() => startLiveMonitor(true), 5000);
  }
}

/**
 * Creates a market overview display with trend analysis
 */
export function showMarketOverview() {
  try {
    console.clear();
    console.log(chalk.cyan.bold('=== MARKET OVERVIEW ==='));
    
    // Get trade data
    const tradeLogData = readJsonFile(CONFIG.TRADE_LOG_PATH, { tokens: {} });
    const tokens = tradeLogData.tokens || {};
    
    // Calculate market statistics
    const tokenCount = Object.keys(tokens).length;
    const activeTokens = Object.values(tokens).filter(t => t.currentAmount > 0).length;
    const allTransactions = extractTransactions(CONFIG.TRADE_LOG_PATH);
    
    // Recent market activity (last 24 hours)
    const last24Hours = Date.now() - (24 * 60 * 60 * 1000);
    const recentTx = allTransactions.filter(tx => 
      new Date(tx.timestamp).getTime() > last24Hours
    );
    
    const recentBuys = recentTx.filter(tx => tx.type?.toLowerCase() === 'buy').length;
    const recentSells = recentTx.filter(tx => tx.type?.toLowerCase() === 'sell').length;
    
    // Display market summary
    console.log(chalk.yellow('\nMarket Activity:'));
    console.log(`Total Tokens: ${tokenCount} (${activeTokens} active positions)`);
    console.log(`24h Transactions: ${recentTx.length} (${recentBuys} buys, ${recentSells} sells)`);
    
    // Buy/Sell ratio trend
    const buyRatio = recentSells > 0 ? recentBuys / recentSells : recentBuys;
    
    let marketSentiment = '';
    if (buyRatio > 1.5) {
      marketSentiment = chalk.green('Bullish (strong buying pressure)');
    } else if (buyRatio > 1) {
      marketSentiment = chalk.green('Mildly Bullish');
    } else if (buyRatio > 0.8) {
      marketSentiment = chalk.yellow('Neutral');
    } else if (buyRatio > 0.5) {
      marketSentiment = chalk.red('Mildly Bearish');
    } else {
      marketSentiment = chalk.red('Bearish (strong selling pressure)');
    }
    
    console.log(`Market Sentiment: ${marketSentiment} (Buy/Sell Ratio: ${buyRatio.toFixed(2)})`);
    
    // Display hot tokens
    console.log(chalk.yellow('\nHot Tokens (Last 24h):'));
    
    // Group transactions by token
    const tokenActivity = {};
    for (const tx of recentTx) {
      if (!tx.tokenAddress) continue;
      
      if (!tokenActivity[tx.tokenAddress]) {
        tokenActivity[tx.tokenAddress] = {
          name: tx.tokenName || 'Unknown',
          buys: 0,
          sells: 0,
          volume: 0
        };
      }
      
      const type = tx.type?.toLowerCase() || '';
      if (type === 'buy') {
        tokenActivity[tx.tokenAddress].buys++;
      } else if (type === 'sell') {
        tokenActivity[tx.tokenAddress].sells++;
      }
      
      // Calculate volume
      const amount = tx.amount || 0;
      const price = tx.pricePerToken || 0;
      tokenActivity[tx.tokenAddress].volume += amount * price;
    }
    
    // Sort by volume
    const hotTokens = Object.entries(tokenActivity)
      .map(([address, data]) => ({ address, ...data }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 10); // Top 10
    
    if (hotTokens.length > 0) {
      const table = createTable(['Token', 'Buys', 'Sells', 'B/S Ratio', 'Volume (SOL)']);
      
      for (const token of hotTokens) {
        const bsRatio = token.sells > 0 ? token.buys / token.sells : token.buys;
        const bsRatioText = bsRatio > 1 
          ? chalk.green(bsRatio.toFixed(2)) 
          : chalk.red(bsRatio.toFixed(2));
        
        table.push([
          token.name,
          token.buys.toString(),
          token.sells.toString(),
          bsRatioText,
          token.volume.toFixed(4)
        ]);
      }
      
      console.log(table.toString());
    } else {
      console.log(chalk.gray('No active tokens in the last 24 hours'));
    }
    
    // Analyze strategy performance
    console.log(chalk.yellow('\nStrategy Performance (Last 24h):'));
    
    // Group by strategy
    const strategies = {};
    for (const tx of recentTx) {
      const strategy = tx.strategy || 'unknown';
      
      if (!strategies[strategy]) {
        strategies[strategy] = {
          buys: 0,
          sells: 0,
          profitableSells: 0,
          totalROI: 0
        };
      }
      
      const type = tx.type?.toLowerCase() || '';
      if (type === 'buy') {
        strategies[strategy].buys++;
      } else if (type === 'sell') {
        strategies[strategy].sells++;
        strategies[strategy].totalROI += tx.roi || 0;
        if ((tx.roi || 0) > 0) {
          strategies[strategy].profitableSells++;
        }
      }
    }
    
    // Calculate stats and build table
    if (Object.keys(strategies).length > 0) {
      const table = createTable(['Strategy', 'Trades', 'Win Rate', 'Avg ROI']);
      
      for (const [strategy, data] of Object.entries(strategies)) {
        if (data.sells === 0) continue;
        
        const winRate = (data.profitableSells / data.sells) * 100;
        const avgROI = data.totalROI / data.sells;
        
        const winRateText = winRate >= 60 
          ? chalk.green(`${winRate.toFixed(1)}%`) 
          : winRate >= 45 
            ? chalk.yellow(`${winRate.toFixed(1)}%`) 
            : chalk.red(`${winRate.toFixed(1)}%`);
        
        const roiText = avgROI > 0 
          ? chalk.green(`+${avgROI.toFixed(2)}%`) 
          : chalk.red(`${avgROI.toFixed(2)}%`);
        
        table.push([
          strategy,
          `${data.buys + data.sells} (${data.buys}/${data.sells})`,
          winRateText,
          roiText
        ]);
      }
      
      console.log(table.toString());
    } else {
      console.log(chalk.gray('No strategy data available'));
    }
    
    console.log('\nPress any key to return to the main monitor...');
    process.stdin.once('data', () => {
      startLiveMonitor(true);
    });
  } catch (error) {
    console.error(chalk.red(`Error displaying market overview: ${error.message}`));
    setTimeout(() => startLiveMonitor(true), 5000);
  }
}

/**
 * Creates an interactive terminal menu for the live monitor
 */
export function startInteractiveMonitor() {
  console.clear();
  console.log(chalk.cyan.bold('=== KRYPTOBOT INTERACTIVE MONITOR ==='));
  console.log(chalk.gray('Choose an option:'));
  
  const options = [
    { key: '1', label: 'Live Trading Monitor', action: () => startLiveMonitor(true) },
    { key: '2', label: 'Market Overview', action: () => showMarketOverview() },
    { key: '3', label: 'Strategy Analysis', action: () => showStrategyAnalysis() },
    { key: '4', label: 'Portfolio Performance', action: () => showPortfolioPerformance() },
    { key: '5', label: 'Search Token', action: () => promptTokenSearch() },
    { key: 'q', label: 'Quit', action: () => process.exit(0) }
  ];
  
  // Display menu
  for (const option of options) {
    console.log(`${chalk.yellow(option.key)}: ${option.label}`);
  }
  
  // Handle input
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  
  process.stdin.once('data', (key) => {
    const keyStr = String(key);
    
    // Find matching option
    const option = options.find(o => o.key === keyStr);
    
    if (option) {
      option.action();
    } else {
      // Invalid input, show menu again
      startInteractiveMonitor();
    }
  });
}

/**
 * Shows a comprehensive strategy analysis
 */
function showStrategyAnalysis() {
  try {
    console.clear();
    console.log(chalk.cyan.bold('=== STRATEGY ANALYSIS ==='));
    
    // Extract transactions
    const transactions = extractTransactions();
    
    if (transactions.length === 0) {
      console.log(chalk.yellow('No transactions found for analysis'));
      return;
    }
    
    // Analyze overall strategy performance
    const analysis = analyzeOverallStrategyPerformance(transactions);
    
    // Display strategy performance
    console.log(chalk.yellow('\nStrategy Performance Summary:'));
    
    if (analysis.rankedStrategies.length > 0) {
      const table = createTable(['Strategy', 'Trades', 'Win Rate', 'Avg ROI', 'Profit Factor', 'Hold Time']);
      
      for (const strategy of analysis.rankedStrategies) {
        const winRateText = strategy.winRate >= 60 
          ? chalk.green(`${strategy.winRate.toFixed(1)}%`) 
          : strategy.winRate >= 45 
            ? chalk.yellow(`${strategy.winRate.toFixed(1)}%`) 
            : chalk.red(`${strategy.winRate.toFixed(1)}%`);
        
        const roiText = strategy.meanROI > 0 
          ? chalk.green(`+${strategy.meanROI.toFixed(2)}%`) 
          : chalk.red(`${strategy.meanROI.toFixed(2)}%`);
        
        const holdTime = strategy.avgHoldTimeMin || 0;
        const holdTimeText = holdTime >= 60
          ? `${Math.floor(holdTime / 60)}h ${Math.floor(holdTime % 60)}m`
          : `${Math.floor(holdTime)}m`;
        
        table.push([
          strategy.strategy,
          `${strategy.sells}/${strategy.totalTrades}`,
          winRateText,
          roiText,
          strategy.profitFactor.toFixed(2),
          holdTimeText
        ]);
      }
      
      console.log(table.toString());
    } else {
      console.log(chalk.gray('No strategy performance data available'));
    }
    
    console.log('\nPress any key to return to the main menu...');
    process.stdin.once('data', () => {
      startInteractiveMonitor();
    });
  } catch (error) {
    console.error(chalk.red(`Error displaying strategy analysis: ${error.message}`));
    setTimeout(() => startInteractiveMonitor(), 5000);
  }
}

/**
 * Shows detailed portfolio performance metrics
 */
function showPortfolioPerformance() {
  try {
    console.clear();
    console.log(chalk.cyan.bold('=== PORTFOLIO PERFORMANCE ==='));
    
    // Get profit data
    const profitData = readJsonFile(CONFIG.PROFIT_REPORT_PATH, { summary: {}, tokens: [] });
    const summary = profitData.summary || {};
    const tokens = profitData.tokens || [];
    
    // Display overall performance
    console.log(chalk.yellow('\nOverall Performance:'));
    
    // Format metrics
    const totalPL = summary.totalProfitLoss || 0;
    const plText = totalPL > 0 
      ? chalk.green(`+${totalPL.toFixed(4)} SOL`) 
      : chalk.red(`${totalPL.toFixed(4)} SOL`);
    
    const totalROI = summary.totalROI || 0;
    const roiText = totalROI > 0 
      ? chalk.green(`+${totalROI.toFixed(2)}%`) 
      : chalk.red(`${totalROI.toFixed(2)}%`);
    
    const winRate = summary.winRate || 0;
    const winRateText = winRate >= 60 
      ? chalk.green(`${winRate.toFixed(1)}%`) 
      : winRate >= 45 
        ? chalk.yellow(`${winRate.toFixed(1)}%`) 
        : chalk.red(`${winRate.toFixed(1)}%`);
    
    // Display key metrics
    console.log(`Total P/L: ${plText}`);
    console.log(`Total ROI: ${roiText}`);
    console.log(`Win Rate: ${winRateText} (${summary.winningTrades || 0}/${summary.totalSells || 0})`);
    console.log(`Total Invested: ${(summary.totalInvested || 0).toFixed(4)} SOL`);
    console.log(`Realized P/L: ${(summary.totalRealizedPL || 0).toFixed(4)} SOL`);
    console.log(`Unrealized P/L: ${(summary.totalUnrealizedPL || 0).toFixed(4)} SOL`);
    
    // Display token performance
    console.log(chalk.yellow('\nToken Performance:'));
    
    if (tokens.length > 0) {
      const table = createTable(['Token', 'Invested', 'P/L', 'ROI', 'Status']);
      
      for (const token of tokens) {
        const plText = token.profitLoss > 0 
          ? chalk.green(`+${token.profitLoss.toFixed(4)}`) 
          : chalk.red(`${token.profitLoss.toFixed(4)}`);
        
        const roiText = token.roi > 0 
          ? chalk.green(`+${token.roi.toFixed(2)}%`) 
          : chalk.red(`${token.roi.toFixed(2)}%`);
        
        // Determine status based on remaining tokens
        const status = token.remainingTokens > 0
          ? chalk.blue('ACTIVE')
          : token.profitLoss > 0
            ? chalk.green('CLOSED (PROFIT)')
            : chalk.red('CLOSED (LOSS)');
        
        table.push([
          token.name,
          token.invested.toFixed(4),
          plText,
          roiText,
          status
        ]);
      }
      
      console.log(table.toString());
    } else {
      console.log(chalk.gray('No token performance data available'));
    }
    
    console.log('\nPress any key to return to the main menu...');
    process.stdin.once('data', () => {
      startInteractiveMonitor();
    });
  } catch (error) {
    console.error(chalk.red(`Error displaying portfolio performance: ${error.message}`));
    setTimeout(() => startInteractiveMonitor(), 5000);
  }
}

/**
 * Prompts for token search and displays details
 */
function promptTokenSearch() {
  console.clear();
  console.log(chalk.cyan.bold('=== TOKEN SEARCH ==='));
  console.log('Enter token name or address (or press Enter to go back):');
  
  // Prepare readline interface
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  rl.question('> ', (query) => {
    rl.close();
    
    if (!query.trim()) {
      startInteractiveMonitor();
      return;
    }
    
    // Search for token
    const tradeLogData = readJsonFile(CONFIG.TRADE_LOG_PATH, { tokens: {} });
    const tokens = tradeLogData.tokens || {};
    
    // Try to find by address
    if (tokens[query]) {
      showTokenDetails(query);
      return;
    }
    
    // Try to find by name
    const matchingTokens = Object.entries(tokens)
      .filter(([_, token]) => 
        token.tokenName && token.tokenName.toLowerCase().includes(query.toLowerCase())
      )
      .map(([address, token]) => ({ address, name: token.tokenName }));
    
    if (matchingTokens.length === 1) {
      // Exact match
      showTokenDetails(matchingTokens[0].address);
    } else if (matchingTokens.length > 1) {
      // Multiple matches, show selection
      console.clear();
      console.log(chalk.cyan.bold('=== MULTIPLE TOKENS FOUND ==='));
      console.log(chalk.yellow('Select a token:'));
      
      for (let i = 0; i < matchingTokens.length; i++) {
        console.log(`${i + 1}: ${matchingTokens[i].name} (${matchingTokens[i].address})`);
      }
      
      console.log(`${matchingTokens.length + 1}: Back to main menu`);
      
      // Handle selection
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      
      process.stdin.once('data', (key) => {
        const selection = parseInt(key);
        
        if (selection > 0 && selection <= matchingTokens.length) {
          showTokenDetails(matchingTokens[selection - 1].address);
        } else {
          startInteractiveMonitor();
        }
      });
    } else {
      // No matches
      console.log(chalk.red(`No tokens found matching "${query}"`));
      setTimeout(() => startInteractiveMonitor(), 3000);
    }
  });
}

// Run monitor if this script is run directly
if (import.meta.url === process.argv[1]) {
  startInteractiveMonitor();
}

// Export all functions
export default {
  startLiveMonitor,
  startInteractiveMonitor,
  showTokenDetails,
  showMarketOverview,
  addPriceAlert
};