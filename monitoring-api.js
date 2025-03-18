import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import Redis from 'redis';
import morgan from 'morgan';

// Initialize Express app
const app = express();
const port = process.env.PORT || 3000;

// Create HTTP server
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors());
app.use(helmet({
  contentSecurityPolicy: false // Disable for development
}));
app.use(compression());
app.use(express.json());
app.use(morgan('dev')); // Log HTTP requests

// Log directory
const LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), 'logs');

// Key file paths to watch
const keyFilePaths = [
  path.join(LOG_DIR, 'trade_logs.json'),
  path.join(LOG_DIR, 'profit_report.json'),
  path.join(LOG_DIR, 'performance_analysis.json')
];

// Create a model for trade logs
const TradeSchema = new mongoose.Schema({
  tokenAddress: String,
  tokenName: String,
  type: String,
  amount: Number,
  priceSOL: Number,
  pricePerToken: Number,
  timestamp: Date,
  roi: Number,
  isDryRun: Boolean
}, { timestamps: true });

const TradeModel = mongoose.model('Trade', TradeSchema);

// Create a model for performance metrics
const PerformanceSchema = new mongoose.Schema({
  timestamp: Date,
  totalProfitLoss: Number,
  totalROI: Number,
  winRate: Number,
  tokenCount: Number,
  successfulTrades: Number,
  failedTrades: Number
}, { timestamps: true });

const PerformanceModel = mongoose.model('Performance', PerformanceSchema);

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI || 'mongodb://mongodb:27017/tradingbot')
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Connect to Redis
const redisClient = Redis.createClient({
  url: process.env.REDIS_URI || 'redis://redis:6379'
});

redisClient.on('error', (err) => console.error('Redis error:', err));
redisClient.connect().then(() => console.log('Connected to Redis'));

// Helper function to handle async errors
const asyncHandler = fn => (req, res, next) => 
  Promise.resolve(fn(req, res, next)).catch(next);

// API routes
app.get('/api/health', (req, res) => {
  const status = {
    status: 'OK',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  };
  res.status(200).json(status);
});

