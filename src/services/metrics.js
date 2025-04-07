/**
 * Service de gestion des métriques de trading et de performance
 * Collecte, analyse et expose les données de performance du bot
 * 
 * @module metrics
 * @requires ./logger
 */

import logger from './logger.js';
import config from '../config/index.js';

// Métriques pour les statistiques de performance du bot
const tradingMetrics = {
  // Statistiques des trades
  trades: {
    total: 0,
    successful: 0,
    failed: 0,
    active: 0
  },
  
  // Statistiques financières 
  financial: {
    totalInvested: 0,     // Total investi en SOL
    totalReturned: 0,     // Total récupéré en SOL
    walletBalance: 0,     // Solde actuel du wallet
    profitLoss: 0         // Profit/perte net
  },
  
  // Métriques de marché
  market: {
    scannedTokens: 0,
    tradeableTokens: 0,
    lastScanTime: null
  },
  
  // Historique des trades (limité aux 100 derniers)
  history: [],
  
  // Statistiques d'erreurs
  errors: {
    totalErrors: 0,
    byCategory: {
      api: 0,
      blockchain: 0,
      trading: 0,
      system: 0
    }
  },
  
  // Timestamp de démarrage du bot
  startTime: Date.now()
};

/**
 * Met à jour le solde du wallet
 * @param {number} balance - Solde actuel en SOL
 */
export function updateWalletBalance(balance) {
  tradingMetrics.financial.walletBalance = balance;
  
  // Recalculer le profit/perte
  calculateProfitLoss();
}

/**
 * Calcule les profits/pertes en tenant compte des investissements et retours
 */
function calculateProfitLoss() {
  tradingMetrics.financial.profitLoss = 
    tradingMetrics.financial.totalReturned - 
    tradingMetrics.financial.totalInvested;
}

/**
 * Enregistre un achat de token
 * @param {Object} trade - Informations sur l'achat
 */
export function recordPurchase(trade) {
  if (!trade) return;
  
  tradingMetrics.trades.total++;
  tradingMetrics.trades.active++;
  
  // Ajouter au montant total investi
  const costInSol = trade.costInSol || 0;
  tradingMetrics.financial.totalInvested += costInSol;
  
  // Recalculer profit/perte
  calculateProfitLoss();
  
  // Ajouter à l'historique
  addToHistory({
    type: 'BUY',
    tokenAddress: trade.tokenAddress,
    tokenName: trade.tokenName,
    amount: trade.amount,
    costInSol,
    timestamp: Date.now()
  });
  
  if (config.get('DEBUG')) {
    logger.debug(`Metrics: Purchase recorded for ${trade.tokenName}`);
  }
}

/**
 * Enregistre une vente de token
 * @param {Object} trade - Informations sur la vente
 */
export function recordSale(trade) {
  if (!trade) return;
  
  tradingMetrics.trades.successful++;
  tradingMetrics.trades.active = Math.max(0, tradingMetrics.trades.active - 1);
  
  // Ajouter au montant total récupéré
  const solReceived = trade.solReceived || 0;
  tradingMetrics.financial.totalReturned += solReceived;
  
  // Recalculer profit/perte
  calculateProfitLoss();
  
  // Ajouter à l'historique
  addToHistory({
    type: 'SELL',
    tokenAddress: trade.tokenAddress,
    tokenName: trade.tokenName,
    amount: trade.amount,
    solReceived,
    reason: trade.reason || 'Manual',
    timestamp: Date.now()
  });
  
  if (config.get('DEBUG')) {
    logger.debug(`Metrics: Sale recorded for ${trade.tokenName} (${solReceived} SOL)`);
  }
}

/**
 * Enregistre une opération échouée
 * @param {string} operationType - Type d'opération (buy, sell)
 * @param {Object} details - Détails de l'échec
 */
