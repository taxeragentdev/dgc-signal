const { Telegraf } = require('telegraf');
const dotenv = require('dotenv');

dotenv.config();

class TelegramManager {
    constructor() {
        this.token = process.env.TELEGRAM_BOT_TOKEN;
        this.chatId = process.env.TELEGRAM_CHAT_ID;
        this.bot = new Telegraf(this.token);

        // Auto-save/Log chatId on first message
        this.bot.start((ctx) => {
            console.log(`👤 New User /start: Name: ${ctx.from.first_name}, ID: ${ctx.chat.id}`);
            
            if (this.chatId && ctx.chat.id.toString() !== this.chatId.toString()) {
                return ctx.reply('⛔ Bu bot özeldir. Sadece yetkili kullanıcı kullanabilir.');
            }

            this.chatId = ctx.chat.id;
            this.sendHelp(ctx);
        });

        this.bot.on('message', async (ctx, next) => {
            if (this.chatId && ctx.chat.id.toString() !== this.chatId.toString()) {
                return; // Ignore messages from others
            }
            await next();
        });

        this.bot.command('help', (ctx) => this.sendHelp(ctx));

        this.bot.command('status', (ctx) => {
            ctx.reply('✅ *Bot Durumu:* Aktif\n📡 *Market:* Hyperliquid\n🔄 *Mod:* 7/24 Sürekli Tarama\n\n_Bot şu an 16+ coini tüm zaman dilimlerinde döngüsel olarak tarıyor. Sinyal kriterleri (Skor > 70) oluştuğunda burada göreceksiniz._', { parse_mode: 'Markdown' });
        });

        this.bot.command('check', async (ctx) => {
            ctx.reply('🧪 *Borsa ve Veri Akışı Test Ediliyor...*', { parse_mode: 'Markdown' });
            try {
                const exchange = require('./exchange');
                const candles = await exchange.fetchOHLCV('BTC/USDC:USDC', '15m', 2);
                const lastPrice = candles[candles.length - 1].close;
                ctx.reply(`✅ *Bağlantı Kuruldu!*\n\n💰 *Anlık BTC:* \`$${lastPrice}\`\n📊 *Durum:* Veriler başarıyla çekiliyor. Bot şu an arka planda sinyal avına devam ediyor.`, { parse_mode: 'Markdown' });
            } catch (error) {
                ctx.reply(`❌ *Borsa Hatası:* ${error.message}`);
            }
        });

        this.bot.command('list', (ctx) => {
            const coins = require('../config/coins');
            ctx.reply(`📊 *Taranan Coinler (Total: ${coins.length})*\n\n\`${coins.join(', ')}\``, { parse_mode: 'Markdown' });
        });

        this.bot.command('scan', async (ctx) => {
            const args = ctx.message.text.split(' ');

            // 🔎 TOPLU TARAMA MODU (Parametresiz)
            if (args.length === 1) {
                ctx.reply('🔎 *Anlık Toplu Market Taraması Başlatıldı...*\nTüm coinler (16+) ve zaman dilimleri (5m-4h) taranıyor.', { parse_mode: 'Markdown' });
                try {
                    const scanner = require('./scanner');
                    await scanner.scanAll();
                    ctx.reply('✅ Toplu tarama tamamlandı. Bulunan sinyaller yukarıda listelendi.');
                } catch (error) {
                    ctx.reply(`❌ *Sistem Hatası:* ${error.message}`, { parse_mode: 'Markdown' });
                }
                return;
            }

            const ticker = args[1].toUpperCase();
            const timeframe = args[2] || '1h';
            const symbol = `${ticker}/USDC:USDC`;

            ctx.reply(`🔍 *${symbol}* için *${timeframe}* analiz başlatıldı...`, { parse_mode: 'Markdown' });

            try {
                const scanner = require('./scanner');
                const signal = await scanner.scanSymbol(symbol, timeframe, true);

                if (signal) {
                    await this.sendSignal(symbol, timeframe, signal);
                } else {
                    ctx.reply(`ℹ️ *${ticker}* (${timeframe}) için şu an net bir sinyal oluşmadı.\nSkor: Belirsiz`, { parse_mode: 'Markdown' });
                }
            } catch (error) {
                ctx.reply(`❌ *Hata:* ${error.message}`, { parse_mode: 'Markdown' });
            }
        });

        this.bot.command('scalp', async (ctx) => {
            ctx.reply('⚡ *Scalp Modu Başlatıldı!* (5m ve 15m taraması yapılıyor...)', { parse_mode: 'Markdown' });
            try {
                const scanner = require('./scanner');
                await scanner.scanAll(['5m', '15m']);
                ctx.reply('✅ Scalp taraması tamamlandı. Sinyal bulunursa yukarıda görünecektir.');
            } catch (error) {
                ctx.reply(`❌ *Hata:* ${error.message}`, { parse_mode: 'Markdown' });
            }
        });

        this.bot.catch((err, ctx) => {
            console.error(`Telegraf error for ${ctx.updateType}`, err);
            ctx.reply(`❌ Beklenmedik bir hata oluştu: ${err.message}`);
        });

        this.bot.launch();
    }

