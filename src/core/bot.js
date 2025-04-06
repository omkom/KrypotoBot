// src/core/bot.js
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import bs58 from 'bs58';
import logger from '../services/logger.js';
import config from '../config/index.js';
import errorHandler, { ErrorSeverity } from '../services/errorHandler.js';
import { getLatestTokens, getPairInfo } from '../api/dexscreener.js';
import { analyzeToken } from '../analyzers/tokenAnalyzer.js';
import { analyzeAdvancedROI } from '../analyzers/advancedRoiAnalyzer.js';
import { buyToken, sellToken, optimizeTradeParameters } from './execution.js';
import ExitStrategyManager from './exitStrategyManager.js';
import metrics from '../services/metrics.js';

// Track active trading positions
const activePositions = new Map();
// Track already processed tokens to avoid duplicates
const processedTokens = new Set();
// Circuit breaker for trading system
let tradingEnabled = true;
// Shutdown flag
let isShuttingDown = false;

/**
 * Initialize Solana connection and wallet
 * @returns {Promise<Object>} Connection and wallet objects
 */
export async function initializeWallet() {
  logger.info('Initializing wallet and connection');
  
  try {
    // Get RPC URL based on environment
    const rpcUrl = config.get('SOLANA_RPC');
    
    // Initialize Solana connection with optimized parameters
    const connection = new Connection(rpcUrl, {
      commitment: 'confirmed',
      disableRetryOnRateLimit: false,
      confirmTransactionInitialTimeout: 60000
    });
    
    // Get private key based on environment
    const privateKey = process.env.ENV === 'local' 
      ? process.env.SOLANA_PRIVATE_KEY_LOCAL 
      : process.env.SOLANA_PRIVATE_KEY_PROD;
    
    if (!privateKey) {
      throw new Error('No private key found in environment variables');
    }
    
    // Create keypair from private key
    const decodedPrivateKey = bs58.decode(privateKey);
    const wallet = Keypair.fromSecretKey(decodedPrivateKey);
    
    logger.success(`Wallet initialized: ${wallet.publicKey.toString()}`);
    
    // Check wallet balance
    const balance = await connection.getBalance(wallet.publicKey);
    const solBalance = balance / 1_000_000_000; // Convert lamports to SOL
    
    // Log balance and update metrics
    logger.info(`Wallet balance: ${solBalance.toFixed(4)} SOL`);
    metrics.updateWalletBalance(solBalance);
    
    if (solBalance < 0.05) {
      logger.warn('Wallet balance is low. Consider adding funds for trading.');
    }
    
    return { connection, wallet, balance: solBalance };
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
 * Calculate optimal trade amount based on wallet balance, risk settings and token potential
 * @param {Connection} connection - Solana connection
 * @param {Keypair} wallet - Wallet keypair
 * @param {number} tradeableScore - Token score (0-100)
 * @returns {Promise<number>} Trade amount in SOL
 */
export async function calculateTradeAmount(connection, wallet, tradeableScore = 70) {
  try {
    // Get wallet balance
    const balance = await connection.getBalance(wallet.publicKey);
    const solBalance = balance / 1_000_000_000;
    
    // Update metrics
    metrics.updateWalletBalance(solBalance);
    
    // Calculate base risk percentage
    const baseRiskPercentage = config.get('RISK_PERCENTAGE');
    const maxPerTrade = config.get('MAX_SOL_PER_TRADE');
    
    // Adjust risk based on tradeable score (70 is baseline)
    const scoreMultiplier = tradeableScore / 70;
    const adjustedRiskPercentage = baseRiskPercentage * scoreMultiplier;
    
    // Calculate amount but respect maximum per trade
    const calculatedAmount = solBalance * adjustedRiskPercentage;
    const amount = Math.min(calculatedAmount, maxPerTrade);
    
    // Ensure minimum viable trade size
    const minTradeSize = 0.005; // 0.005 SOL minimum to account for fees
    const finalAmount = Math.max(amount, minTradeSize);
    
    // Ensure we don't exceed balance (keep 0.002 SOL for fees)
    const safeAmount = Math.min(finalAmount, solBalance - 0.002);
    
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
 * Creates and stores a new position with optimal exit strategy
 * @param {Object} tokenData - Token information
 * @param {Object} tradeResult - Result of buy transaction
 * @param {Object} connection - Solana connection
 * @param {Object} wallet - Wallet keypair
 * @returns {Object} New position with exit strategy
 */
function createPosition(tokenData, tradeResult, connection, wallet) {
  try {
    // Create position data structure
    const position = {
      id: `${tokenData.address}-${Date.now()}`,
      tokenAddress: tokenData.address,
      tokenName: tokenData.name,
      amount: tradeResult.tokensReceived,
      entryPrice: tradeResult.amountInSol / tradeResult.tokensReceived,
      entryAmountSol: tradeResult.amountInSol,
      entryTime: Date.now(),
      tradeHash: tradeResult.signature,
      lastUpdated: Date.now(),
      exitStrategy: null,
      analysis: tokenData.analysis,
      status: 'active',
      // Methods for position management
      getCurrentPrice: async () => {
        try {
          const pairInfo = await getPairInfo('solana', tokenData.address);
          return pairInfo ? parseFloat(pairInfo.priceNative) : null;
        } catch (err) {
          logger.error(`Error getting price for ${tokenData.name}`, err);
          return null;
        }
      },
      sell: async (amount, reason) => {
        return await sellPosition(position, amount, reason, connection, wallet);
      }
    };
    
    // Create exit strategy for this position
    const baseStrategy = {
      takeProfitLevels: [25, 50, 100],
      takeProfitAmounts: [0.3, 0.4, 0.3],
      stopLoss: -15,
      trailingStopEnabled: true,
      trailingStopActivation: 20,
      trailingStopTrail: 10,
      maxHoldTime: 60, // Minutes
      trendMonitoringEnabled: true
    };
    
    // If we have analysis data, optimize the strategy
    if (tokenData.analysis) {
      const params = optimizeTradeParameters(tokenData.analysis);
      baseStrategy.takeProfitLevels = params.takeProfitLevels || baseStrategy.takeProfitLevels;
      baseStrategy.takeProfitAmounts = params.takeProfitAmounts || baseStrategy.takeProfitAmounts;
      baseStrategy.stopLoss = params.stopLoss || baseStrategy.stopLoss;
      baseStrategy.trailingStopActivation = params.trailingStopActivationPct || baseStrategy.trailingStopActivation;
      baseStrategy.trailingStopTrail = params.trailingStopDistancePct || baseStrategy.trailingStopTrail;
      baseStrategy.maxHoldTime = params.maxHoldTimeMinutes || baseStrategy.maxHoldTime;
    }
    
    // Create exit strategy manager
    position.exitStrategy = new ExitStrategyManager(position, baseStrategy);
    
    // Track position
    activePositions.set(position.id, position);
    
    // Schedule monitoring
    startPositionMonitoring(position, connection, wallet);
    
    // Log and track metrics
    logger.trade(`New position created: ${tokenData.name} (${position.amount} tokens)`);
    metrics.recordNewPosition(position);
    
    return position;
  } catch (error) {
    logger.error(`Error creating position for ${tokenData.name}`, error);
    throw error;
  }
}

/**
 * Start monitoring a position for exit conditions
 * @param {Object} position - Position to monitor
 * @param {Object} connection - Solana connection
 * @param {Object} wallet - Wallet keypair
 */
function startPositionMonitoring(position, connection, wallet) {
  // Skip if already shutting down
  if (isShuttingDown) return;
  
  logger.debug(`Starting monitoring for ${position.tokenName}`);
  
  // Set monitoring interval (check every 15 seconds)
  const intervalId = setInterval(async () => {
    try {
      // Skip if position is no longer active
      if (position.status !== 'active' || !activePositions.has(position.id)) {
        clearInterval(intervalId);
        return;
      }
      
      // Get current price
      const currentPrice = await position.getCurrentPrice();
      if (!currentPrice) {
        logger.warn(`Could not get current price for ${position.tokenName}`);
        return;
      }
      
      // Update exit strategy with current price
      position.exitStrategy.updatePrice(currentPrice);
      
      // Check exit conditions
      const exitCondition = position.exitStrategy.checkExitConditions();
      
      // Log status at intervals (not every check)
      if (Math.random() < 0.2) { // ~20% of checks
        const status = position.exitStrategy.getStrategyStatus();
        logger.debug(
          `${position.tokenName}: ROI=${status.currentRoi.toFixed(2)}%, ` +
          `Price=${currentPrice.toFixed(8)}, ` +
          `TrailingStop=${status.trailingStop.active ? 'Active' : 'Inactive'}`
        );
      }
      
      // Execute exit if condition triggered
      if (exitCondition.triggered) {
        logger.trade(`Exit condition triggered for ${position.tokenName}: ${exitCondition.reason}`);
        
        // Execute the sale
        const saleResult = await position.sell(exitCondition.sellAmount, exitCondition.reason);
        
        // Record the exit in strategy
        position.exitStrategy.recordExit(exitCondition, saleResult);
        
        // If position is fully sold, stop monitoring
        if (position.amount <= 0) {
          clearInterval(intervalId);
          position.status = 'closed';
          activePositions.delete(position.id);
          logger.trade(`Position closed for ${position.tokenName}`);
          metrics.recordClosedPosition(position);
        }
      }
    } catch (error) {
      logger.error(`Error monitoring ${position.tokenName}`, error);
    }
  }, 15000); // 15 second interval
  
  // Store interval ID for cleanup
  position.monitoringInterval = intervalId;
}

/**
 * Executes a sell operation for a position
 * @param {Object} position - Position to sell
 * @param {number} amount - Amount to sell
 * @param {string} reason - Reason for selling
 * @param {Object} connection - Solana connection
 * @param {Object} wallet - Wallet keypair
 * @returns {Promise<Object>} Sell transaction result
 */
async function sellPosition(position, amount, reason, connection, wallet) {
  logger.trade(`Selling ${amount} of ${position.tokenName} (${reason})`);
  
  try {
    // Ensure we don't sell more than we have
    const sellAmount = Math.min(amount, position.amount);
    
    // Execute the sale
    const saleResult = await sellToken(
      position.tokenAddress,
      position.tokenName,
      sellAmount,
      connection,
      wallet
    );
    
    if (saleResult.success) {
      // Update position data
      position.amount -= sellAmount;
      position.lastUpdated = Date.now();
      
      // Calculate profit metrics
      const solReceived = saleResult.solReceived;
      const costBasis = sellAmount * position.entryPrice;
      const profit = solReceived - costBasis;
      const roi = ((solReceived / costBasis) - 1) * 100;
      
      // Log success
      logger.trade(
        `Sold ${sellAmount} ${position.tokenName} for ${solReceived.toFixed(6)} SOL ` +
        `(${roi.toFixed(2)}% ROI)`
      );
      
      // Update metrics
      metrics.recordSale({
        tokenAddress: position.tokenAddress,
        tokenName: position.tokenName,
        amount: sellAmount,
        solReceived,
        profit,
        roi,
        reason
      });
      
      return {
        success: true,
        amount: sellAmount,
        solReceived,
        profit,
        roi,
        reason,
        signature: saleResult.signature
      };
    } else {
      logger.error(`Failed to sell ${position.tokenName}: ${saleResult.error}`);
      
      // Update metrics
      metrics.recordFailedOperation('sell', {
        tokenAddress: position.tokenAddress,
        tokenName: position.tokenName,
        amount: sellAmount,
        error: saleResult.error
      });
      
      return {
        success: false,
        error: saleResult.error
      };
    }
  } catch (error) {
    logger.error(`Error in sellPosition for ${position.tokenName}`, error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Enhanced market scanning with robust filtering and token analysis
 * @param {Connection} connection - Solana connection
 * @param {Keypair} wallet - Wallet keypair
 * @returns {Promise<Array>} Tradeable tokens with analysis
 */
export async function scanMarket(connection, wallet) {
  logger.info('Scanning market for trading opportunities...');
  
  try {
    // Get latest tokens from DEXScreener
    const latestTokens = await getLatestTokens('solana', { force: true });
    
    if (latestTokens.length === 0) {
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
      if (processedTokens.has(token.baseToken?.address)) {
        continue;
      }
      
      // Add to processed
      if (token.baseToken?.address) {
        processedTokens.add(token.baseToken.address);
      }
      
      // Function to analyze a single token
      const analyzeTokenAsync = async () => {
        try {
          // Get detailed pair info
          const pairInfo = await getPairInfo('solana', token.baseToken.address, { force: true });
          if (!pairInfo) return null;
          
          // Run token through both analyzers
          const tokenAnalysis = analyzeToken(pairInfo);
          const roiAnalysis = analyzeAdvancedROI(pairInfo);
          
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
 * @param {Connection} connection - Solana connection
 * @param {Keypair} wallet - Wallet keypair
 * @returns {Promise<Array>} Executed trades
 */
async function executeTrades(tradeableTokens, connection, wallet) {
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
  
  // Get wallet balance for trade sizing
  const { balance } = await connection.getBalance(wallet.publicKey) / 1_000_000_000;
  if (balance < 0.01) {
    logger.warn(`Wallet balance too low for trading: ${balance.toFixed(4)} SOL`);
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
      const tradeAmount = await calculateTradeAmount(connection, wallet, token.score);
      
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
        connection,
        wallet
      );
      
      if (buyResult.success) {
        logger.success(`Successfully bought ${buyResult.tokensReceived} ${token.name}`);
        
        // Create position with exit strategy
        const position = createPosition(token, buyResult, connection, wallet);
        
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
  return executedTrades;
}

/**
 * Core trading loop that scans market and executes trades
 * @param {Connection} connection - Solana connection
 * @param {Keypair} wallet - Wallet keypair
 */
async function tradingLoop(connection, wallet) {
  try {
    logger.info('Starting trading cycle...');
    
    // Scan market for opportunities
    const tradeableTokens = await scanMarket(connection, wallet);
    
    // Execute trades
    const executedTrades = await executeTrades(tradeableTokens, connection, wallet);
    
    // Log results
    logger.info(`Trading cycle completed: ${executedTrades.length} positions opened`);
    
    // Update metrics
    metrics.updateActiveTrades(activePositions.size);
    
    // Schedule next cycle
    if (!isShuttingDown) {
      // Random time between 45-75 seconds to avoid predictable patterns
      const nextDelay = 45000 + Math.floor(Math.random() * 30000);
      setTimeout(() => tradingLoop(connection, wallet), nextDelay);
    }
  } catch (error) {
    const handled = errorHandler.handleError(
      error, 
      'trading', 
      ErrorSeverity.HIGH, 
      { component: 'tradingLoop' }
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
    
    // Schedule next attempt if not shutting down
    if (!isShuttingDown) {
      // Longer delay after error (2-3 minutes)
      const errorDelay = 120000 + Math.floor(Math.random() * 60000);
      setTimeout(() => tradingLoop(connection, wallet), errorDelay);
    }
  }
}

/**
 * Get active positions data
 * @returns {Array} All active positions
 */
export function getActivePositions() {
  return Array.from(activePositions.values()).map(position => ({
    id: position.id,
    tokenName: position.tokenName,
    tokenAddress: position.tokenAddress,
    amount: position.amount,
    entryPrice: position.entryPrice,
    entryTime: position.entryTime,
    currentROI: position.exitStrategy ? position.exitStrategy.getCurrentRoi() : 0,
    status: position.status
  }));
}

/**
 * Sell all active positions (used during shutdown)
 * @param {Connection} connection - Solana connection
 * @param {Keypair} wallet - Wallet keypair
 * @returns {Promise<Object>} Results of emergency sell operation
 */
export async function sellAllPositions(connection, wallet) {
  logger.warn('EMERGENCY SELL: Closing all active positions');
  
  const results = {
    success: [],
    failed: []
  };
  
  // Get all active positions
  const positions = Array.from(activePositions.values());
  
  for (const position of positions) {
    try {
      // Skip already closed positions
      if (position.status !== 'active' || position.amount <= 0) continue;
      
      logger.trade(`Emergency selling ${position.amount} ${position.tokenName}`);
      
      // Execute sale
      const saleResult = await position.sell(
        position.amount, 
        'Emergency Shutdown'
      );
      
      if (saleResult.success) {
        results.success.push({
          tokenName: position.tokenName,
          amount: saleResult.amount,
          solReceived: saleResult.solReceived,
          roi: saleResult.roi
        });
        
        // Mark position as closed
        position.status = 'closed';
        activePositions.delete(position.id);
        
        // Clear monitoring interval
        if (position.monitoringInterval) {
          clearInterval(position.monitoringInterval);
        }
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
  return results;
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
    await tradingLoop(connection, wallet);
    
    logger.success('Bot started successfully');
    
    // Return control interface
    return {
      stop: async () => {
        logger.info('Stopping bot...');
        isShuttingDown = true;
        
        // Clean up active positions
        if (config.get('SELL_ON_SHUTDOWN')) {
          await sellAllPositions(connection, wallet);
        }
        
        // Clean up monitoring intervals
        for (const position of activePositions.values()) {
          if (position.monitoringInterval) {
            clearInterval(position.monitoringInterval);
          }
        }
        
        logger.info('Bot stopped successfully');
      },
      getActivePositions,
      connection,
      wallet,
      metrics: () => metrics.getStats()
    };
  } catch (error) {
    logger.error('Fatal error starting bot', error);
    throw error;
  }
}

export default {
  startBot,
  initializeWallet,
  scanMarket,
  getActivePositions,
  sellAllPositions
};