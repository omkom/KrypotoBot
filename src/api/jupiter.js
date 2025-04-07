// src/api/jupiter.js
import { PublicKey, Transaction } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import axios from 'axios';
import logger from '../services/logger.js';
import config from '../config/index.js';
import errorHandler, { ErrorSeverity } from '../services/errorHandler.js';
import { validateTransactionParams } from '../utils/validation.js';
import chalk from 'chalk';

// Créer un client API optimisé pour Jupiter
const apiClient = axios.create({
  baseURL: config.get('JUPITER_API_BASE') || 'https://quote-api.jup.ag/v6',
  timeout: config.get('API_TIMEOUT') || 15000,
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  }
});

// Cache pour les routes de swap (réduit les appels API redondants)
const routeCache = {
  items: new Map(),
  ttl: 30000, // 30 secondes de validité pour le cache
  
  /**
   * Récupère une route depuis le cache
   * @param {string} key - Clé de cache (combinaison tokenIn-tokenOut-amount-slippage)
   * @returns {Object|null} Données de route ou null si absentes/expirées
   */
  get(key) {
    const item = this.items.get(key);
    if (!item) return null;
    
    // Vérifier si l'entrée est expirée
    if (Date.now() > item.expiry) {
      this.items.delete(key);
      return null;
    }
    
    return item.data;
  },
  
  /**
   * Ajoute une route au cache
   * @param {string} key - Clé de cache
   * @param {Object} data - Données de route
   * @param {number} customTtl - TTL personnalisé en ms (optionnel)
   */
  set(key, data, customTtl) {
    const ttl = customTtl || this.ttl;
    this.items.set(key, {
      data,
      expiry: Date.now() + ttl
    });
    
    // Nettoyage automatique des entrées expirées si le cache dépasse 50 entrées
    if (this.items.size > 50) {
      this.cleanup();
    }
  },
  
  /**
   * Nettoie les entrées expirées du cache
   */
  cleanup() {
    const now = Date.now();
    for (const [key, item] of this.items.entries()) {
      if (now > item.expiry) {
        this.items.delete(key);
      }
    }
  }
};

/**
 * Effectue un appel API avec retry intelligent en cas d'échec
 * @param {Function} apiCall - Fonction d'appel API à exécuter
 * @param {Object} options - Options de retry
 * @returns {Promise<Object>} Résultat de l'appel API
 */
async function callWithRetry(apiCall, options = {}) {
  const {
    retries = config.get('MAX_RETRIES') || 3,
    retryDelay = 1000,
    retryableErrors = [429, 503, 504, 'ECONNABORTED', 'ETIMEDOUT', 'Network Error'],
    operationName = 'API Call'
  } = options;
  
  let attempt = 0;
  let lastError = null;
  
  while (attempt <= retries) {
    try {
      if (config.get('DEBUG') && attempt > 0) {
        logger.debug(`${operationName}: tentative ${attempt}/${retries}`);
      }
      
      // Exécuter l'appel API
      return await apiCall();
    } catch (error) {
      lastError = error;
      
      // Déterminer si l'erreur est retryable
      const statusCode = error.response?.status;
      const errorMessage = error.message || '';
      const isRetryable = 
        retryableErrors.includes(statusCode) || 
        retryableErrors.some(err => typeof err === 'string' && errorMessage.includes(err));
      
      if (!isRetryable || attempt >= retries) {
        break; // Sortir de la boucle si non retryable ou plus de tentatives
      }
      
      // Calculer le délai exponentiel avec jitter pour éviter les tempêtes de retry
      const jitterFactor = 0.8 + Math.random() * 0.4; // 0.8-1.2 (±20%)
      const backoffDelay = Math.min(
        retryDelay * Math.pow(2, attempt) * jitterFactor,
        30000 // Max 30 secondes
      );
      
      logger.warn(
        `${operationName} échec (${statusCode || errorMessage}). ` +
        `Retry dans ${Math.round(backoffDelay)}ms (${attempt + 1}/${retries})`
      );
      
      // Attendre le délai de backoff
      await new Promise(resolve => setTimeout(resolve, backoffDelay));
      
      attempt++;
    }
  }
  
  // Toutes les tentatives ont échoué
  throw lastError;
}

