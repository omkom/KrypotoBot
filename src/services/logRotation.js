// src/services/logRotation.js
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { createReadStream, createWriteStream } from 'fs';
import config from '../config/index.js';
import chalk from 'chalk';

/**
 * Système avancé de rotation et compression des logs
 * Gère la rotation basée sur la taille et le temps
 * avec archivage automatique des fichiers anciens
 */
class LogRotation {
  constructor() {
    // Configuration par défaut
    this.config = {
      // Taille maximale d'un fichier log avant rotation (5MB par défaut)
      maxSize: config.get('LOG_MAX_SIZE') || 5 * 1024 * 1024,
      // Nombre de fichiers à conserver après rotation
      maxFiles: config.get('LOG_MAX_FILES') || 10,
      // Intervalle de vérification des rotations (en ms)
      checkInterval: config.get('LOG_CHECK_INTERVAL') || 3600000, // 1 heure
      // Extension pour les fichiers compressés
      compressExt: '.gz',
      // Si true, force la compression même si le fichier est petit
      forceCompress: config.get('LOG_FORCE_COMPRESS') || false,
      // Taille minimale pour compression (par défaut 10KB)
      minSizeCompress: config.get('LOG_MIN_SIZE_COMPRESS') || 10 * 1024,
      // Délai avant compression d'un fichier roulé (ms)
      compressDelay: config.get('LOG_COMPRESS_DELAY') || 10000 // 10 secondes
    };
    
    // Timer pour vérification périodique
    this.checkTimer = null;
    // Liste des fichiers en cours de surveillance
    this.watchedFiles = new Map();
    
    // Démarrer la surveillance périodique
    this.startPeriodicCheck();
  }
  
  /**
   * Démarre la vérification périodique des fichiers logs
   */
  startPeriodicCheck() {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
    }
    
    this.checkTimer = setInterval(() => {
      this.checkAllFiles();
    }, this.config.checkInterval);
    
