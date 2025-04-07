# KryptoBot - Advanced Memecoin Trading Platform

A sophisticated, high-performance automated trading system for memecoins on the Solana blockchain, featuring distributed architecture, real-time analytics, and AI-driven strategy optimization.

## Core Features

- 🚀 **Multi-strategy Trading Engine**: Supports multiple concurrent trading strategies across various token profiles
- 📊 **Advanced Risk Analysis**: Comprehensive token scoring using liquidity, volume, price momentum, and on-chain data
- 🔄 **Intelligent Exit Strategies**: Take-profit stages, trailing stops, time-based exits, and trend reversal detection
- 🧠 **Self-optimizing Parameters**: System that learns from trading performance and adjusts strategies
- 🔍 **Manipulation Detection**: Advanced algorithms to identify and avoid pump & dump schemes
- 📈 **Real-time Dashboard**: Complete visibility into performance via Grafana and React dashboard
- 🏛️ **Distributed Architecture**: Scalable microservices architecture with Docker containerization
- 📝 **Comprehensive Logging**: Detailed trading records with analysis for accurate P&L calculation

## System Architecture

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│  Trading Core   │      │ Instance Manager │      │   Monitoring    │
│  (Memecoin Bot) │<────>│ (Multi-Strategy) │<────>│ (Dashboard/API) │
└────────┬────────┘      └────────┬─────────┘      └────────┬────────┘
         │                        │                         │
         v                        v                         v
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│  Profit Tracker │<────>│   Performance   │<────>│  Token Analyzer │
│  (FIFO Method)  │      │    Analyzer     │      │  (Risk Scoring) │
└─────────────────┘      └─────────────────┘      └─────────────────┘
```

## Requirements

- Node.js 18+
- Docker and Docker Compose
- Solana wallet with private key (base58 encoded)
- Solana RPC endpoint (mainnet)

## Quick Start

1. Clone the repository:

```bash
git clone https://github.com/omkom/kryptobot.git
cd kryptobot
```

2. Create your environment configuration:

```bash
cp .env.sample .env
# Edit .env with your configuration details
```

3. Set up Docker volumes:

```bash
bash docker/setup-volumes.sh
```

4. Start the application:

```bash
# Production mode
./start.sh start prod

# Development mode with logs
./start.sh start dev

# Debug mode with DRY_RUN=true
./start.sh start debug
```

## Configuration

The system is highly configurable through environment variables:

```ini
# Network Settings
SOLANA_RPC_URL_PROD=https://api.mainnet-beta.solana.com
SOLANA_PRIVATE_KEY_PROD=your_base58_encoded_private_key

# Trading Parameters
MAX_SOL_PER_TRADE=0.1
RISK_PERCENTAGE=0.03
SLIPPAGE=2
TAKE_PROFIT=25
STOP_LOSS=-20

# Operational Modes
DRY_RUN=true  # Simulate trades without execution
DEBUG=true    # Enable detailed logging
```

See `.env.sample` for complete configuration options.

## Dashboard Access

The monitoring dashboard is available at:

- http://localhost:8080 - Main dashboard
- http://localhost:3001 - Grafana metrics

## Project Structure

```
KryptoBot/
├── src/                      # Source code
│   ├── analyzers/            # Trading analytics modules
│   ├── api/                  # API endpoints and clients
│   ├── core/                 # Core trading engine
│   ├── services/             # Shared services
│   ├── config/               # Configuration management
│   └── utils/                # Helper utilities
├── docker/                   # Docker configuration
│   └── Dockerfile.*          # Service-specific configurations
├── grafana/                  # Grafana dashboards and config
├── logs/                     # Log output directory
│   ├── instances/            # Per-instance logs
│   └── analysis/             # Analysis reports
├── docker-compose.yml        # Container orchestration
├── start.sh                  # Main control script
└── README.md                 # This file
```

## How it Works

### Token Discovery and Analysis

1. **Discovery**: The system scans for new token listings on DEXScreener that match the configured criteria.

2. **Risk Analysis**: Each token undergoes comprehensive scoring based on:
   - Liquidity depth and stability
   - Trading volume and momentum
   - Price action patterns 
   - Age and verification status
   - Transaction patterns (buys vs sells)
   - Manipulation detection algorithms

3. **Strategy Selection**: Trading strategies are matched to tokens based on their characteristics:
   - Aggressive: High potential/higher risk tokens
   - Balanced: Medium risk/reward profile
   - Conservative: Lower risk assets with steady growth

### Trading Execution

1. **Position Sizing**: The system calculates optimal trade sizes based on:
   - Token risk score
   - Portfolio risk management rules
   - Strategy-specific parameters

2. **Execution**: Trades are routed through Jupiter Aggregator for best price execution with:
   - Configurable slippage protection
   - Dynamic fee optimization
   - Multi-route swap paths

3. **Exit Management**: Each position is actively monitored with:
   - Strategy-specific take profit levels
   - Dynamic trailing stops
   - Time-based exit rules
   - Multi-stage profit taking
   - Trend reversal detection

### Performance Analysis

1. **Profit Tracking**: All trades are tracked with detailed analytics.

2. **Strategy Optimization**: The performance analyzer continuously evaluates strategy effectiveness and recommends parameter adjustments.

3. **Dashboard Visualization**: Real-time performance metrics are available through the monitoring dashboard and Grafana.

## Command Reference

```bash
# Start the application
./start.sh start [mode]  # modes: prod, dev, debug

# Stop all containers
./start.sh stop

# View logs
./start.sh logs

# Check status
./start.sh status

# Update the application
./start.sh update

# Create backup
./start.sh backup

# Restore from backup
./start.sh restore [backup_file]
```

## Disclaimer

Trading cryptocurrencies involves significant risk. This bot is provided for educational purposes only. Use at your own risk.

```
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
```