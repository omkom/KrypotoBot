/**
 * Memecoin Sniping Bot - Core Module
 * 
 * This advanced bot monitors and executes trades on newly listed memecoins
 * using optimized algorithms and blockchain integration techniques.
 * 
 * @author Advanced Coding AI
 * @version 1.0.0
 */

// Import required dependencies
const { Connection, PublicKey, Keypair, Transaction } = require('@solana/web3.js');
const { TokenListProvider } = require('@solana/spl-token-registry');
const fetch = require('node-fetch');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const axiosRetry = require('axios-retry');
const axios = require('axios');

// Configure axios with retry logic for resilient API calls
axiosRetry(axios, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (error) => {
    return axiosRetry.isNetworkOrIdempotentRequestError(error) || error.code === 'ECONNABORTED';
  }
});

// Load environment variables
dotenv.config();

// Initialize configuration based on environment
const ENV = process.env.ENV || 'local';
const DEBUG = process.env.DEBUG === 'true';
const DRY_RUN = process.env.DRY_RUN === 'true';
const VERBOSE = process.env.VERBOSE === 'true';

/**
 * Configuration loader that selects appropriate settings based on environment
 * @returns {Object} Complete configuration object
 */
function loadConfig() {
  // Base configuration applicable to all environments
  const baseConfig = {
    rpcUrl: ENV === 'prod' ? process.env.SOLANA_RPC_URL_PROD : process.env.SOLANA_RPC_URL_LOCAL,
    privateKey: ENV === 'prod' ? process.env.SOLANA_PRIVATE_KEY_PROD : process.env.SOLANA_PRIVATE_KEY_LOCAL,
    dexscreenerApiUrl: process.env.DEXSCREENER_API_URL,
    jupiterApiBase: process.env.JUPITER_API_BASE,
    tradeAmount: parseFloat(process.env.TRADE_AMOUNT || '0.1'),
    slippage: parseFloat(process.env.SLIPPAGE || '2'),
    maxSolPerTrade: parseFloat(process.env.MAX_SOL_PER_TRADE || '0.01'),
    riskPercentage: parseFloat(process.env.RISK_PERCENTAGE || '0.3'),
    tradeLogPath: process.env.TRADE_LOG_PATH || './logs/trade_logs.json',
    blacklistedTokens: (process.env.BLACKLISTED_TOKENS || '').split(',').filter(Boolean)
  };
  
  // Environment-specific criteria
  const envConfig = {
    minLiquidityUsd: parseFloat(ENV === 'prod' ? process.env.PROD_MIN_LIQUIDITY_USD : process.env.LOCAL_MIN_LIQUIDITY_USD),
    minVolume24h: parseFloat(ENV === 'prod' ? process.env.PROD_MIN_VOLUME_24H : process.env.LOCAL_MIN_VOLUME_24H),
    minPriceChange24h: parseFloat(ENV === 'prod' ? process.env.PROD_MIN_PRICE_CHANGE_24H : process.env.LOCAL_MIN_PRICE_CHANGE_24H),
    minTokenAgeDays: parseFloat(ENV === 'prod' ? process.env.PROD_MIN_TOKEN_AGE_DAYS : process.env.LOCAL_MIN_TOKEN_AGE_DAYS),
    maxTokenAgeDays: parseFloat(ENV === 'prod' ? process.env.PROD_MAX_TOKEN_AGE_DAYS : process.env.LOCAL_MAX_TOKEN_AGE_DAYS || '365')
  };
  
  return { ...baseConfig, ...envConfig };
}

// Load the configuration
const config = loadConfig();

/**
 * Logger utility for consistent, color-coded output across the application
 * @type {Object}
 */
