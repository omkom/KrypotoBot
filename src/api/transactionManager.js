// src/api/transactionManager.js
import { Connection, Transaction } from '@solana/web3.js';
import logger from '../services/logger.js';
import config from '../config/index.js';
import errorHandler, { ErrorSeverity } from '../services/errorHandler.js';

/**
 * Advanced transaction manager with retry logic, priority fees,
 * transaction monitoring, and error recovery
 */
class TransactionManager {
  /**
   * Initialize transaction manager
   * @param {Connection} connection - Solana connection
   */
  constructor(connection) {
    this.connection = connection;
    this.pendingTransactions = new Map();
    this.maxRetries = config.get('MAX_RETRIES') || 3;
    this.priorityFee = config.get('PRIORITY_FEE') || 0;
    this.lastBlockhash = null;
    this.lastBlockhashTime = 0;
  }
  
  /**
   * Gets current blockhash with caching for performance
   * @returns {Promise<string>} Recent blockhash
   */
  async getRecentBlockhash() {
    // Cache blockhash for 30 seconds to reduce RPC calls
    const now = Date.now();
    if (this.lastBlockhash && now - this.lastBlockhashTime < 30000) {
      return this.lastBlockhash;
    }
    
    try {
      const { blockhash } = await this.connection.getLatestBlockhash('finalized');
      this.lastBlockhash = blockhash;
      this.lastBlockhashTime = now;
      return blockhash;
    } catch (error) {
      logger.error('Failed to get recent blockhash', error);
      throw error;
    }
  }
  
  /**
   * Adds priority fee to transaction if enabled
   * @param {Transaction} transaction - Transaction to modify
   */
  addPriorityFee(transaction) {
    if (!this.priorityFee || this.priorityFee <= 0) return;
    
    try {
      // Implementation depends on Solana SDK version
      // For v1.73+ this would use ComputeBudgetProgram.setComputeUnitPrice
      logger.debug(`Adding priority fee: ${this.priorityFee} micro-lamports/CU`);
      
      // This is just a placeholder - actual implementation depends on SDK version
      // transaction.add(
      //   ComputeBudgetProgram.setComputeUnitPrice({ 
      //     microLamports: this.priorityFee 
      //   })
      // );
    } catch (error) {
      logger.warn(`Failed to add priority fee: ${error.message}`);
    }
  }
  
