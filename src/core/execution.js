console.log('core/execution.js', '# Trade execution logic');

// src/core/execution.js
import { PublicKey } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import logger from '../services/logger.js';
import config from '../config/index.js';
import * as jupiterApi from '../api/jupiter.js';

/**
 * Executes token purchase with optimized parameters
 * @param {string} tokenAddress - Token address
 * @param {string} tokenName - Token name/symbol
 * @param {number} amountInSol - Amount to spend in SOL
 * @param {Object} connection - Solana connection
 * @param {Object} wallet - Wallet keypair
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Purchase result
 */
export async function buyToken(tokenAddress, tokenName, amountInSol, connection, wallet, options = {}) {
  const isDryRun = options.isDryRun || config.get('DRY_RUN');
  logger.debug(`${isDryRun ? '[DRY RUN] ' : ''}Buying ${tokenName} (${tokenAddress}), Amount: ${amountInSol} SOL`);
  
  try {
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
    
    if (amountInSol <= 0) {
      throw new Error(`Invalid swap amount: ${amountInSol} SOL`);
    }
    
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
    logger.error(`Error buying ${tokenName}: ${error.message}`);
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
 * Simulates token purchase for dry run mode
 * @param {string} tokenAddress - Token address
 * @param {string} tokenName - Token name/symbol
 * @param {number} amountInSol - Amount in SOL
 * @param {Object} connection - Solana connection
 * @returns {Promise<Object>} Simulated purchase result
 */
async function simulatePurchase(tokenAddress, tokenName, amountInSol, connection) {
  // Generate unique signature for tracking
  const mockSignature = `DRY_RUN_BUY_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
  
  // Try to get real price data for better simulation
  let estimatedTokens = 0;
  let pricePerToken = 0;
  
  try {
    // Import dynamically to avoid circular dependencies
    const { getPairInfo } = await import('../api/dexscreener.js');
    
    const pairInfo = await getPairInfo('solana', tokenAddress);
    if (pairInfo && pairInfo.priceNative) {
      pricePerToken = parseFloat(pairInfo.priceNative);
      if (pricePerToken > 0) {
        estimatedTokens = amountInSol / pricePerToken;
        logger.debug(`[DRY RUN] Estimation based on market: ${estimatedTokens.toFixed(4)} tokens @ ${pricePerToken} SOL/token`);
      }
    }
  } catch (error) {
    logger.debug(`[DRY RUN] Error getting price data: ${error.message}`);
  }
  
  // If no real data available, use a reasonable estimation
  if (estimatedTokens === 0 || pricePerToken === 0) {
    // Estimate based on typical memecoin prices
    pricePerToken = 0.0000001 + (Math.random() * 0.000001);
    estimatedTokens = amountInSol / pricePerToken;
    logger.debug(`[DRY RUN] Arbitrary estimation: ${estimatedTokens.toFixed(4)} tokens @ ${pricePerToken} SOL/token`);
  }
  
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));
  
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
}

/**
 * Executes token sale with optimized parameters
 * @param {string} tokenAddress - Token address
 * @param {string} tokenName - Token name/symbol
 * @param {number} amount - Amount of tokens to sell
 * @param {Object} connection - Solana connection
 * @param {Object} wallet - Wallet keypair
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Sale result
 */
export async function sellToken(tokenAddress, tokenName, amount, connection, wallet, options = {}) {
  const isDryRun = options.isDryRun || config.get('DRY_RUN');
  logger.debug(`${isDryRun ? '[DRY RUN] ' : ''}Selling ${amount} ${tokenName} (${tokenAddress})`);
  
  try {
    // For dry run mode, simulate the sale
    if (isDryRun) {
      return simulateSale(tokenAddress, tokenName, amount, connection);
    }
    
    // Create token mint address
    const tokenMintAddress = new PublicKey(tokenAddress);
    
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
    logger.error(`Error selling ${tokenName}: ${error.message}`);
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
 * Simulates token sale for dry run mode with realistic price impact
 * @param {string} tokenAddress - Token address
 * @param {string} tokenName - Token name/symbol
 * @param {number} amount - Amount of tokens to sell
 * @param {Object} connection - Solana connection
 * @returns {Promise<Object>} Simulated sale result
 */
async function simulateSale(tokenAddress, tokenName, amount, connection) {
  // Generate unique signature for tracking
  const mockSignature = `DRY_RUN_SELL_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
  
  try {
    // Import needed modules dynamically
    const { getPairInfo } = await import('../api/dexscreener.js');
    
    // Get current market data
    const pairInfo = await getPairInfo('solana', tokenAddress);
    let currentPrice = 0;
    let liquidityBase = 0;
    let liquidityQuote = 0;
    let exactMarketImpact = 0;
    let solReceived = 0;
    
    if (pairInfo && pairInfo.priceNative) {
      currentPrice = parseFloat(pairInfo.priceNative);
      liquidityBase = pairInfo.liquidity?.base || 0;
      liquidityQuote = pairInfo.liquidity?.quote || 0;
      
      // Calculate impact using constant product formula (x*y=k)
      if (liquidityBase > 0 && liquidityQuote > 0) {
        const k = liquidityBase * liquidityQuote; // product constant
        const newTokensInPool = liquidityBase + amount; // tokens after sale
        const newSolInPool = k / newTokensInPool; // new SOL amount in pool
        solReceived = liquidityQuote - newSolInPool; // SOL you would receive
        
        // Calculate price impact percentage
        const effectivePrice = solReceived / amount;
        exactMarketImpact = ((effectivePrice - currentPrice) / currentPrice) * 100;
        
        logger.debug(`[DRY RUN] Market impact: ${exactMarketImpact.toFixed(2)}%, ` +
                    `Effective price: ${effectivePrice.toFixed(8)} SOL`);
      } else {
        // Fallback if we can't calculate exact impact
        const impactPercentage = Math.min(-2, -2 * Math.log10(amount / 100000)); // Logarithmic impact model
        solReceived = amount * currentPrice * (1 + impactPercentage/100);
        exactMarketImpact = impactPercentage;
        
        logger.debug(`[DRY RUN] Estimated market impact: ${impactPercentage.toFixed(2)}%`);
      }
    } else {
      // No market data available, use reasonable estimate
      currentPrice = 0.0000001 + (Math.random() * 0.000001);
      solReceived = amount * currentPrice;
      exactMarketImpact = -5 - (Math.random() * 10); // Random impact between -5% and -15%
      
      logger.debug(`[DRY RUN] No market data, using estimate: ${currentPrice} SOL/token`);
    }
    
    // Ensure positive SOL received
    solReceived = Math.max(0, solReceived);
    
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));
    
    logger.trade(`[DRY RUN] Simulated sale: ${mockSignature}`);
    logger.trade(`[DRY RUN] Received ${solReceived.toFixed(6)} SOL`);
    
    return {
      success: true,
      signature: mockSignature,
      solReceived,
      amount,
      tokenAddress,
      tokenName,
      pricePerToken: currentPrice,
      marketImpact: exactMarketImpact,
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
  const { risk, potential, tradeable } = analysis;
  
  // Default parameters
  const defaults = {
    takeProfitPct: 50,
    stopLossPct: -20,
    trailingStopActivationPct: 20,
    trailingStopDistancePct: 10,
    entryScalePct: 1.0, // 100% of calculated position size
    maxHoldTimeMinutes: 60
  };
  
  // Adjust based on risk profile
  let takeProfitPct = defaults.takeProfitPct;
  let stopLossPct = defaults.stopLossPct;
  let trailingStopActivationPct = defaults.trailingStopActivationPct;
  let trailingStopDistancePct = defaults.trailingStopDistancePct;
  let entryScalePct = defaults.entryScalePct;
  let maxHoldTimeMinutes = defaults.maxHoldTimeMinutes;
  
  // Higher risk requires larger profit target and tighter stop loss
  if (risk.riskScore >= 70) {
    // High risk token
    takeProfitPct = 100; // Need higher reward for the risk
    stopLossPct = -10; // Tighter stop loss
    trailingStopActivationPct = 30;
    trailingStopDistancePct = 15;
    entryScalePct = 0.6; // Reduce position size
    maxHoldTimeMinutes = 30;
  } else if (risk.riskScore >= 50) {
    // Medium-high risk
    takeProfitPct = 75;
    stopLossPct = -15;
    trailingStopActivationPct = 25;
    trailingStopDistancePct = 12;
    entryScalePct = 0.8;
    maxHoldTimeMinutes = 45;
  } else if (risk.riskScore >= 30) {
    // Medium risk
    takeProfitPct = 50;
    stopLossPct = -20;
    trailingStopActivationPct = 20;
    trailingStopDistancePct = 10;
    entryScalePct = 1.0;
    maxHoldTimeMinutes = 60;
  } else {
    // Low risk
    takeProfitPct = 35;
    stopLossPct = -25;
    trailingStopActivationPct = 15;
    trailingStopDistancePct = 8;
    entryScalePct = 1.2;
    maxHoldTimeMinutes = 90;
  }
  
  // Adjust based on potential score
  if (potential.potentialScore >= 80) {
    // Very high potential - set more ambitious targets
    takeProfitPct += 25;
    maxHoldTimeMinutes += 30;
  } else if (potential.potentialScore >= 60) {
    // High potential
    takeProfitPct += 15;
    maxHoldTimeMinutes += 15;
  }
  
  // Calculate optimal exit stages
  const exitStages = [];
  
  // For higher potential tokens, use staged profit taking
  if (potential.potentialScore >= 60) {
    exitStages.push({ percent: takeProfitPct * 0.25, sellPortion: 0.2 }); // Sell 20% at 1/4 of take profit
    exitStages.push({ percent: takeProfitPct * 0.5, sellPortion: 0.3 }); // Sell 30% at 1/2 of take profit
    exitStages.push({ percent: takeProfitPct * 0.75, sellPortion: 0.3 }); // Sell 30% at 3/4 of take profit
    exitStages.push({ percent: takeProfitPct, sellPortion: 0.2 }); // Sell final 20% at full take profit
  } else {
    exitStages.push({ percent: takeProfitPct * 0.5, sellPortion: 0.5 }); // Sell 50% at half take profit
    exitStages.push({ percent: takeProfitPct, sellPortion: 0.5 }); // Sell remaining 50% at full take profit
  }
  
  // Calculate actual position size in SOL based on max allocation and risk
  const maxSolPerTrade = config.get('MAX_SOL_PER_TRADE');
  const positionSizeSol = maxSolPerTrade * tradeable.optimalPositionPct * entryScalePct;
  
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
      riskScore: risk.riskScore,
      potentialScore: potential.potentialScore,
      tradeableScore: tradeable.score,
      assessment: tradeable.assessment
    }
  };
}

export default {
  buyToken,
  sellToken,
  optimizeTradeParameters
};