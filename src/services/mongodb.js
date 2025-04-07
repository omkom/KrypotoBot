// src/services/mongodb.js
import { MongoClient } from 'mongodb';
import config from '../config/index.js';
import logger from './logger.js';
import errorHandler, { ErrorSeverity } from './errorHandler.js';

/**
 * Service de connexion MongoDB avec connection pooling optimisé,
 * reconnexion automatique et monitoring des performances
 */
class MongoDBService {
  constructor() {
    this.client = null;
    this.db = null;
    this.connected = false;
    this.connectionAttempts = 0;
    this.maxRetries = config.get('MONGO_MAX_RETRIES') || 5;
    this.collections = new Map();
    this.metrics = {
      operations: 0,
      errors: 0,
      lastReconnectTime: null,
      queryTimes: [] // Pour suivre les temps de requête
    };
    
    // Initialiser la connexion
    this.initialize();
  }
  
  /**
   * Initialise la connexion MongoDB avec configuration optimisée
   */
  async initialize() {
    const mongoUri = config.get('MONGO_URI') || 
      `mongodb://${config.get('MONGO_USER') || 'memecoin'}:${config.get('MONGO_PASSWORD') || 'securepassword'}@${config.get('MONGO_HOST') || 'mongodb'}:${config.get('MONGO_PORT') || '27017'}/${config.get('MONGO_DB') || 'tradingbot'}`;
    
    const mongoOptions = {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      connectTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      // Configuration avancée du pool de connexions
      maxPoolSize: config.get('MONGO_MAX_POOL_SIZE') || 10, 
      minPoolSize: config.get('MONGO_MIN_POOL_SIZE') || 1,
      maxIdleTimeMS: config.get('MONGO_MAX_IDLE_TIME') || 60000,
      waitQueueTimeoutMS: 30000,
      // Heartbeat et keepalive pour éviter timeouts
      heartbeatFrequencyMS: 10000,
      keepAlive: true,
      keepAliveInitialDelay: 30000,
      // Retry d'écriture automatique 
      retryWrites: true,
      retryReads: true
    };
    
    try {
      logger.info(`Connexion à MongoDB: ${mongoUri.replace(/\/\/(.+?):(.+?)@/, '//****:****@')}`);
      
      this.client = new MongoClient(mongoUri, mongoOptions);
      await this.connect();
      
      logger.success('Connexion MongoDB établie avec succès');
    } catch (error) {
      errorHandler.handleError(
        error,
        'database',
        ErrorSeverity.HIGH,
        { database: 'mongodb', operation: 'initialize' }
      );
      
      logger.error(`Échec de l'initialisation MongoDB: ${error.message}`, error);
      
      // Planifier une reconnexion automatique
      this.scheduleReconnect();
    }
  }
  
  /**
   * Établit la connexion au serveur MongoDB
   * @returns {Promise<boolean>} Statut de connexion
   */
  async connect() {
    try {
      if (this.connected && this.client) {
        return true;
      }
      
      this.connectionAttempts++;
      
      // Connexion au serveur
      await this.client.connect();
      
      // Obtenir la référence à la base de données
      const dbName = config.get('MONGO_DB') || 'tradingbot';
      this.db = this.client.db(dbName);
      
      // Vérifier la connexion par ping
      await this.db.command({ ping: 1 });
      
      this.connected = true;
      this.connectionAttempts = 0;
      
      // Configurer les événements
      this.client.on('close', this.handleDisconnect.bind(this));
      this.client.on('error', this.handleError.bind(this));
      this.client.on('timeout', this.handleTimeout.bind(this));
      
      // Créer les indexes essentiels pour optimiser les requêtes
      await this.setupIndexes();
      
      return true;
    } catch (error) {
      this.connected = false;
      
      const severity = this.connectionAttempts > this.maxRetries 
        ? ErrorSeverity.CRITICAL 
        : ErrorSeverity.HIGH;
      
      errorHandler.handleError(
        error,
        'database',
        severity,
        { database: 'mongodb', operation: 'connect', attempts: this.connectionAttempts }
      );
      
      logger.error(`Échec de connexion MongoDB (tentative ${this.connectionAttempts}/${this.maxRetries}): ${error.message}`);
      
      // Lancer une exception si nombre maximal de tentatives atteint
      if (this.connectionAttempts > this.maxRetries) {
        throw new Error(`Impossible de se connecter à MongoDB après ${this.maxRetries} tentatives: ${error.message}`);
      }
      
      return false;
    }
  }
  
