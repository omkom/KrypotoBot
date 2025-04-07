// src/core/exitStrategyManager.js
import logger from '../services/logger.js';
import config from '../config/index.js';
import { getPairInfo } from '../api/dexscreener.js';

/**
 * Gestionnaire avancé de stratégies de sortie avec trailing stops dynamiques,
 * prises de profit multi-étages, et détection de renversement de tendance
 */
class ExitStrategyManager {
  /**
   * Initialise une stratégie de sortie pour une position
   * @param {Object} position - Données de la position
   * @param {Object} baseStrategy - Paramètres de stratégie de base
   */
  constructor(position, baseStrategy = {}) {
    this.position = position;
    
    // Configuration de la stratégie de base avec valeurs par défaut
    this.strategy = {
      // Niveaux de prise de profit (% de gain)
      takeProfitLevels: baseStrategy.takeProfitLevels || [25, 50, 100],
      // Montants de prise de profit (% de la position à vendre à chaque niveau)
      takeProfitAmounts: baseStrategy.takeProfitAmounts || [0.25, 0.5, 0.25],
      // Niveau de stop loss (% de perte)
      stopLoss: baseStrategy.stopLoss || -15,
      // Paramètres du trailing stop
      trailingStop: {
        enabled: baseStrategy.trailingStopEnabled !== false,
        activationPercent: baseStrategy.trailingStopActivation || 20,
        trailPercent: baseStrategy.trailingStopTrail || 10,
        active: false,
        price: 0
      },
      // Sortie basée sur le temps (minutes)
      maxHoldTime: baseStrategy.maxHoldTime || 60,
      // Monitoring de tendance
      trendMonitoring: {
        enabled: baseStrategy.trendMonitoringEnabled !== false,
        reversalSensitivity: baseStrategy.reversalSensitivity || 3, // Échelle 1-5
        inProfitExitOnReversal: baseStrategy.exitOnReversal !== false
      },
      // Niveaux de prise de profit complétés
      completedLevels: new Set(),
      // Historique d'exécution
      executionHistory: []
    };
    
    // Suivi des prix
    this.priceHistory = [];
    this.highestPrice = position.entryPrice || 0;
    this.lowestPrice = position.entryPrice || Infinity;
    this.lastPrice = position.entryPrice || 0;
    
    // Initialisation
    this.initialize();
  }
  
  /**
   * Initialise la stratégie avec le prix d'entrée
   */
  initialize() {
    if (this.position.entryPrice) {
      this.highestPrice = this.position.entryPrice;
      this.lowestPrice = this.position.entryPrice;
      this.lastPrice = this.position.entryPrice;
      
      // Initialiser le prix du trailing stop
      if (this.strategy.trailingStop.enabled) {
        this.strategy.trailingStop.price = this.position.entryPrice * 
          (1 - (this.strategy.stopLoss / 100));
      }
      
      logger.debug(`Stratégie de sortie initialisée pour ${this.position.tokenName} avec prix d'entrée ${this.position.entryPrice}`);
    } else {
      logger.warn(`Impossible d'initialiser la stratégie de sortie: prix d'entrée manquant pour ${this.position.tokenName}`);
    }
  }
  
  /**
   * Met à jour le prix actuel du marché et les statistiques associées
   * @param {number} currentPrice - Prix actuel du token
   * @returns {Object} Métriques de prix mises à jour
   */
  updatePrice(currentPrice) {
    if (!currentPrice || currentPrice <= 0) return null;
    
    this.lastPrice = currentPrice;
    
    // Mettre à jour les prix max/min
    if (currentPrice > this.highestPrice) {
      this.highestPrice = currentPrice;
      
      // Si le trailing stop est actif, mettre à jour le prix stop
      if (this.strategy.trailingStop.active) {
        this.updateTrailingStop();
      }
    }
    
    if (currentPrice < this.lowestPrice) {
      this.lowestPrice = currentPrice;
    }
    
    // Ajouter à l'historique des prix (max 50 points)
    this.priceHistory.push({
      price: currentPrice,
      timestamp: Date.now()
    });
    
    if (this.priceHistory.length > 50) {
      this.priceHistory.shift(); // Supprimer le plus ancien
    }
    
    // Mettre à jour le ROI
    const currentRoi = this.getCurrentRoi();
    
    // Vérifier si le trailing stop doit être activé
    if (this.strategy.trailingStop.enabled && 
        !this.strategy.trailingStop.active && 
        currentRoi >= this.strategy.trailingStop.activationPercent) {
      this.activateTrailingStop();
    }
    
    return {
      price: currentPrice,
      roi: currentRoi,
      highestPrice: this.highestPrice,
      lowestPrice: this.lowestPrice,
      trailingStopActive: this.strategy.trailingStop.active,
      trailingStopPrice: this.strategy.trailingStop.price
    };
  }
  
