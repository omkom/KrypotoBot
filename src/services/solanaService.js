/**
 * Service d'intégration avec la blockchain Solana
 * Gère les connexions, signatures, envois et confirmations de transactions
 * avec gestion intelligente des erreurs, retry et optimisation des frais
 * 
 * @module solanaService
 * @requires @solana/web3.js
 */

import { 
  Connection, 
  Transaction, 
  PublicKey, 
  Keypair,
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
  TransactionMessage,
  VersionedTransaction,
  clusterApiUrl
} from '@solana/web3.js';
import bs58 from 'bs58';
import logger from './logger.js';
import errorHandler, { ErrorSeverity } from './errorHandler.js';
import config from '../config/index.js';

/**
 * Types d'erreurs Solana pour le traitement spécifique
 * @enum {string}
 */
const SolanaErrorType = {
  BLOCKHASH_EXPIRED: 'blockhash_expired',
  TRANSACTION_ERROR: 'transaction_error',
  TIMEOUT: 'timeout',
  CONNECTION_ERROR: 'connection_error',
  SIMULATION_ERROR: 'simulation_error',
  RATE_LIMIT: 'rate_limit',
  UNKNOWN: 'unknown'
};

/**
 * Service intégré de gestion des transactions Solana
 */
class SolanaService {
  constructor() {
    // Connexions disponibles avec état de santé
    this.connections = [];
    
    // Connexion principale active
    this.activeConnection = null;
    
    // Wallet actif
    this.wallet = null;
    
    // Cache de blockhash récent
    this.blockhashCache = {
      blockhash: '',
      lastFetch: 0,
      expiryTime: 0
    };
    
    // Statistiques de transactions
    this.stats = {
      totalTransactions: 0,
      successfulTransactions: 0,
      failedTransactions: 0,
      retryCount: 0,
      averageConfirmTime: 0,
      totalConfirmTime: 0
    };
    
    // Configuration par défaut
    this.defaultConfig = {
      commitment: 'confirmed',
      maxRetries: 3,
      priorityFee: 0,
      timeoutMs: 45000,
      preflightChecks: true
    };
    
    // Initialiser le service
    this.initialize();
  }
  
  /**
   * Initialise le service en configurant les connexions RPC
   */
  async initialize() {
    try {
      logger.info('Initialisation du service Solana...');
      
      // Récupérer les endpoints depuis la configuration
      const endpoints = [
        config.get('SOLANA_RPC_URL_PRIMARY') || config.get('SOLANA_RPC') || process.env.SOLANA_RPC_URL_PROD,
        config.get('SOLANA_RPC_URL_BACKUP') || process.env.SOLANA_RPC_URL_BACKUP,
        clusterApiUrl('mainnet-beta') // Endpoint public de secours
      ];
      
      // Filtrer les endpoints valides et les ajouter
      for (const endpoint of endpoints) {
        if (endpoint) {
          this.addConnection(endpoint);
        }
      }
      
      // Sélectionner la connexion la plus rapide
      await this.selectBestConnection();
      
      // Initialiser le wallet si configuré
      await this.initializeWallet();
      
      logger.success('Service Solana initialisé avec succès');
    } catch (error) {
      errorHandler.handleError(
        error,
        'blockchain',
        ErrorSeverity.HIGH,
        { operation: 'initialize_solana_service' }
      );
      
      logger.error('Erreur lors de l\'initialisation du service Solana', error);
      throw error;
    }
  }
  
  /**
   * Ajoute une connexion RPC au pool de connexions
   * @param {string} endpoint - URL de l'endpoint RPC
   * @param {string} name - Nom optionnel pour la connexion
   */
  addConnection(endpoint, name = '') {
    try {
      const connectionOptions = {
        commitment: 'confirmed',
        confirmTransactionInitialTimeout: this.defaultConfig.timeoutMs,
        disableRetryOnRateLimit: true // Nous gérons les retries manuellement
      };
      
      const connection = new Connection(endpoint, connectionOptions);
      
      this.connections.push({
        connection,
        endpoint,
        name: name || `connection_${this.connections.length + 1}`,
        healthy: true,
        latency: 0,
        lastChecked: 0,
        failCount: 0
      });
      
      logger.debug(`Connexion Solana ajoutée: ${endpoint.replace(/\/\/(.+?):(.+?)@/, '//****:****@')}`);
    } catch (error) {
      logger.error(`Erreur lors de l'ajout de la connexion RPC: ${error.message}`);
    }
  }
  
