/**
 * Service avancé de gestion d'erreurs avec classification par sévérité,
 * circuit breakers, et mécanismes de récupération automatiques
 * 
 * @module errorHandler
 * @requires ./logger
 */

import logger from './logger.js';
import config from '../config/index.js';

/**
 * Niveaux de sévérité des erreurs
 * @enum {number}
 */
export const ErrorSeverity = {
  CRITICAL: 4,  // Erreur fatale nécessitant une intervention immédiate
  HIGH: 3,      // Erreur grave avec impact majeur sur les fonctionnalités
  MEDIUM: 2,    // Erreur significative avec impact limité
  LOW: 1        // Erreur mineure sans impact fonctionnel important
};

/**
 * Catégories d'erreurs pour le classement et les statistiques
 * @enum {string}
 */
export const ErrorCategory = {
  API: 'api',               // Erreurs liées aux appels API externes
  BLOCKCHAIN: 'blockchain', // Erreurs blockchain (transactions, RPC)
  TRADING: 'trading',       // Erreurs liées aux opérations de trading
  DATABASE: 'database',     // Erreurs de base de données
  SYSTEM: 'system'          // Erreurs système (fichiers, mémoire, etc)
};

/**
 * Gestionnaire d'erreurs avancé avec circuit breaking et récupération
 */
class ErrorHandler {
  constructor() {
    // Compteurs d'erreurs par catégorie
    this.errorCounts = {
      [ErrorCategory.API]: 0,
      [ErrorCategory.BLOCKCHAIN]: 0,
      [ErrorCategory.TRADING]: 0,
      [ErrorCategory.DATABASE]: 0,
      [ErrorCategory.SYSTEM]: 0
    };
    
    // Compteurs d'erreurs consécutives par catégorie (pour le circuit breaking)
    this.consecutiveErrors = {
      [ErrorCategory.API]: 0,
      [ErrorCategory.BLOCKCHAIN]: 0,
      [ErrorCategory.TRADING]: 0,
      [ErrorCategory.DATABASE]: 0,
      [ErrorCategory.SYSTEM]: 0
    };
    
    // État des circuit breakers par catégorie
    this.circuitBreakers = {
      [ErrorCategory.API]: { tripped: false, until: null },
      [ErrorCategory.BLOCKCHAIN]: { tripped: false, until: null },
      [ErrorCategory.TRADING]: { tripped: false, until: null },
      [ErrorCategory.DATABASE]: { tripped: false, until: null },
      [ErrorCategory.SYSTEM]: { tripped: false, until: null }
    };
    
    // Seuils de déclenchement des circuit breakers par catégorie
    this.thresholds = {
      [ErrorCategory.API]: 5,       // 5 erreurs consécutives
      [ErrorCategory.BLOCKCHAIN]: 3, // 3 erreurs consécutives
      [ErrorCategory.TRADING]: 4,    // 4 erreurs consécutives
      [ErrorCategory.DATABASE]: 3,   // 3 erreurs consécutives
      [ErrorCategory.SYSTEM]: 3      // 3 erreurs consécutives
    };
    
    // Configuration des timeouts par défaut pour les circuit breakers (en ms)
    this.defaultTimeouts = {
      [ErrorSeverity.LOW]: 60 * 1000,        // 1 minute
      [ErrorSeverity.MEDIUM]: 5 * 60 * 1000, // 5 minutes
      [ErrorSeverity.HIGH]: 15 * 60 * 1000,  // 15 minutes
      [ErrorSeverity.CRITICAL]: 60 * 60 * 1000 // 1 heure
    };
    
    // Historique des erreurs pour l'analyse (limité aux 100 dernières)
    this.errorHistory = [];
    
    // Abonnés aux alertes
    this.alertSubscribers = [];
  }
  
