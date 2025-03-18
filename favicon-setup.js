/**
 * favicon-setup.js
 * 
 * Utility script to download and set up the favicon across the application
 * Use: node favicon-setup.js
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import chalk from 'chalk';

// Favicon URL to download
const FAVICON_URL = 'https://avatars.githubusercontent.com/u/127771723?v=4&size=64';
// Paths to save the favicon
const FAVICON_PATHS = [
  './dashboard/public/favicon.ico',
  './dashboard/public/logo.png',
  './public/favicon.ico',
  './public/logo.png'
];

// Create directories if they don't exist
const ensureDirectoryExists = (filePath) => {
  const dirname = path.dirname(filePath);
  if (!fs.existsSync(dirname)) {
    fs.mkdirSync(dirname, { recursive: true });
    console.log(chalk.green(`Created directory: ${dirname}`));
  }
};

// Download the favicon
const downloadFavicon = (url, destination) => {
  return new Promise((resolve, reject) => {
    ensureDirectoryExists(destination);
    
    const file = fs.createWriteStream(destination);
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download favicon: ${response.statusCode}`));
        return;
      }
      
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        console.log(chalk.green(`Downloaded favicon to: ${destination}`));
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(destination, () => {}); // Delete the file if error
      reject(err);
    });
  });
};

// Update HTML files to include favicon reference
const updateHtmlFiles = () => {
  const htmlFiles = [
    './dashboard/public/index.html',
    './public/index.html'
  ];
  
  htmlFiles.forEach(htmlFile => {
    if (fs.existsSync(htmlFile)) {
      let html = fs.readFileSync(htmlFile, 'utf8');
      
      // Add favicon link if not already present
      if (!html.includes('favicon.ico')) {
        const faviconLink = `<link rel="icon" href="%PUBLIC_URL%/favicon.ico" />
  <link rel="apple-touch-icon" href="%PUBLIC_URL%/logo.png" />`;
        
        // Insert after head tag
        html = html.replace(/<head>/, `<head>\n  ${faviconLink}`);
        fs.writeFileSync(htmlFile, html);
        console.log(chalk.green(`Updated favicon reference in: ${htmlFile}`));
      } else {
        console.log(chalk.blue(`Favicon already referenced in: ${htmlFile}`));
      }
    } else {
      console.log(chalk.yellow(`HTML file not found: ${htmlFile}`));
    }
  });
};

// Update Dockerfile to copy favicon
const updateDockerfiles = () => {
  const dockerfiles = [
    './dashboard/Dockerfile.dashboard',
    './docker/Dockerfile.api'
  ];
  
  dockerfiles.forEach(dockerfile => {
    if (fs.existsSync(dockerfile)) {
      let content = fs.readFileSync(dockerfile, 'utf8');
      
      // Add COPY instruction for favicon if not already present
      if (!content.includes('favicon.ico') && !content.includes('logo.png')) {
        // Find a suitable COPY instruction to add our line after
        const copyLines = content.match(/COPY.*\n/g);
        if (copyLines && copyLines.length > 0) {
          const lastCopyLine = copyLines[copyLines.length - 1];
          content = content.replace(
            lastCopyLine, 
            `${lastCopyLine}COPY ./public/favicon.ico ./public/logo.png /usr/share/nginx/html/\n`
          );
          fs.writeFileSync(dockerfile, content);
          console.log(chalk.green(`Updated Dockerfile to copy favicon: ${dockerfile}`));
        } else {
          console.log(chalk.yellow(`Could not find COPY instruction in: ${dockerfile}`));
        }
      } else {
        console.log(chalk.blue(`Favicon already handled in: ${dockerfile}`));
      }
    } else {
      console.log(chalk.yellow(`Dockerfile not found: ${dockerfile}`));
    }
  });
};

// Main function to run the setup
const setupFavicon = async () => {
  try {
    console.log(chalk.cyan('Starting favicon setup...'));
    
    // Download favicon to all specified paths
    for (const destination of FAVICON_PATHS) {
      await downloadFavicon(FAVICON_URL, destination);
    }
    
    // Update HTML files to reference favicon
    updateHtmlFiles();
    
    // Update Dockerfiles to copy favicon
    updateDockerfiles();
    
    console.log(chalk.green('✓ Favicon setup completed successfully!'));
  } catch (error) {
    console.error(chalk.red(`Error setting up favicon: ${error.message}`));
    process.exit(1);
  }
};

// Run the setup
setupFavicon();