export function recordFailedOperation(operationType, details = {}) {
  tradingMetrics.trades.failed++;
  tradingMetrics.errors.totalErrors++;
  
  // Incrémenter le compteur d'erreurs par catégorie
  const category = details.category || 'system';
  if (tradingMetrics.errors.byCategory[category] !== undefined) {
    tradingMetrics.errors.byCategory[category]++;
  }
  
  // Ajouter à l'historique
  addToHistory({
    type: 'FAIL',
    operation: operationType,
    tokenAddress: details.tokenAddress,
    tokenName: details.tokenName,
    error: details.error,
    timestamp: Date.now()
  });
}

/**
 * Met à jour le nombre de trades actifs
 * @param {number} count - Nombre de trades actifs
 */
export function updateActiveTrades(count) {
  tradingMetrics.trades.active = count;
}

/**
 * Enregistre les résultats d'un scan de marché
 * @param {number} tradeableCount - Nombre de tokens négociables trouvés
 * @param {number} totalScanned - Nombre total de tokens scannés
 */
export function recordScanResults(tradeableCount, totalScanned) {
  tradingMetrics.market.scannedTokens = totalScanned;
  tradingMetrics.market.tradeableTokens = tradeableCount;
  tradingMetrics.market.lastScanTime = Date.now();
}

/**
 * Ajoute un élément à l'historique des trades
 * @param {Object} item - Élément à ajouter
 */
function addToHistory(item) {
  // Ajouter au début de l'historique
  tradingMetrics.history.unshift(item);
  
  // Limiter la taille de l'historique
  if (tradingMetrics.history.length > 100) {
    tradingMetrics.history.pop();
  }
}

/**
 * Obtient les statistiques complètes de trading
 * @returns {Object} Statistiques complètes
 */
export function getStats() {
  // Calcul des statistiques supplémentaires
  const now = Date.now();
  const uptime = now - tradingMetrics.startTime;
  const uptimeHours = uptime / (1000 * 60 * 60);
  
  // Calcul de la performance 
  let hourlyProfitRate = 0;
  if (uptimeHours > 0) {
    hourlyProfitRate = tradingMetrics.financial.profitLoss / uptimeHours;
  }
  
  // Retourner statistiques avec métriques calculées
  return {
    ...tradingMetrics,
    
    // Métriques dérivées
    performance: {
      uptime,
      uptimeHours,
      tradesPerHour: uptimeHours > 0 ? tradingMetrics.trades.total / uptimeHours : 0,
      successRate: tradingMetrics.trades.total > 0 ? 
        (tradingMetrics.trades.successful / tradingMetrics.trades.total) * 100 : 0,
      profitLossPercent: tradingMetrics.financial.totalInvested > 0 ?
        (tradingMetrics.financial.profitLoss / tradingMetrics.financial.totalInvested) * 100 : 0,
      hourlyProfitRate
    }
  };
}

/**
 * Réinitialise toutes les métriques (utilisé principalement pour les tests)
 */
export function resetMetrics() {
  // Réinitialiser les compteurs de trades
  tradingMetrics.trades.total = 0;
  tradingMetrics.trades.successful = 0;
  tradingMetrics.trades.failed = 0;
  tradingMetrics.trades.active = 0;
  
  // Réinitialiser les métriques financières
  tradingMetrics.financial.totalInvested = 0;
  tradingMetrics.financial.totalReturned = 0;
  tradingMetrics.financial.profitLoss = 0;
  
  // Conserver le solde du wallet
  
  // Réinitialiser les métriques de marché
  tradingMetrics.market.scannedTokens = 0;
  tradingMetrics.market.tradeableTokens = 0;
  tradingMetrics.market.lastScanTime = null;
  
  // Vider l'historique
  tradingMetrics.history = [];
  
  // Réinitialiser les erreurs
  tradingMetrics.errors.totalErrors = 0;
  Object.keys(tradingMetrics.errors.byCategory).forEach(key => {
    tradingMetrics.errors.byCategory[key] = 0;
  });
  
  // Mettre à jour le timestamp de démarrage
  tradingMetrics.startTime = Date.now();
}

// Exposer les fonctions principales
export {
  getStats as getMetrics
};