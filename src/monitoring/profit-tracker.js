/**
 * KryptoBot Profit Tracker
 * 
 * Analyzes trading logs, computes ROI metrics, and generates performance reports.
 * 
 * @module profit-tracker
 */

import fs from 'fs';
import path from 'path';
import { evaluateTokenROI, quickROIAssessment } from '../analyzers/tokenROIAnalyzer.js';

// Configuration with defaults
const LOG_FILE = process.env.LOG_FILE_PATH || '/app/logs/trade_logs.json';
const REPORT_FILE = process.env.PROFIT_REPORT_PATH || '/app/logs/profit_report.json';
const INTERVAL = parseInt(process.env.CHECK_INTERVAL, 10) || 10000;

/**
 * Loads and parses trading logs from the filesystem
 * @returns {Array} Parsed token array or empty array if error
 */
function loadLogs() {
  try {
    if (!fs.existsSync(LOG_FILE)) {
      console.warn(`[tracker] ⚠️ Log file not found: ${LOG_FILE}`);
      return [];
    }
    
    const content = fs.readFileSync(LOG_FILE, 'utf-8');
    const parsed = JSON.parse(content);
    
    // Ensure we extract the tokens object or array from the logs format
    if (parsed && parsed.tokens) {
      // If tokens is an object of {address: tokenData}, convert to array
      return Object.values(parsed.tokens);
    } else if (Array.isArray(parsed)) {
      return parsed;
    } else {
      console.warn(`[tracker] ⚠️ Unexpected log format: no tokens array found`);
      return [];
    }
  } catch (e) {
    console.error(`[tracker] ❌ Error reading log file: ${e.message}`);
    return [];
  }
}

/**
 * Analyzes token performance using ROI evaluation
 * @param {Array} logs - Trading logs to analyze
 * @returns {Array} Analysis results with performance metrics
 */
function analyze(logs) {
  const results = [];
  
  // Ensure logs is iterable before attempting to loop
  if (!Array.isArray(logs)) {
    console.warn(`[tracker] ⚠️ Logs is not an array: ${typeof logs}`);
    return results;
  }
  
  for (const token of logs) {
    try {
      // Skip invalid tokens
      if (!token || typeof token !== 'object') {
        continue;
      }
      
      const report = evaluateTokenROI(token);
      results.push(report);
    } catch (err) {
      console.warn(`[tracker] ⚠️ Token ${token?.baseToken?.symbol || '??'}: analysis error (${err.message})`);
    }
  }
  
  return results;
}

/**
 * Writes analysis report to filesystem
 * @param {Array} reports - Analysis reports to store
 */
function writeReport(reports) {
  try {
    // Ensure reports is an array
    if (!Array.isArray(reports)) {
      reports = [];
    }
    
    // Use temporary file for atomic write
    const tempFile = `${REPORT_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(reports, null, 2));
    fs.renameSync(tempFile, REPORT_FILE);
    console.log(`[tracker] ✅ Report generated with ${reports.length} analyses`);
  } catch (e) {
    console.error(`[tracker] ❌ Error writing report: ${e.message}`);
  }
}

/**
 * Main tracking function that loads logs, analyzes data and writes reports
 */
function track() {
  const logs = loadLogs();
  
  if (!logs || logs.length === 0) {
    console.warn('[tracker] ⚠️ No tokens found to analyze.');
    // Write empty report to avoid errors during reads
    writeReport([]);
    return;
  }
  
  const report = analyze(logs);
  writeReport(report);
}

// Start the tracking cycle
console.log(`[tracker] 📈 Starting profit-tracker with ${INTERVAL / 1000}s interval`);
track();
setInterval(track, INTERVAL);