// Get all trading data
app.get('/api/trading-data', asyncHandler(async (req, res) => {
  try {
    const logPath = path.join(LOG_DIR, 'trade_logs.json');
    if (!fs.existsSync(logPath)) {
      return res.status(404).json({ error: 'Trading data not found' });
    }

    // Read file and parse JSON
    const data = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    
    // Cache in Redis for 30 seconds
    await redisClient.setEx('trading-data', 30, JSON.stringify(data));
    
    res.json(data);
  } catch (error) {
    console.error(`Error fetching trading data: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}));

// Get profit report
app.get('/api/profit-report', asyncHandler(async (req, res) => {
  try {
    // Check Redis cache first
    const cachedData = await redisClient.get('profit-report');
    if (cachedData) {
      return res.json(JSON.parse(cachedData));
    }
    
    const reportPath = path.join(LOG_DIR, 'profit_report.json');
    if (!fs.existsSync(reportPath)) {
      return res.status(404).json({ error: 'Profit report not found' });
    }

    const data = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    
    // Store in MongoDB for historical tracking
    if (data.summary) {
      const perfMetrics = {
        timestamp: new Date(),
        totalProfitLoss: data.summary.totalProfitLoss || 0,
        totalROI: data.summary.totalROI || 0,
        winRate: data.summary.winRate || 0,
        tokenCount: data.summary.tokenCount || 0,
        successfulTrades: data.summary.successfulTrades || 0,
        failedTrades: data.summary.failedTrades || 0
      };
      
      await PerformanceModel.create(perfMetrics);
    }
    
    // Cache in Redis for 30 seconds
    await redisClient.setEx('profit-report', 30, JSON.stringify(data));
    
    res.json(data);
  } catch (error) {
    console.error(`Error fetching profit report: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}));

// Get performance analysis
app.get('/api/performance-analysis', asyncHandler(async (req, res) => {
  try {
    const analysisPath = path.join(LOG_DIR, 'performance_analysis.json');
    if (!fs.existsSync(analysisPath)) {
      return res.status(404).json({ error: 'Performance analysis not found' });
    }

    const data = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));
    res.json(data);
  } catch (error) {
    console.error(`Error fetching performance analysis: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}));

// Get all instances
app.get('/api/instances', asyncHandler(async (req, res) => {
  try {
    const instancesDir = path.join(LOG_DIR, 'instances');
    if (!fs.existsSync(instancesDir)) {
      return res.status(404).json({ error: 'Instances directory not found' });
    }

    const instances = fs.readdirSync(instancesDir)
      .filter(dir => fs.statSync(path.join(instancesDir, dir)).isDirectory())
      .map(dir => {
        try {
          const infoPath = path.join(instancesDir, dir, 'instance_info.json');
          if (fs.existsSync(infoPath)) {
            return JSON.parse(fs.readFileSync(infoPath, 'utf8'));
          }
          return { id: dir, error: 'No info file' };
        } catch (error) {
          return { id: dir, error: error.message };
        }
      });

    res.json(instances);
  } catch (error) {
    console.error(`Error fetching instances: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}));

// Get instance details
app.get('/api/instances/:id', asyncHandler(async (req, res) => {
  try {
    const instanceDir = path.join(LOG_DIR, 'instances', req.params.id);
    if (!fs.existsSync(instanceDir)) {
      return res.status(404).json({ error: 'Instance not found' });
    }

    const response = {};

    // Get instance info
    const infoPath = path.join(instanceDir, 'instance_info.json');
    if (fs.existsSync(infoPath)) {
      response.info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
    }

    // Get instance trade logs
    const logPath = path.join(instanceDir, 'trade_logs.json');
    if (fs.existsSync(logPath)) {
      response.tradeLogs = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    }

    // Get instance profit report
    const reportPath = path.join(instanceDir, 'profit_report.json');
    if (fs.existsSync(reportPath)) {
      response.profitReport = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    }

    res.json(response);
  } catch (error) {
    console.error(`Error fetching instance details: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}));

// Get historical performance data
app.get('/api/historical-performance', asyncHandler(async (req, res) => {
  try {
    const days = parseInt(req.query.days || '7', 10);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const data = await PerformanceModel.find({ 
      createdAt: { $gte: startDate }
    }).sort({ createdAt: 1 });
    
    res.json(data);
  } catch (error) {
    console.error(`Error fetching historical performance: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}));

// Get recent trades
app.get('/api/recent-trades', asyncHandler(async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '20', 10);
    const trades = await TradeModel.find().sort({ createdAt: -1 }).limit(limit);
    res.json(trades);
  } catch (error) {
    console.error(`Error fetching recent trades: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}));

// Error handler middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Server error',
    message: err.message
  });
});

// Socket.IO handling for real-time updates
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// REMOVED: fs.watch with recursive option that causes the error
// Instead, set up a polling mechanism to check for file changes

// Set up polling for file changes instead of fs.watch which has platform compatibility issues
let fileContentsCache = {};

// Initialize the cache with current file contents
keyFilePaths.forEach(filePath => {
  try {
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      fileContentsCache[filePath] = {
        lastModified: stats.mtime.getTime(),
        size: stats.size
      };
    }
  } catch (error) {
    console.log(`Could not initialize file watch for ${filePath}: ${error.message}`);
  }
});

// Poll for file changes every 5 seconds
setInterval(() => {
  keyFilePaths.forEach(filePath => {
    try {
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        const lastModified = stats.mtime.getTime();
        const size = stats.size;
        
        const cachedData = fileContentsCache[filePath];
        if (!cachedData || cachedData.lastModified !== lastModified || cachedData.size !== size) {
          // File has changed
          fileContentsCache[filePath] = { lastModified, size };
          
          // Clear Redis cache based on which file changed
          const filename = path.basename(filePath);
          if (filename === 'trade_logs.json') {
            redisClient.del('trading-data');
          } else if (filename === 'profit_report.json') {
            redisClient.del('profit-report');
          }
          
          // Emit update to connected clients
          io.emit('file-updated', { 
            file: filename,
            timestamp: new Date().toISOString(),
            eventType: 'change'
          });
          
          console.log(`Detected change in ${filename}`);
        }
      }
    } catch (error) {
      console.error(`Error checking file ${filePath}: ${error.message}`);
    }
  });
}, 5000);

// Import trades into MongoDB (run on startup)
async function importTradesIntoMongoDB() {
  try {
    const logPath = path.join(LOG_DIR, 'trade_logs.json');
    if (!fs.existsSync(logPath)) {
      console.log('No trade logs found for MongoDB import');
      return;
    }
    
    const data = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    const tokens = data.tokens || {};
    
    // Extract all transactions
    const allTrades = [];
    Object.entries(tokens).forEach(([address, token]) => {
      if (token.transactions) {
        token.transactions.forEach(tx => {
          allTrades.push({
            tokenAddress: address,
            tokenName: token.tokenName || 'Unknown',
            ...tx,
            timestamp: new Date(tx.timestamp)
          });
        });
      }
    });
    
    // Count existing trades
    const existingCount = await TradeModel.countDocuments();
    
    // Only import if we have new trades
    if (allTrades.length > existingCount) {
      console.log(`Importing ${allTrades.length - existingCount} new trades into MongoDB`);
      
      // For each trade, update or insert
      for (const trade of allTrades.slice(existingCount)) {
        await TradeModel.updateOne(
          { 
            tokenAddress: trade.tokenAddress,
            timestamp: trade.timestamp,
            type: trade.type
          },
          trade,
          { upsert: true }
        );
      }
    }
  } catch (error) {
    console.error('Error importing trades to MongoDB:', error);
  }
}

// Start the server
server.listen(port, () => {
  console.log(`Monitoring API server running on port ${port}`);
  importTradesIntoMongoDB();
});

// Poll the instances directory for changes
const INSTANCES_DIR = path.join(LOG_DIR, 'instances');
let knownInstances = new Set();

// Initialize known instances
try {
  if (fs.existsSync(INSTANCES_DIR)) {
    fs.readdirSync(INSTANCES_DIR)
      .filter(dir => fs.statSync(path.join(INSTANCES_DIR, dir)).isDirectory())
      .forEach(dir => knownInstances.add(dir));
  }
} catch (error) {
  console.error(`Error initializing instances list: ${error.message}`);
}

// Poll for new instances every 10 seconds
setInterval(() => {
  try {
    if (fs.existsSync(INSTANCES_DIR)) {
      const currentInstances = new Set(
        fs.readdirSync(INSTANCES_DIR)
          .filter(dir => fs.statSync(path.join(INSTANCES_DIR, dir)).isDirectory())
      );
      
      // Check for new instances
      const newInstances = [...currentInstances].filter(dir => !knownInstances.has(dir));
      
      if (newInstances.length > 0) {
        console.log(`Detected ${newInstances.length} new instance(s): ${newInstances.join(', ')}`);
        io.emit('instances-updated', { 
          newInstances,
          timestamp: new Date().toISOString()
        });
        
        // Update known instances
        newInstances.forEach(dir => knownInstances.add(dir));
      }
    }
  } catch (error) {
    console.error(`Error checking instances: ${error.message}`);
  }
}, 10000);

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down...');
  
  // Close server first (stop accepting new connections)
  server.close(() => {
    console.log('HTTP server closed');
  });
  
  // Close database connections
  try {
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
    await redisClient.quit();
    console.log('Redis connection closed');
  } catch (error) {
    console.error('Error during shutdown:', error);
  }
  
  process.exit(0);
});