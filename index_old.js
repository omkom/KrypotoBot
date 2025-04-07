/**
 * KryptoBot - Advanced Solana Memecoin Sniping Bot
 * 
 * High-performance trading bot for automated detection and trading of promising
 * memecoin tokens on Solana blockchain with advanced risk management and profit
 * optimization strategies.
 * 
 * @author Advanced Coding AI
 * @version 2.0.0
 */

import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  NATIVE_MINT
} from '@solana/spl-token';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import chalk from 'chalk';
import bs58 from 'bs58';
import url from 'url';

// Global configuration and cache
let CONFIG = {};
const apiCache = {
  pairs: new Map(),
  pools: new Map(),
  prices: new Map(),
};

// File paths
const WRAPPED_SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
let WALLET_BALANCE = 0;

/**
 * Generates a unique ID for tracking purposes
 * @returns {string} Unique identifier (timestamp + random)
 */
function generateUniqueId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

/**
 * Creates a custom axios instance with logging and retry logic
 * @returns {Object} Configured axios instance
 */
function createLoggingAxiosInstance() {
  // Create custom axios instance with timeout from config
  const instance = axios.create({
    timeout: CONFIG.API_TIMEOUT || 10000,
  });
  
  // Request interceptor to log outgoing API calls
  instance.interceptors.request.use(
    (config) => {
      // Parse URL for logging
      const parsedUrl = url.parse(config.url);
      const requestId = generateUniqueId();
      
      // Create log entry
      const logEntry = {
        id: requestId,
        timestamp: new Date().toISOString(),
        method: config.method?.toUpperCase() || 'GET',
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname,
        query: parsedUrl.query,
        startTime: Date.now(),
        status: 'PENDING',
      };
      
      // Attach requestId to the config for response matching
      config.requestId = requestId;
      
      // Log to file if API logging file is defined
      if (CONFIG.API_LOG_FILE) {
        try {
          fs.appendFileSync(CONFIG.API_LOG_FILE, JSON.stringify(logEntry) + '\n');
        } catch (err) {
          console.error(chalk.red(`Error logging API request: ${err.message}`));
        }
      }
      
      // Console logging only in debug mode
      if (CONFIG.DEBUG_MODE) {
        console.log(chalk.cyan(`[API] → ${logEntry.method} ${logEntry.hostname}${logEntry.path}`));
      }
      
      return config;
    },
    (error) => {
      // Log request errors
      console.error(chalk.red(`API request error: ${error.message}`));
      return Promise.reject(error);
    }
  );
  
  // Response interceptor for logging responses
  instance.interceptors.response.use(
    (response) => {
      // Calculate response time
      const endTime = Date.now();
      const requestId = response.config.requestId;
      const duration = endTime - (response.config.startTime || endTime);
      
      // Log in debug mode
      if (CONFIG.DEBUG_MODE) {
        const parsedUrl = url.parse(response.config.url);
        console.log(
          chalk.green(
            `[API] ← ${response.status} ${response.config.method?.toUpperCase() || 'GET'} ` +
            `${parsedUrl.hostname}${parsedUrl.pathname} (${duration}ms)`
          )
        );
      }
      
      // Update log file if defined
      if (CONFIG.API_LOG_FILE && requestId) {
        try {
          const logUpdate = {
            id: requestId,
            status: response.status,
            statusText: response.statusText,
            endTime: endTime,
            duration: duration,
            responseSize: JSON.stringify(response.data).length,
          };
          
          // Read and update the specific log entry
          updateApiLogEntry(logUpdate);
        } catch (err) {
          console.error(chalk.red(`Error updating API log: ${err.message}`));
        }
      }
      
      return response;
    },
    (error) => {
      // Handle and log response errors
      const endTime = Date.now();
      const requestId = error.config?.requestId;
      const duration = endTime - (error.config?.startTime || endTime);
      
      // Log to file if config exists
      if (CONFIG.API_LOG_FILE && requestId) {
        try {
          const logUpdate = {
            id: requestId,
            status: error.response?.status || 0,
            statusText: error.response?.statusText || 'ERROR',
            error: error.message,
            endTime: endTime,
            duration: duration,
          };
          
          updateApiLogEntry(logUpdate);
        } catch (err) {
          console.error(chalk.red(`Error updating API error log: ${err.message}`));
        }
      }
      
      // Console log in debug mode
      if (CONFIG.DEBUG_MODE) {
        const parsedUrl = url.parse(error.config?.url || '');
        console.log(
          chalk.red(
            `[API] ✗ ${error.response?.status || 'ERROR'} ${error.config?.method?.toUpperCase() || 'GET'} ` +
            `${parsedUrl.hostname || ''}${parsedUrl.pathname || ''} - ${error.message}`
          )
        );
      }
      
      return Promise.reject(error);
    }
  );
  
  return instance;
}

/**
 * Updates a specific API log entry in the log file
 * @param {Object} logUpdate The updated log information
 */
function updateApiLogEntry(logUpdate) {
  if (!CONFIG.API_LOG_FILE) return;
  
  try {
    // Read the log file
    const content = fs.readFileSync(CONFIG.API_LOG_FILE, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    
    // Find and update the matching log entry
    let updated = false;
    const updatedLines = lines.map(line => {
      try {
        const entry = JSON.parse(line);
        if (entry.id === logUpdate.id) {
          updated = true;
          return JSON.stringify({ ...entry, ...logUpdate });
        }
        return line;
      } catch (e) {
        return line; // Keep invalid lines unchanged
      }
    });
    
    // Write back if updated, otherwise append as new entry
    if (updated) {
      fs.writeFileSync(CONFIG.API_LOG_FILE, updatedLines.join('\n') + '\n');
    } else {
      // Add error note for orphaned response
      const errorLog = {
        ...logUpdate,
        error: logUpdate.error || 'ORPHANED_RESPONSE',
        timestamp: new Date().toISOString(),
      };
      fs.appendFileSync(CONFIG.API_LOG_FILE, JSON.stringify(errorLog) + '\n');
    }
  } catch (error) {
    console.error(chalk.red(`Error updating API log: ${error.message}`));
  }
}

/**
 * Creates or clears the API log file
 */
function initializeApiLogFile() {
  if (!CONFIG.API_LOG_FILE) return;
  
  try {
    // Create logs directory if needed
    const logDir = path.dirname(CONFIG.API_LOG_FILE);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    // In debug mode, clear the log file
    if (CONFIG.DEBUG_MODE) {
      fs.writeFileSync(CONFIG.API_LOG_FILE, '');
      console.log(chalk.yellow(`Debug mode: API log file cleared: ${CONFIG.API_LOG_FILE}`));
    } else if (!fs.existsSync(CONFIG.API_LOG_FILE)) {
      // Create empty file if it doesn't exist
      fs.writeFileSync(CONFIG.API_LOG_FILE, '');
      console.log(chalk.green(`API log file created: ${CONFIG.API_LOG_FILE}`));
    }
  } catch (error) {
    console.error(chalk.red(`Failed to initialize API log file: ${error.message}`));
  }
}

/**
 * Cleans all log files in debug mode
 */
function cleanAllLogsInDebugMode() {
  if (!CONFIG.DEBUG_MODE) return;
  
  try {
    console.log(chalk.yellow('Debug mode: Cleaning all log files...'));
    
    // Get logs directory
    const logDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
      return; // No logs to clean if directory didn't exist
    }
    
    // Read all files in the logs directory
    const files = fs.readdirSync(logDir);
    let cleanedCount = 0;
    
    // Clean each log file
    files.forEach(file => {
      // Only clean log files and JSON files (for stats)
      if (file.endsWith('.log') || file.endsWith('.json') || file.endsWith('.txt')) {
        const filePath = path.join(logDir, file);
        
        // Different handling for JSON files vs log files
        if (file.endsWith('.json')) {
          fs.writeFileSync(filePath, '{}');
        } else {
          fs.writeFileSync(filePath, '');
        }
        
        cleanedCount++;
      }
    });
    
    console.log(chalk.yellow(`Debug mode: Cleaned ${cleanedCount} log files`));
  } catch (error) {
    console.error(chalk.red(`Error cleaning logs: ${error.message}`));
  }
}

/**
 * Loads bot configuration from environment variables
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
    SOLANA_RPC: process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com',
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
    STOP_LOSS: Number(process.env.STOP_LOSS || '-50'),
    
    // Performance parameters
    MAX_RETRIES: Number(process.env.MAX_RETRIES || '3'),
    API_TIMEOUT: Number(process.env.API_TIMEOUT || '10000'),
    PRIORITY_FEE: Number(process.env.PRIORITY_FEE || '1000000'),
    
    // Environment settings
    DRY_RUN: process.env.DRY_RUN === 'true',
    ENV: process.env.ENV || 'prod',
    DEBUG_MODE: process.env.DEBUG_MODE === 'true',
    
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
 * Initializes the wallet and Solana connection
 * @returns {Promise<Object>} Wallet keypair and connection
 */
async function initializeWallet() {
  console.log(chalk.blue('Initializing wallet...'));

  let privateKey;
  let rpcUrl;
  let WALLET;

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

  // Initialize Solana connection
  const connection = new Connection(rpcUrl, {
    commitment: 'confirmed',
    disableRetryOnRateLimit: false,
    confirmTransactionInitialTimeout: 60000
  });

  return { WALLET, connection, rpcUrl };
}

/**
 * Reads token logs from JSON file with error handling
 * @param {string} logFilePath Path to the log file
 * @returns {Object} Object with tokens indexed by address
 */
function readTokenLogs(logFilePath) {
  try {
    // Check if file exists
    if (!fs.existsSync(logFilePath)) {
      console.log(`Creating new log file: ${logFilePath}`);
      
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
    console.error(`Error reading JSON file (${logFilePath}):`, error);
    
    // Create backup of corrupted file
    if (fs.existsSync(logFilePath)) {
      const backupPath = `${logFilePath}.backup.${Date.now()}`;
      try {
        fs.copyFileSync(logFilePath, backupPath);
        console.log(`Corrupted log file. Backup created: ${backupPath}`);
      } catch (backupError) {
        console.error(`Unable to create backup:`, backupError);
      }
    }
    
    // Return empty structure
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
 * Writes token logs to JSON file
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
    
    // Write to file
    fs.writeFileSync(logFilePath, JSON.stringify(tokenData, null, 2));
  } catch (error) {
    console.error('Error writing JSON file:', error);
    
    // Try writing to alternative location if main write fails
    try {
      const altPath = './trade_logs_backup.json';
      fs.writeFileSync(altPath, JSON.stringify(tokenData, null, 2));
      console.log(`Logs written to alternative location: ${altPath}`);
    } catch (altError) {
      console.error('Failed to write logs to alternative location:', altError);
    }
  }
}

/**
 * Records a token purchase in the log
 * @param {string} tokenAddress Token address
 * @param {string} tokenName Token name/symbol
 * @param {number} amount Amount of tokens acquired
 * @param {number} priceSol Price paid in SOL
 * @param {number} tokensBought Tokens bought
 * @param {Object} metadata Additional metadata
 */
function logTokenPurchase(tokenAddress, tokenName, amount, priceSol, tokensBought, metadata = {}) {
  if (!tokenAddress) {
    console.error('Missing parameters for logTokenPurchase');
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
      console.log(chalk.bgRed(`Purchase - Token=${tokenName} (${tokenAddress}) | Amount=${amount} | PriceSol=${priceSol} | PricePerToken=${pricePerToken.toFixed(10)} | SCAM DETECTED`));
    } else {
      console.log(chalk.bgBlue(`Purchase - Token=${tokenName} (${tokenAddress}) | Amount=${amount} | PriceSol=${priceSol} | PricePerToken=${pricePerToken.toFixed(10)}`));
      console.log(chalk.blue(`Price per token: ${pricePerToken.toFixed(10)} SOL | Wallet: ${tokenData.tokens[tokenAddress].currentAmount} tokens`));
    }
  } catch (error) {
    console.error('Error recording purchase:', error);
  }
}

/**
 * Records a token sale with ROI calculation
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
    console.error('Missing parameters for logTokenSale');
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
      console.error(`Token ${tokenAddress} not found in logs`);
      return {
        success: false,
        error: "TOKEN_NOT_FOUND",
        roi: 0
      };
    }
    
    const token = tokenData.tokens[tokenAddress];
    
    // Ensure we have enough tokens to sell
    if (Number(token.currentAmount) < amount) {
      console.warn(`Warning: Trying to sell ${amount} tokens but only ${token.currentAmount} available`);
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
      console.log(chalk.bgGreen(saleMessage));
      console.log(chalk.green(`${dryRunPrefix}Profit: ${roi.toFixed(2)}% (${solReceived} SOL received)`));
    } else if (roi < 0) {
      console.log(chalk.bgRed(saleMessage));
      console.log(chalk.red(`${dryRunPrefix}Loss: ${roi.toFixed(2)}% (${solReceived} SOL received)`));
    } else {
      console.log(chalk.bgYellow(saleMessage));
      console.log(chalk.yellow(`${dryRunPrefix}Neutral ROI: ${roi.toFixed(2)}% (${solReceived} SOL received)`));
    }
    
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
    console.error('Error recording sale:', error);
    return {
      success: false,
      error: error.message,
      roi: 0,
      isDryRun
    };
  }
}

/**
 * Gets information about a token pair on DEXs
 * @param {string} chainId Chain ID (e.g., 'solana')
 * @param {string} tokenAddress Token address to query
 * @param {Object} options Additional options
 * @returns {Promise<Object|null>} Pair information or null if not found
 */
