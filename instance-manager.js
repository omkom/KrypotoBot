/**
 * instance-manager.js
 * Manages multiple trading bot instances with different parameters and tracks performance
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import chalk from 'chalk';
import { fileURLToPath } from 'url';

// Configuration for instance management
const INSTANCE_CONFIG = {
  BASE_LOG_DIR: path.join(process.cwd(), 'logs', 'instances'),
  PERFORMANCE_LOG: path.join(process.cwd(), 'logs', 'performance_analysis.json'),
  MAX_CONCURRENT_INSTANCES: 5,
  PERFORMANCE_CHECK_INTERVAL: 60 * 60 * 1000, // 1 hour
};

// Predefined parameter configurations for testing
const parameterSets = [
    {
        id: 'aggressive',
        description: 'High risk, high reward strategy',
        params: {
          SLIPPAGE: '3',
          MAX_SOL_PER_TRADE: '0.2',
          RISK_PERCENTAGE: '0.05',
          MIN_LIQUIDITY_USD: '5000',
          TAKE_PROFIT: '40',
          STOP_LOSS: '-30'
        }
      },
      {
        id: 'conservative',
        description: 'Low risk, steady gains strategy',
        params: {
          SLIPPAGE: '1.5',
          MAX_SOL_PER_TRADE: '0.05',
          RISK_PERCENTAGE: '0.02',
          MIN_LIQUIDITY_USD: '20000',
          TAKE_PROFIT: '15',
          STOP_LOSS: '-10'
        }
      },
      {
        id: 'balanced',
        description: 'Balanced risk-reward strategy',
        params: {
          SLIPPAGE: '2',
          MAX_SOL_PER_TRADE: '0.1',
          RISK_PERCENTAGE: '0.03',
          MIN_LIQUIDITY_USD: '10000',
          TAKE_PROFIT: '25',
          STOP_LOSS: '-20'
        }
      },
      // New strategies
      {
        id: 'scalping',
        description: 'High-frequency trading capturing small price movements with tight stops',
        params: {
          SLIPPAGE: '4',
          MAX_SOL_PER_TRADE: '0.05',
          RISK_PERCENTAGE: '0.01',
          MIN_LIQUIDITY_USD: '20000',
          TAKE_PROFIT: '10',
          STOP_LOSS: '-5'
        }
      },
      {
        id: 'momentum',
        description: 'Capitalizes on trending assets with higher risk and larger position sizes',
        params: {
          SLIPPAGE: '3',
          MAX_SOL_PER_TRADE: '0.15',
          RISK_PERCENTAGE: '0.04',
          MIN_LIQUIDITY_USD: '15000',
          TAKE_PROFIT: '30',
          STOP_LOSS: '-15'
        }
      },
      {
        id: 'mean-reversion',
        description: 'Exploits price corrections to historical averages',
        params: {
          SLIPPAGE: '1',
          MAX_SOL_PER_TRADE: '0.1',
          RISK_PERCENTAGE: '0.03',
          MIN_LIQUIDITY_USD: '25000',
          TAKE_PROFIT: '20',
          STOP_LOSS: '-25'
        }
      },
      {
        id: 'market-making',
        description: 'Provides liquidity and captures spread differentials',
        params: {
          SLIPPAGE: '0.5',
          MAX_SOL_PER_TRADE: '0.02',
          RISK_PERCENTAGE: '0.005',
          MIN_LIQUIDITY_USD: '30000',
          TAKE_PROFIT: '5',
          STOP_LOSS: '-3'
        }
      },
      {
        id: 'swing',
        description: 'Medium-term positions capturing multi-day price movements',
        params: {
          SLIPPAGE: '2',
          MAX_SOL_PER_TRADE: '0.2',
          RISK_PERCENTAGE: '0.05',
          MIN_LIQUIDITY_USD: '10000',
          TAKE_PROFIT: '50',
          STOP_LOSS: '-25'
        }
      },
      {
        id: 'breakout',
        description: 'Trades price突破关键 support/resistance levels',
        params: {
          SLIPPAGE: '3.5',
          MAX_SOL_PER_TRADE: '0.18',
          RISK_PERCENTAGE: '0.06',
          MIN_LIQUIDITY_USD: '12000',
          TAKE_PROFIT: '35',
          STOP_LOSS: '-20'
        }
      },
      {
        id: 'volatility',
        description: 'Optimized for high volatility market conditions',
        params: {
          SLIPPAGE: '5',
          MAX_SOL_PER_TRADE: '0.1',
          RISK_PERCENTAGE: '0.04',
          MIN_LIQUIDITY_USD: '15000',
          TAKE_PROFIT: '25',
          STOP_LOSS: '-20'
        }
      },
      {
        id: 'low-cap',
        description: 'Specialized for low market cap tokens with higher volatility',
        params: {
          SLIPPAGE: '6',
          MAX_SOL_PER_TRADE: '0.03',
          RISK_PERCENTAGE: '0.07',
          MIN_LIQUIDITY_USD: '3000',
          TAKE_PROFIT: '75',
          STOP_LOSS: '-40'
        }
      },
      {
        id: 'index-arbitrage',
        description: 'Exploits price discrepancies between index tokens',
        params: {
          SLIPPAGE: '2.5',
          MAX_SOL_PER_TRADE: '0.25',
          RISK_PERCENTAGE: '0.08',
          MIN_LIQUIDITY_USD: '50000',
          TAKE_PROFIT: '15',
          STOP_LOSS: '-8'
        }
      }
  // Add more parameter sets as needed
];

/**
 * Ensures required directories exist
 */