/**
 * Récupère un devis pour un échange de tokens
 * @param {Object} params - Paramètres du devis
 * @param {string} params.inputMint - Mint address du token d'entrée
 * @param {string} params.outputMint - Mint address du token de sortie
 * @param {string|number|bigint} params.amount - Montant du token d'entrée
 * @param {number} params.slippage - Slippage toléré en pourcentage
 * @param {Object} options - Options supplémentaires
 * @returns {Promise<Object>} Données du devis
 */
export async function getQuote(params, options = {}) {
  // Valider les paramètres obligatoires
  if (!params.inputMint || !params.outputMint || !params.amount) {
    throw new Error('Paramètres requis manquants pour le devis Jupiter');
  }
  
  // Convertir les PublicKey en string si nécessaire
  const inputMint = params.inputMint instanceof PublicKey 
    ? params.inputMint.toString() 
    : params.inputMint;
    
  const outputMint = params.outputMint instanceof PublicKey 
    ? params.outputMint.toString() 
    : params.outputMint;
  
  // Convertir le montant en string
  const amount = params.amount.toString();
  
  // Construire la clé de cache
  const cacheKey = `${inputMint}-${outputMint}-${amount}-${params.slippage || config.get('SLIPPAGE')}`;
  
  // Vérifier le cache si activé
  if (!options.skipCache) {
    const cachedRoute = routeCache.get(cacheKey);
    if (cachedRoute) {
      if (config.get('DEBUG')) {
        logger.debug(`Utilisation d'une route en cache pour ${inputMint} → ${outputMint}`);
      }
      return cachedRoute;
    }
  }
  
  if (config.get('DEBUG')) {
    logger.debug(`Récupération d'un devis Jupiter: ${inputMint} → ${outputMint}, montant: ${amount}`);
  }
  
  try {
    // Construire les paramètres de requête
    const queryParams = new URLSearchParams({
      inputMint,
      outputMint,
      amount,
      slippage: (params.slippage || config.get('SLIPPAGE')).toString(),
      onlyDirectRoutes: params.onlyDirectRoutes || 'false',
      asLegacyTransaction: params.asLegacyTransaction || 'false'
    }).toString();
    
    // Effectuer l'appel API avec retry intelligent
    const response = await callWithRetry(
      async () => await apiClient.get(`/quote?${queryParams}`),
      { operationName: 'Jupiter Quote' }
    );
    
    // Valider la réponse
    if (!response.data || !response.data.outAmount) {
      throw new Error('Réponse de devis invalide depuis l\'API Jupiter');
    }
    
    // Mettre en cache le résultat
    if (!options.skipCache) {
      routeCache.set(cacheKey, response.data);
    }
    
    // Afficher les infos de devis en mode DEBUG
    if (config.get('DEBUG')) {
      const outAmount = BigInt(response.data.outAmount);
      const inAmount = BigInt(amount);
      
      logger.debug(
        `Devis reçu: ${amount} → ${response.data.outAmount} ` +
        `(min: ${response.data.otherAmountThreshold})`
      );
    }
    
    return response.data;
  } catch (error) {
    // Gérer l'erreur avec notre système avancé
    const handled = errorHandler.handleError(
      error,
      'api',
      ErrorSeverity.MEDIUM,
      { operation: 'jupiter-quote', params }
    );
    
    logger.error(`Erreur lors de la récupération du devis Jupiter: ${error.message}`);
    throw error;
  }
}

/**
 * Récupère les données de transaction d'échange depuis Jupiter
 * @param {Object} quoteResponse - Réponse de getQuote
 * @param {string} userPublicKey - Clé publique de l'utilisateur
 * @returns {Promise<Object>} Données de transaction d'échange
 */
