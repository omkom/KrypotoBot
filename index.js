/**
 * KryptoBot - Advanced Solana Memecoin Trading System
 * 
 * High-performance trading bot for automated detection and trading of promising
 * memecoin tokens on Solana blockchain with advanced risk management and profit
 * optimization strategies.
 * 
 * @version 2.0.0
 */

import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import fs from 'fs';
import path from 'path';
import bs58 from 'bs58';
import chalk from 'chalk';
import dotenv from 'dotenv';

// Import core modules
import logger from './src/services/logger.js';
import config from './src/config/index.js';
import errorHandler, { ErrorSeverity } from './src/services/errorHandler.js';
import { getLatestTokens, getPairInfo } from './src/api/dexscreener.js';
import { analyzeToken } from './src/analyzers/tokenAnalyzer.js';
import { evaluateTokenROI } from './src/analyzers/roiAnalyzer.js';
import { buyToken, sellToken, optimizeTradeParameters } from './src/core/execution.js';
import logRotation from './src/services/logRotation.js';

// Initialize metrics tracking
import metrics from './src/services/metrics.js';

// Global state
let CONFIG = {};          // Global configuration
let isShuttingDown = false; // Shutdown flag
const processedTokens = new Set(); // Track processed tokens
let tradingEnabled = true;  // Circuit breaker for trading system
let WALLET_BALANCE = 0;     // Current wallet SOL balance

/**
 * Loads bot configuration from environment variables with enhanced validation
 * @returns {Object} Configuration for the bot
 */
function initConfig() {
  console.log(chalk.blue('Loading configuration...'));

  // Load environment variables
  dotenv.config();

  // Build configuration with defaults and environment variables
  const config = {
    // Instance identification
    INSTANCE_ID: process.env.INSTANCE_ID || 'default',
    
    // Log file paths (instance-specific)
    LOG_FILE_PATH: process.env.LOG_FILE_PATH || path.join(process.cwd(), 'logs', 'trade_logs.json'),
    PROFIT_REPORT_PATH: process.env.PROFIT_REPORT_PATH || path.join(process.cwd(), 'logs', 'profit_report.json'),
    ERROR_LOG_PATH: process.env.ERROR_LOG_PATH || path.join(process.cwd(), 'logs', 'error_log.txt'),
    API_LOG_FILE: process.env.API_LOG_FILE || path.join(process.cwd(), 'logs', 'api_calls.log'),
    
    // Instance metadata for analytics
    INSTANCE_INFO: {
      id: process.env.INSTANCE_ID || 'default',
      strategy: process.env.STRATEGY_ID || 'default',
      startTime: new Date().toISOString(),
      parameters: {}
    },

    // RPC Connections
    SOLANA_RPC: process.env.SOLANA_RPC_URL_PROD || 'https://api.mainnet-beta.solana.com',
    FALLBACK_RPCS: (process.env.FALLBACK_RPCS || '').split(',').filter(Boolean),
    
    // External APIs
    DEXSCREENER_API: process.env.DEXSCREENER_API_URL || 'https://api.dexscreener.com/latest/dex',
    JUPITER_API_BASE: process.env.JUPITER_API_BASE || 'https://quote-api.jup.ag/v6',
    
    // Trading parameters
    SLIPPAGE: Number(process.env.SLIPPAGE || '2'),
    SWAP_AMOUNT: Number(process.env.SWAP_AMOUNT || '0.1'),
    MAX_SOL_PER_TRADE: Number(process.env.MAX_SOL_PER_TRADE || '0.1'),
    RISK_PERCENTAGE: Number(process.env.RISK_PERCENTAGE || '0.03'),
    MIN_LIQUIDITY_USD: Number(process.env.MIN_LIQUIDITY_USD || '10000'),
    MIN_VOLUME_24H: Number(process.env.MIN_VOLUME_24H || '5000'),
    TAKE_PROFIT: Number(process.env.TAKE_PROFIT || '25'),
    STOP_LOSS: Number(process.env.STOP_LOSS || '-20'),
    
    // Performance parameters
    MAX_RETRIES: Number(process.env.MAX_RETRIES || '3'),
    API_TIMEOUT: Number(process.env.API_TIMEOUT || '10000'),
    PRIORITY_FEE: Number(process.env.PRIORITY_FEE || '1000000'),
    
    // Environment settings
    DRY_RUN: process.env.DRY_RUN === 'true',
    ENV: process.env.ENV || 'prod',
    DEBUG_MODE: process.env.DEBUG_MODE === 'true',
    SELL_ON_SHUTDOWN: process.env.SELL_ON_SHUTDOWN !== 'false', // Default true
    
    // Token blacklist
    BLACKLISTED_TOKENS: (process.env.BLACKLISTED_TOKENS || '').split(',').filter(Boolean),
  };

  // Store key parameters in instance info for analysis
  config.INSTANCE_INFO.parameters = {
    SLIPPAGE: process.env.SLIPPAGE || '2',
    MAX_SOL_PER_TRADE: process.env.MAX_SOL_PER_TRADE || '0.1',
    RISK_PERCENTAGE: process.env.RISK_PERCENTAGE || '0.03',
    MIN_LIQUIDITY_USD: process.env.MIN_LIQUIDITY_USD || '10000',
    TAKE_PROFIT: process.env.TAKE_PROFIT || '25',
    STOP_LOSS: process.env.STOP_LOSS || '-20',
  };

  // Create log directory if needed
  const logDir = path.dirname(config.LOG_FILE_PATH);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
    console.log(chalk.green(`Log directory created: ${logDir}`));
  }

  // Set up log rotation
  logger.debug('Setting up log rotation');
  logRotation.watchFile(config.LOG_FILE_PATH);
  logRotation.watchFile(config.ERROR_LOG_PATH);
  logRotation.watchFile(config.API_LOG_FILE);

  // Log instance startup with parameters
  console.log(chalk.cyan(`Starting bot instance ${config.INSTANCE_ID}`));
  console.log(chalk.yellow('Instance parameters:'));
  Object.entries(config.INSTANCE_INFO.parameters).forEach(([key, value]) => {
    console.log(chalk.yellow(`  ${key}: ${value}`));
  });

  // Save instance info to file for analysis
  const instanceInfoPath = path.join(path.dirname(config.LOG_FILE_PATH), 'instance_info.json');
  fs.writeFileSync(instanceInfoPath, JSON.stringify(config.INSTANCE_INFO, null, 2));

  // Display runtime configuration
  console.log(chalk.bgBlue(`Mode: ${config.ENV}, ${config.DRY_RUN ? '(DRY RUN)' : '(PRODUCTION)'}`));
  console.log(chalk.bgBlue(`RPC: ${config.SOLANA_RPC}`));
  console.log(chalk.bgBlue(`Trading parameters: Slippage: ${config.SLIPPAGE}%, Max per trade: ${config.MAX_SOL_PER_TRADE} SOL`));
  console.log(chalk.bgBlue(`Strategy: TP: ${config.TAKE_PROFIT}%, SL: ${config.STOP_LOSS}%`));

  return config;
}