  /**
   * Teste et sélectionne la connexion la plus rapide
   * @returns {Connection} Meilleure connexion disponible
   */
  async selectBestConnection() {
    logger.debug('Sélection de la meilleure connexion RPC...');
    
    // Si aucune connexion disponible, utiliser l'endpoint public
    if (this.connections.length === 0) {
      this.addConnection(clusterApiUrl('mainnet-beta'), 'public_fallback');
    }
    
    const latencies = [];
    let fastestConnection = null;
    let fastestLatency = Infinity;
    
    // Tester chaque connexion
    for (const connInfo of this.connections) {
      try {
        const startTime = Date.now();
        await connInfo.connection.getVersion();
        const latency = Date.now() - startTime;
        
        // Mettre à jour les infos de connexion
        connInfo.latency = latency;
        connInfo.lastChecked = Date.now();
        connInfo.healthy = true;
        connInfo.failCount = 0;
        
        latencies.push({
          name: connInfo.name,
          endpoint: connInfo.endpoint,
          latency
        });
        
        // Garder la plus rapide
        if (latency < fastestLatency) {
          fastestLatency = latency;
          fastestConnection = connInfo;
        }
        
      } catch (error) {
        logger.warn(`Connexion RPC ${connInfo.endpoint} non disponible: ${error.message}`);
        connInfo.healthy = false;
        connInfo.failCount++;
      }
    }
    
    // Sélectionner la connexion la plus rapide
    if (fastestConnection) {
      this.activeConnection = fastestConnection.connection;
      logger.info(`Connexion RPC sélectionnée: ${fastestConnection.endpoint.replace(/\/\/(.+?):(.+?)@/, '//****:****@')} (${fastestLatency}ms)`);
    } else {
      // Utiliser la première connexion par défaut s'il y en a
      if (this.connections.length > 0) {
        this.activeConnection = this.connections[0].connection;
        logger.warn(`Aucune connexion optimale trouvée. Utilisation de la connexion par défaut.`);
      } else {
        logger.error('Aucune connexion RPC disponible. Les transactions ne peuvent pas être exécutées.');
        throw new Error('Aucune connexion RPC disponible');
      }
    }
    
    return this.activeConnection;
  }
  
  /**
   * Initialise le wallet à partir de la clé privée dans la configuration
   */
  async initializeWallet() {
    const privateKeyBase58 = config.get('SOLANA_PRIVATE_KEY') || process.env.SOLANA_PRIVATE_KEY_PROD;
    
    if (!privateKeyBase58) {
      logger.warn('Aucune clé privée configurée. Les transactions nécessiteront un wallet externe.');
      return;
    }
    
    try {
      // Décoder la clé privée Base58
      const privateKeyBuffer = bs58.decode(privateKeyBase58);
      
      // Créer le keypair
      this.wallet = Keypair.fromSecretKey(privateKeyBuffer);
      
      // Obtenir l'adresse publique
      const publicKey = this.wallet.publicKey.toString();
      const maskedPublicKey = publicKey.substring(0, 4) + '...' + publicKey.substring(publicKey.length - 4);
      
      // Vérifier le solde
      if (this.activeConnection) {
        const balance = await this.activeConnection.getBalance(this.wallet.publicKey);
        const solBalance = balance / 1_000_000_000; // Convertir lamports en SOL
        
        logger.info(`Wallet initialisé: ${maskedPublicKey} (Solde: ${solBalance.toFixed(4)} SOL)`);
      } else {
        logger.info(`Wallet initialisé: ${maskedPublicKey} (Solde non vérifié - pas de connexion)`);
      }
    } catch (error) {
      errorHandler.handleError(
        error,
        'blockchain',
        ErrorSeverity.HIGH,
        { operation: 'initialize_wallet' }
      );
      
      logger.error('Erreur lors de l\'initialisation du wallet Solana', error);
      throw error;
    }
  }
  