  /**
   * Obtient le ROI actuel basé sur le prix d'entrée
   * @returns {number} Pourcentage de ROI actuel
   */
  getCurrentRoi() {
    if (!this.position.entryPrice || this.position.entryPrice === 0) return 0;
    
    return ((this.lastPrice - this.position.entryPrice) / 
      this.position.entryPrice) * 100;
  }
  
  /**
   * Active le trailing stop
   */
  activateTrailingStop() {
    this.strategy.trailingStop.active = true;
    this.updateTrailingStop();
    
    logger.debug(
      `Trailing stop activé pour ${this.position.tokenName} à ${this.lastPrice} ` +
      `(ROI: ${this.getCurrentRoi().toFixed(2)}%)`
    );
  }
  
  /**
   * Met à jour le prix du trailing stop basé sur le prix le plus haut
   */
  updateTrailingStop() {
    if (!this.strategy.trailingStop.active) return;
    
    const trailAmount = (this.strategy.trailingStop.trailPercent / 100) * this.highestPrice;
    this.strategy.trailingStop.price = this.highestPrice - trailAmount;
    
    logger.debug(
      `Trailing stop mis à jour pour ${this.position.tokenName} à ${this.strategy.trailingStop.price.toFixed(8)} ` +
      `(${this.strategy.trailingStop.trailPercent}% sous ${this.highestPrice})`
    );
  }
  
  /**
   * Détecte un renversement de tendance du prix
   * @returns {Object|null} Détails du renversement si détecté, sinon null
   */
  detectReversal() {
    // Besoin de suffisamment d'historique pour l'analyse
    if (this.priceHistory.length < 6) return null;
    
    // Récupérer les points de prix récents (6 derniers points)
    const recentPrices = this.priceHistory.slice(-6);
    
    // Calculer tendance à court terme (3 derniers points)
    const shortTermPoints = recentPrices.slice(-3);
    const shortTermStart = shortTermPoints[0].price;
    const shortTermEnd = shortTermPoints[shortTermPoints.length - 1].price;
    const shortTermChange = ((shortTermEnd - shortTermStart) / shortTermStart) * 100;
    
    // Calculer tendance à moyen terme (tous les 6 points)
    const mediumTermStart = recentPrices[0].price;
    const mediumTermChange = ((shortTermEnd - mediumTermStart) / mediumTermStart) * 100;
    
    // Détecter un renversement potentiel (tendance court terme opposée à moyen terme)
    if (Math.sign(shortTermChange) !== Math.sign(mediumTermChange) && 
        Math.abs(shortTermChange) > 2) {
      
      const sensitivity = this.strategy.trendMonitoring.reversalSensitivity;
      const significanceThreshold = 6 - sensitivity; // Sensibilité plus élevée = seuil plus bas
      
      // Ne rapporter que les renversements significatifs
      if (Math.abs(shortTermChange) >= significanceThreshold) {
        return {
          detected: true,
          shortTermChange,
          mediumTermChange,
          severity: Math.min(5, Math.floor(Math.abs(shortTermChange) / 2)), // Échelle 1-5
          timestamp: Date.now()
        };
      }
    }
    
    return null;
  }