  /**
   * Gère une erreur avec classification et récupération automatique
   * @param {Error} error - L'erreur à gérer
   * @param {string} category - Catégorie d'erreur (api, blockchain, trading, database, system)
   * @param {number} severity - Sévérité de l'erreur (ErrorSeverity)
   * @param {Object} context - Informations contextuelles sur l'erreur
   * @returns {Object} Résultat du traitement avec étapes de récupération
   */
  handleError(error, category = ErrorCategory.SYSTEM, severity = ErrorSeverity.MEDIUM, context = {}) {
    if (!ErrorCategory[category.toUpperCase()]) {
      category = ErrorCategory.SYSTEM; // Fallback sur SYSTEM si catégorie invalide
    }
    
    // Incrémenter les compteurs d'erreurs
    this.errorCounts[category]++;
    this.consecutiveErrors[category]++;
    
    // Enregistrer dans l'historique
    this.addToErrorHistory(error, category, severity, context);
    
    // Journaliser l'erreur avec le niveau approprié
    this.logError(error, category, severity, context);
    
    // Vérifier si un circuit breaker doit être déclenché
    const circuitBroken = this.checkCircuitBreaker(category, severity);
    
    // Générer des étapes de récupération
    const recoverySteps = this.generateRecoverySteps(category, severity);
    
    // Déclencher des alertes si nécessaire (pour les erreurs graves)
    if (severity >= ErrorSeverity.HIGH) {
      this.triggerAlerts(error, category, severity, context, circuitBroken);
    }
    
    // Retourner le résultat du traitement
    return {
      handled: true,
      severity,
      category,
      circuitBroken,
      recoverySteps,
      message: error.message
    };
  }
  
  /**
   * Enregistre l'erreur dans l'historique
   * @param {Error} error - L'erreur à enregistrer
   * @param {string} category - Catégorie d'erreur
   * @param {number} severity - Sévérité de l'erreur
   * @param {Object} context - Informations contextuelles
   */
  addToErrorHistory(error, category, severity, context) {
    // Créer une entrée d'historique
    const historyEntry = {
      timestamp: new Date(),
      category,
      severity,
      message: error.message,
      stack: error.stack,
      context,
      hash: this.hashError(error.message, category)
    };
    
    // Ajouter à l'historique (au début)
    this.errorHistory.unshift(historyEntry);
    
    // Limiter la taille de l'historique
    if (this.errorHistory.length > 100) {
      this.errorHistory.pop();
    }
  }
  
  /**
   * Crée un hash simple pour identifier les erreurs similaires
   * @param {string} message - Message d'erreur
   * @param {string} category - Catégorie d'erreur
   * @returns {string} Hash d'erreur
   */
  hashError(message, category) {
    // Simplifier le message en supprimant les détails variables
    const simplifiedMessage = message
      .replace(/[0-9]+/g, 'X')       // Remplacer les nombres
      .replace(/0x[a-fA-F0-9]+/g, 'ADDR')  // Remplacer les adresses
      .replace(/\s+/g, ' ')          // Normaliser les espaces
      .substring(0, 50);             // Limiter la longueur
      
    return `${category}:${simplifiedMessage}`;
  }
  
  /**
   * Journalise l'erreur avec le niveau approprié
   * @param {Error} error - L'erreur à journaliser
   * @param {string} category - Catégorie d'erreur
   * @param {number} severity - Sévérité de l'erreur
   * @param {Object} context - Informations contextuelles
   */
  logError(error, category, severity, context) {
    // Formatter le message d'erreur
    const logMessage = `[${category.toUpperCase()}] ${error.message}`;
    
    // Log avec le niveau approprié selon la sévérité
    switch (severity) {
      case ErrorSeverity.CRITICAL:
        logger.critical(logMessage, error);
        break;
      case ErrorSeverity.HIGH:
        logger.error(logMessage, error);
        break;
      case ErrorSeverity.MEDIUM:
        logger.warn(logMessage);
        break;
      default:
        logger.debug(logMessage);
    }
    
    // Log des informations contextuelles en mode debug
    if (config.get('DEBUG') && Object.keys(context).length > 0) {
      logger.debug(`Contexte d'erreur [${category}]`, context);
    }
  }
  
