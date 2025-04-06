console.log('api/jupiter.js', '# Jupiter API client');

// src/api/jupiter.js
import { createApiClient, safeApiCall } from './utils.js';
import config from '../config/index.js';
import logger from '../services/logger.js';
import { PublicKey, Transaction } from '@solana/web3.js';

// Create optimized API client
const apiClient = createApiClient({
  baseURL: config.get('JUPITER_API_BASE'),
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  }
});

/**
 * Fetches a quote from Jupiter for token swap
 * @param {Object} params - Quote parameters
 * @returns {Promise<Object>} Quote data
 */
export async function getQuote(params) {
  const { inputMint, outputMint, amount, slippage } = params;
  
  if (!inputMint || !outputMint || !amount) {
    throw new Error('Missing required parameters for Jupiter quote');
  }
  
  logger.debug(`Getting Jupiter quote: ${inputMint} → ${outputMint}, amount: ${amount}`);
  
  try {
    // Build query parameters
    const queryParams = new URLSearchParams({
      inputMint,
      outputMint,
      amount: amount.toString(),
      slippage: (slippage || config.get('SLIPPAGE')).toString(),
      onlyDirectRoutes: 'false',
      asLegacyTransaction: 'false'
    }).toString();
    
    // Make API call with safety wrapper
    const response = await safeApiCall(async () => {
      return await apiClient.get(`/quote?${queryParams}`);
    });
    
    if (!response.data || !response.data.outAmount) {
      throw new Error('Invalid quote response from Jupiter API');
    }
    
    logger.debug(`Quote received: ${amount} → ${response.data.outAmount} (${response.data.otherAmountThreshold} min)`);
    return response.data;
  } catch (error) {
    logger.error(`Jupiter quote error: ${error.message}`);
    throw error;
  }
}

/**
 * Gets swap transaction data from Jupiter
 * @param {Object} quoteResponse - Response from getQuote
 * @param {string} userPublicKey - User's wallet public key
 * @returns {Promise<Object>} Swap transaction
 */
export async function getSwapTransaction(quoteResponse, userPublicKey) {
  if (!quoteResponse || !userPublicKey) {
    throw new Error('Missing required parameters for Jupiter swap transaction');
  }
  
  logger.debug(`Getting swap transaction for ${userPublicKey}`);
  
  try {
    // Make API call with safety wrapper
    const response = await safeApiCall(async () => {
      return await apiClient.post('/swap', {
        quoteResponse,
        userPublicKey
      });
    });
    
    if (!response.data || !response.data.swapTransaction) {
      throw new Error('Invalid swap transaction response from Jupiter API');
    }
    
    logger.debug('Swap transaction received successfully');
    return response.data;
  } catch (error) {
    logger.error(`Jupiter swap transaction error: ${error.message}`);
    throw error;
  }
}

/**
 * Executes a swap via Jupiter API
 * @param {Object} params - Swap parameters
 * @param {Object} connection - Solana connection
 * @param {Object} wallet - Solana wallet keypair
 * @returns {Promise<Object>} Transaction result
 */
export async function executeSwap(params, connection, wallet) {
  const { inputMint, outputMint, amount, slippage } = params;
  
  logger.debug(`Executing Jupiter swap: ${amount} of ${inputMint} → ${outputMint}`);
  
  try {
    // 1. Get swap quote
    const quote = await getQuote({
      inputMint: inputMint.toString(),
      outputMint: outputMint.toString(),
      amount: amount.toString(),
      slippage: slippage || config.get('SLIPPAGE')
    });
    
    // 2. Get swap transaction
    const swapData = await getSwapTransaction(
      quote,
      wallet.publicKey.toString()
    );
    
    // 3. Deserialize and sign transaction
    const transaction = Transaction.from(
      Buffer.from(swapData.swapTransaction, 'base64')
    );
    
    // 4. Add priority fees if configured
    const priorityFee = config.get('PRIORITY_FEE');
    if (priorityFee > 0) {
      logger.debug(`Adding priority fee: ${priorityFee}`);
      // Implementation would depend on specific Solana SDK version
    }
    
    // 5. Set transaction parameters
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = wallet.publicKey;
    
    // 6. Sign the transaction
    transaction.sign(wallet);
    
    // 7. Send and confirm transaction with retry logic
    const signature = await safeApiCall(
      async () => await connection.sendRawTransaction(
        transaction.serialize(),
        {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
          maxRetries: config.get('MAX_RETRIES')
        }
      ),
      {
        retries: 2, // Fewer retries for blockchain submissions
        initialDelay: 2000
      }
    );
    
    logger.debug(`Transaction submitted: ${signature}`);
    
    // 8. Confirm transaction
    const confirmation = await connection.confirmTransaction(signature, 'confirmed');
    
    logger.debug(`Transaction confirmed successfully: ${signature}`);
    
    // 9. Return results
    return {
      success: true,
      signature,
      outputAmount: quote.outAmount,
      inputAmount: amount.toString(),
      inputMint: inputMint.toString(),
      outputMint: outputMint.toString(),
      timestamp: Date.now()
    };
  } catch (error) {
    logger.error(`Jupiter swap error: ${error.message}`);
    
    // Check for scam token signatures
    if (
      error.message.includes('program not executable') || 
      error.message.includes('invalid account owner') ||
      error.message.includes('failed to retrieve')
    ) {
      logger.warn(`Potential scam token detected: ${outputMint}`);
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

export default {
  getQuote,
  getSwapTransaction,
  executeSwap
};