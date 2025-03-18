/**
 * performance-analyzer.js
 * Advanced analysis of trading bot performance across multiple instances
 */

import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { createTable } from './token-analyzer-utils.js';
import { fileURLToPath } from 'url';

import readline from 'readline';
import { exec } from 'child_process';

// Configuration
const CONFIG = {
  PERFORMANCE_LOG: path.join(process.cwd(), 'logs', 'performance_analysis.json'),
  INSTANCES_DIR: path.join(process.cwd(), 'logs', 'instances'),
  OUTPUT_DIR: path.join(process.cwd(), 'logs', 'analysis'),
  DEBUG: process.env.DEBUG === 'true'
};


/**
 * Creates a live updating display for monitoring all instances in real-time
 * @param {boolean} keepRunning - Whether to keep the display running (true) or exit after one display (false)
 */
async function createLiveDisplay(keepRunning = true) {
    // Clear the console and prepare for display
    console.clear();
    
    if (keepRunning) {
      console.log(chalk.cyan.bold('=== LIVE PERFORMANCE MONITOR ==='));
      console.log(chalk.gray('Press Ctrl+C to exit'));
      console.log('');
    }
    
    try {
      // Gather the latest data
      const data = gatherInstanceData();
      const instanceCount = data.instances.length;
      
      // Display header information
      console.log(chalk.yellow(`Active Instances: ${instanceCount}  |  Total Tokens: ${Object.keys(data.tokens).length}  |  Updated: ${new Date().toLocaleTimeString()}`));
      console.log('─'.repeat(process.stdout.columns || 80));
      
      // Create instance status table
      const instanceTable = createTable([
        'Instance ID', 'Strategy', 'Runtime (h)', 'P/L (SOL)', 'ROI', 'Win Rate', 'Trades'
      ]);
      
      // Add rows for each instance
      for (const instance of data.instances.sort((a, b) => b.roi - a.roi)) {
        // Format data with colors
        const plText = instance.profitLoss > 0 
          ? chalk.green(`+${instance.profitLoss.toFixed(4)}`) 
          : chalk.red(`${instance.profitLoss.toFixed(4)}`);
        
        const roiText = instance.roi > 0 
          ? chalk.green(`+${instance.roi.toFixed(2)}%`) 
          : chalk.red(`${instance.roi.toFixed(2)}%`);
        
        const winRateText = instance.winRate >= 70 
          ? chalk.green(`${instance.winRate.toFixed(1)}%`)
          : instance.winRate >= 50 
            ? chalk.yellow(`${instance.winRate.toFixed(1)}%`) 
            : chalk.red(`${instance.winRate.toFixed(1)}%`);
        
        // Add to table
        instanceTable.push([
          instance.id.substring(0, 15), // Truncate long IDs
          instance.strategy,
          instance.runtime.toString(),
          plText,
          roiText,
          winRateText,
          instance.tradeCount.toString()
        ]);
      }
      
      // Display instance table
      if (data.instances.length > 0) {
        console.log(instanceTable.toString());
      } else {
        console.log(chalk.yellow('No active instances found.'));
      }
      
      // Display top performing tokens
      console.log(chalk.yellow('\nTop Performing Tokens:'));
      const tokenTable = createTable(['Token', 'Best Strategy', 'Instances', 'Best ROI', 'Avg ROI']);
      
      // Get top tokens sorted by best ROI
      const topTokens = Object.entries(data.tokens)
        .map(([address, token]) => ({
          address,
          name: token.name,
          bestROI: token.bestROI,
          avgROI: token.avgROI,
          instanceCount: token.instances.length,
          // Find best strategy for this token
          bestStrategy: Object.entries(token.strategies)
            .sort((a, b) => b[1].avgROI - a[1].avgROI)
            .map(([strategy]) => strategy)[0] || 'N/A'
        }))
        .sort((a, b) => b.bestROI - a.bestROI)
        .slice(0, 10); // Show top 10
      
      // Add tokens to table
      for (const token of topTokens) {
        const bestROIText = token.bestROI > 0 
          ? chalk.green(`+${token.bestROI.toFixed(2)}%`) 
          : chalk.red(`${token.bestROI.toFixed(2)}%`);
        
        const avgROIText = token.avgROI > 0 
          ? chalk.green(`+${token.avgROI.toFixed(2)}%`) 
          : chalk.red(`${token.avgROI.toFixed(2)}%`);
        
        tokenTable.push([
          token.name,
          token.bestStrategy,
          token.instanceCount.toString(),
          bestROIText,
          avgROIText
        ]);
      }
      
      if (topTokens.length > 0) {
        console.log(tokenTable.toString());
      } else {
        console.log(chalk.yellow('No token performance data available.'));
      }
      
      // Display strategy comparison
      console.log(chalk.yellow('\nStrategy Performance:'));
      
      // Calculate strategy performance
      const strategies = {};
      for (const instance of data.instances) {
        if (!instance.strategy) continue;
        
        if (!strategies[instance.strategy]) {
          strategies[instance.strategy] = {
            count: 0,
            totalROI: 0,
            totalPL: 0,
            instances: []
          };
        }
        
        const strat = strategies[instance.strategy];
        strat.count++;
        strat.totalROI += instance.roi;
        strat.totalPL += instance.profitLoss;
        strat.instances.push(instance);
      }
      
      // Create strategy table
      const stratTable = createTable(['Strategy', 'Count', 'Avg ROI', 'Total P/L']);
      
      for (const [stratName, stratData] of Object.entries(strategies)) {
        const avgROI = stratData.count > 0 ? stratData.totalROI / stratData.count : 0;
        
        const roiText = avgROI > 0 
          ? chalk.green(`+${avgROI.toFixed(2)}%`) 
          : chalk.red(`${avgROI.toFixed(2)}%`);
        
        const plText = stratData.totalPL > 0 
          ? chalk.green(`+${stratData.totalPL.toFixed(4)}`) 
          : chalk.red(`${stratData.totalPL.toFixed(4)}`);
        
        stratTable.push([
          stratName,
          stratData.count.toString(),
          roiText,
          plText
        ]);
      }
      
      if (Object.keys(strategies).length > 0) {
        console.log(stratTable.toString());
      } else {
        console.log(chalk.yellow('No strategy performance data available.'));
      }
      
      // If we're in live mode, schedule the next update
      if (keepRunning) {
        setTimeout(() => {
          createLiveDisplay(true);
        }, 10000); // Update every 10 seconds
      }
    } catch (error) {
      console.error(chalk.red(`Error in live display: ${error.message}`));
      if (CONFIG.DEBUG) {
        console.error(error.stack);
      }
      
      // If we're in live mode, try to recover
      if (keepRunning) {
        setTimeout(() => {
          createLiveDisplay(true);
        }, 10000);
      }
    }
  }


