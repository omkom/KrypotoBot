// src/index.js
import chalk from 'chalk';
import logger from './services/logger.js';
import config from './config/index.js';
import { startBot } from './core/bot.js';

/**
 * Main application entry point with error handling and graceful shutdown
 */
async function main() {
  try {
    console.log(chalk.cyan.bold('=== KryptoBot - Advanced Memecoin Trading Bot ==='));
    logger.info('Starting application...');
    
    // Set up graceful shutdown handler
    setupShutdownHandler();
    
    // Start the trading bot
    const bot = await startBot();
    
    // Store bot control interface for shutdown
    global.botController = bot;
    
    logger.success('Bot initialized and running');
  } catch (error) {
    logger.error('Fatal error in main process', error);
    process.exit(1);
  }
}

/**
 * Sets up graceful shutdown handler to properly close connections
 */
function setupShutdownHandler() {
  let isShuttingDown = false;
  
  const shutdown = async (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    logger.info(`${signal} received. Shutting down gracefully...`);
    
    // Stop the bot if it's running
    if (global.botController && global.botController.stop) {
      global.botController.stop();
    }
    
    // Can add more cleanup logic here as needed
    
    logger.info('Graceful shutdown completed');
    process.exit(0);
  };
  
  // Handle various shutdown signals
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', error);
    shutdown('UNCAUGHT_EXCEPTION');
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason });
    shutdown('UNHANDLED_REJECTION');
  });
}

// Start the application
main().catch(err => {
  console.error(chalk.red('Unhandled error during startup:'), err);
  process.exit(1);
});