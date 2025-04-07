#!/bin/bash
set -eo pipefail  # Improved error handling

# Replace environment variables in JS files
replace_env_vars() {
  local dir="$1"
  local env_vars=("API_URL" "NODE_ENV")
  
  echo "Replacing environment variables in JS files..."
  
  find "$dir" -type f -name "*.js" | while read -r file; do
    echo "Processing: $file"
    
    for env_var in "${env_vars[@]}"; do
      env_var_value="${!env_var}"
      
      if [ -n "$env_var_value" ]; then
        echo "Replacing $env_var with $env_var_value"
        sed -i "s|__${env_var}__|${env_var_value}|g" "$file"
      fi
    done
  done
  
  echo "Environment variable replacement complete"
}

# Check if we're in a web directory
if [ -d "/usr/share/nginx/html" ]; then
  replace_env_vars "/usr/share/nginx/html"
fi

# Execute the main container command
exec "$@"