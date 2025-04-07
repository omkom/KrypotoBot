/**
 * Core trading bot engine with market scanning, trade execution, and position management
 * Provides a complete lifecycle for token evaluation, trading and monitoring with
 * centralized control and error handling
 * 
 * @module bot
 * @requires ../services/logger
 * @requires ../config/index
 * @requires ./execution
 * @requires ./monitoring
 * @requires ../api/dexscreener
 * @requires ../analyzers/tokenAnalyzer
 */

import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import bs58 from 'bs58';

import logger from '../services/logger.js';
import config from '../config/index.js';
import errorHandler, { ErrorSeverity } from '../services/errorHandler.js';
import { getLatestTokens, getPairInfo } from '../api/dexscreener.js';
import { analyzeToken } from '../analyzers/tokenAnalyzer.js';
import { evaluateTokenROI } from '../analyzers/tokenROIAnalyzer.js';
import { buyToken, sellToken, optimizeTradeParameters } from './execution.js';
import { startPositionMonitor, stopMonitoring, getActivePositions } from './monitoring.js';
import * as metrics from '../services/metrics.js';
import tokenLogs from '../services/tokenLogs.js';

// Track processed tokens to avoid duplicates
const processedTokens = new Set();

// Internal state
let tradingEnabled = true;    // Circuit breaker for trading system
let isShuttingDown = false;   // Shutdown flag
let tradingLoop = null;       // Trading loop interval handler
let walletBalance = 0;        // Current wallet SOL balance
let connectionInstance = null; // Solana connection instance
let walletInstance = null;    // Keypair instance

/**
 * Initializes Solana connection and wallet with fallback mechanisms
 * @returns {Promise<Object>} Connection and wallet objects
 */
async function initializeWallet() {
  logger.info('Initializing wallet and connection');
  
  try {
    // Get RPC URL based on environment
    const rpcUrl = config.get('SOLANA_RPC') || process.env.SOLANA_RPC_URL_PROD || 'https://api.mainnet-beta.solana.com';
    
    // Initialize Solana connection with optimized parameters
    const connection = new Connection(rpcUrl, {
      commitment: 'confirmed',
      disableRetryOnRateLimit: false,
      confirmTransactionInitialTimeout: 60000
    });
    
    // Determine environment and get appropriate private key
    let privateKey;
    if (config.get('ENV') === 'local') {
      privateKey = process.env.SOLANA_PRIVATE_KEY_LOCAL;
      
      if (!privateKey) {
        logger.warn('Local private key not found. Generating new wallet...');
        const newWallet = Keypair.generate();
        privateKey = bs58.encode(newWallet.secretKey);
        logger.info(`New private key generated: ${privateKey}`);
        walletInstance = newWallet;
      }
    } else {
      privateKey = process.env.SOLANA_PRIVATE_KEY_PROD;
    }
    
    if (!privateKey && !walletInstance) {
      throw new Error('No private key found in environment variables');
    }
    
    // Create keypair from private key if not already created
    if (!walletInstance) {
      const decodedPrivateKey = bs58.decode(privateKey);
      walletInstance = Keypair.fromSecretKey(decodedPrivateKey);
    }
    
    logger.success(`Wallet initialized: ${walletInstance.publicKey.toString()}`);
    
    // Test connection and check wallet balance
    connectionInstance = connection;
    await updateWalletBalance();
    
    return { connection, wallet: walletInstance, balance: walletBalance };
  } catch (error) {
    const handled = errorHandler.handleError(
      error, 
      'system', 
      ErrorSeverity.CRITICAL, 
      { component: 'initializeWallet' }
    );
    
    logger.error('Failed to initialize wallet', error);
    throw error;
  }
}

/**
 * Updates wallet balance and metrics
 * @returns {Promise<number>} Current balance in SOL
 */
async function updateWalletBalance() {
  try {
    if (!connectionInstance || !walletInstance) {
      throw new Error('Connection or wallet not initialized');
    }
    
    const balance = await connectionInstance.getBalance(walletInstance.publicKey);
    walletBalance = balance / 1_000_000_000; // Convert lamports to SOL
    
    // Log balance and update metrics
    logger.info(`Wallet balance: ${walletBalance.toFixed(4)} SOL`);
    metrics.updateWalletBalance(walletBalance);
    
    if (walletBalance < 0.05) {
      logger.warn('Wallet balance is low. Consider adding funds for trading.');
    }
    
    return walletBalance;
  } catch (error) {
    logger.error(`Error updating wallet balance: ${error.message}`);
    return 0;
  }
}