export async function getSwapTransaction(quoteResponse, userPublicKey) {
  if (!quoteResponse || !userPublicKey) {
    throw new Error('Paramètres requis manquants pour la transaction d\'échange Jupiter');
  }
  
  try {
    // Normaliser userPublicKey en string
    const userPubKeyStr = userPublicKey instanceof PublicKey 
      ? userPublicKey.toString() 
      : userPublicKey;
    
    if (config.get('DEBUG')) {
      logger.debug(`Récupération de la transaction d'échange pour ${userPubKeyStr}`);
    }
    
    // Effectuer l'appel API avec retry intelligent
    const response = await callWithRetry(
      async () => await apiClient.post('/swap', {
        quoteResponse,
        userPublicKey: userPubKeyStr
      }),
      { 
        operationName: 'Jupiter Swap Transaction',
        retries: 2 // Moins de retries pour éviter les variations de prix
      }
    );
    
    // Valider la réponse
    if (!response.data || !response.data.swapTransaction) {
      throw new Error('Réponse de transaction invalide depuis l\'API Jupiter');
    }
    
    return response.data;
  } catch (error) {
    // Gérer l'erreur avec notre système avancé
    const handled = errorHandler.handleError(
      error,
      'api',
      ErrorSeverity.MEDIUM,
      { operation: 'jupiter-swap-transaction', quoteId: quoteResponse.id, userPublicKey }
    );
    
    logger.error(`Erreur lors de la récupération de la transaction d'échange Jupiter: ${error.message}`);
    throw error;
  }
}

/**
 * Ajoute des frais de priorité à une transaction
 * @param {Transaction} transaction - Transaction Solana
 * @param {number} priorityFee - Frais de priorité en microlamports par unité de calcul
 * @returns {Transaction} Transaction avec frais de priorité
 */
export function addPriorityFees(transaction, priorityFee) {
  try {
    if (!priorityFee || priorityFee <= 0) return transaction;
    
    if (config.get('DEBUG')) {
      logger.debug(`Ajout de frais de priorité: ${priorityFee} microlamports/CU`);
    }
    
    // Note: L'implémentation dépend de la version du SDK Solana
    // Pour v1.73+, utiliser ComputeBudgetProgram.setComputeUnitPrice
    
    // Placeholder pour l'implémentation
    /*
    // Import depuis @solana/web3.js
    import { ComputeBudgetProgram } from '@solana/web3.js';
    
    // Ajouter l'instruction de frais de priorité
    transaction.add(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: priorityFee
      })
    );
    */
    
    // Forwarder la transaction telle quelle
    return transaction;
  } catch (error) {
    logger.warn(`Échec de l'ajout des frais de priorité: ${error.message}`);
    return transaction;
  }
}

/**
 * Exécute un échange via l'API Jupiter
 * @param {Object} params - Paramètres d'échange
 * @param {Object} connection - Connexion Solana
 * @param {Object} wallet - Wallet Solana (keypair)
 * @returns {Promise<Object>} Résultat de la transaction
 */
