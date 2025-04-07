/**
 * Service de journalisation avancé avec niveaux configurables,
 * rotation automatique des logs, et sortie console colorée
 * 
 * @module logger
 * @requires fs
 * @requires path
 * @requires chalk
 */

import fs from 'fs';
import path from 'path';
import chalk from 'chalk';

// Configuration par défaut
const DEFAULT_CONFIG = {
  // Niveau minimum pour la console (debug, info, warn, error, critical)
  consoleLevel: process.env.LOG_CONSOLE_LEVEL || 'info',
  // Niveau minimum pour les fichiers
  fileLevel: process.env.LOG_FILE_LEVEL || 'debug',
  // Activer/désactiver l'écriture dans les fichiers
  enableFileLogging: process.env.LOG_TO_FILE !== 'false',
  // Activer/désactiver les couleurs dans la console
  enableColors: process.env.LOG_COLORS !== 'false',
  // Répertoire des logs
  logDir: process.env.LOG_DIR || './logs',
  // Fichier de log principal
  logFile: process.env.LOG_FILE || 'app.log',
  // Fichier pour les erreurs uniquement
  errorFile: process.env.ERROR_LOG_FILE || 'error.log',
  // Taille maximum d'un fichier avant rotation (5MB par défaut)
  maxFileSize: parseInt(process.env.LOG_MAX_FILE_SIZE || 5 * 1024 * 1024),
  // Nombre maximal de fichiers de log à conserver
  maxFiles: parseInt(process.env.LOG_MAX_FILES || 10),
  // Format de date pour les logs
  dateFormat: process.env.LOG_DATE_FORMAT || 'YYYY-MM-DD HH:mm:ss.SSS'
};

// Niveaux de log avec leur importance et couleur
const LOG_LEVELS = {
  debug: { value: 0, color: 'magenta', prefix: '🔍 DEBUG' },
  info: { value: 1, color: 'blue', prefix: 'ℹ INFO' },
  success: { value: 1, color: 'green', prefix: '✓ SUCCESS' },
  warn: { value: 2, color: 'yellow', prefix: '⚠ WARNING' },
  error: { value: 3, color: 'red', prefix: '✖ ERROR' },
  critical: { value: 4, color: 'redBright', prefix: '💀 CRITICAL' },
  trade: { value: 2, color: 'cyan', prefix: '💱 TRADE' }
};

/**
 * Gestionnaire de journalisation avec support multi-niveaux et rotation des fichiers
 */
class Logger {
  constructor(config = {}) {
    // Fusionner la config par défaut avec celle fournie
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // S'assurer que le répertoire des logs existe
    this.ensureLogDirectory();
    
    // Initialiser les chemins de fichier
    this.logFilePath = path.join(this.config.logDir, this.config.logFile);
    this.errorFilePath = path.join(this.config.logDir, this.config.errorFile);
    
    // Initialiser les tailles de fichier
    this.logFileSize = this.getFileSize(this.logFilePath);
    this.errorFileSize = this.getFileSize(this.errorFilePath);
    
    // Synchroniser les fichiers de log existants
    this.syncLogFiles();
  }
  
  /**
   * S'assure que le répertoire des logs existe
   */
  ensureLogDirectory() {
    if (!fs.existsSync(this.config.logDir)) {
      try {
        fs.mkdirSync(this.config.logDir, { recursive: true });
      } catch (err) {
        console.error(`Erreur lors de la création du répertoire de logs: ${err.message}`);
      }
    }
  }
  
