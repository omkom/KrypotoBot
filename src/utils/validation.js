console.log('utils/validation.js', '# Data validation');

// src/utils/validation.js
import { PublicKey } from '@solana/web3.js';
import logger from '../services/logger.js';

/**
 * Comprehensive data validation functions for blockchain addresses,
 * transaction parameters, and API data
 */

/**
 * Validates a Solana address
 * @param {string} address - Address to validate
 * @returns {boolean} Whether address is valid
 */
export function isValidSolanaAddress(address) {
  try {
    if (!address) return false;
    
    // Try to create a PublicKey object - will throw if invalid
    new PublicKey(address);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Validates numeric parameters with range checking
 * @param {number} value - Value to validate
 * @param {number} min - Minimum allowed value
 * @param {number} max - Maximum allowed value
 * @param {boolean} allowFloat - Whether to allow floating point
 * @returns {boolean} Whether value is valid
 */
export function isValidNumber(value, min = null, max = null, allowFloat = true) {
  // Check if value is a number
  if (typeof value !== 'number' || isNaN(value)) return false;
  
  // Check if float is disallowed and value has decimal places
  if (!allowFloat && value % 1 !== 0) return false;
  
  // Check range if specified
  if (min !== null && value < min) return false;
  if (max !== null && value > max) return false;
  
  return true;
}

/**
 * Validates token data from API responses
 * @param {Object} tokenData - Token data to validate
 * @returns {Object} Validation result with sanitized data
 */
export function validateTokenData(tokenData) {
  const result = {
    isValid: false,
    errors: [],
    sanitized: {}
  };
  
  // Check for required base properties
  if (!tokenData) {
    result.errors.push('Token data is null or undefined');
    return result;
  }
  
  // Check for required base token properties
  if (!tokenData.baseToken || !tokenData.baseToken.address) {
    result.errors.push('Missing required baseToken information');
    return result;
  }
  
  // Validate address
  if (!isValidSolanaAddress(tokenData.baseToken.address)) {
    result.errors.push(`Invalid token address: ${tokenData.baseToken.address}`);
    return result;
  }
  
  // Start building sanitized object
  result.sanitized = {
    baseToken: {
      address: tokenData.baseToken.address,
      symbol: tokenData.baseToken.symbol || 'Unknown',
      name: tokenData.baseToken.name || tokenData.baseToken.symbol || 'Unknown'
    },
    priceUsd: parseFloat(tokenData.priceUsd || 0),
    priceNative: parseFloat(tokenData.priceNative || 0),
    liquidity: {
      usd: parseFloat(tokenData.liquidity?.usd || 0),
      base: parseFloat(tokenData.liquidity?.base || 0),
      quote: parseFloat(tokenData.liquidity?.quote || 0)
    },
    volume: {
      h24: parseFloat(tokenData.volume?.h24 || 0),
      h6: parseFloat(tokenData.volume?.h6 || 0),
      h1: parseFloat(tokenData.volume?.h1 || 0),
      m5: parseFloat(tokenData.volume?.m5 || 0)
    },
    priceChange: {
      h24: parseFloat(tokenData.priceChange?.h24 || 0),
      h6: parseFloat(tokenData.priceChange?.h6 || 0),
      h1: parseFloat(tokenData.priceChange?.h1 || 0),
      m5: parseFloat(tokenData.priceChange?.m5 || 0)
    },
    txns: {
      h24: {
        buys: parseInt(tokenData.txns?.h24?.buys || 0),
        sells: parseInt(tokenData.txns?.h24?.sells || 0)
      },
      h6: {
        buys: parseInt(tokenData.txns?.h6?.buys || 0),
        sells: parseInt(tokenData.txns?.h6?.sells || 0)
      },
      h1: {
        buys: parseInt(tokenData.txns?.h1?.buys || 0),
        sells: parseInt(tokenData.txns?.h1?.sells || 0)
      },
      m5: {
        buys: parseInt(tokenData.txns?.m5?.buys || 0),
        sells: parseInt(tokenData.txns?.m5?.sells || 0)
      }
    },
    pairCreatedAt: tokenData.pairCreatedAt ? Number(tokenData.pairCreatedAt) : null,
    pairAddress: tokenData.pairAddress || null
  };
  
  // Validation complete successfully
  result.isValid = true;
  return result;
}