  /**
   * Vérifie si un circuit breaker doit être déclenché
   * @param {string} category - Catégorie d'erreur
   * @param {number} severity - Sévérité de l'erreur
   * @returns {boolean} True si le circuit breaker est déclenché
   */
  checkCircuitBreaker(category, severity) {
    // Vérifier si le circuit breaker est déjà déclenché
    if (this.circuitBreakers[category].tripped) {
      // Vérifier si le temps de refroidissement est écoulé
      if (this.circuitBreakers[category].until && Date.now() > this.circuitBreakers[category].until) {
        // Réinitialiser le circuit breaker
        this.resetCircuitBreaker(category);
        return false;
      }
      return true; // Circuit breaker toujours déclenché
    }
    
    // Vérifier si le seuil d'erreurs consécutives est atteint
    if (this.consecutiveErrors[category] >= this.thresholds[category]) {
      // Calculer la durée du circuit breaker en fonction de la sévérité
      const timeout = this.calculateBreakTimeout(category, severity);
      
      // Déclencher le circuit breaker
      this.circuitBreakers[category].tripped = true;
      this.circuitBreakers[category].until = Date.now() + timeout;
      
      logger.warn(`Circuit breaker déclenché pour ${category} pendant ${timeout/1000}s (${this.consecutiveErrors[category]} erreurs consécutives)`);
      
      return true;
    }
    
    return false;
  }
  
  /**
   * Calcule la durée du circuit breaker en fonction de la sévérité et du nombre d'erreurs
   * @param {string} category - Catégorie d'erreur
   * @param {number} severity - Sévérité de l'erreur
   * @returns {number} Durée du circuit breaker en ms
   */
  calculateBreakTimeout(category, severity) {
    // Obtenir le timeout de base pour cette sévérité
    const baseTimeout = this.defaultTimeouts[severity] || this.defaultTimeouts[ErrorSeverity.MEDIUM];
    
    // Calculer le multiplicateur basé sur le nombre d'erreurs consécutives au-delà du seuil
    const excessErrors = this.consecutiveErrors[category] - this.thresholds[category];
    const multiplier = Math.min(Math.pow(2, excessErrors), 8); // Max 8x
    
    return baseTimeout * multiplier;
  }
  
  /**
   * Réinitialise un circuit breaker
   * @param {string} category - Catégorie du circuit breaker à réinitialiser
   */
  resetCircuitBreaker(category) {
    if (this.circuitBreakers[category]) {
      this.circuitBreakers[category].tripped = false;
      this.circuitBreakers[category].until = null;
      this.consecutiveErrors[category] = 0;
      
      logger.info(`Circuit breaker réinitialisé pour ${category}`);
    }
  }
  
  /**
   * Réinitialise le compteur d'erreurs consécutives pour une catégorie
   * @param {string} category - Catégorie d'erreur
   */
  resetErrorCount(category) {
    if (this.consecutiveErrors[category] !== undefined) {
      this.consecutiveErrors[category] = 0;
      
      // Si le circuit breaker était déclenché, le réinitialiser
      if (this.circuitBreakers[category]?.tripped) {
        this.resetCircuitBreaker(category);
      }
    }
  }
  
  /**
   * Vérifie si un circuit breaker est actif
   * @param {string} category - Catégorie d'erreur
   * @returns {boolean} True si le circuit breaker est actif
   */
  isCircuitBroken(category) {
    return this.circuitBreakers[category]?.tripped || false;
  }
  