/**
 * Initializes the wallet and Solana connection with fallback mechanisms
 * @returns {Promise<Object>} Wallet keypair and connection
 */
async function initializeWallet() {
  console.log(chalk.blue('Initializing wallet...'));

  let privateKey;
  let rpcUrl;
  let WALLET;

  try {
    // Determine environment
    if (CONFIG.ENV === 'local') {
      privateKey = process.env.SOLANA_PRIVATE_KEY_LOCAL;
      rpcUrl = process.env.SOLANA_RPC_URL_LOCAL || 'https://api.devnet.solana.com';

      if (!privateKey) {
        console.log(chalk.yellow('Local private key not found. Generating new wallet...'));
        WALLET = Keypair.generate();
        privateKey = bs58.encode(WALLET.secretKey);
        console.log(`New private key generated: ${privateKey}`);
      } else {
        const decodedPrivateKey = bs58.decode(privateKey);
        WALLET = Keypair.fromSecretKey(decodedPrivateKey);
      }
    } else {
      privateKey = process.env.SOLANA_PRIVATE_KEY_PROD;
      rpcUrl = CONFIG.SOLANA_RPC;

      if (!privateKey) {
        throw new Error('Production private key not found. Set SOLANA_PRIVATE_KEY_PROD in .env');
      }

      const decodedPrivateKey = bs58.decode(privateKey);
      WALLET = Keypair.fromSecretKey(decodedPrivateKey);
    }

    console.log(chalk.green(`Wallet initialized with address: ${WALLET.publicKey.toBase58()}`));

    // Initialize Solana connection with optimized parameters
    const connection = new Connection(rpcUrl, {
      commitment: 'confirmed',
      disableRetryOnRateLimit: false,
      confirmTransactionInitialTimeout: 60000
    });

    // Test connection with a simple request
    const balance = await connection.getBalance(WALLET.publicKey);
    WALLET_BALANCE = balance / 1_000_000_000; // Convert lamports to SOL
    
    console.log(chalk.green(`Connection successful. Wallet balance: ${WALLET_BALANCE.toFixed(4)} SOL`));
    
    // Update metrics
    metrics.updateWalletBalance(WALLET_BALANCE);

    return { WALLET, connection, rpcUrl };
  } catch (error) {
    const errorMsg = `Failed to initialize wallet: ${error.message}`;
    errorHandler.handleError(
      error, 
      'system', 
      ErrorSeverity.CRITICAL, 
      { component: 'initializeWallet' }
    );
    logger.error(errorMsg);
    throw new Error(errorMsg);
  }
}

/**
 * Sells all active token positions (used during shutdown)
 * @param {Connection} connection - Solana connection
 * @param {Keypair} wallet - Wallet keypair
 * @returns {Promise<Object>} Results of emergency sell operation
 */
