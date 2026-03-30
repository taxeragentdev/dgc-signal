const { Telegraf } = require('telegraf');
const dotenv = require('dotenv');
const { suggestMarginLeverage } = require('./riskSizing');
const { toDegenPairName } = require('./hyperliquidMeta');
const { dispatchTradeSignal } = require('./signalBridge');
const { runAutoTradeOnSignal } = require('./autoTrade');

dotenv.config();

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function formatManualEvaluation(ev, ticker, timeframe) {
    const th = ev.threshold;
    if (ev.reason === 'insufficient_candles') {
        return `ℹ️ ${ticker} (${timeframe}): Yeterli mum verisi yok (en az 200 gerekir).`;
    }
    let text = `📊 ${ticker} (${timeframe})\n`;
    text += `Ham skor: ${ev.rawScore.toFixed(0)} (sinyal için eşik: ±${th})\n`;
    text += `RSI: ${ev.rsi != null ? ev.rsi.toFixed(1) : '—'} | Yapı: ${ev.trend || '—'}\n`;
    if (ev.blockedByRsi) {
        text += `⚠️ Skor eşiği geçildi fakat RSI güvenlik filtresi nedeniyle sinyal verilmedi.\n`;
    }
    text += `\nBu sonuç yatırım tavsiyesi değildir; bot sadece kural tabanlı skor üretir.`;
    return text;
}

