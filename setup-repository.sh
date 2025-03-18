#!/bin/bash
# Repository setup script for KryptoBot
# This script organizes files into the proper structure and initializes git

set -e  # Exit on error

echo "🚀 Setting up KryptoBot repository..."

# Check if the repository directory already exists
if [ -d "KryptoBot" ]; then
  echo "⚠️ KryptoBot directory already exists! Do you want to overwrite it? (y/n)"
  read answer
  if [ "$answer" != "y" ]; then
    echo "Aborting setup."
    exit 1
  fi
  echo "📂 Removing existing KryptoBot directory..."
  rm -rf KryptoBot
fi

# Create project directories
echo "📁 Creating directory structure..."
mkdir -p KryptoBot/src
mkdir -p KryptoBot/utils
mkdir -p KryptoBot/logs

# Create .env.sample file
echo "📝 Creating .env.sample file..."
cat > KryptoBot/.env.sample << EOF
# API Keys
ETHERSCAN_API_KEY=YOUR_ETHERSCAN_API_KEY
ALCHEMY_API_KEY=YOUR_ALCHEMY_API_KEY

# API URLs
DEXSCREENER_API_URL=https://api.dexscreener.com/latest/dex/pairs
JUPITER_API_BASE=https://api.jup.ag/swap/v1

# Network RPC Endpoints
SOLANA_RPC_URL_LOCAL=https://api.devnet.solana.com
SOLANA_RPC_URL_PROD=https://api.mainnet-beta.solana.com
PRIVATE_RPC=https://api.devnet.solana.com

# Wallet Configuration
SOLANA_PRIVATE_KEY_LOCAL=YOUR_SOLANA_PRIVATE_KEY_LOCAL
SOLANA_PRIVATE_KEY_PROD=YOUR_SOLANA_PRIVATE_KEY_PROD

# Trading Parameters
TRADE_AMOUNT=0.1
SLIPPAGE=2
SWAP_AMOUNT=0.01
MAX_SOL_PER_TRADE=0.01
RISK_PERCENTAGE=0.3

# Environment Control
ENV=local
# ENV=prod

# Local Environment Criteria
LOCAL_MIN_LIQUIDITY_USD=500
LOCAL_MIN_VOLUME_24H=10
LOCAL_MIN_PRICE_CHANGE_24H=10
LOCAL_MIN_TOKEN_AGE_DAYS=0
LOCAL_MAX_TOKEN_AGE_DAYS=5

# Production Environment Criteria
PROD_MIN_LIQUIDITY_USD=10
PROD_MIN_VOLUME_24H=0
PROD_MIN_PRICE_CHANGE_24H=0
PROD_MIN_TOKEN_AGE_DAYS=1

# Logging Configuration
TRADE_LOG_PATH=./logs/trade_logs.json
DEBUG=true
DRY_RUN=true
VERBOSE=false
BACKUP_ENABLED=true

# Token Security
BLACKLISTED_TOKENS=
EOF