    sendHelp(ctx) {
        let helpMessage = `🔮 *Kripto Sinyal Botu — Kullanım Kılavuzu*\n\n`;
        helpMessage += `Bu bot, Hyperliquid borsasındaki coinleri SMC (Smart Money Concepts) ve teknik indikatörlerle analiz eder.\n\n`;
        helpMessage += `*Komutlar:*\n`;
        helpMessage += `• /scan [COIN] [TF] - Belirli bir coini analiz eder. (Örn: \`/scan BTC 15m\`)\n`;
        helpMessage += `• /scalp - Tüm marketi 5m ve 15m TF'lerde hızlıca tarar.\n`;
        helpMessage += `• /list - Taranan tüm coinleri listeler.\n`;
        helpMessage += `• /status - Botun çalışma durumunu gösterir.\n`;
        helpMessage += `• /help - Bu yardım mesajını gösterir.\n\n`;
        helpMessage += `*Zaman Dilimleri:* 5m, 15m, 30m, 1h, 4h\n\n`;
        helpMessage += `_Not: Bot 7/24 sürekli tarama modundadır, sinyal buldukça otomatik atar._`;

        ctx.reply(helpMessage, { parse_mode: 'Markdown' });
    }

    /**
     * Sends a signal message to the user.
     * @param {string} symbol
     * @param {string} timeframe 
     * @param {Object} signal
     */
    async sendSignal(symbol, timeframe, signal) {
        if (!this.chatId) return;

        const typeEmoji = signal.type === 'LONG' ? '📈' : '📉';
        const color = signal.type === 'LONG' ? 'Yeşil' : 'Kırmızı';

        let message = `🚀 *YENİ SİNYAL — ${signal.type}* ${typeEmoji}\n\n`;
        message += `💎 *Coin:* \`${symbol}\`\n`;
        message += `⏰ *Timeframe:* ${timeframe}\n`;
        message += `📊 *Fiyat:* \`$${signal.price.toFixed(4)}\`\n\n`;

        message += `🛑 *Stop Loss:* \`$${signal.sl.toFixed(4)}\`\n`;
        message += `🎯 *TP1:* \`$${signal.tp[0].toFixed(4)}\`\n`;
        message += `🎯 *TP2:* \`$${signal.tp[1].toFixed(4)}\`\n`;
        message += `🎯 *TP3:* \`$${signal.tp[2].toFixed(4)}\`\n\n`;

        message += `🧠 *Analiz Güveni:* ${signal.score}/100\n`;
        message += `└ RSI: ${signal.indicators.rsi.toFixed(1)}\n`;
        message += `└ Trend: ${signal.trend}\n`;

        // Add SMC context if available
        if (signal.smc.sweep) {
            message += `└ SMC: ✅ Likidite Süpürmesi (${signal.smc.sweep.type})\n`;
        }
        if (signal.smc.fvg) {
            message += `└ SMC: ✅ Fair Value Gap (${signal.smc.fvg.type})\n`;
        }
        if (signal.smc.ob) {
            message += `└ SMC: ✅ Order Block (${signal.smc.ob.type})\n`;
        }

        try {
            await this.bot.telegram.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('Error sending telegram message:', error);
        }
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