  /**
   * Configure les index essentiels pour les collections principales
   */
  async setupIndexes() {
    try {
      // Index pour la collection trades
      const tradesCollection = this.collection('trades');
      await tradesCollection.createIndexes([
        { key: { timestamp: -1 }, name: 'timestamp_desc' },
        { key: { tokenAddress: 1 }, name: 'token_address' },
        { key: { 'trade.success': 1 }, name: 'trade_success' }
      ]);
      
      // Index pour la collection tokens
      const tokensCollection = this.collection('tokens');
      await tokensCollection.createIndexes([
        { key: { address: 1 }, name: 'token_address_unique', unique: true },
        { key: { symbol: 1 }, name: 'token_symbol' },
        { key: { firstSeen: -1 }, name: 'first_seen_desc' }
      ]);
      
      // Index pour la collection analytics
      const analyticsCollection = this.collection('analytics');
      await analyticsCollection.createIndexes([
        { key: { date: -1 }, name: 'date_desc' },
        { key: { type: 1, date: -1 }, name: 'type_date_desc' }
      ]);
      
      logger.debug('Index MongoDB créés/vérifiés avec succès');
    } catch (error) {
      // Une erreur ici ne devrait pas être fatale - juste logger
      logger.warn(`Erreur lors de la création des index MongoDB: ${error.message}`);
    }
  }
  
