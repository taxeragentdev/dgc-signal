const fs = require('fs').promises;
const path = require('path');

/**
 * Otomatik işlem / ichimoku trade-executor uyumu:
 * - AUTO_TRADE_WEBHOOK_URL: POST JSON (payload.v=2, degenClaw.serviceRequirements ≈ perp_trade)
 * - SIGNAL_JSONL_PATH: her satırda aynı JSON (worker ile okunur)
 *
 * Ichimoku: size = notional USDC = sizeUsdc * leverage (telegram-bot.ts)
 */

async function dispatchTradeSignal(payload) {
    const webhook = process.env.AUTO_TRADE_WEBHOOK_URL;
    if (webhook && webhook.startsWith('http')) {
        try {
            const headers = { 'Content-Type': 'application/json' };
            const whSecret = process.env.SIGNAL_WEBHOOK_SECRET?.trim();
            if (whSecret) headers['x-signal-secret'] = whSecret;
            const res = await fetch(webhook, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload)
            });
            if (!res.ok) {
                console.error(`[signalBridge] webhook HTTP ${res.status}`);
            }
        } catch (e) {
            console.error('[signalBridge] webhook hatası:', e.message);
        }
    }

    const jsonl = process.env.SIGNAL_JSONL_PATH;
    if (jsonl) {
        try {
            const line = JSON.stringify(payload) + '\n';
            await fs.appendFile(path.resolve(jsonl), line, 'utf8');
        } catch (e) {
            console.error('[signalBridge] jsonl yazılamadı:', e.message);
        }
    }
}

module.exports = { dispatchTradeSignal };