  /**
   * Obtient une connexion valide, avec failover automatique
   * @returns {Connection} Connexion active
   */
  async getConnection() {
    // Si pas de connexion active ou dernière connexion échouée, tenter de basculer
    if (!this.activeConnection) {
      await this.selectBestConnection();
    }
    
    // Vérifier l'état de santé périodiquement (toutes les 30 secondes)
    for (const connInfo of this.connections) {
      if (Date.now() - connInfo.lastChecked > 30000 && !connInfo.healthy && connInfo.failCount < 5) {
        this.checkConnectionHealth(connInfo);
      }
    }
    
    return this.activeConnection;
  }
  
  /**
   * Vérifie la santé d'une connexion
   * @param {Object} connInfo - Information de connexion
   */
  async checkConnectionHealth(connInfo) {
    try {
      const startTime = Date.now();
      await connInfo.connection.getRecentBlockhash();
      const latency = Date.now() - startTime;
      
      // Mettre à jour les infos de connexion
      connInfo.latency = latency;
      connInfo.lastChecked = Date.now();
      connInfo.healthy = true;
      connInfo.failCount = Math.max(0, connInfo.failCount - 1);
      
      logger.debug(`Connexion RPC ${connInfo.name} est saine (${latency}ms)`);
    } catch (error) {
      connInfo.healthy = false;
      connInfo.failCount++;
      connInfo.lastChecked = Date.now();
      
      logger.debug(`Connexion RPC ${connInfo.name} a échoué au test de santé: ${error.message}`);
    }
  }
  
  /**
   * Bascule vers une autre connexion en cas d'échec
   * @returns {Connection} Nouvelle connexion active
   */
  async failoverConnection() {
    logger.warn('Basculement vers une connexion RPC alternative...');
    
    // Marquer la connexion actuelle comme non saine
    const failedEndpoint = this.getConnectionEndpoint(this.activeConnection);
    
    if (failedEndpoint) {
      const failedConn = this.connections.find(c => c.endpoint === failedEndpoint);
      if (failedConn) {
        failedConn.healthy = false;
        failedConn.failCount++;
      }
    }
    
    // Trouver une connexion saine alternative
    const healthyConnections = this.connections.filter(c => c.healthy && c.connection !== this.activeConnection);
    
    if (healthyConnections.length > 0) {
      // Utiliser la connexion avec la latence la plus basse
      const bestConnection = healthyConnections.reduce((best, current) => 
        current.latency < best.latency ? current : best, healthyConnections[0]);
        
      this.activeConnection = bestConnection.connection;
      logger.info(`Basculé vers: ${bestConnection.endpoint.replace(/\/\/(.+?):(.+?)@/, '//****:****@')} (${bestConnection.latency}ms)`);
    } else {
      // Si toutes les connexions sont non saines, réinitialiser et tester à nouveau
      logger.warn('Aucune connexion alternative saine. Test complet des connexions...');
      await this.selectBestConnection();
    }
    
    return this.activeConnection;
  }
  
  /**
   * Récupère l'URL d'endpoint d'une connexion
   * @param {Connection} connection - Connexion Solana
   * @returns {string|null} URL de l'endpoint
   */
  getConnectionEndpoint(connection) {
    const connInfo = this.connections.find(c => c.connection === connection);
    return connInfo ? connInfo.endpoint : null;
  }
  
