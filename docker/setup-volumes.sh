#!/bin/bash
# docker/setup-volumes.sh
# Script pour initialiser et configurer les volumes Docker persistants

set -e

# Couleurs pour le formatage
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Configuration des volumes Docker pour KryptoBot ===${NC}"

# Répertoires requis pour les données persistantes
VOLUMES=(
  "./logs"
  "./logs/instances"
  "./logs/analysis"
  "./docker-volumes/mongodb"
  "./docker-volumes/redis"
  "./docker-volumes/prometheus"
  "./docker-volumes/grafana"
)

echo -e "${YELLOW}Création des répertoires pour volumes persistants...${NC}"

# Créer les répertoires s'ils n'existent pas
for dir in "${VOLUMES[@]}"; do
  if [ ! -d "$dir" ]; then
    mkdir -p "$dir"
    echo -e "${GREEN}✓ Répertoire créé: $dir${NC}"
  else
    echo -e "${BLUE}→ Répertoire existant: $dir${NC}"
  fi
done

# Configurer les permissions
echo -e "${YELLOW}Configuration des permissions...${NC}"

# Permissions pour les logs (besoin d'écriture par les conteneurs)
chmod -R 777 ./logs
echo -e "${GREEN}✓ Permissions configurées pour ./logs${NC}"

# Permissions pour les volumes de données
chmod -R 777 ./docker-volumes
echo -e "${GREEN}✓ Permissions configurées pour ./docker-volumes${NC}"

# Vérifier l'existence des fichiers de configuration
CONFIG_FILES=(
  ".env"
  "prometheus.yml"
)

echo -e "${YELLOW}Vérification des fichiers de configuration...${NC}"

for file in "${CONFIG_FILES[@]}"; do
  if [ ! -f "$file" ]; then
    if [[ "$file" == ".env" && -f ".env.sample" ]]; then
      cp .env.sample .env
      echo -e "${GREEN}✓ .env créé à partir de .env.sample${NC}"
      echo -e "${YELLOW}⚠ N'oubliez pas de modifier .env avec vos paramètres spécifiques${NC}"
    else
      echo -e "${RED}✗ Fichier manquant: $file${NC}"
    fi
  else
    echo -e "${BLUE}→ Fichier existant: $file${NC}"
  fi
done

# Créer des fichiers placeholder pour les volumes s'ils n'existent pas
PLACEHOLDER_FILES=(
  "./logs/trade_logs.json"
  "./logs/profit_report.json"
  "./logs/error_log.txt"
  "./logs/instance_info.json"
)

echo -e "${YELLOW}Création des fichiers placeholder pour les logs...${NC}"

for file in "${PLACEHOLDER_FILES[@]}"; do
  if [ ! -f "$file" ]; then
    # Déterminer le contenu initial en fonction de l'extension
    if [[ "$file" == *.json ]]; then
      echo "{}" > "$file"
    else
      touch "$file"
    fi
    echo -e "${GREEN}✓ Fichier placeholder créé: $file${NC}"
  else
    echo -e "${BLUE}→ Fichier existant: $file${NC}"
  fi
done

echo -e "${GREEN}=== Configuration des volumes terminée avec succès ===${NC}"
echo -e "${YELLOW}Vous pouvez maintenant démarrer les conteneurs avec 'docker-compose up -d'${NC}"