function initializeDirectories() {
  if (!fs.existsSync(INSTANCE_CONFIG.BASE_LOG_DIR)) {
    fs.mkdirSync(INSTANCE_CONFIG.BASE_LOG_DIR, { recursive: true });
  }
}

// 1. Enhanced gatherInstanceData function with better error handling and logging
function gatherInstanceData() {
    console.log(chalk.blue('Gathering data from all instances...'));
    
    // Check if performance log exists and initialize if needed
    if (!fs.existsSync(CONFIG.PERFORMANCE_LOG)) {
      console.log(chalk.yellow(`Performance log not found, creating: ${CONFIG.PERFORMANCE_LOG}`));
      
      // Ensure directory exists
      const logDir = path.dirname(CONFIG.PERFORMANCE_LOG);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      
      // Create empty performance log
      fs.writeFileSync(CONFIG.PERFORMANCE_LOG, JSON.stringify({
        lastUpdate: new Date().toISOString(),
        allInstances: [],
        analysisHistory: []
      }, null, 2));
    }
    
    // Load performance log data
    let performanceData = {};
    try {
      performanceData = JSON.parse(fs.readFileSync(CONFIG.PERFORMANCE_LOG, 'utf8'));
      if (!performanceData.allInstances) performanceData.allInstances = [];
    } catch (error) {
      console.error(chalk.red(`Error reading performance log: ${error.message}`));
      performanceData = { allInstances: [] };
    }
    
    // Check if instances directory exists
    if (!fs.existsSync(CONFIG.INSTANCES_DIR)) {
      console.error(chalk.red(`Instances directory not found: ${CONFIG.INSTANCES_DIR}`));
      fs.mkdirSync(CONFIG.INSTANCES_DIR, { recursive: true });
      return { instances: [], tokens: {}, transactions: [] };
    }
    
    // Get list of instances
    let instanceDirs;
    try {
      instanceDirs = fs.readdirSync(CONFIG.INSTANCES_DIR)
        .filter(dir => {
          try {
            const fullPath = path.join(CONFIG.INSTANCES_DIR, dir);
            return fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory();
          } catch (error) {
            console.error(chalk.red(`Error checking directory ${dir}: ${error.message}`));
            return false;
          }
        });
        
      console.log(chalk.blue(`Found ${instanceDirs.length} instance directories`));
    } catch (error) {
      console.error(chalk.red(`Error reading instances directory: ${error.message}`));
      return { instances: [], tokens: {}, transactions: [] };
    }
    
    // Initialize data structures
    const tokenData = {};
    const allTransactions = [];
    const activeInstances = [];
    
    // Process each instance directory
    let processedCount = 0;
    
    for (const dir of instanceDirs) {
      const instanceDir = path.join(CONFIG.INSTANCES_DIR, dir);
      
      try {
        console.log(chalk.blue(`Processing instance directory: ${dir}`));
        
        // Read instance info
        const infoPath = path.join(instanceDir, 'instance_info.json');
        if (!fs.existsSync(infoPath)) {
          console.log(chalk.yellow(`Instance info not found for ${dir}, skipping`));
          continue;
        }
        
        const instanceInfo = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
        console.log(chalk.blue(`Found instance info for ${instanceInfo.id}`));
        
        // Read profit report
        const reportPath = path.join(instanceDir, 'profit_report.json');
        let profitReport = null;
        
        if (fs.existsSync(reportPath)) {
          try {
            profitReport = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
            console.log(chalk.blue(`Found profit report for ${instanceInfo.id}`));
          } catch (reportError) {
            console.error(chalk.red(`Error parsing profit report for ${dir}: ${reportError.message}`));
          }
        } else {
          console.log(chalk.yellow(`Profit report not found for ${dir}`));
        }
        
        // Read trade logs for transactions
        const logPath = path.join(instanceDir, 'trade_logs.json');
        let tradeLogs = null;
        
        if (fs.existsSync(logPath)) {
          try {
            tradeLogs = JSON.parse(fs.readFileSync(logPath, 'utf8'));
            console.log(chalk.blue(`Found trade logs for ${instanceInfo.id}`));
          } catch (logError) {
            console.error(chalk.red(`Error parsing trade logs for ${dir}: ${logError.message}`));
          }
        } else {
          console.log(chalk.yellow(`Trade logs not found for ${dir}`));
        }
        
        // Skip if we couldn't get any useful data
        if (!profitReport && !tradeLogs) {
          console.log(chalk.yellow(`No valid data found for ${dir}, skipping`));
          continue;
        }
        
        // Calculate instance runtime
        const startTime = new Date(instanceInfo.startTime || Date.now());
        const runtimeHours = (Date.now() - startTime) / (1000 * 60 * 60);
        
        // Add this instance to active instances
        activeInstances.push({
          id: instanceInfo.id,
          strategy: instanceInfo.strategy,
          params: instanceInfo.params || {},
          startTime: instanceInfo.startTime,
          runtime: parseFloat(runtimeHours.toFixed(2)),
          profitLoss: profitReport?.summary?.totalProfitLoss || 0,
          roi: profitReport?.summary?.totalROI || 0,
          winRate: profitReport?.summary?.winRate || 0,
          tradeCount: (profitReport?.summary?.totalBuys || 0) + (profitReport?.summary?.totalSells || 0),
          tokenCount: profitReport?.tokens?.length || 0
        });
        
        // Process tokens from trade logs
        if (tradeLogs && tradeLogs.tokens) {
          for (const [address, token] of Object.entries(tradeLogs.tokens)) {
            // Initialize token data if not exists
            if (!tokenData[address]) {
              tokenData[address] = {
                address,
                name: token.tokenName || 'Unknown',
                instances: [],
                totalBuys: 0,
                totalSells: 0,
                totalProfit: 0,
                bestROI: -Infinity,
                worstROI: Infinity,
                avgROI: 0,
                strategies: {}
              };
            }
            
            // Update token data with this instance's performance
            const tokenInstance = {
              instanceId: instanceInfo.id,
              strategy: instanceInfo.strategy,
              buyCount: 0,
              sellCount: 0,
              profit: 0,
              roi: 0
            };
            
            // Process transactions
            if (token.transactions) {
              for (const tx of token.transactions) {
                const txType = String(tx.type || '').toLowerCase();
                
                // Count transactions
                if (txType === 'buy') {
                  tokenInstance.buyCount++;
                  tokenData[address].totalBuys++;
                } else if (txType === 'sell') {
                  tokenInstance.sellCount++;
                  tokenData[address].totalSells++;
                }
                
                // Add transaction to all transactions list with context
                allTransactions.push({
                  ...tx,
                  tokenAddress: address,
                  tokenName: token.tokenName,
                  instanceId: instanceInfo.id,
                  strategy: instanceInfo.strategy,
                  params: instanceInfo.params
                });
              }
            }
            
            // Add profit data from profit report if available
            if (profitReport && profitReport.tokens) {
              const tokenReport = profitReport.tokens.find(t => t.address === address);
              if (tokenReport) {
                tokenInstance.profit = tokenReport.profitLoss || 0;
                tokenInstance.roi = tokenReport.roi || 0;
                
                // Update token aggregates
                tokenData[address].totalProfit += tokenReport.profitLoss || 0;
                tokenData[address].bestROI = Math.max(
                  tokenData[address].bestROI, 
                  tokenReport.roi || -Infinity
                );
                tokenData[address].worstROI = Math.min(
                  tokenData[address].worstROI, 
                  tokenReport.roi || Infinity
                );
                
                // Track by strategy
                if (!tokenData[address].strategies[instanceInfo.strategy]) {
                  tokenData[address].strategies[instanceInfo.strategy] = {
                    instanceCount: 0,
                    totalProfit: 0,
                    avgROI: 0
                  };
                }
                
                const strategy = tokenData[address].strategies[instanceInfo.strategy];
                strategy.instanceCount++;
                strategy.totalProfit += tokenReport.profitLoss || 0;
              }
            }
            
            // Add this instance to token's instances
            tokenData[address].instances.push(tokenInstance);
          }
        }
        
        processedCount++;
      } catch (error) {
        console.error(chalk.red(`Error processing instance ${dir}: ${error.message}`));
        if (CONFIG.DEBUG) {
          console.error(chalk.yellow(error.stack));
        }
      }
    }
    
    // Calculate averages and finalize token data
    for (const token of Object.values(tokenData)) {
      // Calculate average ROI across instances
      if (token.instances.length > 0) {
        token.avgROI = token.instances.reduce((sum, inst) => sum + (inst.roi || 0), 0) / token.instances.length;
      }
      
      // Calculate average ROI per strategy
      for (const [strategy, data] of Object.entries(token.strategies)) {
        if (data.instanceCount > 0) {
          const strategyInstances = token.instances.filter(i => i.strategy === strategy);
          data.avgROI = strategyInstances.reduce((sum, inst) => sum + (inst.roi || 0), 0) / data.instanceCount;
        }
      }
      
      // Fix values if they weren't updated
      if (token.bestROI === -Infinity) token.bestROI = 0;
      if (token.worstROI === Infinity) token.worstROI = 0;
    }
    
    console.log(chalk.green(`Successfully processed ${processedCount} instances with ${Object.keys(tokenData).length} unique tokens`));
    
    // Update the performance data
    performanceData.allInstances = activeInstances;
    performanceData.lastUpdate = new Date().toISOString();
    
    // Save updated performance data
    try {
      fs.writeFileSync(CONFIG.PERFORMANCE_LOG, JSON.stringify(performanceData, null, 2));
      console.log(chalk.green(`Updated performance log at ${CONFIG.PERFORMANCE_LOG}`));
    } catch (error) {
      console.error(chalk.red(`Error writing performance log: ${error.message}`));
    }
    
    return {
      instances: activeInstances,
      tokens: tokenData,
      transactions: allTransactions
    };
  }
  
