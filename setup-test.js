#!/usr/bin/env node
/**
 * KryptoBot Environment Setup Test
 * 
 * This script tests all required dependencies, configurations, and environment 
 * settings before development or deployment.
 * 
 * Run with: node setup-test.js
 */

// Import required dependencies (ESM style)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec, execSync } from 'child_process';
import chalk from 'chalk';
import dotenv from 'dotenv';
import axios from 'axios';
import { Keypair } from '@solana/web3.js';

// Fix __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const CONFIG = {
  requiredFiles: ['.env', 'package.json', 'docker-compose.yml'],
  requiredDirs: ['logs', 'src'],
  requiredDeps: [
    '@solana/web3.js', '@solana/spl-token', 'axios', 'chalk', 'dotenv'
  ],
  requiredEnvVars: [
    'SOLANA_RPC_URL_PROD', 'SOLANA_PRIVATE_KEY_PROD',
    'DEXSCREENER_API_URL', 'JUPITER_API_BASE'
  ]
};

// Utility for formatted log output
const logger = {
  info: (msg) => console.log(chalk.blue('ℹ INFO: ') + msg),
  success: (msg) => console.log(chalk.green('✓ SUCCESS: ') + msg),
  warning: (msg) => console.log(chalk.yellow('⚠ WARNING: ') + msg),
  error: (msg) => console.log(chalk.red('✖ ERROR: ') + msg),
  section: (title) => console.log(chalk.cyan.bold(`\n=== ${title} ===`))
};

// Collection of issues and fixes to present at the end
const issues = [];

/**
 * Add an issue with its fix command
 * @param {string} description - Description of the issue
 * @param {string} fixCommand - Command to fix the issue
 */
function addIssue(description, fixCommand) {
  issues.push({ description, fixCommand });
}

/**
 * Check if required files exist
 * @returns {boolean} Whether all files exist
 */
function checkRequiredFiles() {
  logger.section('Checking Required Files');
  let allFilesExist = true;
  
  for (const file of CONFIG.requiredFiles) {
    const filePath = path.join(process.cwd(), file);
    if (fs.existsSync(filePath)) {
      logger.success(`Found required file: ${file}`);
    } else {
      logger.error(`Missing required file: ${file}`);
      allFilesExist = false;
      
      if (file === '.env') {
        addIssue(`Missing .env file`, `cp .env.sample .env && nano .env`);
      } else if (file === 'package.json') {
        addIssue(`Missing package.json file`, `npm init -y`);
      }
    }
  }
  
  return allFilesExist;
}

/**
 * Check if required directories exist
 * @returns {boolean} Whether all directories exist
 */
function checkRequiredDirectories() {
  logger.section('Checking Required Directories');
  let allDirsExist = true;
  
  for (const dir of CONFIG.requiredDirs) {
    const dirPath = path.join(process.cwd(), dir);
    if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
      logger.success(`Found required directory: ${dir}`);
    } else {
      logger.error(`Missing required directory: ${dir}`);
      allDirsExist = false;
      
      addIssue(`Missing ${dir} directory`, `mkdir -p ${dir}`);
    }
  }
  
  return allDirsExist;
}

/**
 * Check Node.js version to ensure compatibility
 * @returns {boolean} Whether Node.js version is compatible
 */
function checkNodeVersion() {
  logger.section('Checking Node.js Version');
  
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.substring(1).split('.')[0], 10);
  
  logger.info(`Detected Node.js ${nodeVersion}`);
  
  if (major < 16) {
    logger.error(`Node.js version ${nodeVersion} is not supported. Version 16+ is required.`);
    addIssue(`Upgrade Node.js to v16+`, `nvm install 16 && nvm use 16`);
    return false;
  }
  
  logger.success(`Node.js ${nodeVersion} is supported`);
  return true;
}

/**
 * Check if required npm dependencies are installed
 * @returns {boolean} Whether all dependencies are installed
 */
function checkDependencies() {
  logger.section('Checking Dependencies');
  
  let packageJsonPath = path.join(process.cwd(), 'package.json');
  
  if (!fs.existsSync(packageJsonPath)) {
    logger.error(`Cannot check dependencies: package.json not found`);
    return false;
  }
  
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const installedDeps = {
    ...packageJson.dependencies || {},
    ...packageJson.devDependencies || {}
  };
  
  let allDepsInstalled = true;
  let missingDeps = [];
  
  for (const dep of CONFIG.requiredDeps) {
    if (installedDeps[dep]) {
      logger.success(`Found dependency: ${dep}`);
    } else {
      logger.error(`Missing dependency: ${dep}`);
      allDepsInstalled = false;
      missingDeps.push(dep);
    }
  }
  
  if (missingDeps.length > 0) {
    addIssue(`Missing dependencies: ${missingDeps.join(', ')}`, 
             `npm install ${missingDeps.join(' ')}`);
  }
  
  return allDepsInstalled;
}

