/**
 * profit-tracker.js
 * Advanced performance tracking script for cryptocurrency trading
 * Uses FIFO accounting method for accurate P&L calculation and provides comprehensive analytics
 * 
 * Refactored for improved:
 * - Calculation accuracy
 * - Error handling
 * - Performance optimization
 * - Debugging capabilities
 */

import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
// Add the imports at the top of the file
import { createTable } from './token-analyzer-utils.js';

// Load environment variables
dotenv.config();

// Comprehensive configuration with sensible defaults and documentation
const CONFIG = {
  // File paths - Get from environment or use defaults that match Docker volume paths
  LOG_FILE_PATH: process.env.LOG_FILE_PATH || path.join(process.cwd(), 'logs', 'trade_logs.json'),
  PROFIT_REPORT_PATH: process.env.PROFIT_REPORT_PATH || path.join(process.cwd(), 'logs', 'profit_report.json'),
  
  // Performance settings
  CHECK_INTERVAL: parseInt(process.env.CHECK_INTERVAL || '5000'), // Interval in milliseconds
  
  // Calculation settings
  INCLUDE_SIMULATIONS: process.env.INCLUDE_SIMULATIONS !== 'false', // Include simulated transactions by default
  INCLUDE_DRY_RUNS: process.env.INCLUDE_DRY_RUNS !== 'false', // Include dry run transactions by default
  VALUE_REMAINING_WITH_LAST_PRICE: process.env.VALUE_REMAINING_WITH_LAST_PRICE !== 'false', // Use last known price for valuing remaining tokens
  PROFIT_LOSS_THRESHOLD: parseFloat(process.env.PROFIT_LOSS_THRESHOLD || '0.000001'), // Threshold to determine if a transaction is profitable/loss
  ROUNDING_PRECISION: parseInt(process.env.ROUNDING_PRECISION || '10'), // Precision for rounding to avoid floating point errors
  
  // Display and behavior settings
  DEBUG: process.env.DEBUG === 'true', // Enable detailed debug logging
  DETAILED_TOKEN_OUTPUT: process.env.DETAILED_TOKEN_OUTPUT === 'true', // Show detailed token info in console
  MAX_TOP_PERFORMERS: parseInt(process.env.MAX_TOP_PERFORMERS || '10'), // Maximum tokens to display in top performers list
};

/**
 * Precisely rounds a number to avoid floating point calculation errors
 * @param {number} num - Number to round
 * @param {number} [precision=CONFIG.ROUNDING_PRECISION] - Decimal precision to round to
 * @returns {number} Rounded number
 */
function roundNumber(num, precision = CONFIG.ROUNDING_PRECISION) {
  if (isNaN(num)) return 0;
  // Using Math.round with multiplier for more precise calculations
  return Math.round(num * Math.pow(10, precision)) / Math.pow(10, precision);
}

// Add a function to fetch the SOL/EUR rate (simplified example)
/**
 * Fetches the current SOL/EUR exchange rate
 * @returns {Promise<number>} Current SOL to EUR exchange rate
 */
async function getSOLtoEURRate() {
  try {
    // This would normally be an API call to a price service
    // For now using a hardcoded value
    return 110; // Example rate: 1 SOL = 125.75 EUR
  } catch (error) {
    console.error(chalk.red(`Error fetching SOL/EUR rate: ${error.message}`));
    return 120; // Fallback rate if fetch fails
  }
}

/**
 * Safely reads and parses the token log file
 * Handles file not found and JSON parsing errors gracefully
 * @returns {Object} Parsed token data or empty object if file doesn't exist/invalid
 */
function readTokenLogs() {
  try {
    // Check if log file exists
    if (!fs.existsSync(CONFIG.LOG_FILE_PATH)) {
      console.error(chalk.red(`Log file not found: ${CONFIG.LOG_FILE_PATH}`));
      return { tokens: {} };
    }
    
    // Read and parse the log file
    const data = fs.readFileSync(CONFIG.LOG_FILE_PATH, 'utf8');
    const parsedData = JSON.parse(data);
    
    if (CONFIG.DEBUG) {
      console.log(chalk.blue(`Successfully read log file with ${Object.keys(parsedData.tokens || {}).length} tokens`));
    }
    
    return parsedData;
  } catch (error) {
    console.error(chalk.red(`Error reading token log file: ${error.message}`));
    if (CONFIG.DEBUG) {
      console.error(chalk.yellow(`Stack trace: ${error.stack}`));
      // Attempt to read partial data if possible
      try {
        const rawData = fs.readFileSync(CONFIG.LOG_FILE_PATH, 'utf8');
        console.log(chalk.yellow(`Raw data preview (first 200 chars): ${rawData.substring(0, 200)}`));
      } catch (readError) {
        console.error(chalk.red(`Failed to read raw file data: ${readError.message}`));
      }
    }
    return { tokens: {} }; // Return empty token object on error
  }
}