  /**
   * Génère des étapes de récupération basées sur la catégorie et la sévérité
   * @param {string} category - Catégorie d'erreur
   * @param {number} severity - Sévérité de l'erreur
   * @returns {Array<string>} Étapes de récupération
   */
  generateRecoverySteps(category, severity) {
    // Récupération générale
    const steps = ["Vérifier les journaux pour plus de détails"];
    
    // Étapes spécifiques à la catégorie
    switch (category) {
      case ErrorCategory.API:
        steps.push("Vérifier la connexion internet");
        steps.push("Vérifier l'état des services API externes");
        
        if (severity >= ErrorSeverity.HIGH) {
          steps.push("Vérifier les quotas et limites d'API");
          steps.push("Utiliser une API alternative si disponible");
        }
        
        if (severity >= ErrorSeverity.CRITICAL) {
          steps.push("Arrêter temporairement les opérations dépendant de cette API");
          steps.push("Contacter le support technique de l'API");
        }
        break;
        
      case ErrorCategory.BLOCKCHAIN:
        steps.push("Vérifier la connexion au fournisseur RPC");
        steps.push("Vérifier le solde du wallet et les frais de gaz");
        
        if (severity >= ErrorSeverity.HIGH) {
          steps.push("Basculer vers un fournisseur RPC alternatif");
          steps.push("Augmenter les frais de priorité pour les transactions");
        }
        
        if (severity >= ErrorSeverity.CRITICAL) {
          steps.push("Suspendre les opérations blockchain non critiques");
          steps.push("Vérifier l'état global du réseau blockchain");
        }
        break;
        
      case ErrorCategory.TRADING:
        steps.push("Vérifier les paramètres de trading (slippage, gaz)");
        steps.push("Vérifier l'état des routes de swap");
        
        if (severity >= ErrorSeverity.HIGH) {
          steps.push("Réduire les montants des transactions");
          steps.push("Augmenter le slippage pour les tokens à faible liquidité");
        }
        
        if (severity >= ErrorSeverity.CRITICAL) {
          steps.push("Suspendre le trading automatique");
          steps.push("Vérifier les positions ouvertes pour clôture manuelle");
        }
        break;
        
      case ErrorCategory.DATABASE:
        steps.push("Vérifier la connexion à la base de données");
        steps.push("Vérifier les permissions de l'utilisateur DB");
        
        if (severity >= ErrorSeverity.HIGH) {
          steps.push("Redémarrer les services de base de données");
          steps.push("Vérifier l'espace disque disponible");
        }
        
        if (severity >= ErrorSeverity.CRITICAL) {
          steps.push("Restaurer depuis la dernière sauvegarde valide");
          steps.push("Contacter l'administrateur de base de données");
        }
        break;
        
      case ErrorCategory.SYSTEM:
      default:
        steps.push("Vérifier les ressources système (CPU, mémoire, disque)");
        steps.push("Vérifier les permissions des fichiers et dossiers");
        
        if (severity >= ErrorSeverity.HIGH) {
          steps.push("Redémarrer le service/l'application");
          steps.push("Vérifier les journaux système");
        }
        
        if (severity >= ErrorSeverity.CRITICAL) {
          steps.push("Effectuer une sauvegarde des données critiques");
          steps.push("Restaurer à un état connu fonctionnel");
        }
    }
    
    return steps;
  }
  
  /**
   * Déclenche des alertes pour les erreurs graves
   * @param {Error} error - L'erreur qui a déclenché l'alerte
   * @param {string} category - Catégorie d'erreur
   * @param {number} severity - Sévérité de l'erreur
   * @param {Object} context - Informations contextuelles
   * @param {boolean} circuitBroken - Si un circuit breaker a été déclenché
   */
  triggerAlerts(error, category, severity, context, circuitBroken) {
    const alert = {
      timestamp: new Date(),
      message: error.message,
      category,
      severity,
      context,
      circuitBroken
    };
    
    // Log l'alerte (toujours)
    const emoji = severity === ErrorSeverity.CRITICAL ? '🚨' : '⚠️';
    logger.warn(`${emoji} ALERTE: ${alert.message} [${category}]`);
    
    // Notifier les abonnés aux alertes
    for (const subscriber of this.alertSubscribers) {
      try {
        subscriber(alert);
      } catch (err) {
        logger.error(`Erreur lors de la notification d'alerte: ${err.message}`);
      }
    }
    
    // TODO: Implémenter d'autres canaux d'alerte (email, webhook, etc.)
    // Si configuration présente dans config
    if (config.get('ALERT_WEBHOOK')) {
      this.sendWebhookAlert(alert);
    }
  }
  