async function getPairInformation(chainId, tokenAddress, options = {}) {
  try {
    // Normalize token address for consistency
    tokenAddress = tokenAddress.toString().trim();
    const cacheKey = `${chainId}-${tokenAddress}`;
    
    // Check cache unless force refresh is requested
    if (!options.force && apiCache.pairs.has(cacheKey)) {
      const cachedData = apiCache.pairs.get(cacheKey);
      if (Date.now() - cachedData.timestamp < 60000) { // 1 minute TTL
        return cachedData.data;
      }
    }
    
    console.log(`Getting information for token ${tokenAddress} on ${chainId}`);
    
    // Prepare API URL
    const url = `${CONFIG.DEXSCREENER_API}/token-pairs/v1/${chainId}/${tokenAddress}`;
    console.log(`API request: ${url}`);
    
    // Make request
    const api = createLoggingAxiosInstance();
    const response = await api.get(url);
    
    // Process response
    if (response.data) {
      const pairs = response.data;
      
      if (Array.isArray(pairs) && pairs.length > 0) {
        console.log(`${pairs.length} pairs found for ${tokenAddress}`);
        
        // Filter valid pairs
        let validPairs = pairs.filter(pair => 
          pair.baseToken && 
          pair.baseToken.address.toLowerCase() === tokenAddress.toLowerCase()
        );
        
        // If no pairs found as base token, try as quote token
        if (validPairs.length === 0) {
          validPairs = pairs.filter(pair => 
            pair.quoteToken && 
            pair.quoteToken.address.toLowerCase() === tokenAddress.toLowerCase()
          );
        }
        
        if (validPairs.length === 0) {
          console.log(chalk.red('No valid pairs found for this token'));
          return null;
        }
        
        // Find best pair (highest liquidity)
        let bestPair = validPairs[0];
        for (const pair of validPairs) {
          if (pair.liquidity && bestPair.liquidity) {
            if ((pair.liquidity.usd || 0) > (bestPair.liquidity.usd || 0)) {
              bestPair = pair;
            }
          }
        }
        
        console.log(chalk.green(`Best pair found: ${bestPair.pairAddress}`));
        console.log(chalk.green(`Liquidity: ${bestPair.liquidity?.usd || 'N/A'} USD`));
        
        // Normalize data structure
        const normalizedPair = {
          ...bestPair,
          liquidity: bestPair.liquidity || { usd: 0, base: 0, quote: 0 },
          volume: bestPair.volume || { h24: 0, h6: 0, h1: 0, m5: 0 },
          priceChange: bestPair.priceChange || { h24: 0, h6: 0, h1: 0, m5: 0 },
          txns: bestPair.txns || { 
            h24: { buys: 0, sells: 0 }, 
            h6: { buys: 0, sells: 0 }, 
            h1: { buys: 0, sells: 0 }, 
            m5: { buys: 0, sells: 0 } 
          },
          isBaseToken: bestPair.baseToken && 
                      bestPair.baseToken.address.toLowerCase() === tokenAddress.toLowerCase()
        };
        
        // Cache results
        apiCache.pairs.set(cacheKey, {
          data: normalizedPair,
          timestamp: Date.now()
        });
        
        // Update price cache
        apiCache.prices.set(tokenAddress, {
          price: parseFloat(normalizedPair.priceNative) || 0,
          priceUsd: parseFloat(normalizedPair.priceUsd) || 0,
          timestamp: Date.now()
        });
        
        return normalizedPair;
      }
    }
    
    console.log('Unexpected DexScreener response format or no pairs found');
    return null;
  } catch (error) {
    console.error(chalk.red(`Error getting information for ${tokenAddress}: ${error.message}`));
    return null;
  }
}

/**
 * Calculates purchase amount based on wallet balance and risk parameters
 * @param {Connection} connection Solana connection
 * @param {Keypair} wallet Wallet keypair
 * @returns {Promise<number>} Amount to spend in SOL
 */
async function calculateAmountToBuy(connection, wallet) {
  console.log(chalk.blue('Calculating purchase amount...'));

  try {
    // Get wallet balance
    WALLET_BALANCE = await connection.getBalance(wallet.publicKey) / LAMPORTS_PER_SOL;
    console.log(chalk.green(`Wallet balance: ${WALLET_BALANCE.toFixed(4)} SOL`));
    
    // Calculate amount based on risk percentage
    const amountToBuy = WALLET_BALANCE * CONFIG.RISK_PERCENTAGE;
    
    // Limit to maximum allowed per transaction
    const maxAmountPerTrade = CONFIG.MAX_SOL_PER_TRADE || 0.01;
    
    // Return the minimum of calculated amount and maximum allowed
    const finalAmount = Math.min(amountToBuy, maxAmountPerTrade);
    console.log(chalk.green(`Calculated purchase amount: ${finalAmount.toFixed(6)} SOL`));
    return finalAmount;
  } catch (error) {
    console.error(chalk.red(`Error calculating purchase amount: ${error.message}`));
    // Return default amount in case of error
    return CONFIG.SWAP_AMOUNT;
  }
}

/**
 * Gets a quote from Jupiter API for token swap
 * @param {Object} params Parameters for the quote request
 * @returns {Promise<Object>} Quote data from Jupiter API
 */
async function getJupiterQuote(params) {
  const { inputMint, outputMint, amount, slippage } = params;
  const jupiterApiUrl = `${CONFIG.JUPITER_API_BASE}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippage=${slippage}`;

  console.log(chalk.blue(`Getting Jupiter quote: ${jupiterApiUrl}`));

  try {
    const api = createLoggingAxiosInstance();
    const response = await api.get(jupiterApiUrl);
    const quoteData = response.data;

    if (quoteData && quoteData.outAmount) {
      console.log(chalk.green(`Quote received with output amount: ${quoteData.outAmount}`));
      return quoteData;
    } else {
      throw new Error('Invalid quote response: missing output amount');
    }
  } catch (error) {
    console.error(chalk.red(`Jupiter quote error: ${error.message}`));
    throw error;
  }
}

/**
 * Gets a swap transaction from Jupiter API
 * @param {Object} quote Quote received from Jupiter API
 * @param {string} userPublicKey User's public key
 * @returns {Promise<Object>} Swap transaction from Jupiter API
 */
async function getJupiterSwapTransaction(quote, userPublicKey) {
  const jupiterApiUrl = `${CONFIG.JUPITER_API_BASE}/swap`;

  console.log(chalk.blue('Requesting swap transaction from Jupiter API'));

  try {
    const response = await axios.post(jupiterApiUrl, {
      quoteResponse: quote,
      userPublicKey: userPublicKey
    }, { timeout: CONFIG.API_TIMEOUT });

    const swapTransaction = response.data;

    if (swapTransaction && swapTransaction.swapTransaction) {
      console.log(chalk.green('Swap transaction received successfully'));
      return swapTransaction;
    } else {
      throw new Error('Invalid swap transaction response');
    }
  } catch (error) {
    console.error(chalk.red(`Jupiter swap transaction error: ${error.message}`));
    throw error;
  }   
}

/**
 * Executes a swap via Jupiter API
 * @param {PublicKey} inputMint Input token address
 * @param {PublicKey} outputMint Output token address
 * @param {BigInt} inputAmount Amount to swap (in lamports/native units)
 * @param {number} slippage Slippage tolerance (percentage)
 * @param {Connection} connection Solana connection
 * @param {Keypair} wallet Wallet keypair
 * @returns {Promise<Object>} Transaction result
 */