/**
 * Normalizes transaction type to a consistent format
 * Converts any case/format of buy/sell to lowercase for consistent comparison
 * @param {string} type - Transaction type from log
 * @returns {string} Normalized lowercase transaction type
 */
function normalizeTransactionType(type) {
  if (!type) return '';
  // Convert to string and lowercase to handle any format (BUY, Buy, buy, etc.)
  return String(type).toLowerCase();
}

/**
 * Detects if a transaction is simulated or a dry run based on various possible formats
 * @param {Object} tx - Transaction object to analyze
 * @returns {Object} Object containing isSimulated and isDryRun flags
 */
function detectSimulationStatus(tx) {
  // Check various simulation status formats
  const isSimulated = 
    (tx.metadata?.simulation === true) || 
    (tx.isDryRun === true) || 
    (typeof tx.metadata === 'string' && tx.metadata.includes('simulation')) ||
    (typeof tx.roi === 'number' && typeof tx.isDryRun === 'boolean' && tx.isDryRun);
  
  // Check various dry run formats
  const isDryRun = 
    (typeof tx.isDryRun === 'string' && tx.isDryRun.startsWith('DRY_RUN_')) ||
    (typeof tx.metadata === 'string' && tx.metadata.includes('DRY_RUN_'));
  
  return { isSimulated, isDryRun };
}

/**
 * Extracts the correct price per token from a transaction
 * Handles different price formats and normalizes to price per token
 * @param {Object} tx - Transaction object
 * @returns {number} Price per token normalized to a consistent format
 */
function extractPrice(tx) {
  // Direct price per token is preferred if available
  if (tx.pricePerToken) {
    return Number(tx.pricePerToken);
  } 
  // Calculate price per token from total price and amount if available
  else if (tx.priceSOL && tx.amount && Number(tx.amount) > 0) {
    return roundNumber(Number(tx.priceSOL) / Number(tx.amount));
  } 
  // Return 0 if no valid price information is available
  else {
    return 0;
  }
}

/**
 * Calculates the median value from an array of numbers
 * @param {Array<number>} arr - Array of numbers
 * @returns {number} Median value or 0 if array is empty
 */