  /**
   * Envoie une alerte via webhook
   * @param {Object} alert - Données d'alerte
   */
  async sendWebhookAlert(alert) {
    // Placeholder pour l'implémentation de webhooks
    // Serait implémenté avec fetch ou axios
    logger.debug('Envoi d\'alerte via webhook', alert);
  }
  
  /**
   * S'abonne aux alertes d'erreur
   * @param {Function} subscriber - Fonction appelée lors d'une alerte
   * @returns {Function} Fonction pour se désabonner
   */
  subscribeToAlerts(subscriber) {
    if (typeof subscriber !== 'function') {
      throw new Error('Le souscripteur d\'alerte doit être une fonction');
    }
    
    this.alertSubscribers.push(subscriber);
    
    // Retourner la fonction de désabonnement
    return () => {
      this.alertSubscribers = this.alertSubscribers.filter(s => s !== subscriber);
    };
  }
  
  /**
   * Obtient les statistiques d'erreur
   * @returns {Object} Statistiques d'erreur
   */
  getErrorStats() {
    // Calcul des statistiques sur les erreurs récentes
    const last24h = this.getErrorsInTimeRange(24 * 60 * 60 * 1000);
    const last1h = this.getErrorsInTimeRange(60 * 60 * 1000);
    
    return {
      counts: { ...this.errorCounts },
      circuitBreakers: { ...this.circuitBreakers },
      recent: {
        last24h: {
          total: last24h.length,
          byCategory: this.countByCategory(last24h),
          bySeverity: this.countBySeverity(last24h)
        },
        last1h: {
          total: last1h.length,
          byCategory: this.countByCategory(last1h),
          bySeverity: this.countBySeverity(last1h)
        }
      },
      // Compter les occurrences des erreurs similaires pour trouver les plus fréquentes
      frequentErrors: this.findFrequentErrors(last24h)
    };
  }
  
  /**
   * Obtient les erreurs dans une plage de temps
   * @param {number} timeRange - Plage de temps en ms
   * @returns {Array} Erreurs dans la plage de temps
   */
  getErrorsInTimeRange(timeRange) {
    const now = new Date();
    const cutoff = new Date(now.getTime() - timeRange);
    
    return this.errorHistory.filter(error => error.timestamp >= cutoff);
  }
  
  /**
   * Compte les erreurs par catégorie
   * @param {Array} errors - Liste d'erreurs
   * @returns {Object} Comptage par catégorie
   */
  countByCategory(errors) {
    const result = {};
    
    for (const category of Object.values(ErrorCategory)) {
      result[category] = errors.filter(e => e.category === category).length;
    }
    
    return result;
  }
  
  /**
   * Compte les erreurs par sévérité
   * @param {Array} errors - Liste d'erreurs
   * @returns {Object} Comptage par sévérité
   */
  countBySeverity(errors) {
    const result = {
      [ErrorSeverity.CRITICAL]: 0,
      [ErrorSeverity.HIGH]: 0,
      [ErrorSeverity.MEDIUM]: 0,
      [ErrorSeverity.LOW]: 0
    };
    
    for (const error of errors) {
      if (result[error.severity] !== undefined) {
        result[error.severity]++;
      }
    }
    
    return result;
  }
  
  /**
   * Trouve les erreurs les plus fréquentes
   * @param {Array} errors - Liste d'erreurs
   * @returns {Array} Erreurs les plus fréquentes
   */
  findFrequentErrors(errors) {
    const counts = {};
    
    // Compter les occurrences par hash
    for (const error of errors) {
      if (!counts[error.hash]) {
        counts[error.hash] = {
          hash: error.hash,
          message: error.message,
          category: error.category,
          count: 0,
          lastOccurrence: error.timestamp
        };
      }
      
      counts[error.hash].count++;
      
      // Mettre à jour la dernière occurrence si plus récente
      if (error.timestamp > counts[error.hash].lastOccurrence) {
        counts[error.hash].lastOccurrence = error.timestamp;
      }
    }
    
    // Convertir en tableau et trier par fréquence
    return Object.values(counts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5); // Retourner les 5 plus fréquentes
  }
}

// Exporter une instance singleton
export default new ErrorHandler();