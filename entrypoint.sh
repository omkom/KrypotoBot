#!/bin/bash
set -e

# Replace environment variables in JavaScript files
for file in /usr/share/nginx/html/static/js/*.js; do
  echo "Processing $file..."
  
  # Replace API_URL placeholder with actual environment variable
  if [ ! -z "$API_URL" ]; then
    sed -i "s|__API_URL__|$API_URL|g" $file
  fi
  
  # Add other environment variable replacements as needed
done

# Start Nginx
exec "$@"