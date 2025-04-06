/**
 * dry-run-helper.js
 * Helper functions for implementing dry run mode in the trading bot
 * 
 * This file contains utility functions that can be imported into index.js
 * to implement the DRY_RUN functionality.
 */

import chalk from 'chalk';
import fs from 'fs';
import path from 'path';

/**
 * Check if the bot is running in dry run mode
 * @returns {boolean} True if in dry run mode
 */
export function isDryRunMode() {
  return process.env.DRY_RUN === 'true';
}

/**
 * Wrapper for the buyToken function to handle dry run mode
 * @param {Function} realBuyFunction - The actual buyToken function
 * @param {Object} params - Parameters passed to the buy function
 * @returns {Promise<Object>} Result object similar to the real function
 */
export async function dryRunBuy(realBuyFunction, params) {
  const { tokenAddress, tokenName, amountInSol, connection, wallet } = params;
  
  if (!isDryRunMode()) {
    // Execute the real buy function if not in dry run mode
    return realBuyFunction(tokenAddress, tokenName, amountInSol, connection, wallet);
  }
  
  console.log(chalk.yellow(`[DRY RUN] Simulating purchase of ${tokenName} (${tokenAddress}) for ${amountInSol} SOL`));
  
  // Generate a mock transaction ID
  const mockSignature = `DRY_RUN_BUY_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
  
  // Simulate delay to make it feel realistic
  await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));
  
  // Estimate tokens received (this is a simplification)
  const estimatedTokens = amountInSol * (1000 + Math.random() * 9000); // Random amount between 1000-10000 per SOL
  
  // Log the simulated purchase
  const buyMetadata = {
    dryRun: true,
    simulationTime: new Date().toISOString(),
    simulatedTokenAmount: estimatedTokens,
    mockSignature
  };
  
  // Call your existing logTokenPurchase function
  try {
    logTokenPurchase(
      tokenAddress,
      tokenName,
      estimatedTokens,
      amountInSol,
      estimatedTokens,
      buyMetadata
    );
  } catch (error) {
    console.error(chalk.red(`Error logging simulated purchase: ${error.message}`));
  }
  
  console.log(chalk.green(`[DRY RUN] Successfully simulated purchase: ${mockSignature}`));
  console.log(chalk.green(`[DRY RUN] Estimated tokens received: ${estimatedTokens.toFixed(2)}`));
  
  return {
    success: true,
    signature: mockSignature,
    tokensReceived: estimatedTokens,
    amountInSol,
    isDryRun: true
  };
}

/**
 * Wrapper for the sellToken function to handle dry run mode
 * @param {Function} realSellFunction - The actual sellToken function
 * @param {Object} params - Parameters passed to the sell function
 * @returns {Promise<Object>} Result object similar to the real function
 */
export async function dryRunSell(realSellFunction, params) {
  const { tokenAddress, tokenName, amount, connection, wallet } = params;
  
  if (!isDryRunMode()) {
    // Execute the real sell function if not in dry run mode
    return realSellFunction(tokenAddress, tokenName, amount, connection, wallet);
  }
  
  console.log(chalk.yellow(`[DRY RUN] Simulating sale of ${amount} ${tokenName} (${tokenAddress})`));
  
  // Generate a mock transaction ID
  const mockSignature = `DRY_RUN_SELL_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
  
  // Simulate delay to make it feel realistic
  await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));
  
  // Get token data from logs to calculate realistic ROI
  const tokenData = getTokenDataFromLogs(tokenAddress, process.env.LOG_FILE_PATH);
  
  let avgBuyPrice = 0;
  let solReceived = 0;
  let roi = 0;
  
  if (tokenData) {
    // Use actual buy price from logs
    avgBuyPrice = tokenData.avgBuyPrice || 0;
    
    // Generate a reasonable sale price (between -30% to +50% of buy price)
    const minPrice = avgBuyPrice * 0.7; // Minimum 30% loss
    const maxPrice = avgBuyPrice * 1.5; // Maximum 50% gain
    const salePrice = minPrice + (Math.random() * (maxPrice - minPrice));
    
    solReceived = amount * salePrice;
    roi = avgBuyPrice > 0 ? ((salePrice - avgBuyPrice) / avgBuyPrice) * 100 : 0;
  } else {
    // If no token data, generate completely random values
    const simulatedValue = amount * (0.0001 + Math.random() * 0.001);
    solReceived = simulatedValue;
    roi = -30 + Math.random() * 80; // Random ROI between -30% and +50%
  }
  
  // Log the simulated sale
  try {
    const sellMetadata = {
      dryRun: true,
      simulationTime: new Date().toISOString(),
      mockSignature
    };
    
    // Call your existing logTokenSale function
    logTokenSale(
      tokenAddress,
      tokenName,
      amount,
      solReceived,
      sellMetadata,
      true // isDryRun
    );
  } catch (error) {
    console.error(chalk.red(`Error logging simulated sale: ${error.message}`));
  }
  
  console.log(chalk.green(`[DRY RUN] Successfully simulated sale: ${mockSignature}`));
  console.log(chalk.green(`[DRY RUN] Received ${solReceived.toFixed(6)} SOL (ROI: ${roi.toFixed(2)}%)`));
  
  return {
    success: true,
    signature: mockSignature,
    tokenAddress,
    tokenName,
    amount,
    solReceived,
    roi,
    isDryRun: true
  };
}