class TelegramManager {
    constructor() {
        this.token = process.env.TELEGRAM_BOT_TOKEN;
        this.chatId = process.env.TELEGRAM_CHAT_ID
            ? String(process.env.TELEGRAM_CHAT_ID)
            : undefined;
        this.bot = new Telegraf(this.token);

        this.bot.use(async (ctx, next) => {
            if (ctx.chat?.id) {
                const id = ctx.chat.id.toString();
                if (!process.env.TELEGRAM_CHAT_ID) {
                    if (!this.chatId) this.chatId = id;
                } else if (id === String(process.env.TELEGRAM_CHAT_ID)) {
                    this.chatId = id;
                }
            }
            await next();
        });

        this.bot.start((ctx) => {
            console.log(`👤 New User /start: Name: ${ctx.from.first_name}, ID: ${ctx.chat.id}`);

            if (this.chatId && ctx.chat.id.toString() !== this.chatId.toString()) {
                return ctx.reply('⛔ Bu bot özeldir. Sadece yetkili kullanıcı kullanabilir.');
            }

            this.chatId = ctx.chat.id.toString();
            this.sendHelp(ctx);
        });

        this.bot.on('message', async (ctx, next) => {
            if (this.chatId && ctx.chat.id.toString() !== this.chatId.toString()) {
                return;
            }
            await next();
        });

        this.bot.command('help', (ctx) => this.sendHelp(ctx));

        this.bot.command('status', (ctx) => {
            const { getScanTimeframes } = require('./scanConfig');
            const th = process.env.SIGNAL_THRESHOLD || '50';
            const tfs = getScanTimeframes().join(', ');
            const intervalSec = (parseInt(process.env.SCAN_INTERVAL, 10) || 120000) / 1000;
            ctx.reply(
                `✅ Bot çalışıyor (Hyperliquid)\n` +
                `📐 Eşik: ±${th} (SIGNAL_THRESHOLD)\n` +
                `⏱ TF: ${tfs}\n` +
                `🔁 Tur aralığı: ${intervalSec}s (SCAN_INTERVAL)\n\n` +
                `AUTO_TRADE: ${process.env.AUTO_TRADE_ENABLED === 'true' ? 'açık' : 'kapalı'}\n` +
                `/autotrade list — ajan durumu`,
                { parse_mode: undefined }
            );
        });

        this.bot.command('check', async (ctx) => {
            ctx.reply('🧪 Borsa bağlantısı test ediliyor...');
            try {
                const exchange = require('./exchange');
                const candles = await exchange.fetchOHLCV('BTC/USDC:USDC', '15m', 2);
                const lastPrice = candles[candles.length - 1].close;
                const chatOk = this.chatId ? `Sohbet ID bağlı: ${this.chatId}` : 'UYARI: Sohbet ID yok — sinyal gitmez. /start veya TELEGRAM_CHAT_ID.';
                ctx.reply(`✅ Bağlantı tamam.\nBTC ~ $${lastPrice}\n${chatOk}`);
            } catch (error) {
                ctx.reply(`❌ Borsa hatası: ${error.message}`);
            }
        });

        this.bot.command('list', (ctx) => {
            const coins = require('../config/coins');
            ctx.reply(`Taranan coinler (${coins.length}): ${coins.join(', ')}`);
        });

        this.bot.command('scan', async (ctx) => {
            const args = ctx.message.text.split(' ');

            if (args.length === 1) {
                ctx.reply(
                    'Toplu tarama başladı (tüm liste, tüm zaman dilimleri). Birkaç dakika sürebilir; bitince özet gelecek.'
                );
                try {
                    const scanner = require('./scanner');
                    const stats = await scanner.scanAll();
                    const msg =
                        stats.signals > 0
                            ? `Tarama bitti.\n• Taranan parite: ${stats.pairs}\n• Bu turda yeni bildirilen sinyal: ${stats.signals}\n(Sinyaller ayrı mesaj olarak gönderildi.)`
                            : `Tarama bitti.\n• Taranan parite: ${stats.pairs}\n• Bu turda eşik üzeri yeni sinyal yok.\n\nNot: Sinyaller nadirdir; eşiği .env içinde SIGNAL_THRESHOLD ile düşürebilirsiniz (risk artar).`;
                    ctx.reply(msg);
                } catch (error) {
                    ctx.reply(`Hata: ${error.message}`);
                }
                return;
            }

            const ticker = args[1].toUpperCase();
            const timeframe = args[2] || '1h';
            const symbol = `${ticker}/USDC:USDC`;

            ctx.reply(`${symbol} ${timeframe} analiz ediliyor...`);

            try {
                const scanner = require('./scanner');
                const result = await scanner.scanSymbol(symbol, timeframe, true);

                if (result && result.manual) {
                    if (result.signal) {
                        const ok = await this.sendSignal(symbol, timeframe, result.signal);
                        if (!ok) {
                            ctx.reply(
                                'Sinyal üretildi fakat Telegram mesajı gönderilemedi. TELEGRAM_CHAT_ID ve token izinlerini kontrol edin.'
                            );
                        }
                    } else if (result.evaluation) {
                        ctx.reply(formatManualEvaluation(result.evaluation, ticker, timeframe));
                    }
                }
            } catch (error) {
                ctx.reply(`Hata: ${error.message}`);
            }
        });

        this.bot.command('scalp', async (ctx) => {
            ctx.reply('Scalp: 5m ve 15m taraması başladı...');
            try {
                const scanner = require('./scanner');
                const stats = await scanner.scanAll(['5m', '15m']);
                const msg =
                    stats.signals > 0
                        ? `Scalp bitti.\n• Parite: ${stats.pairs}\n• Yeni sinyal bildirimi: ${stats.signals}`
                        : `Scalp bitti.\n• Parite: ${stats.pairs}\n• Bu turda yeni sinyal yok.`;
                ctx.reply(msg);
            } catch (error) {
                ctx.reply(`Hata: ${error.message}`);
            }
        });

        this.bot.command('autotrade', async (ctx) => {
            const { parseAgentsFromEnv } = require('./agents');
            const agentAuto = require('./agentAutoTrade');
            const parts = (ctx.message.text || '').trim().split(/\s+/);
            const sub = (parts[1] || '').toLowerCase();
            const alias = (parts[2] || '').toLowerCase();
            const agents = parseAgentsFromEnv();
            const valid = new Set(agents.map((a) => a.alias));

            if (!agents.length) {
                return ctx.reply('AGENTS_JSON tanımlı değil.');
            }

            if (!sub || sub === 'list') {
                let msg = 'Oto-trade (sinyal → Degen aç):\n';
                for (const a of agents) {
                    const on = agentAuto.isAgentAutoTradeEnabled(a);
                    const tag = a.autoTrade === false ? ' [env: kapalı]' : '';
                    msg += `• ${a.alias}: ${on ? 'AÇIK' : 'KAPALI'}${tag}\n`;
                }
                const dis = agentAuto.getDisabledAliases();
                if (dis.length) {
                    msg += `\nKomutla devre dışı: ${dis.join(', ')}`;
                }
                return ctx.reply(msg);
            }

            if (!alias || !valid.has(alias)) {
                return ctx.reply(
                    'Kullanım:\n/autotrade list\n/autotrade on <alias>\n/autotrade off <alias>'
                );
            }

            const ag = agents.find((x) => x.alias === alias);
            if (sub === 'on') {
                if (ag && ag.autoTrade === false) {
                    return ctx.reply(
                        `${alias} AGENTS_JSON içinde autoTrade:false — önce JSON'u düzenleyin.`
                    );
                }
                agentAuto.setAgentDisabled(alias, false);
                return ctx.reply(`✅ ${alias}: oto-trade açık.`);
            }
            if (sub === 'off') {
                agentAuto.setAgentDisabled(alias, true);
                return ctx.reply(`⛔ ${alias}: oto-trade kapalı (komut). /autotrade on ile açılır.`);
            }
            return ctx.reply(
                'Kullanım:\n/autotrade list\n/autotrade on <alias>\n/autotrade off <alias>'
            );
        });

        this.bot.catch((err, ctx) => {
            console.error(`Telegraf error for ${ctx.updateType}`, err);
            ctx.reply(`Beklenmedik hata: ${err.message}`);
        });
    }

