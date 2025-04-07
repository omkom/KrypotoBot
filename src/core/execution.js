/**
 * Trade execution module with optimized blockchain operations
 * 
 * Handles all token purchase and sale operations with advanced error handling,
 * transaction retry logic, and performance optimization
 * 
 * @module execution
 * @requires @solana/web3.js
 * @requires @solana/spl-token
 * @requires ../services/logger
 * @requires ../config/index
 * @requires ../services/errorHandler
 * @requires ../api/jupiter
 * @requires ../api/dexscreener
 */

import { PublicKey, Transaction } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import logger from '../services/logger.js';
import config from '../config/index.js';
import errorHandler, { ErrorSeverity } from '../services/errorHandler.js';
import * as jupiterApi from '../api/jupiter.js';
import { getPairInfo } from '../api/dexscreener.js';

/**
 * Executes token purchase with enhanced error handling and retry logic
 * @param {string} tokenAddress - Token address
 * @param {string} tokenName - Token name/symbol
 * @param {number} amountInSol - Amount to spend in SOL
 * @param {Connection} connection - Solana connection
 * @param {Object} wallet - Wallet keypair
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Purchase result
 */
export async function buyToken(tokenAddress, tokenName, amountInSol, connection, wallet, options = {}) {
  const isDryRun = options.isDryRun || config.get('DRY_RUN');
  logger.debug(`${isDryRun ? '[DRY RUN] ' : ''}Buying ${tokenName} (${tokenAddress}), Amount: ${amountInSol} SOL`);
  
  // Reject if circuit breaker is active for blockchain
  if (errorHandler.isCircuitBroken('blockchain')) {
    return {
      success: false,
      error: 'Blockchain circuit breaker active - try again later',
      tokenAddress,
      tokenName,
      amountInSol
    };
  }
  
  try {
    // Validate input parameters
    if (!tokenAddress || !tokenName || !connection || !wallet) {
      throw new Error('Missing required parameters for token purchase');
    }
    
    // Validate amount
    if (amountInSol <= 0) {
      throw new Error(`Invalid swap amount: ${amountInSol} SOL`);
    }
    
    // Create token mint address
    const tokenMintAddress = new PublicKey(tokenAddress);
    
    // Convert SOL amount to lamports
    const amountInLamports = BigInt(Math.floor(amountInSol * 1_000_000_000));
    
    // For dry run mode, simulate the purchase
    if (isDryRun) {
      return simulatePurchase(tokenAddress, tokenName, amountInSol, connection);
    }
    
    // Real purchase via Jupiter
    logger.trade(`Executing swap: ${amountInSol} SOL -> ${tokenName}`);
    
    // Execute swap with retry logic for transient failures
    const maxRetries = options.maxRetries || config.get('MAX_RETRIES');
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        // Execute swap through Jupiter API
        const result = await jupiterApi.executeSwap({
          inputMint: NATIVE_MINT, // SOL
          outputMint: tokenMintAddress,
          amount: amountInLamports,
          slippage: options.slippage || config.get('SLIPPAGE')
        }, connection, wallet);
        
        if (!result.success) {
          if (result.scamDetected) {
            logger.warn(`Scam token detected for ${tokenName}`);
            // Reset error counter since this is an expected failure
            errorHandler.resetErrorCount('blockchain');
            
            return {
              success: false,
              scamDetected: true,
              tokenAddress,
              tokenName,
              amountInSol
            };
          }
          throw new Error(`Swap failed: ${result.error || 'Unknown error'}`);
        }
        
        // Reset error counter on success
        errorHandler.resetErrorCount('blockchain');
        
        // Calculate tokens received
        const outputAmount = typeof result.outputAmount === 'bigint' ? 
          Number(result.outputAmount) : Number(result.outputAmount || 0);
        
        logger.trade(`Purchase successful! Received ${outputAmount} ${tokenName}`);
        
        return {
          success: true,
          signature: result.signature,
          tokensReceived: outputAmount,
          amountInSol,
          tokenAddress,
          tokenName,
          isDryRun: false,
          timestamp: new Date().toISOString()
        };
      } catch (error) {
        lastError = error;
        
        // Only retry for specific transient errors
        const isRetryable = error.message.includes('timeout') || 
                           error.message.includes('rate limit') ||
                           error.message.includes('network error') ||
                           error.message.includes('connection closed');
                           
        if (isRetryable && attempt <= maxRetries) {
          // Calculate backoff with exponential delay and jitter
          const delay = Math.min(
            1000 * Math.pow(2, attempt - 1) * (0.8 + Math.random() * 0.4),
            15000 // Cap at 15 seconds
          );
          
          logger.warn(`Retrying purchase (${attempt}/${maxRetries}) after ${Math.round(delay)}ms: ${error.message}`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          // Not retryable or out of retries
          break;
        }
      }
    }
    
    // If we get here, all retries failed
    const errResult = errorHandler.handleError(
      lastError, 
      'blockchain',
      ErrorSeverity.HIGH,
      { tokenAddress, tokenName, amountInSol }
    );
    
    return {
      success: false,
      error: lastError.message,
      tokenAddress,
      tokenName,
      amountInSol,
      recovery: errResult.recoverySteps
    };
  } catch (error) {
    errorHandler.handleError(
      error, 
      'trading',
      ErrorSeverity.MEDIUM,
      { tokenAddress, tokenName, amountInSol }
    );
    
    return {
      success: false,
      error: error.message,
      tokenAddress,
      tokenName,
      amountInSol
    };
  }
}