/**
 * Calculate optimal trade amount based on wallet balance, risk settings and token potential
 * @param {number} tradeableScore - Token score (0-100)
 * @returns {Promise<number>} Trade amount in SOL
 */
async function calculateTradeAmount(tradeableScore = 70) {
  try {
    // Use cached balance or update if needed
    if (walletBalance <= 0) {
      await updateWalletBalance();
    }
    
    // Calculate base risk percentage
    const baseRiskPercentage = config.get('RISK_PERCENTAGE');
    const maxPerTrade = config.get('MAX_SOL_PER_TRADE');
    
    // Adjust risk based on tradeable score (70 is baseline)
    const scoreMultiplier = tradeableScore / 70;
    const adjustedRiskPercentage = baseRiskPercentage * scoreMultiplier;
    
    // Calculate amount but respect maximum per trade
    const calculatedAmount = walletBalance * adjustedRiskPercentage;
    const amount = Math.min(calculatedAmount, maxPerTrade);
    
    // Ensure minimum viable trade size
    const minTradeSize = 0.005; // 0.005 SOL minimum to account for fees
    const finalAmount = Math.max(amount, minTradeSize);
    
    // Ensure we don't exceed balance (keep 0.002 SOL for fees)
    const safeAmount = Math.min(finalAmount, walletBalance - 0.002);
    
    logger.debug(
      `Trade amount calculation: ${safeAmount.toFixed(4)} SOL ` +
      `(${adjustedRiskPercentage * 100}% adjusted risk, score: ${tradeableScore})`
    );
    
    return safeAmount;
  } catch (error) {
    errorHandler.handleError(
      error, 
      'trading', 
      ErrorSeverity.MEDIUM, 
      { function: 'calculateTradeAmount' }
    );
    
    // Return safe default if error occurs
    return config.get('MAX_SOL_PER_TRADE') * 0.5;
  }
}

/**
 * Enhanced market scanning with robust filtering and token analysis
 * @returns {Promise<Array>} Tradeable tokens with analysis
 */
