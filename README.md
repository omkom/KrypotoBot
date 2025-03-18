# KryptoBot - Memecoin Sniping Bot

An advanced, high-performance sniping bot for automated trading of memecoins on the Solana blockchain.

## Features

- 🚀 Automatically detects and analyzes new memecoin listings
- 📊 Advanced risk and potential scoring algorithm
- 💰 Dynamic trade size calculation based on risk assessment
- 🔄 Integrates with Jupiter aggregator for optimal swap routes
- 📝 Comprehensive logging and analytics
- 🔧 Configurable via environment variables
- 🧪 Supports dry-run mode for testing without actual trades

## Requirements

- Node.js 16+
- Solana wallet with private key
- API keys for Etherscan, Alchemy (as applicable)

## Installation

Clone the repository:

```bash
git clone https://github.com/omkom/KryptoBot.git
cd KryptoBot
```

Install dependencies:

```bash
npm install
```

Create and configure your `.env` file based on the provided `.env.sample`:

```bash
cp .env.sample .env
# Edit .env with your configuration
```

## Configuration

The bot is highly configurable through environment variables in the `.env` file:

```
# API Keys
ETHERSCAN_API_KEY=your_etherscan_key
ALCHEMY_API_KEY=your_alchemy_key

# Network Configuration
SOLANA_RPC_URL_PROD=https://api.mainnet-beta.solana.com
SOLANA_PRIVATE_KEY_PROD=your_private_key_in_base64

# Trading Parameters
MAX_SOL_PER_TRADE=0.01
RISK_PERCENTAGE=0.3
SLIPPAGE=2

# See .env.sample for complete configuration options
```

## Usage

### Start the bot

```bash
npm start
```

### Run in development mode

```bash
DEBUG=true DRY_RUN=true npm start
```

### Clean log files

```bash
npm run clean-logs
```

## Project Structure

```
KryptoBot/
├── src/                    # Source code
│   └── bot-core.js         # Main bot logic
├── utils/                  # Utility scripts
│   └── token-log-cleaner.js # Log management utility
├── logs/                   # Trade logs
├── .env                    # Environment configuration
├── .env.sample             # Sample configuration
├── package.json            # Project metadata
└── README.md               # Documentation
```

## How It Works

1. **Token Discovery**: The bot scans for new token listings on DEXScreener that match configured criteria.

2. **Risk Analysis**: Each token undergoes comprehensive analysis to determine risk and potential scores based on:
   - Liquidity
   - Volume
   - Price momentum
   - Token age
   - Verification status

3. **Trade Sizing**: The bot calculates optimal trade sizes based on risk assessment and configured parameters.

4. **Execution**: For qualifying tokens, the bot executes trades through the Jupiter Aggregator API.

5. **Logging and Analytics**: All trades are logged with detailed analytics for performance tracking.

## License

MIT

## Disclaimer

Trading cryptocurrencies involves significant risk. This bot is provided for educational purposes only. Use at your own risk.

```
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.