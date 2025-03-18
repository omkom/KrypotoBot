/**
 * token-analyzer-utils.js
 * 
 * Utility functions for token analysis across the KryptoBot application.
 * Provides reusable functions for data processing, table creation, and
 * statistical analysis used by multiple analyzer components.
 */

import fs from 'fs';
import path from 'path';
import chalk from 'chalk';

/**
 * Creates a formatted ASCII table for displaying data in the console
 * @param {Array<string>} headers - Column headers for the table
 * @param {Object} options - Table formatting options
 * @returns {Object} Table object with methods for adding rows and converting to string
 */
export function createTable(headers, options = {}) {
  // Default options
  const opts = {
    padding: options.padding || 2,
    headerStyle: options.headerStyle || 'bold',
    borderColor: options.borderColor || 'white',
    ...options
  };
  
  // Calculate initial column widths based on headers
  const colWidths = headers.map(h => h.length + (opts.padding * 2));
  
  // Store rows
  const rows = [];
  
  // Table object with methods
  const table = {
    /**
     * Adds a row to the table
     * @param {Array} rowData - Array of cell values
     */
    push: (rowData) => {
      // Update column widths if needed
      rowData.forEach((cell, i) => {
        const cellStr = String(cell || '');
        // Strip ANSI color codes when calculating length
        const strippedCell = cellStr.replace(/\u001b\[\d+m/g, '');
        
        // Update column width if this cell is wider
        if (i < colWidths.length && strippedCell.length + (opts.padding * 2) > colWidths[i]) {
          colWidths[i] = strippedCell.length + (opts.padding * 2);
        }
      });
      
      // Store the row
      rows.push(rowData);
    },
    
    /**
     * Converts the table to a string for display
     * @returns {string} Formatted table string
     */
    toString: () => {
      const lines = [];
      
      // Create header row
      const headerRow = headers.map((header, i) => {
        const paddedHeader = header.padEnd(colWidths[i] - (opts.padding * 2));
        return ' '.repeat(opts.padding) + paddedHeader + ' '.repeat(opts.padding);
      }).join('|');
      
      // Add header to lines
      lines.push('|' + headerRow + '|');
      
      // Create separator row
      const separatorRow = colWidths.map(w => '-'.repeat(w)).join('+');
      lines.push('+' + separatorRow + '+');
      
      // Add data rows
      rows.forEach(rowData => {
        const formattedRow = rowData.map((cell, i) => {
          const cellStr = String(cell || '');
          // Detect if cell has color codes
          const hasColorCodes = /\u001b\[\d+m/.test(cellStr);
          
          // For cells with color codes, we need special handling
          if (hasColorCodes) {
            // Strip codes for width calculation
            const strippedCell = cellStr.replace(/\u001b\[\d+m/g, '');
            const padding = colWidths[i] - (opts.padding * 2) - strippedCell.length;
            return ' '.repeat(opts.padding) + cellStr + ' '.repeat(padding) + ' '.repeat(opts.padding);
          } else {
            // Normal cell padding
            const paddedCell = cellStr.padEnd(colWidths[i] - (opts.padding * 2));
            return ' '.repeat(opts.padding) + paddedCell + ' '.repeat(opts.padding);
          }
        }).join('|');
        
        lines.push('|' + formattedRow + '|');
      });
      
      return lines.join('\n');
    }
  };
  
  return table;
}

/**
 * Calculates various statistical measures for an array of numbers
 * @param {Array<number>} values - Array of numerical values to analyze
 * @returns {Object} Object containing statistical measures
 */
export function calculateStats(values) {
  // Filter out non-numeric values
  const numbers = values.filter(n => typeof n === 'number' && !isNaN(n));
  
  if (numbers.length === 0) {
    return {
      count: 0,
      min: 0,
      max: 0,
      mean: 0,
      median: 0,
      stdDev: 0,
      sum: 0
    };
  }
  
  // Sort values for percentile calculations
  const sorted = [...numbers].sort((a, b) => a - b);
  
  // Calculate basic statistics
  const count = numbers.length;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const sum = numbers.reduce((acc, val) => acc + val, 0);
  const mean = sum / count;
  
  // Calculate median
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
  
  // Calculate standard deviation
  const squareDiffs = numbers.map(value => {
    const diff = value - mean;
    return diff * diff;
  });
  const avgSquareDiff = squareDiffs.reduce((acc, val) => acc + val, 0) / count;
  const stdDev = Math.sqrt(avgSquareDiff);
  
  return {
    count,
    min,
    max,
    mean,
    median,
    stdDev,
    sum
  };
}

/**
 * Reads and parses a JSON file with error handling
 * @param {string} filePath - Path to the JSON file
 * @param {Object} defaultValue - Default value to return if file doesn't exist or is invalid
 * @returns {Object} Parsed JSON data or default value
 */
export function readJsonFile(filePath, defaultValue = {}) {
  try {
    if (!fs.existsSync(filePath)) {
      return defaultValue;
    }
    
    const fileData = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(fileData);
  } catch (error) {
    console.error(chalk.red(`Error reading JSON file ${filePath}: ${error.message}`));
    return defaultValue;
  }
}

/**
 * Writes data to a JSON file with error handling
 * @param {string} filePath - Path where to write the file
 * @param {Object} data - Data to write to the file
 * @param {boolean} pretty - Whether to pretty-print the JSON
 * @returns {boolean} True if successful, false otherwise
 */
export function writeJsonFile(filePath, data, pretty = true) {
  try {
    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    const jsonData = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
    fs.writeFileSync(filePath, jsonData, 'utf8');
    return true;
  } catch (error) {
    console.error(chalk.red(`Error writing JSON file ${filePath}: ${error.message}`));
    return false;
  }
}

/**
 * Calculates the relative strength index (RSI) for a series of prices
 * @param {Array<number>} prices - Array of price values
 * @param {number} period - Period for RSI calculation (default: 14)
 * @returns {number} RSI value between 0 and 100
 */
export function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) {
    return 50; // Not enough data, return neutral value
  }
  
  // Calculate price changes
  const changes = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }
  
  // Split changes into gains and losses
  let gains = [];
  let losses = [];
  
  for (const change of changes) {
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }
  
  // Get relevant changes for the period
  gains = gains.slice(-period);
  losses = losses.slice(-period);
  
  // Calculate average gain and average loss
  const avgGain = gains.reduce((sum, val) => sum + val, 0) / period;
  const avgLoss = losses.reduce((sum, val) => sum + val, 0) / period;
  
  // Calculate the relative strength (RS)
  if (avgLoss === 0) {
    return 100; // No losses, RSI = 100
  }
  
  const rs = avgGain / avgLoss;
  
  // Calculate the RSI
  return 100 - (100 / (1 + rs));
}

