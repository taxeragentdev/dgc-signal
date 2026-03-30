const exchange = require('./exchange');
const confluence = require('./analysis/confluence');
const telegram = require('./telegram');
const coins = require('../config/coins');
const winston = require('winston');

class MarketScanner {
    constructor() {
        this.timeframes = ['5m', '15m', '30m', '1h', '4h'];
        this.lastSignals = {}; // Symbol + Timeframe key to prevent duplicate alerts
        this.logger = winston.createLogger({
            level: 'info',
            format: winston.format.json(),
            transports: [new winston.transports.Console()]
        });
    }

    /**
     * Scans all symbols and timeframes.
     */
    async scanAll() {
        this.logger.info(`Starting market scan for ${coins.length} symbols...`);

        for (const symbol of coins) {
            for (const tf of this.timeframes) {
                try {
                    const candles = await exchange.fetchOHLCV(symbol, tf, 200);
                    if (!candles || candles.length < 200) continue;

                    const signal = confluence.analyze(candles);

                    if (signal) {
                        const lastCandleTime = candles[candles.length - 1].timestamp;
                        const signalKey = `${symbol}_${tf}_${signal.type}_${lastCandleTime}`;

                        // Prevent duplicate signal for the same candle
                        if (!this.lastSignals[signalKey]) {
                            this.lastSignals[signalKey] = true;
                            this.logger.info(`🚨 SIGNAL FOUND: ${symbol} ${tf} ${signal.type}`);
                            await telegram.sendSignal(symbol, tf, signal);
                        }
                    }
                } catch (error) {
                    this.logger.error(`Error scanning ${symbol} on ${tf}: ${error.message}`);
                }
                
                // Small delay to avoid rate limits
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }
    }

    /**
     * Start the interval scan.
     */
    start(intervalMs = 300000) {
        this.scanAll(); // Immediate scan
        setInterval(() => this.scanAll(), intervalMs);
    }
}

module.exports = new MarketScanner();