  /**
   * Sends transaction with advanced retry logic
   * @param {Transaction} transaction - Prepared transaction
   * @param {Array<Keypair>} signers - Signers for the transaction
   * @param {Object} options - Transaction options
   * @returns {Promise<string>} Transaction signature
   */
  async sendTransaction(transaction, signers, options = {}) {
    const maxAttempts = options.maxRetries || this.maxRetries;
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxAttempts + 1; attempt++) {
      try {
        // Get fresh blockhash for retry if needed
        if (attempt > 1 || !transaction.recentBlockhash) {
          const blockhash = await this.getRecentBlockhash();
          transaction.recentBlockhash = blockhash;
        }
        
        // Add priority fees if configured
        if (options.addPriorityFee !== false) {
          this.addPriorityFee(transaction);
        }
        
        // Sign transaction if not already signed
        if (!transaction.signatures || transaction.signatures.length === 0) {
          transaction.sign(...signers);
        }
        
        // Send transaction
        const rawTransaction = transaction.serialize();
        
        // Track start time for latency measurement
        const startTime = Date.now();
        
        // Send with configured options
        const signature = await this.connection.sendRawTransaction(rawTransaction, {
          skipPreflight: options.skipPreflight || false,
          preflightCommitment: options.preflightCommitment || 'confirmed',
          maxRetries: 1 // We handle retries here, not in the RPC
        });
        
        // Log latency for performance monitoring
        logger.debug(`Transaction sent in ${Date.now() - startTime}ms: ${signature}`);
        
        // Track pending transaction for status checks
        this.pendingTransactions.set(signature, {
          signature,
          startTime,
          confirmationTarget: options.confirmationTarget || 'confirmed',
          confirmed: false
        });
        
        // Reset error counter on successful send
        errorHandler.resetErrorCount('blockchain');
        
        return signature;
      } catch (error) {
        lastError = error;
        
        // Only retry specific errors
        const isRetryable = 
          error.message.includes('timeout') || 
          error.message.includes('rate limit') || 
          error.message.includes('block height exceeded') ||
          error.message.includes('blockhash expired') ||
          error.message.includes('preflight failure');
        
        if (isRetryable && attempt <= maxAttempts) {
          // Calculate backoff with exponential delay and jitter
          const delay = Math.min(
            1000 * Math.pow(2, attempt - 1) * (0.8 + Math.random() * 0.4),
            15000 // Cap at 15 seconds
          );
          
          logger.warn(`Transaction attempt ${attempt}/${maxAttempts} failed: ${error.message}. Retrying in ${Math.round(delay)}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          // Not retryable or out of retries
          break;
        }
      }
    }
    
    // All retries failed
    errorHandler.handleError(
      lastError, 
      'blockchain', 
      ErrorSeverity.HIGH, 
      { transaction: transaction.signatures?.map(s => s.signature).filter(Boolean) }
    );
    
    throw lastError;
  }
  
  /**
   * Confirms a transaction and waits for the desired confirmation status
   * @param {string} signature - Transaction signature
   * @param {string} confirmationLevel - Desired confirmation level
   * @returns {Promise<Object>} Confirmation response
   */
  async confirmTransaction(signature, confirmationLevel = 'confirmed') {
    try {
      // Track start time for latency measurement
      const startTime = Date.now();
      
      // Wait for confirmation
      const confirmation = await this.connection.confirmTransaction(
        signature, 
        confirmationLevel
      );
      
      // Log confirmation time for performance monitoring
      const latency = Date.now() - startTime;
      logger.debug(`Transaction confirmed in ${latency}ms: ${signature}`);
      
      // Update tracking
      const pendingTx = this.pendingTransactions.get(signature);
      if (pendingTx) {
        pendingTx.confirmed = true;
        pendingTx.confirmationTime = Date.now();
        pendingTx.confirmationLatency = pendingTx.confirmationTime - pendingTx.startTime;
      }
      
      return confirmation;
    } catch (error) {
      logger.error(`Failed to confirm transaction ${signature}`, error);
      throw error;
    }
  }
  
  /**
   * Sends and confirms a transaction in one step
   * @param {Transaction} transaction - Prepared transaction
   * @param {Array<Keypair>} signers - Signers for the transaction
   * @param {Object} options - Transaction options
   * @returns {Promise<Object>} Transaction result
   */
  async sendAndConfirmTransaction(transaction, signers, options = {}) {
    // Send transaction
    const signature = await this.sendTransaction(transaction, signers, options);
    
    // Confirm transaction
    const confirmation = await this.confirmTransaction(
      signature, 
      options.confirmationTarget || 'confirmed'
    );
    
    return {
      signature,
      confirmation,
      success: true
    };
  }
  
  /**
   * Gets transaction status
   * @param {string} signature - Transaction signature
   * @returns {Promise<Object>} Transaction status
   */
  async getTransactionStatus(signature) {
    try {
      const tx = await this.connection.getTransaction(signature, {
        commitment: 'confirmed'
      });
      
      return {
        signature,
        status: tx ? 'confirmed' : 'pending',
        details: tx
      };
    } catch (error) {
      logger.error(`Failed to get transaction status for ${signature}`, error);
      return {
        signature,
        status: 'unknown',
        error: error.message
      };
    }
  }
  
  /**
   * Gets pending transactions
   * @returns {Array<Object>} Pending transactions
   */
  getPendingTransactions() {
    return Array.from(this.pendingTransactions.values())
      .filter(tx => !tx.confirmed);
  }
}

export default TransactionManager;