/**
 * Calculates exponential moving average (EMA) for a series of values
 * @param {Array<number>} values - Array of numerical values
 * @param {number} period - Period for EMA calculation
 * @returns {Array<number>} Array of EMA values
 */
export function calculateEMA(values, period) {
  const ema = [];
  const k = 2 / (period + 1);
  
  // Start with simple moving average
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i];
  }
  
  ema.push(sum / period);
  
  // Calculate EMA for the rest
  for (let i = period; i < values.length; i++) {
    ema.push(values[i] * k + ema[ema.length - 1] * (1 - k));
  }
  
  return ema;
}

/**
 * Detects a significant drop in price (market impact)
 * @param {Array<{price: number, timestamp: number}>} priceHistory - Array of price points with timestamps
 * @param {number} thresholdPercent - Threshold percentage to consider significant (default: 5%)
 * @param {number} windowMinutes - Time window to consider in minutes (default: 5)
 * @returns {Object|null} Details of the drop or null if no significant drop
 */
export function detectPriceDrop(priceHistory, thresholdPercent = 5, windowMinutes = 5) {
  if (priceHistory.length < 2) {
    return null;
  }
  
  // Sort by timestamp (newest first)
  const sortedHistory = [...priceHistory].sort((a, b) => b.timestamp - a.timestamp);
  
  // Get current price
  const currentPrice = sortedHistory[0].price;
  const currentTime = sortedHistory[0].timestamp;
  
  // Define time window
  const windowStartTime = currentTime - (windowMinutes * 60 * 1000);
  
  // Find highest price in the window
  let highestPrice = currentPrice;
  let highestPriceTime = currentTime;
  
  for (const point of sortedHistory) {
    if (point.timestamp < windowStartTime) {
      break; // Outside our window
    }
    
    if (point.price > highestPrice) {
      highestPrice = point.price;
      highestPriceTime = point.timestamp;
    }
  }
  
  // Calculate percentage drop
  const percentDrop = ((highestPrice - currentPrice) / highestPrice) * 100;
  
  if (percentDrop >= thresholdPercent) {
    return {
      percentDrop,
      highestPrice,
      currentPrice,
      highestPriceTime,
      currentTime,
      timeElapsedMs: currentTime - highestPriceTime
    };
  }
  
  return null;
}

/**
 * Parses a CSV string into an array of objects
 * @param {string} csvString - CSV content as string
 * @param {Object} options - Parsing options
 * @returns {Array<Object>} Parsed CSV data as array of objects
 */
export function parseCSV(csvString, options = {}) {
  const lines = csvString.split('\n');
  
  // Skip empty lines
  const nonEmptyLines = lines.filter(line => line.trim().length > 0);
  
  if (nonEmptyLines.length === 0) {
    return [];
  }
  
  // Parse header row
  const headerLine = nonEmptyLines[0];
  const headers = headerLine.split(',').map(header => header.trim());
  
  // Parse data rows
  const result = [];
  
  for (let i = 1; i < nonEmptyLines.length; i++) {
    const line = nonEmptyLines[i];
    const values = line.split(',').map(value => value.trim());
    
    // Skip rows with invalid number of columns
    if (values.length !== headers.length) {
      continue;
    }
    
    // Create object for this row
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      const value = values[j];
      
      // Convert to number if possible (and option enabled)
      if (options.convertNumbers && !isNaN(value) && value !== '') {
        obj[headers[j]] = parseFloat(value);
      } else {
        obj[headers[j]] = value;
      }
    }
    
    result.push(obj);
  }
  
  return result;
}

// Export all utility functions
export default {
  createTable,
  calculateStats,
  readJsonFile,
  writeJsonFile,
  calculateRSI,
  calculateEMA,
  detectPriceDrop,
  parseCSV
};