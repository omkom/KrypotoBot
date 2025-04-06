#!/bin/bash
# docker/backup.sh
# Script automatisé de sauvegarde pour les données critiques du KryptoBot

set -e

# Couleurs pour le formatage
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
BACKUP_DIR="./backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/kryptobot_backup_${TIMESTAMP}.tar.gz"

# Répertoires à sauvegarder
DIRS_TO_BACKUP=(
  "./logs"
  "./docker-volumes/mongodb"
  "./docker-volumes/redis"
)

# Fichiers de configuration à sauvegarder
CONFIG_FILES=(
  ".env"
  "prometheus.yml"
  "docker-compose.yml"
)

# Fonction pour afficher les messages avec horodatage
log() {
  local level=$1
  local message=$2
  local color=$BLUE
  
  case $level in
    "INFO") color=$BLUE ;;
    "SUCCESS") color=$GREEN ;;
    "WARNING") color=$YELLOW ;;
    "ERROR") color=$RED ;;
  esac
  
  echo -e "${color}[$(date +'%Y-%m-%d %H:%M:%S')] [${level}] ${message}${NC}"
}

# Afficher le démarrage
log "INFO" "=== Démarrage de la sauvegarde KryptoBot ==="

# Créer le répertoire de sauvegarde s'il n'existe pas
if [ ! -d "$BACKUP_DIR" ]; then
  mkdir -p "$BACKUP_DIR"
  log "INFO" "Répertoire de sauvegarde créé: $BACKUP_DIR"
fi

# Vérifier l'espace disque disponible
AVAILABLE_SPACE=$(df -BM --output=avail $BACKUP_DIR | tail -n 1 | tr -d 'M')
log "INFO" "Espace disque disponible: ${AVAILABLE_SPACE}MB"

if [ "$AVAILABLE_SPACE" -lt 500 ]; then
  log "WARNING" "⚠️ Espace disque faible (${AVAILABLE_SPACE}MB). Rotation des anciennes sauvegardes..."
  
  # Supprimer les anciennes sauvegardes (garder les 5 plus récentes)
  ls -t $BACKUP_DIR/kryptobot_backup_*.tar.gz 2>/dev/null | tail -n +6 | xargs rm -f 2>/dev/null || true
  log "INFO" "Rotation des anciennes sauvegardes terminée"
fi

# Créer un répertoire temporaire pour la sauvegarde
TEMP_DIR=$(mktemp -d)
log "INFO" "Répertoire temporaire créé: $TEMP_DIR"

# Copier les fichiers de configuration
mkdir -p "$TEMP_DIR/config"
for file in "${CONFIG_FILES[@]}"; do
  if [ -f "$file" ]; then
    cp "$file" "$TEMP_DIR/config/"
    log "INFO" "Configuration sauvegardée: $file"
  else
    log "WARNING" "Fichier de configuration introuvable: $file"
  fi
done

# Créer un tarball pour chaque répertoire
for dir in "${DIRS_TO_BACKUP[@]}"; do
  if [ -d "$dir" ]; then
    dir_name=$(basename "$dir")
    dir_parent=$(dirname "$dir")
    
    log "INFO" "Sauvegarde du répertoire: $dir"
    
    # Créer l'archive tar pour ce répertoire
    tar -czf "$TEMP_DIR/${dir_name}.tar.gz" -C "$dir_parent" "$dir_name"
    
    # Vérifier si la sauvegarde a réussi
    if [ $? -eq 0 ]; then
      log "SUCCESS" "✓ Répertoire sauvegardé: $dir"
    else
      log "ERROR" "✗ Erreur lors de la sauvegarde de $dir"
    fi
  else
    log "WARNING" "Répertoire à sauvegarder introuvable: $dir"
  fi
done

# Créer une archive finale contenant toutes les sauvegardes
log "INFO" "Création de l'archive finale..."
tar -czf "$BACKUP_FILE" -C "$TEMP_DIR" .

# Vérifier si la sauvegarde finale a réussi
if [ $? -eq 0 ]; then
  BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  log "SUCCESS" "✅ Sauvegarde terminée avec succès: $BACKUP_FILE (Taille: $BACKUP_SIZE)"
else
  log "ERROR" "❌ Erreur lors de la création de l'archive finale"
  exit 1
fi

# Nettoyer le répertoire temporaire
rm -rf "$TEMP_DIR"
log "INFO" "Nettoyage du répertoire temporaire"

# Afficher les informations de la sauvegarde
BACKUP_COUNT=$(ls -1 $BACKUP_DIR/kryptobot_backup_*.tar.gz 2>/dev/null | wc -l)
OLDEST_BACKUP=$(ls -t $BACKUP_DIR/kryptobot_backup_*.tar.gz 2>/dev/null | tail -n 1)
TOTAL_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)

log "INFO" "=== Résumé de la sauvegarde ==="
log "INFO" "Nombre total de sauvegardes: $BACKUP_COUNT"
log "INFO" "Sauvegarde la plus ancienne: $OLDEST_BACKUP"
log "INFO" "Taille totale des sauvegardes: $TOTAL_SIZE"
log "INFO" "=== Sauvegarde terminée avec succès ==="

# Fonction pour restaurer une sauvegarde (utile en cas de besoin)
# Usage: ./backup.sh restore <backup_file>
if [ "$1" == "restore" ]; then
  RESTORE_FILE="$2"
  
  if [ ! -f "$RESTORE_FILE" ]; then
    log "ERROR" "Fichier de sauvegarde introuvable: $RESTORE_FILE"
    exit 1
  fi
  
  log "WARNING" "⚠️ RESTAURATION DE SAUVEGARDE: $RESTORE_FILE"
  log "WARNING" "Cette opération va écraser les données existantes!"
  
  read -p "Êtes-vous sûr de vouloir continuer? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    log "INFO" "Restauration annulée"
    exit 0
  fi
  
  # Créer un répertoire temporaire pour la restauration
  RESTORE_TEMP=$(mktemp -d)
  log "INFO" "Extraction de la sauvegarde..."
  
  # Extraire l'archive principale
  tar -xzf "$RESTORE_FILE" -C "$RESTORE_TEMP"
  
  # Restaurer les fichiers de configuration
  if [ -d "$RESTORE_TEMP/config" ]; then
    cp -v "$RESTORE_TEMP/config"/* ./
    log "SUCCESS" "✓ Fichiers de configuration restaurés"
  fi
  
  # Restaurer les répertoires
  for dir in "${DIRS_TO_BACKUP[@]}"; do
    dir_name=$(basename "$dir")
    if [ -f "$RESTORE_TEMP/${dir_name}.tar.gz" ]; then
      # Créer le répertoire parent si nécessaire
      mkdir -p "$(dirname "$dir")"
      
      # Supprimer l'ancien répertoire si existant
      if [ -d "$dir" ]; then
        rm -rf "$dir"
      fi
      
      # Extraire l'archive
      tar -xzf "$RESTORE_TEMP/${dir_name}.tar.gz" -C "$(dirname "$dir")"
      log "SUCCESS" "✓ Répertoire restauré: $dir"
    else
      log "WARNING" "Archive introuvable pour $dir"
    fi
  done
  
  # Nettoyer
  rm -rf "$RESTORE_TEMP"
  log "SUCCESS" "✅ Restauration terminée avec succès"
fi

exit 0