/**
 * Simulates token purchase for dry run mode with realistic price estimations
 * @param {string} tokenAddress - Token address
 * @param {string} tokenName - Token name/symbol
 * @param {number} amountInSol - Amount in SOL
 * @param {Object} connection - Solana connection
 * @returns {Promise<Object>} Simulated purchase result
 */
async function simulatePurchase(tokenAddress, tokenName, amountInSol, connection) {
  // Generate unique signature for tracking
  const mockSignature = `DRY_RUN_BUY_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
  
  try {
    // Try to get real price data for better simulation
    let estimatedTokens = 0;
    let pricePerToken = 0;
    
    // Use real market data when available
    const pairInfo = await getPairInfo('solana', tokenAddress);
    if (pairInfo && pairInfo.priceNative) {
      pricePerToken = parseFloat(pairInfo.priceNative);
      if (pricePerToken > 0) {
        // Apply realistic slippage based on liquidity
        const liquidity = pairInfo.liquidity?.usd || 0;
        let slippageMultiplier = 1.0;
        
        // More slippage for lower liquidity
        if (liquidity < 5000) {
          slippageMultiplier = 0.85; // 15% slippage
        } else if (liquidity < 20000) {
          slippageMultiplier = 0.9; // 10% slippage
        } else if (liquidity < 50000) {
          slippageMultiplier = 0.95; // 5% slippage
        } else {
          slippageMultiplier = 0.98; // 2% slippage
        }
        
        // Apply slippage to effective price
        const effectivePrice = pricePerToken / slippageMultiplier;
        estimatedTokens = amountInSol / effectivePrice;
        
        logger.debug(`[DRY RUN] Market-based estimation: ${estimatedTokens.toFixed(4)} tokens @ ${effectivePrice.toFixed(8)} SOL/token (${(100 - slippageMultiplier * 100).toFixed(1)}% slippage)`);
      }
    }
    
    // Fall back to synthetic estimation if no market data
    if (estimatedTokens === 0 || pricePerToken === 0) {
      // Generate a realistic memecoin price
      pricePerToken = 0.0000001 + (Math.random() * 0.000001);
      estimatedTokens = amountInSol / pricePerToken;
      logger.debug(`[DRY RUN] Synthetic estimation: ${estimatedTokens.toFixed(4)} tokens @ ${pricePerToken.toFixed(8)} SOL/token`);
    }
    
    // Simulate realistic transaction delays
    const networkDelay = 500 + Math.random() * 1500;
    await new Promise(resolve => setTimeout(resolve, networkDelay));
    
    logger.trade(`[DRY RUN] Simulated purchase: ${mockSignature}`);
    logger.trade(`[DRY RUN] Estimated tokens received: ${estimatedTokens.toFixed(2)}`);
    
    return {
      success: true,
      signature: mockSignature,
      tokensReceived: estimatedTokens,
      pricePerToken,
      amountInSol,
      tokenAddress,
      tokenName,
      isDryRun: true,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    logger.error(`[DRY RUN] Error simulating purchase: ${error.message}`);
    
    // Even in simulation, return a standardized error response
    return {
      success: false,
      error: error.message,
      isDryRun: true,
      tokenAddress,
      tokenName,
      amountInSol
    };
  }
}

/**
 * Executes token sale with enhanced error handling and market impact simulation
 * @param {string} tokenAddress - Token address
 * @param {string} tokenName - Token name/symbol
 * @param {number} amount - Amount of tokens to sell
 * @param {Connection} connection - Solana connection
 * @param {Object} wallet - Wallet keypair
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Sale result
 */
export async function sellToken(tokenAddress, tokenName, amount, connection, wallet, options = {}) {
  const isDryRun = options.isDryRun || config.get('DRY_RUN');
  logger.debug(`${isDryRun ? '[DRY RUN] ' : ''}Selling ${amount} ${tokenName} (${tokenAddress})`);
  
  // Reject if circuit breaker is active for blockchain
  if (errorHandler.isCircuitBroken('blockchain')) {
    return {
      success: false,
      error: 'Blockchain circuit breaker active - try again later',
      tokenAddress,
      tokenName,
      amount
    };
  }
  
  try {
    // Validate parameters
    if (!tokenAddress || !tokenName || amount <= 0) {
      throw new Error(`Invalid sale parameters: address=${tokenAddress}, amount=${amount}`);
    }
    
    // For dry run mode, simulate the sale
    if (isDryRun) {
      return simulateSale(tokenAddress, tokenName, amount, connection);
    }
    
    // Create token mint address
    const tokenMintAddress = new PublicKey(tokenAddress);
    
    // Execute swap with retry logic
    const maxRetries = options.maxRetries || config.get('MAX_RETRIES');
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        // Execute swap through Jupiter API (token -> SOL)
        const result = await jupiterApi.executeSwap({
          inputMint: tokenMintAddress,
          outputMint: NATIVE_MINT, // SOL
          amount: BigInt(Math.floor(amount)),
          slippage: options.slippage || config.get('SLIPPAGE')
        }, connection, wallet);
        
        if (!result.success) {
          throw new Error(`Swap failed: ${result.error || 'Unknown error'}`);
        }
        
        // Reset error counter on success
        errorHandler.resetErrorCount('blockchain');
        
        // Calculate SOL received
        const outputAmount = typeof result.outputAmount === 'bigint' ? 
          Number(result.outputAmount) / 1_000_000_000 : // Convert from lamports to SOL
          Number(result.outputAmount || 0) / 1_000_000_000;
        
        logger.trade(`Sale successful! Received ${outputAmount.toFixed(6)} SOL`);
        
        return {
          success: true,
          signature: result.signature,
          solReceived: outputAmount,
          amount,
          tokenAddress,
          tokenName,
          isDryRun: false,
          timestamp: new Date().toISOString()
        };
      } catch (error) {
        lastError = error;
        
        // Only retry for specific transient errors
        const isRetryable = error.message.includes('timeout') || 
                         error.message.includes('rate limit') ||
                         error.message.includes('network error') ||
                         error.message.includes('connection closed');
                           
        if (isRetryable && attempt <= maxRetries) {
          // Calculate backoff with exponential delay and jitter
          const delay = Math.min(
            1000 * Math.pow(2, attempt - 1) * (0.8 + Math.random() * 0.4),
            15000 // Cap at 15 seconds
          );
          
          logger.warn(`Retrying sale (${attempt}/${maxRetries}) after ${Math.round(delay)}ms: ${error.message}`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          // Not retryable or out of retries
          break;
        }
      }
    }
    
    // If we get here, all retries failed
    const errResult = errorHandler.handleError(
      lastError, 
      'blockchain',
      ErrorSeverity.HIGH,
      { tokenAddress, tokenName, amount }
    );
    
    return {
      success: false,
      error: lastError.message,
      tokenAddress,
      tokenName,
      amount,
      recovery: errResult.recoverySteps
    };
  } catch (error) {
    errorHandler.handleError(
      error, 
      'trading',
      ErrorSeverity.MEDIUM,
      { tokenAddress, tokenName, amount }
    );
    
    return {
      success: false,
      error: error.message,
      tokenAddress,
      tokenName,
      amount
    };
  }
}

/**
 * Simulates token sale with realistic price impact modeling
 * @param {string} tokenAddress - Token address
 * @param {string} tokenName - Token name/symbol
 * @param {number} amount - Amount of tokens to sell
 * @param {Connection} connection - Solana connection
 * @returns {Promise<Object>} Simulated sale result
 */
async function simulateSale(tokenAddress, tokenName, amount, connection) {
  // Generate unique signature for tracking
  const mockSignature = `DRY_RUN_SELL_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
  
  try {
    // Get current market data for realistic simulation
    const pairInfo = await getPairInfo('solana', tokenAddress);
    
    let currentPrice = 0;
    let liquidityBase = 0;
    let liquidityQuote = 0;
    let marketImpact = 0;
    let solReceived = 0;
    
    if (pairInfo && pairInfo.priceNative) {
      currentPrice = parseFloat(pairInfo.priceNative);
      liquidityBase = pairInfo.liquidity?.base || 0;
      liquidityQuote = pairInfo.liquidity?.quote || 0;
      
      // Calculate market impact using constant product formula (x*y=k)
      if (liquidityBase > 0 && liquidityQuote > 0) {
        // Use actual pool reserves for calculation
        const k = liquidityBase * liquidityQuote; // Product constant
        const newTokensInPool = liquidityBase + amount; // Tokens after adding sale amount
        const newSolInPool = k / newTokensInPool; // New SOL amount in pool
        solReceived = liquidityQuote - newSolInPool; // SOL received from sale
        
        // Calculate effective price including impact
        const effectivePrice = solReceived / amount;
        marketImpact = ((effectivePrice - currentPrice) / currentPrice) * 100;
        
        logger.debug(`[DRY RUN] Market impact: ${marketImpact.toFixed(2)}%, ` +
                    `Effective price: ${effectivePrice.toFixed(8)} SOL, ` +
                    `Base liquidity: ${liquidityBase}, Quote liquidity: ${liquidityQuote}`);
      } else {
        // Fallback using logarithmic impact model
        const liquidityUsd = pairInfo.liquidity?.usd || 0;
        const saleValueUsd = amount * currentPrice * (pairInfo.priceUsd / pairInfo.priceNative);
        const impactPct = -2 * Math.log10(1 + saleValueUsd / Math.max(liquidityUsd, 1000));
        marketImpact = Math.max(-30, Math.min(0, impactPct)); // Cap between -30% and 0%
        
        solReceived = amount * currentPrice * (1 + marketImpact/100);
        logger.debug(`[DRY RUN] Estimated impact: ${marketImpact.toFixed(2)}%, Sale value: $${saleValueUsd.toFixed(2)}, Liquidity: $${liquidityUsd.toFixed(2)}`);
      }
    } else {
      // No market data, use synthetic estimation
      currentPrice = 0.0000001 + (Math.random() * 0.000001);
      solReceived = amount * currentPrice;
      
      // Generate plausible market impact
      marketImpact = -5 - (Math.random() * 10); // Random impact between -5% and -15%
      solReceived = solReceived * (1 + marketImpact/100); // Apply impact to received amount
      
      logger.debug(`[DRY RUN] Synthetic estimation: ${currentPrice.toFixed(8)} SOL/token with ${marketImpact.toFixed(2)}% impact`);
    }
    
    // Ensure positive SOL received
    solReceived = Math.max(0, solReceived);
    
    // Simulate network delay
    const networkDelay = 500 + Math.random() * 1500;
    await new Promise(resolve => setTimeout(resolve, networkDelay));
    
    logger.trade(`[DRY RUN] Simulated sale: ${mockSignature}`);
    logger.trade(`[DRY RUN] Received ${solReceived.toFixed(6)} SOL with ${marketImpact.toFixed(2)}% market impact`);
    
    return {
      success: true,
      signature: mockSignature,
      solReceived,
      amount,
      tokenAddress,
      tokenName,
      pricePerToken: currentPrice,
      marketImpact,
      isDryRun: true,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    logger.error(`[DRY RUN] Error simulating sale: ${error.message}`);
    
    return {
      success: false,
      error: error.message,
      tokenAddress,
      tokenName,
      amount,
      isDryRun: true
    };
  }
}

/**
 * Optimizes trading parameters based on token analysis
 * @param {Object} analysis - Token analysis result
 * @returns {Object} Optimized trading parameters
 */
export function optimizeTradeParameters(analysis) {
  if (!analysis || !analysis.roi || !analysis.token) {
    logger.warn('Invalid analysis data for parameter optimization');
    // Return default parameters as fallback
    return {
      takeProfitPct: 50,
      stopLossPct: -20,
      trailingStopActivationPct: 20,
      trailingStopDistancePct: 10,
      entryScalePct: 1.0,
      maxHoldTimeMinutes: 60,
      exitStages: [
        { percent: 25, sellPortion: 0.5 },
        { percent: 50, sellPortion: 0.5 }
      ]
    };
  }
  
  // Extract risk and potential scores
  const riskScore = analysis.token.risk?.riskScore || 50;
  const potentialScore = analysis.roi.potentialScore || 50;
  
  // Base parameters adjusted by risk level
  let takeProfitPct, stopLossPct, trailingStopActivationPct, 
      trailingStopDistancePct, entryScalePct, maxHoldTimeMinutes;
  
  // Set parameters based on risk profile
  if (riskScore >= 70) {
    // High risk token - tight stops, higher targets, smaller position
    takeProfitPct = 100;
    stopLossPct = -10;
    trailingStopActivationPct = 30;
    trailingStopDistancePct = 15;
    entryScalePct = 0.6;
    maxHoldTimeMinutes = 30;
  } else if (riskScore >= 50) {
    // Medium-high risk
    takeProfitPct = 75;
    stopLossPct = -15;
    trailingStopActivationPct = 25;
    trailingStopDistancePct = 12;
    entryScalePct = 0.8;
    maxHoldTimeMinutes = 45;
  } else if (riskScore >= 30) {
    // Medium risk - balanced approach
    takeProfitPct = 50;
    stopLossPct = -20;
    trailingStopActivationPct = 20;
    trailingStopDistancePct = 10;
    entryScalePct = 1.0;
    maxHoldTimeMinutes = 60;
  } else {
    // Low risk - wider stops, conservative targets, larger position
    takeProfitPct = 35;
    stopLossPct = -25;
    trailingStopActivationPct = 15;
    trailingStopDistancePct = 8;
    entryScalePct = 1.2;
    maxHoldTimeMinutes = 90;
  }
  
  // Adjust based on potential score
  if (potentialScore >= 80) {
    // Very high potential - more ambitious targets
    takeProfitPct += 25;
    maxHoldTimeMinutes += 30;
  } else if (potentialScore >= 60) {
    // High potential
    takeProfitPct += 15;
    maxHoldTimeMinutes += 15;
  }
  
  // Create exit stages (improved profit taking strategy)
  const exitStages = [];
  
  // For higher potential tokens, use more granular staging
  if (potentialScore >= 70) {
    // High potential - 4-stage exit for maximum profit capture
    exitStages.push({ percent: takeProfitPct * 0.25, sellPortion: 0.2 }); // Sell 20% at 1/4 of target
    exitStages.push({ percent: takeProfitPct * 0.5, sellPortion: 0.3 }); // Sell 30% at 1/2 of target
    exitStages.push({ percent: takeProfitPct * 0.75, sellPortion: 0.3 }); // Sell 30% at 3/4 of target
    exitStages.push({ percent: takeProfitPct, sellPortion: 0.2 }); // Sell final 20% at full target
  } else if (potentialScore >= 50) {
    // Medium potential - 3-stage exit
    exitStages.push({ percent: takeProfitPct * 0.33, sellPortion: 0.3 }); // Sell 30% at 1/3 of target
    exitStages.push({ percent: takeProfitPct * 0.66, sellPortion: 0.3 }); // Sell 30% at 2/3 of target
    exitStages.push({ percent: takeProfitPct, sellPortion: 0.4 }); // Sell final 40% at full target
  } else {
    // Low potential - 2-stage exit for quick profit taking
    exitStages.push({ percent: takeProfitPct * 0.5, sellPortion: 0.5 }); // Sell 50% at half of target
    exitStages.push({ percent: takeProfitPct, sellPortion: 0.5 }); // Sell remaining 50% at full target
  }
  
  // Calculate position size in SOL
  const maxSolPerTrade = config.get('MAX_SOL_PER_TRADE');
  const positionSizeSol = maxSolPerTrade * (analysis.token.tradeable?.optimalPositionPct || 0.7) * entryScalePct;
  
  // Log parameters if in debug mode
  if (config.get('DEBUG')) {
    logger.debug(`Optimized parameters for ${analysis.token.name}:`, {
      risk: riskScore,
      potential: potentialScore,
      takeProfitPct,
      stopLossPct,
      exitStages: exitStages.length,
      positionSizeSol
    });
  }
  
  return {
    token: analysis.token.name,
    address: analysis.token.address,
    takeProfitPct,
    stopLossPct,
    trailingStopActivationPct,
    trailingStopDistancePct,
    entryScalePct,
    positionSizeSol,
    maxHoldTimeMinutes,
    exitStages,
    tradeSummary: {
      riskScore,
      potentialScore,
      tradeableScore: analysis.token.tradeable?.score || 50,
      assessment: analysis.token.tradeable?.assessment || 'Moderate Potential'
    }
  };
}

export default {
  buyToken,
  sellToken,
  optimizeTradeParameters
};