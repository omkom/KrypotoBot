// src/services/dbMonitor.js
import logger from './logger.js';
import config from '../config/index.js';
import mongoService from './mongodb.js';
import redisService from './redis.js';

/**
 * Service de monitoring des performances des bases de données
 * avec collecte de métriques et alertes automatiques
 */
class DatabaseMonitor {
  constructor() {
    this.monitoringInterval = null;
    this.metricsHistory = {
      mongodb: [],
      redis: []
    };
    this.alertThresholds = {
      errorRate: config.get('DB_ALERT_ERROR_RATE') || 5, // 5% taux d'erreur
      responseTime: config.get('DB_ALERT_RESPONSE_TIME') || 500, // 500ms temps de réponse
      reconnects: config.get('DB_ALERT_RECONNECTS') || 3  // 3 reconnexions en 10 minutes
    };
    this.alertsTriggered = {
      mongodb: new Set(),
      redis: new Set()
    };
    
    // Initialiser le monitoring
    this.initialize();
  }
  
  /**
   * Initialise le monitoring des bases de données
   */
  initialize() {
    // Récupérer l'intervalle de la configuration (défaut 60 secondes)
    const interval = config.get('DB_MONITOR_INTERVAL') || 60000;
    
    logger.info(`Initialisation du monitoring de bases de données (intervalle: ${interval/1000}s)`);
    
    // Démarrer la collecte périodique
    this.monitoringInterval = setInterval(() => {
      this.collectMetrics();
    }, interval);
    
    // Collecter immédiatement les premières métriques
    this.collectMetrics();
  }
  
  /**
   * Collecte les métriques de toutes les BDs et analyse les performances
   */
  async collectMetrics() {
    try {
      // Collecter métriques MongoDB
      const mongoMetrics = mongoService.getMetrics();
      
      // Collecter métriques Redis
      const redisMetrics = redisService.getMetrics();
      
      // Ajouter timestamp pour l'historique
      const timestamp = Date.now();
      
      // Stocker dans l'historique (limiter à 1000 points pour éviter fuite mémoire)
      this.metricsHistory.mongodb.push({
        ...mongoMetrics,
        timestamp
      });
      
      this.metricsHistory.redis.push({
        ...redisMetrics,
        timestamp
      });
      
      // Limiter la taille de l'historique
      if (this.metricsHistory.mongodb.length > 1000) {
        this.metricsHistory.mongodb.shift();
      }
      
      if (this.metricsHistory.redis.length > 1000) {
        this.metricsHistory.redis.shift();
      }
      
      // Analyser les métriques pour détecter les problèmes
      this.analyzeMetrics();
      
      // Log détaillé en mode debug
      if (config.get('DEBUG')) {
        logger.debug('Métriques des bases de données collectées', {
          mongodb: this.summarizeMetrics(mongoMetrics),
          redis: this.summarizeMetrics(redisMetrics)
        });
      }
    } catch (error) {
      logger.error(`Erreur lors de la collecte des métriques de BD: ${error.message}`);
    }
  }
  
  /**
   * Résume les métriques pour le logging (évite trop de données)
   * @param {Object} metrics - Métriques complètes
   * @returns {Object} Métriques résumées
   */
  summarizeMetrics(metrics) {
    // Extraire uniquement les champs importants
    const { isConnected, errors, errorRate, avgQueryTime, avgCommandTime } = metrics;
    
    return {
      isConnected,
      errors,
      errorRate: errorRate?.toFixed(2) + '%',
      avgResponseTime: (avgQueryTime || avgCommandTime || 0).toFixed(2) + 'ms'
    };
  }
  
  /**
   * Analyse les métriques pour détecter des problèmes de performance
   */
  analyzeMetrics() {
    // Analyser MongoDB
    this.analyzeDbMetrics('mongodb');
    
    // Analyser Redis
    this.analyzeDbMetrics('redis');
  }
  
