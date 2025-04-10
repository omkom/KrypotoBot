/**
 * KryptoBot Monitoring API Service
 * 
 * REST API for trading bot metrics, statistics, and real-time monitoring.
 * Provides endpoints for the dashboard, health checks, and websocket updates.
 * 
 * @module monitoring-api
 * @requires express
 * @requires http
 * @requires socket.io
 * @requires cors
 * @requires compression
 * @requires helmet
 */

import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get directory path in ESM
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const PORT = process.env.PORT || 3000;
const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '../../logs');
const TRADE_LOG_PATH = process.env.TRADE_LOG_PATH || path.join(LOG_DIR, 'trade_logs.json');
const PROFIT_REPORT_PATH = process.env.PROFIT_REPORT_PATH || path.join(LOG_DIR, 'profit_report.json');
const ERROR_LOG_PATH = process.env.ERROR_LOG_PATH || path.join(LOG_DIR, 'error_log.txt');
const DEBUG = process.env.DEBUG === 'true';

// Initialize Express app
const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors());
app.use(compression()); // Compress responses
app.use(helmet()); // Security headers
app.use(express.json());
app.use(express.static(path.join(__dirname, '../../public')));

// Log requests in debug mode
if (DEBUG) {
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} [${req.method}] ${req.url}`);
    next();
  });
}

/**
 * Helper to safely read and parse JSON files
 * @param {string} filePath - Path to JSON file
 * @returns {Object} Parsed JSON or empty object if error
 */
function safeReadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      console.warn(`File not found: ${filePath}`);
      return {};
    }
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading ${filePath}: ${error.message}`);
    return {};
  }
}

/**
 * Helper to read the last N lines of a file
 * @param {string} filePath - Path to file
 * @param {number} lines - Number of lines to read
 * @returns {string} Last N lines of file
 */
function readLastLines(filePath, lines = 100) {
  try {
    if (!fs.existsSync(filePath)) {
      return '';
    }
    
    const data = fs.readFileSync(filePath, 'utf8');
    const linesArray = data.split('\n');
    return linesArray.slice(-lines).join('\n');
  } catch (error) {
    console.error(`Error reading lines from ${filePath}: ${error.message}`);
    return '';
  }
}

// API Routes

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Trading statistics endpoint
app.get('/api/stats', (req, res) => {
  try {
    const tradeLogs = safeReadJson(TRADE_LOG_PATH);
    const tokens = tradeLogs.tokens || {};
    
    // Calculate stats
    const stats = {
      totalTrades: Object.keys(tokens).length,
      activeTrades: Object.values(tokens).filter(t => t.currentAmount > 0).length,
      totalInvested: Object.values(tokens).reduce((sum, t) => sum + (t.initialInvestment || 0), 0),
      totalReturned: Object.values(tokens).reduce((sum, t) => sum + (t.totalReceived || 0), 0),
      lastUpdate: tradeLogs.lastUpdate || new Date().toISOString()
    };
    
    // Calculate profit/loss
    stats.profitLoss = stats.totalReturned - stats.totalInvested;
    stats.profitPercentage = stats.totalInvested > 0 
      ? (stats.profitLoss / stats.totalInvested) * 100 
      : 0;
    
    res.json(stats);
  } catch (error) {
    console.error(`Error in /api/stats: ${error.message}`);
    res.status(500).json({ error: 'Error retrieving statistics' });
  }
});

// Active positions endpoint
app.get('/api/positions', (req, res) => {
  try {
    const tradeLogs = safeReadJson(TRADE_LOG_PATH);
    const tokens = tradeLogs.tokens || {};
    
    const activePositions = Object.entries(tokens)
      .filter(([_, token]) => token.currentAmount > 0)
      .map(([address, token]) => {
        const roi = token.initialInvestment > 0 
          ? ((token.totalReceived - token.initialInvestment) / token.initialInvestment) * 100 
          : 0;
        
        return {
          address,
          name: token.tokenName,
          amount: token.currentAmount,
          invested: token.initialInvestment,
          received: token.totalReceived,
          roi,
          firstBuy: token.firstPurchaseTime,
          lastUpdate: token.lastUpdateTime
        };
      });
    
    res.json(activePositions);
  } catch (error) {
    console.error(`Error in /api/positions: ${error.message}`);
    res.status(500).json({ error: 'Error retrieving positions' });
  }
});

// Transaction history endpoint
app.get('/api/transactions', (req, res) => {
  try {
    const tradeLogs = safeReadJson(TRADE_LOG_PATH);
    const tokens = tradeLogs.tokens || {};
    const limit = parseInt(req.query.limit) || 50;
    
    // Collect all transactions across tokens
    const allTransactions = [];
    
    Object.entries(tokens).forEach(([address, token]) => {
      if (token.transactions) {
        token.transactions.forEach(tx => {
          allTransactions.push({
            tokenAddress: address,
            tokenName: token.tokenName,
            ...tx
          });
        });
      }
    });
    
    // Sort by timestamp (newest first) and limit
    const sortedTransactions = allTransactions
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);
    
    res.json(sortedTransactions);
  } catch (error) {
    console.error(`Error in /api/transactions: ${error.message}`);
    res.status(500).json({ error: 'Error retrieving transactions' });
  }
});

// Profit report endpoint
app.get('/api/profit-report', (req, res) => {
  try {
    const report = safeReadJson(PROFIT_REPORT_PATH);
    res.json(report);
  } catch (error) {
    console.error(`Error in /api/profit-report: ${error.message}`);
    res.status(500).json({ error: 'Error retrieving profit report' });
  }
});

// Error logs endpoint
app.get('/api/error-logs', (req, res) => {
  try {
    const lines = parseInt(req.query.lines) || 100;
    const logs = readLastLines(ERROR_LOG_PATH, lines);
    res.send(logs);
  } catch (error) {
    console.error(`Error in /api/error-logs: ${error.message}`);
    res.status(500).json({ error: 'Error retrieving error logs' });
  }
});

// Token details endpoint
app.get('/api/token/:address', (req, res) => {
  try {
    const { address } = req.params;
    const tradeLogs = safeReadJson(TRADE_LOG_PATH);
    const token = tradeLogs.tokens?.[address];
    
    if (!token) {
      return res.status(404).json({ error: 'Token not found' });
    }
    
    res.json(token);
  } catch (error) {
    console.error(`Error in /api/token/:address: ${error.message}`);
    res.status(500).json({ error: 'Error retrieving token details' });
  }
});

// WebSocket setup for real-time updates
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  
  // Send initial data
  const initialData = {
    stats: safeReadJson(TRADE_LOG_PATH)?.stats || {},
    timestamp: new Date().toISOString()
  };
  socket.emit('initialData', initialData);
  
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// File watcher for real-time updates
let lastModified = 0;
setInterval(() => {
  try {
    const stats = fs.statSync(TRADE_LOG_PATH);
    if (stats.mtimeMs > lastModified) {
      lastModified = stats.mtimeMs;
      const data = safeReadJson(TRADE_LOG_PATH);
      io.emit('dataUpdate', {
        stats: data.stats || {},
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error(`Error in file watcher: ${error.message}`);
  }
}, 5000);

// Start server
server.listen(PORT, () => {
  console.log(`Monitoring API running on port ${PORT}`);
  console.log(`Log directory: ${LOG_DIR}`);
  console.log(`Debug mode: ${DEBUG ? 'ON' : 'OFF'}`);
});

// Error handling for unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Error handling for uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Continue running - let PM2 or Docker handle restarts if needed
});

export default app;