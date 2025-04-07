// src/services/errorHandler.js
import logger from './logger.js';
import config from '../config/index.js';

/**
 * Niveaux de sévérité des erreurs
 * Permet une classification précise pour des réponses adaptées
 * @enum {number}
 */
export const ErrorSeverity = {
  CRITICAL: 3,  // Erreur critique nécessitant une attention immédiate, le système ne peut continuer
  HIGH: 2,      // Erreur majeure affectant une fonctionnalité, mais le système peut continuer partiellement
  MEDIUM: 1,    // Erreur modérée avec impact limité sur les fonctionnalités
  LOW: 0        // Erreur mineure sans impact significatif sur les fonctionnalités
};

/**
 * Système avancé de gestion d'erreurs avec classification,
 * circuit breakers, et mécanismes de récupération automatique
 */
class ErrorHandler {
  /**
   * Initialise le gestionnaire d'erreurs avec compteurs et seuils configurables
   */
  constructor() {
    // Suivi des erreurs par catégorie pour analyse
    this.errorStats = {
      api: { count: 0, lastOccurred: null },
      blockchain: { count: 0, lastOccurred: null },
      trading: { count: 0, lastOccurred: null },
      database: { count: 0, lastOccurred: null },
      system: { count: 0, lastOccurred: null }
    };
    
    // Compteurs d'erreurs consécutives pour le circuit breaking
    this.consecutiveErrors = {
      api: 0,
      blockchain: 0,
      trading: 0,
      database: 0
    };
    
    // Seuils de déclenchement des circuit breakers
    this.circuitBreakerThresholds = {
      api: 5,         // Break après 5 erreurs API consécutives
      blockchain: 3,   // Break après 3 erreurs blockchain consécutives
      trading: 3,      // Break après 3 erreurs de trading consécutives
      database: 3      // Break après 3 erreurs de base de données consécutives
    };
    
    // État des circuit breakers
    this.circuitStatus = {
      api: { broken: false, until: null },
      blockchain: { broken: false, until: null },
      trading: { broken: false, until: null },
      database: { broken: false, until: null }
    };
  }
  
  /**
   * Traite une erreur avec journalisation adaptée et mécanismes de récupération
   * @param {Error} error - L'objet d'erreur
   * @param {string} category - Catégorie d'erreur (api, blockchain, trading, system, database)
   * @param {number} severity - Sévérité de l'erreur (ErrorSeverity enum)
   * @param {Object} context - Contexte supplémentaire sur l'erreur
   * @returns {Object} Résultat du traitement incluant des étapes de récupération
   */
  handleError(error, category = 'system', severity = ErrorSeverity.MEDIUM, context = {}) {
    // Mise à jour des statistiques d'erreur
    if (this.errorStats[category]) {
      this.errorStats[category].count++;
      this.errorStats[category].lastOccurred = new Date();
    }
    
    // Mise à jour des compteurs d'erreurs consécutives pour les catégories critiques
    if (['api', 'blockchain', 'trading', 'database'].includes(category)) {
      this.consecutiveErrors[category]++;
    }
    
    // Journalisation avec niveau approprié
    const errorMessage = `[${category.toUpperCase()}] ${error.message}`;
    switch (severity) {
      case ErrorSeverity.CRITICAL:
        logger.error(`CRITIQUE: ${errorMessage}`, error);
        break;
      case ErrorSeverity.HIGH:
        logger.error(`HAUTE: ${errorMessage}`, error);
        break;
      case ErrorSeverity.MEDIUM:
        logger.warn(`MOYENNE: ${errorMessage}`);
        break;
      case ErrorSeverity.LOW:
        logger.debug(`BASSE: ${errorMessage}`);
        break;
    }
    
    // Vérifier si un circuit breaker doit être déclenché
    const circuitBroken = this.checkCircuitBreaker(category);
    
    // Générer des étapes de récupération selon la catégorie et la sévérité
    const recoverySteps = this.generateRecoverySteps(category, severity, circuitBroken);
    
    // Pour les erreurs critiques, déclencher des alertes
    if (severity === ErrorSeverity.CRITICAL) {
      this.triggerAlert(errorMessage, category, context);
    }
    
    // Retourner le résultat du traitement
    return {
      handled: true,
      severity,
      category,
      circuitBroken,
      recoverySteps,
      error: {
        message: error.message,
        stack: config.get('DEBUG') ? error.stack : undefined,
        context
      }
    };
  }
  