/**
 * Perform Docker check to see if Docker is installed and running
 * @returns {boolean} Whether Docker is properly configured
 */
function checkDocker() {
  logger.section('Checking Docker Setup');
  
  try {
    const dockerVersion = execSync('docker --version', { stdio: 'pipe' }).toString().trim();
    logger.success(`Docker is installed: ${dockerVersion}`);
    
    try {
      execSync('docker info', { stdio: 'pipe' });
      logger.success('Docker daemon is running');
      return true;
    } catch (error) {
      logger.error('Docker daemon is not running');
      addIssue('Docker daemon is not running', 'sudo systemctl start docker');
      return false;
    }
  } catch (error) {
    logger.error('Docker is not installed or not in PATH');
    addIssue('Docker is not installed', 'Visit https://docs.docker.com/get-docker/ for installation instructions');
    return false;
  }
}

/**
 * Check environment variables from .env file
 * @returns {boolean} Whether all required environment variables are set
 */
function checkEnvironmentVariables() {
  logger.section('Checking Environment Variables');
  
  const envPath = path.join(process.cwd(), '.env');
  
  if (!fs.existsSync(envPath)) {
    logger.error('Cannot check environment variables: .env file not found');
    return false;
  }
  
  // Load .env file
  dotenv.config();
  
  let allEnvVarsSet = true;
  let missingEnvVars = [];
  
  for (const envVar of CONFIG.requiredEnvVars) {
    if (process.env[envVar]) {
      // Mask private key for security
      const value = envVar.includes('PRIVATE_KEY') 
        ? '****' 
        : process.env[envVar];
      logger.success(`Environment variable set: ${envVar}=${value}`);
    } else {
      logger.error(`Missing environment variable: ${envVar}`);
      allEnvVarsSet = false;
      missingEnvVars.push(envVar);
    }
  }
  
  if (missingEnvVars.length > 0) {
    addIssue(`Missing environment variables: ${missingEnvVars.join(', ')}`, 
             `nano .env # Add the following: ${missingEnvVars.map(v => v + '=your_value').join(', ')}`);
  }
  
  return allEnvVarsSet;
}

/**
 * Check network connectivity to required APIs
 * @returns {Promise<boolean>} Whether all APIs are reachable
 */
async function checkNetworkConnectivity() {
  logger.section('Checking Network Connectivity');
  
  const endpoints = [
    { name: 'Solana RPC', url: process.env.SOLANA_RPC_URL_PROD || 'https://api.mainnet-beta.solana.com' },
    { name: 'Jupiter API', url: (process.env.JUPITER_API_BASE || 'https://quote-api.jup.ag/v6') + '/health' },
    { name: 'DEXScreener API', url: (process.env.DEXSCREENER_API_URL || 'https://api.dexscreener.com/latest/dex') + '/pairs/solana/1' }
  ];
  
  let allEndpointsReachable = true;
  
  for (const endpoint of endpoints) {
    try {
      const timeout = 5000; // 5 second timeout
      
      logger.info(`Testing connectivity to ${endpoint.name}: ${endpoint.url}`);
      
      await axios.get(endpoint.url, { timeout });
      logger.success(`Successfully connected to ${endpoint.name}`);
    } catch (error) {
      logger.error(`Failed to connect to ${endpoint.name}: ${error.message}`);
      allEndpointsReachable = false;
      
      addIssue(`Cannot connect to ${endpoint.name}`, 
               `Check your internet connection and the endpoint URL in .env`);
    }
  }
  
  return allEndpointsReachable;
}

/**
 * Check if a wallet can be loaded successfully
 * @returns {boolean} Whether wallet can be loaded
 */
function checkWalletAccess() {
  logger.section('Checking Wallet Access');
  
  if (!process.env.SOLANA_PRIVATE_KEY_PROD) {
    logger.error('Cannot check wallet: SOLANA_PRIVATE_KEY_PROD not set');
    return false;
  }
  
  try {
    // Create a keypair from the private key in base64 format
    const privateKeyBytes = Buffer.from(process.env.SOLANA_PRIVATE_KEY_PROD, 'base64');
    const wallet = Keypair.fromSecretKey(privateKeyBytes);
    
    logger.success(`Successfully loaded wallet: ${wallet.publicKey.toString()}`);
    return true;
  } catch (error) {
    logger.error(`Failed to load wallet: ${error.message}`);
    
    addIssue('Invalid wallet private key format', 
             'Check SOLANA_PRIVATE_KEY_PROD in .env - it should be in base64 format');
    return false;
  }
}

/**
 * Check disk space requirements
 * @returns {boolean} Whether system has enough disk space
 */
