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
            ctx.reply(`🔮 Kripto Sinyal Botu Aktif!\n\nSenin Chat ID: ${ctx.chat.id}\n\nEğer bu ID'yi .env dosyasındaki TELEGRAM_CHAT_ID kısmına yazarsan botu sadece sen kullanabilirsin.\n\n/scan - Anlık tarama yap\n/status - Bot durumunu kontrol et`);
        });

        this.bot.on('message', async (ctx, next) => {
            if (this.chatId && ctx.chat.id.toString() !== this.chatId.toString()) {
                return; // Ignore messages from others
            }
            await next();
        });

        this.bot.command('status', (ctx) => {
            ctx.reply('✅ Bot çalışıyor ve Hyperliquid üzerinden veri tarıyor.');
        });

        this.bot.launch();
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