  /**
   * Vérifie si des niveaux de prise de profit ont été atteints
   * @returns {Object|null} Détails de prise de profit si déclenchée, sinon null
   */
  checkTakeProfitLevels() {
    const currentRoi = this.getCurrentRoi();
    
    // Si pas en profit, pas de prise de profit à vérifier
    if (currentRoi <= 0) return null;
    
    // Vérifier chaque niveau de prise de profit non complété
    for (let i = 0; i < this.strategy.takeProfitLevels.length; i++) {
      const level = this.strategy.takeProfitLevels[i];
      
      // Ignorer les niveaux déjà complétés
      if (this.strategy.completedLevels.has(level)) continue;
      
      // Vérifier si ce niveau a été atteint
      if (currentRoi >= level) {
        const sellAmount = this.strategy.takeProfitAmounts[i] * this.position.amount;
        
        return {
          triggered: true,
          level,
          roi: currentRoi,
          sellAmount,
          sellPortion: this.strategy.takeProfitAmounts[i],
          reason: `Niveau de prise de profit ${level}% atteint (${currentRoi.toFixed(2)}%)`,
          type: 'TAKE_PROFIT'
        };
      }
    }
    
    return null;
  }
  
  /**
   * Vérifie si le stop loss a été déclenché
   * @returns {Object|null} Détails du stop loss si déclenché, sinon null
   */
  checkStopLoss() {
    const currentRoi = this.getCurrentRoi();
    
    // Vérifier si le ROI est sous le niveau de stop loss
    if (currentRoi <= this.strategy.stopLoss) {
      return {
        triggered: true,
        level: this.strategy.stopLoss,
        roi: currentRoi,
        sellAmount: this.position.amount, // Vendre toute la position
        sellPortion: 1.0,
        reason: `Stop Loss déclenché à ${currentRoi.toFixed(2)}% (seuil: ${this.strategy.stopLoss}%)`,
        type: 'STOP_LOSS'
      };
    }
    
    return null;
  }
  
  /**
   * Vérifie si le trailing stop a été déclenché
   * @returns {Object|null} Détails du trailing stop si déclenché, sinon null
   */
  checkTrailingStop() {
    // Vérifier uniquement si le trailing stop est actif
    if (!this.strategy.trailingStop.active) return null;
    
    // Vérifier si le prix est tombé sous le niveau du trailing stop
    if (this.lastPrice <= this.strategy.trailingStop.price) {
      const currentRoi = this.getCurrentRoi();
      
      return {
        triggered: true,
        level: this.strategy.trailingStop.price,
        roi: currentRoi,
        sellAmount: this.position.amount, // Vendre toute la position
        sellPortion: 1.0,
        reason: `Trailing Stop déclenché à ${this.lastPrice.toFixed(8)} (${currentRoi.toFixed(2)}%)`,
        type: 'TRAILING_STOP'
      };
    }
    
    return null;
  }
  
  /**
   * Vérifie si le temps maximum de détention a été atteint
   * @returns {Object|null} Détails de sortie temporelle si déclenchée, sinon null
   */
  checkTimeExit() {
    if (!this.position.entryTime) return null;
    
    const holdingTimeMs = Date.now() - this.position.entryTime;
    const holdingTimeMinutes = holdingTimeMs / (1000 * 60);
    
    // Vérifier si nous avons dépassé le temps maximum de détention
    if (holdingTimeMinutes >= this.strategy.maxHoldTime) {
      const currentRoi = this.getCurrentRoi();
      
      return {
        triggered: true,
        holdingTimeMinutes,
        roi: currentRoi,
        sellAmount: this.position.amount, // Vendre toute la position
        sellPortion: 1.0,
        reason: `Temps maximum de détention atteint: ${holdingTimeMinutes.toFixed(1)} minutes (limite: ${this.strategy.maxHoldTime} min)`,
        type: 'TIME_EXIT'
      };
    }
    
    return null;
  }
  