export async function executeSwap(params, connection, wallet) {
  try {
    const { inputMint, outputMint, amount, slippage } = params;
    
    if (config.get('DEBUG')) {
      logger.debug(`Exécution d'un échange Jupiter: ${amount} de ${inputMint} → ${outputMint}`);
    }
    
    // 1. Obtenir le devis d'échange
    const quote = await getQuote({
      inputMint: inputMint.toString(),
      outputMint: outputMint.toString(),
      amount: amount.toString(),
      slippage: slippage || config.get('SLIPPAGE')
    });
    
    // 2. Obtenir la transaction d'échange
    const swapData = await getSwapTransaction(
      quote,
      wallet.publicKey.toString()
    );
    
    // 3. Désérialiser et signer la transaction
    const transaction = Transaction.from(
      Buffer.from(swapData.swapTransaction, 'base64')
    );
    
    // 4. Ajouter des frais de priorité si configurés
    const priorityFee = config.get('PRIORITY_FEE');
    if (priorityFee > 0) {
      addPriorityFees(transaction, priorityFee);
    }
    
    // 5. Configurer les paramètres de transaction
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = wallet.publicKey;
    
    // 6. Signer la transaction
    transaction.sign(wallet);
    
    // 7. Envoyer et confirmer la transaction avec logique de retry
    const signature = await callWithRetry(
      async () => await connection.sendRawTransaction(
        transaction.serialize(),
        {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
          maxRetries: config.get('MAX_RETRIES')
        }
      ),
      {
        operationName: 'Blockchain Transaction',
        retries: 2, // Moins de retries pour les soumissions blockchain
        initialDelay: 2000
      }
    );
    
    if (config.get('DEBUG')) {
      logger.debug(`Transaction soumise: ${signature}`);
    }
    
    // 8. Confirmer la transaction
    const confirmation = await connection.confirmTransaction(signature, 'confirmed');
    
    logger.debug(`Transaction confirmée avec succès: ${signature}`);
    
    // 9. Retourner les résultats
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
    // Gérer l'erreur avec notre système avancé
    errorHandler.handleError(
      error,
      'blockchain',
      ErrorSeverity.HIGH,
      { operation: 'jupiter-execute-swap', params }
    );
    
    logger.error(`Erreur d'échange Jupiter: ${error.message}`);
    
    // Vérifier les signatures de token frauduleux
    if (
      error.message.includes('program not executable') || 
      error.message.includes('invalid account owner') ||
      error.message.includes('failed to retrieve')
    ) {
      logger.warn(`Token potentiellement frauduleux détecté: ${params.outputMint}`);
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
 * Récupère les routes d'échange disponibles
 * @param {Object} params - Paramètres de route
 * @returns {Promise<Array>} Routes disponibles
 */
export async function getRoutes(params) {
  // Implémentation similaire à getQuote, mais avec endpoint routes
  // Non implémenté pour l'instant car non utilisé par le core
  throw new Error("Function not implemented");
}

/**
 * Calcule l'impact de prix pour un échange
 * @param {Object} params - Paramètres d'échange
 * @returns {Promise<Object>} Détails d'impact de prix
 */
export async function calculatePriceImpact(params) {
  try {
    const { inputMint, outputMint, amount } = params;
    
    // Obtenir un devis pour le montant spécifié
    const quote = await getQuote({
      inputMint,
      outputMint,
      amount: amount.toString(),
      slippage: params.slippage || config.get('SLIPPAGE')
    });
    
    // Obtenir un devis pour un montant très petit (pour le prix spot)
    const smallAmount = inputMint === NATIVE_MINT.toString() ? 
      BigInt(100000000) : // 0.1 SOL en lamports
      BigInt(1); // Plus petite unité pour les autres tokens
    
    const spotQuote = await getQuote({
      inputMint,
      outputMint,
      amount: smallAmount.toString(),
      slippage: params.slippage || config.get('SLIPPAGE')
    });
    
    // Calculer les prix
    const spotPrice = Number(spotQuote.outAmount) / Number(smallAmount);
    const executionPrice = Number(quote.outAmount) / Number(amount);
    
    // Calculer l'impact de prix en pourcentage
    const priceImpact = (1 - (executionPrice / spotPrice)) * 100;
    
    return {
      spotPrice,
      executionPrice,
      priceImpact: Math.max(0, priceImpact), // Toujours positif ou zéro
      quote
    };
  } catch (error) {
    logger.error(`Erreur lors du calcul de l'impact de prix: ${error.message}`);
    throw error;
  }
}

export default {
  getQuote,
  getSwapTransaction,
  executeSwap,
  getRoutes,
  calculatePriceImpact,
  addPriorityFees
};