const exchange = require('./exchange');
const strategy = require('./analysis/strategy');
const telegram = require('./telegram');
const { getScanCoins } = require('../config/coins');
const winston = require('winston');
const { getScanTimeframes, getPairDelayMs } = require('./scanConfig');

class MarketScanner {
    constructor() {
        this.lastSignals = {};
        /** Coin'e göre best signal cache (deduplication için) */
        this.bestSignalPerCoin = {};
        /** Son tamamlanan arka plan turu (heartbeat /status için) */
        this.lastRoundStats = {
            pairs: 0,
            signals: 0,
            finishedAt: 0,
            roundIndex: 0,
            durationMs: 0
        };
        /** Tamamlanan arka plan turu sayısı (sürekli döngü kanıtı) */
        this.roundCount = 0;
        this.scanInProgress = false;
        this._scanChain = Promise.resolve();
        this.logger = winston.createLogger({
            level: 'info',
            format: winston.format.json(),
            transports: [new winston.transports.Console()]
        });
    }

    getLoopIntervalMs() {
        const n = parseInt(process.env.SCAN_INTERVAL, 10);
        /** Varsayılan 30s — tam tur bitince bekleme (SCAN_INTERVAL ile ayarlanır) */
        return Number.isFinite(n) && n > 0 ? n : 30000;
    }

    getLastRoundStats() {
        return this.lastRoundStats;
    }

    isScanInProgress() {
        return this.scanInProgress;
    }

    async scanAll(tfs) {
        const run = () => this._runScanAll(tfs ?? getScanTimeframes());
        const p = this._scanChain.then(run, run);
        this._scanChain = p.catch(() => {});
        return p;
    }

