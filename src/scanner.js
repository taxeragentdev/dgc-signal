const exchange = require('./exchange');
const confluence = require('./analysis/confluence');
const telegram = require('./telegram');
const { getScanCoins } = require('../config/coins');
const winston = require('winston');
const { getScanTimeframes, getPairDelayMs } = require('./scanConfig');

class MarketScanner {
    constructor() {
        this.timeframes = getScanTimeframes();
        this.pairDelayMs = getPairDelayMs();
        this.lastSignals = {};
        /** Son tamamlanan arka plan turu (heartbeat için) */
        this.lastRoundStats = { pairs: 0, signals: 0, finishedAt: 0 };
        this._scanChain = Promise.resolve();
        this.logger = winston.createLogger({
            level: 'info',
            format: winston.format.json(),
            transports: [new winston.transports.Console()]
        });
    }

    getLoopIntervalMs() {
        const n = parseInt(process.env.SCAN_INTERVAL, 10);
        /** Varsayılan 45s — tam tur bitince bekleme (env ile hızlandırılabilir) */
        return Number.isFinite(n) && n > 0 ? n : 45000;
    }

    getLastRoundStats() {
        return this.lastRoundStats;
    }

    async scanAll(tfs = this.timeframes) {
        const run = () => this._runScanAll(tfs);
        const p = this._scanChain.then(run, run);
        this._scanChain = p.catch(() => {});
        return p;
    }

    async _runScanAll(tfs) {
        const coins = getScanCoins();
        this.logger.info(`Starting market scan for ${coins.length} symbols...`);

        let pairs = 0;
        let signals = 0;

        for (const symbol of coins) {
            for (const tf of tfs) {
                pairs++;
                try {
                    const sig = await this.scanSymbol(symbol, tf, false);
                    if (sig) signals++;
                } catch (error) {
                    this.logger.error(`Scan error (${symbol} - ${tf}): ${error.message}`);
                }
                await new Promise(resolve => setTimeout(resolve, this.pairDelayMs));
            }
        }

        this.logger.info(`Scan round finished: pairs=${pairs}, newSignals=${signals}`);
        this.lastRoundStats = { pairs, signals, finishedAt: Date.now() };
        return { pairs, signals };
    }

    /**
     * @param {boolean} isManual
     * @returns {Promise<null|object>} Otomatik: sinyal objesi veya null. Manuel: { manual, signal?|evaluation? }
     */
    async scanSymbol(symbol, timeframe, isManual = false) {
        try {
            const candles = await exchange.fetchOHLCV(symbol, timeframe, 200);
            if (!candles || candles.length < 200) {
                if (isManual) {
                    return {
                        manual: true,
                        evaluation: {
                            signal: null,
                            rawScore: 0,
                            rsi: null,
                            trend: '',
                            blockedByRsi: false,
                            threshold: confluence.getThreshold(),
                            reason: 'insufficient_candles'
                        }
                    };
                }
                return null;
            }

            const ev = confluence.evaluate(candles);
            const signal = ev.signal;

            if (!signal) {
                if (isManual) return { manual: true, evaluation: ev };
                return null;
            }

            const lastCandleTime = candles[candles.length - 1].timestamp;
            const signalKey = `${symbol}_${timeframe}_${signal.type}_${lastCandleTime}`;

            if (isManual || !this.lastSignals[signalKey]) {
                if (!isManual) {
                    this.lastSignals[signalKey] = true;
                    this.logger.info(`🚨 SIGNAL FOUND: ${symbol} ${timeframe} ${signal.type}`);
                    const sent = await telegram.sendSignal(symbol, timeframe, signal);
                    if (!sent) {
                        this.logger.error(`Sinyal Telegram'a iletilemedi (${symbol} ${timeframe})`);
                    }
                }
                if (isManual) return { manual: true, signal };
                return signal;
            }

            if (isManual) return { manual: true, signal };
            return null;
        } catch (error) {
            this.logger.error(`Scan error (${symbol} - ${timeframe}): ${error.message}`);
            if (isManual) throw error;
            return null;
        }
    }

    async start() {
        const intervalMs = this.getLoopIntervalMs();
        this.logger.info(`📡 Sürekli tarama: her tur bitince ${intervalMs / 1000}s bekleme, sonra tekrar.`);

        while (true) {
            try {
                await this.scanAll();
                await new Promise(resolve => setTimeout(resolve, intervalMs));
            } catch (error) {
                this.logger.error(`Döngü hatası: ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }
}

module.exports = new MarketScanner();
