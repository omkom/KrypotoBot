/**
 * Analyseur sophistiqué de tokens avec détection d'opportunités et de fraudes
 * Utilise une approche multi-factorielle pour évaluer le potentiel et les risques
 * des tokens sur différentes dimensions avec détection avancée de manipulation
 * 
 * @module tokenAnalyzer
 * @requires ../services/logger
 * @requires ../config/index
 */

import logger from '../services/logger.js';
import config from '../config/index.js';

/**
 * Analyse complète d'un token pour déterminer son potentiel de trading
 * et détecter les signes de fraude ou manipulation
 * @param {Object} tokenData - Données du token provenant d'API comme DEXScreener
 * @param {Object} options - Options d'analyse supplémentaires
 * @returns {Object} Résultat d'analyse complet avec scores
 */
export function analyzeToken(tokenData, options = {}) {
  try {
    const startTime = Date.now();
    const tokenName = tokenData.baseToken?.symbol || 'Unknown';
    const tokenAddress = tokenData.baseToken?.address || 'Unknown';
    
    logger.debug(`Analyse du token: ${tokenName} (${tokenAddress})`);
    
    // Valider et extraire les métriques clés avec fallbacks sécurisés
    const metrics = extractTokenMetrics(tokenData);
    
    // Exécuter les analyses spécialisées
    const liquidityAnalysis = analyzeLiquidity(metrics);
    const volumeAnalysis = analyzeVolume(metrics);
    const priceAnalysis = analyzePriceAction(metrics);
    const buySellAnalysis = analyzeBuySellPattern(metrics);
    const manipulationAnalysis = detectManipulation(metrics, { liquidityAnalysis, volumeAnalysis, priceAnalysis });
    
    // Calculer le score de fraude et générer des alertes
    const fraudScore = calculateFraudScore(manipulationAnalysis);
    const tokenAge = metrics.tokenAge;
    const fraudWarnings = generateFraudWarnings(manipulationAnalysis, fraudScore, tokenAge);
    
    // Calculer le score d'opportunité (combinaison des analyses positives)
    const opportunityScore = calculateOpportunityScore({
      liquidityScore: liquidityAnalysis.score,
      volumeScore: volumeAnalysis.score,
      priceScore: priceAnalysis.score,
      buySellScore: buySellAnalysis.score,
      manipulationPenalty: manipulationAnalysis.manipulationScore
    });
    
    // Générer la recommandation finale
    const recommendation = generateRecommendation(opportunityScore, fraudScore);
    
    // Compiler l'analyse complète
    const analysis = {
      token: {
        name: tokenName,
        address: tokenAddress,
        price: metrics.priceUsd,
        age: metrics.tokenAge
      },
      scores: {
        overall: Math.max(0, Math.min(100, Math.round(opportunityScore))),
        liquidity: liquidityAnalysis.score,
        volume: volumeAnalysis.score,
        priceAction: priceAnalysis.score,
        buySellPattern: buySellAnalysis.score,
        fraudRisk: fraudScore
      },
      metrics: {
        liquidityUsd: metrics.liquidityUsd,
        volume24h: metrics.volume24h,
        priceChange24h: metrics.priceChange24h,
        priceChange1h: metrics.priceChange1h,
        priceChange5m: metrics.priceChange5m,
        volumeToLiquidityRatio: metrics.volumeToLiquidityRatio,
        buySellRatio1h: metrics.buySellRatio1h
      },
      fraudWarnings,
      manipulationSignals: manipulationAnalysis.signals,
      recommendation,
      tradeable: {
        score: Math.max(0, Math.min(100, Math.round(opportunityScore - (fraudScore * 0.7)))),
        isTradeable: opportunityScore > 50 && fraudScore < 40,
        assessment: recommendation.decision
      },
      analysisTime: Date.now() - startTime,
      timestamp: new Date().toISOString()
    };
    
    if (config.get('DEBUG')) {
      logger.debug(`Analyse de ${tokenName} terminée en ${analysis.analysisTime}ms`, {
        opportunityScore: opportunityScore.toFixed(2),
        fraudScore: fraudScore.toFixed(2),
        signals: manipulationAnalysis.signals.length,
        decision: recommendation.decision
      });
    }
    
    return analysis;
  } catch (error) {
    logger.error(`Erreur lors de l'analyse du token: ${error.message}`);
    
    // Retourner une analyse minimale en cas d'erreur
    return {
      error: `Analyse impossible: ${error.message}`,
      token: {
        name: tokenData.baseToken?.symbol || 'Unknown',
        address: tokenData.baseToken?.address || 'Unknown'
      },
      scores: {
        overall: 0,
        fraudRisk: 100
      },
      recommendation: {
        decision: 'Éviter - Erreur d\'analyse',
        confidence: 'Élevée'
      },
      tradeable: {
        score: 0,
        isTradeable: false,
        assessment: 'Analyse impossible'
      },
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Extrait et normalise les métriques clés du token
 * @param {Object} tokenData - Données brutes du token
 * @returns {Object} Métriques normalisées avec valeurs par défaut
 */
function extractTokenMetrics(tokenData) {
  // Extraire les métriques de base avec fallbacks
  const liquidityUsd = tokenData.liquidity?.usd || 0;
  const volume24h = tokenData.volume?.h24 || 0;
  const volume1h = tokenData.volume?.h1 || 0;
  const priceUsd = tokenData.priceUsd || 0;
  const priceChange24h = tokenData.priceChange?.h24 || 0;
  const priceChange1h = tokenData.priceChange?.h1 || 0;
  const priceChange5m = tokenData.priceChange?.m5 || 0;
  const pairCreatedAt = tokenData.pairCreatedAt || 0;
  
  // Extraire les données de transactions
  const txns = tokenData.txns || {};
  const buys1h = txns.h1?.buys || 0;
  const sells1h = txns.h1?.sells || 0;
  const buys24h = txns.h24?.buys || 0;
  const sells24h = txns.h24?.sells || 0;
  
  // Calculer les métriques dérivées
  const volumeToLiquidityRatio = liquidityUsd > 0 ? volume24h / liquidityUsd : 0;
  const buySellRatio1h = sells1h > 0 ? buys1h / sells1h : (buys1h > 0 ? 5 : 1);
  const buySellRatio24h = sells24h > 0 ? buys24h / sells24h : (buys24h > 0 ? 5 : 1);
  const volume1hTo24hRatio = volume24h > 0 ? (volume1h / volume24h) * 24 : 0;
  const transactionCount1h = buys1h + sells1h;
  const transactionCount24h = buys24h + sells24h;
  const avgTransactionSize1h = transactionCount1h > 0 ? volume1h / transactionCount1h : 0;
  
  // Calculer l'âge du token en jours
  const now = Date.now();
  const tokenAge = pairCreatedAt ? (now - pairCreatedAt) / (1000 * 60 * 60 * 24) : 999;
  
  return {
    liquidityUsd,
    volume24h,
    volume1h,
    priceUsd,
    priceChange24h,
    priceChange1h,
    priceChange5m,
    buys1h,
    sells1h,
    buys24h,
    sells24h,
    volumeToLiquidityRatio,
    buySellRatio1h,
    buySellRatio24h,
    transactionCount1h,
    transactionCount24h,
    volume1hTo24hRatio,
    avgTransactionSize1h,
    tokenAge
  };
}

/**
 * Analyse la liquidité du token
 * @param {Object} metrics - Métriques du token
 * @returns {Object} Résultat de l'analyse de liquidité
 */
function analyzeLiquidity(metrics) {
  const { liquidityUsd } = metrics;
  let score = 0;
  const factors = [];
  
  // Zones optimales de liquidité pour le trading
  if (liquidityUsd >= 100000) {
    score = 80;
    factors.push('Liquidité très élevée (>100K USD)');
  } else if (liquidityUsd >= 50000) {
    score = 90;
    factors.push('Liquidité optimale (50K-100K USD)');
  } else if (liquidityUsd >= 10000) {
    score = 100;
    factors.push('Liquidité idéale (10K-50K USD)');
  } else if (liquidityUsd >= 5000) {
    score = 70;
    factors.push('Liquidité suffisante (5K-10K USD)');
  } else if (liquidityUsd >= 1000) {
    score = 50;
    factors.push('Liquidité limitée (1K-5K USD)');
  } else if (liquidityUsd >= 500) {
    score = 30;
    factors.push('Liquidité très basse (500-1K USD)');
  } else {
    score = 10;
    factors.push('Liquidité dangereusement basse (<500 USD)');
  }
  
  return {
    score,
    factors,
    riskLevel: liquidityUsd < 5000 ? 'Élevé' : liquidityUsd < 20000 ? 'Moyen' : 'Faible'
  };
}

/**
 * Analyse le volume de trading du token
 * @param {Object} metrics - Métriques du token
 * @returns {Object} Résultat de l'analyse de volume
 */
function analyzeVolume(metrics) {
  const { volume24h, liquidityUsd, volumeToLiquidityRatio, volume1hTo24hRatio } = metrics;
  let score = 0;
  const factors = [];
  
  // Score basé sur le volume absolu
  if (volume24h > 100000) {
    score += 30;
    factors.push('Volume très élevé (>100K USD)');
  } else if (volume24h > 50000) {
    score += 40;
    factors.push('Volume élevé (50K-100K USD)');
  } else if (volume24h > 10000) {
    score += 35;
    factors.push('Volume satisfaisant (10K-50K USD)');
  } else if (volume24h > 5000) {
    score += 25;
    factors.push('Volume modéré (5K-10K USD)');
  } else if (volume24h > 1000) {
    score += 15;
    factors.push('Volume faible (1K-5K USD)');
  } else {
    score += 5;
    factors.push('Volume très faible (<1K USD)');
  }
  
  // Score basé sur le ratio volume/liquidité (idéal: 0.5-3)
  if (volumeToLiquidityRatio >= 0.5 && volumeToLiquidityRatio <= 3) {
    score += 40;
    factors.push('Ratio volume/liquidité optimal (0.5-3x)');
  } else if (volumeToLiquidityRatio > 3 && volumeToLiquidityRatio <= 5) {
    score += 25;
    factors.push('Ratio volume/liquidité élevé (3-5x)');
  } else if (volumeToLiquidityRatio > 0.1 && volumeToLiquidityRatio < 0.5) {
    score += 20;
    factors.push('Ratio volume/liquidité bas (0.1-0.5x)');
  } else if (volumeToLiquidityRatio > 5 && volumeToLiquidityRatio <= 10) {
    score += 10;
    factors.push('Ratio volume/liquidité suspect (5-10x)');
  } else if (volumeToLiquidityRatio > 10) {
    score += 0;
    factors.push('Ratio volume/liquidité anormal (>10x)');
  } else {
    score += 5;
    factors.push('Ratio volume/liquidité très faible (<0.1x)');
  }
  
  // Score basé sur la distribution du volume (1h vs 24h)
  if (volume1hTo24hRatio > 0 && volume1hTo24hRatio <= 1.5) {
    score += 30;
    factors.push('Distribution de volume régulière');
  } else if (volume1hTo24hRatio > 1.5 && volume1hTo24hRatio <= 3) {
    score += 20;
    factors.push('Volume récent en hausse');
  } else if (volume1hTo24hRatio > 3) {
    score += 10;
    factors.push('Pic de volume récent suspect');
  } else {
    score += 5;
    factors.push('Volume récent en baisse');
  }
  
  // Normaliser le score final (0-100)
  const normalizedScore = Math.min(100, score);
  
  return {
    score: normalizedScore,
    factors,
    riskLevel: normalizedScore < 40 ? 'Élevé' : normalizedScore < 70 ? 'Moyen' : 'Faible'
  };
}

/**
 * Analyse l'action des prix et le momentum
 * @param {Object} metrics - Métriques du token
 * @returns {Object} Résultat de l'analyse de prix
 */
function analyzePriceAction(metrics) {
  const { priceChange24h, priceChange1h, priceChange5m } = metrics;
  let score = 0;
  const factors = [];
  
  // Score basé sur les changements de prix à court terme (5m)
  if (priceChange5m > 5 && priceChange5m <= 15) {
    score += 30;
    factors.push('Momentum court terme positif (5-15%)');
  } else if (priceChange5m > 15 && priceChange5m <= 30) {
    score += 20;
    factors.push('Fort momentum court terme (15-30%)');
  } else if (priceChange5m > 30) {
    score += 10;
    factors.push('Explosion de prix à court terme (>30%)');
  } else if (priceChange5m > 0 && priceChange5m <= 5) {
    score += 15;
    factors.push('Légère hausse court terme (0-5%)');
  } else if (priceChange5m < 0 && priceChange5m >= -10) {
    score += 5;
    factors.push('Légère baisse court terme (0-10%)');
  } else {
    score += 0;
    factors.push('Forte baisse court terme (>10%)');
  }
  
  // Score basé sur les changements de prix à moyen terme (1h)
  if (priceChange1h > 10 && priceChange1h <= 30) {
    score += 30;
    factors.push('Momentum moyen terme positif (10-30%)');
  } else if (priceChange1h > 30 && priceChange1h <= 50) {
    score += 20;
    factors.push('Fort momentum moyen terme (30-50%)');
  } else if (priceChange1h > 50) {
    score += 10;
    factors.push('Explosion de prix à moyen terme (>50%)');
  } else if (priceChange1h > 0 && priceChange1h <= 10) {
    score += 15;
    factors.push('Légère hausse moyen terme (0-10%)');
  } else if (priceChange1h < 0 && priceChange1h >= -20) {
    score += 5;
    factors.push('Baisse moyen terme (0-20%)');
  } else {
    score += 0;
    factors.push('Forte baisse moyen terme (>20%)');
  }
  
  // Score basé sur les changements de prix à long terme (24h)
  if (priceChange24h > 20 && priceChange24h <= 100) {
    score += 20;
    factors.push('Tendance long terme positive (20-100%)');
  } else if (priceChange24h > 100) {
    score += 10;
    factors.push('Explosion de prix long terme (>100%)');
  } else if (priceChange24h > 0 && priceChange24h <= 20) {
    score += 15;
    factors.push('Légère hausse long terme (0-20%)');
  } else if (priceChange24h < 0 && priceChange24h >= -30) {
    score += 5;
    factors.push('Baisse long terme (0-30%)');
  } else {
    score += 0;
    factors.push('Forte baisse long terme (>30%)');
  }
  
  // Bonus pour tendance multi-timeframe cohérente
  if (priceChange5m > 0 && priceChange1h > 0 && priceChange24h > 0) {
    score += 20;
    factors.push('Tendance haussière cohérente sur tous timeframes');
  }
  
  // Normaliser le score final (0-100)
  const normalizedScore = Math.min(100, score);
  
  return {
    score: normalizedScore,
    factors,
    momentum: normalizedScore < 40 ? 'Faible' : normalizedScore < 70 ? 'Modéré' : 'Fort'
  };
}

/**
 * Analyse les patterns d'achat/vente
 * @param {Object} metrics - Métriques du token
 * @returns {Object} Résultat de l'analyse des patterns achat/vente
 */
function analyzeBuySellPattern(metrics) {
  const { buySellRatio1h, buySellRatio24h, transactionCount1h } = metrics;
  let score = 0;
  const factors = [];
  
  // Score basé sur le ratio achat/vente récent (1h)
  if (buySellRatio1h > 1.5 && buySellRatio1h <= 3) {
    score += 40;
    factors.push('Dominance acheteurs optimale (1.5-3x)');
  } else if (buySellRatio1h > 3 && buySellRatio1h <= 5) {
    score += 30;
    factors.push('Forte dominance acheteurs (3-5x)');
  } else if (buySellRatio1h > 5) {
    score += 15;
    factors.push('Dominance acheteurs excessive (>5x)');
  } else if (buySellRatio1h > 1 && buySellRatio1h <= 1.5) {
    score += 25;
    factors.push('Légère dominance acheteurs (1-1.5x)');
  } else if (buySellRatio1h === 1) {
    score += 15;
    factors.push('Équilibre acheteurs/vendeurs');
  } else if (buySellRatio1h >= 0.7 && buySellRatio1h < 1) {
    score += 10;
    factors.push('Légère dominance vendeurs (0.7-1x)');
  } else {
    score += 0;
    factors.push('Forte dominance vendeurs (<0.7x)');
  }
  
  // Score basé sur le ratio achat/vente global (24h)
  if (buySellRatio24h > 1.2 && buySellRatio24h <= 2) {
    score += 30;
    factors.push('Tendance globale acheteurs positive (1.2-2x)');
  } else if (buySellRatio24h > 2) {
    score += 20;
    factors.push('Forte tendance globale acheteurs (>2x)');
  } else if (buySellRatio24h > 0.8 && buySellRatio24h <= 1.2) {
    score += 15;
    factors.push('Tendance globale équilibrée (0.8-1.2x)');
  } else {
    score += 0;
    factors.push('Tendance globale vendeurs (<0.8x)');
  }
  
  // Score basé sur le nombre de transactions
  if (transactionCount1h >= 50) {
    score += 30;
    factors.push('Activité trading très élevée (50+ transactions)');
  } else if (transactionCount1h >= 20) {
    score += 25;
    factors.push('Bonne activité trading (20-50 transactions)');
  } else if (transactionCount1h >= 10) {
    score += 15;
    factors.push('Activité trading modérée (10-20 transactions)');
  } else if (transactionCount1h >= 5) {
    score += 10;
    factors.push('Faible activité trading (5-10 transactions)');
  } else {
    score += 5;
    factors.push('Très faible activité trading (<5 transactions)');
  }
  
  // Normaliser le score final (0-100)
  const normalizedScore = Math.min(100, score);
  
  return {
    score: normalizedScore,
    factors,
    interest: normalizedScore < 40 ? 'Faible' : normalizedScore < 70 ? 'Modéré' : 'Élevé'
  };
}

/**
 * Détecte les signes de manipulation de marché
 * @param {Object} metrics - Métriques du token
 * @param {Object} analyses - Résultats des autres analyses
 * @returns {Object} Résultat de la détection de manipulation
 */
function detectManipulation(metrics, analyses = {}) {
  const signals = [];
  let manipulationScore = 0;
  
  // 1. Détecter les anomalies de liquidité/volume
  if (metrics.volumeToLiquidityRatio > 10) {
    signals.push({
      type: 'VOLUME_LIQUIDITY_ANOMALY',
      severity: 'HIGH',
      description: 'Volume anormalement élevé par rapport à la liquidité',
      value: metrics.volumeToLiquidityRatio.toFixed(2) + 'x'
    });
    manipulationScore += 25;
  } else if (metrics.volumeToLiquidityRatio > 5) {
    signals.push({
      type: 'VOLUME_LIQUIDITY_ANOMALY',
      severity: 'MEDIUM',
      description: 'Volume suspect par rapport à la liquidité',
      value: metrics.volumeToLiquidityRatio.toFixed(2) + 'x'
    });
    manipulationScore += 15;
  }
  
  // 2. Détecter les mouvements de prix suspects
  if (metrics.priceChange5m > 30) {
    signals.push({
      type: 'PRICE_PUMP',
      severity: 'HIGH',
      description: 'Augmentation de prix suspecte sur 5 minutes',
      value: metrics.priceChange5m.toFixed(2) + '%'
    });
    manipulationScore += 20;
  } else if (metrics.priceChange5m > 15) {
    signals.push({
      type: 'PRICE_VOLATILITY',
      severity: 'MEDIUM',
      description: 'Forte volatilité de prix à court terme',
      value: metrics.priceChange5m.toFixed(2) + '%'
    });
    manipulationScore += 10;
  }
  
  if (metrics.priceChange1h > 50) {
    signals.push({
      type: 'PRICE_PUMP',
      severity: 'MEDIUM',
      description: 'Augmentation de prix suspecte sur 1 heure',
      value: metrics.priceChange1h.toFixed(2) + '%'
    });
    manipulationScore += 15;
  }
  
  // 3. Détecter les patterns de transactions suspects
  if (metrics.buySellRatio1h > 8) {
    signals.push({
      type: 'WASH_TRADING',
      severity: 'HIGH',
      description: 'Ratio achats/ventes anormalement déséquilibré',
      value: metrics.buySellRatio1h.toFixed(2) + 'x'
    });
    manipulationScore += 25;
  } else if (metrics.buySellRatio1h > 5) {
    signals.push({
      type: 'TRADING_IMBALANCE',
      severity: 'MEDIUM',
      description: 'Déséquilibre suspect des transactions',
      value: metrics.buySellRatio1h.toFixed(2) + 'x'
    });
    manipulationScore += 15;
  }
  
  // 4. Détecter les spikes de volume récents
  if (metrics.volume1hTo24hRatio > 5) {
    signals.push({
      type: 'VOLUME_SPIKE',
      severity: 'HIGH',
      description: 'Pic de volume récent anormal',
      value: metrics.volume1hTo24hRatio.toFixed(2) + 'x'
    });
    manipulationScore += 20;
  } else if (metrics.volume1hTo24hRatio > 3) {
    signals.push({
      type: 'VOLUME_SPIKE',
      severity: 'MEDIUM',
      description: 'Pic de volume récent suspect',
      value: metrics.volume1hTo24hRatio.toFixed(2) + 'x'
    });
    manipulationScore += 10;
  }
  
  // 5. Prendre en compte l'âge du token
  if (metrics.tokenAge < 1) {
    signals.push({
      type: 'NEW_TOKEN',
      severity: 'HIGH',
      description: 'Token très récent (<24h)',
      value: metrics.tokenAge.toFixed(2) + ' jours'
    });
    manipulationScore += 20;
  } else if (metrics.tokenAge < 3) {
    signals.push({
      type: 'NEW_TOKEN',
      severity: 'MEDIUM',
      description: 'Token récent (<3 jours)',
      value: metrics.tokenAge.toFixed(2) + ' jours'
    });
    manipulationScore += 10;
  }
  
  // 6. Détecter les manipulations basées sur la taille des transactions
  if (metrics.avgTransactionSize1h > 1000 && metrics.transactionCount1h < 10) {
    signals.push({
      type: 'WHALE_MANIPULATION',
      severity: 'MEDIUM',
      description: 'Transactions de grande taille avec peu de participants',
      value: '$' + Math.round(metrics.avgTransactionSize1h)
    });
    manipulationScore += 15;
  }
  
  // 7. Combinaisons de signaux qui indiquent une manipulation encore plus forte
  if (metrics.priceChange1h > 30 && metrics.buySellRatio1h > 3 && metrics.volume1hTo24hRatio > 3) {
    signals.push({
      type: 'PUMP_SCHEME',
      severity: 'HIGH',
      description: 'Schéma de pump coordonné détecté',
      value: 'Multiple'
    });
    manipulationScore += 30;
  }
  
  // 8. Détection de liquidité artificielle
  if (metrics.liquidityUsd < 5000 && metrics.volume24h > 10000) {
    signals.push({
      type: 'ARTIFICIAL_LIQUIDITY',
      severity: 'HIGH',
      description: 'Volume élevé avec liquidité dangereusement basse',
      value: 'Ratio ' + (metrics.volume24h / metrics.liquidityUsd).toFixed(2) + 'x'
    });
    manipulationScore += 25;
  }
  
  // 9. Prix/Volume mismatch
  if (Math.abs(metrics.priceChange1h) > 20 && metrics.transactionCount1h < 5) {
    signals.push({
      type: 'PRICE_VOLUME_MISMATCH',
      severity: 'HIGH',
      description: 'Mouvement de prix significatif avec peu de transactions',
      value: metrics.priceChange1h.toFixed(2) + '% / ' + metrics.transactionCount1h + ' tx'
    });
    manipulationScore += 20;
  }
  
  // Normaliser le score de manipulation sur 100
  manipulationScore = Math.min(100, manipulationScore);
  
  // Classification du risque de manipulation
  let riskLevel;
  if (manipulationScore >= 70) {
    riskLevel = 'Très élevé';
  } else if (manipulationScore >= 50) {
    riskLevel = 'Élevé';
  } else if (manipulationScore >= 30) {
    riskLevel = 'Modéré';
  } else if (manipulationScore >= 10) {
    riskLevel = 'Faible';
  } else {
    riskLevel = 'Très faible';
  }
  
  return {
    signals,
    manipulationScore,
    riskLevel
  };
}

/**
 * Calcule le score de fraude basé sur l'analyse de manipulation
 * @param {Object} manipulationAnalysis - Résultat de l'analyse de manipulation
 * @returns {number} Score de fraude (0-100)
 */
function calculateFraudScore(manipulationAnalysis) {
  const { signals, manipulationScore } = manipulationAnalysis;
  
  // Le score de base est le score de manipulation
  let fraudScore = manipulationScore;
  
  // Ajuster en fonction de la sévérité et du nombre de signaux
  const highSeverityCount = signals.filter(s => s.severity === 'HIGH').length;
  
  if (highSeverityCount >= 3) {
    fraudScore = Math.min(100, fraudScore + 30);
  } else if (highSeverityCount >= 2) {
    fraudScore = Math.min(100, fraudScore + 20);
  } else if (highSeverityCount >= 1) {
    fraudScore = Math.min(100, fraudScore + 10);
  }
  
  // Certains types de signaux spécifiques augmentent davantage le score
  const criticalSignals = signals.filter(s => 
    s.type === 'PUMP_SCHEME' || 
    s.type === 'WASH_TRADING' || 
    s.type === 'ARTIFICIAL_LIQUIDITY'
  );
  
  if (criticalSignals.length > 0) {
    fraudScore = Math.min(100, fraudScore + (criticalSignals.length * 10));
  }
  
  return fraudScore;
}

/**
 * Génère des avertissements de fraude basés sur l'analyse
 * @param {Object} manipulationAnalysis - Résultat de l'analyse de manipulation
 * @param {number} fraudScore - Score de fraude
 * @param {number} tokenAge - Âge du token en jours
 * @returns {Array} Avertissements de fraude
 */
function generateFraudWarnings(manipulationAnalysis, fraudScore, tokenAge) {
  const { signals, riskLevel } = manipulationAnalysis;
  const warnings = [];
  
  // Avertissements basés sur le score de fraude global
  if (fraudScore >= 70) {
    warnings.push('ALERTE: Risque de fraude extrêmement élevé. Trading fortement déconseillé.');
  } else if (fraudScore >= 50) {
    warnings.push('ATTENTION: Signes multiples de manipulation potentielle. Procéder avec grande prudence.');
  } else if (fraudScore >= 30) {
    warnings.push('PRUDENCE: Certains signes de manipulation possibles détectés.');
  }
  
  // Avertissements spécifiques basés sur les signaux détectés
  if (signals.some(s => s.type === 'PUMP_SCHEME')) {
    warnings.push('Schéma de pump-and-dump probable. Risque élevé de chute brutale des prix.');
  }
  
  if (signals.some(s => s.type === 'WASH_TRADING')) {
    warnings.push('Activité de wash trading suspectée. Volume possiblement artificiel.');
  }
  
  if (signals.some(s => s.type === 'ARTIFICIAL_LIQUIDITY')) {
    warnings.push('Liquidité dangereusement basse par rapport au volume. Risque d\'impossibilité de vente.');
  }
  
  if (signals.some(s => s.type === 'NEW_TOKEN' && s.severity === 'HIGH') && fraudScore >= 40) {
    warnings.push('Token très récent (<24h) avec signaux de risque. Extrême prudence recommandée.');
  }
  
  // Avertissement sur la volatilité
  if (signals.some(s => s.type === 'PRICE_VOLATILITY' || s.type === 'PRICE_PUMP')) {
    warnings.push('Forte volatilité des prix. Préparez-vous à des mouvements importants et rapides.');
  }
  
  return warnings;
}

/**
 * Calcule le score d'opportunité global
 * @param {Object} scores - Scores des différentes analyses
 * @returns {number} Score d'opportunité global (0-100)
 */
function calculateOpportunityScore({ liquidityScore, volumeScore, priceScore, buySellScore, manipulationPenalty }) {
  // Pondération des différents facteurs
  const weights = {
    liquidity: 0.25,
    volume: 0.25,
    price: 0.3,
    buySell: 0.2
  };
  
  // Calculer le score pondéré
  const weightedScore = (
    (liquidityScore * weights.liquidity) +
    (volumeScore * weights.volume) +
    (priceScore * weights.price) +
    (buySellScore * weights.buySell)
  );
  
  // Appliquer une pénalité pour la manipulation détectée
  const manipulationFactor = Math.max(0, 1 - (manipulationPenalty / 100));
  
  // Score final entre 0 et 100
  return weightedScore * manipulationFactor;
}

/**
 * Génère une recommandation de trading basée sur les scores
 * @param {number} opportunityScore - Score d'opportunité
 * @param {number} fraudScore - Score de fraude
 * @returns {Object} Recommandation formatée
 */
function generateRecommendation(opportunityScore, fraudScore) {
  // Calculer le score tradeable final (ajusté par le risque)
  const tradeableScore = Math.max(0, opportunityScore - (fraudScore * 0.7));
  
  let decision, confidence, explanation;
  
  // Déterminer la décision
  if (fraudScore >= 70) {
    decision = 'Éviter';
    confidence = 'Élevée';
    explanation = 'Signaux de fraude très forts qui dépassent tout potentiel d\'opportunité.';
  } else if (fraudScore >= 50) {
    decision = 'Éviter';
    confidence = 'Modérée';
    explanation = 'Risque de manipulation élevé qui compromet l\'opportunité de trading.';
  } else if (tradeableScore >= 80) {
    decision = 'Fort achat';
    confidence = 'Élevée';
    explanation = 'Excellente opportunité avec indicateurs très positifs et risque limité.';
  } else if (tradeableScore >= 60) {
    decision = 'Achat';
    confidence = 'Modérée';
    explanation = 'Bonne opportunité avec indicateurs positifs, à surveiller de près.';
  } else if (tradeableScore >= 40) {
    decision = 'Achat prudent';
    confidence = 'Modérée';
    explanation = 'Opportunité potentielle mais avec certains facteurs de risque à considérer.';
  } else if (tradeableScore >= 20) {
    decision = 'Surveillance';
    confidence = 'Modérée';
    explanation = 'Opportunité limitée ou risques trop importants pour un trading immédiat.';
  } else {
    decision = 'Éviter';
    confidence = 'Modérée';
    explanation = 'Opportunité insuffisante ou risques trop élevés.';
  }
  
  return {
    decision,
    confidence,
    explanation,
    opportunityScore: Math.round(opportunityScore),
    fraudScore: Math.round(fraudScore),
    tradeableScore: Math.round(tradeableScore)
  };
}

/**
 * Effectue une analyse rapide d'un token pour du filtering
 * @param {Object} tokenData - Données basiques du token
 * @returns {Object} Analyse rapide avec score
 */
export function quickAnalyzeToken(tokenData) {
  try {
    // Extraction des métriques essentielles
    const { baseToken, liquidity, volume, priceChange } = tokenData;
    
    // Valeurs par défaut sécurisées
    const liquidityUsd = liquidity?.usd || 0;
    const volume24h = volume?.h24 || 0;
    const priceChange1h = priceChange?.h1 || 0;
    const name = baseToken?.symbol || 'Unknown';
    const address = baseToken?.address || 'Unknown';
    
    // Calcul du ratio volume/liquidité
    const volumeToLiquidityRatio = liquidityUsd > 0 ? volume24h / liquidityUsd : 0;
    
    // Scoring simplifié pour filtrage rapide
    let opportunityScore = 0;
    let riskScore = 0;
    
    // Score de liquidité (0-30)
    if (liquidityUsd >= 50000) opportunityScore += 20;
    else if (liquidityUsd >= 10000) opportunityScore += 30;
    else if (liquidityUsd >= 5000) opportunityScore += 25;
    else if (liquidityUsd >= 1000) opportunityScore += 15;
    else if (liquidityUsd < 1000) {
      opportunityScore += 5;
      riskScore += 30;
    }
    
    // Score de volume (0-30)
    if (volume24h >= 50000) opportunityScore += 20;
    else if (volume24h >= 10000) opportunityScore += 30;
    else if (volume24h >= 5000) opportunityScore += 25;
    else if (volume24h >= 1000) opportunityScore += 15;
    else opportunityScore += 5;
    
    // Score de mouvement de prix (0-40)
    if (priceChange1h >= 10 && priceChange1h <= 30) opportunityScore += 40;
    else if (priceChange1h > 30 && priceChange1h <= 50) opportunityScore += 30;
    else if (priceChange1h > 50) {
      opportunityScore += 20;
      riskScore += 30;
    }
    else if (priceChange1h > 0) opportunityScore += 20;
    else if (priceChange1h < -20) opportunityScore += 10;
    
    // Pénalités pour risques évidents
    if (volumeToLiquidityRatio > 10) riskScore += 40;
    else if (volumeToLiquidityRatio > 5) riskScore += 20;
    
    // Score final
    const finalScore = Math.max(0, Math.min(100, opportunityScore - (riskScore * 0.5)));
    
    return {
      address,
      name,
      metrics: {
        liquidityUsd,
        volume24h,
        priceChange1h,
        volumeToLiquidityRatio
      },
      score: Math.round(finalScore),
      isTradeable: finalScore > 50,
      passingFilter: finalScore > 40
    };
  } catch (error) {
    logger.debug(`Erreur d'analyse rapide pour token: ${error.message}`);
    return {
      address: tokenData.baseToken?.address || 'Unknown',
      name: tokenData.baseToken?.symbol || 'Unknown',
      score: 0,
      isTradeable: false,
      passingFilter: false,
      error: true
    };
  }
}

export default {
  analyzeToken,
  quickAnalyzeToken
};