    console.log(chalk.blue('🔄 Système de rotation des logs démarré - Vérification toutes les ' + 
      (this.config.checkInterval / 60000).toFixed(1) + ' minutes'));
  }
  
  /**
   * Ajoute un fichier à surveiller pour rotation
   * @param {string} filePath - Chemin du fichier log
   */
  watchFile(filePath) {
    if (!this.watchedFiles.has(filePath)) {
      this.watchedFiles.set(filePath, {
        path: filePath,
        lastChecked: Date.now(),
        lastSize: this.getFileSize(filePath)
      });
      
      if (config.get('DEBUG')) {
        console.log(chalk.blue(`🔍 Surveillance du fichier log: ${filePath}`));
      }
      
      // Vérification immédiate pour ce fichier
      this.checkFile(filePath);
    }
    
    return filePath;
  }
  
  /**
   * Obtient la taille d'un fichier
   * @param {string} filePath - Chemin du fichier
   * @returns {number} Taille en octets (0 si le fichier n'existe pas)
   */
  getFileSize(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        return stats.size;
      }
    } catch (error) {
      // Ignorer les erreurs, retourner 0
    }
    
    return 0;
  }
  
  /**
   * Vérifie si un fichier doit être roulé et le fait si nécessaire
   * @param {string} filePath - Chemin du fichier log
   */
  checkFile(filePath) {
    const fileInfo = this.watchedFiles.get(filePath);
    if (!fileInfo) return;
    
    try {
      // Mettre à jour les infos du fichier
      const currentSize = this.getFileSize(filePath);
      fileInfo.lastChecked = Date.now();
      
      // Si la taille dépasse le maximum, faire une rotation
      if (currentSize > this.config.maxSize) {
        if (config.get('DEBUG')) {
          console.log(chalk.yellow(`📏 Taille du fichier ${filePath} (${(currentSize/1024/1024).toFixed(2)}MB) dépasse la limite (${(this.config.maxSize/1024/1024).toFixed(2)}MB) - Rotation en cours`));
        }
        
        this.rotateFile(filePath);
        fileInfo.lastSize = 0; // Réinitialiser la taille après rotation
      } else {
        fileInfo.lastSize = currentSize;
      }
    } catch (error) {
      console.error(chalk.red(`Erreur lors de la vérification du fichier ${filePath}: ${error.message}`));
    }
  }
  
  /**
   * Vérifie tous les fichiers surveillés
   */
  checkAllFiles() {
    for (const [filePath] of this.watchedFiles) {
      this.checkFile(filePath);
    }
    
    // Aussi nettoyer les anciens fichiers
    this.purgeOldFiles();
  }
  
  /**
   * Effectue une rotation de fichier log
   * @param {string} filePath - Chemin du fichier log
   */
  rotateFile(filePath) {
    try {
      // Vérifier si le fichier existe
      if (!fs.existsSync(filePath)) {
        return;
      }
      
      // Générer le nom de fichier avec timestamp
      const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
      const dirName = path.dirname(filePath);
      const baseName = path.basename(filePath);
      const rotateName = `${baseName}.${timestamp}`;
      const rotatedPath = path.join(dirName, rotateName);
      
      // Renommer le fichier (rotation)
      fs.renameSync(filePath, rotatedPath);
      
      // Créer un nouveau fichier vide
      fs.writeFileSync(filePath, '');
      
      console.log(chalk.green(`♻️ Rotation du fichier log: ${filePath} → ${rotateName}`));
      
      // Programmer la compression après un délai
      setTimeout(() => {
        this.compressFile(rotatedPath);
      }, this.config.compressDelay);
    } catch (error) {
      console.error(chalk.red(`Erreur lors de la rotation du fichier ${filePath}: ${error.message}`));
    }
  }
  
  /**
   * Compresser un fichier log après rotation
   * @param {string} filePath - Chemin du fichier à compresser
   */
  compressFile(filePath) {
    try {
      // Vérifier si le fichier existe et a besoin d'être compressé
      if (!fs.existsSync(filePath)) {
        return;
      }
      
      const fileSize = this.getFileSize(filePath);
      
      // Ne compresser que si la taille est suffisante ou forcer
      if (fileSize < this.config.minSizeCompress && !this.config.forceCompress) {
        if (config.get('DEBUG')) {
          console.log(chalk.blue(`🔍 Fichier ${filePath} trop petit pour compression (${fileSize} < ${this.config.minSizeCompress})`));
        }
        return;
      }
      
      // Définir le nom du fichier compressé
      const compressedPath = `${filePath}${this.config.compressExt}`;
      
      // Créer le stream de compression
      const gzip = zlib.createGzip();
      const source = createReadStream(filePath);
      const destination = createWriteStream(compressedPath);
      
      // Pipe pour compression
      source.pipe(gzip).pipe(destination);
      
      // Gérer la fin de compression
      destination.on('finish', () => {
        // Supprimer le fichier original après compression
        fs.unlinkSync(filePath);
        console.log(chalk.green(`🗜️ Fichier compressé: ${filePath} → ${compressedPath}`));
      });
    } catch (error) {
      console.error(chalk.red(`Erreur lors de la compression du fichier ${filePath}: ${error.message}`));
    }
  }
  
  /**
   * Supprime les anciens fichiers logs au-delà de la limite configurée
   */
  purgeOldFiles() {
    try {
      // Pour chaque fichier surveillé
      for (const [filePath] of this.watchedFiles) {
        const dirName = path.dirname(filePath);
        const baseName = path.basename(filePath);
        
        // Trouver tous les fichiers qui correspondent au pattern de rotation
        const fileRegex = new RegExp(`^${baseName}\\..*`);
        
        let rotatedFiles = fs.readdirSync(dirName)
          .filter(file => fileRegex.test(file))
          .map(file => ({
            name: file,
            path: path.join(dirName, file),
            time: fs.statSync(path.join(dirName, file)).mtime.getTime()
          }));
          
        // Trier par date (plus récent d'abord)
        rotatedFiles.sort((a, b) => b.time - a.time);
        
        // Garder seulement le nombre spécifié de fichiers
        if (rotatedFiles.length > this.config.maxFiles) {
          // Supprimer les fichiers excédentaires (les plus anciens)
          const filesToDelete = rotatedFiles.slice(this.config.maxFiles);
          
          for (const fileInfo of filesToDelete) {
            try {
              if (fs.existsSync(fileInfo.path)) {
                fs.unlinkSync(fileInfo.path);
                console.log(chalk.yellow(`🗑️ Suppression de l'ancien fichier log: ${fileInfo.name}`));
              }
            } catch (deleteError) {
              console.error(chalk.red(`Erreur lors de la suppression du fichier ${fileInfo.path}: ${deleteError.message}`));
            }
          }
        }
      }
    } catch (error) {
      console.error(chalk.red(`Erreur lors du nettoyage des anciens fichiers logs: ${error.message}`));
    }
  }
}

// Exporter une instance unique
export default new LogRotation();