  /**
   * Vérifie si un renversement de tendance justifie une sortie
   * @returns {Object|null} Détails de sortie de tendance si déclenchée, sinon null
   */
  checkTrendExit() {
    // Vérifier uniquement si le monitoring de tendance est activé
    if (!this.strategy.trendMonitoring.enabled) return null;
    
    // Vérifier le renversement
    const reversal = this.detectReversal();
    
    // Sortir sur renversement uniquement si en profit et renversement significatif
    if (reversal && reversal.detected && 
        this.strategy.trendMonitoring.inProfitExitOnReversal) {
      
      const currentRoi = this.getCurrentRoi();
      
      // Sortir uniquement si en profit et sévérité du renversement suffisante
      if (currentRoi > 5 && reversal.severity >= 3) {
        // Calculer portion de vente basée sur sévérité et ROI
        const sellPortion = Math.min(0.75, 0.25 * reversal.severity * (currentRoi / 20));
        const sellAmount = this.position.amount * sellPortion;
        
        return {
          triggered: true,
          reversal,
          roi: currentRoi,
          sellAmount,
          sellPortion,
          reason: `Renversement de tendance détecté (sévérité: ${reversal.severity}/5) en profit (${currentRoi.toFixed(2)}%)`,
          type: 'TREND_REVERSAL'
        };
      }
    }
    
    return null;
  }
  
  /**
   * Vérifie toutes les conditions de sortie et renvoie l'action recommandée
   * @returns {Object} Recommandation de sortie
   */
  checkExitConditions() {
    // Mettre à jour le prix actuel du marché si fonction disponible
    if (this.position.getCurrentPrice) {
      const currentPrice = this.position.getCurrentPrice();
      this.updatePrice(currentPrice);
    }
    
    // Vérifier toutes les conditions de sortie par ordre de priorité
    
    // 1. Vérifier stop loss (priorité la plus haute)
    const stopLoss = this.checkStopLoss();
    if (stopLoss) return stopLoss;
    
    // 2. Vérifier trailing stop
    const trailingStop = this.checkTrailingStop();
    if (trailingStop) return trailingStop;
    
    // 3. Vérifier niveaux de prise de profit
    const takeProfit = this.checkTakeProfitLevels();
    if (takeProfit) return takeProfit;
    
    // 4. Vérifier sortie sur renversement de tendance
    const trendExit = this.checkTrendExit();
    if (trendExit) return trendExit;
    
    // 5. Vérifier sortie temporelle (priorité la plus basse)
    const timeExit = this.checkTimeExit();
    if (timeExit) return timeExit;
    
    // Aucune condition de sortie déclenchée
    return {
      triggered: false,
      roi: this.getCurrentRoi(),
      holdingTimeMinutes: this.position.entryTime 
        ? (Date.now() - this.position.entryTime) / (1000 * 60) 
        : 0
    };
  }
  
  /**
   * Enregistre l'exécution d'une stratégie de sortie
   * @param {Object} exit - Détails de la sortie
   * @param {Object} result - Résultat de l'exécution
   * @returns {Object} Sortie enregistrée avec résultat d'exécution
   */
  recordExit(exit, result) {
    // Enregistrer dans l'historique d'exécution
    this.strategy.executionHistory.push({
      timestamp: Date.now(),
      type: exit.type,
      reason: exit.reason,
      roi: exit.roi,
      sellAmount: exit.sellAmount,
      sellPortion: exit.sellPortion,
      result: {
        success: result.success,
        actualAmount: result.amount || 0,
        solReceived: result.solReceived || 0,
        signature: result.signature || '',
        error: result.error || null
      }
    });
    
    // Si prise de profit, marquer le niveau comme complété
    if (exit.type === 'TAKE_PROFIT') {
      this.strategy.completedLevels.add(exit.level);
    }
    
    logger.debug(
      `Sortie exécutée pour ${this.position.tokenName}: ${exit.type}, ${result.success ? 'SUCCÈS' : 'ÉCHEC'}, ` +
      `ROI: ${exit.roi.toFixed(2)}%, Montant: ${exit.sellAmount}`
    );
    
    return {
      ...exit,
      executionResult: result,
      timestamp: Date.now()
    };
  }
  