async function sellAllPositions(connection, wallet) {
  logger.warn('EMERGENCY SELL: Closing all active positions');
  
  const results = {
    success: [],
    failed: []
  };
  
  try {
    // First, get all tokens from logs
    const tokenData = readTokenLogs(CONFIG.LOG_FILE_PATH);
    const tokens = tokenData.tokens || {};
    
    // Process each token with active position
    for (const [address, token] of Object.entries(tokens)) {
      try {
        // Skip tokens with zero balance
        if (!token || token.currentAmount <= 0) continue;
        
        const tokenName = token.tokenName || 'Unknown';
        const amount = token.currentAmount;
        
        logger.warn(`Emergency selling ${amount} ${tokenName}`);
        
        // Execute sale
        const saleResult = await executeSale(
          address,
          tokenName,
          amount,
          connection,
          wallet,
          'Emergency Shutdown'
        );
        
        if (saleResult.success) {
          results.success.push({
            tokenName,
            amount,
            solReceived: saleResult.solReceived,
            roi: saleResult.roi
          });
        } else {
          results.failed.push({
            tokenName,
            amount,
            error: saleResult.error
          });
        }
      } catch (error) {
        logger.error(`Error emergency selling token ${address}: ${error.message}`);
        results.failed.push({
          tokenAddress: address,
          amount: token.currentAmount,
          error: error.message
        });
      }
      
      // Small delay between sales to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    logger.info(`Emergency sell completed: ${results.success.length} successful, ${results.failed.length} failed`);
    return results;
  } catch (error) {
    logger.error(`Critical error during emergency sell: ${error.message}`);
    errorHandler.handleError(
      error, 
      'system', 
      ErrorSeverity.CRITICAL, 
      { operation: 'sellAllPositions' }
    );
    
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Setup graceful shutdown handlers for the bot
 * @param {Connection} connection - Solana connection
 * @param {Keypair} wallet - Wallet keypair
 */
function setupExitHandlers(connection, wallet) {
  let isExiting = false;
  
  async function handleExit(signal) {
    // Prevent multiple exit handlers from running simultaneously
    if (isExiting) return;
    isExiting = true;
    isShuttingDown = true;
    
    logger.warn(`\n\n${signal} signal received. Starting graceful shutdown...`);
    logger.warn('Please wait while we sell all tokens in your wallet...');
    
    try {
      // Only sell positions if configured
      if (CONFIG.SELL_ON_SHUTDOWN) {
        // Perform the sell all operation
        const sellAllResult = await sellAllPositions(connection, wallet);
        
        if (sellAllResult.success) {
          logger.success(`Graceful shutdown completed. Sold ${sellAllResult.success.length} tokens.`);
        } else {
          logger.error(`Graceful shutdown had errors: ${sellAllResult.error}`);
        }
      } else {
        logger.warn('SELL_ON_SHUTDOWN disabled - exiting without selling positions');
      }
    } catch (error) {
      logger.error(`Error during graceful shutdown: ${error.message}`);
    }
    
    logger.info('Bot shutting down now. Goodbye!');
    process.exit(0);
  }
  
  // Register handlers for termination signals
  process.on('SIGINT', () => handleExit('SIGINT')); // Ctrl+C
  process.on('SIGTERM', () => handleExit('SIGTERM')); // Kill command
  
  // Handle uncaught exceptions and rejections
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    handleExit('UNCAUGHT_EXCEPTION');
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Promise Rejection:', reason);
    handleExit('UNHANDLED_REJECTION');
  });
  
  logger.info('Exit handlers registered - the bot will sell all tokens on shutdown');
}

/**
 * Scans the market for trading opportunities
 * @param {Connection} connection - Solana connection
 * @param {Keypair} wallet - Wallet keypair
 * @returns {Promise<Array>} List of tradeable tokens
 */
async function scanMarket(connection, wallet) {
  logger.info('Scanning market for trading opportunities...');
  
  try {
    // Get latest tokens from DEXScreener
    const latestTokens = await getLatestTokens('solana');
    
    if (!latestTokens || latestTokens.length === 0) {
      logger.warn('No tokens found in latest scan');
      return [];
    }
    
    logger.info(`Found ${latestTokens.length} tokens to analyze`);
    
    // Track tradeable tokens
    const tradeableTokens = [];
    
    // Process each token (limit to 10 at a time to avoid rate limits)
    const tokensToProcess = latestTokens.slice(0, 10);
    
    for (const token of tokensToProcess) {
      // Skip if already processed or no valid address
      if (!token.baseToken?.address || processedTokens.has(token.baseToken.address)) {
        continue;
      }
      
      const tokenAddress = token.baseToken.address;
      processedTokens.add(tokenAddress);
      
      try {
        // Get pair info for detailed analysis
        const pairInfo = await getPairInfo('solana', tokenAddress);
        if (!pairInfo) continue;
        
        // Check if token is blacklisted
        if (CONFIG.BLACKLISTED_TOKENS.includes(tokenAddress)) {
          logger.debug(`Token ${tokenAddress} is blacklisted. Skipping.`);
          continue;
        }
        
        // Evaluate token to decide if it's worth trading
        if (evaluateToken(pairInfo)) {
          // Add to tradeable tokens list
          tradeableTokens.push({
            address: tokenAddress,
            name: pairInfo.baseToken.symbol,
            price: pairInfo.priceUsd,
            liquidity: pairInfo.liquidity?.usd || 0,
            volume24h: pairInfo.volume?.h24 || 0,
            score: 70 // Default score, can be refined from token analysis
          });
        }
      } catch (error) {
        logger.error(`Error analyzing token ${tokenAddress}: ${error.message}`);
      }
      
      // Small delay between token analysis to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    logger.info(`Found ${tradeableTokens.length} tradeable tokens`);
    return tradeableTokens;
  } catch (error) {
    logger.error(`Error scanning market: ${error.message}`);
    errorHandler.handleError(
      error, 
      'api', 
      ErrorSeverity.HIGH, 
      { function: 'scanMarket' }
    );
    return [];
  }
}

/**
 * Trading cycle - scans market and executes trades
 * @param {Connection} connection - Solana connection
 * @param {Keypair} wallet - Wallet keypair
 */
async function tradingCycle(connection, wallet) {
  try {
    // Skip if shutting down
    if (isShuttingDown) return;
    
    logger.info('Starting trading cycle...');
    
    // Check if trading is enabled (circuit breaker)
    if (!tradingEnabled) {
      logger.warn('Trading is currently disabled by circuit breaker');
      return;
    }
    
    // Scan market for opportunities
    const tradeableTokens = await scanMarket(connection, wallet);
    
    if (tradeableTokens.length > 0) {
      logger.success(`Found ${tradeableTokens.length} potential tokens to trade`);
      
      // Execute trades (limit to 2 per cycle)
      const tokensToTrade = tradeableTokens.slice(0, 2);
      
      for (const token of tokensToTrade) {
        try {
          // Calculate amount to buy based on wallet balance and token score
          const amountToBuy = await calculateTradeAmount(connection, wallet, token.score);
          
          // Skip if amount is too small
          if (amountToBuy < 0.005) {
            logger.warn(`Skipping ${token.name} - calculated amount too small: ${amountToBuy}`);
            continue;
          }
          
          // Execute purchase
          await executePurchase(
            token.address,
            token.name,
            amountToBuy,
            connection,
            wallet
          );
          
          // Add delay between trades
          await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
          logger.error(`Error trading ${token.name}: ${error.message}`);
        }
      }
    } else {
      logger.info('No tradeable tokens found in this cycle');
    }
    
    logger.info('Trading cycle completed');
    
    // Schedule next cycle
    const nextCycleDelay = 60000 + Math.floor(Math.random() * 30000); // 60-90 seconds
    setTimeout(() => tradingCycle(connection, wallet), nextCycleDelay);
  } catch (error) {
    logger.error(`Error in trading cycle: ${error.message}`);
    errorHandler.handleError(
      error, 
      'trading', 
      ErrorSeverity.HIGH, 
      { function: 'tradingCycle' }
    );
    
    // Schedule next cycle even after error (with longer delay)
    const errorRetryDelay = 120000 + Math.floor(Math.random() * 60000); // 2-3 minutes
    setTimeout(() => tradingCycle(connection, wallet), errorRetryDelay);
  }
}

/**
 * Main function - entry point for the application
 */
async function main() {
  try {
    // Initialize configuration
    CONFIG = initConfig();
    
    // Print welcome banner
    console.log(chalk.cyan.bold('============================================='));
    console.log(chalk.cyan.bold('            KryptoBot v2.0.0                '));
    console.log(chalk.cyan.bold('   Solana Memecoin Trading Bot              '));
    console.log(chalk.cyan.bold('============================================='));
    
    // Initialize wallet and connection
    const { WALLET, connection } = await initializeWallet();
    
    // Set up exit handlers for graceful shutdown
    setupExitHandlers(connection, WALLET);
    
    // Start trading cycle
    await tradingCycle(connection, WALLET);
    
    logger.success('Bot started successfully');
  } catch (error) {
    logger.error(`CRITICAL ERROR: ${error.message}`);
    errorHandler.handleError(
      error, 
      'system', 
      ErrorSeverity.CRITICAL, 
      { function: 'main' }
    );
    
    // Exit with error code
    process.exit(1);
  }
}

// Start the bot
main().catch(err => {
  console.error('Fatal Error:', err);
  process.exit(1);
});

/**
 * Monitors price movements of a token with real-time exit strategies
 * Supports multiple exit conditions: take profit, stop loss, trailing stop, and time-based exit
 * @param {string} tokenAddress - Token address
 * @param {string} tokenName - Token name
 * @param {number} amount - Amount of tokens to monitor
 * @param {Connection} connection - Solana connection
 * @param {Keypair} wallet - Wallet keypair
 * @returns {number} ID of the interval
 */
function monitorPriceMovements(tokenAddress, tokenName, amount, connection, wallet) {
  // Skip if shutting down
  if (isShuttingDown) return null;

  // Initialize monitoring parameters
  const purchaseTime = Date.now();
  const minHoldingTime = 60 * 1000; // 1 minute minimum holding time
  const maxHoldingTime = 5 * 60 * 1000; // 5 minutes maximum before auto-exit
  const checkInterval = 15000; // Check every 15 seconds
  
  logger.debug(`Starting price monitoring for ${tokenName} (${tokenAddress})`);
  logger.debug(`Exit conditions: TP=${CONFIG.TAKE_PROFIT}%, SL=${CONFIG.STOP_LOSS}%, MaxTime=5min`);
  
  // Variables for price tracking
  let lastPrice = null;
  let highestPrice = null;
  let lastPriceChangeTime = Date.now();
  let trailingStopActive = false;
  let trailingStopPrice = 0;
  let priceHistory = [];
  let exitStages = new Set(); // Track already hit take profit levels
  
  // Get token data from logs to know purchase price
  const tokenData = readTokenLogs(CONFIG.LOG_FILE_PATH);
  const tokenInfo = tokenData.tokens[tokenAddress] || null;
  const purchasePrice = tokenInfo?.avgBuyPrice || 0;

  // Set up exit strategy stages (take profit in stages)
  const takeProfitStages = [
    { percent: CONFIG.TAKE_PROFIT * 0.33, sellPortion: 0.25 }, // 25% at 1/3 of target
    { percent: CONFIG.TAKE_PROFIT * 0.66, sellPortion: 0.50 }, // 50% at 2/3 of target
    { percent: CONFIG.TAKE_PROFIT, sellPortion: 1.0 }          // Remaining at full target
  ];
  
  // Create trailing stop settings
  const trailingStopSettings = {
    activationPercent: Math.max(5, CONFIG.TAKE_PROFIT * 0.2), // Activate at 20% of take profit
    trailPercent: 5 // 5% trailing stop
  };
  
  // Start monitoring interval
  const intervalId = setInterval(async () => {
    try {
      // Skip if shutting down
      if (isShuttingDown) {
        clearInterval(intervalId);
        return;
      }
    
      // Get current token balance to ensure we still have tokens
      const availableAmount = await getTokenBalance(tokenAddress, connection, wallet);
      
      // Exit if no tokens left to sell
      if (availableAmount <= 0) {
        logger.debug(`No more ${tokenName} tokens to monitor, stopping interval`);
        clearInterval(intervalId);
        return;
      }
      
      // Get current market price
      const pairInfo = await getPairInfo('solana', tokenAddress);
      if (!pairInfo || !pairInfo.priceNative) {
        logger.warn(`Could not get price for ${tokenName}`);
        return;
      }
      
      const currentPrice = parseFloat(pairInfo.priceNative);
      lastPrice = currentPrice;
      
      // Update highest price if needed (for trailing stop)
      if (highestPrice === null || currentPrice > highestPrice) {
        highestPrice = currentPrice;
        
        // Update trailing stop price if active
        if (trailingStopActive) {
          trailingStopPrice = highestPrice * (1 - (trailingStopSettings.trailPercent / 100));
          logger.debug(`Trailing stop updated to ${trailingStopPrice.toFixed(8)} SOL`);
        }
      }
      
      // Add to price history
      priceHistory.push({ price: currentPrice, timestamp: Date.now() });
      if (priceHistory.length > 10) priceHistory.shift(); // Keep last 10 points
      
      // Calculate ROI
      let roi = 0;
      if (purchasePrice > 0) {
        roi = ((currentPrice - purchasePrice) / purchasePrice) * 100;
      }
      
      // Log status periodically (not every check)
      if (Math.random() < 0.3) { // ~30% of checks
        logger.debug(
          `${tokenName}: ROI=${roi.toFixed(2)}%, ` +
          `Price=${currentPrice.toFixed(8)}, ` +
          `Time=${((Date.now() - purchaseTime) / 60000).toFixed(1)}min`
        );
      }
      
      // Skip further checks if we're still in minimum holding period
      const timeElapsed = Date.now() - purchaseTime;
      if (timeElapsed < minHoldingTime) {
        return;
      }
      
      // Check exit conditions in order of priority
      
      // 1. Check if trailing stop should be activated
      if (!trailingStopActive && roi >= trailingStopSettings.activationPercent) {
        trailingStopActive = true;
        trailingStopPrice = currentPrice * (1 - (trailingStopSettings.trailPercent / 100));
        logger.debug(`Trailing stop activated at ${roi.toFixed(2)}%, price: ${trailingStopPrice.toFixed(8)}`);
      }
      
      // 2. Check trailing stop (if active)
      if (trailingStopActive && currentPrice <= trailingStopPrice) {
        logger.trade(`Trailing stop triggered for ${tokenName} at ${currentPrice.toFixed(8)} SOL (${roi.toFixed(2)}%)`);
        await executeSale(tokenAddress, tokenName, availableAmount, connection, wallet, 'Trailing Stop Exit');
        clearInterval(intervalId);
        return;
      }
      
      // 3. Check stop loss
      if (roi <= CONFIG.STOP_LOSS) {
        logger.trade(`Stop loss triggered for ${tokenName} at ${roi.toFixed(2)}%`);
        await executeSale(tokenAddress, tokenName, availableAmount, connection, wallet, 'Stop Loss Exit');
        clearInterval(intervalId);
        return;
      }
      
      // 4. Check take profit stages
      for (const stage of takeProfitStages) {
        // Skip if this stage is already completed
        if (exitStages.has(stage.percent)) continue;
        
        if (roi >= stage.percent) {
          const sellAmount = availableAmount * stage.sellPortion;
          logger.trade(`Take profit stage (${stage.percent}%) triggered for ${tokenName} at ${roi.toFixed(2)}%`);
          
          await executeSale(tokenAddress, tokenName, sellAmount, connection, wallet, `Take Profit ${stage.percent}%`);
          exitStages.add(stage.percent);
          
          // If this was a complete exit, stop monitoring
          if (stage.sellPortion >= 0.99) {
            clearInterval(intervalId);
            return;
          }
          
          // Otherwise, get updated balance
          const newBalance = await getTokenBalance(tokenAddress, connection, wallet);
          if (newBalance <= 0) {
            clearInterval(intervalId);
            return;
          }
          
          // Only process one stage at a time
          break;
        }
      }
      
      // 5. Time-based exit (max holding time)
      if (timeElapsed >= maxHoldingTime) {
        logger.trade(`Time-based exit triggered for ${tokenName} after ${(timeElapsed/60000).toFixed(1)} minutes`);
        await executeSale(tokenAddress, tokenName, availableAmount, connection, wallet, 'Time-Based Exit');
        clearInterval(intervalId);
        return;
      }
      
    } catch (error) {
      logger.error(`Error in price monitoring for ${tokenName}: ${error.message}`);
      errorHandler.handleError(
        error, 
        'trading', 
        ErrorSeverity.MEDIUM, 
        { function: 'monitorPriceMovements', token: tokenName }
      );
    }
  }, checkInterval);
  
  return intervalId;
}

/**
 * Gets token balance from wallet
 * @param {string} tokenAddress - Token address
 * @param {Connection} connection - Solana connection
 * @param {Keypair} wallet - Wallet keypair
 * @returns {Promise<number>} Token balance
 */
async function getTokenBalance(tokenAddress, connection, wallet) {
  try {
    // In dry run mode, get balance from logs
    if (CONFIG.DRY_RUN) {
      const tokenData = readTokenLogs(CONFIG.LOG_FILE_PATH);
      return tokenData.tokens[tokenAddress]?.currentAmount || 0;
    }
    
    // For real mode, get actual token balance from chain
    // Implementation depends on whether we use external module or direct chain query
    return 0; // Placeholder - replace with actual implementation
  } catch (error) {
    logger.error(`Error getting token balance: ${error.message}`);
    return 0;
  }
}

/**
 * Executes token sale with comprehensive error handling
 * High-level wrapper around the core sellToken function with logging
 * @param {string} tokenAddress - Token address
 * @param {string} tokenName - Token name
 * @param {number} amount - Amount to sell
 * @param {Connection} connection - Solana connection
 * @param {Keypair} wallet - Wallet keypair
 * @param {string} reason - Reason for selling
 * @returns {Promise<Object>} Sale result
 */
async function executeSale(tokenAddress, tokenName, amount, connection, wallet, reason = 'Manual Sale') {
  try {
    // Skip if shutting down or amount is zero
    if (isShuttingDown || amount <= 0) {
      return { success: false, error: 'Invalid sale parameters' };
    }
    
    logger.trade(`Selling ${amount} ${tokenName} (${reason})`);
    
    // Execute sale through execution module
    const result = await sellToken(
      tokenAddress, 
      tokenName, 
      amount, 
      connection, 
      wallet,
      { isDryRun: CONFIG.DRY_RUN }
    );
    
    if (result.success) {
      // Log the sale with reason
      logTokenSale(
        tokenAddress,
        tokenName,
        amount,
        result.solReceived,
        { reason, exitStrategy: true },
        CONFIG.DRY_RUN
      );
      
      logger.success(`Successfully sold ${amount} ${tokenName} for ${result.solReceived.toFixed(6)} SOL (${reason})`);
      return result;
    } else {
      logger.error(`Failed to sell ${tokenName}: ${result.error || 'Unknown error'}`);
      return result;
    }
  } catch (error) {
    logger.error(`Error selling ${tokenName}: ${error.message}`);
    errorHandler.handleError(
      error,
      'trading',
      ErrorSeverity.HIGH,
      { operation: 'executeSale', tokenAddress, tokenName, amount, reason }
    );
    
    return {
      success: false,
      error: error.message,
      tokenAddress,
      tokenName
    };
  }
}

/**
 * Reads token logs from JSON file with robust error handling and recovery
 * @param {string} logFilePath Path to the log file
 * @returns {Object} Object with tokens indexed by address
 */
function readTokenLogs(logFilePath) {
  try {
    // Check if file exists
    if (!fs.existsSync(logFilePath)) {
      logger.info(`Creating new log file: ${logFilePath}`);
      
      // Create parent directory if needed
      const dirPath = path.dirname(logFilePath);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      
      // Initialize with empty structure
      const initialData = {
        lastUpdate: new Date().toISOString(),
        tokens: {},
        stats: {
          totalInvested: 0,
          totalReturned: 0,
          successfulTrades: 0,
          failedTrades: 0,
          startDate: new Date().toISOString()
        }
      };
      
      fs.writeFileSync(logFilePath, JSON.stringify(initialData, null, 2));
      return initialData;
    }
    
    // Read existing file
    const data = fs.readFileSync(logFilePath, 'utf8');
    const parsedData = JSON.parse(data);
    
    // Ensure consistent structure
    if (!parsedData.stats) {
      parsedData.stats = {
        totalInvested: 0,
        totalReturned: 0,
        successfulTrades: 0,
        failedTrades: 0,
        startDate: parsedData.lastUpdate || new Date().toISOString()
      };
    }

    if (!parsedData.tokens) {
      parsedData.tokens = {};
    }
    
    return parsedData;
  } catch (error) {
    logger.error(`Error reading JSON file (${logFilePath}):`, error);
    
    // Create backup of corrupted file
    if (fs.existsSync(logFilePath)) {
      const backupPath = `${logFilePath}.backup.${Date.now()}`;
      try {
        fs.copyFileSync(logFilePath, backupPath);
        logger.warn(`Corrupted log file. Backup created: ${backupPath}`);
      } catch (backupError) {
        logger.error(`Unable to create backup:`, backupError);
      }
    }
    
    // Return empty structure as fallback
    return {
      lastUpdate: new Date().toISOString(),
      tokens: {},
      stats: {
        totalInvested: 0,
        totalReturned: 0,
        successfulTrades: 0,
        failedTrades: 0,
        startDate: new Date().toISOString()
      }
    };
  }
}

/**
 * Writes token logs to JSON file with atomic write operation
 * @param {Object} tokenData Token data to write
 * @param {string} logFilePath Path to the log file
 */
function writeTokenLogs(tokenData, logFilePath) {
  try {
    // Update timestamp
    tokenData.lastUpdate = new Date().toISOString();
    
    // Create directory if it doesn't exist
    const dirPath = path.dirname(logFilePath);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    
    // Write to temporary file first (atomic write)
    const tempPath = `${logFilePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(tokenData, null, 2));
    
    // Rename for atomic replace
    fs.renameSync(tempPath, logFilePath);
  } catch (error) {
    logger.error('Error writing JSON file:', error);
    
    // Try writing to alternative location if main write fails
    try {
      const altPath = './trade_logs_backup.json';
      fs.writeFileSync(altPath, JSON.stringify(tokenData, null, 2));
      logger.warn(`Logs written to alternative location: ${altPath}`);
    } catch (altError) {
      logger.error('Failed to write logs to alternative location:', altError);
    }
  }
}

/**
 * Records a token purchase in the log with detailed metrics
 * @param {string} tokenAddress Token address
 * @param {string} tokenName Token name/symbol
 * @param {number} amount Amount of tokens acquired
 * @param {number} priceSol Price paid in SOL
 * @param {number} tokensBought Tokens bought
 * @param {Object} metadata Additional metadata
 */
function logTokenPurchase(tokenAddress, tokenName, amount, priceSol, tokensBought, metadata = {}) {
  if (!tokenAddress) {
    logger.error('Missing parameters for logTokenPurchase');
    return;
  }

  try {
    const timestamp = new Date().toISOString();
    const pricePerToken = tokensBought > 0 ? priceSol / tokensBought : 0;
    
    // Read existing data
    const tokenData = readTokenLogs(CONFIG.LOG_FILE_PATH);
    
    // Update or create entry for this token
    if (!tokenData.tokens[tokenAddress]) {
      // New entry
      tokenData.tokens[tokenAddress] = {
        tokenAddress,
        tokenName,
        initialAmount: amount,
        currentAmount: amount,
        initialInvestment: priceSol,
        totalSold: 0,
        totalReceived: 0,
        avgBuyPrice: pricePerToken,
        avgSellPrice: 0,
        firstPurchaseTime: timestamp,
        lastUpdateTime: timestamp,
        transactions: [
          {
            type: "BUY",
            amount: tokensBought,
            priceSOL: priceSol,
            pricePerToken,
            timestamp,
            metadata: Object.keys(metadata).length > 0 ? metadata : undefined
          }
        ]
      };
      
      // Update global stats
      if (tokenData.stats) {
        tokenData.stats.totalInvested += priceSol;
      }
    } else {
      // Update existing entry
      const token = tokenData.tokens[tokenAddress];
      
      token.initialAmount = Number(token.initialAmount || 0) + amount;
      token.currentAmount = Number(token.currentAmount || 0) + amount;
      token.initialInvestment = Number(token.initialInvestment || 0) + priceSol;
      
      // Update weighted average buy price
      if (token.initialAmount > 0) {
        token.avgBuyPrice = token.initialInvestment / token.initialAmount;
      }
      
      token.lastUpdateTime = timestamp;
      
      // Add transaction
      token.transactions.push({
        type: "BUY",
        amount: tokensBought,
        priceSOL: priceSol,
        pricePerToken,
        timestamp,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined
      });
      
      // Update global stats
      if (tokenData.stats) {
        tokenData.stats.totalInvested += priceSol;
      }
    }
    
    // Write updated data
    writeTokenLogs(tokenData, CONFIG.LOG_FILE_PATH);
    
    // Console output with color coding
    if (metadata?.scamDetected) {
      logger.warn(`Purchase - Token=${tokenName} (${tokenAddress}) | Amount=${amount} | PriceSol=${priceSol} | PricePerToken=${pricePerToken.toFixed(10)} | SCAM DETECTED`);
    } else {
      logger.info(`Purchase - Token=${tokenName} (${tokenAddress}) | Amount=${amount} | PriceSol=${priceSol} | PricePerToken=${pricePerToken.toFixed(10)}`);
      logger.debug(`Price per token: ${pricePerToken.toFixed(10)} SOL | Wallet: ${tokenData.tokens[tokenAddress].currentAmount} tokens`);
    }
    
    // Update metrics
    metrics.recordPurchase({
      tokenAddress,
      tokenName,
      amount: tokensBought,
      costInSol: priceSol,
      metadata
    });
  } catch (error) {
    logger.error('Error recording purchase:', error);
    errorHandler.handleError(
      error, 
      'trading', 
      ErrorSeverity.MEDIUM, 
      { operation: 'logTokenPurchase', tokenAddress, tokenName }
    );
  }
}

/**
 * Records a token sale with detailed ROI calculation
 * @param {string} tokenAddress Token address
 * @param {string} tokenName Token name/symbol
 * @param {number} amount Amount sold
 * @param {number} solReceived SOL received from sale
 * @param {Object} metadata Additional metadata
 * @param {boolean} isDryRun Indicates if this is a simulation
 * @returns {Object} Sale information and ROI
 */
function logTokenSale(tokenAddress, tokenName, amount, solReceived, metadata = {}, isDryRun = false) {
  if (!tokenAddress) {
    logger.error('Missing parameters for logTokenSale');
    return {
      success: false,
      error: "MISSING_PARAMETERS",
      roi: 0
    };
  }

  try {
    const timestamp = new Date().toISOString();
    
    // Read existing data
    const tokenData = readTokenLogs(CONFIG.LOG_FILE_PATH);
    
    // Check if token exists in logs
    if (!tokenData.tokens[tokenAddress]) {
      logger.error(`Token ${tokenAddress} not found in logs`);
      return {
        success: false,
        error: "TOKEN_NOT_FOUND",
        roi: 0
      };
    }
    
    const token = tokenData.tokens[tokenAddress];
    
    // Ensure we have enough tokens to sell
    if (Number(token.currentAmount) < amount) {
      logger.warn(`Warning: Trying to sell ${amount} tokens but only ${token.currentAmount} available`);
      amount = Number(token.currentAmount);
    }
    
    // Calculate price per token for this sale
    const salePerToken = amount > 0 ? solReceived / amount : 0;
    
    // Calculate ROI for this specific sale
    let avgBuyPrice = Number(token.avgBuyPrice) || 0;
    
    // Calculate ROI
    const roi = avgBuyPrice > 0 ? ((salePerToken - avgBuyPrice) / avgBuyPrice) * 100 : 0;
    
    // Update token metrics
    token.currentAmount = Number(token.currentAmount) - amount;
    token.totalSold = Number(token.totalSold || 0) + amount;
    token.totalReceived = Number(token.totalReceived || 0) + solReceived;
    
    // Update average sale price
    if (token.totalSold > 0) {
      token.avgSellPrice = token.totalReceived / token.totalSold;
    }
    
    token.lastUpdateTime = timestamp;
    
    // Add transaction
    token.transactions.push({
      type: "SELL",
      amount,
      priceSOL: solReceived,
      pricePerToken: salePerToken,
      timestamp,
      roi,
      isDryRun,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined
    });
    
    // Update global stats
    if (tokenData.stats) {
      tokenData.stats.totalReturned += solReceived;
      tokenData.stats.successfulTrades++;
    }
    
    // Write updated data
    writeTokenLogs(tokenData, CONFIG.LOG_FILE_PATH);
    
    // Calculate global metrics
    const totalInvested = Number(token.initialInvestment) || 0;
    const totalReceived = Number(token.totalReceived) || 0;
    
    // Console output
    const dryRunPrefix = isDryRun ? '[SIMULATION] ' : '';
    
    // Prepare log message
    const saleMessage = `${dryRunPrefix}Sale (ROI ${roi.toFixed(2)}%) - Token=${tokenName} (${tokenAddress}) | ` +
                       `Amount=${amount} | SolReceived=${solReceived} | ` +
                       `SalePrice=${salePerToken.toFixed(10)} | AvgBuyPrice=${avgBuyPrice.toFixed(10)}`;
    
    // Color based on ROI
    if (roi > 0) {
      logger.success(saleMessage);
      logger.success(`${dryRunPrefix}Profit: ${roi.toFixed(2)}% (${solReceived} SOL received)`);
    } else if (roi < 0) {
      logger.error(saleMessage);
      logger.error(`${dryRunPrefix}Loss: ${roi.toFixed(2)}% (${solReceived} SOL received)`);
    } else {
      logger.warn(saleMessage);
      logger.warn(`${dryRunPrefix}Neutral ROI: ${roi.toFixed(2)}% (${solReceived} SOL received)`);
    }
    
    // Update metrics
    metrics.recordSale({
      tokenAddress,
      tokenName,
      amount,
      solReceived,
      profit: solReceived - (amount * avgBuyPrice),
      roi,
      isDryRun
    });
    
    return {
      success: true,
      tokenAddress,
      tokenName,
      amount,
      solReceived,
      salePerToken,
      avgBuyPrice,
      roi,
      remainingAmount: token.currentAmount,
      isDryRun
    };
  } catch (error) {
    logger.error('Error recording sale:', error);
    errorHandler.handleError(
      error, 
      'trading', 
      ErrorSeverity.MEDIUM, 
      { operation: 'logTokenSale', tokenAddress, tokenName }
    );
    return {
      success: false,
      error: error.message,
      roi: 0,
      isDryRun
    };
  }
}

/**
 * Evaluates a token to determine if it's worth trading
 * with comprehensive risk/reward analysis
 * @param {Object} pool Token pool information
 * @returns {boolean} True if token meets purchase criteria
 */
function evaluateToken(pool) {
  const symbol = pool.baseToken?.symbol || 'Unknown';
  logger.debug(`Evaluating token: ${symbol}`);

  // Extract metrics
  const liquidityUsd = pool.liquidity?.usd || 0;
  const volume24h = pool.volume?.h24 || 0;
  const priceChange24h = pool.priceChange?.h24 || 0;
  const tokenAgeDays = pool.pairCreatedAt ? (Date.now() - pool.pairCreatedAt) / (1000 * 60 * 60 * 24) : 0;

  // Thresholds from configuration
  const MIN_LIQUIDITY_USD = CONFIG.MIN_LIQUIDITY_USD || 10;
  const MIN_VOLUME_24H = CONFIG.MIN_VOLUME_24H || 10;

  // Check for suspicious keywords in token name
  const tokenName = pool.baseToken?.symbol || '';
  const scamKeywords = ['pump', 'dump', 'elon', 'moon', 'safe', 'doge', 'shib', 'inu', 'airdrop', 'free'];
  const containsScamKeyword = scamKeywords.some(keyword =>
    tokenName.toLowerCase().includes(keyword)
  );

  // Check suspicious transaction patterns
  const txns = pool.txns || { m5: {}, h1: {}, h6: {}, h24: {} };
  const buySellRatio = (txns.h1.buys || 1) / (txns.h1.sells || 1);
  const suspiciousBuySellRatio = buySellRatio > 10 || buySellRatio < 0.1;

  // Count red flags
  let redFlagCount = 0;
  const flags = [];

  if (suspiciousBuySellRatio) {
    redFlagCount++;
    flags.push('Suspicious buy/sell ratio');
  }
  
  if (containsScamKeyword) {
    redFlagCount++;
    flags.push('Suspicious name keywords');
  }
  
  if (liquidityUsd < MIN_LIQUIDITY_USD * 0.5) {
    redFlagCount++;
    flags.push('Extremely low liquidity');
  }

  // Log evaluation details
  logger.debug(`Evaluation for ${symbol}:`, {
    flags: redFlagCount,
    containsScamKeyword,
    suspiciousBuySellRatio,
    lowLiquidity: liquidityUsd < MIN_LIQUIDITY_USD,
    lowVolume24h: volume24h < MIN_VOLUME_24H,
  });

  // Reject highly suspicious tokens
  if (redFlagCount >= 2) {
    logger.warn(`Token ${symbol} rejected: ${redFlagCount} suspicious indicators - ${flags.join(', ')}`);
    return false;
  }

  // Run both evaluations for comprehensive analysis
  const basicEval = runBasicEvaluation(pool, MIN_LIQUIDITY_USD, MIN_VOLUME_24H);
  const roiAnalysis = evaluateTokenROI(pool);
  
  // For tokens to be accepted, they must pass basic evaluation 
  // AND have a ROI potential score above threshold
  const ROI_THRESHOLD = 40; // Minimum ROI score to consider trading
  
  if (basicEval && roiAnalysis.potentialScore >= ROI_THRESHOLD) {
    logger.success(`Token ${symbol} ACCEPTED for purchase - ROI score: ${roiAnalysis.potentialScore.toFixed(1)}/100`);
    return true;
  }

  logger.warn(`Token ${symbol} REJECTED: doesn't meet criteria - ROI score: ${roiAnalysis.potentialScore.toFixed(1)}/100`);
  return false;
}

/**
 * Runs the basic token evaluation (first-level filtering)
 * @param {Object} pool - Token pool data
 * @param {number} minLiquidity - Minimum liquidity threshold
 * @param {number} minVolume - Minimum volume threshold
 * @returns {boolean} Basic evaluation result
 */
function runBasicEvaluation(pool, minLiquidity, minVolume) {
  // Extract metrics
  const liquidityUsd = pool.liquidity?.usd || 0;
  const volume24h = pool.volume?.h24 || 0;
  const txns = pool.txns || { m5: {}, h1: {} };
  const recentBuysM5 = txns.m5?.buys || 0;
  const recentSellsM5 = txns.m5?.sells || 0;
  const hasRecentBuyActivity = recentBuysM5 > recentSellsM5;
  const isRising = (pool.priceChange?.h1 || 0) > 0;

  // Evaluation criteria
  const meetsLiquidityCriteria = liquidityUsd >= minLiquidity;
  const meetsVolumeCriteria = volume24h >= minVolume;
  
  // Count how many criteria are met
  let criteriaMetCount = 0;
  if (meetsLiquidityCriteria) criteriaMetCount++;
  if (meetsVolumeCriteria) criteriaMetCount++;
  
  // Quality factors
  let qualityFactorsCount = 0;
  if (hasRecentBuyActivity) qualityFactorsCount++;
  if (isRising) qualityFactorsCount++;
  
  // Token must meet at least 1 main criteria and 1 quality factor
  return (criteriaMetCount >= 1 && qualityFactorsCount >= 1);
}

/**
 * Calculates purchase amount based on wallet balance and risk parameters
 * @param {Connection} connection Solana connection
 * @param {Keypair} wallet Wallet keypair
 * @param {number} tradeableScore Optional score to adjust trade size
 * @returns {Promise<number>} Amount to spend in SOL
 */
/**
 * Calculates optimal trade amount based on wallet balance, risk parameters and token score
 * with adjustments for token potential and risk management
 * @param {Connection} connection Solana connection
 * @param {Keypair} wallet Wallet keypair
 * @param {number} tradeableScore Optional score to adjust trade size
 * @returns {Promise<number>} Amount to spend in SOL
 */
async function calculateTradeAmount(connection, wallet, tradeableScore = 70) {
  logger.debug('Calculating purchase amount...');

  try {
    // Get wallet balance
    const balance = await connection.getBalance(wallet.publicKey);
    WALLET_BALANCE = balance / 1_000_000_000; // Convert to SOL
    
    logger.debug(`Wallet balance: ${WALLET_BALANCE.toFixed(4)} SOL`);
    
    // Update wallet balance in metrics
    metrics.updateWalletBalance(WALLET_BALANCE);
    
    // Base risk percentage from config
    const baseRiskPercentage = CONFIG.RISK_PERCENTAGE;

    // Adjust risk based on tradeable score (70 is baseline)
    const scoreMultiplier = tradeableScore / 70;
    const adjustedRiskPercentage = baseRiskPercentage * scoreMultiplier;
    
    // Calculate amount but respect maximum per trade
    const calculatedAmount = WALLET_BALANCE * adjustedRiskPercentage;
    const maxPerTrade = CONFIG.MAX_SOL_PER_TRADE;
    const amount = Math.min(calculatedAmount, maxPerTrade);
    
    // Ensure minimum viable trade size
    const minTradeSize = 0.005; // 0.005 SOL minimum to account for fees
    // Ensure wallet balance is sufficient for minimum trade size plus reserved fee
    if (WALLET_BALANCE < minTradeSize + 0.002) {
        logger.warn('Insufficient wallet balance for a viable trade.');
        return 0; // Return 0 to indicate no trade can be made
    }

    const finalAmount = Math.max(amount, minTradeSize);
    
    // Ensure we don't exceed balance (keep 0.002 SOL for fees)
    const safeAmount = WALLET_BALANCE > 0.002 
      ? Math.min(finalAmount, WALLET_BALANCE - 0.002) 
      : 0;
    
    logger.debug(
      `Trade amount calculation: ${safeAmount.toFixed(4)} SOL ` +
      `(${adjustedRiskPercentage * 100}% adjusted risk, score: ${tradeableScore})`
    );
    
    return safeAmount;