function calculateMedian(arr) {
  if (!arr.length) return 0;
  
  // Sort array numerically
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  
  // Handle even and odd length arrays differently for median calculation
  return sorted.length % 2 !== 0 
    ? sorted[mid] 
    : roundNumber((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Calculates profit, loss, and performance metrics for a token based on its transactions
 * Uses FIFO (First In, First Out) accounting method for accurate cost basis calculation
 * @param {string} address - Token address
 * @param {Object} token - Token data including transactions
 * @returns {Object} Detailed performance metrics for the token
 */
function calculateTokenPerformance(address, token) {
  // FIFO queue to track buy transactions
  let buyQueue = [];
  
  // Token performance metrics
  let currentAmount = 0;
  let totalInvestedToken = 0;
  let totalReceivedToken = 0;
  let realizedPLToken = 0;
  let unrealizedPLToken = 0;
  let tokenBuyCount = 0;
  let tokenSellCount = 0;
  let tokenBuyAmount = 0;
  let tokenSellAmount = 0;
  let winningTradesToken = 0;
  let losingTradesToken = 0;
  let breakEvenTradesToken = 0;
  let simulatedTradesToken = 0;
  let dryRunTradesToken = 0;
  let currentMarketPrice = 0;
  
  // Arrays for price tracking
  const buyPrices = [];
  const sellPrices = [];
  
  // Sort transactions chronologically to maintain FIFO order
  const transactions = token.transactions?.length > 0 
    ? [...token.transactions].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    : [];
  
  if (CONFIG.DEBUG) {
    console.log(chalk.blue(`Processing ${token.tokenName || address} with ${transactions.length} transactions`));
  }
  
  // Process each transaction in chronological order
  for (const tx of transactions) {
    try {
      // Normalize transaction type and check simulation status
      const txType = normalizeTransactionType(tx.type);
      const { isSimulated, isDryRun } = detectSimulationStatus(tx);
      
      // Skip simulated transactions if configured to exclude them
      if (isSimulated && !CONFIG.INCLUDE_SIMULATIONS) {
        if (CONFIG.DEBUG) {
          console.log(chalk.yellow(`Skipping simulated transaction: ${JSON.stringify(tx)}`));
        }
        continue;
      }
      
      // Skip dry run transactions if configured to exclude them
      if (isDryRun && !CONFIG.INCLUDE_DRY_RUNS) {
        if (CONFIG.DEBUG) {
          console.log(chalk.yellow(`Skipping dry run transaction: ${JSON.stringify(tx)}`));
        }
        continue;
      }
      
      // Process BUY transactions
      if (txType === 'buy') {
        const amount = Number(tx.amount);
        const price = extractPrice(tx);
        
        // Validate transaction data
        if (isNaN(amount) || isNaN(price) || amount <= 0 || price < 0) {
          if (CONFIG.DEBUG) {
            console.log(chalk.red(`Skipping invalid buy transaction: ${JSON.stringify(tx)}`));
          }
          continue;
        }
        
        // Calculate total cost
        const cost = roundNumber(amount * price);
        
        // Add to FIFO queue for cost basis tracking
        buyQueue.push({
          amount,
          price,
          cost,
          remainingAmount: amount,
          timestamp: tx.timestamp,
          isSimulated,
          isDryRun
        });
        
        // Update token metrics
        currentAmount = roundNumber(currentAmount + amount);
        totalInvestedToken = roundNumber(totalInvestedToken + cost);
        tokenBuyCount++;
        tokenBuyAmount = roundNumber(tokenBuyAmount + amount);
        buyPrices.push(price);
        
        // Update current market price
        currentMarketPrice = price;
        
        if (CONFIG.DEBUG) {
          console.log(chalk.green(
            `Buy: ${amount.toFixed(4)} tokens @ ${price.toFixed(8)} SOL = ${cost.toFixed(4)} SOL` +
            `${isSimulated ? ' (Simulated)' : ''}${isDryRun ? ' (Dry Run)' : ''}`
          ));
        }
      } 
      // Process SELL transactions
      else if (txType === 'sell') {
        const amount = Number(tx.amount);
        const price = extractPrice(tx);
        
        // Validate transaction data
        if (isNaN(amount) || isNaN(price) || amount <= 0 || price < 0 || currentAmount < amount) {
          if (CONFIG.DEBUG) {
            console.log(chalk.red(`Skipping invalid sell transaction: ${JSON.stringify(tx)}`));
          }
          continue;
        }
        
        // Track simulation and dry run status
        if (isSimulated) simulatedTradesToken++;
        if (isDryRun) dryRunTradesToken++;
        
        // Calculate total proceeds from sale
        const proceeds = roundNumber(amount * price);
        
        // Update current market price (except for dry runs)
        if (!isDryRun) {
          currentMarketPrice = price;
        }
        
        // FIFO matching of buy orders to calculate cost basis and profit/loss
        let amountToSell = amount;
        let costBasis = 0;
        let tradeProfitLoss = 0;
        
        // Match sells against buys in FIFO order
        while (amountToSell > 0 && buyQueue.length > 0) {
          const oldestBuy = buyQueue[0];
          const sellAmount = Math.min(amountToSell, oldestBuy.remainingAmount);
          
          // Calculate cost basis and profit for this portion
          const portionCostBasis = roundNumber(sellAmount * oldestBuy.price);
          const portionProceeds = roundNumber(sellAmount * price);
          const portionProfit = roundNumber(portionProceeds - portionCostBasis);
          
          // Accumulate totals for this transaction
          costBasis = roundNumber(costBasis + portionCostBasis);
          tradeProfitLoss = roundNumber(tradeProfitLoss + portionProfit);
          
          // Update remaining amounts
          amountToSell = roundNumber(amountToSell - sellAmount);
          oldestBuy.remainingAmount = roundNumber(oldestBuy.remainingAmount - sellAmount);
          
          // Remove buy from queue if completely sold
          if (oldestBuy.remainingAmount <= CONFIG.PROFIT_LOSS_THRESHOLD) {
            oldestBuy.remainingAmount = 0; // Set to exact zero to avoid precision issues
            buyQueue.shift();
          }
        }
        
        // Classify trade as winning, losing, or break-even
        if (tradeProfitLoss > CONFIG.PROFIT_LOSS_THRESHOLD) {
          winningTradesToken++;
        } else if (tradeProfitLoss < -CONFIG.PROFIT_LOSS_THRESHOLD) {
          losingTradesToken++;
        } else {
          breakEvenTradesToken++;
        }
        
        // Update token metrics
        currentAmount = roundNumber(currentAmount - amount);
        totalReceivedToken = roundNumber(totalReceivedToken + proceeds);
        realizedPLToken = roundNumber(realizedPLToken + tradeProfitLoss);
        tokenSellCount++;
        tokenSellAmount = roundNumber(tokenSellAmount + amount);
        sellPrices.push(price);
        
        if (CONFIG.DEBUG) {
          const roi = costBasis > 0 ? roundNumber((tradeProfitLoss / costBasis) * 100) : 0;
          console.log(chalk.cyan(
            `Sell: ${amount.toFixed(4)} tokens @ ${price.toFixed(8)} SOL = ${proceeds.toFixed(4)} SOL` +
            `${isSimulated ? ' (Simulated)' : ''}${isDryRun ? ' (Dry Run)' : ''}\n` +
            `  Cost basis: ${costBasis.toFixed(4)} SOL, P/L: ${tradeProfitLoss.toFixed(4)} SOL (${roi.toFixed(2)}%)`
          ));
        }
      }
    } catch (error) {
      console.error(chalk.red(`Error processing transaction for ${token.tokenName || address}: ${error.message}`));
      if (CONFIG.DEBUG) {
        console.error(chalk.yellow(`Transaction data: ${JSON.stringify(tx)}`));
        console.error(chalk.yellow(`Error details: ${error.stack}`));
      }
    }
  }
  
  // Calculate remaining token valuation
  const remainingBuyValue = roundNumber(
    buyQueue.reduce((sum, buy) => 
      roundNumber(sum + roundNumber(buy.remainingAmount * buy.price)), 0)
  );
  
  // Calculate average buy price for remaining tokens
  const averageBuyPrice = currentAmount > 0 
    ? roundNumber(remainingBuyValue / currentAmount) 
    : 0;
  
  // Determine price to use for valuing remaining tokens
  const currentTokenPrice = CONFIG.VALUE_REMAINING_WITH_LAST_PRICE 
    ? currentMarketPrice 
    : averageBuyPrice;
  
  // Calculate current value of remaining tokens
  const remainingValue = roundNumber(currentAmount * currentTokenPrice);
  
  // Calculate unrealized profit/loss
  unrealizedPLToken = roundNumber(remainingValue - remainingBuyValue);
  
  // Calculate total profit/loss and ROI
  const totalProfitLossToken = roundNumber(realizedPLToken + unrealizedPLToken);
  const tokenROI = totalInvestedToken > 0 
    ? roundNumber((totalProfitLossToken / totalInvestedToken) * 100)
    : 0;
  
  // Calculate median prices
  const medianBuyPrice = calculateMedian(buyPrices);
  const medianSellPrice = calculateMedian(sellPrices);
  
  // Validation check for calculation consistency
  if (CONFIG.DEBUG) {
    const calculatedProfit = roundNumber(totalReceivedToken + remainingValue - totalInvestedToken);
    if (Math.abs(calculatedProfit - totalProfitLossToken) > 0.001) {
      console.log(chalk.yellow(
        `WARNING: Profit calculation inconsistency for ${token.tokenName || address}:\n` +
        `  Calculated: ${calculatedProfit.toFixed(4)}, Tracked: ${totalProfitLossToken.toFixed(4)}\n` +
        `  Difference: ${(calculatedProfit - totalProfitLossToken).toFixed(4)}`
      ));
    }
  }
  
  // Return comprehensive token performance metrics
  return {
    address,
    name: token.tokenName || 'Unknown',
    invested: totalInvestedToken,
    received: totalReceivedToken,
    remainingTokens: currentAmount,
    remainingValue,
    remainingBuyValue,
    realizedPL: realizedPLToken,
    unrealizedPL: unrealizedPLToken,
    profitLoss: totalProfitLossToken,
    roi: tokenROI,
    buyCount: tokenBuyCount,
    sellCount: tokenSellCount,
    buyAmount: tokenBuyAmount,
    sellAmount: tokenSellAmount,
    medianBuyPrice,
    medianSellPrice,
    winningTrades: winningTradesToken,
    losingTrades: losingTradesToken,
    breakEvenTrades: breakEvenTradesToken,
    simulatedTrades: simulatedTradesToken,
    dryRunTrades: dryRunTradesToken,
    winRate: tokenSellCount > 0 
      ? roundNumber((winningTradesToken / tokenSellCount) * 100)
      : 0,
    averageBuyPrice,
    lastPrice: currentMarketPrice
  };
}

/**
 * Calculates comprehensive profit and performance metrics across all tokens
 * @param {Object} tokenData - Data for all tokens from log file
 * @returns {Object} Comprehensive profit report with summary and per-token detail
 */
function calculateProfit(tokenData) {
  // Global counters
  let totalInvested = 0;
  let totalReceived = 0;
  let totalRemainingValue = 0;
  let totalProfitLoss = 0;
  let tokenCount = 0;
  let activeHoldings = 0;
  let activeSales = 0;
  
  // Transaction counters
  let totalBuys = 0;
  let totalBuyAmount = 0;
  let totalSells = 0;
  let totalSellAmount = 0;
  let winningTrades = 0;
  let losingTrades = 0;
  let breakEvenTrades = 0;
  let simulatedTrades = 0;
  let dryRunTrades = 0;
  
  // Price tracking arrays
  let allBuyPrices = [];
  let allSellPrices = [];
  
  // Token details array
  const tokenDetails = [];
  
  // Process each token
  if (tokenData.tokens) {
    tokenCount = Object.keys(tokenData.tokens).length;
    
    for (const [address, token] of Object.entries(tokenData.tokens)) {
      // Calculate performance metrics for this token
      const tokenPerformance = calculateTokenPerformance(address, token);
      tokenDetails.push(tokenPerformance);
      
      // Update global counters
      totalInvested = roundNumber(totalInvested + tokenPerformance.invested);
      totalReceived = roundNumber(totalReceived + tokenPerformance.received);
      totalRemainingValue = roundNumber(totalRemainingValue + tokenPerformance.remainingValue);
      totalProfitLoss = roundNumber(totalProfitLoss + tokenPerformance.profitLoss);
      
      // Update global transaction counters
      totalBuys += tokenPerformance.buyCount;
      totalBuyAmount = roundNumber(totalBuyAmount + tokenPerformance.buyAmount);
      totalSells += tokenPerformance.sellCount;
      totalSellAmount = roundNumber(totalSellAmount + tokenPerformance.sellAmount);
      winningTrades += tokenPerformance.winningTrades;
      losingTrades += tokenPerformance.losingTrades;
      breakEvenTrades += tokenPerformance.breakEvenTrades;
      simulatedTrades += tokenPerformance.simulatedTrades;
      dryRunTrades += tokenPerformance.dryRunTrades;
      
      // Update position tracking
      if (tokenPerformance.remainingTokens > 0) activeHoldings++;
      if (tokenPerformance.sellCount > 0) activeSales++;
      
      // Collect prices for median calculation
      if (tokenPerformance.buyCount > 0 && tokenPerformance.medianBuyPrice > 0) {
        allBuyPrices.push(...Array(tokenPerformance.buyCount).fill(tokenPerformance.medianBuyPrice));
      }
      
      if (tokenPerformance.sellCount > 0 && tokenPerformance.medianSellPrice > 0) {
        allSellPrices.push(...Array(tokenPerformance.sellCount).fill(tokenPerformance.medianSellPrice));
      }
    }
  }
  
  // Calculate global derived metrics
  const totalRemainingCostBasis = roundNumber(
    tokenDetails.reduce((sum, token) => roundNumber(sum + token.remainingBuyValue), 0)
  );
  
  const totalSoldCostBasis = roundNumber(totalInvested - totalRemainingCostBasis);
  
  const totalRealizedPL = roundNumber(
    tokenDetails.reduce((sum, token) => roundNumber(sum + token.realizedPL), 0)
  );
  
  const totalUnrealizedPL = roundNumber(
    tokenDetails.reduce((sum, token) => roundNumber(sum + token.unrealizedPL), 0)
  );
  
  // Validation check for global calculation consistency
  if (CONFIG.DEBUG) {
    if (Math.abs(totalRealizedPL + totalUnrealizedPL - totalProfitLoss) > 0.001) {
      console.log(chalk.yellow(
        `WARNING: Global profit calculation inconsistency:\n` +
        `  Realized + Unrealized: ${(totalRealizedPL + totalUnrealizedPL).toFixed(4)}, Total: ${totalProfitLoss.toFixed(4)}\n` +
        `  Difference: ${((totalRealizedPL + totalUnrealizedPL) - totalProfitLoss).toFixed(4)}`
      ));
    }
  }
  
  // Calculate final global metrics
  const totalROI = totalInvested > 0 ? roundNumber((totalProfitLoss / totalInvested) * 100) : 0;
  const completedTrades = winningTrades + losingTrades + breakEvenTrades;
  const winRate = completedTrades > 0 ? roundNumber((winningTrades / completedTrades) * 100) : 0;
  
  // Sort tokens by profitability
  const sortedTokenDetails = tokenDetails.sort((a, b) => b.profitLoss - a.profitLoss);
  
  // Build and return comprehensive report
  return {
    timestamp: new Date().toISOString(),
    summary: {
      totalInvested,
      totalReceived,
      totalRemainingValue,
      totalProfitLoss,
      totalRealizedPL,
      totalUnrealizedPL,
      totalROI,
      tokenCount,
      activeHoldings,
      activeSales,
      totalBuys,
      totalBuyAmount,
      totalSells,
      totalSellAmount,
      totalSoldCostBasis,
      totalRemainingCostBasis,
      winningTrades,
      losingTrades,
      breakEvenTrades,
      simulatedTrades,
      dryRunTrades,
      winRate,
      medianBuyPrice: calculateMedian(allBuyPrices),
      medianSellPrice: calculateMedian(allSellPrices),
      includingSimulations: CONFIG.INCLUDE_SIMULATIONS,
      includingDryRuns: CONFIG.INCLUDE_DRY_RUNS
    },
    tokens: sortedTokenDetails
  };
}

/**
 * Formats a number as currency with specified decimals
 * @param {number} num - Number to format
 * @param {number} [decimals=4] - Decimal places to show
 * @returns {string} Formatted number with fixed decimal places
 */
function formatNumber(num, decimals = 4) {
  return num.toFixed(decimals);
}

/**
 * Displays token performance details
 * @param {Object} token - Token performance data
 * @param {number} index - Display index
 * @param {number} eurRate - Current SOL to EUR exchange rate
 */
function displayTokenDetails(token, index, eurRate) {
  // Calculate EUR values
  const plEUR = token.profitLoss * eurRate;
  
  // Format profit/loss text with appropriate color
  const profitText = token.profitLoss > 0 
    ? chalk.green(`+${formatNumber(token.profitLoss)} SOL (+${formatNumber(token.roi, 2)}%)`)
    : chalk.red(`${formatNumber(token.profitLoss)} SOL (${formatNumber(token.roi, 2)}%)`);
  
  // Format buy/sell statistics (simplified)
  const tradeStats = `[Buys: ${token.buyCount} (${formatNumber(token.buyAmount, 2)} tokens), ` + 
                     `Sells: ${token.sellCount} (${formatNumber(token.sellAmount, 2)} tokens)]`;
  
  // Format win/loss statistics with colored win rate
  const winRateColored = token.winRate >= 70 ? 
    chalk.green(`${formatNumber(token.winRate, 2)}%`) : 
    (token.winRate >= 50 ? 
      chalk.yellow(`${formatNumber(token.winRate, 2)}%`) : 
      chalk.red(`${formatNumber(token.winRate, 2)}%`));
  
  // Calculate win/loss in EUR
  const winLossText = token.profitLoss > 0 
    ? chalk.green(`WIN ${formatNumber(token.profitLoss)} SOL = ${formatNumber(plEUR, 2)} EUR`)
    : chalk.red(`LOSS ${formatNumber(Math.abs(token.profitLoss))} SOL = ${formatNumber(Math.abs(plEUR), 2)} EUR`);
  
  // Print token details in simplified format
  console.log(`${token.name}: ${profitText} ${tradeStats} [${token.winningTrades} wins, ${token.losingTrades} losses, ${winRateColored} win rate] ${winLossText}`);
}

/**
 * Displays token performance details
 * @param {Object} token - Token performance data
 * @param {number} index - Display index
 */
function displayTokenDetails__(token, index) {
  // Format profit/loss text with appropriate color
  const profitText = token.profitLoss > 0 
    ? chalk.green(`+${formatNumber(token.profitLoss)} SOL (+${formatNumber(token.roi, 2)}%)`)
    : chalk.red(`${formatNumber(token.profitLoss)} SOL (${formatNumber(token.roi, 2)}%)`);
  
  // Format buy/sell statistics with prices
  const buyPriceInfo = token.medianBuyPrice > 0 ? ` @ ${formatNumber(token.medianBuyPrice, 6)} SOL` : '';
  const sellPriceInfo = token.medianSellPrice > 0 ? ` @ ${formatNumber(token.medianSellPrice, 6)} SOL` : '';
  
  const tradeStats = `[Buys: ${token.buyCount} (${formatNumber(token.buyAmount, 2)} tokens${buyPriceInfo}), ` + 
                     `Sells: ${token.sellCount} (${formatNumber(token.sellAmount, 2)} tokens${sellPriceInfo})]`;
  
  // Format win/loss statistics
  // Format win/loss statistics with colored win rate
  const winRateColored = token.winRate >= 70 ? 
  chalk.green(`${formatNumber(token.winRate, 2)}%`) : 
  (token.winRate >= 50 ? 
    chalk.yellow(`${formatNumber(token.winRate, 2)}%`) : 
    chalk.red(`${formatNumber(token.winRate, 2)}%`));

  const winStats = `[${token.winningTrades} wins, ${token.losingTrades} losses, ${winRateColored} win rate]`;
  
  // Print token details row
  console.log(`${index + 1}. ${token.name}: ${profitText} ${tradeStats} ${winStats}`);
  
  // If detailed output is enabled, show breakdown of realized vs unrealized
  if (CONFIG.DETAILED_TOKEN_OUTPUT) {
    const realizedText = token.realizedPL > 0 
      ? chalk.green(`+${formatNumber(token.realizedPL)} SOL`)
      : chalk.red(`${formatNumber(token.realizedPL)} SOL`);
      
    const unrealizedText = token.unrealizedPL > 0 
      ? chalk.green(`+${formatNumber(token.unrealizedPL)} SOL`)
      : chalk.red(`${formatNumber(token.unrealizedPL)} SOL`);
    
    console.log(`   Realized: ${realizedText}, Unrealized: ${unrealizedText}, ` +
                `Remaining: ${formatNumber(token.remainingTokens)} tokens @ ${formatNumber(token.lastPrice, 8)} SOL`);
  }
}

/**
 * Saves the profit report to file and displays summary to console using formatted tables
 * @param {Object} report - Generated profit report
 */
async function saveReport(report) {
  try {
    // Save report to file
    fs.writeFileSync(CONFIG.PROFIT_REPORT_PATH, JSON.stringify(report, null, 2));
    
    // Get SOL/EUR rate
    const eurRate = await getSOLtoEURRate();
    
    // Log the report path
    if (CONFIG.DEBUG) {
      console.log(chalk.blue(`Profit report saved to: ${CONFIG.PROFIT_REPORT_PATH}`));
      console.log(chalk.blue(`Using SOL/EUR rate: ${eurRate}`));
    }
    
    // Get summary data for display
    const { summary } = report;
    
    // Display header
    console.log('='.repeat(80));
    console.log(chalk.bold('PROFIT SUMMARY (FIFO ACCOUNTING METHOD)'));
    console.log('='.repeat(80));
    
    // Create summary table
    const summaryTable = createTable(['Metric', 'SOL Value', 'EUR Value']);
    
    // Add summary rows
    summaryTable.push(
      ['Total Invested', `${formatNumber(summary.totalInvested)} SOL`, `${formatNumber(summary.totalInvested * eurRate, 2)} EUR`],
      ['Total Received', `${formatNumber(summary.totalReceived)} SOL`, `${formatNumber(summary.totalReceived * eurRate, 2)} EUR`],
      ['Remaining Value', `${formatNumber(summary.totalRemainingValue)} SOL`, `${formatNumber(summary.totalRemainingValue * eurRate, 2)} EUR`]
    );
    
    // Add profit/loss rows with appropriate colors
    if (summary.totalProfitLoss > 0) {
      summaryTable.push(
        ['TOTAL PROFIT', chalk.green(`+${formatNumber(summary.totalProfitLoss)} SOL (+${formatNumber(summary.totalROI, 2)}%)`), 
         chalk.green(`+${formatNumber(summary.totalProfitLoss * eurRate, 2)} EUR`)]
      );
    } else {
      summaryTable.push(
        ['TOTAL LOSS', chalk.red(`${formatNumber(summary.totalProfitLoss)} SOL (${formatNumber(summary.totalROI, 2)}%)`), 
         chalk.red(`${formatNumber(summary.totalProfitLoss * eurRate, 2)} EUR`)]
      );
    }
    
    // Display the summary table
    console.log(summaryTable.toString());
    
    // Display token statistics
    console.log(chalk.blue(`\nTokens tracked: ${summary.tokenCount} (${summary.activeHoldings} active holdings, ${summary.activeSales} with sales)`));
    
    // Display transaction information
    console.log(chalk.blue(`Transactions: ${summary.totalBuys} buys, ${summary.totalSells} sells`));
    
    // Display win/loss statistics
    console.log(chalk.blue(`Performance: ${summary.winningTrades} winning trades, ${summary.losingTrades} losing trades, ` +
                          `${summary.breakEvenTrades} breakeven (${formatNumber(summary.winRate, 2)}% win rate)`));
    
    console.log('='.repeat(80));
    
    // Display all tokens in a formatted table
    if (report.tokens.length > 0) {
      console.log(chalk.bold('\nALL TOKENS PERFORMANCE:'));
      
      // Create token table with all relevant columns
      const tokenTable = createTable([
        'Token', 'P/L (SOL)', 'P/L (%)', 'Transactions', 'Win/Loss', 'Win Rate', 'Value (EUR)'
      ]);
      
      // Add each token to the table
      for (let i = 0; i < report.tokens.length; i++) {
        const token = report.tokens[i];
        const plEUR = token.profitLoss * eurRate;
        
        // Format the profit/loss for display
        const plSOL = token.profitLoss > 0 
          ? chalk.green(`+${formatNumber(token.profitLoss)}`) 
          : chalk.red(`${formatNumber(token.profitLoss)}`);
        
        const plPercent = token.roi > 0 
          ? chalk.green(`+${formatNumber(token.roi, 2)}%`) 
          : chalk.red(`${formatNumber(token.roi, 2)}%`);
        
        // Format transactions info
        const txInfo = `B:${token.buyCount} (${formatNumber(token.buyAmount, 0)}) / S:${token.sellCount} (${formatNumber(token.sellAmount, 0)})`;
        
        // Format win/loss stats
        const winLoss = `${token.winningTrades}/${token.losingTrades}`;
        
        // Format win rate with colors
        const winRateColored = token.winRate >= 70 ? 
          chalk.green(`${formatNumber(token.winRate, 2)}%`) : 
          (token.winRate >= 50 ? 
            chalk.yellow(`${formatNumber(token.winRate, 2)}%`) : 
            chalk.red(`${formatNumber(token.winRate, 2)}%`));
        
        // Format EUR value
        const eurValue = plEUR > 0 
          ? chalk.green(`+${formatNumber(plEUR, 2)}`) 
          : chalk.red(`${formatNumber(plEUR, 2)}`);
        
        // Add row to the table
        tokenTable.push([
          token.name,
          plSOL,
          plPercent,
          txInfo,
          winLoss,
          winRateColored,
          eurValue
        ]);
      }
      
      // Display the token table
      console.log(tokenTable.toString());
      
      // Display individual token details in the requested format
      console.log(chalk.bold('\nDETAILED TOKEN PERFORMANCE:'));
      for (let i = 0; i < report.tokens.length; i++) {
        displayTokenDetails(report.tokens[i], i, eurRate);
      }
    }
  } catch (error) {
    console.error(chalk.red(`Error saving profit report: ${error.message}`));
    if (CONFIG.DEBUG) {
      console.error(chalk.yellow(`Stack trace: ${error.stack}`));
    }
  }
}

// Update updateProfitReport to handle async saveReport
function updateProfitReport() {
  try {
    if (CONFIG.DEBUG) {
      console.log(chalk.blue('Updating profit report...'));
      const startTime = Date.now();
      
      // Read token log data
      const tokenData = readTokenLogs();
      const readTime = Date.now();
      console.log(chalk.blue(`Read log data in ${readTime - startTime}ms, processing ${Object.keys(tokenData.tokens || {}).length} tokens`));
      
      // Calculate profits and performance metrics
      const report = calculateProfit(tokenData);
      const calcTime = Date.now();
      console.log(chalk.blue(`Calculated profit data in ${calcTime - readTime}ms`));
      
      // Save and display report (now async)
      saveReport(report).then(() => {
        console.log(chalk.blue(`Total update completed in ${Date.now() - startTime}ms`));
      });
    } else {
      // Regular execution without timing details
      const tokenData = readTokenLogs();
      const report = calculateProfit(tokenData);
      saveReport(report); // Now async but we don't need to await it here
    }
  } catch (error) {
    console.error(chalk.red(`Error updating profit report: ${error.message}`));
    if (CONFIG.DEBUG) {
      console.error(chalk.yellow(`Stack trace: ${error.stack}`));
    }
  }
}

// Fonction d'initialisation
function init() {
  console.log(chalk.green('='.repeat(80)));
  console.log(chalk.green('DÉMARRAGE DU SUIVI DES PROFITS SOLANA - VERSION CORRIGÉE (MÉTHODE FIFO)'));
  console.log(chalk.green('='.repeat(80)));
  console.log(`Fichier de logs source: ${CONFIG.LOG_FILE_PATH}`);
  console.log(`Fichier de rapport: ${CONFIG.PROFIT_REPORT_PATH}`);
  console.log(`Intervalle de vérification: ${CONFIG.CHECK_INTERVAL / 1000} secondes`);
  console.log(`Mode debug: ${CONFIG.DEBUG ? 'Activé' : 'Désactivé'}`);
  console.log(`Inclure simulations: ${CONFIG.INCLUDE_SIMULATIONS ? 'Oui' : 'Non'}`);
  console.log(`Inclure dry runs: ${CONFIG.INCLUDE_DRY_RUNS ? 'Oui' : 'Non'}`);
  
  // Exécuter immédiatement une première fois
  updateProfitReport();
  
  // Puis programmer les exécutions régulières
  setInterval(updateProfitReport, CONFIG.CHECK_INTERVAL);

  
  console.log(chalk.green('Suivi des profits démarré avec succès!'));
}

// Démarrer le script
init();