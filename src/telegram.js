const { Telegraf } = require('telegraf');
const dotenv = require('dotenv');
const { suggestMarginLeverage } = require('./riskSizing');
const { toDegenPairName } = require('./hyperliquidMeta');
const { dispatchTradeSignal } = require('./signalBridge');
const { runAutoTradeOnSignal } = require('./autoTrade');
const { formatDegenPrice } = require('./hlPriceFormat');

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
        /** 0 = p-timeout anında hata verir; Infinity = pratik süre sınırı yok (Telegraf+p-timeout) */
        this.bot = new Telegraf(this.token, { handlerTimeout: Infinity });

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
            const { getScanCoins } = require('../config/coins');
            const confluence = require('./analysis/confluence');
            const scanner = require('./scanner');
            const th = String(confluence.getThreshold());
            const tfs = getScanTimeframes().join(', ');
            const tfKaynak = process.env.SCAN_TIMEFRAMES?.trim()
                ? 'SCAN_TIMEFRAMES'
                : `SCAN_MODE=${(process.env.SCAN_MODE || 'scalp').trim()}`;
            const intervalSec = (parseInt(process.env.SCAN_INTERVAL, 10) || 30000) / 1000;
            const st = scanner.getLastRoundStats();
            const busy = scanner.isScanInProgress() ? 'evet (API)' : 'hayır';
            const lastTur =
                st.roundIndex > 0
                    ? `#${st.roundIndex} · ${st.pairs} adım · ${st.signals} sinyal · ${Math.round((st.durationMs || 0) / 1000)}s`
                    : 'henüz yok (deploy sonrası ilk tur bekleniyor)';
            const ago =
                st.finishedAt > 0
                    ? `· son tur ~${Math.round((Date.now() - st.finishedAt) / 60000)} dk önce`
                    : '';
            ctx.reply(
                `✅ Bot çalışıyor (Hyperliquid)\n` +
                `📐 Eşik: ±${th} (aktif · env: SIGNAL_THRESHOLD)\n` +
                `🪙 Coin: ${getScanCoins().length} · TF: ${tfs} (${tfKaynak})\n` +
                `🔁 Tur aralığı: ${intervalSec}s (SCAN_INTERVAL)\n` +
                `🔄 Arka plan tarama: sürekli · şu an tarıyor: ${busy}\n` +
                `📡 Son tamamlanan tur: ${lastTur} ${ago}\n\n` +
                `Sinyal yoksa Telegram sessiz kalır; tur yine de işlenir.\n\n` +
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
            const { getScanCoins } = require('../config/coins');
            const coins = getScanCoins();
            ctx.reply(`Taranan coinler (${coins.length}): ${coins.join(', ')}`);
        });

        this.bot.command('scan', async (ctx) => {
            const args = ctx.message.text.split(' ');

            if (args.length === 1) {
                const { getScanCoins } = require('../config/coins');
                const { getScanTimeframes } = require('./scanConfig');
                const coinList = getScanCoins();
                const tfs = getScanTimeframes();
                ctx.reply(
                    `Toplu tarama başladı (${coinList.length} coin × ${tfs.length} TF = ${coinList.length * tfs.length} adım; arka planla aynı TF). Bitince özet gelecek.`
                );
                try {
                    const scanner = require('./scanner');
                    const stats = await scanner.scanAll();
                    const head =
                        `Tarama bitti.\n` +
                        `• Coin: ${coinList.length} · TF: ${tfs.join(', ')}\n` +
                        `• Adım: ${stats.pairs} (her coin için her TF = 1 adım; “hepsi” değil)\n`;
                    const msg =
                        stats.signals > 0
                            ? `${head}• Bu turda yeni bildirilen sinyal: ${stats.signals}\n(Sinyaller ayrı mesaj olarak gönderildi.)`
                            : `${head}• Bu turda eşik üzeri yeni sinyal yok.\n\nNot: Sinyaller nadirdir; eşiği .env içinde SIGNAL_THRESHOLD ile düşürebilirsiniz (risk artar).`;
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
            const { getScanCoins } = require('../config/coins');
            const { getScalpTimeframes } = require('./scanConfig');
            const scalpTfs = getScalpTimeframes();
            const nCoins = getScanCoins().length;
            ctx.reply(
                `Scalp: ${scalpTfs.join(' + ')} (${nCoins} coin × ${scalpTfs.length} TF = ${nCoins * scalpTfs.length} adım)...`
            );
            try {
                const scanner = require('./scanner');
                const stats = await scanner.scanAll(scalpTfs);
                const head =
                    `Scalp bitti.\n` +
                    `• Coin: ${nCoins} · TF: ${scalpTfs.join(', ')}\n` +
                    `• Adım: ${stats.pairs} (coin × TF)\n`;
                const msg =
                    stats.signals > 0
                        ? `${head}• Yeni sinyal bildirimi: ${stats.signals}`
                        : `${head}• Bu turda yeni sinyal yok.`;
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

        this.bot.command('testtrade', async (ctx) => {
            const parts = (ctx.message.text || '').trim().split(/\s+/);
            const aliasArg = (parts[1] || '').toLowerCase();
            ctx.reply('🧪 Test trade (Degen limit+TP+SL) gönderiliyor...');
            try {
                const { runTestTrade } = require('./autoTrade');
                const res = await runTestTrade({ alias: aliasArg || undefined });
                await ctx.reply(res.text);
            } catch (e) {
                await ctx.reply(`Hata: ${e.message}`);
            }
        });

        this.bot.catch((err, ctx) => {
            console.error(`Telegraf error for ${ctx.updateType}`, err);
            ctx.reply(`Beklenmedik hata: ${err.message}`);
        });
    }

    async launch() {
        await this.bot.launch();
        this.startHeartbeat();
    }

    /**
     * Arka plan tarama sürer; sadece özet bilgi (varsayılan 5 dk).
     * STATUS_HEARTBEAT_MS=0 kapatır.
     */
    startHeartbeat() {
        const raw = process.env.STATUS_HEARTBEAT_MS;
        if (raw === '0' || raw === 'false') return;
        const parsed = parseInt(raw, 10);
        const intervalMs =
            raw === undefined || raw === ''
                ? 300000
                : Number.isFinite(parsed) && parsed > 0
                  ? parsed
                  : 300000;

        setInterval(() => {
            try {
                const scanner = require('./scanner');
                const st = scanner.getLastRoundStats();
                if (!this.chatId || !st) return;
                const agoMin =
                    st.finishedAt > 0
                        ? Math.round((Date.now() - st.finishedAt) / 60000)
                        : null;
                const agoStr =
                    agoMin != null ? `${agoMin} dk önce` : 'henüz tam tur yok';
                const msg =
                    `📊 Durum — arka plan tarama çalışıyor (sinyal olsun/olmasın).\n` +
                    `Tur ${st.roundIndex > 0 ? `#${st.roundIndex} · ` : ''}` +
                    `${st.pairs} adım (coin×TF), ${st.signals} yeni sinyal (${agoStr}).`;
                this.sendMessage(msg);
            } catch (e) {
                console.error('[heartbeat]', e.message);
            }
        }, intervalMs);
    }

    sendHelp(ctx) {
        const confluence = require('./analysis/confluence');
        const th = String(confluence.getThreshold());
        const helpMessage =
            `Kripto Sinyal Botu (Hyperliquid)\n\n` +
            `• /scan — SCAN_COINS listesini tarar\n` +
            `• /scan COIN [TF] — Tek coin analizi\n` +
            `• /scalp — 5m+15m tek tur (arka plan zaten aynı TF ile sürekli; SCAN_MODE)\n` +
            `• /scan 5m,15m,30m,1h için SCAN_MODE=full ya da SCAN_TIMEFRAMES=5m,15m,30m,1h\n` +
            `• /list — Coin listesi\n` +
            `• /status — Özet\n` +
            `• /check — Borsa + sohbet\n` +
            `• /autotrade list | on <alias> | off <alias> — ajan oto-trade\n` +
            `• /testtrade [alias] — Degen test (TEST_TRADE_ENABLED=true)\n` +
            `• /help\n\n` +
            `Sinyal eşiği: ±${th} (SIGNAL_THRESHOLD, varsayılan 36). RSI güvenlik: SIGNAL_RSI_FILTER, SIGNAL_RSI_BLOCK_LONG/SHORT.\n` +
            `Arka plan sürekli tarar; sinyal yoksa mesaj atmaz — /status ile tur sayısına bakın.\n` +
            `Coin listesi: SCAN_COINS (virgülle, örn. BTC,ETH,SOL). Varsayılan 7 coin.\n` +
            `Arka plan TF: varsayılan scalp 5m+15m (SCAN_MODE=scalp). Geniş: SCAN_MODE=full veya SCAN_TIMEFRAMES=...\n` +
            `Tur: SCAN_INTERVAL (varsayılan 30s), gecikme: SCAN_PAIR_DELAY_MS (varsayılan 0).\n` +
            `Durum özeti: STATUS_HEARTBEAT_MS=300000 (5 dk), kapat: 0.\n\n` +
            `Railway: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, Replicas=1. Oto-trade: AUTO_TRADE_ENABLED, AGENTS_JSON.\n` +
            `Test: TEST_TRADE_ENABLED=true, isteğe TEST_TRADE_SYMBOL, TEST_TRADE_PCT (SL/TP mesafesi, varsayılan 0.01=%1).\n` +
            `Degen fiyat: BTC/ETH tam sayı tick (DEGEN_INTEGER_PRICE_COINS=BTC,ETH).\n\n` +
            `Oto-trade: ACP x-api-key + agent cüzdanı; leaderboard RSA anahtarları ayrıdır (join).\n` +
            `Degen: limit + TP + SL birlikte gönderilir. AGENTS_JSON'da autoTrade:false veya /autotrade off.`;
        ctx.reply(helpMessage);
    }

    /**
     * @returns {Promise<boolean>}
     */
    async sendSignal(symbol, timeframe, signal) {
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
                    limitPrice: formatDegenPrice(signal.price, sizing.hlCoin),
                    takeProfit: formatDegenPrice(signal.tp[0], sizing.hlCoin),
                    stopLoss: formatDegenPrice(signal.sl, sizing.hlCoin)
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
        if (this.chatId) {
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
        } else {
            console.warn(
                '[telegram] chatId yok — Telegram bildirimi atlandı; bridge + AUTO_TRADE_ENABLED yine çalışır.'
            );
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

        if (this.chatId) return telegramOk;
        return true;
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