    async _runScanAll(tfs) {
        const t0 = Date.now();
        this.scanInProgress = true;
        this.pairDelayMs = getPairDelayMs();
        const coins = getScanCoins();
        this.logger.info(`Starting market scan for ${coins.length} symbols...`);
        console.log(
            `[scanner] Tur başlıyor · ${coins.length} coin · ${tfs.length} TF · ~${coins.length * tfs.length} adım`
        );

        let pairs = 0;
        let signals = 0;
        this.bestSignalPerCoin = {}; // Reset her tur

        try {
            for (const symbol of coins) {
                for (const tf of tfs) {
                    pairs++;
                    try {
                        const sig = await this.scanSymbol(symbol, tf, false);
                        if (sig) {
                            // Track best signal per coin (highest score)
                            if (!this.bestSignalPerCoin[symbol] || sig.score > this.bestSignalPerCoin[symbol].score) {
                                this.bestSignalPerCoin[symbol] = { ...sig, timeframe: tf };
                            }
                        }
                    } catch (error) {
                        this.logger.error(`Scan error (${symbol} - ${tf}): ${error.message}`);
                    }
                    await new Promise((resolve) => setTimeout(resolve, this.pairDelayMs));
                }
            }

            // Gönder: her coin için best signal (paralel — bir hata tüm turu kesmesin)
            const sendPromises = Object.entries(this.bestSignalPerCoin).map(async ([symbol, bestSig]) => {
                try {
                    const key = bestSig._dedupeKey;
                    if (key && this.lastSignals[key]) return false;

                    delete bestSig._dedupeKey;
                    const sent = await telegram.sendSignal(symbol, bestSig.timeframe, bestSig);
                    if (sent) {
                        if (key) this.lastSignals[key] = true;
                        return true;
                    } else {
                        this.logger.error(`Sinyal Telegram'a iletilemedi (${symbol})`);
                        return false;
                    }
                } catch (e) {
                    this.logger.error(`[sendSignal] ${symbol} hata: ${e.message}`);
                    return false;
                }
            });

            const results = await Promise.allSettled(sendPromises);
            signals = results.filter((r) => r.status === 'fulfilled' && r.value === true).length;
        } finally {
            this.scanInProgress = false;
        }

        const durationMs = Date.now() - t0;
        this.roundCount += 1;
        this.logger.info(`Scan round finished: pairs=${pairs}, newSignals=${signals}`);
        console.log(
            `[scanner] Tur #${this.roundCount} bitti · ${pairs} adım · ${signals} yeni sinyal · ${(durationMs / 1000).toFixed(1)}s`
        );

        this.lastRoundStats = {
            pairs,
            signals,
            finishedAt: Date.now(),
            roundIndex: this.roundCount,
            durationMs
        };
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
                            threshold: strategy.getThreshold(timeframe),
                            reason: 'insufficient_candles'
                        }
                    };
                }
                return null;
            }

            const ev = strategy.evaluate(candles, timeframe);
            const signal = ev.signal;

            if (!signal) {
                if (process.env.SCAN_DEBUG === 'true') {
                    this.logger.info(
                        `[scanner-debug] ${symbol} ${timeframe} rawScore=${ev.rawScore.toFixed(1)} threshold=${ev.threshold} ` +
                        `RSI=${ev.rsi != null ? ev.rsi.toFixed(1) : '—'} trend=${ev.trend || '—'} blockedByRsi=${ev.blockedByRsi} reason=${ev.reason || 'none'}`
                    );
                }
                if (isManual) return { manual: true, evaluation: ev };
                return null;
            }

            const lastCandleTime = candles[candles.length - 1].timestamp;
            const signalKey = `${symbol}_${timeframe}_${signal.type}_${lastCandleTime}`;

            if (this.lastSignals[signalKey]) {
                if (isManual) return { manual: true, signal };
                return null;
            }

            if (isManual) {
                return { manual: true, signal };
            }

            /** Arka plan: Telegram burada değil; tur sonunda coin başına en iyi skor gönderilir */
            signal._dedupeKey = signalKey;
            this.logger.info(`🚨 SIGNAL (tur içi): ${symbol} ${timeframe} ${signal.type} skor=${signal.score}`);
            return signal;
        } catch (error) {
            this.logger.error(`Scan error (${symbol} - ${timeframe}): ${error.message}`);
            if (isManual) throw error;
            return null;
        }
    }

    async start() {
        console.log(
            `[scanner] Sürekli arka plan tarama döngüsü başladı (SCAN_INTERVAL ${this.getLoopIntervalMs() / 1000}s)`
        );
        this.logger.info(
            `📡 Sürekli tarama: tur bitince SCAN_INTERVAL bekleyip tekrar (varsayılan ${this.getLoopIntervalMs() / 1000}s).`
        );

        let consecutiveErrors = 0;
        const maxConsecutiveErrors = 10;

        while (true) {
            try {
                console.log(
                    `\n[scanner] Tur ${this.roundCount + 1} başlıyor...`
                );
                await this.scanAll();
                consecutiveErrors = 0;
                
                const waitMs = this.getLoopIntervalMs();
                console.log(
                    `[scanner] Tur bitti. ${(waitMs / 1000).toFixed(0)}s bekliyorum...\n`
                );
                await new Promise((resolve) => setTimeout(resolve, waitMs));
                console.log(`[scanner] Bekleme bitti, yeni tur başlıyor...`);
            } catch (error) {
                consecutiveErrors++;
                this.logger.error(`Döngü hatası (${consecutiveErrors}/${maxConsecutiveErrors}): ${error.message}`);
                console.error(`[scanner] ERROR: ${error.message}`);

                if (consecutiveErrors >= maxConsecutiveErrors) {
                    this.logger.error(
                        `❌ ${maxConsecutiveErrors} ardışık hata — tarama durmuyor, 30s bekleniyor (sürekli çalışma).`
                    );
                    consecutiveErrors = 0;
                    await new Promise((resolve) => setTimeout(resolve, 30000));
                } else {
                    await new Promise((resolve) => setTimeout(resolve, 5000));
                }
            }
        }
    }
}

module.exports = new MarketScanner();
