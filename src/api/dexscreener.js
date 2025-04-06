console.log('api/dexscreener.js', '# DEXScreener API client');

// src/api/dexscreener.js
import { createApiClient, safeApiCall } from './utils.js';
import config from '../config/index.js';
import logger from '../services/logger.js';

// Create optimized API client
const apiClient = createApiClient({
  baseURL: config.get('DEXSCREENER_API'),
  headers: {
    'Accept': 'application/json',
    'User-Agent': 'KryptoBot/2.0'
  }
});

/**
 * Cache for DEXScreener API responses
 * Improves performance and reduces API calls
 */
const cache = {
  pairs: new Map(),
  tokens: new Map(),
  latest: new Map(),
  
  // Cache TTL in milliseconds
  ttlPairs: 60 * 1000,      // 1 minute for pairs
  ttlTokens: 120 * 1000,    // 2 minutes for tokens
  ttlLatest: 30 * 1000      // 30 seconds for latest listings
};

/**
 * Fetches pair information for a specific token
 * @param {string} chainId - Blockchain ID (e.g., 'solana')
 * @param {string} tokenAddress - Token address
 * @param {Object} options - Request options
 * @returns {Promise<Object>} Token pair information
 */
export async function getPairInfo(chainId, tokenAddress, options = {}) {
  // Normalize token address
  tokenAddress = tokenAddress.toString().trim();
  
  // Create cache key
  const cacheKey = `${chainId}-${tokenAddress}`;
  
  // Check cache unless force refresh requested
  if (!options.force) {
    const cachedData = cache.pairs.get(cacheKey);
    if (cachedData && (Date.now() - cachedData.timestamp < cache.ttlPairs)) {
      logger.debug(`Using cached pair data for ${tokenAddress}`);
      return cachedData.data;
    }
  }
  
  logger.debug(`Fetching pair info for ${tokenAddress} on ${chainId}`);
  
  try {
    // Make API call with safety wrapper
    const response = await safeApiCall(async () => {
      return await apiClient.get(`/pairs/${chainId}/${tokenAddress}`);
    });
    
    if (!response.data || !Array.isArray(response.data.pairs)) {
      logger.warn(`Invalid response format from DEXScreener for ${tokenAddress}`);
      return null;
    }
    
    const pairs = response.data.pairs;
    logger.debug(`Received ${pairs.length} pairs for ${tokenAddress}`);
    
    if (pairs.length === 0) {
      return null;
    }
    
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
      logger.warn(`No valid pairs found for ${tokenAddress}`);
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
    
    logger.debug(`Best pair found for ${tokenAddress}: ${bestPair.pairAddress}`);
    
    // Normalize data structure for consistency
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
    cache.pairs.set(cacheKey, {
      data: normalizedPair,
      timestamp: Date.now()
    });
    
    return normalizedPair;
  } catch (error) {
    logger.error(`Failed to fetch pair info for ${tokenAddress}: ${error.message}`);
    return null;
  }
}

/**
 * Fetches latest token listings
 * @param {string} chainId - Blockchain ID (e.g., 'solana')
 * @param {Object} options - Request options
 * @returns {Promise<Array>} Latest token listings
 */
export async function getLatestTokens(chainId, options = {}) {
  // Create cache key
  const cacheKey = `latest-${chainId}`;
  
  // Check cache unless force refresh requested
  if (!options.force) {
    const cachedData = cache.latest.get(cacheKey);
    if (cachedData && (Date.now() - cachedData.timestamp < cache.ttlLatest)) {
      logger.debug(`Using cached latest tokens for ${chainId}`);
      return cachedData.data;
    }
  }
  
  logger.debug(`Fetching latest tokens for ${chainId}`);
  
  try {
    // Make API call with safety wrapper
    const response = await safeApiCall(async () => {
      return await apiClient.get(`/latest/${chainId}`);
    });
    
    if (!response.data || !Array.isArray(response.data.pairs)) {
      logger.warn(`Invalid response format from DEXScreener latest tokens endpoint`);
      return [];
    }
    
    const pairs = response.data.pairs;
    logger.debug(`Received ${pairs.length} latest pairs for ${chainId}`);
    
    // Filter by minimum requirements
    const filteredPairs = pairs.filter(pair => {
      // Minimum liquidity requirement
      const liquidityUsd = pair.liquidity?.usd || 0;
      if (liquidityUsd < config.get('MIN_LIQUIDITY_USD')) {
        return false;
      }
      
      // Minimum volume requirement
      const volume24h = pair.volume?.h24 || 0;
      if (volume24h < config.get('MIN_VOLUME_24H')) {
        return false;
      }
      
      // Token must have an address
      if (!pair.baseToken?.address) {
        return false;
      }
      
      // Check blacklist
      const blacklistedTokens = config.get('BLACKLISTED_TOKENS');
      if (blacklistedTokens.includes(pair.baseToken.address)) {
        return false;
      }
      
      return true;
    });
    
    logger.debug(`Filtered to ${filteredPairs.length} valid pairs`);
    
    // Cache results
    cache.latest.set(cacheKey, {
      data: filteredPairs,
      timestamp: Date.now()
    });
    
    return filteredPairs;
  } catch (error) {
    logger.error(`Failed to fetch latest tokens for ${chainId}: ${error.message}`);
    return [];
  }
}

/**
 * Clears all caches
 */
export function clearCache() {
  cache.pairs.clear();
  cache.tokens.clear();
  cache.latest.clear();
  logger.debug('DEXScreener API cache cleared');
}

export default {
  getPairInfo,
  getLatestTokens,
  clearCache
};