async function scanMarket() {
  logger.info('Scanning market for trading opportunities...');
  
  try {
    // Get latest tokens from DEXScreener
    const latestTokens = await getLatestTokens('solana', { force: true });
    
    if (!latestTokens || latestTokens.length === 0) {
      logger.warn('No tokens found meeting minimum criteria');
      return [];
    }
    
    logger.info(`Found ${latestTokens.length} tokens for analysis`);
    
    // Track tradeable opportunities
    const tradeableTokens = [];
    
    // Analyze each token in parallel with limit
    const analysisPromises = [];
    const batchSize = 5; // Process 5 tokens at a time to avoid rate limits
    
    for (let i = 0; i < Math.min(latestTokens.length, 30); i++) {
      const token = latestTokens[i];
      
      // Skip if already processed
      if (!token.baseToken?.address || processedTokens.has(token.baseToken.address)) {
        continue;
      }
      
      // Add to processed
      processedTokens.add(token.baseToken.address);
      
      // Function to analyze a single token
      const analyzeTokenAsync = async () => {
        try {
          // Get detailed pair info
          const pairInfo = await getPairInfo('solana', token.baseToken.address, { force: true });
          if (!pairInfo) return null;
          
          // Run token through both analyzers
          const tokenAnalysis = analyzeToken(pairInfo);
          const roiAnalysis = evaluateTokenROI(pairInfo);
          
          // Combine analyses
          const combinedScore = (tokenAnalysis.tradeable.score + roiAnalysis.potentialScore) / 2;
          
          // Check if token is tradeable
          const isTradeable = combinedScore >= 60 && 
                             roiAnalysis.manipulationRisk !== 'High' &&
                             !roiAnalysis.manipulationFlags.includes('EXTREME_SHORT_PUMP');
          
          if (isTradeable) {
            return {
              address: token.baseToken.address,
              name: token.baseToken.symbol,
              price: token.priceUsd,
              liquidity: token.liquidity?.usd || 0,
              volume24h: token.volume?.h24 || 0,
              score: combinedScore,
              analysis: {
                token: tokenAnalysis,
                roi: roiAnalysis
              }
            };
          }
          
          return null;
        } catch (error) {
          logger.error(`Error analyzing token ${token.baseToken?.symbol}`, error);
          return null;
        }
      };
      
      // Add to promises batch
      analysisPromises.push(analyzeTokenAsync());
      
      // Process in batches
      if (analysisPromises.length >= batchSize || i === latestTokens.length - 1) {
        const results = await Promise.all(analysisPromises);
        
        // Filter out nulls and add to tradeable tokens
        results.filter(result => result !== null)
              .forEach(token => tradeableTokens.push(token));
        
        // Clear promises for next batch
        analysisPromises.length = 0;
        
        // Add delay between batches to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // Sort by score (highest first)
    tradeableTokens.sort((a, b) => b.score - a.score);
    
    logger.info(`Found ${tradeableTokens.length} tradeable tokens after analysis`);
    
    // Update metrics
    metrics.recordScanResults(tradeableTokens.length, latestTokens.length);
    
    return tradeableTokens;
  } catch (error) {
    const handled = errorHandler.handleError(
      error, 
      'api', 
      ErrorSeverity.HIGH, 
      { component: 'scanMarket' }
    );
    
    logger.error('Error scanning market', error);
    return [];
  }
}

/**
 * Execute trades based on market scan results
 * @param {Array} tradeableTokens - Tradeable tokens with analysis
 * @returns {Promise<Array>} Executed trades
 */
async function executeTrades(tradeableTokens) {
  if (!tradeableTokens || tradeableTokens.length === 0) {
    logger.info('No tradeable tokens found');
    return [];
  }
  
  logger.info(`Preparing to execute trades for top tokens (${tradeableTokens.length} available)`);
  
  // Check if circuit breaker is active
  if (!tradingEnabled) {
    logger.warn('Trading circuit breaker is active - skipping trades');
    return [];
  }
  
  // Ensure we have a connection and wallet
  if (!connectionInstance || !walletInstance) {
    logger.error('Connection or wallet not initialized');
    return [];
  }
  
  // Check wallet balance
  if (walletBalance < 0.01) {
    logger.warn(`Wallet balance too low for trading: ${walletBalance.toFixed(4)} SOL`);
    return [];
  }
  
  // Track executed trades
  const executedTrades = [];
  
  // Limit the number of trades per scan to avoid overexposure
  const maxTrades = Math.min(2, tradeableTokens.length);
  const tokensToTrade = tradeableTokens.slice(0, maxTrades);
  
  for (const token of tokensToTrade) {
    try {
      logger.trade(`Trading opportunity: ${token.name} (${token.address}), Score: ${token.score.toFixed(1)}/100`);
      
      // Calculate position size
      const tradeAmount = await calculateTradeAmount(token.score);
      
      // Skip if trade amount is too small
      if (tradeAmount < 0.005) {
        logger.warn(`Calculated trade amount too small: ${tradeAmount} SOL. Skipping.`);
        continue;
      }
      
      logger.trade(`Buying ${token.name} for ${tradeAmount.toFixed(4)} SOL`);
      
      // Execute purchase
      const buyResult = await buyToken(
        token.address,
        token.name,
        tradeAmount,
        connectionInstance,
        walletInstance
      );
      
      if (buyResult.success) {
        logger.success(`Successfully bought ${buyResult.tokensReceived} ${token.name}`);
        
        // Create position with exit strategy
        const position = createPosition(token, buyResult);
        
        // Record trade
        executedTrades.push({
          token: token.name,
          address: token.address,
          amount: buyResult.tokensReceived,
          cost: tradeAmount,
          position: position.id
        });
        
        // Update metrics
        metrics.recordPurchase({
          tokenAddress: token.address,
          tokenName: token.name,
          amount: buyResult.tokensReceived,
          costInSol: tradeAmount
        });
        
        // Log purchase for tracking
        tokenLogs.logTokenPurchase(
          token.address,
          token.name,
          buyResult.tokensReceived,
          tradeAmount,
          buyResult.tokensReceived,
          { isDryRun: config.get('DRY_RUN') }
        );
      } else {
        if (buyResult.scamDetected) {
          logger.warn(`Skipping potentially fraudulent token: ${token.name}`);
        } else {
          logger.error(`Failed to buy ${token.name}: ${buyResult.error}`);
        }
        
        // Record failed operation in metrics
        metrics.recordFailedOperation('buy', {
          tokenAddress: token.address,
          tokenName: token.name,
          amount: tradeAmount,
          error: buyResult.error || 'Scam detected'
        });
      }
      
      // Add delay between trades
      await new Promise(resolve => setTimeout(resolve, 5000));
    } catch (error) {
      logger.error(`Error executing trade for ${token.name}`, error);
      
      // Record error in metrics
      metrics.recordFailedOperation('buy', {
        tokenAddress: token.address,
        tokenName: token.name,
        error: error.message
      });
    }
  }
  
  logger.info(`Completed trading execution: ${executedTrades.length} trades executed`);
  
  // Update balance after trades
  await updateWalletBalance();
  
  return executedTrades;
}

/**
 * Creates and stores a new position with optimal exit strategy
 * @param {Object} tokenData - Token information
 * @param {Object} tradeResult - Result of buy transaction
 * @returns {Object} New position with exit strategy
 */
function createPosition(tokenData, tradeResult) {
  try {
    // Create position from token data and trade result
    const position = {
      id: `${tokenData.address}-${Date.now()}`,
      tokenAddress: tokenData.address,
      tokenName: tokenData.name,
      amount: tradeResult.tokensReceived,
      entryPrice: tradeResult.amountInSol / tradeResult.tokensReceived,
      entryAmountSol: tradeResult.amountInSol,
      entryTime: Date.now(),
      tradeHash: tradeResult.signature
    };
    
    // Get trade parameters from token analysis if available
    let params = {};
    
    if (tokenData.analysis) {
      params = optimizeTradeParameters(tokenData.analysis);
    }
    
    // Start position monitoring
    startPositionMonitor(
      position.tokenAddress,
      position.tokenName,
      position.amount,
      {
        takeProfitPct: params.takeProfitPct || config.get('TAKE_PROFIT'),
        stopLossPct: params.stopLossPct || config.get('STOP_LOSS'),
        trailingStopActivationPct: params.trailingStopActivationPct || 20,
        trailingStopDistancePct: params.trailingStopDistancePct || 10,
        maxHoldTimeMinutes: params.maxHoldTimeMinutes || 60,
        exitStages: params.exitStages || [
          { percent: 25, sellPortion: 0.25 },
          { percent: 50, sellPortion: 0.5 },
          { percent: 100, sellPortion: 1.0 }
        ]
      },
      connectionInstance,
      walletInstance
    );
    
    // Log position creation
    logger.trade(`New position created: ${tokenData.name} (${position.amount} tokens)`);
    
    return position;
  } catch (error) {
    logger.error(`Error creating position for ${tokenData.name}`, error);
    throw error;
  }
}

/**
 * Sells all active positions (used during shutdown)
 * @returns {Promise<Object>} Results of emergency sell operation
 */
async function sellAllPositions() {
  logger.warn('EMERGENCY SELL: Closing all active positions');
  
  const results = {
    success: [],
    failed: []
  };
  
  // Get all active positions
  const positions = getActivePositions();
  
  for (const position of positions) {
    try {
      // Skip already closed positions
      if (position.status !== 'active' || position.amount <= 0) continue;
      
      logger.trade(`Emergency selling ${position.amount} ${position.tokenName}`);
      
      // Execute sale
      const saleResult = await sellToken(
        position.tokenAddress,
        position.tokenName,
        position.amount,
        connectionInstance,
        walletInstance,
        { reason: 'Emergency Shutdown' }
      );
      
      if (saleResult.success) {
        results.success.push({
          tokenName: position.tokenName,
          amount: saleResult.amount,
          solReceived: saleResult.solReceived,
          roi: saleResult.roi
        });
        
        // Log the sale
        tokenLogs.logTokenSale(
          position.tokenAddress,
          position.tokenName,
          position.amount,
          saleResult.solReceived,
          { reason: 'Emergency Shutdown' },
          config.get('DRY_RUN')
        );
        
        // Stop monitoring
        stopMonitoring(position.tokenAddress);
      } else {
        results.failed.push({
          tokenName: position.tokenName,
          amount: position.amount,
          error: saleResult.error
        });
      }
    } catch (error) {
      logger.error(`Error emergency selling ${position.tokenName}`, error);
      results.failed.push({
        tokenName: position.tokenName,
        amount: position.amount,
        error: error.message
      });
    }
    
    // Brief delay between sales
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  logger.info(`Emergency sell completed: ${results.success.length} successful, ${results.failed.length} failed`);
  
  // Update balance after sales
  await updateWalletBalance();
  
  return results;
}

/**
 * Core trading loop that scans market and executes trades
 */
async function runTradingCycle() {
  try {
    logger.info('Starting trading cycle...');
    
    // Scan market for opportunities
    const tradeableTokens = await scanMarket();
    
    // Execute trades
    const executedTrades = await executeTrades(tradeableTokens);
    
    // Log results
    logger.info(`Trading cycle completed: ${executedTrades.length} positions opened`);
    
    // Update metrics
    metrics.updateActiveTrades(getActivePositions().length);
    
    // Schedule next cycle with random delay (45-75 seconds)
    const nextDelay = 45000 + Math.floor(Math.random() * 30000);
    tradingLoop = setTimeout(runTradingCycle, nextDelay);
  } catch (error) {
    const handled = errorHandler.handleError(
      error, 
      'trading', 
      ErrorSeverity.HIGH, 
      { component: 'tradingCycle' }
    );
    
    logger.error('Error in trading loop', error);
    
    // Trigger circuit breaker if critical error
    if (error.message.includes('insufficient funds') || 
        error.message.includes('account not found')) {
      logger.error('Critical trading error detected - activating circuit breaker');
      tradingEnabled = false;
      
      // Auto-reset after 15 minutes
      setTimeout(() => {
        tradingEnabled = true;
        logger.info('Trading circuit breaker reset - trading resumed');
      }, 15 * 60 * 1000);
    }
    
    // Schedule next attempt if not shutting down (with longer delay 2-3 minutes)
    if (!isShuttingDown) {
      const errorDelay = 120000 + Math.floor(Math.random() * 60000);
      tradingLoop = setTimeout(runTradingCycle, errorDelay);
    }
  }
}

/**
 * Starts the trading bot
 * @returns {Promise<Object>} Bot control interface
 */
export async function startBot() {
  logger.info(`Starting KryptoBot (${config.get('ENV')} mode)`);
  logger.info(`Debug: ${config.get('DEBUG') ? 'ON' : 'OFF'}, Dry Run: ${config.get('DRY_RUN') ? 'ON' : 'OFF'}`);
  
  try {
    // Reset shutdown flag
    isShuttingDown = false;
    
    // Initialize trading flag
    tradingEnabled = true;
    
    // Initialize connection and wallet
    const { connection, wallet } = await initializeWallet();
    
    // Clear old processed tokens
    processedTokens.clear();
    
    // Start trading loop
    runTradingCycle();
    
    logger.success('Bot started successfully');
    
    // Return control interface
    return {
      stop: stopBot,
      getActivePositions,
      getStats: metrics.getStats,
      connection,
      wallet
    };
  } catch (error) {
    logger.error('Fatal error starting bot', error);
    throw error;
  }
}

/**
 * Stops the trading bot and performs cleanup
 * @returns {Promise<boolean>} Success indicator
 */
export async function stopBot() {
  logger.info('Stopping bot...');
  isShuttingDown = true;
  
  // Stop trading cycle
  if (tradingLoop) {
    clearTimeout(tradingLoop);
    tradingLoop = null;
  }
  
  // Clean up active positions
  if (config.get('SELL_ON_SHUTDOWN')) {
    await sellAllPositions();
  }
  
  logger.info('Bot stopped successfully');
  return true;
}

// Export main functions
export default {
  startBot,
  stopBot,
  getActivePositions
};