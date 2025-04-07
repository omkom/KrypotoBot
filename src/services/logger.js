// src/services/logger.js
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import config from '../config/index.js';
import logRotation from './logRotation.js';

/**
 * Service de logging amélioré avec sortie console colorée
 * et journalisation structurée dans des fichiers avec rotation automatique
 */
class Logger {
  /**
   * Initialise le logger avec configuration par défaut
   */
  constructor() {
    this.debugMode = config.get('DEBUG');
    this.logDir = path.dirname(config.get('LOG_FILE_PATH') || './logs/app.log');
    this.errorLogPath = config.get('ERROR_LOG_PATH') || path.join(this.logDir, 'error.log');
    this.tradeLogPath = path.join(this.logDir, 'trades.log');
    this.appLogPath = path.join(this.logDir, 'app.log');
    
    // Créer le répertoire de logs s'il n'existe pas
    this.ensureLogDirectory();
    
    // Configurer les fichiers avec le système de rotation
    this.setupRotation();
  }
  
  /**
   * S'assure que le répertoire de logs existe
   */
  ensureLogDirectory() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }
  
  /**
   * Configure la rotation des fichiers logs
   */
  setupRotation() {
    // Ajouter les fichiers logs au système de rotation
    if (this.errorLogPath) {
      logRotation.watchFile(this.errorLogPath);
    }
    
    logRotation.watchFile(this.tradeLogPath);
    logRotation.watchFile(this.appLogPath);
  }
  
  /**
   * Génère un timestamp formaté pour les logs
   * @returns {string} Timestamp ISO
   */
  getTimestamp() {
    return new Date().toISOString();
  }
  
  /**
   * Journalise un message de type info
   * @param {string} message - Message à journaliser
   * @param {Object} data - Données optionnelles à inclure
   */
  info(message, data = null) {
    console.log(chalk.blue(`ℹ INFO: ${message}`));
    this.writeToFile('INFO', message, data, this.appLogPath);
  }
  
  /**
   * Journalise un message de succès
   * @param {string} message - Message à journaliser
   * @param {Object} data - Données optionnelles à inclure
   */
  success(message, data = null) {
    console.log(chalk.green(`✓ SUCCESS: ${message}`));
    this.writeToFile('SUCCESS', message, data, this.appLogPath);
  }
  
  /**
   * Journalise un message d'avertissement
   * @param {string} message - Message à journaliser
   * @param {Object} data - Données optionnelles à inclure
   */
  warn(message, data = null) {
    console.log(chalk.yellow(`⚠ WARNING: ${message}`));
    this.writeToFile('WARNING', message, data, this.appLogPath);
  }
  
  /**
   * Journalise un message d'erreur
   * @param {string} message - Message à journaliser
   * @param {Error} error - Objet d'erreur optionnel
   */
  error(message, error = null) {
    console.log(chalk.red(`✖ ERROR: ${message}`));
    if (error && this.debugMode) {
      console.log(chalk.red(error.stack));
    }
    
    // Écriture dans le fichier de log général
    this.writeToFile('ERROR', message, null, this.appLogPath, error);
    
    // Écriture dans le fichier d'erreurs dédié
    if (this.errorLogPath) {
      this.writeToFile('ERROR', message, null, this.errorLogPath, error);
    }
  }
  
  /**
   * Journalise un message critique (erreur fatale)
   * @param {string} message - Message à journaliser
   * @param {Error} error - Objet d'erreur optionnel
   */
  critical(message, error = null) {
    console.log(chalk.bgRed.white(`💀 CRITICAL: ${message}`));
    if (error) {
      console.log(chalk.red(error.stack));
    }
    
    // Écriture dans le fichier de log général et d'erreurs
    this.writeToFile('CRITICAL', message, null, this.appLogPath, error);
    this.writeToFile('CRITICAL', message, null, this.errorLogPath, error);
  }
  
  /**
   * Journalise un message de debug (uniquement en mode debug)
   * @param {string} message - Message à journaliser
   * @param {any} data - Données optionnelles à afficher
   */
  debug(message, data = null) {
    if (this.debugMode) {
      console.log(chalk.magenta(`🔍 DEBUG: ${message}`));
      if (data !== undefined) {
        console.log(chalk.gray(typeof data === 'string' ? data : JSON.stringify(data, null, 2)));
      }
      this.writeToFile('DEBUG', message, data, this.appLogPath);
    }
  }
  
  /**
   * Journalise un message lié au trading
   * @param {string} message - Message à journaliser
   * @param {Object} data - Données optionnelles de trading
   */
  trade(message, data = null) {
    console.log(chalk.cyan(`💱 TRADE: ${message}`));
    
    // Écrire dans le fichier de log général
    this.writeToFile('TRADE', message, data, this.appLogPath);
    
    // Écrire dans le fichier de trades spécifique
    this.writeToFile('TRADE', message, data, this.tradeLogPath);
  }
  
  /**
   * Journalise un message lié au système
   * @param {string} message - Message à journaliser
   * @param {Object} data - Données optionnelles système
   */
  system(message, data = null) {
    console.log(chalk.hex('#FF8800')(`🔧 SYSTEM: ${message}`));
    this.writeToFile('SYSTEM', message, data, this.appLogPath);
  }
  
  /**
   * Écrit une entrée de journal dans un fichier
   * @param {string} level - Niveau de log
   * @param {string} message - Message à journaliser
   * @param {any} data - Données additionnelles
   * @param {string} filePath - Chemin du fichier
   * @param {Error} error - Objet d'erreur (optionnel)
   */
  writeToFile(level, message, data = null, filePath = null, error = null) {
    try {
      if (!filePath) return;
      
      // S'assurer que le répertoire existe
      const dirPath = path.dirname(filePath);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      
      const timestamp = this.getTimestamp();
      
      // Format JSON pour entrée structurée
      const logEntry = {
        timestamp,
        level,
        message,
        data: data === null ? undefined : data
      };
      
      // Ajouter les détails d'erreur si présent
      if (error) {
        logEntry.error = {
          message: error.message,
          stack: error.stack
        };
      }
      
      // Écrire l'entrée en format JSON
      fs.appendFileSync(filePath, JSON.stringify(logEntry) + '\n');
      
      // Si c'est un fichier d'erreur et que l'entrée est une erreur, utiliser un format plus lisible
      if ((level === 'ERROR' || level === 'CRITICAL') && filePath === this.errorLogPath) {
        fs.appendFileSync(
          filePath,
          `[${timestamp}] ${level}: ${message}\n${error ? error.stack + '\n\n' : '\n'}`
        );
      }
    } catch (err) {
      console.error(chalk.red(`Failed to write to log file (${filePath}): ${err.message}`));
    }
  }
  
  /**
   * Crée un nouveau fichier de log avec un préfixe spécifique
   * @param {string} prefix - Préfixe pour le nom du fichier
   * @returns {string} Chemin du nouveau fichier log
   */
  createLogFile(prefix) {
    // Générer un nom unique avec timestamp
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
    const fileName = `${prefix}_${timestamp}.log`;
    const filePath = path.join(this.logDir, fileName);
    
    // Créer un fichier vide
    fs.writeFileSync(filePath, '');
    
    // Ajouter au système de rotation
    logRotation.watchFile(filePath);
    
    return filePath;
  }
  
  /**
   * Crée un nouveau fichier de log pour un composant spécifique
   * @param {string} component - Nom du composant
   * @returns {Object} Interface de logger spécifique au composant
   */
  createComponentLogger(component) {
    return {
      info: (message, data) => this.info(`[${component}] ${message}`, data),
      success: (message, data) => this.success(`[${component}] ${message}`, data),
      warn: (message, data) => this.warn(`[${component}] ${message}`, data),
      error: (message, error) => this.error(`[${component}] ${message}`, error),
      debug: (message, data) => this.debug(`[${component}] ${message}`, data),
      trade: (message, data) => this.trade(`[${component}] ${message}`, data),
      system: (message, data) => this.system(`[${component}] ${message}`, data),
      critical: (message, error) => this.critical(`[${component}] ${message}`, error)
    };
  }
}

// Exporter une instance unique
export default new Logger();