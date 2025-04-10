/**
 * Docker-based Instance Manager for KryptoBot
 * Manages multiple trading instances with health checks and automatic recovery
 * 
 * @module instance-manager
 * @requires fs
 * @requires child_process
 */

import fs from 'fs';
import { exec } from 'child_process';
import path from 'path';
import chalk from 'chalk';

// Configuration with defaults from environment variables
const MAX_INSTANCES = parseInt(process.env.MAX_CONCURRENT_INSTANCES || '5', 10);
const LOG_DIR = process.env.BASE_LOG_DIR || '/app/logs/instances';
const DEBUG = process.env.DEBUG_MODE === 'true';
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL || '15000', 10);
const INSTANCE_PREFIX = 'memecoin-instance-';

// Track instance status
const instanceStatus = new Map();

/**
 * Log with timestamp and color formatting
 * @param {string} msg - Message to log
 * @param {string} level - Log level (info, success, warn, error)
 */
function log(msg, level = 'info') {
  const timestamp = new Date().toISOString();
  const prefix = '[InstanceManager]';
  
  switch(level) {
    case 'success':
      console.log(chalk.green(`[${timestamp}] ${prefix} ${msg}`));
      break;
    case 'warn':
      console.log(chalk.yellow(`[${timestamp}] ${prefix} ${msg}`));
      break;
    case 'error':
      console.log(chalk.red(`[${timestamp}] ${prefix} ${msg}`));
      break;
    default:
      console.log(chalk.blue(`[${timestamp}] ${prefix} ${msg}`));
  }
}

/**
 * Execute shell command with Promise interface and error handling
 * @param {string} command - Shell command to execute
 * @returns {Promise<string>} Command output
 */
function execCommand(command) {
  return new Promise((resolve, reject) => {
    if (DEBUG) log(`Executing: ${command}`);
    
    exec(command, (error, stdout, stderr) => {
      if (error) {
        // Handle permission errors gracefully
        if (error.message.includes('permission denied') && error.message.includes('docker.sock')) {
          log('Docker socket permission denied. Falling back to mock mode.', 'warn');
          resolve(''); // Return empty string instead of failing
        } else {
          log(`Command error: ${error.message}`, 'error');
          reject(error);
        }
        return;
      }
      
      if (stderr) {
        log(`Command stderr: ${stderr}`, 'warn');
      }
      
      resolve(stdout.trim());
    });
  });
}

/**
 * List running instances using Docker command
 * @returns {Promise<string[]>} Array of instance names
 */
async function listRunningInstances() {
  try {
    const output = await execCommand('docker ps --format "{{.Names}}"');
    if (!output) return []; // Handle empty output from mock mode
    
    // Filter only our prefixed instances
    return output.split('\n').filter(name => name.startsWith(INSTANCE_PREFIX));
  } catch (error) {
    log(`Error listing instances: ${error.message}`, 'error');
    return []; // Return empty array on failure
  }
}

/**
 * Start a new instance with optimized configuration
 * @param {number} index - Instance index for unique naming
 * @returns {Promise<boolean>} Success status
 */
async function startInstance(index) {
  const timestamp = Date.now();
  const instanceName = `${INSTANCE_PREFIX}${timestamp}-${index}`;
  
  try {
    const logPath = path.join(LOG_DIR, instanceName);
    
    // Ensure log directory exists
    if (!fs.existsSync(logPath)) {
      fs.mkdirSync(logPath, { recursive: true });
    }
    
    // Start with Docker command
    await execCommand(`docker run -d --name ${instanceName} \
      -v ${logPath}:/app/logs \
      -e INSTANCE_ID=${instanceName} \
      --restart=unless-stopped \
      memecoin-trading-core`);
    
    log(`🚀 Started new instance: ${instanceName}`, 'success');
    
    // Track instance in memory
    instanceStatus.set(instanceName, {
      startTime: new Date(),
      healthChecks: 0,
      healthy: true
    });
    
    return true;
  } catch (error) {
    log(`Failed to start instance ${instanceName}: ${error.message}`, 'error');
    return false;
  }
}

/**
 * Stop an instance safely
 * @param {string} instanceName - Name of instance to stop
 * @returns {Promise<boolean>} Success status
 */
async function stopInstance(instanceName) {
  try {
    await execCommand(`docker stop ${instanceName}`);
    log(`🛑 Stopped instance: ${instanceName}`, 'warn');
    
    // Remove from tracking
    instanceStatus.delete(instanceName);
    
    return true;
  } catch (error) {
    log(`Failed to stop instance ${instanceName}: ${error.message}`, 'error');
    return false;
  }
}

/**
 * Check health of a specific instance
 * @param {string} instanceName - Instance to check
 * @returns {Promise<boolean>} Health status
 */
async function checkInstanceHealth(instanceName) {
  try {
    // Get container status
    const status = await execCommand(`docker inspect --format='{{.State.Status}}' ${instanceName}`);
    
    if (status !== 'running') {
      log(`Instance ${instanceName} status: ${status}`, 'warn');
      return false;
    }
    
    // Update instance status
    if (instanceStatus.has(instanceName)) {
      const instance = instanceStatus.get(instanceName);
      instance.healthChecks++;
      instance.lastCheck = new Date();
      instance.healthy = true;
    }
    
    return true;
  } catch (error) {
    log(`Health check failed for ${instanceName}: ${error.message}`, 'error');
    return false;
  }
}

/**
 * Manage instances - ensure correct number are running
 */
async function manageInstances() {
  try {
    // List current instances
    const running = await listRunningInstances();
    
    if (DEBUG) log(`Active instances: ${running.length}/${MAX_INSTANCES}`);
    
    // 1. Check health of running instances
    for (const instance of running) {
      const healthy = await checkInstanceHealth(instance);
      
      if (!healthy) {
        log(`Unhealthy instance detected: ${instance}`, 'warn');
        // Stop and remove unhealthy instance
        await stopInstance(instance);
        // Remove from running list for accurate count
        const idx = running.indexOf(instance);
        if (idx !== -1) running.splice(idx, 1);
      }
    }
    
    // 2. Stop excess instances if needed
    if (running.length > MAX_INSTANCES) {
      const toStop = running.slice(MAX_INSTANCES);
      log(`Stopping ${toStop.length} excess instances`, 'warn');
      
      for (const instance of toStop) {
        await stopInstance(instance);
      }
    }
    
    // 3. Start new instances if needed
    if (running.length < MAX_INSTANCES) {
      const toStart = MAX_INSTANCES - running.length;
      log(`Starting ${toStart} new instances`);
      
      for (let i = 0; i < toStart; i++) {
        await startInstance(i);
      }
    }
    
    // 4. Log overall status
    const totalRunning = await listRunningInstances();
    log(`Current status: ${totalRunning.length}/${MAX_INSTANCES} instances running`);
  } catch (error) {
    log(`Error managing instances: ${error.message}`, 'error');
  }
}

/**
 * Main function to start the instance manager
 */
function startManager() {
  log(`Instance Manager started. MAX_INSTANCES = ${MAX_INSTANCES}`);
  
  // Create log directory if it doesn't exist
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    log(`Created log directory: ${LOG_DIR}`);
  }
  
  // Initial instance management
  manageInstances();
  
  // Set up periodic check
  setInterval(manageInstances, CHECK_INTERVAL);
}

// Start the manager
startManager();