/**
 * Automatically generates simulated trades at regular intervals
 * @param {Object} connection - Solana connection object
 * @param {Object} wallet - Wallet keypair
 */
export function startSimulatedTrading(connection, wallet) {
  if (!isDryRunMode()) {
    return; // Only run in dry run mode
  }
  
  console.log(chalk.yellow('=== Starting Simulated Trading ==='));
  console.log(chalk.yellow('Trades will be simulated at regular intervals'));
  
  // Configuration from env vars with defaults
  const tradeInterval = parseInt(process.env.SIMULATION_TRADE_INTERVAL || '300000', 10); // 5 minutes
  const successRate = parseInt(process.env.SIMULATION_SUCCESS_RATE || '80', 10); // 80%
  const maxRoi = parseInt(process.env.SIMULATION_MAX_ROI || '50', 10); // 50%
  const minRoi = parseInt(process.env.SIMULATION_MIN_ROI || '-30', 10); // -30%
  const maxTokens = parseInt(process.env.SIMULATION_MAX_TOKENS || '10', 10); // Max 10 tokens
  
  // Sample token data for simulation
  const sampleTokens = [
    { address: 'SAMPLE1', name: 'DOGE' },
    { address: 'SAMPLE2', name: 'PEPE' },
    { address: 'SAMPLE3', name: 'SHIB' },
    { address: 'SAMPLE4', name: 'FLOKI' },
    { address: 'SAMPLE5', name: 'BONK' },
    { address: 'SAMPLE6', name: 'WIF' },
    { address: 'SAMPLE7', name: 'CAT' },
    { address: 'SAMPLE8', name: 'MEME' },
    { address: 'SAMPLE9', name: 'CHAD' },
    { address: 'SAMPLE10', name: 'ELON' }
  ];
  
  // Keep track of which tokens we're currently "holding"
  const heldTokens = new Map();
  
  // Function to simulate buying a random token
  const simulateBuy = async () => {
    // Don't buy more tokens than our max
    if (heldTokens.size >= maxTokens) {
      console.log(chalk.yellow(`[SIMULATION] Already holding maximum number of tokens (${maxTokens})`));
      return;
    }
    
    // Pick a random token that we're not already holding
    const availableTokens = sampleTokens.filter(token => !heldTokens.has(token.address));
    if (availableTokens.length === 0) return;
    
    const randomToken = availableTokens[Math.floor(Math.random() * availableTokens.length)];
    const amountInSol = 0.05 + Math.random() * 0.15; // Random amount between 0.05-0.2 SOL
    
    // Simulate the buy
    const buyResult = await dryRunBuy(
      () => {}, // No real function needed in simulation
      {
        tokenAddress: randomToken.address,
        tokenName: randomToken.name,
        amountInSol,
        connection,
        wallet
      }
    );
    
    if (buyResult.success) {
      // Track that we're holding this token
      heldTokens.set(randomToken.address, {
        name: randomToken.name,
        amount: buyResult.tokensReceived,
        buyTime: Date.now()
      });
    }
  };
  
  // Function to simulate selling a random held token
  const simulateSell = async () => {
    if (heldTokens.size === 0) return;
    
    // Pick a random held token
    const heldTokenAddresses = Array.from(heldTokens.keys());
    const randomTokenAddress = heldTokenAddresses[Math.floor(Math.random() * heldTokenAddresses.length)];
    const tokenInfo = heldTokens.get(randomTokenAddress);
    
    // Simulate selling all tokens
    const sellResult = await dryRunSell(
      () => {}, // No real function needed in simulation
      {
        tokenAddress: randomTokenAddress,
        tokenName: tokenInfo.name,
        amount: tokenInfo.amount,
        connection,
        wallet
      }
    );
    
    if (sellResult.success) {
      // Remove from held tokens
      heldTokens.delete(randomTokenAddress);
    }
  };
  
  // Main simulation interval
  const simulationInterval = setInterval(async () => {
    try {
      // Decide whether to buy or sell based on what we're holding
      if (heldTokens.size === 0 || (Math.random() < 0.7 && heldTokens.size < maxTokens)) {
        // If we're not holding anything or with 70% probability, buy
        await simulateBuy();
      } else {
        // Otherwise, sell
        await simulateSell();
      }
      
      // Randomly simulate a sale of a token that has reached take profit/stop loss
      if (heldTokens.size > 0 && Math.random() < 0.3) {
        await simulateSell();
      }
    } catch (error) {
      console.error(chalk.red(`Error in simulation: ${error.message}`));
    }
  }, tradeInterval);
  
  console.log(chalk.green(`Simulation started with interval of ${tradeInterval/1000} seconds`));
  
  // Return a function to stop the simulation
  return () => {
    clearInterval(simulationInterval);
    console.log(chalk.yellow('Simulation stopped'));
  };
}