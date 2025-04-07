// src/utils/validation.js
import { PublicKey } from '@solana/web3.js';
import logger from '../services/logger.js';

/**
 * Module de validation complet pour vérifier les adresses blockchain, données API et paramètres
 * Garantit l'intégrité et la sécurité des opérations critiques du bot de trading
 */

/**
 * Valide une adresse Solana
 * @param {string} address - Adresse à valider
 * @returns {boolean} Si l'adresse est valide
 */
export function isValidSolanaAddress(address) {
  try {
    if (!address) return false;
    
    // Essaie de créer un objet PublicKey - lance une exception si invalide
    new PublicKey(address);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Valide les paramètres numériques avec vérification de plage
 * @param {number} value - Valeur à valider
 * @param {number|null} min - Valeur minimale autorisée
 * @param {number|null} max - Valeur maximale autorisée
 * @param {boolean} allowFloat - Si les nombres à virgule sont autorisés
 * @returns {boolean} Si la valeur est valide
 */
export function isValidNumber(value, min = null, max = null, allowFloat = true) {
  // Vérifier si la valeur est un nombre
  if (typeof value !== 'number' || isNaN(value)) return false;
  
  // Vérifier si les nombres flottants sont interdits et que la valeur a des décimales
  if (!allowFloat && value % 1 !== 0) return false;
  
  // Vérifier la plage si spécifiée
  if (min !== null && value < min) return false;
  if (max !== null && value > max) return false;
  
  return true;
}

/**
 * Valide et sanitize les données de token depuis les API
 * @param {Object} tokenData - Données du token à valider
 * @returns {Object} Résultat de validation avec données sanitizées
 */
export function validateTokenData(tokenData) {
  const result = {
    isValid: false,
    errors: [],
    sanitized: {}
  };
  
  // Vérifier les propriétés requises
  if (!tokenData) {
    result.errors.push('Données de token nulles ou indéfinies');
    return result;
  }
  
  // Vérifier les propriétés du token de base
  if (!tokenData.baseToken || !tokenData.baseToken.address) {
    result.errors.push('Informations de baseToken manquantes ou incomplètes');
    return result;
  }
  
  // Valider l'adresse
  if (!isValidSolanaAddress(tokenData.baseToken.address)) {
    result.errors.push(`Adresse de token invalide: ${tokenData.baseToken.address}`);
    return result;
  }
  
  // Sanitizer chaque propriété pour éviter les injections et normaliser le format
  result.sanitized = {
    baseToken: {
      address: tokenData.baseToken.address,
      symbol: tokenData.baseToken.symbol || 'Unknown',
      name: tokenData.baseToken.name || tokenData.baseToken.symbol || 'Unknown'
    },
    priceUsd: parseFloat(tokenData.priceUsd || 0),
    priceNative: parseFloat(tokenData.priceNative || 0),
    liquidity: {
      usd: parseFloat(tokenData.liquidity?.usd || 0),
      base: parseFloat(tokenData.liquidity?.base || 0),
      quote: parseFloat(tokenData.liquidity?.quote || 0)
    },
    volume: {
      h24: parseFloat(tokenData.volume?.h24 || 0),
      h6: parseFloat(tokenData.volume?.h6 || 0),
      h1: parseFloat(tokenData.volume?.h1 || 0),
      m5: parseFloat(tokenData.volume?.m5 || 0)
    },
    priceChange: {
      h24: parseFloat(tokenData.priceChange?.h24 || 0),
      h6: parseFloat(tokenData.priceChange?.h6 || 0),
      h1: parseFloat(tokenData.priceChange?.h1 || 0),
      m5: parseFloat(tokenData.priceChange?.m5 || 0)
    },
    txns: {
      h24: {
        buys: parseInt(tokenData.txns?.h24?.buys || 0, 10),
        sells: parseInt(tokenData.txns?.h24?.sells || 0, 10)
      },
      h6: {
        buys: parseInt(tokenData.txns?.h6?.buys || 0, 10),
        sells: parseInt(tokenData.txns?.h6?.sells || 0, 10)
      },
      h1: {
        buys: parseInt(tokenData.txns?.h1?.buys || 0, 10),
        sells: parseInt(tokenData.txns?.h1?.sells || 0, 10)
      },
      m5: {
        buys: parseInt(tokenData.txns?.m5?.buys || 0, 10),
        sells: parseInt(tokenData.txns?.m5?.sells || 0, 10)
      }
    },
    pairCreatedAt: tokenData.pairCreatedAt ? Number(tokenData.pairCreatedAt) : null,
    pairAddress: tokenData.pairAddress || null
  };
  
  // Validation réussie
  result.isValid = true;
  return result;
}

/**
 * Valide les paramètres de transaction
 * @param {Object} params - Paramètres de transaction à vérifier
 * @returns {Object} Résultat de validation avec erreurs éventuelles
 */
export function validateTransactionParams(params) {
  const result = {
    isValid: true,
    errors: []
  };

  // Vérifier les paramètres de token
  if (!params.inputMint) {
    result.errors.push('inputMint manquant');
    result.isValid = false;
  } else if (!isValidSolanaAddress(params.inputMint.toString())) {
    result.errors.push('inputMint invalide');
    result.isValid = false;
  }

  if (!params.outputMint) {
    result.errors.push('outputMint manquant');
    result.isValid = false;
  } else if (!isValidSolanaAddress(params.outputMint.toString())) {
    result.errors.push('outputMint invalide');
    result.isValid = false;
  }

  // Vérifier le montant
  if (!params.amount) {
    result.errors.push('amount manquant');
    result.isValid = false;
  } else {
    const amount = BigInt(params.amount.toString());
    if (amount <= BigInt(0)) {
      result.errors.push('amount doit être supérieur à 0');
      result.isValid = false;
    }
  }

  // Vérifier le slippage
  if (params.slippage !== undefined) {
    const slippage = Number(params.slippage);
    if (isNaN(slippage) || slippage < 0.1 || slippage > 50) {
      result.errors.push('slippage doit être entre 0.1 et 50');
      result.isValid = false;
    }
  }

  return result;
}

/**
 * Valide un wallet pour les transactions
 * @param {Object} wallet - Wallet à valider
 * @returns {boolean} Si le wallet est valide
 */
export function isValidWallet(wallet) {
  if (!wallet) return false;
  
  // Vérifier la clé publique
  try {
    if (!wallet.publicKey || !isValidSolanaAddress(wallet.publicKey.toString())) {
      return false;
    }
  } catch (error) {
    return false;
  }
  
  // Vérifier la capacité de signature
  if (typeof wallet.signTransaction !== 'function') {
    return false;
  }
  
  return true;
}

/**
 * Valide les paramètres d'une stratégie de trading
 * @param {Object} strategy - Paramètres de stratégie
 * @returns {Object} Stratégie validée et corrigée si nécessaire
 */
export function validateStrategyParams(strategy = {}) {
  const result = {
    isValid: true,
    errors: [],
    corrected: { ...strategy }
  };
  
  // Valider les paramètres avec limites raisonnables
  
  // Take profit
  if (!isValidNumber(strategy.takeProfitPct, 5, 1000)) {
    result.errors.push('takeProfitPct invalide (doit être entre 5 et 1000)');
    result.corrected.takeProfitPct = 50;
    result.isValid = false;
  }
  
  // Stop loss
  if (!isValidNumber(strategy.stopLossPct, -90, -1)) {
    result.errors.push('stopLossPct invalide (doit être entre -90 et -1)');
    result.corrected.stopLossPct = -20;
    result.isValid = false;
  }
  
  // Trailing stop activation
  if (strategy.trailingStopEnabled !== undefined && typeof strategy.trailingStopEnabled !== 'boolean') {
    result.errors.push('trailingStopEnabled doit être un booléen');
    result.corrected.trailingStopEnabled = true;
    result.isValid = false;
  }
  
  if (!isValidNumber(strategy.trailingStopActivation, 5, 200)) {
    result.errors.push('trailingStopActivation invalide (doit être entre 5 et 200)');
    result.corrected.trailingStopActivation = 20;
    result.isValid = false;
  }
  
  if (!isValidNumber(strategy.trailingStopTrail, 2, 50)) {
    result.errors.push('trailingStopTrail invalide (doit être entre 2 et 50)');
    result.corrected.trailingStopTrail = 10;
    result.isValid = false;
  }
  
  // Max hold time
  if (!isValidNumber(strategy.maxHoldTime, 1, 10080)) { // Maximum 1 semaine
    result.errors.push('maxHoldTime invalide (doit être entre 1 et 10080 minutes)');
    result.corrected.maxHoldTime = 60;
    result.isValid = false;
  }
  
  // Exit stages
  if (strategy.exitStages) {
    if (!Array.isArray(strategy.exitStages)) {
      result.errors.push('exitStages doit être un tableau');
      result.corrected.exitStages = [
        { percent: 25, sellPortion: 0.3 },
        { percent: 50, sellPortion: 0.3 },
        { percent: 100, sellPortion: 0.4 }
      ];
      result.isValid = false;
    } else {
      // Vérifier chaque étape
      let totalPortion = 0;
      const validStages = [];
      
      for (const stage of strategy.exitStages) {
        if (!isValidNumber(stage.percent, 1, 1000) || !isValidNumber(stage.sellPortion, 0.05, 1)) {
          result.errors.push(`Étape de sortie invalide: ${JSON.stringify(stage)}`);
          result.isValid = false;
          continue;
        }
        
        totalPortion += stage.sellPortion;
        validStages.push(stage);
      }
      
      // Vérifier que les proportions totalisent ~1
      if (Math.abs(totalPortion - 1) > 0.05) {
        result.errors.push(`Les proportions de vente doivent totaliser ~1 (actuel: ${totalPortion.toFixed(2)})`);
        result.isValid = false;
        
        // Normaliser les proportions
        if (validStages.length > 0 && totalPortion > 0) {
          for (let i = 0; i < validStages.length; i++) {
            validStages[i].sellPortion = validStages[i].sellPortion / totalPortion;
          }
        }
      }
      
      result.corrected.exitStages = validStages.length > 0 ? validStages : result.corrected.exitStages;
    }
  }
  
  return result;
}

/**
 * Valide un objet de configuration
 * @param {Object} config - Configuration à valider
 * @returns {Object} Configuration validée et normalisée
 */
export function validateConfig(config = {}) {
  const validatedConfig = { ...config };
  
  // Valider les paramètres numériques
  const numericParams = [
    { key: 'SLIPPAGE', min: 0.1, max: 50, default: 2 },
    { key: 'MAX_SOL_PER_TRADE', min: 0.001, max: 10, default: 0.1 },
    { key: 'RISK_PERCENTAGE', min: 0.001, max: 1, default: 0.03 },
    { key: 'MIN_LIQUIDITY_USD', min: 1, max: 1000000, default: 10000 },
    { key: 'MIN_VOLUME_24H', min: 0, max: 10000000, default: 5000 },
    { key: 'TAKE_PROFIT', min: 1, max: 1000, default: 25 },
    { key: 'STOP_LOSS', min: -90, max: -1, default: -20 },
    { key: 'MAX_RETRIES', min: 1, max: 10, default: 3 },
    { key: 'API_TIMEOUT', min: 1000, max: 60000, default: 10000 },
    { key: 'PRIORITY_FEE', min: 0, max: 10000000, default: 1000000 }
  ];
  
  for (const param of numericParams) {
    if (config[param.key] !== undefined) {
      const value = Number(config[param.key]);
      if (isNaN(value) || value < param.min || value > param.max) {
        validatedConfig[param.key] = param.default;
      } else {
        validatedConfig[param.key] = value;
      }
    }
  }
  
  // Valider les booléens
  const booleanParams = [
    { key: 'DRY_RUN', default: false },
    { key: 'DEBUG', default: false }
  ];
  
  for (const param of booleanParams) {
    if (config[param.key] !== undefined) {
      validatedConfig[param.key] = config[param.key] === true || config[param.key] === 'true';
    }
  }
  
  // Valider les chemins de fichiers
  const pathParams = ['LOG_FILE_PATH', 'PROFIT_REPORT_PATH', 'ERROR_LOG_PATH'];
  
  for (const param of pathParams) {
    if (config[param.key] && typeof config[param.key] === 'string') {
      // Assurer que le chemin est valide
      validatedConfig[param.key] = config[param.key].replace(/\.\./g, '').replace(/[<>:"|?*]/g, '_');
    }
  }
  
  // Valider les listes
  if (config.BLACKLISTED_TOKENS && typeof config.BLACKLISTED_TOKENS === 'string') {
    validatedConfig.BLACKLISTED_TOKENS = config.BLACKLISTED_TOKENS
      .split(',')
      .map(token => token.trim())
      .filter(token => token.length > 0);
  } else if (Array.isArray(config.BLACKLISTED_TOKENS)) {
    validatedConfig.BLACKLISTED_TOKENS = config.BLACKLISTED_TOKENS
      .map(token => token.trim())
      .filter(token => token.length > 0);
  } else {
    validatedConfig.BLACKLISTED_TOKENS = [];
  }
  
  return validatedConfig;
}

/**
 * Valide et normalise une URL
 * @param {string} url - URL à valider
 * @returns {string|null} URL normalisée ou null si invalide
 */
export function validateUrl(url) {
  if (!url || typeof url !== 'string') return null;
  
  try {
    // Ajouter https:// si non présent
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    
    // Tester si c'est une URL valide
    new URL(url);
    return url;
  } catch (error) {
    return null;
  }
}

export default {
  isValidSolanaAddress,
  isValidNumber,
  validateTokenData,
  validateTransactionParams,
  isValidWallet,
  validateStrategyParams,
  validateConfig,
  validateUrl
};