/**
 * Launches a trading bot instance with specific parameters
 * @param {Object} paramSet - Set of parameters for this instance
 * @returns {Object} Instance information
 */
function launchInstance(paramSet) {
    console.log(chalk.blue(`Launching instance with strategy: ${paramSet.id}`));
    
    // Create instance-specific log directory
    const instanceId = `${paramSet.id}_${Date.now()}`;
    const instanceLogDir = path.join(INSTANCE_CONFIG.BASE_LOG_DIR, instanceId);
    fs.mkdirSync(instanceLogDir, { recursive: true });
    
    // Create environment variables for this instance
    const env = {
      ...process.env,
      ...paramSet.params,
      INSTANCE_ID: instanceId,
      LOG_FILE_PATH: path.join(instanceLogDir, 'trade_logs.json'),
      PROFIT_REPORT_PATH: path.join(instanceLogDir, 'profit_report.json'),
      ERROR_LOG_PATH: path.join(instanceLogDir, 'error_log.txt'),
      API_LOG_FILE: path.join(instanceLogDir, 'api_calls.log')
    };
    
    // Find the correct main bot script file
    // Update this to match your actual bot script filename
    const botScriptFile = './src/index.js'; // Change this to the actual name of your main bot file
    
    // Check if the file exists before trying to spawn a process
    if (!fs.existsSync(botScriptFile)) {
      console.error(chalk.red(`Error: Bot script file ${botScriptFile} not found!`));
      console.log(chalk.yellow(`Please update the botScriptFile variable in instance-manager.js to the correct filename.`));
      return null;
    }
    
    // Spawn a new process for this instance
    const instance = spawn('node', [botScriptFile], { 
      env,
      detached: true,
      stdio: 'inherit' // For debugging; change to 'ignore' in production
    });
    
    
    // Log instance start
    const instanceInfo = {
      id: instanceId,
      strategy: paramSet.id,
      description: paramSet.description,
      params: paramSet.params,
      pid: instance.pid,
      startTime: new Date().toISOString(),
      logDir: instanceLogDir
    };
    
    // Write instance info to file
    fs.writeFileSync(
      path.join(instanceLogDir, 'instance_info.json'),
      JSON.stringify(instanceInfo, null, 2)
    );
    
    console.log(chalk.green(`Instance ${instanceId} launched with PID ${instance.pid}`));
    return instanceInfo;
  }