  /**
   * Analyse les métriques d'une base de données spécifique
   * @param {string} dbType - Type de base de données ('mongodb' ou 'redis')
   */
  analyzeDbMetrics(dbType) {
    if (this.metricsHistory[dbType].length < 2) {
      return; // Pas assez de données pour l'analyse
    }
    
    // Obtenir les métriques actuelles
    const currentMetrics = this.metricsHistory[dbType][this.metricsHistory[dbType].length - 1];
    
    // Vérifier la connexion
    if (!currentMetrics.isConnected) {
      this.triggerAlert(dbType, 'connection', `${dbType} déconnecté`);
      return;
    }
    
    // Vérifier le taux d'erreur
    if (currentMetrics.errorRate > this.alertThresholds.errorRate) {
      this.triggerAlert(
        dbType, 
        'error_rate', 
        `Taux d'erreur ${dbType} élevé: ${currentMetrics.errorRate.toFixed(2)}% (seuil: ${this.alertThresholds.errorRate}%)`
      );
    }
    
    // Vérifier le temps de réponse moyen
    const avgResponseTime = dbType === 'mongodb' ? currentMetrics.avgQueryTime : currentMetrics.avgCommandTime;
    
    if (avgResponseTime > this.alertThresholds.responseTime) {
      this.triggerAlert(
        dbType, 
        'response_time', 
        `Temps de réponse ${dbType} lent: ${avgResponseTime.toFixed(2)}ms (seuil: ${this.alertThresholds.responseTime}ms)`
      );
    }
    
    // Vérifier les reconnexions fréquentes (dans les 10 dernières minutes)
    const reconnectsIn10Min = this.countReconnects(dbType, 10 * 60 * 1000);
    if (reconnectsIn10Min >= this.alertThresholds.reconnects) {
      this.triggerAlert(
        dbType, 
        'reconnects', 
        `Reconnexions ${dbType} fréquentes: ${reconnectsIn10Min} en 10 minutes (seuil: ${this.alertThresholds.reconnects})`
      );
    }
    
    // Analyse supplémentaire pour Redis
    if (dbType === 'redis' && currentMetrics.cacheHitRate !== undefined) {
      // Vérifier le taux de hits du cache
      if (currentMetrics.cacheHitRate < 70) { // Seuil de 70% pour le cache hit rate
        this.triggerAlert(
          dbType, 
          'cache_hit_rate', 
          `Taux de hit cache Redis bas: ${currentMetrics.cacheHitRate.toFixed(2)}% (optimal: >70%)`
        );
      }
    }
  }
  
  /**
   * Compte le nombre de reconnexions dans une période donnée
   * @param {string} dbType - Type de base de données
   * @param {number} timeWindowMs - Fenêtre de temps en millisecondes
   * @returns {number} Nombre de reconnexions
   */
  countReconnects(dbType, timeWindowMs) {
    const now = Date.now();
    const timeThreshold = now - timeWindowMs;
    
    // Filtrer les métriques dans la fenêtre de temps
    const recentMetrics = this.metricsHistory[dbType].filter(
      metric => metric.timestamp >= timeThreshold
    );
    
    // Compter les reconnexions (sur lastReconnectTime)
    let reconnectCount = 0;
    
    for (const metric of recentMetrics) {
      if (metric.lastReconnectTime && metric.lastReconnectTime >= timeThreshold) {
        reconnectCount++;
      }
    }
    
    return reconnectCount;
  }
  
  /**
   * Déclenche une alerte pour un problème détecté
   * @param {string} dbType - Type de base de données
   * @param {string} alertType - Type d'alerte
   * @param {string} message - Message d'alerte
   */
  triggerAlert(dbType, alertType, message) {
    const alertKey = `${dbType}:${alertType}`;
    
    // Éviter les alertes répétées pour le même problème
    // (ne pas alerter plus d'une fois par minute pour le même problème)
    if (this.alertsTriggered[dbType].has(alertType)) {
      return;
    }
    
    // Enregistrer l'alerte
    this.alertsTriggered[dbType].add(alertType);
    
    // Logger l'alerte
    logger.warn(`⚠️ ALERTE BD: ${message}`);
    
    // Programmer la réinitialisation de l'alerte après 1 minute
    setTimeout(() => {
      this.alertsTriggered[dbType].delete(alertType);
    }, 60000);
    
    // Ici, on pourrait implémenter d'autres mécanismes de notification
    // comme l'envoi d'e-mails, webhook Discord, etc.
  }
  