const logger = {
  /**
   * Log an informational message
   * @param {string} message - Message to log
   */
  info: (message) => {
    console.log(chalk.blue('ℹ INFO: ') + message);
  },
  
  /**
   * Log a success message
   * @param {string} message - Message to log
   */
  success: (message) => {
    console.log(chalk.green('✓ SUCCESS: ') + message);
  },
  
  /**
   * Log a warning message
   * @param {string} message - Message to log
   */
  warn: (message) => {
    console.log(chalk.yellow('⚠ WARNING: ') + message);
  },
  
  /**
   * Log an error message
   * @param {string} message - Message to log
   * @param {Error} [error] - Optional error object for stack trace
   */
  error: (message, error) => {
    console.log(chalk.red('✖ ERROR: ') + message);
    if (error && DEBUG) {
      console.log(chalk.red(error.stack));
    }
  },
  
  /**
   * Log a debug message (only when DEBUG is true)
   * @param {string} message - Message to log
   * @param {any} [data] - Optional data to display
   */
  debug: (message, data) => {
    if (DEBUG) {
      console.log(chalk.magenta('🔍 DEBUG: ') + message);
      if (data !== undefined) {
        console.log(chalk.gray(JSON.stringify(data, null, 2)));
      }
    }
  },
  
  /**
   * Log a trade-related message
   * @param {string} message - Message to log
   */
  trade: (message) => {
    console.log(chalk.cyan('💱 TRADE: ') + message);
  }
};

/**
 * Initialize the connection to Solana blockchain
 * @returns {Connection} Solana connection object
 */
function initializeConnection() {
  logger.debug(`Initializing Solana connection to: ${config.rpcUrl}`);
  try {
    return new Connection(config.rpcUrl, 'confirmed');
  } catch (error) {
    logger.error('Failed to initialize Solana connection', error);
    throw error;
  }
}

/**
 * Initialize the wallet from private key
 * @returns {Keypair} Solana keypair
 */
function initializeWallet() {
  try {
    // Create a keypair from the private key in the environment variable
    const privateKeyBytes = Uint8Array.from(
      Buffer.from(config.privateKey, 'base64')
    );
    return Keypair.fromSecretKey(privateKeyBytes);
  } catch (error) {
    logger.error('Failed to initialize wallet', error);
    throw error;
  }
}

/**
 * Fetch token metadata from Solana SPL Token Registry
 * @returns {Promise<Object>} Token metadata mapping
 */
async function fetchTokenRegistry() {
  try {
    logger.debug('Fetching token registry');
    const tokens = await new TokenListProvider().resolve();
    const tokenList = tokens.filterByClusterSlug('mainnet-beta').getList();
    
    // Create a map for faster lookups
    const tokenMap = {};
    tokenList.forEach(token => {
      tokenMap[token.address] = token;
    });
    
    logger.debug(`Fetched \${Object.keys(tokenMap).length} tokens from registry`);
    return tokenMap;
  } catch (error) {
    logger.error('Failed to fetch token registry', error);
    return {};
  }
}

/**
 * Fetch new token listings from DEXScreener API
 * @returns {Promise<Array>} Array of token listings that match criteria
 */
async function fetchNewTokens() {
  try {
    logger.debug('Fetching new token listings from DEXScreener');
    const response = await axios.get(`${config.dexscreenerApiUrl}/pairs/solana`, {
      timeout: 10000,
      headers: { 'Accept': 'application/json' }
    });
    
    const pairs = response.data.pairs || [];
    logger.debug(`Fetched \${pairs.length} total pairs`);
    
    // Filter pairs based on criteria
    const filteredPairs = pairs.filter(pair => {
      // Calculate token age in days
      const timestampMs = pair.pairCreatedAt || Date.now();
      const tokenAgeDays = (Date.now() - timestampMs) / (1000 * 60 * 60 * 24);
      
      // Apply all filters based on configuration
      return (
        parseFloat(pair.liquidity?.usd || 0) >= config.minLiquidityUsd &&
        parseFloat(pair.volume?.h24 || 0) >= config.minVolume24h &&
        Math.abs(parseFloat(pair.priceChange?.h24 || 0)) >= config.minPriceChange24h &&
        tokenAgeDays >= config.minTokenAgeDays &&
        tokenAgeDays <= config.maxTokenAgeDays &&
        !config.blacklistedTokens.includes(pair.baseToken.address)
      );
    });
    
    logger.debug(`Found \${filteredPairs.length} pairs matching criteria`);
    return filteredPairs;
  } catch (error) {
    logger.error('Failed to fetch new tokens', error);
    return [];
  }
}

