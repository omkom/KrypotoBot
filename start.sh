#!/bin/bash
# start.sh
# Script de démarrage optimisé pour KryptoBot avec vérifications préalables

set -e

# Couleurs pour le formatage
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Bannière
display_banner() {
  echo -e "${CYAN}"
  echo "██╗  ██╗██████╗ ██╗   ██╗██████╗ ████████╗ ██████╗ ██████╗  ██████╗ ████████╗"
  echo "██║ ██╔╝██╔══██╗╚██╗ ██╔╝██╔══██╗╚══██╔══╝██╔═══██╗██╔══██╗██╔═══██╗╚══██╔══╝"
  echo "█████╔╝ ██████╔╝ ╚████╔╝ ██████╔╝   ██║   ██║   ██║██████╔╝██║   ██║   ██║   "
  echo "██╔═██╗ ██╔══██╗  ╚██╔╝  ██╔═══╝    ██║   ██║   ██║██╔══██╗██║   ██║   ██║   "
  echo "██║  ██╗██║  ██║   ██║   ██║        ██║   ╚██████╔╝██████╔╝╚██████╔╝   ██║   "
  echo "╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝   ╚═╝        ╚═╝    ╚═════╝ ╚═════╝  ╚═════╝    ╚═╝   "
  echo -e "                  Trading Avancé sur Solana - v2.0.0${NC}"
  echo -e "${BLUE}==========================================================================${NC}"
}

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

# Afficher la bannière
display_banner

# Vérifier les prérequis
check_prerequisites() {
  log "INFO" "Vérification des prérequis..."
  
  # Vérifier Docker
  if ! command -v docker &> /dev/null; then
    log "ERROR" "Docker n'est pas installé. Veuillez l'installer avant de continuer."
    exit 1
  fi
  
  # Vérifier Docker Compose
  if ! command -v docker compose &> /dev/null; then
    log "ERROR" "Docker Compose n'est pas installé. Veuillez l'installer avant de continuer."
    exit 1
  fi
  
  # Vérifier le fichier .env
  if [ ! -f ".env" ]; then
    if [ -f ".env.sample" ]; then
      log "WARNING" "Fichier .env non trouvé. Copie depuis .env.sample"
      cp .env.sample .env
      log "WARNING" "Veuillez éditer le fichier .env avec vos configurations spécifiques"
    else
      log "ERROR" "Fichier .env.sample introuvable. Impossible de continuer."
      exit 1
    fi
  fi
  
  log "SUCCESS" "✓ Vérification des prérequis terminée"
}

# Configurer les volumes Docker
setup_volumes() {
  log "INFO" "Configuration des volumes Docker..."
  
  # Exécuter le script de configuration des volumes
  if [ -f "./docker/setup-volumes.sh" ]; then
    bash ./docker/setup-volumes.sh
  else
    # Configuration manuelle si le script n'existe pas
    log "INFO" "Script setup-volumes.sh non trouvé, configuration manuelle..."
    
    # Créer les répertoires nécessaires
    mkdir -p ./logs ./logs/instances ./logs/analysis ./docker-volumes/{mongodb,redis,prometheus,grafana}
    
    # Configurer les permissions
    chmod -R 777 ./logs
    chmod -R 777 ./docker-volumes
    
    log "SUCCESS" "✓ Volumes configurés manuellement"
  fi
}

# Vérifier l'état des conteneurs
check_containers() {
  log "INFO" "Vérification de l'état des conteneurs Docker..."
  
  # Vérifier si des conteneurs du bot sont déjà en cours d'exécution
  RUNNING_CONTAINERS=$(docker ps --format '{{.Names}}' | grep 'memecoin' | wc -l)
  
  if [ "$RUNNING_CONTAINERS" -gt 0 ]; then
    log "WARNING" "Des conteneurs du bot sont déjà en cours d'exécution ($RUNNING_CONTAINERS conteneurs)"
    
    # Lister les conteneurs
    echo -e "${YELLOW}Conteneurs en cours d'exécution:${NC}"
    docker ps --format 'table {{.Names}}\t{{.Status}}' | grep 'memecoin'
    
    read -p "Voulez-vous arrêter ces conteneurs et redémarrer? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
      log "INFO" "Arrêt des conteneurs en cours..."
      docker compose down
      log "SUCCESS" "✓ Conteneurs arrêtés avec succès"
    else
      log "INFO" "Utilisation des conteneurs existants"
    fi
  else
    log "INFO" "Aucun conteneur du bot en cours d'exécution"
  fi
}

# Démarrer l'application
start_application() {
  local mode=$1
  log "INFO" "Démarrage de KryptoBot en mode $mode..."
  
  # Démarrer avec le mode approprié
  case $mode in
    "prod"|"production")
      log "INFO" "Mode PRODUCTION - Démarrage en arrière-plan"
      docker compose up -d --privileged
      ;;
    "dev"|"development")
      log "INFO" "Mode DÉVELOPPEMENT - Affichage des logs en direct"
      docker compose up --privileged
      ;;
    "debug")
      # Créer un fichier .env.debug avec DEBUG=true
      if [ ! -f ".env.debug" ]; then
        cp .env .env.debug
        sed -i 's/DEBUG=.*/DEBUG=true/g' .env.debug
        sed -i 's/DEBUG_MODE=.*/DEBUG_MODE=true/g' .env.debug
        sed -i 's/DRY_RUN=.*/DRY_RUN=true/g' .env.debug
      fi
      
      log "INFO" "Mode DEBUG - Exécution avec DRY_RUN=true et logs détaillés"
      docker compose --env-file .env.debug up --privileged
      ;;
    *)
      log "ERROR" "Mode inconnu: $mode. Utilisez 'prod', 'dev' ou 'debug'."
      exit 1
      ;;
  esac
}