# Create the bot core file
echo "🤖 Creating bot core file..."
cat > KryptoBot/src/bot-core.js << EOF
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
    maxTokenAgeDays: parseFloat(ENV === 'prod' ? process.env.LOCAL_MAX_TOKEN_AGE_DAYS || '365')
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
  logger.debug(\`Initializing Solana connection to: \${config.rpcUrl}\`);
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
    
    logger.debug(\`Fetched \${Object.keys(tokenMap).length} tokens from registry\`);
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
    const response = await axios.get(\`\${config.dexscreenerApiUrl}/pairs/solana\`, {
      timeout: 10000,
      headers: { 'Accept': 'application/json' }
    });
    
    const pairs = response.data.pairs || [];
    logger.debug(\`Fetched \${pairs.length} total pairs\`);
    
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
    
    logger.debug(\`Found \${filteredPairs.length} pairs matching criteria\`);
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
    logger.debug(\`Analyzing token: \${token.baseToken.symbol}\`);
    
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
    logger.error(\`Failed to analyze token \${token.baseToken?.symbol}\`, error);
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
    logger.trade(\`Preparing swap: \${amountSol} SOL → \${tokenAddress}\`);
    
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
    const routesUrl = \`\${config.jupiterApiBase}/routes?inputMint=\${inputMint}&outputMint=\${outputMint}&amount=\${amountLamports}&slippage=\${config.slippage}\`;
    const routesResponse = await axios.get(routesUrl, { timeout: 10000 });
    
    if (!routesResponse.data.data || routesResponse.data.data.length === 0) {
      throw new Error('No routes found for swap');
    }
    
    // Select the best route by outAmount
    const routes = routesResponse.data.data;
    const bestRoute = routes.reduce((best, current) => {
      return (best.outAmount > current.outAmount) ? best : current;
    }, routes[0]);
    
    logger.debug(\`Selected best route with outAmount: \${bestRoute.outAmount}\`);
    
    // 2. Get transaction data from Jupiter
    logger.debug('Getting transaction data from Jupiter');
    const transactionUrl = \`\${config.jupiterApiBase}/swap\`;
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
    
    logger.debug(\`Transaction sent with ID: \${txid}\`);
    
    // 5. Wait for confirmation
    logger.debug('Waiting for transaction confirmation');
    const confirmation = await connection.confirmTransaction(txid, 'confirmed');
    
    logger.trade(chalk.green(\`✓ Swap completed successfully! Transaction ID: \${txid}\`));
    
    return {
      success: true,
      txId: txid,
      inputAmount: amountSol,
      outputMint: outputMint,
      timestamp: Date.now()
    };
  } catch (error) {
    logger.error(\`Swap failed for token \${tokenAddress}\`, error);
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
  logger.info(chalk.bold(\`🚀 Starting Memecoin Sniping Bot - \${ENV.toUpperCase()} mode\`));
  logger.info(\`Debug: \${DEBUG ? 'ON' : 'OFF'}, Dry Run: \${DRY_RUN ? 'ON' : 'OFF'}\`);
  
  try {
    // Initialize connection and wallet
    const connection = initializeConnection();
    const wallet = initializeWallet();
    
    logger.debug(\`Wallet initialized: \${wallet.publicKey.toString()}\`);
    
    // Get account balance
    const balance = await connection.getBalance(wallet.publicKey);
    logger.info(\`Wallet balance: \${balance / 1_000_000_000} SOL\`);
    
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
    logger.info(\`Analyzing \${newTokens.length} potential tokens\`);
    
    for (const token of newTokens) {
      // Deep analysis of token
      const analysis = analyzeToken(token, tokenRegistry);
      logger.debug(\`Analysis for \${analysis.symbol}:\`, analysis);
      
      // If token is tradeable according to our criteria
      if (analysis.tradeable) {
        logger.trade(\`Found tradeable token: \${analysis.symbol} (\${analysis.address})\`);
        logger.trade(\`Risk score: \${analysis.riskScore}, Potential score: \${analysis.potentialScore}\`);
        
        // Calculate optimal trade size
        const tradeAmount = calculateTradeSize(analysis);
        logger.trade(\`Calculated trade amount: \${tradeAmount} SOL\`);
        
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
EOF

# Create the token log cleaner utility
echo "🧹 Creating token log cleaner utility..."
cat > KryptoBot/utils/token-log-cleaner.js << EOF
#!/usr/bin/env node
/**
 * Token Log Cleaner Utility
 * 
 * A utility script to clean and manage trade log files.
 * Features include log rotation, compression, backups, and analytics.
 * 
 * @author Advanced Coding AI
 * @version 1.0.0
 */

// Import required dependencies
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const chalk = require('chalk');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Configuration
const TRADE_LOG_PATH = process.env.TRADE_LOG_PATH || './logs/trade_logs.json';
const BACKUP_ENABLED = process.env.BACKUP_ENABLED !== 'false';
const VERBOSE = process.env.VERBOSE === 'true';
const DEBUG = process.env.DEBUG === 'true';

/**
 * Logger utility for consistent output
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
   * Log a verbose message (only when VERBOSE is true)
   * @param {string} message - Message to log
   */
  verbose: (message) => {
    if (VERBOSE) {
      console.log(chalk.cyan('🔊 VERBOSE: ') + message);
    }
  }
};

/**
 * Creates a backup of the trade log file
 * @param {string} logPath - Path to the log file
 * @returns {Promise<boolean>} True if backup was successful
 */
async function createBackup(logPath) {
  try {
    // Check if backup is disabled
    if (!BACKUP_ENABLED) {
      logger.verbose('Backup creation skipped (disabled in configuration)');
      return true;
    }
    
    // Check if original file exists
    if (!fs.existsSync(logPath)) {
      logger.warn(\`Cannot create backup: File \${logPath} does not exist\`);
      return false;
    }
    
    // Create backup directory
    const backupDir = path.join(path.dirname(logPath), 'backups');
    if (!fs.existsSync(backupDir)) {
      logger.verbose(\`Creating backup directory: \${backupDir}\`);
      fs.mkdirSync(backupDir, { recursive: true });
    }
    
    // Generate timestamp for the backup filename
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
    const backupPath = path.join(backupDir, \`\${path.basename(logPath, '.json')}_\${timestamp}.json.gz\`);
    
    // Read the original file
    logger.debug(\`Reading original log file: \${logPath}\`);
    const fileContent = fs.readFileSync(logPath);
    
    // Compress the file content
    logger.debug('Compressing log file content');
    const compressed = zlib.gzipSync(fileContent);
    
    // Write the compressed backup
    logger.debug(\`Writing compressed backup to: \${backupPath}\`);
    fs.writeFileSync(backupPath, compressed);
    
    logger.success(\`Backup created successfully: \${backupPath}\`);
    return true;
  } catch (error) {
    logger.error('Failed to create backup', error);
    return false;
  }
}

/**
 * Cleans the trade log file by removing old entries
 * @param {string} logPath - Path to the log file
 * @param {number} [maxAgeDays=30] - Maximum age of entries to keep in days
 * @returns {Promise<boolean>} True if cleaning was successful
 */
async function cleanLogs(logPath, maxAgeDays = 30) {
  try {
    // Check if log file exists
    if (!fs.existsSync(logPath)) {
      logger.warn(\`Log file \${logPath} does not exist, nothing to clean\`);
      return false;
    }
    
    // Create backup before cleaning
    await createBackup(logPath);
    
    // Read and parse the log file
    logger.debug(\`Reading log file: \${logPath}\`);
    const fileContent = fs.readFileSync(logPath, 'utf8');
    const logs = JSON.parse(fileContent);
    
    logger.verbose(\`Found \${logs.length} total log entries\`);
    
    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);
    logger.debug(\`Cutoff date for log cleaning: \${cutoffDate.toISOString()}\`);
    
    // Filter logs to keep only recent entries
    const filteredLogs = logs.filter(log => {
      const logDate = new Date(log.timestamp);
      return logDate >= cutoffDate;
    });
    
    logger.verbose(\`Keeping \${filteredLogs.length} entries (removing \${logs.length - filteredLogs.length})\`);
    
    // Write filtered logs back to file
    logger.debug(\`Writing cleaned logs back to: \${logPath}\`);
    fs.writeFileSync(logPath, JSON.stringify(filteredLogs, null, 2), 'utf8');
    
    logger.success(\`Log file cleaned successfully (removed \${logs.length - filteredLogs.length} old entries)\`);
    return true;
  } catch (error) {
    logger.error('Failed to clean logs', error);
    return false;
  }
}

/**
 * Generate analytics from log data
 * @param {string} logPath - Path to the log file
 * @returns {Promise<Object>} Analytics data
 */
async function generateAnalytics(logPath) {
  try {
    // Check if log file exists
    if (!fs.existsSync(logPath)) {
      logger.warn(\`Log file \${logPath} does not exist, cannot generate analytics\`);
      return {};
    }
    
    // Read and parse the log file
    logger.debug(\`Reading log file for analytics: \${logPath}\`);
    const fileContent = fs.readFileSync(logPath, 'utf8');
    const logs = JSON.parse(fileContent);
    
    if (logs.length === 0) {
      logger.warn('No log entries found for analytics');
      return {};
    }
    
    // Initialize analytics object
    const analytics = {
      totalTrades: logs.length,
      successfulTrades: 0,
      failedTrades: 0,
      dryRunTrades: 0,
      totalInvested: 0,
      tokensByRiskScore: {},
      tokensByPotentialScore: {},
      tradesByDate: {},
      topTokens: []
    };
    
    // Process each log entry
    logs.forEach(log => {
      // Count trade types
      if (log.trade.dryRun) {
        analytics.dryRunTrades++;
      } else if (log.trade.success) {
        analytics.successfulTrades++;
      } else {
        analytics.failedTrades++;
      }
      
      // Sum up total investment
      if (log.trade.inputAmount) {
        analytics.totalInvested += parseFloat(log.trade.inputAmount);
      }
      
      // Group by risk score
      const riskScoreKey = Math.floor(log.analysis.riskScore / 10) * 10;
      analytics.tokensByRiskScore[riskScoreKey] = (analytics.tokensByRiskScore[riskScoreKey] || 0) + 1;
      
      // Group by potential score
      const potentialScoreKey = Math.floor(log.analysis.potentialScore / 10) * 10;
      analytics.tokensByPotentialScore[potentialScoreKey] = (analytics.tokensByPotentialScore[potentialScoreKey] || 0) + 1;
      
      // Group by date
      const dateKey = log.timestamp.split('T')[0];
      analytics.tradesByDate[dateKey] = (analytics.tradesByDate[dateKey] || 0) + 1;
    });
    
    // Get top tokens by trade volume
    const tokenMap = {};
    logs.forEach(log => {
      const symbol = log.token.symbol;
      if (!tokenMap[symbol]) {
        tokenMap[symbol] = {
          symbol,
          address: log.token.address,
          trades: 0,
          invested: 0
        };
      }
      
      tokenMap[symbol].trades++;
      if (log.trade.inputAmount) {
        tokenMap[symbol].invested += parseFloat(log.trade.inputAmount);
      }
    });
    
    // Convert to array and sort by trades
    analytics.topTokens = Object.values(tokenMap)
      .sort((a, b) => b.trades - a.trades)
      .slice(0, 10);
    
    logger.success('Analytics generated successfully');
    return analytics;
  } catch (error) {
    logger.error('Failed to generate analytics', error);
    return {};
  }
}

/**
 * Main function to execute the log cleaning and analytics
 */
async function main() {
  logger.info(chalk.bold('📋 Starting Token Log Cleaner Utility'));
  logger.info(\`Log path: \${TRADE_LOG_PATH}\`);
  logger.info(\`Backup enabled: \${BACKUP_ENABLED ? 'Yes' : 'No'}\`);
  
  try {
    // Clean old log entries
    await cleanLogs(TRADE_LOG_PATH);
    
    // Generate and display analytics
    const analytics = await generateAnalytics(TRADE_LOG_PATH);
    
    if (Object.keys(analytics).length > 0) {
      logger.info('📊 Trade Analytics Summary:');
      logger.info(\`Total trades: \${analytics.totalTrades}\`);
      logger.info(\`Successful trades: \${analytics.successfulTrades}\`);
      logger.info(\`Failed trades: \${analytics.failedTrades}\`);
      logger.info(\`Dry run trades: \${analytics.dryRunTrades}\`);
      logger.info(\`Total invested: \${analytics.totalInvested.toFixed(4)} SOL\`);
      
      if (VERBOSE) {
        logger.verbose('Top 5 traded tokens:');
        analytics.topTokens.slice(0, 5).forEach((token, index) => {
          logger.verbose(\`\${index + 1}. \${token.symbol}: \${token.trades} trades, \${token.invested.toFixed(4)} SOL invested\`);
        });
      }
    }
    
    logger.success('Log cleaning and analytics completed successfully');
  } catch (error) {
    logger.error('An error occurred during execution', error);
    process.exit(1);
  }
}

// Execute if run directly
if (require.main === module) {
  main().catch(error => {
    logger.error('Fatal error in execution', error);
    process.exit(1);
  });
}

// Export functions for external use
module.exports = {
  cleanLogs,
  createBackup,
  generateAnalytics
};
EOF

# Create the package.json file
echo "📦 Creating package.json..."
cat > KryptoBot/package.json << EOF
{
  "name": "memecoin-sniping-bot",
  "version": "1.0.0",
  "description": "Advanced memecoin sniping bot for automated trading on Solana blockchain",
  "main": "src/bot-core.js",
  "scripts": {
    "start": "node src/bot-core.js",
    "clean-logs": "node utils/token-log-cleaner.js",
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "keywords": [
    "blockchain",
    "solana",
    "trading",
    "bot",
    "memecoin",
    "cryptocurrency"
  ],
  "author": "Advanced Coding AI",
  "license": "MIT",
  "dependencies": {
    "@solana/spl-token-registry": "^0.2.4574",
    "@solana/web3.js": "^1.78.5",
    "axios": "^1.5.1",
    "axios-retry": "^3.8.0",
    "chalk": "^4.1.2",
    "dotenv": "^16.3.1",
    "node-fetch": "^2.7.0"
  },
  "engines": {
    "node": ">=16.0.0"
  }
}
EOF

# Create a README file
echo "📄 Creating README.md..."
cat > KryptoBot/README.md << EOF
# KryptoBot - Memecoin Sniping Bot

An advanced, high-performance sniping bot for automated trading of memecoins on the Solana blockchain.

## Features

- 🚀 Automatically detects and analyzes new memecoin listings
- 📊 Advanced risk and potential scoring algorithm
- 💰 Dynamic trade size calculation based on risk assessment
- 🔄 Integrates with Jupiter aggregator for optimal swap routes
- 📝 Comprehensive logging and analytics
- 🔧 Configurable via environment variables
- 🧪 Supports dry-run mode for testing without actual trades

## Requirements

- Node.js 16+
- Solana wallet with private key
- API keys for Etherscan, Alchemy (as applicable)

## Installation

Clone the repository:

\`\`\`bash
git clone https://github.com/omkom/KryptoBot.git
cd KryptoBot
\`\`\`

Install dependencies:

\`\`\`bash
npm install
\`\`\`

Create and configure your \`.env\` file based on the provided \`.env.sample\`:

\`\`\`bash
cp .env.sample .env
# Edit .env with your configuration
\`\`\`

## Configuration

The bot is highly configurable through environment variables in the \`.env\` file:

\`\`\`
# API Keys
ETHERSCAN_API_KEY=your_etherscan_key
ALCHEMY_API_KEY=your_alchemy_key

# Network Configuration
SOLANA_RPC_URL_PROD=https://api.mainnet-beta.solana.com
SOLANA_PRIVATE_KEY_PROD=your_private_key_in_base64

# Trading Parameters
MAX_SOL_PER_TRADE=0.01
RISK_PERCENTAGE=0.3
SLIPPAGE=2

# See .env.sample for complete configuration options
\`\`\`

## Usage

### Start the bot

\`\`\`bash
npm start
\`\`\`

### Run in development mode

\`\`\`bash
DEBUG=true DRY_RUN=true npm start
\`\`\`

### Clean log files

\`\`\`bash
npm run clean-logs
\`\`\`

## Project Structure

\`\`\`
KryptoBot/
├── src/                    # Source code
│   └── bot-core.js         # Main bot logic
├── utils/                  # Utility scripts
│   └── token-log-cleaner.js # Log management utility
├── logs/                   # Trade logs
├── .env                    # Environment configuration
├── .env.sample             # Sample configuration
├── package.json            # Project metadata
└── README.md               # Documentation
\`\`\`

## How It Works

1. **Token Discovery**: The bot scans for new token listings on DEXScreener that match configured criteria.

2. **Risk Analysis**: Each token undergoes comprehensive analysis to determine risk and potential scores based on:
   - Liquidity
   - Volume
   - Price momentum
   - Token age
   - Verification status

3. **Trade Sizing**: The bot calculates optimal trade sizes based on risk assessment and configured parameters.

4. **Execution**: For qualifying tokens, the bot executes trades through the Jupiter Aggregator API.

5. **Logging and Analytics**: All trades are logged with detailed analytics for performance tracking.

## License

MIT

## Disclaimer

Trading cryptocurrencies involves significant risk. This bot is provided for educational purposes only. Use at your own risk.

\`\`\`
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
\`\`\`

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
EOF

# Create .gitignore file
echo "🙈 Creating .gitignore..."
cat > KryptoBot/.gitignore << EOF
# Environment variables
.env

# Logs
logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
lerna-debug.log*

# Dependency directories
node_modules/
jspm_packages/

# Optional npm cache directory
.npm

# Optional eslint cache
.eslintcache

# Output of 'npm pack'
*.tgz

# Yarn Integrity file
.yarn-integrity

# Coverage directory
coverage/

# Build directories
dist/
build/
out/

# IDE configuration
.idea/
.vscode/
*.sw?
.DS_Store
EOF

# Initialize Git repository
echo "🔧 Initializing Git repository..."
cd KryptoBot
git init

# Make token-log-cleaner.js executable
chmod +x utils/token-log-cleaner.js

# Set up Git remote (will need user interaction for authentication)
echo "🌐 Setting up Git remote..."
git remote add origin https://github.com/omkom/KrypotoBot.git

# Add files to Git
echo "📝 Staging files for commit..."
git add .

# Create first commit
echo "💾 Creating initial commit..."
git commit -m "Initial commit: Memecoin Sniping Bot"

echo ""
echo "✅ Repository setup completed successfully!"
echo ""
echo "Next steps:"
echo "1. Push to GitHub:"
echo "   git push -u origin main"
echo ""
echo "2. Install dependencies:"
echo "   npm install"
echo ""
echo "3. Configure your .env file:"
echo "   cp .env.sample .env"
echo "   nano .env  # Edit with your settings"
echo ""
echo "4. Start the bot:"
echo "   npm start"
echo ""