async function jupiterSwapAndConfirm(inputMint, outputMint, inputAmount, slippage, connection, wallet) {
  console.log(chalk.blue(`Executing Jupiter swap: ${Number(inputAmount) / LAMPORTS_PER_SOL} SOL → Token ${outputMint.toString()}`));
  
  try {
    // 1. Get quote
    const quoteParams = {
      inputMint: inputMint.toString(),
      outputMint: outputMint.toString(),
      amount: inputAmount.toString(),
      slippage: slippage.toString(),
      maxAccounts: 64 // Reasonable value to avoid timeouts
    };
    
    const quote = await getJupiterQuote(quoteParams);
    
    // 2. Get swap transaction
    const swapTransaction = await getJupiterSwapTransaction(quote, wallet.publicKey.toString());
    
    // 3. Decode and sign transaction
    const transaction = Transaction.from(Buffer.from(swapTransaction.swapTransaction, 'base64'));
    
    // 4. Add priority fees if defined
    if (CONFIG.PRIORITY_FEE > 0) {
      console.log(chalk.yellow(`Adding priority fee: ${CONFIG.PRIORITY_FEE}`));
      // Logic to add priority fees if needed
    }
    
    // 5. Set transaction parameters
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = wallet.publicKey;
    
    // 6. Sign and send transaction
    const signedTransaction = transaction.sign([wallet]);
    const signature = await connection.sendRawTransaction(signedTransaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: CONFIG.MAX_RETRIES
    });
    
    console.log(chalk.green(`Transaction submitted: ${signature}`));
    
    // 7. Confirm transaction
    const confirmation = await connection.confirmTransaction(signature, 'confirmed');
    
    console.log(chalk.green(`Transaction confirmed successfully: ${signature}`));
    
    // 8. Return results
    return {
      success: true,
      signature,
      outputAmount: quote.outAmount,
      inputAmount: inputAmount.toString(),
      strategy: 'jupiter'
    };
  } catch (error) {
    console.error(chalk.red(`Jupiter swap error: ${error.message}`));
    
    // Scam token detection
    if (error.message.includes('program not executable') || 
        error.message.includes('invalid account owner')) {
      console.warn(chalk.yellow('Potential scam token detected'));
      return {
        success: false,
        error: error.message,
        scamDetected: true
      };
    }
    
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Evaluates a token to determine if it's worth buying
 * @param {Object} pool Token pool information
 * @returns {boolean} True if token meets purchase criteria
 */
function evaluateToken(pool) {
  const symbol = pool.baseToken?.symbol || 'Unknown';
  console.log(chalk.blue(`Evaluating token: ${symbol}`));

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

  // Log evaluation
  console.log(chalk.blue(`Evaluation for ${symbol}:`), {
    flags: redFlagCount,
    containsScamKeyword,
    suspiciousBuySellRatio,
    lowLiquidity: liquidityUsd < MIN_LIQUIDITY_USD,
    lowVolume24h: volume24h < MIN_VOLUME_24H,
  });

  // Reject highly suspicious tokens
  if (redFlagCount >= 3) {
    console.log(chalk.yellow(`Token ${symbol} rejected: ${redFlagCount} suspicious indicators - ${flags.join(', ')}`));
    return false;
  }

  // Evaluation criteria
  const meetsLiquidityCriteria = liquidityUsd >= MIN_LIQUIDITY_USD;
  const meetsVolumeCriteria = volume24h >= MIN_VOLUME_24H;

  // Quality factors
  const recentBuysM5 = txns.m5?.buys || 0;
  const recentSellsM5 = txns.m5?.sells || 0;
  const hasRecentBuyActivity = recentBuysM5 > recentSellsM5;
  const isRising = priceChange24h > 0;

  // Final decision - Token must meet at least 2 main criteria
  let criteriaMetCount = 0;
  if (meetsLiquidityCriteria) criteriaMetCount++;
  if (meetsVolumeCriteria) criteriaMetCount++;
  
  // Quality factors
  let qualityFactorsCount = 0;
  if (hasRecentBuyActivity) qualityFactorsCount++;
  if (isRising) qualityFactorsCount++;
  
  if (criteriaMetCount >= 2 || (criteriaMetCount >= 1 && qualityFactorsCount >= 1)) {
    if (hasRecentBuyActivity) {
      console.log(chalk.green(`Token ${symbol} ACCEPTED for purchase`));
      return true;
    }
  }

  console.log(chalk.red(`Token ${symbol} REJECTED: doesn't meet minimum criteria`));
  return false;
}

/**
 * Gets token data from logs
 * @param {string} tokenAddress Token address to look up
 * @param {string} logFilePath Path to the log file
 * @returns {Object|null} Token data or null if not found
 */
function getTokenDataFromLogs(tokenAddress, logFilePath) {
  try {
    // Check if log file exists
    if (!fs.existsSync(logFilePath)) {
      console.log(`Log file ${logFilePath} not found`);
      return null;
    }
    
    // Read log file
    const tokenData = readTokenLogs(logFilePath);
    
    // Normalize address for comparison
    const normalizedAddress = tokenAddress.toString().toLowerCase();
    
    // Check for token in logs (case-insensitive)
    if (tokenData.tokens) {
      // Try exact match first
      if (tokenData.tokens[tokenAddress]) {
        return tokenData.tokens[tokenAddress];
      }
      
      // Try case-insensitive match
      for (const [address, data] of Object.entries(tokenData.tokens)) {
        if (address.toLowerCase() === normalizedAddress) {
          return data;
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error extracting token data:', error);
    return null;
  }
}

/**
 * Simulates a token sale with realistic price impact
 * @param {string} tokenAddress Token address
 * @param {string} tokenName Token name/symbol
 * @param {number} amount Amount to sell
 * @param {Connection} connection Solana connection
 * @param {Keypair} wallet Wallet keypair
 * @returns {Promise<Object>} Simulation result with realistic data
 */
async function simulateSaleWithRealROI(tokenAddress, tokenName, amount, connection, wallet) {
  console.log(`[DRY RUN] Simulating sale with real data for ${tokenName} (${tokenAddress}), Amount: ${amount}`);
  
  // Generate unique ID for simulation
  const mockSignature = `DRY_RUN_SALE_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
  
  try {
    // Get log file path
    const logFilePath = CONFIG.LOG_FILE_PATH;
    
    // 1. Get real purchase price from logs
    const tokenInfo = getTokenDataFromLogs(tokenAddress, logFilePath);
    let purchasePricePerToken = 0;
    let purchaseAmount = 0;
    let purchaseTimestamp = '';
    
    if (tokenInfo) {
      purchasePricePerToken = tokenInfo.avgBuyPrice || 0;
      purchaseAmount = tokenInfo.currentAmount || 0;
      purchaseTimestamp = tokenInfo.firstPurchaseTime || '';
      console.log(`[DRY RUN] Purchase price from logs: ${purchasePricePerToken} SOL/token`);
    } else {
      console.log(`[DRY RUN] Token ${tokenName} not found in logs.`);
    }
    
    // 3. Get real market data
    const pairInfo = await getPairInformation('solana', tokenAddress);
    if (!pairInfo || !pairInfo.priceNative) {
      throw new Error('Unable to get real market data for this token');
    }
    
    // Extract real market data
    const currentPrice = parseFloat(pairInfo.priceNative);
    const priceUsd = parseFloat(pairInfo.priceUsd || '0');
    const liquidityBase = pairInfo.liquidity?.base || 0; // Tokens in pool
    const liquidityQuote = pairInfo.liquidity?.quote || 0; // SOL in pool
    const liquidityUsd = pairInfo.liquidity?.usd || 0; // Total value in USD
    
    // Recent transactions for trend analysis
    const txns = pairInfo.txns || { m5: {}, h1: {}, h6: {}, h24: {} };
    const recentBuys = txns.m5?.buys || 0;
    const recentSells = txns.m5?.sells || 0;
    const buyPressure = recentSells > 0 ? recentBuys / recentSells : recentBuys > 0 ? 2 : 1;
    
    console.log(`[DRY RUN] Real market data obtained:`);
    console.log(`- Current price: ${currentPrice} SOL/token (${priceUsd} USD)`);
    console.log(`- Liquidity: ${liquidityBase} tokens / ${liquidityQuote} SOL (${liquidityUsd} USD)`);
    console.log(`- Recent transactions (5min): ${recentBuys} buys / ${recentSells} sells`);
    
    // 4. Calculate real market impact using constant product formula (x*y=k)
    let exactMarketImpact = 0;
    let adjustedPrice = currentPrice;
    let solReceived = 0;
    
    if (liquidityBase > 0 && liquidityQuote > 0) {
      // Calculate price impact using x*y=k formula with exact pool data
      const k = liquidityBase * liquidityQuote; // product constant
      const newTokensInPool = liquidityBase + amount; // tokens after sale
      const newSolInPool = k / newTokensInPool; // new SOL amount in pool
      const solExtracted = liquidityQuote - newSolInPool; // SOL you would receive
      
      // Effective price after impact
      const effectivePrice = solExtracted / amount;
      
      // Precise percentage impact
      exactMarketImpact = ((effectivePrice - currentPrice) / currentPrice) * 100;
      adjustedPrice = effectivePrice;
      solReceived = solExtracted;
      
      console.log(`[DRY RUN] Real market impact calculation:`);
      console.log(`- Calculated slippage: ${exactMarketImpact.toFixed(4)}%`);
      console.log(`- Effective price: ${effectivePrice.toFixed(8)} SOL/token`);
      console.log(`- SOL to receive: ${solExtracted.toFixed(6)} SOL`);
    } else {
      // If exact calculation not possible, use thresholds based on real observations
      const salePercentOfLiquidity = liquidityBase > 0 ? (amount / liquidityBase) * 100 : 0;
      console.log(`[DRY RUN] Sale = ${salePercentOfLiquidity.toFixed(2)}% of total liquidity`);
      
      // Determine impact based on liquidity percentage
      if (salePercentOfLiquidity > 50) {
        exactMarketImpact = -30;
      } else if (salePercentOfLiquidity > 25) {
        exactMarketImpact = -20;
      } else if (salePercentOfLiquidity > 10) {
        exactMarketImpact = -10;
      } else if (salePercentOfLiquidity > 5) {
        exactMarketImpact = -5;
      } else {
        exactMarketImpact = -2;
      }
      
      // Adjust based on recent buy pressure
      if (buyPressure > 2) {
        // Strong buy pressure reduces negative impact
        exactMarketImpact *= 0.7;
      } else if (buyPressure < 0.5) {
        // Strong sell pressure amplifies negative impact
        exactMarketImpact *= 1.3;
      }
      
      adjustedPrice = currentPrice * (1 + exactMarketImpact / 100);
      solReceived = amount * adjustedPrice;
    }
    
    // 5. If no purchase price was found, use alternative estimation
    if (purchasePricePerToken <= 0) {
      // Use token data to estimate purchase time
      if (pairInfo.pairCreatedAt) {
        const pairAge = Date.now() - pairInfo.pairCreatedAt;
        const pairAgeHours = pairAge / (1000 * 60 * 60);
        
        // For very recent tokens (likely purchased recently)
        if (pairAgeHours < 24) {
          // Use current price with slight discount as conservative estimate
          purchasePricePerToken = currentPrice * 0.95;
          console.log(`[DRY RUN] Conservative estimate based on pair age (${pairAgeHours.toFixed(1)} hours): ${purchasePricePerToken} SOL/token`);
        } else {
          // For older tokens, use historical price data if available
          const priceChange24h = pairInfo.priceChange?.h24 || 0;
          if (priceChange24h !== 0) {
            // Estimate 24h ago price based on price change
            const price24hAgo = currentPrice / (1 + priceChange24h / 100);
            purchasePricePerToken = price24hAgo;
            console.log(`[DRY RUN] Estimate based on historical price data: ${purchasePricePerToken} SOL/token`);
          } else {
            // Last resort: use a reasonable but low value
            purchasePricePerToken = currentPrice * 0.9;
            console.log(`[DRY RUN] Default estimate: ${purchasePricePerToken} SOL/token`);
          }
        }
      } else {
        // Minimum safe value if all else fails
        purchasePricePerToken = currentPrice * 0.9;
        console.log(`[DRY RUN] Unable to determine precise purchase price, using estimate: ${purchasePricePerToken} SOL/token`);
      }
    }
    
    // 6. Calculate ROI and final metrics
    const purchaseValue = purchasePricePerToken * amount;
    const roi = purchaseValue > 0 ? ((solReceived - purchaseValue) / purchaseValue) * 100 : 0;
    
    // Calculate holding time
    let holdingTime = "Unknown duration";
    let holdingMinutes = 0;
    if (purchaseTimestamp) {
      const purchaseDate = new Date(purchaseTimestamp);
      const currentDate = new Date();
      const diffMs = currentDate - purchaseDate;
      holdingMinutes = Math.floor(diffMs / 60000);
      holdingTime = `${holdingMinutes} minute(s)`;
    }
    
    // 7. Log simulated sale
    try {
      logTokenSale(
        tokenAddress, 
        tokenName, 
        amount, 
        solReceived, 
        { 
          simulation: true,
          marketImpact: exactMarketImpact,
          realPrice: currentPrice,
          adjustedPrice: adjustedPrice,
          liquidityData: {
            baseTokens: liquidityBase,
            quoteSOL: liquidityQuote,
            usdValue: liquidityUsd
          },
          buyPressure: buyPressure
        },
        true // isDryRun
      );
    } catch (logError) {
      console.error('[DRY RUN] Error updating logs:', logError.message);
    }
    
    // 8. Determine if sale is recommended
    const isPositiveROI = roi > 0;
    const isSignificantROI = roi > 100; // 100% considered significant
    const isLongHold = holdingMinutes > 5; // 5 minutes considered long
    
    let saleRecommendation = '';
    if (isPositiveROI && isSignificantROI) {
      saleRecommendation = 'SALE RECOMMENDED: Significant ROI';
    } else if (isPositiveROI && isLongHold) {
      saleRecommendation = 'SALE RECOMMENDED: Positive ROI after extended holding';
    } else if (roi < -10) {
      saleRecommendation = 'SALE RECOMMENDED: Limit losses';
    } else if (exactMarketImpact < -20 && roi > 0) {
      saleRecommendation = 'PARTIAL SALE RECOMMENDED: High market impact';
    } else if (roi > 0) {
      saleRecommendation = 'POSSIBLE SALE: Positive but low ROI';
    } else {
      saleRecommendation = 'HOLD POSITION: Wait for better opportunity';
    }
    
    console.log(`[DRY RUN] ${saleRecommendation}`);
    
    // 9. Create detailed report
    return {
      success: true,
      tokenAddress,
      tokenName,
      amount,
      purchasePricePerToken,
      currentPricePerToken: currentPrice,
      adjustedPricePerToken: adjustedPrice,
      marketImpact: exactMarketImpact,
      purchaseValue,
      saleValue: solReceived,
      roi,
      holdingTime,
      holdingMinutes,
      timestamp: new Date().toISOString(),
      signature: mockSignature,
      recommendation: saleRecommendation,
      marketData: {
        liquidityBase,
        liquidityQuote,
        liquidityUsd,
        recentBuys,
        recentSells,
        buyPressure
      }
    };
  } catch (error) {
    console.error('[DRY RUN] Error simulating sale:', error);
    return {
      success: false,
      tokenAddress,
      tokenName,
      amount,
      error: error.message,
      timestamp: new Date().toISOString(),
      signature: mockSignature
    };
  }
}

/**
 * Sells all tokens in the wallet when the script is stopped
 * @param {Connection} connection - Solana connection
 * @param {Keypair} wallet - Wallet keypair
 * @returns {Promise<Object>} Result of the cleanup operation
 */
async function sellAllTokensOnExit(connection, wallet) {
  console.log(chalk.yellow('⚠️ Script stopping - Selling all tokens in wallet...'));
  
  try {
    const isDryRun = CONFIG.DRY_RUN;
    console.log(`Operating in ${isDryRun ? 'DRY RUN' : 'PRODUCTION'} mode`);
    
    const soldTokens = [];
    const failedTokens = [];
    
    // Read token data from logs first (needed for both regular and dry run mode)
    const tokenData = readTokenLogs(CONFIG.LOG_FILE_PATH);
    const loggedTokens = tokenData.tokens || {};
    
    if (isDryRun) {
      // In dry run mode, use token amounts from logs
      console.log(chalk.blue('DRY RUN MODE: Using token amounts from logs'));
      
      for (const [tokenAddress, tokenInfo] of Object.entries(loggedTokens)) {
        // Only consider tokens with positive current amount
        if (!tokenInfo || tokenInfo.currentAmount <= 0) continue;
        
        const tokenName = tokenInfo.tokenName || tokenAddress.slice(0, 8) + '...';
        const tokenAmount = tokenInfo.currentAmount;
        
        console.log(`[DRY RUN] Selling ${tokenAmount} tokens of ${tokenName} (${tokenAddress})`);
        
        // Simulate the sale
        try {
          const saleResult = await simulateSaleWithRealROI(
            tokenAddress,
            tokenName,
            tokenAmount,
            connection,
            wallet
          );
          
          if (saleResult.success) {
            console.log(chalk.green(`[DRY RUN] Successfully sold ${tokenAmount} ${tokenName} (Estimated ROI: ${saleResult.roi ? saleResult.roi.toFixed(2) : 'N/A'}%)`));
            soldTokens.push({
              tokenAddress,
              tokenName,
              amount: tokenAmount,
              solReceived: saleResult.solReceived,
              roi: saleResult.roi,
              isDryRun: true
            });
          } else {
            console.error(chalk.red(`[DRY RUN] Failed to sell ${tokenName}: ${saleResult.error}`));
            failedTokens.push({
              tokenAddress,
              tokenName,
              amount: tokenAmount,
              error: saleResult.error
            });
          }
        } catch (saleError) {
          console.error(chalk.red(`[DRY RUN] Error simulating sale of ${tokenName}: ${saleError.message}`));
          failedTokens.push({
            tokenAddress,
            tokenName,
            amount: tokenAmount,
            error: saleError.message
          });
        }
        
        // Small delay between sales
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } else {
      // In production mode, check actual wallet balances
      console.log(chalk.blue('PRODUCTION MODE: Checking actual wallet balances'));
      
      // Fetch all token accounts owned by this wallet
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
        wallet.publicKey,
        { programId: TOKEN_PROGRAM_ID }
      );
      
      console.log(`Found ${tokenAccounts.value.length} token accounts in wallet`);
      
      if (tokenAccounts.value.length === 0) {
        console.log('No tokens to sell.');
        return { success: true, message: 'No tokens found in wallet', soldTokens: [] };
      }
      
      // Process each token account
      for (const tokenAccount of tokenAccounts.value) {
        try {
          const parsedInfo = tokenAccount.account.data.parsed.info;
          const tokenAddress = parsedInfo.mint;
          const tokenAmount = parsedInfo.tokenAmount.uiAmount;
          
          // Skip tokens with zero balance or WSOL
          if (tokenAmount <= 0 || tokenAddress.toString() === WRAPPED_SOL_MINT.toString()) {
            continue;
          }
          
          console.log(`Selling ${tokenAmount} tokens of ${tokenAddress}`);
          
          // Try to get token name from logs
          let tokenName = tokenAddress.toString().slice(0, 8) + '...';
          if (loggedTokens[tokenAddress] && loggedTokens[tokenAddress].tokenName) {
            tokenName = loggedTokens[tokenAddress].tokenName;
          }
          
          // Execute the sale
          const saleResult = await executeSaleWithROI(
            tokenAddress,
            tokenName,
            tokenAmount,
            connection,
            wallet
          );
          
          if (saleResult.success) {
            console.log(chalk.green(`Successfully sold ${tokenAmount} ${tokenName} for ${saleResult.solReceived} SOL (ROI: ${saleResult.roi ? saleResult.roi.toFixed(2) : 'N/A'}%)`));
            soldTokens.push({
              tokenAddress,
              tokenName,
              amount: tokenAmount,
              solReceived: saleResult.solReceived,
              roi: saleResult.roi
            });
          } else {
            console.error(chalk.red(`Failed to sell ${tokenName}: ${saleResult.error}`));
            failedTokens.push({
              tokenAddress,
              tokenName,
              amount: tokenAmount,
              error: saleResult.error
            });
          }
          
          // Small delay between sells to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, 3000));
          
        } catch (tokenError) {
          console.error(`Error processing token account: ${tokenError.message}`);
          failedTokens.push({
            tokenAddress: 'unknown',
            error: tokenError.message
          });
        }
      }
    }
    
    // Log summary
    console.log(chalk.yellow(`=== Sell All Summary ${isDryRun ? '[DRY RUN]' : ''} ===`));
    console.log(`Successfully sold ${soldTokens.length} tokens`);
    console.log(`Failed to sell ${failedTokens.length} tokens`);
    
    // Calculate total SOL received
    const totalSolReceived = soldTokens.reduce((sum, token) => sum + (token.solReceived || 0), 0);
    console.log(chalk.green(`Total SOL received: ${totalSolReceived.toFixed(6)} SOL`));
    
    return {
      success: true,
      soldTokens,
      failedTokens,
      totalSolReceived,
      isDryRun
    };
  } catch (error) {
    console.error(chalk.red(`Critical error during sell all operation: ${error.message}`));
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
    
    console.log(chalk.yellow(`\n\n${signal} signal received. Starting graceful shutdown...`));
    console.log(chalk.yellow('Please wait while we sell all tokens in your wallet...'));
    
    try {
      // Perform the sell all operation
      const sellAllResult = await sellAllTokensOnExit(connection, wallet);
      
      if (sellAllResult.success) {
        console.log(chalk.green(`Graceful shutdown completed. Sold ${sellAllResult.soldTokens.length} tokens for a total of ${sellAllResult.totalSolReceived.toFixed(6)} SOL`));
      } else {
        console.log(chalk.red(`Graceful shutdown had errors: ${sellAllResult.error}`));
      }
    } catch (error) {
      console.error(chalk.red(`Error during graceful shutdown: ${error.message}`));
    }
    
    console.log(chalk.yellow('Bot shutting down now. Goodbye!'));
    process.exit(0);
  }
  
  // Register handlers for common termination signals
  process.on('SIGINT', () => handleExit('SIGINT')); // Ctrl+C
  process.on('SIGTERM', () => handleExit('SIGTERM')); // Kill command
  
  // Also handle uncaught exceptions and unhandled promise rejections
  process.on('uncaughtException', (error) => {
    console.error(chalk.red('Uncaught Exception:'), error);
    handleExit('UNCAUGHT_EXCEPTION');
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    console.error(chalk.red('Unhandled Promise Rejection:'), reason);
    handleExit('UNHANDLED_REJECTION');
  });
  
  console.log(chalk.green('Exit handlers registered. The bot will sell all tokens on shutdown.'));
  console.log(chalk.green('Press Ctrl+C to stop the bot gracefully.'));
}

  /**
  * Exécute l'achat d'un token
  * @param {string} tokenAddress - Adresse du token à acheter
  * @param {string} tokenName - Nom du token
  * @param {number} amountInSol - Montant en SOL à dépenser
  * @param {Connection} connection - Connexion Solana
  * @param {Keypair} wallet - Wallet keypair
  * @param {boolean} isDryRun - Mode simulation
  * @returns {Promise<Object>} Résultat de l'achat
  */
  async function buyToken(tokenAddress, tokenName, amountInSol, connection, wallet, isDryRun = CONFIG.DRY_RUN) {
      console.log(`${isDryRun ? '[SIMULATION] ' : ''}Achat de ${tokenName} (${tokenAddress}), Montant: ${amountInSol} SOL`);
      
      try {
        // Créer l'adresse PublicKey du token
        const tokenMintAddress = new PublicKey(tokenAddress);
        
        // Convertir le montant SOL en lamports (bigint)
        const amountInLamports = BigInt(Math.floor(amountInSol * LAMPORTS_PER_SOL));
        
        // Mode simulation
        if (isDryRun) {
          // Générer un identifiant unique pour la simulation
          const mockSignature = `SIM_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
          
          // Estimer le nombre de tokens à recevoir
          let estimatedTokens = 0;
          
          try {
            // Essayer d'obtenir des données réelles pour une meilleure estimation
            const pairInfo = await getPairInformation('solana', tokenAddress);
            if (pairInfo && pairInfo.priceNative) {
              const price = parseFloat(pairInfo.priceNative);
              if (price > 0) {
                estimatedTokens = amountInSol / price;
                console.log(`[SIMULATION] Estimation basée sur le marché: ${estimatedTokens.toFixed(4)} tokens @ ${price} SOL/token`);
              }
            }
          } catch (error) {
            console.log(`[SIMULATION] Erreur d'estimation: ${error.message}`);
          }
          
          // Si pas de données disponibles, utiliser une estimation arbitraire
          if (estimatedTokens === 0) {
            estimatedTokens = amountInSol * 1000;
            console.log(`[SIMULATION] Estimation arbitraire: ${estimatedTokens.toFixed(4)} tokens`);
          }
          
          // Enregistrer l'achat simulé
          logTokenPurchase(
            tokenAddress,
            tokenName,
            estimatedTokens,
            amountInSol,
            estimatedTokens,
            { simulation: true }
          );
          
          console.log(`[SIMULATION] Achat simulé enregistré: ${mockSignature}`);
          
          return {
            success: true,
            signature: mockSignature,
            tokensReceived: estimatedTokens,
            amountInSol,
            isDryRun: true
          };
        }
        
        // Mode production
        
        // Préparer le swap via Jupiter
        console.log(`Exécution du swap: ${amountInSol} SOL -> ${tokenName} avec ${CONFIG.SLIPPAGE}% de slippage`);
        
        // Vérifier que le montant est raisonnable
        if (amountInSol <= 0) {
          throw new Error(`Montant de swap invalide: ${amountInSol} SOL`);
        }
        
        // Exécuter le swap
        const result = await jupiterSwapAndConfirm(
          NATIVE_MINT, // SOL
          tokenMintAddress, // Token cible
          amountInLamports, // Montant en lamports
          CONFIG.SLIPPAGE, // Slippage configuré
          connection,
          wallet
        );
        
        if (!result.success) {
          if (result.scamDetected) {
            console.warn(`Token frauduleux détecté pour ${tokenName}`);
            logTokenPurchase(
              tokenAddress,
              tokenName,
              0, // Aucun token reçu
              amountInSol,
              0,
              { scamDetected: true }
            );
            
            return {
              success: false,
              signature: result.signature,
              scamDetected: true,
              tokensReceived: 0
            };
          }
          throw new Error(`Échec du swap: ${result.error || 'Raison inconnue'}`);
        }
        
        // Calculer les tokens reçus
        const outputAmount = typeof result.outputAmount === 'bigint' ? 
          Number(result.outputAmount) : 
          Number(result.outputAmount || 0);
        
        console.log(`Achat réussi! Reçu: ${outputAmount} ${tokenName}`);
        
        // Enregistrer l'achat
        logTokenPurchase(
          tokenAddress,
          tokenName,
          outputAmount,
          amountInSol,
          outputAmount,
          { source: result.strategy || 'jupiter' }
        );
        
        return {
          success: true,
          signature: result.signature,
          tokensReceived: outputAmount,
          amountInSol,
          isDryRun: false
        };
      } catch (error) {
        console.error(`Erreur lors de l'achat de ${tokenName}:`, error);
        return {
          success: false,
          error: error.message
        };
      }
     }
  
  /**
   * Obtient le solde disponible d'un token
   * @param {string} tokenAddress - Adresse du token
   * @param {Connection} connection - Connexion Solana
   * @param {Keypair} wallet - Wallet keypair
   * @param {boolean} isDryRun - Mode simulation
   * @returns {Promise<number>} Solde disponible
   */
  async function getAvailableTokenBalance(tokenAddress, connection, wallet, isDryRun = CONFIG.DRY_RUN) {
      try {
        if (isDryRun) {
          // En mode simulation, obtenir le solde depuis les logs
          const tokenData = readTokenLogs(CONFIG.LOG_FILE_PATH);
          return tokenData.tokens[tokenAddress]?.currentAmount || 0;
        } else {
          // En mode production, obtenir le solde réel du portefeuille
          try {
            const tokenMintAddress = new PublicKey(tokenAddress);
            const tokenAccounts = await connection.getTokenAccountsByOwner(
              wallet.publicKey,
              { mint: tokenMintAddress }
            );
            
            if (tokenAccounts.value.length === 0) {
              console.log(`Aucun compte de token trouvé pour ${tokenAddress}`);
              return 0;
            }
            
            const tokenAccountPubkey = tokenAccounts.value[0].pubkey;
            WALLET_BALANCE = await connection.getTokenAccountBalance(tokenAccountPubkey);
            return Number(WALLET_BALANCE.value.amount) || 0;
          } catch (error) {
            console.error(`Erreur lors de la vérification du solde: ${error.message}`);
            return 0;
          }
        }
      } catch (error) {
        console.error(`Erreur dans getAvailableTokenBalance: ${error.message}`);
        return 0;
      }
    }
    
    /**
     * Exécute la vente d'un token
     * @param {string} tokenAddress - Adresse du token
     * @param {string} tokenName - Nom du token
     * @param {number} amount - Montant à vendre
     * @param {Connection} connection - Connexion Solana
     * @param {Keypair} wallet - Wallet keypair
     * @param {boolean} isDryRun - Mode simulation
     * @returns {Promise<Object>} Résultat de la vente
     */
    async function sellToken(tokenAddress, tokenName, amount, connection, wallet, isDryRun = CONFIG.DRY_RUN) {
      console.log(`${isDryRun ? '[SIMULATION] ' : ''}Vente de ${tokenName} (${tokenAddress}), Montant: ${amount}`);
      
      try {
        // Vérifier le solde disponible
        const availableAmount = await getAvailableTokenBalance(tokenAddress, connection, wallet, isDryRun);
        
        if (availableAmount <= 0) {
          console.log(`Aucun token ${tokenName} disponible pour la vente`);
          return { 
            success: false, 
            error: "NO_TOKENS_AVAILABLE" 
          };
        }
        
        // Ajuster le montant à vendre (prendre le minimum du montant demandé et du solde réel)
        const amountToSell = Math.min(amount, availableAmount);
        console.log(chalk.green(`Vente de ${amountToSell} tokens ${tokenName} (disponible: ${availableAmount})`));
        
        // En mode simulation, simuler la vente
        if (isDryRun) {
          // Obtenir le prix d'achat à partir des logs
          const tokenData = readTokenLogs(CONFIG.LOG_FILE_PATH);
          const tokenInfo = tokenData.tokens[tokenAddress];
          
          if (!tokenInfo) {
            return { success: false, error: "TOKEN_NOT_FOUND" };
          }
          
          const purchasePricePerToken = tokenInfo.avgBuyPrice || 0;
          
          // Obtenir le prix actuel du marché si disponible
          let currentPrice = 0;
          let solReceived = 0;
          
          try {
            const pairInfo = await getPairInformation('solana', tokenAddress);
            if (pairInfo && pairInfo.priceNative) {
              currentPrice = parseFloat(pairInfo.priceNative);
              solReceived = amountToSell * currentPrice;
            } else {
              // Prix simulé si pas de données disponibles
              currentPrice = purchasePricePerToken * (1 + (Math.random() * 0.3 - 0.1)); // -10% à +20%
              solReceived = amountToSell * currentPrice;
            }
          } catch (error) {
            currentPrice = purchasePricePerToken * (1 + (Math.random() * 0.2 - 0.1)); // -10% à +10%
            solReceived = amountToSell * currentPrice;
          }
          
          // Enregistrer la vente simulée
          const saleResult = logTokenSale(
            tokenAddress,
            tokenName,
            amountToSell,
            solReceived,
            { simulation: true },
            true // isDryRun
          );
          
          return {
            success: true,
            tokenAddress,
            tokenName,
            amount: amountToSell,
            solReceived,
            roi: saleResult.roi,
            isDryRun: true
          };
        }
        
        // Mode production - Vente réelle via Jupiter
        
        // Créer l'adresse PublicKey du token
        const tokenMintAddress = new PublicKey(tokenAddress);
        
        // Exécuter le swap via Jupiter
        const result = await jupiterSwapAndConfirm(
          tokenMintAddress, // Token à vendre
          NATIVE_MINT,      // Recevoir SOL
          BigInt(Math.floor(amountToSell)), // Montant à vendre
          CONFIG.SLIPPAGE,  // Slippage configuré
          connection,
          wallet
        );
        
        if (!result.success) {
          console.log(chalk.red(`Échec de la vente: ${result.error || 'Raison inconnue'}`));
          return { 
            success: false, 
            error: result.error || "SALE_FAILED" 
          };
        }
        
        // Calculer les SOL reçus
        const solReceived = Number(result.outputAmount) / LAMPORTS_PER_SOL || 0;
        
        // Enregistrer la vente
        const saleResult = logTokenSale(
          tokenAddress,
          tokenName,
          amountToSell,
          solReceived,
          { source: result.strategy || 'jupiter' },
          false // Not isDryRun
        );
        
        console.log(`Vente réussie! Reçu: ${solReceived} SOL, ROI: ${saleResult.roi.toFixed(2)}%`);
        
        return {
          success: true,
          signature: result.signature,
          solReceived,
          roi: saleResult.roi,
          remainingAmount: saleResult.remainingAmount
        };
      } catch (error) {
        console.error(`Erreur lors de la vente de ${tokenName}:`, error);
        return { 
          success: false, 
          error: error.message 
        };
      }
    }
  
    /**
   * Récupère les nouveaux pools de tokens
   * @param {Connection} connection - Connexion Solana
   * @returns {Promise<Array>} Liste des nouveaux pools
   */
  async function fetchNewPools(connection) {
      try {
        console.log(chalk.blue('Récupération des nouveaux pools...'));
        const response = await axios.get(`${CONFIG.DEXSCREENER_API}/token-profiles/latest/v1`, { 
          timeout: CONFIG.API_TIMEOUT 
        });
        
        const newPools = response.data.filter(token => token.chainId === 'solana');
        console.log(chalk.green(`${newPools.length} nouveaux pools détectés`));
        return newPools;
      } catch (error) {
        console.error(chalk.red(`Erreur lors de la récupération des nouveaux pools: ${error.message}`));
        return [];
      }
    }
    
    /**
   * Surveille les mouvements de prix d'un token avec vente automatique après 5 minutes
   * @param {string} tokenAddress - Adresse du token
   * @param {string} tokenName - Nom du token
   * @param {number} amount - Montant détenu
   * @param {Connection} connection - Connexion Solana
   * @param {Keypair} wallet - Wallet keypair
   * @returns {number} ID de l'intervalle
   */
  function monitorPriceMovements(tokenAddress, tokenName, amount, connection, wallet) {
      const purchaseTime = Date.now();
      const minHoldingTime = 1 * 60 * 1000; // 1 minute de détention minimum
      const maxHoldingTime = 5 * 60 * 1000; // 5 minutes maximum avant vente
      const checkInterval = 5000; // Vérifier toutes les 5 secondes
      
      console.log(chalk.green(`Démarrage de la surveillance de ${tokenName} (${tokenAddress})`));
      console.log(`Prise de profit: ${CONFIG.TAKE_PROFIT}%, Stop loss: ${CONFIG.STOP_LOSS}%, Vente automatique après 5min`);
      
      // Variables pour suivre les changements de prix
      let lastPrice = null;
      let lastPriceChangeTime = Date.now();
      
      const intervalId = setInterval(async () => {
        try {
          // Vérifier si le temps minimum de détention est passé
          const currentTime = Date.now();
          const timeElapsed = currentTime - purchaseTime;
          
          if (timeElapsed < minHoldingTime) {
            console.log(`Conservation de ${tokenName}: ${Math.floor(timeElapsed/1000)}s écoulées sur ${minHoldingTime/1000}s min.`);
            return;
          }
          
          // Vérifier le solde actuel du token
          const availableAmount = await getAvailableTokenBalance(tokenAddress, connection, wallet);
          
          // S'il n'y a plus de tokens, arrêter la surveillance
          if (availableAmount <= 0) {
            console.log(`Plus de tokens ${tokenName} à vendre. Arrêt de la surveillance.`);
            clearInterval(intervalId);
            return;
          }
          
          // Obtenir le prix actuel du marché
          const pairInfo = await getPairInformation('solana', tokenAddress);
          if (!pairInfo || !pairInfo.priceNative) {
            console.log(`Impossible d'obtenir les informations de prix pour ${tokenName}`);
            return;
          }
          
          const currentPrice = parseFloat(pairInfo.priceNative);
          
          // Obtenir les données du token depuis les logs
          const tokenData = readTokenLogs(CONFIG.LOG_FILE_PATH);
          const tokenInfo = tokenData.tokens[tokenAddress];
          
          if (!tokenInfo) {
            console.log(`Aucune donnée trouvée pour ${tokenName} dans les logs`);
            return;
          }
          
          const purchasePrice = tokenInfo.avgBuyPrice || 0;
          if (purchasePrice <= 0) return;
          
          // Calculer le pourcentage de changement de prix
          const priceChange = ((currentPrice - purchasePrice) / purchasePrice) * 100;
          
          // Log du statut actuel
          console.log(`Surveillance ${tokenName}: Prix=${currentPrice.toFixed(8)}, Achat=${purchasePrice.toFixed(8)}, Variation=${priceChange.toFixed(2)}%`);
          
          // Vérifier si le prix a changé depuis la dernière vérification
          if (lastPrice !== null) {
            const priceChangePercent = Math.abs(((currentPrice - lastPrice) / lastPrice) * 100);
            
            // Si le prix a changé de manière significative (plus de 0.1%), mettre à jour l'horodatage
            if (priceChangePercent > 0.1) {
              console.log(`Prix modifié de ${priceChangePercent.toFixed(2)}% depuis la dernière vérification`);
              lastPriceChangeTime = currentTime;
            } else {
              // Calculer le temps écoulé depuis le dernier changement de prix
              const timeSinceLastPriceChange = currentTime - lastPriceChangeTime;
              
              console.log(`Prix stable depuis ${Math.floor(timeSinceLastPriceChange/1000)}s (seuil: 300s)`);
              
              // Si le prix n'a pas bougé depuis 5 minutes, vendre
              if (timeSinceLastPriceChange >= 5 * 60 * 1000) {
                console.log(chalk.yellow(`VENTE INACTIVITÉ: Prix stable depuis 5min pour ${tokenName}`));
                clearInterval(intervalId);
                
                // Exécuter la vente complète
                await sellToken(tokenAddress, tokenName, availableAmount, connection, wallet);
                return;
              }
            }
          }
          
          // Mettre à jour le dernier prix connu
          lastPrice = currentPrice;
          
          // Vérifier si le temps maximum de détention est atteint
          if (timeElapsed >= maxHoldingTime) {
            console.log(chalk.yellow(`VENTE AUTOMATIQUE: 5min écoulées pour ${tokenName}`));
            clearInterval(intervalId);
            
            // Exécuter la vente complète
            await sellToken(tokenAddress, tokenName, availableAmount, connection, wallet);
            return;
          }
          
          // Vérifier si les conditions de take profit sont remplies
          if (priceChange >= CONFIG.TAKE_PROFIT) {
            console.log(chalk.green(`TAKE PROFIT atteint pour ${tokenName}: +${priceChange.toFixed(2)}%`));
            
            // Exécuter la vente d'un tiers des tokens
            await sellToken(tokenAddress, tokenName, availableAmount/3, connection, wallet);
          } 
          // Vérifier si les conditions de stop loss sont remplies
          else if (priceChange <= CONFIG.STOP_LOSS) {
            console.log(chalk.red(`STOP LOSS déclenché pour ${tokenName}: ${priceChange.toFixed(2)}%`));
            clearInterval(intervalId);
            
            // Exécuter la vente complète
            await sellToken(tokenAddress, tokenName, availableAmount, connection, wallet);
          }
        } catch (error) {
          console.error('Erreur lors de la surveillance des prix:', error);
        }
      }, checkInterval);
      
      return intervalId;
    }
    
    /**
     * Détecte et achète de nouveaux tokens
     * @param {Connection} connection - Connexion Solana
     * @param {Keypair} wallet - Wallet keypair
     */
    async function detectNewTokens(connection, wallet) {
      try {
        // Cache pour éviter de traiter les mêmes tokens plusieurs fois
        const processedTokens = new Set();
        
        const newPools = await fetchNewPools(connection);
        
        // Traiter chaque pool
        for (const token of newPools) {
          // Ignorer les tokens non-Solana
          if (token.chainId !== 'solana') continue;
          
          // Ignorer les tokens déjà traités
          if (processedTokens.has(token.tokenAddress)) {
              console.log(`Token ${token.tokenAddress} déjà traité.`);
              //continue;
          }
          processedTokens.add(token.tokenAddress);
          
          console.log(`Analyse du token: ${token.tokenAddress}`);
          
          try {
            // Vérifier si le token est dans la liste noire
            if (CONFIG.BLACKLISTED_TOKENS.includes(token.tokenAddress)) {
              console.log(`Token ${token.tokenAddress} est dans la liste noire. Ignoré.`);
              continue;
            }
            
            // Vérifier si le token existe déjà dans nos logs
            const tokenData = readTokenLogs(CONFIG.LOG_FILE_PATH);
            if (tokenData.tokens[token.tokenAddress]) {
              console.log(`Token ${token.tokenAddress} existe déjà dans nos logs. Ignoré.`);
              //continue;
            }
            
            // Obtenir les informations du token
            const pairInfo = await getPairInformation('solana', token.tokenAddress);
            if (!pairInfo?.baseToken?.symbol) {
              console.log('Structure d\'informations de paire invalide');
              continue;
            }
            
            // Afficher les informations du token
            const tokenName = pairInfo.baseToken.symbol;
            console.log(`Token: ${pairInfo.baseToken.name || tokenName} (${tokenName})`);
            
            // Évaluer si le token répond aux critères d'achat
            if (evaluateToken(pairInfo)) {
              // Calculer le montant à acheter en fonction de la taille du portefeuille
              const tradeAmountInSOL = await calculateAmountToBuy(connection, wallet);
              
              console.log(chalk.green(`Achat de ${tokenName} pour ${tradeAmountInSOL} SOL`));
              
              // Exécuter l'achat
              const result = await buyToken(
                token.tokenAddress,
                tokenName,
                tradeAmountInSOL,
                connection,
                wallet
              );
              
              // Si l'achat est réussi, configurer la surveillance des prix
              if (result.success) {
                monitorPriceMovements(
                  token.tokenAddress,
                  tokenName,
                  result.tokensReceived,
                  connection,
                  wallet
                );
              }
            } else {
              console.log('Le token ne répond pas aux critères d\'achat');
            }
          } catch (error) {
            console.error(`Erreur lors du traitement du token ${token.tokenAddress}:`, error);
          }
          
          // Ajouter un délai entre le traitement des tokens pour éviter les limites de taux
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error('Erreur lors de la détection de nouveaux tokens:', error);
      }
      
      // Planifier la prochaine détection
      console.log('Prochaine détection de tokens dans 60 secondes...');
      setTimeout(() => detectNewTokens(connection, wallet), 60000);
    }
  
  /**
  * Fonction principale de surveillance et trading
  * @param {Connection} connection - Connexion Solana
  * @param {Keypair} wallet - Wallet keypair
  */
  async function monitorAndTrade(connection, wallet) {
      try {
        console.log(chalk.bgRed('Démarrage de la surveillance continue...'));
        
        // Vérifier le solde du portefeuille
        WALLET_BALANCE = await connection.getBalance(wallet.publicKey) / LAMPORTS_PER_SOL;
        console.log(chalk.green(`Solde du portefeuille: ${WALLET_BALANCE.toFixed(4)} SOL`));
        
        if (WALLET_BALANCE < 0.05) {
          console.log(chalk.red('Solde insuffisant pour le trading. Minimum recommandé: 0.05 SOL'));
          throw new Error('Solde insuffisant pour le trading');
        }
        
        console.log(chalk.bgGreen('Surveillance du marché initialisée avec succès'));
        
        // Démarrer la détection de nouveaux tokens
        detectNewTokens(connection, wallet);
        
        // Démarrer le processus de vente
        processSales(connection, wallet);
      } catch (error) {
        console.error('Échec critique de la surveillance:', error.message);
        
        // Enregistrer l'erreur dans un fichier journal
        try {
          const errorLog = `[${new Date().toISOString()}] - ${error.stack || error.message}\n`;
          fs.appendFileSync(CONFIG.ERROR_LOG_PATH, errorLog);
          console.error(chalk.yellow('Erreur enregistrée dans le fichier journal'));
        } catch (logError) {
          console.error('Impossible d\'enregistrer l\'erreur dans le fichier journal:', logError);
        }
        
        console.error(chalk.red('Tentative de redémarrage dans 10 secondes...'));
        setTimeout(() => monitorAndTrade(connection, wallet), 10000);
      }
     }
     
     /**
     * Traite les ventes de tokens
     * @param {Connection} connection - Connexion Solana
     * @param {Keypair} wallet - Wallet keypair
     */
     async function processSales(connection, wallet) {
      console.log(chalk.blue('Démarrage du processus de vente...'));
      
      try {
        // Lire les données des tokens
        const tokenData = readTokenLogs(CONFIG.LOG_FILE_PATH);
        
        // Parcourir tous les tokens actifs
        if (tokenData && tokenData.tokens) {
          for (const [tokenAddress, token] of Object.entries(tokenData.tokens)) {
            // Ignorer les tokens dont le solde est nul
            if (!token || token.currentAmount <= 0) continue;
            
            const tokenName = token.tokenName || 'Unknown';
            console.log(`Vérification du token ${tokenName} (${tokenAddress})`);
            
            try {
              // Obtenir le prix actuel du marché
              const pairInfo = await getPairInformation('solana', tokenAddress);
              if (!pairInfo || !pairInfo.priceNative) {
                console.log(`Impossible d'obtenir les données de prix pour ${tokenName}`);
                continue;
              }
              
              const currentPrice = parseFloat(pairInfo.priceNative);
              const purchasePrice = token.avgBuyPrice || 0;
              
              if (purchasePrice <= 0) {
                console.log(`Prix d'achat non disponible pour ${tokenName}`);
                continue;
              }
              
              // Calculer le ROI actuel
              const currentROI = ((currentPrice - purchasePrice) / purchasePrice) * 100;
              console.log(`${tokenName}: ROI actuel = ${currentROI.toFixed(2)}%`);
              
              // Vérifier si le token doit être vendu
              if (currentROI >= CONFIG.TAKE_PROFIT) {
                console.log(chalk.green(`TAKE PROFIT atteint pour ${tokenName}: +${currentROI.toFixed(2)}%`));
                
                // Vérifier le montant actuel
                const currentAmount = await getAvailableTokenBalance(tokenAddress, connection, wallet);
                
                if (currentAmount <= 0) {
                  console.log(`Aucun token ${tokenName} à vendre.`);
                  continue;
                }
                
                // Exécuter la vente
                await sellToken(tokenAddress, tokenName, currentAmount, connection, wallet);
              }
              else if (currentROI <= CONFIG.STOP_LOSS) {
                console.log(chalk.red(`STOP LOSS déclenché pour ${tokenName}: ${currentROI.toFixed(2)}%`));
                
                // Vérifier le montant actuel
                const currentAmount = await getAvailableTokenBalance(tokenAddress, connection, wallet);
                
                if (currentAmount <= 0) {
                  console.log(`Aucun token ${tokenName} à vendre.`);
                  continue;
                }
                
                // Exécuter la vente
                await sellToken(tokenAddress, tokenName, currentAmount, connection, wallet);
              }
            } catch (error) {
              console.error(`Erreur lors de l'analyse pour ${tokenName}:`, error);
            }
          }
        }
      } catch (error) {
        console.error('Erreur critique dans processSales:', error);
      }
      
      // Planifier la prochaine vérification
      setTimeout(processSales, 30000, connection, wallet);
     }
  
  
  
  /**
   * SYSTÈME DE TRADING HAUTE PERFORMANCE - OPTIMISÉ POUR ROI MAXIMUM
   * 
   * Cette version du script se concentre exclusivement sur la maximisation du ROI
   * avec une approche simplifiée mais puissante pour le trading de tokens Solana.
   */
  
  /**
   * Évalue un token avec des critères optimisés pour le ROI
   * @param {Object} pool - Informations sur le pool de token
   * @returns {Object} Résultat d'évaluation avec score et décision
   */
  function evaluateTokenROI(pool) {
      // Extraction des métriques essentielles
      const symbol = pool.baseToken?.symbol || 'Unknown';
      const tokenAddress = pool.baseToken?.address || '';
      const liquidityUsd = pool.liquidity?.usd || 0;
      const volume24h = pool.volume?.h24 || 0;
      const priceChange5m = pool.priceChange?.m5 || 0;
      const priceChange1h = pool.priceChange?.h1 || 0;
      const priceChange24h = pool.priceChange?.h24 || 0;
    
      // Calculer l'âge du token en heures
      const tokenAgeHours = pool.pairCreatedAt ? 
        (Date.now() - pool.pairCreatedAt) / (1000 * 60 * 60) : 1000;
      
      // Rejets immédiats (conditions critiques)
      if (priceChange5m < -30) {
        console.log(`⛔ Rejet: ${symbol} en chute rapide (-${Math.abs(priceChange5m)}% en 5min)`);
        return { accepted: false, score: 0 };
      }
      
      // Ratio volume/liquidité (indicateur clé de momentum)
      const volumeRatio = liquidityUsd > 0 ? volume24h / liquidityUsd : 0;
      
      // Analyse des transactions (achats vs ventes)
      const txns = pool.txns || { m5: {}, h1: {} };
      const recentBuys = txns.m5?.buys || 0;
      const recentSells = txns.m5?.sells || 0;
      const buyRatio = recentSells > 0 ? recentBuys / recentSells : (recentBuys > 0 ? 3 : 1);
    
      // Dump en cours?
      if (buyRatio < 0.5 && priceChange5m < -10) {
        console.log(`⛔ Rejet: ${symbol} - dump en cours (ratio achats/ventes = ${buyRatio.toFixed(2)})`);
        return { accepted: false, score: 0 };
      }
    
      // CALCUL DU SCORE ROI (0-100)
      let score = 0;
      
      // 1. Impact de l'âge (jusqu'à 30 points) - favoriser les nouveaux tokens
      let ageScore = 0;
      if (tokenAgeHours <= 24) {
        // Nouveaux tokens (<24h) - score maximal
        ageScore = 30 - (tokenAgeHours / 24 * 10);  // 30 points à 0h, 20 points à 24h
      } else if (tokenAgeHours <= 72) {
        // Tokens récents (1-3 jours)
        ageScore = 20 - ((tokenAgeHours - 24) / 48 * 15);  // 20 points à 24h, 5 points à 72h
      }
      score += ageScore;
      
      // 2. Tendances de prix (jusqu'à 40 points)
      // Momentum récent important (5min)
      if (priceChange5m > 0) score += Math.min(20, priceChange5m * 2);
      
      // Tendance horaire 
      if (priceChange1h > 0) score += Math.min(15, priceChange1h / 2);
      
      // Cohérence sur 24h
      if (priceChange24h > 0 && priceChange1h > 0 && priceChange5m > 0) {
        score += 5; // Bonus pour tendance positive cohérente
      }
      
      // 3. Activité d'achat (jusqu'à 20 points)
      if (buyRatio > 1) score += Math.min(20, buyRatio * 5);
      
      // 4. Volume et liquidité (jusqu'à 10 points)
      if (volumeRatio > 0.5 && volumeRatio < 10) {
        // Volume/liquidité sain (éviter les extrêmes)
        score += Math.min(10, volumeRatio * 2);
      } else if (volumeRatio >= 10) {
        // Volume anormalement élevé - potentiellement pump & dump
        score -= 10;
      }
      
      // Score final (max théorique: 100)
      const finalScore = Math.max(0, Math.min(100, score));
      const threshold = 10; // Seuil de décision
      
      // Logs d'analyse
      console.log(`Analyse ROI pour ${symbol}:`);
      console.log(`- Âge: ${tokenAgeHours.toFixed(1)}h (${ageScore.toFixed(1)} pts)`);
      console.log(`- Prix 5m/1h/24h: ${priceChange5m.toFixed(1)}%/${priceChange1h.toFixed(1)}%/${priceChange24h.toFixed(1)}%`);
      console.log(`- Ratio achats/ventes: ${buyRatio.toFixed(2)}`);
      console.log(`- Activité: ${recentBuys} achats, ${recentSells} ventes (5min)`);
      console.log(`- Volume/liquidité: ${volumeRatio.toFixed(2)}`);
      console.log(`- Score ROI final: ${finalScore.toFixed(1)}/100`);
      
      // Décision finale
      const accepted = finalScore >= threshold;
      
      if (accepted) {
        console.log(`✅ ${symbol} ACCEPTÉ - Fort potentiel ROI (${finalScore.toFixed(1)}/100)`);
      } else {
        console.log(`❌ ${symbol} REJETÉ - Faible potentiel ROI (${finalScore.toFixed(1)}/100)`);
      }
      
      return {
        accepted,
        score: finalScore,
        tokenAgeHours,
        buyRatio,
        priceChange5m,
        priceChange1h,
        volumeRatio,
        recentActivity: { buys: recentBuys, sells: recentSells }
      };
    }
    
    /**
     * Définit une stratégie de vente optimale basée sur le score ROI
     * @param {number} roiScore - Score ROI (0-100)
     * @returns {Object} Stratégie de vente optimisée
     */
    function defineOptimalStrategy(roiScore) {
      // Stratégies adaptatives basées sur le score ROI
      if (roiScore >= 75) {
        // STRATÉGIE AGRESSIVE - Tokens à très fort potentiel
        return {
          name: "MAXIMALE",
          description: "Stratégie agressive pour tokens à très fort potentiel ROI",
          takeProfit: 90,                  // Objectif principal élevé
          stopLoss: -15,                   // Stop loss serré pour protéger le capital
          maxHoldingTimeMinutes: 120,      // Temps de détention plus long pour maximiser les gains
          trailingStopActivation: 30,      // Activer le trailing stop à +30%
          trailingStopPercentage: 10,      // Trailing stop de 10% du maximum
          exitStrategy: [
            { percent: 20, sellPortion: 0.2 },  // Vendre 20% à +20% 
            { percent: 40, sellPortion: 0.3 },  // Vendre 30% à +40%
            { percent: 60, sellPortion: 0.3 },  // Vendre 30% à +60%
            { percent: 90, sellPortion: 0.2 }   // Vendre 20% à +90%
          ]
        };
      } 
      else if (roiScore >= 60) {
        // STRATÉGIE ÉQUILIBRÉE - Tokens à bon potentiel
        return {
          name: "ÉQUILIBRÉE",
          description: "Stratégie équilibrée pour tokens à bon potentiel ROI",
          takeProfit: 50,                  // Objectif plus modéré
          stopLoss: -20,                   // Stop loss standard
          maxHoldingTimeMinutes: 90,       // Temps de détention moyen
          trailingStopActivation: 25,      // Activer le trailing stop à +25%
          trailingStopPercentage: 15,      // Trailing stop de 15% du maximum
          exitStrategy: [
            { percent: 15, sellPortion: 0.25 },  // Vendre 25% à +15%
            { percent: 30, sellPortion: 0.35 },  // Vendre 35% à +30%
            { percent: 50, sellPortion: 0.4 }    // Vendre 40% à +50%
          ]
        };
      }
      else {
        // STRATÉGIE PRUDENTE - Tokens à potentiel modéré/incertain
        return {
          name: "PRUDENTE",
          description: "Stratégie conservatrice pour tokens à potentiel modéré",
          takeProfit: 25,                  // Objectif prudent
          stopLoss: -10,                   // Stop loss serré
          maxHoldingTimeMinutes: 60,       // Temps de détention court
          trailingStopActivation: 15,      // Activer le trailing stop à +15%
          trailingStopPercentage: 8,       // Trailing stop de 8% du maximum
          exitStrategy: [
            { percent: 10, sellPortion: 0.5 },  // Vendre 50% à +10%
            { percent: 25, sellPortion: 0.5 }   // Vendre 50% à +25%
          ]
        };
      }
    }
    
    /**
     * Moniteur de prix intelligent pour maximiser le ROI
     * @param {string} tokenAddress - Adresse du token
     * @param {string} tokenName - Nom du token
     * @param {number} amount - Quantité de tokens
     * @param {Connection} connection - Connexion Solana
     * @param {Keypair} wallet - Wallet keypair
     * @param {Object} strategy - Stratégie de trading
     * @returns {number} ID de l'intervalle (pour pouvoir l'arrêter)
     */
    function monitorROI(tokenAddress, tokenName, amount, connection, wallet, strategy) {
      console.log(`🚀 Démarrage du moniteur ROI [${strategy.name}] pour ${tokenName}`);
      console.log(`- Take profit: ${strategy.takeProfit}%`);
      console.log(`- Stop loss: ${strategy.stopLoss}%`);
      console.log(`- Trailing stop: Activation à +${strategy.trailingStopActivation}%, marge de ${strategy.trailingStopPercentage}%`);
      
      // Paramètres de surveillance
      const startTime = Date.now();
      const checkInterval = 5000; // 5 secondes entre les vérifications
      
      // Variables de suivi
      let highestPrice = 0;
      let completedExits = new Set();
      let trailingStopActive = false;
      let priceHistory = [];
      
      // Démarrer la surveillance périodique
      const intervalId = setInterval(async () => {
        try {
          // 1. Vérifier s'il reste des tokens à vendre
          const availableAmount = await getAvailableTokenBalance(tokenAddress, connection, wallet);
          
          if (availableAmount <= 0) {
            console.log(`Plus de tokens ${tokenName} disponibles. Arrêt de la surveillance.`);
            clearInterval(intervalId);
            return;
          }
          
          // 2. Obtenir les prix actuels du marché
          const pairInfo = await getPairInformation('solana', tokenAddress);
          if (!pairInfo || !pairInfo.priceNative) {
            console.log(`Impossible d'obtenir le prix actuel de ${tokenName}`);
            return;
          }
          
          const currentPrice = parseFloat(pairInfo.priceNative);
          
          // 3. Mettre à jour le prix le plus élevé vu
          if (currentPrice > highestPrice) {
            highestPrice = currentPrice;
          }
          
          // 4. Récupérer le prix d'achat depuis les logs
          const tokenData = readTokenLogs(CONFIG.LOG_FILE_PATH);
          const tokenInfo = tokenData.tokens[tokenAddress];
          
          if (!tokenInfo) {
            console.log(`Données introuvables pour ${tokenName}`);
            return;
          }
          
          const purchasePrice = tokenInfo.avgBuyPrice || 0;
          if (purchasePrice <= 0) return;
          
          // 5. Calculer les indicateurs de performance
          const roi = ((currentPrice - purchasePrice) / purchasePrice) * 100;
          const dropFromHigh = ((currentPrice - highestPrice) / highestPrice) * 100;
          
          // 6. Ajouter à l'historique des prix (pour analyse de tendance)
          priceHistory.push({
            price: currentPrice,
            timestamp: Date.now()
          });
          
          // Limiter l'historique aux 12 dernières entrées (1 minute d'historique)
          if (priceHistory.length > 12) {
            priceHistory.shift();
          }
          
          // 7. Analyser la tendance récente
          let recentTrend = 0;
          if (priceHistory.length >= 6) { // 30 secondes de données
            const recentPrices = priceHistory.slice(-6);
            const firstPrice = recentPrices[0].price;
            const lastPrice = recentPrices[recentPrices.length - 1].price;
            recentTrend = ((lastPrice - firstPrice) / firstPrice) * 100;
          }
          
          // 8. Vérifier le temps écoulé
          const timeElapsedMinutes = (Date.now() - startTime) / (60 * 1000);
          
          // 9. Afficher les informations de suivi
          console.log(`${tokenName}: Prix=${currentPrice.toFixed(8)}, ROI=${roi.toFixed(2)}%, ` +
                      `Depuis max=${dropFromHigh.toFixed(2)}%, Tendance=${recentTrend.toFixed(2)}%`);
          
          // 10. LOGIQUE DE DÉCISION
          
          // A. Vérifier les étapes de sortie progressive
          for (const exit of strategy.exitStrategy) {
            if (!completedExits.has(exit.percent) && roi >= exit.percent) {
              console.log(`🔹 VENTE PARTIELLE: ${(exit.sellPortion * 100).toFixed(0)}% des tokens à +${roi.toFixed(2)}% (étape: +${exit.percent}%)`);
              
              // Calculer le montant à vendre pour cette étape
              const amountToSell = availableAmount * exit.sellPortion;
              
              // Exécuter la vente
              await sellToken(tokenAddress, tokenName, amountToSell, connection, wallet);
              
              // Marquer cette étape comme complétée
              completedExits.add(exit.percent);
              
              // Mise à jour rapide pour éviter de vendre trop
              const newAvailableAmount = await getAvailableTokenBalance(tokenAddress, connection, wallet);
              if (newAvailableAmount <= 0) {
                clearInterval(intervalId);
                return;
              }
              
              break; // Ne traiter qu'une étape à la fois
            }
          }
          
          // B. Activer le trailing stop si le seuil est atteint
          if (!trailingStopActive && roi >= strategy.trailingStopActivation) {
            trailingStopActive = true;
            console.log(`🔹 TRAILING STOP ACTIVÉ à +${roi.toFixed(2)}% (marge: ${strategy.trailingStopPercentage}%)`);
          }
          
          // C. Vérifier si le trailing stop est déclenché
          if (trailingStopActive && dropFromHigh <= -strategy.trailingStopPercentage) {
            console.log(`🔸 TRAILING STOP DÉCLENCHÉ: -${Math.abs(dropFromHigh).toFixed(2)}% depuis le plus haut`);
            clearInterval(intervalId);
            
            // Vendre tous les tokens restants
            await sellToken(tokenAddress, tokenName, availableAmount, connection, wallet);
            return;
          }
          
          // D. Vérifier le take profit final (pour tous les tokens restants)
          else if (roi >= strategy.takeProfit) {
            console.log(`💰 TAKE PROFIT FINAL: +${roi.toFixed(2)}% ≥ ${strategy.takeProfit}%`);
            clearInterval(intervalId);
            
            await sellToken(tokenAddress, tokenName, availableAmount, connection, wallet);
            return;
          }
          
          // E. Vérifier le stop loss
          else if (roi <= strategy.stopLoss) {
            console.log(`⛔ STOP LOSS: ${roi.toFixed(2)}% ≤ ${strategy.stopLoss}%`);
            clearInterval(intervalId);
            
            await sellToken(tokenAddress, tokenName, availableAmount, connection, wallet);
            return;
          }
          
          // F. Temps maximum atteint
          else if (timeElapsedMinutes >= strategy.maxHoldingTimeMinutes) {
            console.log(`⏱️ TEMPS MAXIMUM: ${timeElapsedMinutes.toFixed(1)}min ≥ ${strategy.maxHoldingTimeMinutes}min`);
            clearInterval(intervalId);
            
            await sellToken(tokenAddress, tokenName, availableAmount, connection, wallet);
            return;
          }
          
          // G. Protection contre l'inversion de tendance en profit
          else if (roi > 10 && recentTrend < -10 && priceHistory.length >= 6) {
            console.log(`📉 INVERSION DE TENDANCE DÉTECTÉE: ${recentTrend.toFixed(2)}% en 30s avec ROI de +${roi.toFixed(2)}%`);
            
            // Si nous sommes en profit et que la tendance s'inverse fortement, vendre 50%
            const amountToSell = availableAmount * 0.5;
            await sellToken(tokenAddress, tokenName, amountToSell, connection, wallet);
            
            // Resserrer le stop loss pour protéger les gains restants
            strategy.stopLoss = Math.max(strategy.stopLoss, roi * 0.5);
            console.log(`🛡️ Stop loss ajusté à ${strategy.stopLoss.toFixed(2)}%`);
          }
          
        } catch (error) {
          console.error(`Erreur de surveillance ROI: ${error.message}`);
        }
      }, checkInterval);
      
      return intervalId;
    }
    
    /**
   * Achète un token avec une logique ROI optimisée
   * Version améliorée qui répartit mieux le capital entre les tokens
   * @param {string} tokenAddress - Adresse du token
   * @param {string} tokenName - Nom du token
   * @param {number} baseAmount - Montant de base en SOL
   * @param {number} roiScore - Score ROI calculé (0-100)
   * @param {Connection} connection - Connexion Solana
   * @param {Keypair} wallet - Wallet keypair
   * @returns {Promise<Object>} Résultat de l'achat
   */
  async function buyTokenWithROI(tokenAddress, tokenName, baseAmount, roiScore, connection, wallet) {
      console.log(`💰 Achat ROI optimisé pour ${tokenName} (Score: ${roiScore.toFixed(1)}/100)`);
      
      try {
        // 1. Ajuster le montant en fonction du score ROI
        let finalAmount = baseAmount;
        
        if (roiScore >= 75) {
          // Augmenter l'investissement pour les tokens exceptionnels
          finalAmount = baseAmount * 1.2;  // Réduit de 1.5 à 1.2 pour permettre plus d'achats
          console.log(`Score ROI très élevé (${roiScore.toFixed(1)}): montant augmenté à ${finalAmount.toFixed(4)} SOL`);
        } 
        else if (roiScore >= 60) {
          // Montant standard pour les bons tokens
          console.log(`Score ROI élevé (${roiScore.toFixed(1)}): montant standard ${finalAmount.toFixed(4)} SOL`);
        }
        else {
          // Réduire l'investissement pour les tokens moins prometteurs
          finalAmount = baseAmount * 0.8;  // Augmenté de 0.7 à 0.8 pour une meilleure répartition
          console.log(`Score ROI modéré (${roiScore.toFixed(1)}): montant réduit à ${finalAmount.toFixed(4)} SOL`);
        }
        
        // 2. Exécuter l'achat avec le montant ajusté
        const result = await buyToken(tokenAddress, tokenName, finalAmount, connection, wallet);
        
        // 3. Si l'achat est réussi, configurer la stratégie ROI optimisée
        if (result.success) {
          // Ajouter le score ROI aux métadonnées
          const strategy = defineOptimalStrategy(roiScore);
          
          // Configurer un label pour le suivi
          const roiLabel = roiScore >= 75 ? '💎A+' : 
                          roiScore >= 60 ? '💎A' : '💎B';
          const labeledName = `${tokenName} ${roiLabel}`;
          
          // Enregistrer l'achat avec métadonnées
          logTokenPurchase(
            tokenAddress,
            labeledName,
            result.tokensReceived,
            finalAmount,
            result.tokensReceived,
            { 
              roiScore: roiScore,
              strategy: strategy.name,
              source: 'roi-optimized'
            }
          );
          
          // Démarrer le monitoring ROI
          monitorROI(
            tokenAddress,
            labeledName,
            result.tokensReceived,
            connection,
            wallet,
            strategy
          );
          
          return {
            ...result,
            roiScore,
            strategy: strategy.name
          };
        }
        
        return result;
      } catch (error) {
        console.error(`Erreur lors de l'achat ROI: ${error.message}`);
        return {
          success: false,
          error: error.message
        };
      }
    }
    
    /**
     * Détecte et achète automatiquement les meilleurs tokens pour ROI
     * @param {Connection} connection - Connexion Solana
     * @param {Keypair} wallet - Wallet keypair
     */
    async function detectAndTradeROI(connection, wallet) {
      try {
        console.log(`🔍 Recherche de tokens à fort potentiel ROI...`);
        
        // 1. Éviter de traiter les mêmes tokens plusieurs fois
        const processedTokens = new Set();
        
        // 2. Récupérer les nouveaux pools
        const newPools = await fetchNewPools(connection);
        console.log(`${newPools.length} nouveaux pools détectés`);
        
        // 3. Filtrer les tokens non éligibles
        const candidates = [];
        
        for (const token of newPools) {
          // Ignorer les tokens non-Solana
          if (token.chainId !== 'solana') continue;
          
          // Ignorer les tokens déjà traités
          if (processedTokens.has(token.tokenAddress)) continue;
          processedTokens.add(token.tokenAddress);
          
          // Ignorer les tokens blacklistés
          if (CONFIG.BLACKLISTED_TOKENS.includes(token.tokenAddress)) continue;
          
          // Obtenir les informations détaillées
          const pairInfo = await getPairInformation('solana', token.tokenAddress);
          if (!pairInfo?.baseToken?.symbol) continue;
          
          const tokenName = pairInfo.baseToken.symbol;
          console.log(`Analyse ROI de: ${tokenName} (${token.tokenAddress})`);
          
          // 4. Évaluer le potentiel ROI
          const evaluation = evaluateTokenROI(pairInfo);
          
          if (evaluation.accepted) {
            candidates.push({
              address: token.tokenAddress,
              name: tokenName,
              score: evaluation.score,
              age: evaluation.tokenAgeHours
            });
          }
          
          // Délai entre analyses
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        
        // 5. Trier les candidats par score ROI décroissant
        candidates.sort((a, b) => b.score - a.score);
        
        // 6. Sélectionner les 2 meilleurs tokens (limiter pour ne pas diluer le capital)
        const bestCandidates = candidates.slice(0, 2);
        
        if (bestCandidates.length > 0) {
          console.log(`✅ ${bestCandidates.length} tokens à fort potentiel ROI identifiés:`);
          bestCandidates.forEach((token, i) => {
            console.log(`${i+1}. ${token.name} - Score: ${token.score.toFixed(1)}/100`);
          });
          
          // 7. Acheter les meilleurs candidats
          for (const token of bestCandidates) {
            // Calculer le montant de base selon le portefeuille
            const baseAmount = await calculateAmountToBuy(connection, wallet);
            
            // Exécuter l'achat optimisé ROI
            await buyTokenWithROI(
              token.address,
              token.name,
              baseAmount,
              token.score,
              connection,
              wallet
            );
            
            // Délai entre achats
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        } else {
          console.log(`❌ Aucun token ne répond aux critères ROI optimaux`);
        }
        
      } catch (error) {
        console.error(`Erreur de détection ROI: ${error.message}`);
      }
      
      // Planifier la prochaine détection
      console.log(`⏱️ Prochaine détection ROI dans 60 secondes...`);
      setTimeout(() => detectAndTradeROI(connection, wallet), 60000);
    }
  
  
  /**
   * STRATÉGIE DE TRADING ORIENTÉE ROI
   * Ne réinvestit que dans les tokens ayant déjà généré du profit
   */
  
  /**
   * Analyse l'historique des tokens pour identifier ceux ayant généré du profit
   * @param {string} logFilePath - Chemin du fichier de logs
   * @returns {Object} Historique des performances par token
   */
  function analyzePastProfitableTokens(logFilePath) {
      console.log(chalk.blue('🔍 Analyse de l\'historique des tokens profitables...'));
      
      // Lire les données historiques
      const tokenData = readTokenLogs(logFilePath);
      
      if (!tokenData || !tokenData.tokens) {
        console.log(chalk.yellow('Aucun historique de trading trouvé.'));
        return { profitableTokens: {}, unprofitableTokens: {} };
      }
      
      const profitableTokens = {};
      const unprofitableTokens = {};
      
      // Parcourir tous les tokens dans l'historique
      Object.entries(tokenData.tokens).forEach(([address, token]) => {
        if (!token || !token.transactions) return;
        
        // Extraire uniquement les transactions de vente
        const sellTransactions = token.transactions.filter(tx => tx.type === "SELL" && !tx.isDryRun);
        
        if (sellTransactions.length === 0) {
          // Aucune vente encore effectuée
          console.log(`Token ${token.tokenName || address}: Aucune vente enregistrée`);
          return;
        }
        
        // Calculer le ROI moyen sur toutes les ventes
        const totalROI = sellTransactions.reduce((sum, tx) => sum + (tx.roi || 0), 0);
        const averageROI = totalROI / sellTransactions.length;
        
        // Calculer le ratio de réussite (% de ventes avec ROI positif)
        const profitableSales = sellTransactions.filter(tx => (tx.roi || 0) > 0).length;
        const successRate = (profitableSales / sellTransactions.length) * 100;
        
        // Déterminer si le token est globalement profitable
        const isProfitable = averageROI > 0;
        
        // Stocker les informations
        const tokenInfo = {
          address,
          name: token.tokenName || 'Unknown',
          averageROI,
          successRate,
          totalSales: sellTransactions.length,
          lastSaleROI: sellTransactions[sellTransactions.length - 1].roi || 0,
          lastSaleTime: sellTransactions[sellTransactions.length - 1].timestamp,
          baseToken: token.baseToken
        };
        
        // Ajouter aux listes appropriées
        if (isProfitable) {
          profitableTokens[address] = tokenInfo;
          console.log(chalk.green(`✅ Token profitable: ${tokenInfo.name} - ROI moyen: ${averageROI.toFixed(2)}%, Taux de succès: ${successRate.toFixed(0)}%`));
        } else {
          unprofitableTokens[address] = tokenInfo;
          console.log(chalk.red(`❌ Token non profitable: ${tokenInfo.name} - ROI moyen: ${averageROI.toFixed(2)}%, Taux de succès: ${successRate.toFixed(0)}%`));
        }
      });
      
      // Résumé
      const profitableCount = Object.keys(profitableTokens).length;
      const unprofitableCount = Object.keys(unprofitableTokens).length;
      
      console.log(chalk.blue(`📊 Résumé: ${profitableCount} tokens profitables, ${unprofitableCount} tokens non profitables`));
      
      return { profitableTokens, unprofitableTokens };
    }
    
    /**
     * Obtient la liste des tokens à réacheter en priorité
     * @param {Object} profitableTokens - Tokens ayant généré du profit
     * @returns {Array} Liste triée des tokens à prioriser
     */
    function getPriorityRebuyTargets(profitableTokens) {
      // Convertir en tableau pour pouvoir trier
      const tokenList = Object.values(profitableTokens);
      
      // Trier par ROI moyen (meilleur en premier)
      return tokenList.sort((a, b) => b.averageROI - a.averageROI);
    }
    
    /**
     * Vérifie si un token est dans la liste noire basée sur les performances passées
     * @param {string} tokenAddress - Adresse du token à vérifier
     * @param {Object} unprofitableTokens - Liste des tokens non profitables
     * @returns {boolean} True si le token doit être évité
     */
    function isBlacklisted(tokenAddress, unprofitableTokens) {
      return !!unprofitableTokens[tokenAddress];
    }
    
    /**
     * Évalue le potentiel de rachat d'un token profitable
     * @param {Object} tokenInfo - Informations sur le token profitable
     * @param {Object} currentMarketData - Données actuelles du marché
     * @returns {Object} Score et décision de rachat
     */
    function evaluateRebuyPotential(tokenInfo, currentMarketData) {
      console.log(chalk.blue(`Évaluation du potentiel de rachat pour ${tokenInfo.name}`));
      
      // Facteurs qui favorisent le rachat
      let rebuyScore = 50; // Score de base
      
      // 1. ROI historique (jusqu'à +30 points)
      if (tokenInfo.averageROI > 100) {
        rebuyScore += 30; // ROI exceptionnel
      } else if (tokenInfo.averageROI > 50) {
        rebuyScore += 20; // Très bon ROI
      } else if (tokenInfo.averageROI > 20) {
        rebuyScore += 10; // Bon ROI
      }
      
      // 2. Taux de succès des ventes précédentes (jusqu'à +20 points)
      if (tokenInfo.successRate > 90) {
        rebuyScore += 20; // Presque toujours profitable
      } else if (tokenInfo.successRate > 70) {
        rebuyScore += 15; // Souvent profitable
      } else if (tokenInfo.successRate > 50) {
        rebuyScore += 10; // Plus profitable que non profitable
      }
      
      // 3. Conditions actuelles du marché par rapport aux précédentes
      if (currentMarketData) {
        // Activité d'achat récente
        const txns = currentMarketData.txns || { m5: {} };
        const recentBuys = txns.m5?.buys || 0;
        const recentSells = txns.m5?.sells || 0;
        
        if (recentBuys > recentSells * 1.5) {
          rebuyScore += 15; // Forte pression d'achat
          console.log(chalk.green(`Forte pression d'achat actuelle (+15 pts)`));
        } else if (recentBuys < recentSells) {
          rebuyScore -= 20; // Plus de ventes que d'achats
          console.log(chalk.red(`Plus de ventes que d'achats actuellement (-20 pts)`));
        }
        
        // Variation de prix récente
        const priceChange5m = currentMarketData.priceChange?.m5 || 0;
        
        if (priceChange5m > 5) {
          rebuyScore += 10; // Hausse rapide
          console.log(chalk.green(`Hausse rapide du prix: +${priceChange5m.toFixed(2)}% en 5min (+10 pts)`));
        } else if (priceChange5m < -5) {
          rebuyScore -= 15; // Baisse rapide
          console.log(chalk.red(`Baisse rapide du prix: ${priceChange5m.toFixed(2)}% en 5min (-15 pts)`));
        }
      }
      
      // Score final (borné entre 0 et 100)
      const finalScore = Math.max(0, Math.min(100, rebuyScore));
      
      // Seuil de décision
      const threshold = 60; // On exige un score plus élevé pour le rachat
      const shouldRebuy = finalScore >= threshold;
      
      console.log(`Score de rachat pour ${tokenInfo.name}: ${finalScore}/100 - ${shouldRebuy ? 'RECOMMANDÉ' : 'NON RECOMMANDÉ'}`);
      
      return {
        score: finalScore,
        rebuyRecommended: shouldRebuy,
        tokenInfo
      };
    }
    
    /**
     * Vérifie les opportunités actuelles sur les tokens précédemment profitables
     * @param {Connection} connection - Connexion Solana
     * @param {Keypair} wallet - Wallet keypair
     */
    async function scanProfitableTokensForRebuy(connection, wallet) {
      console.log(chalk.bgCyan('🔄 Recherche d\'opportunités de rachat sur tokens profitables...'));
      
      // 1. Analyser l'historique des tokens
      const { profitableTokens, unprofitableTokens } = analyzePastProfitableTokens(CONFIG.LOG_FILE_PATH);
      
      // Si aucun token profitable, annuler
      if (Object.keys(profitableTokens).length === 0) {
        console.log(chalk.yellow('Aucun token profitable trouvé dans l\'historique. Attente de nouveaux trades...'));
        return;
      }
      
      // 2. Obtenir la liste des tokens prioritaires
      const priorityTokens = getPriorityRebuyTargets(profitableTokens);
      
      // Limiter aux 5 meilleurs tokens pour économiser les appels API
      const topTokens = priorityTokens.slice(0, 5);
      
      console.log(chalk.blue(`🎯 Évaluation des ${topTokens.length} tokens les plus performants pour rachat`));
      
      // 3. Évaluer chaque token pour le rachat
      const rebuyOpportunities = [];
      
      for (const token of topTokens) {
        try {
          // Obtenir les données actuelles du marché
          const pairInfo = await getPairInformation('solana', token.address);
          if (!pairInfo) {
            console.log(chalk.yellow(`Impossible d'obtenir les données de marché pour ${token.name}`));
            continue;
          }
          
          // Évaluer le potentiel de rachat
          const evaluation = evaluateRebuyPotential(token, pairInfo);
          
          if (evaluation.rebuyRecommended) {
            rebuyOpportunities.push({
              ...evaluation,
              pairInfo
            });
          }
        } catch (error) {
          console.error(`Erreur lors de l'évaluation de ${token.name}:`, error);
        }
        
        // Pause pour éviter la limitation de l'API
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // 4. Trier et exécuter les opportunités de rachat
      if (rebuyOpportunities.length > 0) {
        console.log(chalk.green(`📢 ${rebuyOpportunities.length} opportunités de rachat identifiées`));
        
        // Trier par score (meilleur en premier)
        rebuyOpportunities.sort((a, b) => b.score - a.score);
        
        // Prendre jusqu'à 2 meilleures opportunités
        const bestOpportunities = rebuyOpportunities.slice(0, 2);
        
        for (const opportunity of bestOpportunities) {
          const { tokenInfo, score, pairInfo } = opportunity;
          
          console.log(chalk.bgGreen(`💰 RACHAT: ${tokenInfo.name} - Score: ${score.toFixed(1)}/100, ROI historique: ${tokenInfo.averageROI.toFixed(2)}%`));
          
          // Calculer le montant d'achat (ajusté en fonction du score)
          const baseAmount = await calculateAmountToBuy(connection, wallet);
          
          // Augmenter l'investissement si le score est très élevé
          const investmentMultiplier = score >= 80 ? 1.5 : 1.0;
          const finalAmount = baseAmount * investmentMultiplier;
          
          console.log(`Montant d'investissement: ${finalAmount.toFixed(4)} SOL (${investmentMultiplier}x)`);
          
          // Exécuter l'achat
          await buyToken(
            tokenInfo.address,
            tokenInfo.name + ' 🔄', // Ajouter un marqueur pour indiquer un rachat
            finalAmount,
            connection,
            wallet
          );
          
          // Appliquer une stratégie de vente optimisée pour les rachats
          if (pairInfo) {
            setupRebuyExitStrategy(
              tokenInfo.address,
              tokenInfo.name + ' 🔄',
              pairInfo,
              connection,
              wallet,
              tokenInfo.averageROI
            );
          }
          
          // Pause entre les achats
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      } else {
        console.log(chalk.yellow('Aucune opportunité de rachat trouvée actuellement.'));
      }
    }
    
    /**
     * Configure une stratégie de sortie optimisée pour les rachats
     * @param {string} tokenAddress - Adresse du token
     * @param {string} tokenName - Nom du token
     * @param {Object} pairInfo - Informations sur la paire
     * @param {Connection} connection - Connexion Solana
     * @param {Keypair} wallet - Wallet keypair
     * @param {number} historicalROI - ROI historique moyen
     */
    function setupRebuyExitStrategy(tokenAddress, tokenName, pairInfo, connection, wallet, historicalROI) {
      console.log(chalk.blue(`Configuration de la stratégie de sortie pour ${tokenName}`));
      
      // Obtenir le montant détenu
      getAvailableTokenBalance(tokenAddress, connection, wallet)
        .then(amount => {
          if (amount <= 0) {
            console.log(`Aucun token ${tokenName} détenu.`);
            return;
          }
          
          // Définir la stratégie basée sur le ROI historique
          const strategy = {
            name: "STRATÉGIE RACHAT",
            // Prendre profit à 75% du ROI historique pour sécuriser les gains plus rapidement
            takeProfit: Math.max(10, historicalROI * 0.75),
            // Stop loss serré pour protéger le capital
            stopLoss: -10,
            // Temps de détention plus court
            maxHoldingTimeMinutes: 60,
            // Trailing stop pour capturer les mouvements de prix
            trailingStopActivation: Math.max(5, historicalROI * 0.3),
            trailingStopPercentage: 8,
            // Stratégie de vente progressive
            exitStrategy: [
              { percent: Math.max(5, historicalROI * 0.25), sellPortion: 0.3 },
              { percent: Math.max(10, historicalROI * 0.5), sellPortion: 0.3 },
              { percent: Math.max(15, historicalROI * 0.75), sellPortion: 0.4 }
            ]
          };
          
          console.log(`Stratégie de rachat: TP=${strategy.takeProfit.toFixed(2)}%, SL=${strategy.stopLoss}%, Trailing=${strategy.trailingStopActivation.toFixed(2)}%`);
          
          // Démarrer le monitoring avec cette stratégie
          monitorROI(tokenAddress, tokenName, amount, connection, wallet, strategy);
        })
        .catch(error => {
          console.error(`Erreur lors de la configuration de la stratégie de sortie:`, error);
        });
    }
    
  /**
   * Fonction principale pour détecter et acheter tous les bons tokens
   * @param {Connection} connection - Connexion Solana
   * @param {Keypair} wallet - Wallet keypair
   */
  async function smartTokenTrading(connection, wallet) {
    try {
      console.log(chalk.bgGreen('🚀 Démarrage du système de trading optimisé - ACHAT DE TOUS LES BONS TOKENS'));
      
      // Créer un ensemble pour suivre les tokens achetés pendant cette session
      // afin d'éviter les doubles achats
      const tokensAlreadyPurchased = new Set();
      
      // Nombre maximum de trades autorisés par session (augmenté pour permettre plusieurs achats)
      const MAX_TRADES_PER_SESSION = 20;  // Plus élevé pour permettre d'acheter plusieurs bons tokens
      let tradesExecuted = 0;
      
      // Vérifier le solde disponible
      WALLET_BALANCE = await connection.getBalance(wallet.publicKey) / LAMPORTS_PER_SOL;
      if (WALLET_BALANCE < 0.1) {
        console.log(chalk.yellow('Solde trop faible pour le trading (<0.1 SOL). Passage cette session.'));
        return;
      }
      
      // 1. Analyser l'historique pour identifier les tokens à éviter
      const { profitableTokens, unprofitableTokens } = analyzePastProfitableTokens(CONFIG.LOG_FILE_PATH);
      
      // 2. Vérifier les opportunités de rachat EN PRIORITÉ (si des tokens ont été profitables)
      if (Object.keys(profitableTokens).length > 0) {
        console.log(chalk.bgBlue('🔄 PRIORITÉ: Recherche d\'opportunités de rachat sur tokens profitables'));
        
        // Obtenir les rebuy opportunities
        const rebuyOpportunities = await getRebuyOpportunities(connection, wallet, profitableTokens);
        
        // Si des opportunités existent, acheter TOUTES celles qui sont bonnes
        if (rebuyOpportunities.length > 0) {
          console.log(chalk.green(`📢 ${rebuyOpportunities.length} opportunités de rachat identifiées`));
          
          // Trier par score (meilleur en premier)
          rebuyOpportunities.sort((a, b) => b.score - a.score);
          
          // Acheter jusqu'à MAX_TRADES_PER_SESSION tokens ou jusqu'à la fin des bonnes opportunités
          for (const opportunity of rebuyOpportunities) {
            // Vérifier si nous avons atteint la limite de trades
            if (tradesExecuted >= MAX_TRADES_PER_SESSION) {
              console.log(chalk.yellow(`Limite de ${MAX_TRADES_PER_SESSION} trades par session atteinte.`));
              break;
            }
            
            const { tokenInfo, score, pairInfo } = opportunity;
            
            console.log(chalk.bgGreen(`💰 RACHAT: ${tokenInfo.name} - Score: ${score.toFixed(1)}/100, ROI historique: ${tokenInfo.averageROI.toFixed(2)}%`));
            
            // Calculer le montant d'achat (ajusté en fonction du score)
            const baseAmount = await calculateAmountToBuy(connection, wallet);
            
            // Ajuster le montant d'investissement en fonction du nombre de trades prévus
            // pour éviter d'épuiser le solde
            const remainingTrades = MAX_TRADES_PER_SESSION - tradesExecuted;
            const adjustedBaseAmount = baseAmount / Math.max(1, Math.min(remainingTrades, 3));
            
            // Augmenter l'investissement si le score est très élevé
            const investmentMultiplier = score >= 80 ? 1.5 : 1.0;
            const finalAmount = adjustedBaseAmount * investmentMultiplier;
            
            console.log(`Montant d'investissement: ${finalAmount.toFixed(4)} SOL (${investmentMultiplier}x)`);
            
            // Exécuter l'achat
            const buyResult = await buyToken(
              tokenInfo.address,
              tokenInfo.name + ' 🔄', // Ajouter un marqueur pour indiquer un rachat
              finalAmount,
              connection,
              wallet
            );
            
            if (buyResult.success) {
              // Marquer comme acheté
              tokensAlreadyPurchased.add(tokenInfo.address);
              tradesExecuted++;
              
              // Appliquer une stratégie de vente optimisée pour les rachats
              if (pairInfo) {
                setupRebuyExitStrategy(
                  tokenInfo.address,
                  tokenInfo.name + ' 🔄',
                  pairInfo,
                  connection,
                  wallet,
                  tokenInfo.averageROI
                );
              }
            }
          }
        } else {
          console.log(chalk.yellow('Aucune opportunité de rachat ne répond aux critères actuellement.'));
        }
      }
      
      // 3. Rechercher de nouveaux tokens qui ont un bon potentiel
      if (tradesExecuted < MAX_TRADES_PER_SESSION) {
        console.log(chalk.bgBlue('🔍 Recherche de nouveaux tokens à fort potentiel...'));
        
        // Cache pour éviter de traiter les mêmes tokens plusieurs fois
        const processedTokens = new Set([...tokensAlreadyPurchased]);
        
        // Récupérer les nouveaux pools
        const newPools = await fetchNewPools(connection);
        console.log(`${newPools.length} nouveaux pools détectés`);
        
        // Filtrer les pools
        const viablePools = [];
        
        for (const token of newPools) {
          // Ignorer les tokens non-Solana
          if (token.chainId !== 'solana') continue;
          
          // Ignorer les tokens déjà traités
          if (processedTokens.has(token.tokenAddress)) continue;
          processedTokens.add(token.tokenAddress);
          
          // IMPORTANT: Vérifier si le token a déjà été non rentable dans le passé
          if (isBlacklisted(token.tokenAddress, unprofitableTokens)) {
            console.log(chalk.red(`⛔ Token ${token.tokenAddress} ignoré: historique non rentable`));
            continue;
          }
          
          // Vérifier si le token est dans la liste noire configurée
          if (CONFIG.BLACKLISTED_TOKENS.includes(token.tokenAddress)) {
            console.log(`Token ${token.tokenAddress} ignoré: dans la liste noire`);
            continue;
          }
          
          viablePools.push(token);
        }
        
        console.log(`${viablePools.length} tokens potentiels après filtrage (exclusion des tokens non rentables)`);
        
        // Candidats évalués
        const candidates = [];
        
        // Analyser chaque token potentiel (maximum 15 pour économiser les appels API)
        for (const token of viablePools.slice(0, 15)) {
          try {
            const pairInfo = await getPairInformation('solana', token.tokenAddress);
            if (!pairInfo?.baseToken?.symbol) continue;
            
            const tokenName = pairInfo.baseToken.symbol;
            console.log(`Analyse de: ${tokenName} (${token.tokenAddress})`);
            
            // Évaluer avec une stratégie ROI optimisée
            const evaluation = evaluateTokenROI(pairInfo);
            
            if (evaluation.accepted) {
              candidates.push({
                address: token.tokenAddress,
                name: tokenName,
                score: evaluation.score,
                pairInfo
              });
            }
          } catch (error) {
            console.error(`Erreur lors de l'analyse de ${token.tokenAddress}:`, error);
          }
          
          // Pause entre les analyses
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        // Trier les candidats par score
        candidates.sort((a, b) => b.score - a.score);
        
        console.log(chalk.cyan(`✨ ${candidates.length} nouveaux tokens qualifiés pour achat`));
        
        // Acheter TOUS les candidats valides (jusqu'à la limite MAX_TRADES_PER_SESSION)
        for (const candidate of candidates) {
          // Vérifier si nous avons atteint le maximum de trades
          if (tradesExecuted >= MAX_TRADES_PER_SESSION) {
            console.log(chalk.yellow(`Limite de ${MAX_TRADES_PER_SESSION} trades par session atteinte.`));
            break;
          }
          
          // N'acheter que si nous n'avons pas déjà acheté ce token
          if (!tokensAlreadyPurchased.has(candidate.address)) {
            console.log(chalk.green(`✅ Achat de nouveau token: ${candidate.name} - Score ${candidate.score.toFixed(1)}/100`));
            
            // Calculer le montant à acheter en tenant compte du nombre potentiel de trades
            const baseAmount = await calculateAmountToBuy(connection, wallet);
            const remainingTrades = MAX_TRADES_PER_SESSION - tradesExecuted;
            const adjustedBaseAmount = baseAmount / Math.max(1, Math.min(remainingTrades, 3));
            
            // Exécuter l'achat optimisé
            const buyResult = await buyTokenWithROI(
              candidate.address,
              candidate.name,
              adjustedBaseAmount,
              candidate.score,
              connection,
              wallet
            );
            
            if (buyResult.success) {
              // Marquer comme acheté
              tokensAlreadyPurchased.add(candidate.address);
              tradesExecuted++;
            }
          }
        }
        
        if (candidates.length === 0) {
          console.log(chalk.yellow('Aucun nouveau token ne répond aux critères actuellement.'));
        }
      } else {
        console.log(chalk.blue(`Limite de ${MAX_TRADES_PER_SESSION} trades par session atteinte. Pas de recherche de nouveaux tokens.`));
      }
      
      // Résumé de la session
      console.log(chalk.bgCyan(`📊 RÉSUMÉ DE SESSION: ${tradesExecuted} tokens achetés sur un maximum de ${MAX_TRADES_PER_SESSION}`));
      
    } catch (error) {
      console.error('Erreur critique dans le système de trading intelligent:', error);
    }
    
    // Planifier la prochaine itération
    console.log('Prochaine analyse de trading dans 90 secondes...');
    setTimeout(() => smartTokenTrading(connection, wallet), 90000);
  }
  
  /**
   * Obtient les opportunités de rachat pour les tokens profitables
   * @param {Connection} connection - Connexion Solana
   * @param {Keypair} wallet - Wallet keypair
   * @param {Object} profitableTokens - Tokens ayant généré du profit
   * @returns {Promise<Array>} Liste des opportunités de rachat
   */
  async function getRebuyOpportunities(connection, wallet, profitableTokens) {
    // Obtenir la liste des tokens prioritaires
    const priorityTokens = getPriorityRebuyTargets(profitableTokens);
    
    // Limiter aux 5 meilleurs tokens pour économiser les appels API
    const topTokens = priorityTokens.slice(0, 5);
    
    console.log(chalk.blue(`🎯 Évaluation des ${topTokens.length} tokens les plus performants pour rachat`));
    
    // Évaluer chaque token pour le rachat
    const rebuyOpportunities = [];
    
    for (const token of topTokens) {
      try {
        // Obtenir les données actuelles du marché
        const pairInfo = await getPairInformation('solana', token.address);
        if (!pairInfo) {
          console.log(chalk.yellow(`Impossible d'obtenir les données de marché pour ${token.name}`));
          continue;
        }
        
        // Évaluer le potentiel de rachat
        const evaluation = evaluateRebuyPotential(token, pairInfo);
        
        if (evaluation.rebuyRecommended) {
          rebuyOpportunities.push({
            ...evaluation,
            pairInfo
          });
        }
      } catch (error) {
        console.error(`Erreur lors de l'évaluation de ${token.name}:`, error);
      }
      
      // Pause pour éviter la limitation de l'API
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    return rebuyOpportunities;
  }

/**
 * Fonction principale
 */
async function main() {
  console.log(chalk.bgGreen('=========== Démarrage du Bot de Trading Solana ==========='));
  console.log(`Heure de démarrage: ${new Date().toISOString()}`);

  try {
    // Initialiser la configuration
    CONFIG = initConfig();

    // Clean all logs in debug mode
    cleanAllLogsInDebugMode();

    // Initialize API log file after CONFIG is defined
    initializeApiLogFile();

    // Create and use the logging axios instance for all API calls
    const api = createLoggingAxiosInstance();
    
    // Initialiser le portefeuille et la connexion
    const { WALLET, connection, rpcUrl } = await initializeWallet();

    // NOUVEAU: Configurer les gestionnaires de sortie pour vendre tous les tokens à l'arrêt
    setupExitHandlers(connection, WALLET);
    
    console.log(chalk.green(`Portefeuille: ${WALLET.publicKey.toString()}`));
    console.log(chalk.green(`Connexion RPC: ${rpcUrl}`));
    
    // Vérifier le solde du portefeuille
    WALLET_BALANCE = await connection.getBalance(WALLET.publicKey) / LAMPORTS_PER_SOL;
    console.log(chalk.green(`Solde du portefeuille: ${WALLET_BALANCE} SOL`));

    // Démarrer la surveillance et le trading
    await monitorAndTrade(connection, WALLET);

    // Décommenter l'une de ces stratégies selon vos préférences
    // Démarrer le système de trading intelligent
    // await smartTokenTrading(connection, WALLET);
    // Démarrer le système de trading ROI optimisé
    // await detectAndTradeROI(connection, WALLET);
    

    //console.log(chalk.bgGreen('SYSTÈME DE TRADING INTELLIGENT PRÊT - DÉMARRAGE'));
  
    // Démarrer le système de trading intelligent
    // (n'achète que les tokens profitables, évite les tokens non profitables)
    //await smartTokenTrading(connection, WALLET);

    //console.log(chalk.bgGreen('SYSTÈME ROI OPTIMISÉ PRÊT - DÉMARRAGE DU TRADING'));
  
      // Démarrer le système de trading ROI optimisé
      // await detectAndTradeROI(connection, WALLET);

      } catch (error) {
        console.error(chalk.red(`ERREUR FATALE: ${error.message}`));
    
        // Enregistrer l'erreur dans un fichier journal
        try {
          const errorLog = `[${new Date().toISOString()}] - ${error.stack || error.message}\n`;
          // Use a fallback path if CONFIG isn't initialized yet
          const errorLogPath = CONFIG?.ERROR_LOG_PATH || path.join(process.cwd(), 'logs', 'error_log.txt');
          
          // Ensure the directory exists
          const errorLogDir = path.dirname(errorLogPath);
          if (!fs.existsSync(errorLogDir)) {
            fs.mkdirSync(errorLogDir, { recursive: true });
          }
          
          fs.appendFileSync(errorLogPath, errorLog);
          console.error(chalk.yellow(`L'erreur a été enregistrée dans ${errorLogPath}`));
        } catch (logError) {
          console.error('Impossible d\'enregistrer l\'erreur dans le fichier journal:', logError);
        }
    
        console.error(chalk.red('Tentative de redémarrage automatique dans 60 secondes...'));
        setTimeout(() => process.exit(1), 60000);
      }
  }
      
    
    // Démarrer le bot
main().catch(error => {
  console.error('Erreur non gérée:', error);
  process.exit(1);
});
  
  
  // Démarrage du bot
  //main();