function checkDiskSpace() {
  logger.section('Checking Disk Space');
  
  try {
    // Get disk usage in a platform-independent way
    const df = execSync('df -h .', { stdio: 'pipe' }).toString();
    const lines = df.split('\n');
    
    if (lines.length >= 2) {
      logger.info(`Disk space info: ${lines[1]}`);
      
      // Extract available space percentage (rough parsing)
      const match = lines[1].match(/(\d+)%/);
      if (match && match[1]) {
        const usedPercentage = parseInt(match[1], 10);
        
        if (usedPercentage > 90) {
          logger.error(`Disk space critically low: ${usedPercentage}% used`);
          addIssue('Low disk space', 'Free up disk space before continuing');
          return false;
        } else if (usedPercentage > 80) {
          logger.warning(`Disk space running low: ${usedPercentage}% used`);
        } else {
          logger.success(`Sufficient disk space available: ${100 - usedPercentage}% free`);
        }
      }
    }
    
    return true;
  } catch (error) {
    logger.warning(`Could not check disk space: ${error.message}`);
    return true; // Continue anyway
  }
}

/**
 * Display summary of all issues and commands to fix them
 */
function displaySummary() {
  logger.section('Setup Test Summary');
  
  if (issues.length === 0) {
    console.log(chalk.green.bold('✓ All checks passed! Your environment is ready for development.'));
    console.log(chalk.green('You can start the project with:'));
    console.log(chalk.cyan('  npm start'));
    console.log(chalk.green('Or run in development mode with:'));
    console.log(chalk.cyan('  DEBUG=true DRY_RUN=true npm start'));
  } else {
    console.log(chalk.yellow.bold(`⚠ Found ${issues.length} issue${issues.length > 1 ? 's' : ''} to fix:`));
    console.log('');
    
    issues.forEach((issue, index) => {
      console.log(chalk.yellow(`${index + 1}. ${issue.description}`));
      console.log(chalk.cyan(`   Run: ${issue.fixCommand}`));
      console.log('');
    });
    
    console.log(chalk.yellow.bold('Please fix these issues before continuing development.'));
    console.log(chalk.yellow('Once all issues are fixed, run this script again to verify.'));
  }
}

/**
 * Try to catch common dependency issues and provide more specific guidance
 */
function checkCommonIssues() {
  logger.section('Checking for Common Issues');
  
  // Check for native module build tools
  try {
    execSync('node-gyp --version', { stdio: 'pipe' });
    logger.success('node-gyp is installed (required for native modules)');
  } catch (error) {
    logger.warning('node-gyp may not be installed. This could cause native module build failures');
    addIssue('Missing node-gyp (needed for some native modules)', 
             'npm install -g node-gyp');
  }
  
  // Check git configuration
  try {
    const gitUser = execSync('git config user.name', { stdio: 'pipe' }).toString().trim();
    const gitEmail = execSync('git config user.email', { stdio: 'pipe' }).toString().trim();
    
    if (gitUser && gitEmail) {
      logger.success('Git user configuration is set up');
    } else {
      logger.warning('Git user configuration is incomplete');
      addIssue('Incomplete git configuration', 
               'git config --global user.name "Your Name" && git config --global user.email "your.email@example.com"');
    }
  } catch (error) {
    // Git commands might fail if git is not installed, which is not critical
    logger.warning('Could not verify Git configuration');
  }
}

/**
 * Main function to run all checks
 */
async function main() {
  console.log(chalk.cyan.bold('=== KryptoBot Environment Setup Test ==='));
  console.log(chalk.cyan(`Running tests at: ${new Date().toLocaleString()}`));
  console.log(chalk.cyan(`Working directory: ${process.cwd()}\n`));
  
  // Run all checks
  const filesOk = checkRequiredFiles();
  const dirsOk = checkRequiredDirectories();
  const nodeOk = checkNodeVersion();
  const depsOk = checkDependencies();
  const dockerOk = checkDocker();
  const envVarsOk = checkEnvironmentVariables();
  const diskOk = checkDiskSpace();
  checkCommonIssues(); // Additional common issues check
  
  // These checks may depend on environment variables being set
  let walletOk = false;
  let networkOk = false;
  if (envVarsOk) {
    walletOk = checkWalletAccess();
    networkOk = await checkNetworkConnectivity();
  } else {
    logger.warning('Skipping wallet and network checks due to missing environment variables');
  }
  
  // Display summary and fix commands
  displaySummary();
  
  // Return exit code based on whether all checks passed
  process.exit(issues.length > 0 ? 1 : 0);
}

// Run the main function
main().catch(error => {
  logger.error(`Unexpected error during setup test: ${error.message}`);
  console.error(error);
  process.exit(1);
});