  /**
   * Vérifie si un circuit breaker doit être déclenché
   * @param {string} category - Catégorie d'erreur
   * @returns {boolean} Si le circuit breaker a été déclenché
   */
  checkCircuitBreaker(category) {
    // Ignorer si la catégorie n'a pas de circuit breaker
    if (!this.circuitBreakerThresholds[category]) return false;
    
    // Vérifier si déjà déclenché
    if (this.circuitStatus[category].broken) {
      // Vérifier si le délai de refroidissement est expiré
      if (this.circuitStatus[category].until && Date.now() > this.circuitStatus[category].until) {
        // Réinitialiser le circuit breaker
        this.circuitStatus[category].broken = false;
        this.circuitStatus[category].until = null;
        this.consecutiveErrors[category] = 0;
        logger.info(`Circuit breaker pour ${category} réinitialisé après période de refroidissement`);
        return false;
      }
      return true; // Toujours déclenché
    }
    
    // Vérifier si nous devons déclencher le breaker
    if (this.consecutiveErrors[category] >= this.circuitBreakerThresholds[category]) {
      // Déclencher avec délai de refroidissement exponentiel basé sur la fréquence
      const backoffMinutes = Math.min(
        5 * Math.pow(2, Math.floor(this.consecutiveErrors[category] / this.circuitBreakerThresholds[category])), 
        60 // Plafonner à 60 minutes
      );
      
      this.circuitStatus[category].broken = true;
      this.circuitStatus[category].until = Date.now() + (backoffMinutes * 60 * 1000);
      
      logger.warn(`Circuit breaker déclenché pour ${category} pour ${backoffMinutes} minutes suite à ${this.consecutiveErrors[category]} erreurs consécutives`);
      return true;
    }
    
    return false;
  }
  
  /**
   * Génère des étapes de récupération basées sur la catégorie et la sévérité de l'erreur
   * @param {string} category - Catégorie d'erreur
   * @param {number} severity - Sévérité de l'erreur
   * @param {boolean} circuitBroken - Si un circuit breaker a été déclenché
   * @returns {Array<string>} Étapes de récupération
   */
  generateRecoverySteps(category, severity, circuitBroken) {
    const steps = [];
    
    if (circuitBroken) {
      const cooldownMs = this.circuitStatus[category].until - Date.now();
      const cooldownMinutes = Math.ceil(cooldownMs / 60000);
      steps.push(`Attendre la fin du circuit breaker: ${cooldownMinutes} minutes`);
    }
    
    switch (category) {
      case 'api':
        steps.push('Vérifier la santé et les limites de l\'API');
        steps.push('Vérifier les identifiants et permissions API');
        if (severity >= ErrorSeverity.HIGH) {
          steps.push('Basculer vers un endpoint API alternatif si disponible');
        }
        break;
        
      case 'blockchain':
        steps.push('Vérifier la connectivité RPC');
        steps.push('Vérifier le solde du wallet et les permissions');
        if (severity >= ErrorSeverity.HIGH) {
          steps.push('Basculer vers un fournisseur RPC alternatif');
          steps.push('Vérifier le statut de confirmation des transactions');
        }
        break;
        
      case 'trading':
        steps.push('Vérifier la validité du contrat token');
        steps.push('Vérifier la liquidité suffisante');
        steps.push('Ajuster les paramètres de slippage');
        if (severity >= ErrorSeverity.HIGH) {
          steps.push('Suspendre temporairement le trading');
          steps.push('Réviser les paramètres de trading');
        }
        break;
        
      case 'database':
        steps.push('Vérifier la connectivité à la base de données');
        if (severity >= ErrorSeverity.HIGH) {
          steps.push('Redémarrer les services de base de données');
          steps.push('Vérifier l\'espace disque et les ressources système');
        }
        break;
        
      case 'system':
        steps.push('Vérifier les ressources système (mémoire, CPU, disque)');
        if (severity >= ErrorSeverity.HIGH) {
          steps.push('Redémarrer l\'application');
          steps.push('Vérifier les mises à jour système ou problèmes de configuration');
        }
        break;
    }
    
    return steps;
  }
  
  /**
   * Réinitialise le compteur d'erreurs consécutives pour une catégorie
   * @param {string} category - Catégorie d'erreur à réinitialiser
   */
  resetErrorCount(category) {
    if (this.consecutiveErrors[category] !== undefined) {
      this.consecutiveErrors[category] = 0;
      
      // Réinitialiser aussi le circuit breaker s'il était déclenché
      if (this.circuitStatus[category]?.broken) {
        this.circuitStatus[category].broken = false;
        this.circuitStatus[category].until = null;
        logger.info(`Circuit breaker pour ${category} réinitialisé manuellement`);
      }
    }
  }
  
  /**
   * Vérifie si un circuit breaker est actif pour une catégorie
   * @param {string} category - Catégorie d'erreur à vérifier
   * @returns {boolean} Si le circuit est rompu
   */
  isCircuitBroken(category) {
    return this.circuitStatus[category]?.broken || false;
  }
  
  /**
   * Déclenche une alerte pour les erreurs critiques
   * @param {string} message - Message d'erreur
   * @param {string} category - Catégorie d'erreur
   * @param {Object} context - Contexte d'erreur
   */
  triggerAlert(message, category, context) {
    // Dans un environnement de production, envoi vers un système d'alerte
    // Ici nous nous contentons de logger de manière visible
    logger.error(`🚨 ALERTE: ${message}`, { category, context });
    
    // TODO: Implémenter l'envoi vers un webhook, email, etc. pour les alertes externes
    // if (config.get('ALERT_WEBHOOK')) { ... }
  }
  
  /**
   * Récupère les statistiques d'erreur pour le monitoring
   * @returns {Object} Statistiques d'erreur
   */
  getErrorStats() {
    return {
      ...this.errorStats,
      circuitStatus: this.circuitStatus,
      consecutiveErrors: this.consecutiveErrors
    };
  }
}

// Exporter une instance singleton
export default new ErrorHandler();