  /**
   * Obtient un rapport détaillé des performances
   * @returns {Object} Rapport de performances
   */
  getPerformanceReport() {
    // Obtenir les métriques actuelles
    const mongoLatest = this.metricsHistory.mongodb.length > 0 
      ? this.metricsHistory.mongodb[this.metricsHistory.mongodb.length - 1] 
      : null;
      
    const redisLatest = this.metricsHistory.redis.length > 0 
      ? this.metricsHistory.redis[this.metricsHistory.redis.length - 1] 
      : null;
    
    // Calculer les métriques sur 1 heure
    const hourAgo = Date.now() - (60 * 60 * 1000);
    
    // Filtrer les métriques de la dernière heure
    const mongoLastHour = this.metricsHistory.mongodb.filter(m => m.timestamp >= hourAgo);
    const redisLastHour = this.metricsHistory.redis.filter(m => m.timestamp >= hourAgo);
    
    // Calculer les statistiques
    const mongoStats = this.calculateStats(mongoLastHour, 'avgQueryTime');
    const redisStats = this.calculateStats(redisLastHour, 'avgCommandTime');
    
    return {
      timestamp: Date.now(),
      mongodb: {
        current: mongoLatest,
        hourly: {
          samples: mongoLastHour.length,
          avgResponseTime: mongoStats.avg,
          minResponseTime: mongoStats.min,
          maxResponseTime: mongoStats.max,
          errorRate: this.calculateAvgErrorRate(mongoLastHour),
          reconnects: this.countReconnects('mongodb', 60 * 60 * 1000)
        }
      },
      redis: {
        current: redisLatest,
        hourly: {
          samples: redisLastHour.length,
          avgResponseTime: redisStats.avg,
          minResponseTime: redisStats.min,
          maxResponseTime: redisStats.max,
          errorRate: this.calculateAvgErrorRate(redisLastHour),
          reconnects: this.countReconnects('redis', 60 * 60 * 1000),
          avgCacheHitRate: this.calculateAvgCacheHitRate(redisLastHour)
        }
      }
    };
  }
  
  /**
   * Calcule les statistiques (min, max, avg) pour une propriété donnée
   * @param {Array} metrics - Liste de métriques
   * @param {string} property - Propriété à analyser
   * @returns {Object} Statistiques calculées
   */
  calculateStats(metrics, property) {
    if (!metrics || metrics.length === 0) {
      return { min: 0, max: 0, avg: 0 };
    }
    
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let count = 0;
    
    for (const metric of metrics) {
      const value = metric[property];
      if (value !== undefined && !isNaN(value)) {
        min = Math.min(min, value);
        max = Math.max(max, value);
        sum += value;
        count++;
      }
    }
    
    return {
      min: count > 0 ? min : 0,
      max: count > 0 ? max : 0,
      avg: count > 0 ? sum / count : 0
    };
  }
  
  /**
   * Calcule le taux d'erreur moyen
   * @param {Array} metrics - Liste de métriques
   * @returns {number} Taux d'erreur moyen
   */
  calculateAvgErrorRate(metrics) {
    if (!metrics || metrics.length === 0) {
      return 0;
    }
    
    let sum = 0;
    let count = 0;
    
    for (const metric of metrics) {
      if (metric.errorRate !== undefined && !isNaN(metric.errorRate)) {
        sum += metric.errorRate;
        count++;
      }
    }
    
    return count > 0 ? sum / count : 0;
  }
  
  /**
   * Calcule le taux de hit du cache moyen
   * @param {Array} metrics - Liste de métriques Redis
   * @returns {number} Taux de hit moyen
   */
  calculateAvgCacheHitRate(metrics) {
    if (!metrics || metrics.length === 0) {
      return 0;
    }
    
    let sum = 0;
    let count = 0;
    
    for (const metric of metrics) {
      if (metric.cacheHitRate !== undefined && !isNaN(metric.cacheHitRate)) {
        sum += metric.cacheHitRate;
        count++;
      }
    }
    
    return count > 0 ? sum / count : 0;
  }
  
  /**
   * Arrête le monitoring
   */
  stop() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      logger.info('Monitoring des bases de données arrêté');
    }
  }
}

// Exporter une instance unique
export default new DatabaseMonitor();