    async launch() {
        await this.bot.launch();
    }

    sendHelp(ctx) {
        const th = process.env.SIGNAL_THRESHOLD || '55';
        const helpMessage =
            `Kripto Sinyal Botu (Hyperliquid)\n\n` +
            `• /scan — Tüm listeyi tarar\n` +
            `• /scan COIN [TF] — Tek coin analizi\n` +
            `• /scalp — 5m + 15m hızlı tarama\n` +
            `• /list — Coin listesi\n` +
            `• /status — Özet\n` +
            `• /check — Borsa + sohbet\n` +
            `• /autotrade list | on <alias> | off <alias> — ajan oto-trade\n` +
            `• /help\n\n` +
            `Sinyal eşiği: ±${th} (SIGNAL_THRESHOLD, varsayılan 50).\n` +
            `Tarama TF: SCAN_TIMEFRAMES (varsayılan 5m,15m,30m,1h — HL'de 10m yok; 4h kapalı).\n` +
            `Tur süresi: SCAN_INTERVAL (varsayılan 120s), parite gecikmesi: SCAN_PAIR_DELAY_MS.\n\n` +
            `Oto-trade: ACP x-api-key + agent cüzdanı; leaderboard RSA anahtarları ayrıdır (join).\n` +
            `Degen: limit + TP + SL birlikte gönderilir. AGENTS_JSON'da autoTrade:false veya /autotrade off.`;
        ctx.reply(helpMessage);
    }