  /**
   * Obtient un blockhash récent avec caching intelligent
   * @param {Connection} connection - Connexion Solana
   * @param {boolean} forceRefresh - Forcer un rafraîchissement du cache
   * @returns {Promise<string>} Blockhash récent
   */
  async getRecentBlockhash(connection, forceRefresh = false) {
    const now = Date.now();
    
    // Utiliser le cache si disponible et valide (moins de 20 secondes)
    if (!forceRefresh && 
        this.blockhashCache.blockhash && 
        now - this.blockhashCache.lastFetch < 20000) {
      
      return this.blockhashCache.blockhash;
    }
    
    // Récupérer un nouveau blockhash
    try {
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      
      // Mettre à jour le cache
      this.blockhashCache = {
        blockhash,
        lastFetch: now,
        lastValidBlockHeight
      };
      
      return blockhash;
    } catch (error) {
      // Si erreur, réessayer avec une autre connexion
      logger.warn(`Erreur lors de la récupération du blockhash: ${error.message}`);
      
      // Si le cache est encore valide, l'utiliser en dernier recours
      if (this.blockhashCache.blockhash && now - this.blockhashCache.lastFetch < 60000) {
        logger.debug('Utilisation du blockhash en cache comme fallback');
        return this.blockhashCache.blockhash;
      }
      
      // Sinon, propager l'erreur
      throw error;
    }
  }
  
  /**
   * Ajoute des frais de priorité à une transaction
   * @param {Transaction} transaction - Transaction Solana
   * @param {number} priorityFee - Frais de priorité (microlamports)
   * @returns {Transaction} Transaction avec frais de priorité
   */
  addPriorityFee(transaction, priorityFee) {
    if (!priorityFee || priorityFee <= 0) {
      return transaction;
    }
    
    try {
      // Ajouter l'instruction de budget de calcul pour les frais de priorité
      transaction.add(
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: priorityFee
        })
      );
      