/**
 * Analyze token safety and potential
 * @param {Object} token - Token data from DEXScreener
 * @param {Object} tokenMetadata - Token metadata from registry
 * @returns {Object} Analysis results
 */
function analyzeToken(token, tokenMetadata) {
  try {
    logger.debug(`Analyzing token: \${token.baseToken.symbol}`);
    
    // Basic token information
    const tokenInfo = {
      address: token.baseToken.address,
      symbol: token.baseToken.symbol,
      name: token.baseToken.name,
      liquidity: parseFloat(token.liquidity?.usd || 0),
      volume24h: parseFloat(token.volume?.h24 || 0),
      priceChange24h: parseFloat(token.priceChange?.h24 || 0),
      price: parseFloat(token.priceUsd || 0),
      verified: !!tokenMetadata[token.baseToken.address]
    };
    
    // Calculate risk score (lower is better)
    let riskScore = 0;
    
    // Unverified tokens are higher risk
    if (!tokenInfo.verified) riskScore += 30;
    
    // Low liquidity is high risk
    if (tokenInfo.liquidity < 1000) {
      riskScore += 25;
    } else if (tokenInfo.liquidity < 10000) {
      riskScore += 15;
    } else if (tokenInfo.liquidity < 50000) {
      riskScore += 5;
    }
    
    // Low volume is risky (could indicate low interest or liquidity trap)
    if (tokenInfo.volume24h < 1000) {
      riskScore += 20;
    } else if (tokenInfo.volume24h < 10000) {
      riskScore += 10;
    }
    
    // Extreme price changes can indicate volatility or manipulation
    if (Math.abs(tokenInfo.priceChange24h) > 50) {
      riskScore += 15;
    }
    
    // Calculate potential score (higher is better)
    let potentialScore = 0;
    
    // Higher volume indicates more interest
    potentialScore += Math.min(30, tokenInfo.volume24h / 1000);
    
    // Positive price momentum
    if (tokenInfo.priceChange24h > 0) {
      potentialScore += Math.min(25, tokenInfo.priceChange24h / 2);
    }
    
    // Verified tokens have more potential
    if (tokenInfo.verified) potentialScore += 20;
    
    // Good liquidity but not too high (established coins have less rapid growth potential)
    if (tokenInfo.liquidity > 5000 && tokenInfo.liquidity < 200000) {
      potentialScore += 25;
    }
    
    return {
      ...tokenInfo,
      riskScore,
      potentialScore,
      tradeable: riskScore < 70 && potentialScore > 30
    };
  } catch (error) {
    logger.error(`Failed to analyze token \${token.baseToken?.symbol}`, error);
    return {
      address: token.baseToken?.address,
      symbol: token.baseToken?.symbol,
      tradeable: false,
      error: error.message
    };
  }
}

/**
 * Calculate optimal trade size based on token analysis and config
 * @param {Object} tokenAnalysis - Analysis results from analyzeToken
 * @returns {number} Optimal trade amount in SOL
 */
function calculateTradeSize(tokenAnalysis) {
  try {
    // Base amount is the configured max SOL per trade
    let baseAmount = config.maxSolPerTrade;
    
    // Adjust based on risk score (lower risk = more investment)
    const riskFactor = Math.max(0, 1 - (tokenAnalysis.riskScore / 100));
    
    // Adjust based on potential score (higher potential = more investment)
    const potentialFactor = tokenAnalysis.potentialScore / 100;
    
    // Calculate optimal amount with risk and potential adjustments
    const optimalAmount = baseAmount * riskFactor * potentialFactor * config.riskPercentage;
    
    // Ensure we stay within limits
    return Math.min(config.maxSolPerTrade, Math.max(0.001, optimalAmount));
  } catch (error) {
    logger.error('Failed to calculate trade size', error);
    return 0.001; // Fallback to minimum amount
  }
}