/**
 * Collects and analyzes performance data from all instances
 * @returns {Object} Performance analysis
 */
async function analyzePerformance() {
  console.log(chalk.blue('Analyzing performance across all instances...'));
  
  const instanceDirs = fs.readdirSync(INSTANCE_CONFIG.BASE_LOG_DIR);
  const instancesData = [];
  
  for (const dir of instanceDirs) {
    const instanceDir = path.join(INSTANCE_CONFIG.BASE_LOG_DIR, dir);
    if (!fs.statSync(instanceDir).isDirectory()) continue;
    
    try {
      // Read instance info
      const infoPath = path.join(instanceDir, 'instance_info.json');
      if (!fs.existsSync(infoPath)) continue;
      
      const instanceInfo = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
      
      // Read profit report
      const reportPath = path.join(instanceDir, 'profit_report.json');
      if (!fs.existsSync(reportPath)) continue;
      
      const profitReport = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      
      // Extract key performance metrics
      instancesData.push({
        id: instanceInfo.id,
        strategy: instanceInfo.strategy,
        params: instanceInfo.params,
        startTime: instanceInfo.startTime,
        runtime: calculateRuntime(instanceInfo.startTime),
        profitLoss: profitReport.summary.totalProfitLoss,
        roi: profitReport.summary.totalROI,
        winRate: profitReport.summary.winRate,
        tradeCount: profitReport.summary.totalBuys + profitReport.summary.totalSells,
        tokenCount: profitReport.summary.tokenCount
      });
    } catch (error) {
      console.error(chalk.red(`Error processing instance ${dir}: ${error.message}`));
    }
  }
  
  // Rank strategies by performance
  const rankedStrategies = rankStrategies(instancesData);
  
  // Generate comprehensive analysis
  const analysis = {
    timestamp: new Date().toISOString(),
    instanceCount: instancesData.length,
    topPerformers: rankedStrategies.slice(0, 3),
    worstPerformers: rankedStrategies.slice(-3).reverse(),
    allInstances: instancesData,
    parameterCorrelations: analyzeParameterCorrelations(instancesData)
  };
  
  // Write analysis to file
  fs.writeFileSync(
    INSTANCE_CONFIG.PERFORMANCE_LOG,
    JSON.stringify(analysis, null, 2)
  );
  
  console.log(chalk.green(`Performance analysis complete. Results saved to ${INSTANCE_CONFIG.PERFORMANCE_LOG}`));
  return analysis;
}