# Fonctionnalité de backup avant mise à jour
backup_before_update() {
  log "INFO" "Sauvegarde avant mise à jour..."
  
  if [ -f "./docker/backup.sh" ]; then
    bash ./docker/backup.sh
    log "SUCCESS" "✓ Sauvegarde terminée avec succès"
  else
    log "WARNING" "Script de sauvegarde non trouvé. Continuez à vos risques."
    
    read -p "Voulez-vous continuer sans sauvegarde? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      log "INFO" "Opération annulée"
      exit 0
    fi
  fi
}

# Fonction principale
main() {
  local command=${1:-"start"}
  local mode=${2:-"prod"}
  
  case $command in
    "start")
      check_prerequisites
      setup_volumes
      check_containers
      start_application $mode
      ;;
    "rebuild")
      log "INFO" "Reconstruction complète avec suppression des caches..."
      docker compose down --volumes --remove-orphans
      docker image prune -f
      docker compose build --no-cache
      docker compose up -d
      log "SUCCESS" "✓ Reconstruction et redémarrage terminés"
      ;;
    "stop")
      log "INFO" "Arrêt des conteneurs..."
      docker compose down
      log "SUCCESS" "✓ Conteneurs arrêtés avec succès"
      ;;
    "restart")
      log "INFO" "Redémarrage des conteneurs..."
      docker compose restart
      log "SUCCESS" "✓ Conteneurs redémarrés avec succès"
      ;;
    "logs")
      log "INFO" "Affichage des logs..."
      docker compose logs -f
      ;;
    "status")
      log "INFO" "État des conteneurs:"
      docker compose ps
      ;;
    "update")
      log "INFO" "Mise à jour de KryptoBot..."
      
      # Sauvegarder avant la mise à jour
      backup_before_update
      
      # Arrêter les conteneurs
      docker compose down
      
      # Mettre à jour le code (à adapter selon votre méthode de mise à jour)
      if [ -d ".git" ]; then
        log "INFO" "Mise à jour depuis Git..."
        git pull
      else
        log "WARNING" "Dépôt Git non détecté. Veuillez mettre à jour manuellement."
      fi
      
      # Reconstruire les images
      log "INFO" "Reconstruction des images Docker..."
      docker compose build
      
      # Redémarrer
      log "INFO" "Redémarrage des conteneurs avec les nouvelles images..."
      docker compose up -d
      
      log "SUCCESS" "✓ Mise à jour terminée avec succès"
      ;;
    "backup")
      log "INFO" "Exécution d'une sauvegarde manuelle..."
      if [ -f "./docker/backup.sh" ]; then
        bash ./docker/backup.sh
      else
        log "ERROR" "Script de sauvegarde non trouvé: ./docker/backup.sh"
        exit 1
      fi
      ;;
    "restore")
      if [ -z "$2" ]; then
        log "ERROR" "Veuillez spécifier un fichier de sauvegarde à restaurer"
        log "INFO" "Usage: $0 restore <backup_file>"
        exit 1
      fi
      
      backup_file=$2
      log "INFO" "Restauration depuis $backup_file..."
      
      # Arrêter les conteneurs avant la restauration
      docker compose down
      
      # Exécuter la restauration
      if [ -f "./docker/backup.sh" ]; then
        bash ./docker/backup.sh restore "$backup_file"
      else
        log "ERROR" "Script de sauvegarde non trouvé: ./docker/backup.sh"
        exit 1
      fi
      
      # Redémarrer après la restauration
      log "INFO" "Redémarrage des conteneurs après restauration..."
      docker compose up -d
      
      log "SUCCESS" "✓ Restauration terminée avec succès"
      ;;
    "help")
      echo -e "${CYAN}KryptoBot - Options de commande:${NC}"
      echo "  start [mode]  - Démarrer l'application (modes: prod, dev, debug)"
      echo "  rebuild       - Reconstruit tout à neuf sans cache et relance les conteneurs"
      echo "  stop          - Arrêter tous les conteneurs"
      echo "  restart       - Redémarrer tous les conteneurs"
      echo "  logs          - Afficher les logs des conteneurs"
      echo "  status        - Afficher l'état des conteneurs"
      echo "  update        - Mettre à jour l'application"
      echo "  backup        - Effectuer une sauvegarde manuelle"
      echo "  restore file  - Restaurer à partir d'une sauvegarde"
      echo "  help          - Afficher cette aide"
      ;;
    *)
      log "ERROR" "Commande inconnue: $command"
      echo -e "${YELLOW}Utilisez '$0 help' pour afficher les commandes disponibles${NC}"
      exit 1
      ;;
  esac
}

# Exécuter la fonction principale avec les arguments
main "$@"