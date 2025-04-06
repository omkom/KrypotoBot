// src/services/redis.js
import { createClient } from 'redis';
import config from '../config/index.js';
import logger from './logger.js';
import errorHandler, { ErrorSeverity } from './errorHandler.js';

/**
 * Service de connexion Redis avec reconnexion automatique, 
 * gestion des timeouts, et monitoring des performances
 */
class RedisService {
  constructor() {
    this.client = null;
    this.connected = false;
    this.connectionAttempts = 0;
    this.maxRetries = config.get('REDIS_MAX_RETRIES') || 5;
    this.subscribers = new Map(); // Pour gérer les abonnements pub/sub
    this.metrics = {
      commands: 0,
      errors: 0,
      lastReconnectTime: null,
      commandTimes: [], // Pour suivre les temps d'exécution des commandes
      cacheHits: 0,
      cacheMisses: 0
    };
    
    // Initialiser la connexion
    this.initialize();
  }
  
  /**
   * Initialise la connexion Redis avec configuration optimisée
   */
  async initialize() {
    try {
      // Construire l'URL Redis à partir de la config
      const redisUri = config.get('REDIS_URI') || 
        `redis://${config.get('REDIS_USERNAME') || 'default'}:${config.get('REDIS_PASSWORD') || 'redispassword'}@${config.get('REDIS_HOST') || 'redis'}:${config.get('REDIS_PORT') || '6379'}`;
      
      logger.info(`Connexion à Redis: ${redisUri.replace(/\/\/(.+?):(.+?)@/, '//****:****@')}`);
      
      // Créer le client avec options optimisées
      this.client = createClient({
        url: redisUri,
        socket: {
          connectTimeout: 5000,
          reconnectStrategy: (retries) => {
            // Stratégie exponentielle avec jitter pour éviter thundering herd
            const delay = Math.min(
              Math.floor(Math.random() * 1000 + Math.pow(2, retries) * 500),
              60000 // Max 1 minute
            );
            return delay;
          },
          keepAlive: 30000, // 30 secondes de keepalive
          noDelay: true     // Désactiver l'algorithme de Nagle
        },
        commandsQueueMaxLength: 5000, // Taille maximale de la file de commandes
        disableOfflineQueue: false,   // Garder la file de commandes hors ligne
        readonly: false,
        legacyMode: false,           // Mode moderne pour meilleures performances
      });
      
      // Configurer les gestionnaires d'événements
      this.setupEventHandlers();
      
      // Connecter le client
      await this.connect();
      
      logger.success('Connexion Redis établie avec succès');
    } catch (error) {
      const handled = errorHandler.handleError(
        error, 
        'database', 
        ErrorSeverity.HIGH,
        { database: 'redis', operation: 'initialize' }
      );
      
      logger.error(`Échec de l'initialisation Redis: ${error.message}`, error);
      
      // Planifier une reconnexion
      this.scheduleReconnect();
    }
  }
  
  /**
   * Configure les gestionnaires d'événements pour le client Redis
   */
  setupEventHandlers() {
    if (!this.client) return;
    
    // Événement de connexion réussie
    this.client.on('connect', () => {
      logger.debug('Connexion Redis établie');
    });
    
    // Événement ready (connexion prête à recevoir des commandes)
    this.client.on('ready', () => {
      this.connected = true;
      this.connectionAttempts = 0;
      logger.debug('Client Redis prêt');
    });
    
    // Événement de reconnexion
    this.client.on('reconnecting', () => {
      this.connected = false;
      this.connectionAttempts++;
      this.metrics.lastReconnectTime = Date.now();
      logger.warn(`Tentative de reconnexion Redis (${this.connectionAttempts})`);
    });
    
    // Événement d'erreur
    this.client.on('error', (error) => {
      this.metrics.errors++;
      
      // Ne pas logger les erreurs de connexion répétées pour éviter spam
      if (!error.message.includes('Connection timeout') && 
          !error.message.includes('Connection refused')) {
        errorHandler.handleError(
          error,
          'database',
          ErrorSeverity.MEDIUM,
          { database: 'redis', operation: 'runtime_error' }
        );
        
        logger.error(`Erreur Redis: ${error.message}`);
      }
    });
    
    // Événement de fin de connexion
    this.client.on('end', () => {
      this.connected = false;
      logger.warn('Connexion Redis fermée');
    });
  }
  