  /**
   * Ajuste les paramètres de stratégie en fonction des conditions de marché
   * @param {Object} params - Nouveaux paramètres de stratégie
   * @returns {Object} Configuration de stratégie mise à jour
   */
  adjustStrategy(params = {}) {
    // Mettre à jour le stop loss
    if (params.stopLoss !== undefined && params.stopLoss < 0) {
      this.strategy.stopLoss = params.stopLoss;
    }
    
    // Mettre à jour les niveaux de prise de profit
    if (params.takeProfitLevels && Array.isArray(params.takeProfitLevels)) {
      this.strategy.takeProfitLevels = params.takeProfitLevels;
    }
    
    // Mettre à jour les montants de prise de profit
    if (params.takeProfitAmounts && Array.isArray(params.takeProfitAmounts)) {
      this.strategy.takeProfitAmounts = params.takeProfitAmounts;
    }
    
    // Mettre à jour les paramètres du trailing stop
    if (params.trailingStop) {
      if (params.trailingStop.activationPercent !== undefined) {
        this.strategy.trailingStop.activationPercent = params.trailingStop.activationPercent;
      }
      
      if (params.trailingStop.trailPercent !== undefined) {
        this.strategy.trailingStop.trailPercent = params.trailingStop.trailPercent;
        
        // Si déjà actif, mettre à jour le prix trail
        if (this.strategy.trailingStop.active) {
          this.updateTrailingStop();
        }
      }
      
      if (params.trailingStop.enabled !== undefined) {
        this.strategy.trailingStop.enabled = params.trailingStop.enabled;
      }
    }
    
    // Mettre à jour le temps max de détention
    if (params.maxHoldTime !== undefined && params.maxHoldTime > 0) {
      this.strategy.maxHoldTime = params.maxHoldTime;
    }
    
    // Mettre à jour les paramètres de monitoring des tendances
    if (params.trendMonitoring) {
      if (params.trendMonitoring.enabled !== undefined) {
        this.strategy.trendMonitoring.enabled = params.trendMonitoring.enabled;
      }
      
      if (params.trendMonitoring.reversalSensitivity !== undefined) {
        this.strategy.trendMonitoring.reversalSensitivity = params.trendMonitoring.reversalSensitivity;
      }
      
      if (params.trendMonitoring.inProfitExitOnReversal !== undefined) {
        this.strategy.trendMonitoring.inProfitExitOnReversal = params.trendMonitoring.inProfitExitOnReversal;
      }
    }
    
    logger.debug(`Stratégie ajustée pour ${this.position.tokenName}`, params);
    
    return { ...this.strategy };
  }
  
  /**
   * Obtient les paramètres de stratégie actuels et l'état
   * @returns {Object} Détails de la stratégie et état actuel
   */
  getStrategyStatus() {
    return {
      tokenName: this.position.tokenName,
      tokenAddress: this.position.tokenAddress,
      entryPrice: this.position.entryPrice,
      currentPrice: this.lastPrice,
      highestPrice: this.highestPrice,
      lowestPrice: this.lowestPrice,
      currentRoi: this.getCurrentRoi(),
      trailingStop: {
        enabled: this.strategy.trailingStop.enabled,
        active: this.strategy.trailingStop.active,
        activationPercent: this.strategy.trailingStop.activationPercent,
        trailPercent: this.strategy.trailingStop.trailPercent,
        currentPrice: this.strategy.trailingStop.price
      },
      takeProfitLevels: this.strategy.takeProfitLevels,
      completedLevels: Array.from(this.strategy.completedLevels),
      stopLoss: this.strategy.stopLoss,
      maxHoldTime: this.strategy.maxHoldTime,
      holdingTime: this.position.entryTime 
        ? (Date.now() - this.position.entryTime) / (1000 * 60) 
        : 0,
      executionHistory: this.strategy.executionHistory
    };
  }
}

// Exporter la classe
export default ExitStrategyManager;