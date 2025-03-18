#!/bin/bash
set -e

# Replace environment variables in the built JS files
if [ -d "/usr/share/nginx/html" ]; then
  echo "Replacing environment variables in JS files..."
  
  # Define the list of environment variables to replace
  env_vars=(
    "API_URL"
    "NODE_ENV"
  )
  
  # For each JS file in the build directory
  find /usr/share/nginx/html -type f -name "*.js" | while read -r file; do
    echo "Processing: $file"
    
    # For each environment variable
    for env_var in "${env_vars[@]}"; do
      # Get the environment variable value
      env_var_value="${!env_var}"
      
      # If the environment variable is set
      if [ -n "$env_var_value" ]; then
        # Replace placeholders with the actual value
        echo "Replacing $env_var with $env_var_value"
        sed -i "s|__${env_var}__|${env_var_value}|g" "$file"
      fi
    done
  done
  
  echo "Environment variable replacement complete"
fi

# Execute the main container command
exec "$@"