  /**
   * Établit la connexion au serveur Redis
   * @returns {Promise<boolean>} Statut de connexion
   */
  async connect() {
    try {
      if (this.connected) {
        return true;
      }
      
      this.connectionAttempts++;
      
      // Connecter le client
      await this.client.connect();
      
      // Vérifier la connexion avec un ping
      await this.client.ping();
      
      this.connected = true;
      this.connectionAttempts = 0;
      
      // Restaurer les abonnements précédents si nécessaire
      await this.restoreSubscriptions();
      
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
        { database: 'redis', operation: 'connect', attempts: this.connectionAttempts }
      );
      
      logger.error(`Échec de connexion Redis (tentative ${this.connectionAttempts}/${this.maxRetries}): ${error.message}`);
      
      // Lancer une exception si nombre maximal de tentatives atteint
      if (this.connectionAttempts > this.maxRetries) {
        throw new Error(`Impossible de se connecter à Redis après ${this.maxRetries} tentatives: ${error.message}`);
      }
      
      return false;
    }
  }
  
  /**
   * Planifie une reconnexion après un délai
   */
  scheduleReconnect() {
    const delay = Math.min(
      1000 * Math.pow(2, this.connectionAttempts),
      60000 // Max 1 minute
    );
    
    logger.warn(`Tentative de reconnexion Redis dans ${delay/1000} secondes...`);
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
   * Vérifie l'état de la connexion et tente de reconnecter si nécessaire
   * @returns {Promise<boolean>} Statut de connexion
   */
  async checkConnection() {
    if (this.connected) {
      try {
        // Vérifier la connexion avec un ping
        await this.client.ping();
        return true;
      } catch (error) {
        // La connexion est perdue
        this.connected = false;
        logger.warn(`Connexion Redis perdue: ${error.message}`);
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
   * Mesure le temps d'exécution d'une commande Redis
   * @param {Function} operation - Fonction asynchrone d'opération Redis
   * @param {string} commandName - Nom de la commande
   * @returns {Promise<any>} Résultat de l'opération
   */
  async measureCommand(operation, commandName) {
    const startTime = Date.now();
    
    try {
      // Exécuter la commande
      const result = await operation();
      
      // Mesurer le temps d'exécution
      const duration = Date.now() - startTime;
      
      // Enregistrer les métriques
      this.metrics.commands++;
      
      // Conserver les 100 derniers temps de commande pour analyse
      this.metrics.commandTimes.push({ command: commandName, duration, timestamp: Date.now() });
      if (this.metrics.commandTimes.length > 100) {
        this.metrics.commandTimes.shift();
      }
      
      // Log détaillé pour les commandes lentes (>50ms)
      if (duration > 50 && config.get('DEBUG')) {
        logger.debug(`Redis: Commande lente (${duration}ms) - ${commandName}`);
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
   * Exécute une commande Redis avec gestion des erreurs et reconnexion
   * @param {Function} commandFn - Fonction de commande Redis
   * @param {string} commandName - Nom de la commande pour les logs
   * @param {Array} args - Arguments de la commande
   * @returns {Promise<any>} Résultat de la commande
   */
  async executeCommand(commandFn, commandName, ...args) {
    try {
      // Vérifier la connexion avant l'opération
      await this.checkConnection();
      
      return await this.measureCommand(async () => {
        return await commandFn.apply(this.client, args);
      }, commandName);
    } catch (error) {
      // Si erreur de connexion, tenter de reconnecter une fois
      if (error.message.includes('connection') || error.message.includes('timeout')) {
        try {
          await this.connect();
          
          // Réessayer la commande après reconnexion
          return await this.measureCommand(async () => {
            return await commandFn.apply(this.client, args);
          }, `retry:${commandName}`);
        } catch (retryError) {
          throw retryError;
        }
      }
      
      // Autres erreurs sont remontées
      throw error;
    }
  }
  
  /**
   * Définit une valeur dans Redis avec expiration optionnelle
   * @param {string} key - Clé Redis
   * @param {string|Object} value - Valeur à stocker
   * @param {number} ttl - Durée de vie en secondes (optionnel)
   * @returns {Promise<string>} Résultat de l'opération
   */
  async set(key, value, ttl = null) {
    // Convertir les objets en JSON
    const serializedValue = typeof value === 'object' 
      ? JSON.stringify(value) 
      : String(value);
    
    try {
      // Avec ou sans TTL
      if (ttl !== null) {
        return await this.executeCommand(
          this.client.set.bind(this.client),
          'SET',
          key,
          serializedValue,
          {
            EX: ttl
          }
        );
      } else {
        return await this.executeCommand(
          this.client.set.bind(this.client),
          'SET',
          key,
          serializedValue
        );
      }
    } catch (error) {
      errorHandler.handleError(
        error,
        'database',
        ErrorSeverity.MEDIUM,
        { database: 'redis', operation: 'set', key }
      );
      
      logger.error(`Erreur lors du SET Redis pour la clé ${key}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Récupère une valeur depuis Redis
   * @param {string} key - Clé Redis
   * @param {boolean} asJson - Parser le résultat comme JSON
   * @returns {Promise<any>} Valeur stockée
   */
  async get(key, asJson = false) {
    try {
      const result = await this.executeCommand(
        this.client.get.bind(this.client),
        'GET',
        key
      );
      
      // Suivre les métriques de cache
      if (result === null) {
        this.metrics.cacheMisses++;
      } else {
        this.metrics.cacheHits++;
      }
      
      // Parser JSON si demandé et possible
      if (asJson && result) {
        try {
          return JSON.parse(result);
        } catch (jsonError) {
          // Si erreur de parsing, retourner la chaîne brute
          logger.warn(`Erreur de parsing JSON pour la clé ${key}: ${jsonError.message}`);
          return result;
        }
      }
      
      return result;
    } catch (error) {
      errorHandler.handleError(
        error,
        'database',
        ErrorSeverity.MEDIUM,
        { database: 'redis', operation: 'get', key }
      );
      
      logger.error(`Erreur lors du GET Redis pour la clé ${key}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Supprime une ou plusieurs clés
   * @param {string|Array} keys - Clé(s) à supprimer
   * @returns {Promise<number>} Nombre de clés supprimées
   */
  async del(keys) {
    try {
      // Convertir en tableau si une seule clé passée
      const keyArray = Array.isArray(keys) ? keys : [keys];
      
      return await this.executeCommand(
        this.client.del.bind(this.client),
        'DEL',
        keyArray
      );
    } catch (error) {
      errorHandler.handleError(
        error,
        'database',
        ErrorSeverity.MEDIUM,
        { database: 'redis', operation: 'del', keys }
      );
      
      logger.error(`Erreur lors du DEL Redis: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Définit une expiration sur une clé
   * @param {string} key - Clé Redis
   * @param {number} seconds - Durée en secondes
   * @returns {Promise<number>} 1 si succès, 0 si clé n'existe pas
   */
  async expire(key, seconds) {
    try {
      return await this.executeCommand(
        this.client.expire.bind(this.client),
        'EXPIRE',
        key,
        seconds
      );
    } catch (error) {
      errorHandler.handleError(
        error,
        'database',
        ErrorSeverity.LOW,
        { database: 'redis', operation: 'expire', key }
      );
      
      logger.error(`Erreur lors du EXPIRE Redis pour la clé ${key}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Incrémente une valeur numérique
   * @param {string} key - Clé Redis
   * @param {number} increment - Valeur d'incrément (défaut: 1)
   * @returns {Promise<number>} Nouvelle valeur
   */
  async incr(key, increment = 1) {
    try {
      if (increment === 1) {
        return await this.executeCommand(
          this.client.incr.bind(this.client),
          'INCR',
          key
        );
      } else {
        return await this.executeCommand(
          this.client.incrBy.bind(this.client),
          'INCRBY',
          key,
          increment
        );
      }
    } catch (error) {
      errorHandler.handleError(
        error,
        'database',
        ErrorSeverity.LOW,
        { database: 'redis', operation: 'incr', key }
      );
      
      logger.error(`Erreur lors du INCR Redis pour la clé ${key}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Décrémente une valeur numérique
   * @param {string} key - Clé Redis
   * @param {number} decrement - Valeur de décrément (défaut: 1)
   * @returns {Promise<number>} Nouvelle valeur
   */
  async decr(key, decrement = 1) {
    try {
      if (decrement === 1) {
        return await this.executeCommand(
          this.client.decr.bind(this.client),
          'DECR',
          key
        );
      } else {
        return await this.executeCommand(
          this.client.decrBy.bind(this.client),
          'DECRBY',
          key,
          decrement
        );
      }
    } catch (error) {
      errorHandler.handleError(
        error,
        'database',
        ErrorSeverity.LOW,
        { database: 'redis', operation: 'decr', key }
      );
      
      logger.error(`Erreur lors du DECR Redis pour la clé ${key}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Vérifie si une clé existe
   * @param {string} key - Clé Redis
   * @returns {Promise<boolean>} True si la clé existe
   */
  async exists(key) {
    try {
      const result = await this.executeCommand(
        this.client.exists.bind(this.client),
        'EXISTS',
        key
      );
      
      return result === 1;
    } catch (error) {
      errorHandler.handleError(
        error,
        'database',
        ErrorSeverity.LOW,
        { database: 'redis', operation: 'exists', key }
      );
      
      logger.error(`Erreur lors du EXISTS Redis pour la clé ${key}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Récupère toutes les clés correspondant à un pattern
   * @param {string} pattern - Pattern de recherche (ex: "user:*")
   * @returns {Promise<Array>} Liste des clés
   */
  async keys(pattern) {
    try {
      return await this.executeCommand(
        this.client.keys.bind(this.client),
        'KEYS',
        pattern
      );
    } catch (error) {
      errorHandler.handleError(
        error,
        'database',
        ErrorSeverity.MEDIUM,
        { database: 'redis', operation: 'keys', pattern }
      );
      
      logger.error(`Erreur lors du KEYS Redis pour le pattern ${pattern}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Publie un message sur un canal
   * @param {string} channel - Canal de publication
   * @param {string|Object} message - Message à publier
   * @returns {Promise<number>} Nombre de clients qui ont reçu le message
   */
  async publish(channel, message) {
    // Sérialiser les objets en JSON
    const serializedMessage = typeof message === 'object' 
      ? JSON.stringify(message) 
      : String(message);
    
    try {
      return await this.executeCommand(
        this.client.publish.bind(this.client),
        'PUBLISH',
        channel,
        serializedMessage
      );
    } catch (error) {
      errorHandler.handleError(
        error,
        'database',
        ErrorSeverity.MEDIUM,
        { database: 'redis', operation: 'publish', channel }
      );
      
      logger.error(`Erreur lors du PUBLISH Redis sur le canal ${channel}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * S'abonne à un canal
   * @param {string} channel - Canal d'abonnement
   * @param {Function} callback - Fonction de callback pour les messages
   * @returns {Promise<void>}
   */
  async subscribe(channel, callback) {
    try {
      // Si nous avons déjà un abonnement, le stocker pour la reconnexion
      this.subscribers.set(channel, callback);
      
      await this.executeCommand(
        this.client.subscribe.bind(this.client),
        'SUBSCRIBE',
        channel,
        (message, channelName) => {
          try {
            // Essayer de parser en JSON
            let parsedMessage = message;
            try {
              parsedMessage = JSON.parse(message);
            } catch (e) {
              // Utiliser la message brut si ce n'est pas du JSON
            }
            
            // Appeler le callback
            callback(parsedMessage, channelName);
          } catch (callbackError) {
            logger.error(`Erreur dans le callback Redis pour ${channelName}: ${callbackError.message}`);
          }
        }
      );
      
      logger.debug(`Abonnement au canal Redis: ${channel}`);
    } catch (error) {
      errorHandler.handleError(
        error,
        'database',
        ErrorSeverity.MEDIUM,
        { database: 'redis', operation: 'subscribe', channel }
      );
      
      logger.error(`Erreur lors du SUBSCRIBE Redis au canal ${channel}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Se désabonne d'un canal
   * @param {string} channel - Canal d'abonnement
   * @returns {Promise<void>}
   */
  async unsubscribe(channel) {
    try {
      // Supprimer de la liste des abonnements
      this.subscribers.delete(channel);
      
      await this.executeCommand(
        this.client.unsubscribe.bind(this.client),
        'UNSUBSCRIBE',
        channel
      );
      
      logger.debug(`Désabonnement du canal Redis: ${channel}`);
    } catch (error) {
      errorHandler.handleError(
        error,
        'database',
        ErrorSeverity.LOW,
        { database: 'redis', operation: 'unsubscribe', channel }
      );
      
      logger.error(`Erreur lors du UNSUBSCRIBE Redis du canal ${channel}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Restaure les abonnements après reconnexion
   * @returns {Promise<void>}
   */
  async restoreSubscriptions() {
    // Si aucun abonnement à restaurer
    if (this.subscribers.size === 0) return;
    
    logger.debug(`Restauration de ${this.subscribers.size} abonnements Redis`);
    
    // Réabonner à tous les canaux
    for (const [channel, callback] of this.subscribers.entries()) {
      try {
        await this.executeCommand(
          this.client.subscribe.bind(this.client),
          'SUBSCRIBE',
          channel,
          callback
        );
        
        logger.debug(`Réabonnement au canal Redis: ${channel}`);
      } catch (error) {
        logger.error(`Erreur lors du réabonnement au canal ${channel}: ${error.message}`);
      }
    }
  }
  
  /**
   * Ajoute un élément à un ensemble
   * @param {string} key - Clé de l'ensemble
   * @param {string|number} member - Élément à ajouter
   * @returns {Promise<number>} 1 si ajouté, 0 si déjà présent
   */
  async sadd(key, member) {
    try {
      return await this.executeCommand(
        this.client.sAdd.bind(this.client),
        'SADD',
        key,
        member
      );
    } catch (error) {
      errorHandler.handleError(
        error,
        'database',
        ErrorSeverity.LOW,
        { database: 'redis', operation: 'sadd', key }
      );
      
      logger.error(`Erreur lors du SADD Redis pour la clé ${key}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Vérifie si un élément est dans un ensemble
   * @param {string} key - Clé de l'ensemble
   * @param {string|number} member - Élément à vérifier
   * @returns {Promise<boolean>} True si l'élément est présent
   */
  async sismember(key, member) {
    try {
      const result = await this.executeCommand(
        this.client.sIsMember.bind(this.client),
        'SISMEMBER',
        key,
        member
      );
      
      return result === 1;
    } catch (error) {
      errorHandler.handleError(
        error,
        'database',
        ErrorSeverity.LOW,
        { database: 'redis', operation: 'sismember', key }
      );
      
      logger.error(`Erreur lors du SISMEMBER Redis pour la clé ${key}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Obtient tous les éléments d'un ensemble
   * @param {string} key - Clé de l'ensemble
   * @returns {Promise<Array>} Éléments de l'ensemble
   */
  async smembers(key) {
    try {
      return await this.executeCommand(
        this.client.sMembers.bind(this.client),
        'SMEMBERS',
        key
      );
    } catch (error) {
      errorHandler.handleError(
        error,
        'database',
        ErrorSeverity.LOW,
        { database: 'redis', operation: 'smembers', key }
      );
      
      logger.error(`Erreur lors du SMEMBERS Redis pour la clé ${key}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Exécute une transaction Redis (multi/exec)
   * @param {Function} callback - Fonction de définition des commandes
   * @returns {Promise<Array>} Résultats de la transaction
   */
  async transaction(callback) {
    try {
      // Vérifier la connexion avant l'opération
      await this.checkConnection();
      
      return await this.measureCommand(async () => {
        const multi = this.client.multi();
        
        // Exécuter le callback pour définir les commandes
        await callback(multi);
        
        // Exécuter la transaction
        return await multi.exec();
      }, 'TRANSACTION');
    } catch (error) {
      errorHandler.handleError(
        error,
        'database',
        ErrorSeverity.HIGH,
        { database: 'redis', operation: 'transaction' }
      );
      
      logger.error(`Erreur lors d'une transaction Redis: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Implémentation simplifiée d'un verrouillage distribué
   * @param {string} lockName - Nom du verrou
   * @param {number} ttl - Durée de vie du verrou en secondes
   * @param {number} retryDelay - Délai entre tentatives en ms
   * @param {number} retryCount - Nombre de tentatives
   * @returns {Promise<string|null>} Identifiant du verrou ou null
   */
  async acquireLock(lockName, ttl = 30, retryDelay = 200, retryCount = 5) {
    const lockKey = `lock:${lockName}`;
    const lockId = Date.now().toString(36) + Math.random().toString(36).substr(2);
    
    for (let attempt = 0; attempt <= retryCount; attempt++) {
      try {
        // Tentative d'acquisition avec NX (only if not exists)
        const acquired = await this.executeCommand(
          this.client.set.bind(this.client),
          'SET_LOCK',
          lockKey,
          lockId,
          { 
            NX: true,
            EX: ttl
          }
        );
        
        if (acquired === 'OK') {
          return lockId; // Verrou acquis
        }
        
        // Si ce n'est pas la dernière tentative, attendre
        if (attempt < retryCount) {
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      } catch (error) {
        // Dernière tentative échouée
        if (attempt === retryCount) {
          logger.warn(`Impossible d'acquérir le verrou ${lockName} après ${retryCount} tentatives`);
          return null;
        }
        
        // Sinon attendre pour la prochaine tentative
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
    
    return null; // Verrou non acquis
  }
  
  /**
   * Libère un verrou distribué
   * @param {string} lockName - Nom du verrou
   * @param {string} lockId - Identifiant du verrou
   * @returns {Promise<boolean>} True si le verrou a été libéré
   */
  async releaseLock(lockName, lockId) {
    const lockKey = `lock:${lockName}`;
    
    try {
      // Script Lua pour libérer le verrou de manière atomique
      // Ne libère que si l'identifiant correspond
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      
      const result = await this.executeCommand(
        this.client.eval.bind(this.client),
        'EVAL_RELEASE_LOCK',
        script,
        1,
        lockKey,
        lockId
      );
      
      return result === 1;
    } catch (error) {
      logger.error(`Erreur lors de la libération du verrou ${lockName}: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Obtient les métriques de performance
   * @returns {Object} Métriques de performance
   */
  getMetrics() {
    // Calculer le temps moyen des commandes
    let avgCommandTime = 0;
    if (this.metrics.commandTimes.length > 0) {
      avgCommandTime = this.metrics.commandTimes.reduce((sum, item) => sum + item.duration, 0) / this.metrics.commandTimes.length;
    }
    
    // Calculer le taux de hit du cache
    const cacheTotal = this.metrics.cacheHits + this.metrics.cacheMisses;
    const cacheHitRate = cacheTotal > 0 ? (this.metrics.cacheHits / cacheTotal) * 100 : 0;
    
    return {
      isConnected: this.connected,
      commands: this.metrics.commands,
      errors: this.metrics.errors,
      errorRate: this.metrics.commands > 0 ? (this.metrics.errors / this.metrics.commands) * 100 : 0,
      avgCommandTime,
      cacheHits: this.metrics.cacheHits,
      cacheMisses: this.metrics.cacheMisses,
      cacheHitRate,
      lastReconnect: this.metrics.lastReconnectTime,
      activeSubscriptions: this.subscribers.size,
      recentCommands: this.metrics.commandTimes.slice(-10) // 10 dernières commandes
    };
  }
  
  /**
   * Ferme proprement la connexion
   * @returns {Promise<void>}
   */
  async close() {
    if (this.client) {
      try {
        await this.client.quit();
        this.connected = false;
        logger.info('Connexion Redis fermée proprement');
      } catch (error) {
        logger.error(`Erreur lors de la fermeture de la connexion Redis: ${error.message}`);
      }
    }
  }
}

// Exporter une instance unique
export default new RedisService();