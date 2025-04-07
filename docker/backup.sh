#!/bin/bash
set -eo pipefail  # Improved error handling

# Add atomic operations for file operations
# Example for backup creation:
create_backup() {
  local source_dir="$1"
  local dest_file="$2"
  local temp_file="${dest_file}.tmp"
  
  # Create tar to temporary file first
  tar -czf "$temp_file" -C "$(dirname "$source_dir")" "$(basename "$source_dir")"
  
  # Atomically move to final destination
  mv "$temp_file" "$dest_file"
}

# Add proper error handling to backup rotation
rotate_backups() {
  local backup_dir="$1"
  local max_backups="$2"
  
  # List files by modification time (oldest first)
  find "$backup_dir" -name "kryptobot_backup_*.tar.gz" -type f -printf "%T@ %p\n" | \
    sort -n | head -n -"$max_backups" | while read -r timestamp filepath; do
    echo "Removing old backup: $(basename "$filepath")"
    rm -f "$filepath"
  done
}