/**
 * Calculates runtime in hours from start time
 * @param {string} startTime - ISO datetime string
 * @returns {number} Runtime in hours
 */
function calculateRuntime(startTime) {
  const runtime = (new Date() - new Date(startTime)) / (1000 * 60 * 60);
  return parseFloat(runtime.toFixed(2));
}

/**
 * Ranks strategies by performance
 * @param {Array<Object>} instancesData - Performance data for all instances
 * @returns {Array<Object>} Ranked strategies
 */
function rankStrategies(instancesData) {
  // Simple ranking by ROI and profitLoss
  return [...instancesData].sort((a, b) => {
    // First sort by ROI
    if (a.roi !== b.roi) {
      return b.roi - a.roi;
    }
    // Then by absolute profit
    return b.profitLoss - a.profitLoss;
  });
}

/**
 * Analyzes parameter correlations with performance
 * @param {Array<Object>} instancesData - Performance data for all instances
 * @returns {Object} Parameter correlations
 */
function analyzeParameterCorrelations(instancesData) {
  // This is a simplified version - in a production system,
  // you would implement more sophisticated statistical analysis
  
  const correlations = {};
  
  // If we have enough data points, calculate basic correlations
  if (instancesData.length >= 3) {
    // Get all parameter names from first instance
    const paramNames = Object.keys(instancesData[0].params);
    
    for (const param of paramNames) {
      // For each parameter, group instances by parameter value
      const valueGroups = {};
      
      for (const instance of instancesData) {
        const value = instance.params[param];
        if (!valueGroups[value]) {
          valueGroups[value] = [];
        }
        valueGroups[value].push(instance);
      }
      
      // Calculate average ROI for each parameter value
      const valuePerformance = {};
      for (const [value, instances] of Object.entries(valueGroups)) {
        if (instances.length > 0) {
          const avgROI = instances.reduce((sum, inst) => sum + inst.roi, 0) / instances.length;
          valuePerformance[value] = avgROI;
        }
      }
      
      correlations[param] = valuePerformance;
    }
  }
  
  return correlations;
}

/**
 * Main function to run the instance manager
 */
async function main() {
  console.log(chalk.cyan('=== Trading Bot Instance Manager ==='));
  initializeDirectories();
  
  // Launch instances with different parameter sets
  const activeInstances = [];
  for (const paramSet of parameterSets) {
    if (activeInstances.length < INSTANCE_CONFIG.MAX_CONCURRENT_INSTANCES) {
      const instance = launchInstance(paramSet);
      activeInstances.push(instance);
    }
  }
  
  console.log(chalk.green(`Started ${activeInstances.length} instances`));
  
  // Set up periodic performance analysis
  setInterval(analyzePerformance, INSTANCE_CONFIG.PERFORMANCE_CHECK_INTERVAL);
  
  // Initial analysis after startup delay
  setTimeout(analyzePerformance, 5 * 60 * 1000);
}

// Start the manager if this script is run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error(chalk.red('Error in instance manager:'), err);
  });
}

export { launchInstance, analyzePerformance };