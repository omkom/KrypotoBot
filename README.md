# KryptoBot - Advanced Memecoin Trading Platform

A sophisticated, high-performance automated trading system for memecoins on the Solana blockchain, featuring distributed architecture, real-time analytics, and AI-driven strategy optimization.

## Core Features

- 🚀 **Multi-strategy Trading Engine**: Supports multiple concurrent trading strategies across various token profiles
- 📊 **Advanced Risk Analysis**: Comprehensive token scoring using liquidity, volume, price momentum, and on-chain data
- 🧠 **AI-Optimized Parameters**: Self-optimizing system that learns from trading performance
- 🔄 **Jupiter Integration**: Seamless integration with Jupiter aggregator for optimal swap execution
- 📈 **Real-time Dashboard**: Complete visibility into performance via Grafana and custom React dashboard
- 🏛️ **Distributed Architecture**: Scalable microservices architecture with Docker containerization
- 📝 **Comprehensive Logging**: Detailed trading records with FIFO accounting for accurate P&L calculation
- 🛡️ **Risk Management**: Configurable per-trade limits, take-profit/stop-loss mechanisms, and blacklisting

## System Architecture

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│  Trading Core   │      │ Instance Manager │      │   Monitoring    │
│  (Memecoin Bot) │<────>│ (Multi-Strategy) │<────>│ (Dashboard/API) │
└────────┬────────┘      └────────┬─────────┘      └────────┬────────┘
         │                        │                         │
         v                        v                         v
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│  Profit Tracker  │<───>│   Performance   │<───>│  Token Analyzer  │
│  (FIFO Method)   │     │    Analyzer     │     │  (Risk Scoring)  │
└─────────────────┘      └─────────────────┘      └─────────────────┘
```

## Requirements

- Node.js 16+
- Docker and Docker Compose
- Solana wallet with private key (base64 encoded)
- Solana RPC endpoint (mainnet)

## Installation

1. Clone the repository:

```bash
git clone https://github.com/yourusername/KryptoBot.git
cd KryptoBot
```

2. Install dependencies:

```bash
npm install
```

3. Create your environment configuration:

```bash
cp .env.sample .env
# Edit .env with your configuration details
```

4. Run the setup test to verify your environment:

```bash
node setup-test.js
```

## Running with Docker (Recommended)

The full platform can be launched with Docker Compose:

```bash
# Start all services
npm run docker

# View logs
npm run docker:logs

# Stop all services
npm run docker:stop
```

## Manual Operation

Individual components can be run separately:

```bash
# Start the main trading bot
npm start

# Run the profit tracker
npm run profit-tracker

# Launch performance analyzer
npm run performance

# Start the monitoring API
npm run monitor

# Manage multiple trading instances
npm run instances
```

## Configuration

The system is highly configurable through environment variables:

```ini
# Network Settings
SOLANA_RPC_URL_PROD=https://api.mainnet-beta.solana.com
SOLANA_PRIVATE_KEY_PROD=your_base64_encoded_private_key

# Trading Parameters
MAX_SOL_PER_TRADE=0.1
RISK_PERCENTAGE=0.03
SLIPPAGE=2
TAKE_PROFIT=25
STOP_LOSS=-20

# Strategy Settings
MIN_LIQUIDITY_USD=10000
MIN_VOLUME_24H=5000

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
│   ├── api/                  # API endpoints and monitoring
│   ├── core/                 # Core trading engine
│   ├── monitoring/           # Performance monitoring tools
│   ├── strategies/           # Trading strategies
│   └── utils/                # Helper utilities
├── docker/                   # Docker configuration
│   └── Dockerfile.*          # Service-specific configurations
├── grafana/                  # Grafana dashboards and config
├── logs/                     # Log output directory
│   ├── instances/            # Per-instance logs
│   └── analysis/             # Analysis reports
├── docker-compose.yml        # Container orchestration
├── index.js                  # Main entry point
├── setup-test.js             # Environment verification tool
└── README.md                 # Documentation
```

## How it Works

### Token Discovery and Analysis

1. **Discovery**: The system continuously scans for new token listings on DEXScreener that match the configured criteria.

2. **Risk Analysis**: Each token undergoes comprehensive scoring based on:
   - Liquidity depth and stability
   - Trading volume and momentum
   - Price action patterns 
   - Age and verification status
   - Transaction patterns (buys vs sells)

3. **Strategy Selection**: Trading strategies are matched to tokens based on their characteristics:
   - Aggressive: High potential/higher risk tokens
   - Balanced: Medium risk/reward profile
   - Conservative: Lower risk assets with steady growth
   - Specialized: Token-specific strategies optimized through performance analysis

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

### Performance Analysis

1. **Profit Tracking**: All trades are tracked using FIFO accounting for accurate P&L calculations.

2. **Strategy Optimization**: The performance analyzer continuously evaluates strategy effectiveness and recommends parameter adjustments.

3. **Dashboard Visualization**: Real-time performance metrics are available through the monitoring dashboard and Grafana.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

## Disclaimer

Trading cryptocurrencies involves significant risk. This bot is provided for educational purposes only. Use at your own risk.

```
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
```