  /**
   * Planifie une reconnexion après un délai exponentiel
   */
  scheduleReconnect() {
    const delay = Math.min(
      1000 * Math.pow(2, this.connectionAttempts),
      60000 // Max 1 minute
    );
    
    logger.warn(`Tentative de reconnexion MongoDB dans ${delay/1000} secondes...`);
    this.metrics.lastReconnectTime = Date.now();
    
    setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        // Si la connexion échoue, planifier une nouvelle tentative
        this.scheduleReconnect();
      }
    }, delay);
  }
  
  /**
   * Gère un événement de déconnexion
   */
  handleDisconnect() {
    this.connected = false;
    logger.warn('Déconnexion détectée de MongoDB');
    
    // Tenter de se reconnecter
    this.scheduleReconnect();
  }
  
  /**
   * Gère un événement d'erreur
   * @param {Error} error - Erreur survenue
   */
  handleError(error) {
    this.metrics.errors++;
    
    errorHandler.handleError(
      error,
      'database',
      ErrorSeverity.HIGH,
      { database: 'mongodb', operation: 'runtime_error' }
    );
    
    logger.error(`Erreur MongoDB: ${error.message}`, error);
  }
  
  /**
   * Gère un événement de timeout
   */
  handleTimeout() {
    logger.warn('Timeout de connexion MongoDB détecté');
    this.metrics.errors++;
    
    // Vérifier l'état de la connexion
    this.checkConnection();
  }
  
  /**
   * Vérifie l'état de la connexion et tente de reconnecter si nécessaire
   * @returns {Promise<boolean>} Statut de connexion
   */
  async checkConnection() {
    if (this.connected) {
      try {
        // Vérifier la connexion avec un ping léger
        await this.db.command({ ping: 1 });
        return true;
      } catch (error) {
        // La connexion est perdue
        this.connected = false;
        logger.warn(`Connexion MongoDB perdue: ${error.message}`);
      }
    }
    
    // Tenter de reconnecter
    try {
      return await this.connect();
    } catch (error) {
      return false;
    }
  }
  
  /**
   * Mesure le temps d'exécution d'une opération MongoDB
   * @param {Function} operation - Fonction asynchrone d'opération MongoDB
   * @param {string} name - Nom descriptif de l'opération
   * @returns {Promise<any>} Résultat de l'opération
   */
  async measureOperation(operation, name) {
    const startTime = Date.now();
    
    try {
      // Exécuter l'opération
      const result = await operation();
      
      // Mesurer le temps d'exécution
      const duration = Date.now() - startTime;
      
      // Enregistrer les métriques
      this.metrics.operations++;
      
      // Conserver les 100 derniers temps de requête pour analyse
      this.metrics.queryTimes.push({ name, duration, timestamp: Date.now() });
      if (this.metrics.queryTimes.length > 100) {
        this.metrics.queryTimes.shift();
      }
      
      // Log détaillé pour les requêtes lentes (>100ms)
      if (duration > 100 && config.get('DEBUG')) {
        logger.debug(`MongoDB: Opération lente (${duration}ms) - ${name}`);
      }
      
      return result;
    } catch (error) {
      // Enregistrer l'erreur
      this.metrics.errors++;
      
      // Relancer l'erreur
      throw error;
    }
  }
  
  /**
   * Obtient une référence à une collection avec cache
   * @param {string} collectionName - Nom de la collection
   * @returns {Collection} Référence à la collection MongoDB
   */
  collection(collectionName) {
    // Vérifier la connexion
    if (!this.connected || !this.db) {
      throw new Error('MongoDB: Non connecté');
    }
    
    // Utiliser la collection en cache si disponible
    if (!this.collections.has(collectionName)) {
      this.collections.set(collectionName, this.db.collection(collectionName));
    }
    
    return this.collections.get(collectionName);
  }
  
  /**
   * Exécute une opération de recherche avec retry automatique
   * @param {string} collectionName - Nom de la collection
   * @param {Object} query - Critères de recherche
   * @param {Object} options - Options de la requête
   * @returns {Promise<Array>} Résultats de la recherche
   */
  async find(collectionName, query = {}, options = {}) {
    // Vérifier la connexion avant l'opération
    await this.checkConnection();
    
    try {
      return await this.measureOperation(async () => {
        const collection = this.collection(collectionName);
        return collection.find(query, options).toArray();
      }, `find:${collectionName}`);
    } catch (error) {
      errorHandler.handleError(
        error,
        'database',
        ErrorSeverity.MEDIUM,
        { database: 'mongodb', operation: 'find', collection: collectionName, query }
      );
      
      logger.error(`Erreur lors de find dans ${collectionName}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Trouve un document unique par critères
   * @param {string} collectionName - Nom de la collection
   * @param {Object} query - Critères de recherche
   * @param {Object} options - Options de la requête
   * @returns {Promise<Object|null>} Document trouvé ou null
   */
  async findOne(collectionName, query = {}, options = {}) {
    await this.checkConnection();
    
    try {
      return await this.measureOperation(async () => {
        const collection = this.collection(collectionName);
        return collection.findOne(query, options);
      }, `findOne:${collectionName}`);
    } catch (error) {
      errorHandler.handleError(
        error,
        'database',
        ErrorSeverity.MEDIUM,
        { database: 'mongodb', operation: 'findOne', collection: collectionName, query }
      );
      
      logger.error(`Erreur lors de findOne dans ${collectionName}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Exécute une opération d'insertion avec retry automatique
   * @param {string} collectionName - Nom de la collection
   * @param {Object|Array} documents - Document(s) à insérer
   * @param {Object} options - Options de l'opération
   * @returns {Promise<Object>} Résultat de l'insertion
   */
  async insert(collectionName, documents, options = {}) {
    // Vérifier la connexion avant l'opération
    await this.checkConnection();
    
    try {
      return await this.measureOperation(async () => {
        const collection = this.collection(collectionName);
        
        // Déterminer si c'est un tableau pour insertMany ou un objet pour insertOne
        if (Array.isArray(documents)) {
          return await collection.insertMany(documents, options);
        } else {
          return await collection.insertOne(documents, options);
        }
      }, `insert:${collectionName}`);
    } catch (error) {
      errorHandler.handleError(
        error,
        'database',
        ErrorSeverity.MEDIUM,
        { database: 'mongodb', operation: 'insert', collection: collectionName }
      );
      
      logger.error(`Erreur lors de insert dans ${collectionName}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Exécute une opération de mise à jour avec retry automatique
   * @param {string} collectionName - Nom de la collection
   * @param {Object} filter - Critères de filtrage
   * @param {Object} update - Modifications à appliquer
   * @param {Object} options - Options de l'opération
   * @returns {Promise<Object>} Résultat de la mise à jour
   */
  async update(collectionName, filter, update, options = { upsert: false }) {
    // Vérifier la connexion avant l'opération
    await this.checkConnection();
    
    try {
      return await this.measureOperation(async () => {
        const collection = this.collection(collectionName);
        
        // Utiliser updateMany si l'option multi est true, sinon updateOne
        if (options.multi) {
          const { multi, ...updateOptions } = options;
          return await collection.updateMany(filter, update, updateOptions);
        } else {
          return await collection.updateOne(filter, update, options);
        }
      }, `update:${collectionName}`);
    } catch (error) {
      errorHandler.handleError(
        error,
        'database',
        ErrorSeverity.MEDIUM,
        { database: 'mongodb', operation: 'update', collection: collectionName, filter }
      );
      
      logger.error(`Erreur lors de update dans ${collectionName}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Exécute une opération de suppression avec retry automatique
   * @param {string} collectionName - Nom de la collection
   * @param {Object} filter - Critères de filtrage
   * @param {Object} options - Options de l'opération
   * @returns {Promise<Object>} Résultat de la suppression
   */
  async delete(collectionName, filter, options = {}) {
    // Vérifier la connexion avant l'opération
    await this.checkConnection();
    
    try {
      return await this.measureOperation(async () => {
        const collection = this.collection(collectionName);
        
        // Utiliser deleteMany si l'option multi est true, sinon deleteOne
        if (options.multi) {
          const { multi, ...deleteOptions } = options;
          return await collection.deleteMany(filter, deleteOptions);
        } else {
          return await collection.deleteOne(filter, options);
        }
      }, `delete:${collectionName}`);
    } catch (error) {
      errorHandler.handleError(
        error,
        'database',
        ErrorSeverity.MEDIUM,
        { database: 'mongodb', operation: 'delete', collection: collectionName, filter }
      );
      
      logger.error(`Erreur lors de delete dans ${collectionName}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Exécute une opération d'agrégation avec retry automatique
   * @param {string} collectionName - Nom de la collection
   * @param {Array} pipeline - Pipeline d'agrégation
   * @param {Object} options - Options de l'opération
   * @returns {Promise<Array>} Résultats de l'agrégation
   */
  async aggregate(collectionName, pipeline, options = {}) {
    // Vérifier la connexion avant l'opération
    await this.checkConnection();
    
    try {
      return await this.measureOperation(async () => {
        const collection = this.collection(collectionName);
        return collection.aggregate(pipeline, options).toArray();
      }, `aggregate:${collectionName}`);
    } catch (error) {
      errorHandler.handleError(
        error,
        'database',
        ErrorSeverity.MEDIUM,
        { database: 'mongodb', operation: 'aggregate', collection: collectionName }
      );
      
      logger.error(`Erreur lors de aggregate dans ${collectionName}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Exécute une transaction avec retry automatique
   * @param {Function} callback - Fonction de transaction
   * @param {Object} options - Options de la transaction
   * @returns {Promise<any>} Résultat de la transaction
   */
  async withTransaction(callback, options = {}) {
    // Vérifier la connexion avant l'opération
    await this.checkConnection();
    
    let session;
    
    try {
      session = this.client.startSession();
      
      return await this.measureOperation(async () => {
        return await session.withTransaction(async () => {
          return await callback(session);
        }, options);
      }, 'transaction');
    } catch (error) {
      errorHandler.handleError(
        error,
        'database',
        ErrorSeverity.HIGH,
        { database: 'mongodb', operation: 'transaction' }
      );
      
      logger.error(`Erreur lors de la transaction MongoDB: ${error.message}`);
      throw error;
    } finally {
      if (session) {
        await session.endSession();
      }
    }
  }
  
  /**
   * Compte les documents selon des critères
   * @param {string} collectionName - Nom de la collection
   * @param {Object} query - Critères de recherche
   * @param {Object} options - Options de comptage
   * @returns {Promise<number>} Nombre de documents
   */
  async count(collectionName, query = {}, options = {}) {
    await this.checkConnection();
    
    try {
      return await this.measureOperation(async () => {
        const collection = this.collection(collectionName);
        return collection.countDocuments(query, options);
      }, `count:${collectionName}`);
    } catch (error) {
      errorHandler.handleError(
        error,
        'database',
        ErrorSeverity.LOW,
        { database: 'mongodb', operation: 'count', collection: collectionName, query }
      );
      
      logger.error(`Erreur lors du comptage dans ${collectionName}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Obtient les métriques de performance
   * @returns {Object} Métriques de performance
   */
  getMetrics() {
    // Calculer le temps de requête moyen
    let avgQueryTime = 0;
    if (this.metrics.queryTimes.length > 0) {
      avgQueryTime = this.metrics.queryTimes.reduce((sum, item) => sum + item.duration, 0) / this.metrics.queryTimes.length;
    }
    
    return {
      isConnected: this.connected,
      operations: this.metrics.operations,
      errors: this.metrics.errors,
      errorRate: this.metrics.operations > 0 ? (this.metrics.errors / this.metrics.operations) * 100 : 0,
      avgQueryTime,
      lastReconnect: this.metrics.lastReconnectTime,
      poolConfig: {
        maxSize: config.get('MONGO_MAX_POOL_SIZE') || 10,
        minSize: config.get('MONGO_MIN_POOL_SIZE') || 1
      },
      recentQueries: this.metrics.queryTimes.slice(-10) // 10 dernières requêtes
    };
  }
  
  /**
   * Ferme proprement la connexion
   * @returns {Promise<void>}
   */
  async close() {
    if (this.client) {
      try {
        await this.client.close();
        this.connected = false;
        logger.info('Connexion MongoDB fermée proprement');
      } catch (error) {
        logger.error(`Erreur lors de la fermeture de la connexion MongoDB: ${error.message}`);
      }
    }
  }
}

// Exporter une instance singleton
export default new MongoDBService();