      logger.debug(`Ajout des frais de priorité: ${priorityFee} microlamports`);
      return transaction;
    } catch (error) {
      logger.warn(`Erreur lors de l'ajout des frais de priorité: ${error.message}`);
      return transaction;
    }
  }
  
  /**
   * Signe et envoie une transaction avec gestion des erreurs et retries
   * @param {Transaction} transaction - Transaction à envoyer
   * @param {Keypair[]|Keypair} signers - Signataires de la transaction
   * @param {Object} options - Options de transaction
   * @returns {Promise<Object>} Résultat de la transaction avec signature
   */
  async sendTransaction(transaction, signers, options = {}) {
    const config = {
      ...this.defaultConfig,
      ...options
    };
    
    const startTime = Date.now();
    this.stats.totalTransactions++;
    
    // Récupérer la connexion
    let connection = await this.getConnection();
    
    // Tableau des signataires (s'assurer qu'il s'agit d'un tableau)
    const signersArray = Array.isArray(signers) ? signers : [signers];
    
    // Variables pour le suivi des retries
    let retryCount = 0;
    let lastError = null;
    let signature = null;
    
    // Boucle de retry avec backoff exponentiel
    while (retryCount <= config.maxRetries) {
      try {
        // Si ce n'est pas la première tentative, utiliser une nouvelle connexion
        if (retryCount > 0) {
          connection = await this.failoverConnection();
          this.stats.retryCount++;
          
          // Message de retry
          logger.debug(`Retry transaction (${retryCount}/${config.maxRetries}) avec une nouvelle connexion...`);
        }
        
        // Préparer la transaction
        if (!transaction.recentBlockhash) {
          const blockhash = await this.getRecentBlockhash(connection, retryCount > 0);
          transaction.recentBlockhash = blockhash;
        }
        
        // Définir le payeur des frais si non défini
        if (!transaction.feePayer && signersArray.length > 0) {
          transaction.feePayer = signersArray[0].publicKey;
        }
        
        // Ajouter des frais de priorité si configurés
        if (config.priorityFee > 0) {
          transaction = this.addPriorityFee(transaction, config.priorityFee);
        }
        
        // Signer la transaction si elle n'est pas déjà signée
        if (!transaction.signatures || transaction.signatures.filter(s => !!s.signature).length === 0) {
          if (signersArray.length === 0) {
            throw new Error('Aucun signataire fourni pour la transaction');
          }
          transaction.sign(...signersArray);
        }
        
        // Simulation avant envoi si préflightChecks activé
        if (config.preflightChecks) {
          logger.debug('Simulation de transaction avant envoi...');
          
          const { value: simulation } = await connection.simulateTransaction(transaction);
          
          if (simulation.err) {
            throw new Error(`Simulation échouée: ${JSON.stringify(simulation.err)}`);
          }
        }
        
        // Envoyer la transaction
        logger.debug('Envoi de la transaction...');
        
        const wireTransaction = transaction.serialize();
        
        signature = await connection.sendRawTransaction(wireTransaction, {
          skipPreflight: !config.preflightChecks,
          preflightCommitment: config.commitment,
          maxRetries: 0 // Nous gérons le retry nous-mêmes
        });
        
        logger.debug(`Transaction envoyée: ${signature}`);
        
        // Après l'envoi réussi, réinitialiser le compteur d'erreur
        errorHandler.resetErrorCount('blockchain');
        
        // Confirmer la transaction selon le niveau de confirmation demandé
        const confirmation = await this.confirmTransaction(signature, connection, config);
        
        // Mettre à jour les statistiques
        this.stats.successfulTransactions++;
        const confirmTime = Date.now() - startTime;
        this.stats.totalConfirmTime += confirmTime;
        this.stats.averageConfirmTime = this.stats.totalConfirmTime / this.stats.successfulTransactions;
        
        logger.debug(`Transaction confirmée en ${confirmTime}ms: ${signature}`);
        
        // Retourner le résultat
        return {
          success: true,
          signature,
          confirmationTime: confirmTime,
          error: null
        };
      } catch (error) {
        lastError = error;
        
        // Classifier le type d'erreur pour mieux gérer le retry
        const errorType = this.classifySolanaError(error);
        
        // Vérifier si l'erreur est retryable
        const isRetryable = this.isRetryableError(errorType);
        
        if (!isRetryable || retryCount >= config.maxRetries) {
          break;
        }
        
        // Calcul du délai de backoff exponentiel avec jitter
        const baseDelay = Math.min(1000 * Math.pow(2, retryCount), 30000);
        const jitter = baseDelay * 0.2 * Math.random();
        const delay = baseDelay + jitter;
        
        // Log l'erreur et le retry planifié
        logger.warn(
          `Erreur de transaction (${errorType}): ${error.message}. ` +
          `Retry ${retryCount + 1}/${config.maxRetries} dans ${Math.floor(delay)}ms`
        );
        
        // Attendre avant de réessayer
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // Incrémenter le compteur de retry
        retryCount++;
      }
    }
    
    // Si toutes les tentatives ont échoué
    this.stats.failedTransactions++;
    
    // Enregistrer l'erreur
    const handled = errorHandler.handleError(
      lastError,
      'blockchain',
      ErrorSeverity.HIGH,
      {
        operation: 'send_transaction',
        retries: retryCount,
        signature: signature
      }
    );
    
    logger.error(`Échec de la transaction après ${retryCount} retries: ${lastError.message}`);
    
    return {
      success: false,
      signature: null,
      error: lastError.message,
      errorType: this.classifySolanaError(lastError),
      retryCount
    };
  }
  
  /**
   * Classifie l'erreur Solana pour un traitement spécifique
   * @param {Error} error - Erreur à classifier
   * @returns {string} Type d'erreur
   */
  classifySolanaError(error) {
    const msg = error.message.toLowerCase();
    
    if (msg.includes('blockhash') && msg.includes('expired')) {
      return SolanaErrorType.BLOCKHASH_EXPIRED;
    } else if (msg.includes('timeout') || msg.includes('timed out')) {
      return SolanaErrorType.TIMEOUT;
    } else if (msg.includes('connection') || msg.includes('network')) {
      return SolanaErrorType.CONNECTION_ERROR;
    } else if (msg.includes('rate limit') || msg.includes('429')) {
      return SolanaErrorType.RATE_LIMIT;
    } else if (msg.includes('simulation')) {
      return SolanaErrorType.SIMULATION_ERROR;
    } else if (msg.includes('transaction')) {
      return SolanaErrorType.TRANSACTION_ERROR;
    } else {
      return SolanaErrorType.UNKNOWN;
    }
  }
  
  /**
   * Détermine si une erreur justifie un retry
   * @param {string} errorType - Type d'erreur
   * @returns {boolean} Si l'erreur est retryable
   */
  isRetryableError(errorType) {
    // Ces types d'erreurs peuvent bénéficier d'un retry
    const retryableErrors = [
      SolanaErrorType.BLOCKHASH_EXPIRED,
      SolanaErrorType.TIMEOUT,
      SolanaErrorType.CONNECTION_ERROR,
      SolanaErrorType.RATE_LIMIT
    ];
    
    return retryableErrors.includes(errorType);
  }
  
  /**
   * Confirme une transaction après envoi
   * @param {string} signature - Signature de transaction
   * @param {Connection} connection - Connexion Solana
   * @param {Object} options - Options de confirmation
   * @returns {Promise<Object>} Résultat de confirmation
   */
  async confirmTransaction(signature, connection, options = {}) {
    const { timeoutMs, commitment } = options;
    
    try {
      // Configurer un timeout manuellement pour plus de contrôle
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Confirmation timeout après ${timeoutMs}ms`));
        }, timeoutMs);
      });
      
      // Attendre la confirmation
      const confirmationPromise = connection.confirmTransaction(
        {
          signature,
          blockhash: this.blockhashCache.blockhash,
          lastValidBlockHeight: this.blockhashCache.lastValidBlockHeight
        },
        commitment
      );
      
      // Race entre confirmation et timeout
      const confirmation = await Promise.race([confirmationPromise, timeoutPromise]);
      
      // Vérifier s'il y a une erreur dans la confirmation
      if (confirmation.value?.err) {
        throw new Error(`Erreur lors de la confirmation: ${JSON.stringify(confirmation.value.err)}`);
      }
      
      return confirmation;
    } catch (error) {
      // Si l'erreur est un timeout, on peut toujours vérifier périodiquement
      if (error.message.includes('timeout')) {
        logger.warn(`Timeout lors de la confirmation. Vérification manuelle du statut...`);
        
        // Vérifier si la transaction a été confirmée malgré le timeout
        const status = await this.checkTransactionStatus(signature, connection);
        
        if (status.confirmed) {
          return { value: { err: null } };
        }
      }
      
      throw error;
    }
  }
  
  /**
   * Vérifie le statut d'une transaction
   * @param {string} signature - Signature de transaction
   * @param {Connection} connection - Connexion Solana
   * @returns {Promise<Object>} Statut de la transaction
   */
  async checkTransactionStatus(signature, connection) {
    try {
      const status = await connection.getSignatureStatus(signature);
      
      return {
        confirmed: status?.value?.confirmationStatus === 'confirmed' || 
                   status?.value?.confirmationStatus === 'finalized',
        status: status?.value?.confirmationStatus || 'unknown',
        raw: status
      };
    } catch (error) {
      logger.error(`Erreur lors de la vérification du statut de transaction: ${error.message}`);
      
      return {
        confirmed: false,
        status: 'error',
        error: error.message
      };
    }
  }
  
  /**
   * Envoie et confirme une transaction en une seule étape
   * @param {Transaction} transaction - Transaction à envoyer
   * @param {Keypair[]} signers - Signataires
   * @param {Object} options - Options de transaction
   * @returns {Promise<Object>} Résultat de transaction
   */
  async sendAndConfirmTransaction(transaction, signers, options = {}) {
    return this.sendTransaction(transaction, signers, options);
  }
  
  /**
   * Crée et envoie une transaction versionnée (pour version 0.26.0+)
   * @param {Array} instructions - Instructions de la transaction
   * @param {Keypair} payer - Payeur des frais
   * @param {Object} options - Options supplémentaires
   * @returns {Promise<Object>} Résultat de transaction
   */
  async sendVersionedTransaction(instructions, payer, options = {}) {
    try {
      const connection = await this.getConnection();
      
      // Obtenir le dernier blockhash
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      
      // Créer un message de transaction versionnée
      const messageV0 = new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: blockhash,
        instructions
      }).compileToV0Message();
      
      // Créer la transaction versionnée
      const transaction = new VersionedTransaction(messageV0);
      
      // Signer la transaction
      transaction.sign([payer]);
      
      // Envoyer la transaction
      const signature = await connection.sendTransaction(transaction, {
        skipPreflight: !options.preflightChecks,
        maxRetries: 0, // Géré par notre système
        preflightCommitment: options.commitment || this.defaultConfig.commitment
      });
      
      // Confirmer la transaction
      const confirmation = await connection.confirmTransaction(
        {
          signature,
          blockhash,
          lastValidBlockHeight
        },
        options.commitment || this.defaultConfig.commitment
      );
      
      // Vérifier s'il y a une erreur
      if (confirmation.value?.err) {
        throw new Error(`Erreur dans la confirmation: ${JSON.stringify(confirmation.value.err)}`);
      }
      
      this.stats.successfulTransactions++;
      
      return {
        success: true,
        signature,
        confirmation
      };
    } catch (error) {
      this.stats.failedTransactions++;
      
      errorHandler.handleError(
        error,
        'blockchain',
        ErrorSeverity.HIGH,
        {
          operation: 'send_versioned_transaction'
        }
      );
      
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Calcule les frais de priorité optimaux en fonction des conditions de réseau
   * @param {string} urgency - Niveau d'urgence (low, medium, high)
   * @returns {Promise<number>} Frais en microlamports
   */
  async calculateOptimalPriorityFee(urgency = 'medium') {
    try {
      // Valeurs par défaut selon l'urgence
      const defaultFees = {
        low: 10000,    // 0.00001 SOL
        medium: 100000, // 0.0001 SOL
        high: 1000000   // 0.001 SOL
      };
      
      // Si priorityFee est configuré, l'utiliser
      const configuredFee = config.get('PRIORITY_FEE');
      if (configuredFee && configuredFee > 0) {
        return configuredFee;
      }
      
      // Sinon utiliser les valeurs par défaut
      return defaultFees[urgency] || defaultFees.medium;
      
      // Pour une implémentation avancée, on pourrait interroger le réseau
      // pour estimer les frais actuels, mais cela nécessite des API supplémentaires
    } catch (error) {
      logger.warn(`Erreur lors du calcul des frais de priorité: ${error.message}`);
      
      // Retourner une valeur par défaut
      return 100000; // 0.0001 SOL
    }
  }
  
  /**
   * Obtient le solde d'un compte
   * @param {PublicKey|string} publicKey - Clé publique du compte
   * @returns {Promise<number>} Solde en SOL
   */
  async getBalance(publicKey) {
    try {
      const connection = await this.getConnection();
      
      // Convertir la clé publique si c'est une chaîne
      const pubKey = typeof publicKey === 'string' ? new PublicKey(publicKey) : publicKey;
      
      // Obtenir le solde en lamports
      const balance = await connection.getBalance(pubKey);
      
      // Convertir en SOL
      return balance / 1_000_000_000;
    } catch (error) {
      logger.error(`Erreur lors de la récupération du solde: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Obtient les statistiques de transaction
   * @returns {Object} Statistiques de transaction
   */
  getStats() {
    return {
      ...this.stats,
      successRate: this.stats.totalTransactions > 0 
        ? (this.stats.successfulTransactions / this.stats.totalTransactions * 100).toFixed(2) + '%'
        : '0%',
      averageConfirmTime: this.stats.averageConfirmTime.toFixed(2) + 'ms'
    };
  }
}

// Exporter une instance unique
export default new SolanaService();