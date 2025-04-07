/**
 * KryptoBot - Advanced Solana Memecoin Trading System
 * 
 * High-performance trading bot for automated detection and trading of promising
 * memecoin tokens on Solana blockchain with advanced risk management and profit
 * optimization strategies.
 * 
 * @version 2.0.0
 */

import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import dotenv from 'dotenv';

// Core bot engine
import { startBot, stopBot } from './src/core/bot.js';
import logger from './src/services/logger.js';
import config from './src/config/index.js';
import errorHandler, { ErrorSeverity } from './src/services/errorHandler.js';
//import * as metrics from './src/services/metrics.js';

// Global shutdown flag
let isShuttingDown = false;

/**
 * Initializes configuration, displays startup banner and launches the bot
 */
async function main() {
  try {
    // Load environment variables
    dotenv.config();
    
    // Print welcome banner
    displayBanner();
    
    // Initialize configuration from environment variables
    await initializeConfig();
    
    // Set up exit handlers for graceful shutdown
    setupExitHandlers();
    
    // Start the bot
    const bot = await startBot();
    
    // Store bot controller globally for shutdown access
    global.botController = bot;
    
    logger.success('KryptoBot started successfully');
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

/**
 * Displays a colorful startup banner
 */
function displayBanner() {
  console.log(chalk.cyan.bold('============================================='));
  console.log(chalk.cyan.bold('            KryptoBot v2.0.0                '));
  console.log(chalk.cyan.bold('   Solana Memecoin Trading Bot              '));
  console.log(chalk.cyan.bold('============================================='));
}

/**
 * Initializes the configuration and ensures required directories exist
 */
async function initializeConfig() {
  console.log(chalk.blue('Loading configuration...'));

  // Determine environment
  const env = process.env.ENV || 'prod';
  const isDryRun = process.env.DRY_RUN === 'true';
  
  // Set up log directories
  const logDir = path.dirname(config.get('LOG_FILE_PATH'));
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
    console.log(chalk.green(`Log directory created: ${logDir}`));
  }
  
  // Display runtime configuration
  console.log(chalk.bgBlue(`Mode: ${env}, ${isDryRun ? '(DRY RUN)' : '(PRODUCTION)'}`));
  console.log(chalk.bgBlue(`RPC: ${config.get('SOLANA_RPC')}`));
  console.log(chalk.bgBlue(`Trading parameters: Slippage: ${config.get('SLIPPAGE')}%, Max per trade: ${config.get('MAX_SOL_PER_TRADE')} SOL`));
  console.log(chalk.bgBlue(`Strategy: TP: ${config.get('TAKE_PROFIT')}%, SL: ${config.get('STOP_LOSS')}%`));
  
  // Save instance info to file for analysis
  const instanceInfo = {
    id: config.get('INSTANCE_ID') || 'default',
    strategy: process.env.STRATEGY_ID || 'default',
    startTime: new Date().toISOString(),
    parameters: {
      SLIPPAGE: process.env.SLIPPAGE || '2',
      MAX_SOL_PER_TRADE: process.env.MAX_SOL_PER_TRADE || '0.1',
      RISK_PERCENTAGE: process.env.RISK_PERCENTAGE || '0.03',
      MIN_LIQUIDITY_USD: process.env.MIN_LIQUIDITY_USD || '10000',
      TAKE_PROFIT: process.env.TAKE_PROFIT || '25',
      STOP_LOSS: process.env.STOP_LOSS || '-20',
    }
  };
  
  const instanceInfoPath = path.join(logDir, 'instance_info.json');
  fs.writeFileSync(instanceInfoPath, JSON.stringify(instanceInfo, null, 2));
}

/**
 * Sets up signal handlers for graceful shutdown
 */
function setupExitHandlers() {
  let isExiting = false;
  
  async function handleExit(signal) {
    // Prevent multiple exit handlers from running simultaneously
    if (isExiting) return;
    isExiting = true;
    isShuttingDown = true;
    
    logger.warn(`\n\n${signal} signal received. Starting graceful shutdown...`);
    
    try {
      // Access bot controller to stop bot
      if (global.botController) {
        await global.botController.stop();
      } else {
        await stopBot(); // Fallback shutdown
      }
      
      logger.success('Graceful shutdown completed');
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
  
  logger.info('Exit handlers registered - the bot will manage graceful shutdown');
}

// Start the bot
main().catch(err => {
  console.error(chalk.red('Fatal Error:'), err);
  process.exit(1);
});