/**
 * Execute a token swap using Jupiter Aggregator
 * @param {Connection} connection - Solana connection object
 * @param {Keypair} wallet - Wallet keypair
 * @param {string} tokenAddress - Target token address
 * @param {number} amountSol - Amount of SOL to swap
 * @returns {Promise<Object>} Transaction result
 */
async function executeSwap(connection, wallet, tokenAddress, amountSol) {
  try {
    logger.trade(`Preparing swap: ${amountSol} SOL → ${tokenAddress}`);
    
    if (DRY_RUN) {
      logger.trade(chalk.yellow('DRY RUN: Skipping actual transaction'));
      return { success: true, txId: 'dry-run-tx-id', dryRun: true };
    }
    
    // SOL is the input token (wrapped SOL address)
    const inputMint = 'So11111111111111111111111111111111111111112';
    const outputMint = tokenAddress;
    
    // Convert SOL amount to lamports (1 SOL = 1,000,000,000 lamports)
    const amountLamports = Math.floor(amountSol * 1_000_000_000);
    
    // 1. Get routes from Jupiter API
    logger.debug('Fetching swap routes from Jupiter');
    const routesUrl = `${config.jupiterApiBase}/routes?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountLamports}&slippage=${config.slippage}`;
    const routesResponse = await axios.get(routesUrl, { timeout: 10000 });
    
    if (!routesResponse.data.data || routesResponse.data.data.length === 0) {
      throw new Error('No routes found for swap');
    }
    
    // Select the best route by outAmount
    const routes = routesResponse.data.data;
    const bestRoute = routes.reduce((best, current) => {
      return (best.outAmount > current.outAmount) ? best : current;
    }, routes[0]);
    
    logger.debug(`Selected best route with outAmount: ${bestRoute.outAmount}`);
    
    // 2. Get transaction data from Jupiter
    logger.debug('Getting transaction data from Jupiter');
    const transactionUrl = `${config.jupiterApiBase}/swap`;
    const transactionResponse = await axios.post(transactionUrl, {
      route: bestRoute,
      userPublicKey: wallet.publicKey.toString()
    }, { timeout: 10000 });
    
    const { swapTransaction } = transactionResponse.data;
    
    // 3. Deserialize and sign the transaction
    logger.debug('Deserializing and signing transaction');
    const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
    const transaction = Transaction.from(swapTransactionBuf);
    transaction.partialSign(wallet);
    
    // 4. Execute the transaction
    logger.debug('Sending transaction to network');
    const txid = await connection.sendRawTransaction(
      transaction.serialize(),
      { skipPreflight: false, preflightCommitment: 'confirmed' }
    );
    
    logger.debug(`Transaction sent with ID: ${txid}`);
    
    // 5. Wait for confirmation
    logger.debug('Waiting for transaction confirmation');
    const confirmation = await connection.confirmTransaction(txid, 'confirmed');
    
    logger.trade(chalk.green(`✓ Swap completed successfully! Transaction ID: ${txid}`));
    
    return {
      success: true,
      txId: txid,
      inputAmount: amountSol,
      outputMint: outputMint,
      timestamp: Date.now()
    };
  } catch (error) {
    logger.error(`Swap failed for token ${tokenAddress}`, error);
    return {
      success: false,
      error: error.message,
      timestamp: Date.now()
    };
  }
}

/**
 * Log trade results to persistent storage
 * @param {Object} tradeResult - Result from executeSwap
 * @param {Object} tokenAnalysis - Token analysis data
 */