  /**
   * Obtient la taille d'un fichier en octets
   * @param {string} filePath - Chemin du fichier
   * @returns {number} Taille du fichier en octets (0 si inexistant)
   */
  getFileSize(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        return stats.size;
      }
    } catch (err) {
      // Ignorer les erreurs et retourner 0
    }
    return 0;
  }
  
  /**
   * Synchronise les métadonnées des fichiers de log
   */
  syncLogFiles() {
    this.logFileSize = this.getFileSize(this.logFilePath);
    this.errorFileSize = this.getFileSize(this.errorFilePath);
  }
  
  /**
   * Effectue une rotation d'un fichier de log s'il dépasse la taille maximale
   * @param {string} filePath - Chemin du fichier à vérifier
   * @param {number} currentSize - Taille actuelle du fichier
   * @returns {number} Nouvelle taille après rotation (0 si rotation effectuée)
   */
  rotateLogFileIfNeeded(filePath, currentSize) {
    if (currentSize >= this.config.maxFileSize) {
      try {
        // Générer un timestamp pour le nom du fichier de backup
        const timestamp = new Date().toISOString()
          .replace(/:/g, '-')
          .replace(/\..+/, '');
        
        const fileDir = path.dirname(filePath);
        const fileBase = path.basename(filePath);
        const rotatedFile = path.join(
          fileDir,
          `${fileBase}.${timestamp}`
        );
        
        // Renommer le fichier actuel
        fs.renameSync(filePath, rotatedFile);
        
        // Créer un nouveau fichier vide
        fs.writeFileSync(filePath, '');
        
        // Nettoyer les anciens fichiers si nécessaire
        this.cleanupOldLogFiles(fileDir, fileBase);
        
        return 0;
      } catch (err) {
        console.error(`Erreur lors de la rotation du fichier log: ${err.message}`);
        return currentSize;
      }
    }
    
    return currentSize;
  }
  
  /**
   * Nettoie les anciens fichiers de log pour respecter maxFiles
   * @param {string} dir - Répertoire des logs
   * @param {string} baseFileName - Nom de base du fichier de log
   */
  cleanupOldLogFiles(dir, baseFileName) {
    try {
      // Lire tous les fichiers du répertoire
      const files = fs.readdirSync(dir);
      
      // Filtrer pour ne garder que les fichiers de log rotated
      const pattern = new RegExp(`^${baseFileName}\\.[\\d-]+T[\\d-]+$`);
      const logFiles = files
        .filter(file => pattern.test(file))
        .map(file => ({
          name: file,
          path: path.join(dir, file),
          time: fs.statSync(path.join(dir, file)).mtime.getTime()
        }))
        .sort((a, b) => b.time - a.time); // Plus récent d'abord
      
      // Supprimer les fichiers excédentaires
      if (logFiles.length > this.config.maxFiles) {
        const filesToDelete = logFiles.slice(this.config.maxFiles);
        for (const file of filesToDelete) {
          fs.unlinkSync(file.path);
        }
      }
    } catch (err) {
      console.error(`Erreur lors du nettoyage des anciens logs: ${err.message}`);
    }
  }
  
  /**
   * Formatte un message de log
   * @param {string} level - Niveau de log
   * @param {string} message - Message à journaliser
   * @param {any} data - Données supplémentaires
   * @param {Error} error - Objet d'erreur optionnel
   * @returns {string} Message formatté
   */
  formatLogMessage(level, message, data = null, error = null) {
    // Formater la date 
    const timestamp = new Date().toISOString();
    
    // Créer l'objet de base
    const logObject = {
      timestamp,
      level,
      message
    };
    
    // Ajouter les données si présentes
    if (data !== null) {
      logObject.data = data;
    }
    
    // Ajouter les informations d'erreur si présentes
    if (error) {
      logObject.error = {
        message: error.message,
        stack: error.stack
      };
    }
    
    return JSON.stringify(logObject);
  }
  
  /**
   * Écrit un message dans le fichier de log
   * @param {string} level - Niveau de log
   * @param {string} message - Message à journaliser
   * @param {any} data - Données supplémentaires
   * @param {Error} error - Objet d'erreur optionnel
   * @returns {boolean} Succès de l'écriture
   */
  writeToFile(level, message, data = null, error = null) {
    if (!this.config.enableFileLogging) {
      return false;
    }
    
    // Vérifier le niveau de log minimum pour les fichiers
    if (LOG_LEVELS[level].value < LOG_LEVELS[this.config.fileLevel].value) {
      return false;
    }
    
    try {
      // Formater le message
      const logMessage = this.formatLogMessage(level, message, data, error);
      
      // Ajouter une nouvelle ligne
      const logEntry = `${logMessage}\n`;
      
      // Écrire dans le fichier principal
      this.logFileSize = this.rotateLogFileIfNeeded(this.logFilePath, this.logFileSize);
      fs.appendFileSync(this.logFilePath, logEntry);
      this.logFileSize += Buffer.byteLength(logEntry);
      
      // Si c'est une erreur, écrire aussi dans le fichier d'erreur
      if (level === 'error' || level === 'critical') {
        this.errorFileSize = this.rotateLogFileIfNeeded(this.errorFilePath, this.errorFileSize);
        fs.appendFileSync(this.errorFilePath, logEntry);
        this.errorFileSize += Buffer.byteLength(logEntry);
      }
      
      return true;
    } catch (err) {
      console.error(`Erreur d'écriture dans le fichier log: ${err.message}`);
      return false;
    }
  }
  
  /**
   * Écrit un message dans la console avec la couleur appropriée
   * @param {string} level - Niveau de log
   * @param {string} message - Message à journaliser
   * @param {any} data - Données supplémentaires
   * @param {Error} error - Objet d'erreur optionnel
   */
  writeToConsole(level, message, data = null, error = null) {
    // Vérifier le niveau de log minimum pour la console
    if (LOG_LEVELS[level].value < LOG_LEVELS[this.config.consoleLevel].value) {
      return;
    }
    
    const levelConfig = LOG_LEVELS[level];
    const prefix = levelConfig.prefix;
    
    // Utiliser chalk si les couleurs sont activées
    const colorizedPrefix = this.config.enableColors 
      ? chalk[levelConfig.color](prefix)
      : prefix;
    
    // Afficher le message
    console.log(`${colorizedPrefix}: ${message}`);
    
    // Afficher les données si présentes et si c'est un niveau debug
    if (data !== null && (level === 'debug' || this.config.consoleLevel === 'debug')) {
      if (typeof data === 'object') {
        console.log(
          this.config.enableColors 
            ? chalk.gray(JSON.stringify(data, null, 2))
            : JSON.stringify(data, null, 2)
        );
      } else {
        console.log(
          this.config.enableColors 
            ? chalk.gray(String(data))
            : String(data)
        );
      }
    }
    
    // Afficher la stack trace pour les erreurs
    if (error && error.stack) {
      console.log(
        this.config.enableColors 
          ? chalk.red(error.stack)
          : error.stack
      );
    }
  }
  
  /**
   * Méthode principale de log qui distribue aux différentes sorties
   * @param {string} level - Niveau de log
   * @param {string} message - Message à journaliser
   * @param {any} data - Données supplémentaires
   * @param {Error} error - Objet d'erreur optionnel
   */
  log(level, message, data = null, error = null) {
    if (!LOG_LEVELS[level]) {
      level = 'info'; // Niveau par défaut
    }
    
    // Écrire dans la console
    this.writeToConsole(level, message, data, error);
    
    // Écrire dans le fichier
    this.writeToFile(level, message, data, error);
  }
  
  /**
   * Log de niveau debug
   * @param {string} message - Message à journaliser
   * @param {any} data - Données supplémentaires
   */
  debug(message, data = null) {
    this.log('debug', message, data);
  }
  
  /**
   * Log de niveau info
   * @param {string} message - Message à journaliser
   * @param {any} data - Données supplémentaires
   */
  info(message, data = null) {
    this.log('info', message, data);
  }
  
  /**
   * Log de succès
   * @param {string} message - Message à journaliser
   * @param {any} data - Données supplémentaires
   */
  success(message, data = null) {
    this.log('success', message, data);
  }
  
  /**
   * Log d'avertissement
   * @param {string} message - Message à journaliser
   * @param {any} data - Données supplémentaires
   */
  warn(message, data = null) {
    this.log('warn', message, data);
  }
  
  /**
   * Log d'erreur
   * @param {string} message - Message à journaliser
   * @param {Error} error - Objet d'erreur optionnel
   */
  error(message, error = null) {
    this.log('error', message, null, error);
  }
  
  /**
   * Log d'erreur critique
   * @param {string} message - Message à journaliser
   * @param {Error} error - Objet d'erreur optionnel
   */
  critical(message, error = null) {
    this.log('critical', message, null, error);
  }
  
  /**
   * Log spécifique pour les trades
   * @param {string} message - Message à journaliser
   * @param {any} data - Données de trade
   */
  trade(message, data = null) {
    this.log('trade', message, data);
  }
  
  /**
   * Crée un logger spécifique à un composant
   * @param {string} component - Nom du composant
   * @returns {Object} Logger avec préfixe de composant
   */
  createComponentLogger(component) {
    return {
      debug: (message, data) => this.debug(`[${component}] ${message}`, data),
      info: (message, data) => this.info(`[${component}] ${message}`, data),
      success: (message, data) => this.success(`[${component}] ${message}`, data),
      warn: (message, data) => this.warn(`[${component}] ${message}`, data),
      error: (message, error) => this.error(`[${component}] ${message}`, error),
      critical: (message, error) => this.critical(`[${component}] ${message}`, error),
      trade: (message, data) => this.trade(`[${component}] ${message}`, data)
    };
  }
  
  /**
   * Change la configuration du logger
   * @param {Object} newConfig - Nouvelle configuration
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this.ensureLogDirectory();
    this.logFilePath = path.join(this.config.logDir, this.config.logFile);
    this.errorFilePath = path.join(this.config.logDir, this.config.errorFile);
    this.syncLogFiles();
  }
}

// Exporter une instance singleton
export default new Logger();