// src/core/bot.js - Main trading bot module
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import logger from '../services/logger.js';
import config from '../config/index.js';
import { getLatestTokens } from '../api/dexscreener.js';
import { analyzeToken } from '../analyzers/tokenAnalyzer.js';
import { buyToken } from './execution.js';
import { startPositionMonitor } from './monitoring.js';
import { optimizeTradeParameters } from './execution.js';

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
    logger.info(`Wallet balance: ${solBalance.toFixed(4)} SOL`);
    
    if (solBalance < 0.05) {
      logger.warn('Wallet balance is low. Consider adding funds for trading.');
    }
    
    return { connection, wallet };
  } catch (error) {
    logger.error('Failed to initialize wallet', error);
    throw error;
  }
}

/**
 * Calculate trade amount based on wallet balance and risk settings
 * @param {Connection} connection - Solana connection
 * @param {Keypair} wallet - Wallet keypair
 * @returns {Promise<number>} Trade amount in SOL
 */
export async function calculateTradeAmount(connection, wallet) {
  try {
    // Get wallet balance
    const balance = await connection.getBalance(wallet.publicKey);
    const solBalance = balance / 1_000_000_000;
    
    // Calculate amount based on risk percentage
    const riskPercentage = config.get('RISK_PERCENTAGE');
    const maxPerTrade = config.get('MAX_SOL_PER_TRADE');
    
    // Calculate amount but respect maximum per trade
    const amount = Math.min(solBalance * riskPercentage, maxPerTrade);
    
    logger.debug(`Calculated trade amount: ${amount.toFixed(4)} SOL (${riskPercentage * 100}% risk)`);
    return amount;
  } catch (error) {
    logger.error('Error calculating trade amount', error);
    return config.get('MAX_SOL_PER_TRADE') * 0.5; // Default to half max as fallback
  }
}

/**
 * Core scanning function to detect and trade new tokens
 * @param {Connection} connection - Solana connection
 * @param {Keypair} wallet - Wallet keypair
 */
export async function scanAndTradeTokens(connection, wallet) {
  try {
    logger.info('Scanning for new trading opportunities...');
    
    // Get latest tokens from DEXScreener
    const latestTokens = await getLatestTokens('solana', { force: true });
    
    if (latestTokens.length === 0) {
      logger.warn('No tokens found meeting minimum criteria');
      return;
    }
    
    logger.info(`Found ${latestTokens.length} tokens for analysis`);
    
    // Track high potential tokens
    const opportunities = [];
    
    // Analyze each token
    for (const token of latestTokens) {
      try {
        // Complete token analysis
        const analysis = analyzeToken(token);
        
        // Store tradeable tokens
        if (analysis.tradeable.isTradeable) {
          opportunities.push({
            token: analysis.token,
            tradeableScore: analysis.tradeable.score,
            analysis
          });
        }
      } catch (error) {
        logger.error(`Error analyzing token ${token.baseToken?.symbol || 'unknown'}`, error);
      }
    }
    
    // Sort by tradeable score (highest first)
    opportunities.sort((a, b) => b.tradeableScore - a.tradeableScore);
    
    logger.info(`Found ${opportunities.length} tradeable opportunities`);
    
    // Process top opportunities (limit to 2 to avoid spreading capital too thin)
    const topOpportunities = opportunities.slice(0, 2);
    
    for (const opportunity of topOpportunities) {
      try {
        const tokenName = opportunity.token.name;
        const tokenAddress = opportunity.token.address;
        
        logger.trade(`Trading opportunity: ${tokenName} (${tokenAddress}), Score: ${opportunity.tradeableScore.toFixed(1)}/100`);
        
        // Optimize trade parameters based on analysis
        const tradeParams = optimizeTradeParameters(opportunity.analysis);
        
        // Calculate position size
        const baseAmount = await calculateTradeAmount(connection, wallet);
        const tradeAmount = baseAmount * tradeParams.entryScalePct;
        
        logger.trade(`Buying ${tokenName} for ${tradeAmount.toFixed(4)} SOL with optimized parameters`);
        
        // Execute purchase
        const buyResult = await buyToken(
          tokenAddress,
          tokenName,
          tradeAmount,
          connection,
          wallet
        );
        
        if (buyResult.success) {
          logger.success(`Successfully bought ${buyResult.tokensReceived} ${tokenName}`);
          
          // Start position monitoring with optimized exit strategy
          startPositionMonitor(
            tokenAddress,
            tokenName,
            buyResult.tokensReceived,
            tradeParams,
            connection,
            wallet
          );
        } else {
          if (buyResult.scamDetected) {
            logger.warn(`Skipping potentially fraudulent token: ${tokenName}`);
          } else {
            logger.error(`Failed to buy ${tokenName}: ${buyResult.error}`);
          }
        }
        
        // Add delay before next purchase to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 5000));
      } catch (error) {
        logger.error(`Error trading opportunity`, error);
      }
    }
  } catch (error) {
    logger.error('Error in scan and trade process', error);
  }
}

/**
 * Starts the trading bot with continuous scanning
 * @returns {Promise<Object>} Bot control interface
 */
export async function startBot() {
  logger.info(`Starting memecoin trading bot (${config.get('ENV')} mode)`);
  logger.info(`Debug: ${config.get('DEBUG') ? 'ON' : 'OFF'}, Dry Run: ${config.get('DRY_RUN') ? 'ON' : 'OFF'}`);
  
  // Initialize connection and wallet
  const { connection, wallet } = await initializeWallet();
  
  // Initial scan
  await scanAndTradeTokens(connection, wallet);
  
  // Set up interval for continuous scanning
  const intervalMinutes = 1; // Scan every minute
  const intervalId = setInterval(
    () => scanAndTradeTokens(connection, wallet),
    intervalMinutes * 60 * 1000
  );
  
  logger.success(`Bot running with ${intervalMinutes} minute scan interval`);
  
  // Return control interface
  return {
    stop: () => {
      clearInterval(intervalId);
      logger.info('Trading bot stopped');
    },
    connection,
    wallet
  };
}

export default {
  initializeWallet,
  calculateTradeAmount,
  scanAndTradeTokens,
  startBot
};