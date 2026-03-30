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
     * @param {Array} tfs - Specific timeframes to scan (default: all)
     */
    async scanAll(tfs = this.timeframes) {
        this.logger.info(`Starting market scan for ${coins.length} symbols...`);

        for (const symbol of coins) {
            for (const tf of tfs) {
                try {
                    await this.scanSymbol(symbol, tf);
                } catch (error) {
                    // Already logged in scanSymbol, just continue
                }
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }
    }

    /**
     * Scans a single symbol and timeframe.
     * @param {string} symbol 
     * @param {string} timeframe 
     * @param {boolean} isManual - If true, returns the signal object directly
     */
    async scanSymbol(symbol, timeframe, isManual = false) {
        try {
            const candles = await exchange.fetchOHLCV(symbol, timeframe, 200);
            if (!candles || candles.length < 200) {
                if (isManual) throw new Error(`${symbol} için yeterli veri (200 mum) bulunamadı.`);
                return null;
            }

            const signal = confluence.analyze(candles);

            if (signal) {
                const lastCandleTime = candles[candles.length - 1].timestamp;
                const signalKey = `${symbol}_${timeframe}_${signal.type}_${lastCandleTime}`;

                if (isManual || !this.lastSignals[signalKey]) {
                    if (!isManual) {
                        this.lastSignals[signalKey] = true;
                        this.logger.info(`🚨 SIGNAL FOUND: ${symbol} ${timeframe} ${signal.type}`);
                        await telegram.sendSignal(symbol, timeframe, signal);
                    }
                    return signal;
                }
            }
            return null;
        } catch (error) {
            this.logger.error(`Scan error (${symbol} - ${timeframe}): ${error.message}`);
            if (isManual) throw error;
            return null;
        }
    }

    /**
     * Start the continuous scan loop.
     */
    async start() {
        this.logger.info("📡 Sürekli Tarama Modu Aktif! (7/24 Sinyal Avcılığı)");
        
        while (true) {
            try {
                await this.scanAll();
                // Bir tur bittikten sonra 1 saniye güvenlik payı bırakıp hemen tekrar başla
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
                this.logger.error(`Döngü hatası: ${error.message}`);
                // Hata durumunda 5 saniye bekle (rate limit vb. durumlar için)
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }
}

module.exports = new MarketScanner();