    /**
     * @returns {Promise<boolean>}
     */
    async sendSignal(symbol, timeframe, signal) {
        if (!this.chatId) {
            console.warn('[telegram] chatId yok — sinyal gönderilemedi.');
            return false;
        }

        const sizing = await suggestMarginLeverage(signal.type, signal.price, signal.sl, symbol);
        const notionalStr = String(Math.round(sizing.notionalUsdc));
        const pairForClaw = toDegenPairName(sizing.hlCoin).toUpperCase();

        const capLabel =
            sizing.cappedBy === 'pair'
                ? `hedef ${sizing.targetLeverage}x, HL max ${sizing.pairMaxLeverage}x`
                : `sabit ${sizing.targetLeverage}x`;

        const payload = {
            v: 2,
            ts: Date.now(),
            exchange: 'hyperliquid',
            symbol,
            hlCoin: sizing.hlCoin,
            timeframe,
            side: signal.type,
            entry: signal.price,
            sl: signal.sl,
            tp: signal.tp,
            suggestedMarginUsdc: sizing.marginUsdc,
            suggestedLeverage: sizing.leverage,
            targetLeverage: sizing.targetLeverage,
            notionalUsdc: sizing.notionalUsdc,
            notionalSize: notionalStr,
            pairMaxLeverage: sizing.pairMaxLeverage,
            maxLeverageCapEnv: sizing.maxLeverageCap,
            cappedBy: sizing.cappedBy,
            stopDistancePct: sizing.stopDistancePct,
            score: signal.score,
            degenClaw: {
                jobOfferingName: 'perp_trade',
                serviceRequirements: {
                    action: 'open',
                    pair: pairForClaw,
                    side: signal.type === 'LONG' ? 'long' : 'short',
                    size: notionalStr,
                    leverage: sizing.leverage,
                    orderType: 'limit',
                    limitPrice: String(signal.price),
                    takeProfit: String(signal.tp[0]),
                    stopLoss: String(signal.sl)
                }
            }
        };

        const typeEmoji = signal.type === 'LONG' ? '📈' : '📉';
        const sym = escapeHtml(symbol);
        const tf = escapeHtml(timeframe);

        let message = `<b>YENİ SİNYAL — ${signal.type}</b> ${typeEmoji}\n\n`;
        message += `💎 Coin: <code>${sym}</code>\n`;
        message += `⏰ TF: ${tf}\n`;
        message += `📊 Fiyat: <code>$${escapeHtml(signal.price.toFixed(4))}</code>\n\n`;

        message += `🛑 SL: <code>$${escapeHtml(signal.sl.toFixed(4))}</code>\n`;
        message += `🎯 TP1: <code>$${escapeHtml(signal.tp[0].toFixed(4))}</code>\n`;
        message += `🎯 TP2: <code>$${escapeHtml(signal.tp[1].toFixed(4))}</code>\n`;
        message += `🎯 TP3: <code>$${escapeHtml(signal.tp[2].toFixed(4))}</code>\n\n`;

        message += `💰 Pozisyon (sabit — yatırım tavsiyesi değil):\n`;
        message += `Marjin: <b>${escapeHtml(String(sizing.marginUsdc))}</b> USDC · Kaldıraç: <b>${sizing.leverage}x</b> (hedef ${sizing.targetLeverage}x)\n`;
        message += `Notional (Degen <code>size</code>): <b>${escapeHtml(notionalStr)}</b> USDC (marjin × lev)\n`;
        message += `HL max lev: <b>${sizing.pairMaxLeverage}x</b> · ${escapeHtml(capLabel)}\n`;
        message += `SL mesafesi: ~${sizing.stopDistancePct.toFixed(2)}%\n`;
        if (sizing.note) {
            message += `⚠️ ${escapeHtml(sizing.note)}\n`;
        }
        message += `<i>Gerçek likidasyon borsa kurallarına bağlıdır.</i>\n\n`;

        message += `🧠 Güven skoru: ${escapeHtml(String(signal.score))}/100\n`;
        message += `RSI: ${escapeHtml(signal.indicators.rsi.toFixed(1))}\n`;
        message += `Yapı: ${escapeHtml(String(signal.trend))}\n`;

        if (signal.smc.sweep) {
            message += `SMC: likidite süpürmesi (${escapeHtml(signal.smc.sweep.type)})\n`;
        }
        if (signal.smc.fvg) {
            message += `SMC: FVG (${escapeHtml(signal.smc.fvg.type)})\n`;
        }
        if (signal.smc.ob) {
            message += `SMC: OB (${escapeHtml(signal.smc.ob.type)})\n`;
        }

        const jsonStr = JSON.stringify(payload);
        message += `\n<code>${escapeHtml(jsonStr)}</code>`;

        const notify =
            process.env.AUTO_TRADE_NOTIFY === 'true'
                ? { sendMessage: (msg) => this.sendMessage(msg) }
                : undefined;

        let telegramOk = false;
        try {
            await this.bot.telegram.sendMessage(this.chatId, message, { parse_mode: 'HTML' });
            telegramOk = true;
        } catch (error) {
            console.error('Telegram HTML gönderim hatası, düz metin deneniyor:', error.message);
            try {
                let plain = message.replace(/<b>/g, '').replace(/<\/b>/g, '');
                plain = plain.replace(/<code>/g, '').replace(/<\/code>/g, '');
                plain = plain.replace(/<i>/g, '').replace(/<\/i>/g, '');
                plain = plain.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
                await this.bot.telegram.sendMessage(this.chatId, plain);
                telegramOk = true;
            } catch (e2) {
                console.error('Düz metin de gönderilemedi:', e2.message);
            }
        }

        try {
            await dispatchTradeSignal(payload);
        } catch (e) {
            console.error('[signalBridge]', e.message);
        }

        try {
            await runAutoTradeOnSignal({ signal, sizing, notify });
        } catch (e) {
            console.error('[autoTrade]', e.message);
        }

        return telegramOk;
    }

    async sendMessage(text) {
        if (!this.chatId) return;
        try {
            await this.bot.telegram.sendMessage(this.chatId, text);
        } catch (error) {
            console.error('Error sending message:', error);
        }
    }
}

module.exports = new TelegramManager();