/**
 * Reads and aggregates all instance data for comprehensive analysis
 * @returns {Object} Aggregated data from all instances
 */
function gatherInstanceData() {
  // Read main performance log
  if (!fs.existsSync(CONFIG.PERFORMANCE_LOG)) {
    console.error(chalk.red(`Performance log not found: ${CONFIG.PERFORMANCE_LOG}`));
    return { instances: [], tokens: {}, transactions: [] };
  }
  
  const performanceData = JSON.parse(fs.readFileSync(CONFIG.PERFORMANCE_LOG, 'utf8'));
  
  // Get list of instances
  const instanceDirs = fs.readdirSync(CONFIG.INSTANCES_DIR)
    .filter(dir => {
      const fullPath = path.join(CONFIG.INSTANCES_DIR, dir);
      return fs.statSync(fullPath).isDirectory();
    });
  
  // Aggregate token data across all instances
  const tokenData = {};
  const allTransactions = [];
  
  for (const dir of instanceDirs) {
    const instanceDir = path.join(CONFIG.INSTANCES_DIR, dir);
    
    try {
      // Read instance info
      const infoPath = path.join(instanceDir, 'instance_info.json');
      if (!fs.existsSync(infoPath)) continue;
      
      const instanceInfo = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
      
      // Read profit report
      const reportPath = path.join(instanceDir, 'profit_report.json');
      if (!fs.existsSync(reportPath)) continue;
      
      const profitReport = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      
      // Read trade logs for transactions
      const logPath = path.join(instanceDir, 'trade_logs.json');
      if (fs.existsSync(logPath)) {
        const tradeLogs = JSON.parse(fs.readFileSync(logPath, 'utf8'));
        
        // Process tokens and their transactions
        for (const [address, token] of Object.entries(tradeLogs.tokens || {})) {
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
          
          // Count transactions and extract performance data
          if (token.transactions) {
            for (const tx of token.transactions) {
              const txType = String(tx.type).toLowerCase();
              
              // Track transaction counts
              if (txType === 'buy') {
                tokenInstance.buyCount++;
                tokenData[address].totalBuys++;
              } else if (txType === 'sell') {
                tokenInstance.sellCount++;
                tokenData[address].totalSells++;
              }
              
              // Add transaction with instance context
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
          
          // Find this token in the profit report
          const tokenReport = profitReport.tokens.find(t => t.address === address);
          if (tokenReport) {
            tokenInstance.profit = tokenReport.profitLoss;
            tokenInstance.roi = tokenReport.roi;
            
            // Update token aggregates
            tokenData[address].totalProfit += tokenReport.profitLoss;
            tokenData[address].bestROI = Math.max(tokenData[address].bestROI, tokenReport.roi);
            tokenData[address].worstROI = Math.min(tokenData[address].worstROI, tokenReport.roi);
            
            // Track performance by strategy
            if (!tokenData[address].strategies[instanceInfo.strategy]) {
              tokenData[address].strategies[instanceInfo.strategy] = {
                instanceCount: 0,
                totalProfit: 0,
                avgROI: 0
              };
            }
            
            const strategyData = tokenData[address].strategies[instanceInfo.strategy];
            strategyData.instanceCount++;
            strategyData.totalProfit += tokenReport.profitLoss;
            // We'll calculate averages later
          }
          
          // Add instance data to token
          tokenData[address].instances.push(tokenInstance);
        }
      }
    } catch (error) {
      console.error(chalk.red(`Error processing instance ${dir}: ${error.message}`));
      if (CONFIG.DEBUG) {
        console.error(error.stack);
      }
    }
  }
  
  // Calculate averages and finalize token data
  for (const token of Object.values(tokenData)) {
    // Calculate average ROI across instances
    if (token.instances.length > 0) {
      token.avgROI = token.instances.reduce((sum, inst) => sum + inst.roi, 0) / token.instances.length;
    }
    
    // Calculate average ROI per strategy
    for (const [strategy, data] of Object.entries(token.strategies)) {
      if (data.instanceCount > 0) {
        const strategyInstances = token.instances.filter(i => i.strategy === strategy);
        data.avgROI = strategyInstances.reduce((sum, inst) => sum + inst.roi, 0) / data.instanceCount;
      }
    }
    
    // Fix values if they weren't updated
    if (token.bestROI === -Infinity) token.bestROI = 0;
    if (token.worstROI === Infinity) token.worstROI = 0;
  }
  
  return {
    instances: performanceData.allInstances || [],
    tokens: tokenData,
    transactions: allTransactions
  };
}

/**
 * Identifies the most successful strategies for each token
 * @param {Object} data - Aggregated instance data
 * @returns {Object} Strategy effectiveness analysis
 */
function analyzeStrategyEffectiveness(data) {
  const tokenStrategies = {};
  const globalStrategyPerformance = {};
  
  // Analyze per token
  for (const [address, token] of Object.entries(data.tokens)) {
    // Skip tokens with too few instances
    if (token.instances.length < 2) continue;
    
    // Find best strategy for this token
    let bestStrategy = null;
    let bestROI = -Infinity;
    
    for (const [strategy, stratData] of Object.entries(token.strategies)) {
      if (stratData.avgROI > bestROI) {
        bestROI = stratData.avgROI;
        bestStrategy = strategy;
      }
      
      // Update global strategy performance
      if (!globalStrategyPerformance[strategy]) {
        globalStrategyPerformance[strategy] = {
          tokenCount: 0,
          totalProfit: 0,
          avgROI: 0,
          bestTokens: []
        };
      }
      
      globalStrategyPerformance[strategy].tokenCount++;
      globalStrategyPerformance[strategy].totalProfit += stratData.totalProfit;
    }
    
    // Record best strategy for this token
    tokenStrategies[address] = {
      token: token.name,
      bestStrategy,
      bestROI,
      strategies: token.strategies
    };
  }
  
  // Calculate overall strategy effectiveness
  for (const strategy of Object.keys(globalStrategyPerformance)) {
    const strategyData = globalStrategyPerformance[strategy];
    
    // Find best tokens for this strategy
    const tokensWithStrategy = Object.entries(tokenStrategies)
      .filter(([_, data]) => data.strategies[strategy])
      .map(([address, data]) => ({
        address,
        token: data.token,
        roi: data.strategies[strategy].avgROI
      }))
      .sort((a, b) => b.roi - a.roi);
    
    strategyData.bestTokens = tokensWithStrategy.slice(0, 3);
    
    // Calculate average ROI across tokens
    if (tokensWithStrategy.length > 0) {
      strategyData.avgROI = tokensWithStrategy.reduce((sum, t) => sum + t.roi, 0) / tokensWithStrategy.length;
    }
  }
  
  return {
    tokenStrategies,
    globalStrategyPerformance
  };
}

/**
 * Analyzes parameter sensitivity to identify optimal parameter values
 * @param {Object} data - Aggregated instance data
 * @returns {Object} Parameter sensitivity analysis
 */
function analyzeParameterSensitivity(data) {
  // Extract unique parameter names from all instances
  const allParams = new Set();
  data.instances.forEach(instance => {
    Object.keys(instance.params).forEach(param => allParams.add(param));
  });
  
  const parameterAnalysis = {};
  
  for (const param of allParams) {
    // Group instances by parameter value
    const valuePerformance = {};
    
    for (const instance of data.instances) {
      const value = instance.params[param];
      if (!value) continue;
      
      if (!valuePerformance[value]) {
        valuePerformance[value] = {
          count: 0,
          totalROI: 0,
          avgROI: 0,
          totalProfit: 0,
          bestInstanceId: null,
          bestROI: -Infinity
        };
      }
      
      const perf = valuePerformance[value];
      perf.count++;
      perf.totalROI += instance.roi;
      perf.totalProfit += instance.profitLoss;
      
      if (instance.roi > perf.bestROI) {
        perf.bestROI = instance.roi;
        perf.bestInstanceId = instance.id;
      }
    }
    
    // Calculate averages
    for (const value of Object.keys(valuePerformance)) {
      const perf = valuePerformance[value];
      if (perf.count > 0) {
        perf.avgROI = perf.totalROI / perf.count;
      }
    }
    
    // Sort values by performance
    const sortedValues = Object.entries(valuePerformance)
      .sort((a, b) => b[1].avgROI - a[1].avgROI)
      .map(([value, perf]) => ({ value, ...perf }));
    
    parameterAnalysis[param] = {
      values: valuePerformance,
      bestValue: sortedValues.length > 0 ? sortedValues[0].value : null,
      bestValueROI: sortedValues.length > 0 ? sortedValues[0].avgROI : 0,
      sortedValues
    };
  }
  
  return parameterAnalysis;
}

/**
 * Generates optimal configuration recommendations based on analysis
 * @param {Object} strategyAnalysis - Strategy effectiveness analysis
 * @param {Object} parameterAnalysis - Parameter sensitivity analysis
 * @returns {Object} Configuration recommendations
 */
function generateRecommendations(strategyAnalysis, parameterAnalysis) {
  // Find overall best strategy
  let bestStrategy = null;
  let bestStrategyROI = -Infinity;
  
  for (const [strategy, data] of Object.entries(strategyAnalysis.globalStrategyPerformance)) {
    if (data.avgROI > bestStrategyROI) {
      bestStrategyROI = data.avgROI;
      bestStrategy = strategy;
    }
  }
  
  // Generate optimized parameter set
  const optimizedParams = {};
  
  for (const [param, analysis] of Object.entries(parameterAnalysis)) {
    if (analysis.bestValue) {
      optimizedParams[param] = analysis.bestValue;
    }
  }
  
  return {
    recommendedStrategy: bestStrategy,
    expectedROI: bestStrategyROI,
    optimizedParameters: optimizedParams,
    hybridConfiguration: {
      id: 'ai_optimized',
      description: 'AI-optimized parameters based on performance analysis',
      params: optimizedParams
    },
    tokenSpecificStrategies: Object.entries(strategyAnalysis.tokenStrategies)
      .filter(([_, data]) => data.bestStrategy)
      .map(([address, data]) => ({
        token: data.token,
        address,
        recommendedStrategy: data.bestStrategy,
        expectedROI: data.bestROI
      }))
      .sort((a, b) => b.expectedROI - a.expectedROI)
      .slice(0, 10) // Top 10 tokens
  };
}

/**
 * Displays analysis results in a readable format
 * @param {Object} analysis - Complete analysis results
 */
function displayAnalysisResults(analysis) {
    console.log(chalk.cyan.bold('=== TRADING BOT PERFORMANCE ANALYSIS ==='));
    
    // Make sure analysis has all required properties before accessing them
    if (!analysis || !analysis.strategyAnalysis || !analysis.strategyAnalysis.globalStrategyPerformance) {
      console.log(chalk.yellow('No strategy analysis data available.'));
    } else {
      // Display strategy performance
      const strategyTable = createTable(['Strategy', 'Token Count', 'Avg ROI', 'Total Profit', 'Best Token']);
      
      for (const [strategy, data] of Object.entries(analysis.strategyAnalysis.globalStrategyPerformance)) {
        const bestToken = data.bestTokens && data.bestTokens.length > 0 ? data.bestTokens[0].token : 'N/A';
        const avgROI = data.avgROI > 0 
          ? chalk.green(`+${data.avgROI.toFixed(2)}%`) 
          : chalk.red(`${data.avgROI.toFixed(2)}%`);
        const profit = data.totalProfit > 0
          ? chalk.green(`+${data.totalProfit.toFixed(4)} SOL`)
          : chalk.red(`${data.totalProfit.toFixed(4)} SOL`);
        
        strategyTable.push([
          strategy,
          data.tokenCount.toString(),
          avgROI,
          profit,
          bestToken
        ]);
      }
      
      console.log(chalk.cyan('\nStrategy Performance:'));
      console.log(strategyTable.toString());
    }
    
    // Display parameter sensitivity
    console.log(chalk.cyan('\nParameter Sensitivity:'));
    
    if (!analysis || !analysis.parameterAnalysis) {
      console.log(chalk.yellow('No parameter sensitivity data available.'));
    } else {
      for (const [param, paramAnalysis] of Object.entries(analysis.parameterAnalysis)) {
        console.log(chalk.yellow(`\n${param}:`));
        
        if (!paramAnalysis.sortedValues || paramAnalysis.sortedValues.length === 0) {
          console.log('  No data available');
          continue;
        }
        
        const paramTable = createTable(['Value', 'Instance Count', 'Avg ROI', 'Best ROI']);
        
        for (const valueData of paramAnalysis.sortedValues) {
          const avgROI = valueData.avgROI > 0 
            ? chalk.green(`+${valueData.avgROI.toFixed(2)}%`) 
            : chalk.red(`${valueData.avgROI.toFixed(2)}%`);
          const bestROI = valueData.bestROI > 0 
            ? chalk.green(`+${valueData.bestROI.toFixed(2)}%`) 
            : chalk.red(`${valueData.bestROI.toFixed(2)}%`);
          
          paramTable.push([
            valueData.value,
            valueData.count.toString(),
            avgROI,
            bestROI
          ]);
        }
        
        console.log(paramTable.toString());
      }
    }
    
    // Display recommendations
    if (!analysis || !analysis.recommendations) {
      console.log(chalk.yellow('\nNo recommendations available.'));
    } else {
      console.log(chalk.cyan.bold('\nRECOMMENDATIONS:'));
      console.log(chalk.yellow(`Best overall strategy: ${analysis.recommendations.recommendedStrategy || 'N/A'}`));
      console.log(chalk.yellow(`Expected ROI: ${analysis.recommendations.expectedROI > 0 ? '+' : ''}${(analysis.recommendations.expectedROI || 0).toFixed(2)}%`));
      
      if (analysis.recommendations.optimizedParameters && Object.keys(analysis.recommendations.optimizedParameters).length > 0) {
        console.log(chalk.yellow('\nOptimized Parameters:'));
        for (const [param, value] of Object.entries(analysis.recommendations.optimizedParameters)) {
          console.log(`  ${param}: ${value}`);
        }
      } else {
        console.log(chalk.yellow('\nNo optimized parameters available.'));
      }
      
      // Display token-specific recommendations
      if (analysis.recommendations.tokenSpecificStrategies && analysis.recommendations.tokenSpecificStrategies.length > 0) {
        console.log(chalk.yellow('\nToken-Specific Strategy Recommendations:'));
        
        const tokenTable = createTable(['Token', 'Recommended Strategy', 'Expected ROI']);
        
        for (const tokenStrat of analysis.recommendations.tokenSpecificStrategies) {
          const roi = tokenStrat.expectedROI > 0 
            ? chalk.green(`+${tokenStrat.expectedROI.toFixed(2)}%`) 
            : chalk.red(`${tokenStrat.expectedROI.toFixed(2)}%`);
          
          tokenTable.push([
            tokenStrat.token,
            tokenStrat.recommendedStrategy,
            roi
          ]);
        }
        
        console.log(tokenTable.toString());
      } else {
        console.log(chalk.yellow('\nNo token-specific recommendations available.'));
      }
    }
  }

/**
 * Main function to perform comprehensive performance analysis
 */
async function analyzeAll() {
  console.log(chalk.blue('Starting comprehensive performance analysis...'));
  
  // Ensure output directory exists
  if (!fs.existsSync(CONFIG.OUTPUT_DIR)) {
    fs.mkdirSync(CONFIG.OUTPUT_DIR, { recursive: true });
  }
  
  // Gather data from all instances
  const data = gatherInstanceData();
  
  // Analyze strategy effectiveness
  const strategyAnalysis = analyzeStrategyEffectiveness(data);
  
  // Analyze parameter sensitivity
  const parameterAnalysis = analyzeParameterSensitivity(data);
  
  // Generate recommendations
  const recommendations = generateRecommendations(strategyAnalysis, parameterAnalysis);
  
  // Compile complete analysis
  const analysis = {
    timestamp: new Date().toISOString(),
    summary: {
      instanceCount: data.instances.length,
      tokenCount: Object.keys(data.tokens).length,
      transactionCount: data.transactions.length
    },
    strategyAnalysis,
    parameterAnalysis,
    recommendations
  };
  
  // Save analysis results
  const outputPath = path.join(CONFIG.OUTPUT_DIR, `analysis_${Date.now()}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(analysis, null, 2));
  
  // Display results
  displayAnalysisResults(analysis);
  
  console.log(chalk.green(`\nAnalysis complete. Results saved to ${outputPath}`));
  return analysis;
}

// Modify the main function to handle the 'live' command
async function main() {
    const args = process.argv.slice(2);
    const mode = args[0] || 'analyze';
    
    if (mode === 'live' || mode === 'monitor') {
      // Run in live monitoring mode
      createLiveDisplay(true);
    } else {
      // Run regular analysis
      await analyzeAll();
    }
  }
  
// Run analysis if this script is run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  analyzeAll().catch(err => {
    console.error(chalk.red('Error in performance analyzer:'), err);
  });
}

export { analyzeAll, gatherInstanceData, analyzeStrategyEffectiveness, analyzeParameterSensitivity };