function logTradeResult(tradeResult, tokenAnalysis) {
  try {
    // Create the logs directory if it doesn't exist
    const logDir = path.dirname(config.tradeLogPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    // Load existing log file or create empty array
    let tradeLogs = [];
    if (fs.existsSync(config.tradeLogPath)) {
      const fileData = fs.readFileSync(config.tradeLogPath, 'utf8');
      tradeLogs = JSON.parse(fileData);
    }
    
    // Add new trade log
    tradeLogs.push({
      timestamp: new Date().toISOString(),
      token: {
        address: tokenAnalysis.address,
        symbol: tokenAnalysis.symbol,
        name: tokenAnalysis.name,
        price: tokenAnalysis.price
      },
      analysis: {
        riskScore: tokenAnalysis.riskScore,
        potentialScore: tokenAnalysis.potentialScore,
        liquidity: tokenAnalysis.liquidity,
        volume24h: tokenAnalysis.volume24h
      },
      trade: {
        ...tradeResult,
        dryRun: DRY_RUN
      }
    });
    
    // Write updated logs back to file
    fs.writeFileSync(config.tradeLogPath, JSON.stringify(tradeLogs, null, 2), 'utf8');
    logger.debug('Trade result logged successfully');
  } catch (error) {
    logger.error('Failed to log trade result', error);
  }
}

/**
 * Main bot execution function
 */
async function runBot() {
  logger.info(chalk.bold(`🚀 Starting Memecoin Sniping Bot - ${ENV.toUpperCase()} mode`));
  logger.info(`Debug: ${DEBUG ? 'ON' : 'OFF'}, Dry Run: ${DRY_RUN ? 'ON' : 'OFF'}`);
  
  try {
    // Initialize connection and wallet
    const connection = initializeConnection();
    const wallet = initializeWallet();
    
    logger.debug(`Wallet initialized: ${wallet.publicKey.toString()}`);
    
    // Get account balance
    const balance = await connection.getBalance(wallet.publicKey);
    logger.info(`Wallet balance: ${balance / 1_000_000_000} SOL`);
    
    // Fetch token registry for metadata
    const tokenRegistry = await fetchTokenRegistry();
    
    // Main loop
    logger.info('Starting token scanning...');
    
    // Fetch new token listings
    const newTokens = await fetchNewTokens();
    
    if (newTokens.length === 0) {
      logger.warn('No new tokens found matching criteria');
      return;
    }
    
    // Analyze tokens and find opportunities
    logger.info(`Analyzing ${newTokens.length} potential tokens`);
    
    for (const token of newTokens) {
      // Deep analysis of token
      const analysis = analyzeToken(token, tokenRegistry);
      logger.debug(`Analysis for \${analysis.symbol}:`, analysis);
      
      // If token is tradeable according to our criteria
      if (analysis.tradeable) {
        logger.trade(`Found tradeable token: ${analysis.symbol} (${analysis.address})`);
        logger.trade(`Risk score: ${analysis.riskScore}, Potential score: ${analysis.potentialScore}`);
        
        // Calculate optimal trade size
        const tradeAmount = calculateTradeSize(analysis);
        logger.trade(`Calculated trade amount: ${tradeAmount} SOL`);
        
        // Execute the swap
        const tradeResult = await executeSwap(connection, wallet, analysis.address, tradeAmount);
        
        // Log the result
        logTradeResult(tradeResult, analysis);
        
        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    logger.success('Bot execution completed successfully');
  } catch (error) {
    logger.error('Bot execution failed', error);
  }
}

// Export functions for external use
module.exports = {
  runBot,
  fetchNewTokens,
  analyzeToken,
  executeSwap,
  initializeConnection,
  initializeWallet,
  logger
};

// Allow running directly or via import
if (require.main === module) {
  runBot().catch(error => {
    logger.error('Fatal error in bot execution', error);
    process.exit(1);
  });
}