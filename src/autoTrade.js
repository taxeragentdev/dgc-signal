/**
 * Sinyal sonrası: HL'de o coinde pozisyon yoksa Degen Claw perp_trade (limit + TP + SL).
 * super-saiyan AGENTS_JSON + ichimoku ACP gövdesi ile uyumlu.
 */

const { parseAgentsFromEnv, normalizeAlias } = require('./agents');
const { getAcpBaseUrl } = require('./constants');

function degenProvider() {
    return (
        process.env.DEGEN_CLAW_PROVIDER?.trim() ||
        '0xd478a8B40372db16cA8045F28C6FE07228F3781A'
    );
}
const { toDegenPairName, extractHlCoin } = require('./hyperliquidMeta');
const { isAgentAutoTradeEnabled } = require('./agentAutoTrade');
const { suggestMarginLeverage } = require('./riskSizing');

/** Görseldeki gibi limit/TP/SL string — küçük fiyatlar için yeterli basamak */
function formatHlPrice(x) {
    const n = Number(x);
    if (!Number.isFinite(n)) return String(x);
    const a = Math.abs(n);
    if (a >= 1000) return n.toFixed(2);
    if (a >= 1) return n.toFixed(4);
    if (a >= 0.01) return n.toFixed(5);
    return n.toFixed(6);
}

const HL_INFO = 'https://api.hyperliquid.xyz/info';
const COOLDOWN_MS = parseInt(process.env.AUTO_TRADE_COOLDOWN_MS, 10) || 5 * 60 * 1000;

const lastOpenByAgentPair = new Map();

function acpHeaders(apiKey) {
    const h = {
        'Content-Type': 'application/json',
        'x-api-key': apiKey
    };
    const bc = process.env.ACP_BUILDER_CODE?.trim();
    if (bc) h['x-builder-code'] = bc;
    return h;
}

async function fetchAcpWallet(apiKey) {
    const base = getAcpBaseUrl();
    const res = await fetch(`${base}/acp/me`, { headers: acpHeaders(apiKey) });
    if (!res.ok) return null;
    const j = await res.json();
    const w = j?.data?.walletAddress?.trim();
    return w || null;
}

/**
 * @param {string} wallet — HL subaccount / agent cüzdanı
 * @returns {Promise<Set<string>>} açık pozisyon coin isimleri (örn. ARB)
 */
async function fetchOpenPositionCoins(wallet) {
    const res = await fetch(HL_INFO, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'webData2', user: wallet })
    });
    if (!res.ok) {
        throw new Error(`HL webData2 HTTP ${res.status}`);
    }
    const data = await res.json();
    const coins = new Set();
    for (const p of data?.clearinghouseState?.assetPositions ?? []) {
        const pos = p.position ?? {};
        const szi = parseFloat(pos.szi ?? '0');
        if (Math.abs(szi) > 0 && pos.coin) {
            coins.add(String(pos.coin));
        }
    }
    return coins;
}

async function createPerpOpenJob(apiKey, serviceRequirements) {
    const base = getAcpBaseUrl();
    const body = {
        providerWalletAddress: degenProvider(),
        jobOfferingName: 'perp_trade',
        serviceRequirements
    };
    const res = await fetch(`${base}/acp/jobs`, {
        method: 'POST',
        headers: acpHeaders(apiKey),
        body: JSON.stringify(body)
    });
    const text = await res.text();
    let json;
    try {
        json = JSON.parse(text);
    } catch {
        throw new Error(text.slice(0, 400));
    }
    if (!res.ok) {
        throw new Error(JSON.stringify(json).slice(0, 500));
    }
    return json;
}

/**
 * @param {object} opts
 * @param {object} opts.signal — confluence signal
 * @param {object} opts.sizing — riskSizing sonucu
 * @param {{ sendMessage: (s:string)=>Promise<void> }} [opts.notify]
 */
async function runAutoTradeOnSignal(opts) {
    if (process.env.AUTO_TRADE_ENABLED !== 'true') {
        return;
    }

    const agents = parseAgentsFromEnv();
    if (agents.length === 0) {
        console.warn('[autoTrade] AUTO_TRADE_ENABLED ama AGENTS_JSON boş veya yok.');
        return;
    }

    const { signal, sizing } = opts;
    const hlCoin = sizing.hlCoin;
    const pairDegen = toDegenPairName(hlCoin).toUpperCase();
    const side = signal.type === 'LONG' ? 'long' : 'short';
    const notionalStr = String(Math.round(sizing.notionalUsdc));
    const lev = sizing.leverage;

    const serviceRequirements = {
        action: 'open',
        pair: pairDegen,
        side,
        size: notionalStr,
        leverage: lev,
        orderType: 'limit',
        limitPrice: formatHlPrice(signal.price),
        takeProfit: formatHlPrice(signal.tp[0]),
        stopLoss: formatHlPrice(signal.sl)
    };

    const notify = opts.notify;
    const lines = [];

    for (const agent of agents) {
        if (!isAgentAutoTradeEnabled(agent)) {
            lines.push(`[${agent.alias}] oto-trade kapalı (komut veya AGENTS_JSON)`);
            continue;
        }

        const key = `${agent.alias}:${hlCoin}`;
        const last = lastOpenByAgentPair.get(key) || 0;
        if (Date.now() - last < COOLDOWN_MS) {
            lines.push(`[${agent.alias}] ${hlCoin}: cooldown, atlandı`);
            continue;
        }

        let wallet = agent.walletAddress || null;
        if (!wallet) {
            try {
                wallet = await fetchAcpWallet(agent.apiKey);
            } catch (e) {
                lines.push(`[${agent.alias}] /acp/me hata: ${e.message}`);
                continue;
            }
        }
        if (!wallet) {
            lines.push(`[${agent.alias}] cüzdan yok — AGENTS_JSON walletAddress veya ACP key gerekli`);
            continue;
        }

        let openCoins;
        try {
            openCoins = await fetchOpenPositionCoins(wallet);
        } catch (e) {
            lines.push(`[${agent.alias}] HL pozisyon okunamadı: ${e.message}`);
            continue;
        }

        if (openCoins.has(hlCoin)) {
            lines.push(`[${agent.alias}] ${hlCoin}: zaten açık pozisyon, atlandı`);
            continue;
        }

        try {
            const data = await createPerpOpenJob(agent.apiKey, serviceRequirements);
            const jobId = data?.data?.jobId ?? data?.jobId ?? '?';
            lastOpenByAgentPair.set(key, Date.now());
            lines.push(`[${agent.alias}] ${pairDegen} ${side} job #${jobId}`);
        } catch (e) {
            lines.push(`[${agent.alias}] ACP hata: ${e.message}`);
        }
    }

    const summary = lines.join('\n');
    console.log('[autoTrade]\n' + summary);

    if (process.env.AUTO_TRADE_NOTIFY === 'true' && notify && lines.length) {
        try {
            await notify.sendMessage(`🤖 Oto-trade:\n${summary}`);
        } catch (e) {
            console.error('[autoTrade] notify:', e.message);
        }
    }
}

/**
 * Tek seferlik Degen perp_trade (limit + TP + SL) — sinyal beklemeden test.
 * TEST_TRADE_ENABLED=true ve AGENTS_JSON gerekli. Gerçek emir gönderir.
 *
 * @param {{ alias?: string, symbol?: string }} opts
 * @returns {Promise<{ ok: boolean, text: string }>}
 */
async function runTestTrade(opts = {}) {
    const requestedAlias = opts.alias != null ? normalizeAlias(String(opts.alias)) : '';
    const symbolOverride = opts.symbol?.trim();

    if (process.env.TEST_TRADE_ENABLED !== 'true') {
        return {
            ok: false,
            text:
                'Test trade kapalı. Railway’de TEST_TRADE_ENABLED=true yapın (gerçek Degen emri; küçük FIXED_MARGIN_USDC ile deneyin).'
        };
    }

    const agents = parseAgentsFromEnv();
    if (agents.length === 0) {
        return { ok: false, text: 'AGENTS_JSON yok.' };
    }

    let agent;
    if (requestedAlias) {
        agent = agents.find((a) => a.alias === requestedAlias);
        if (!agent) {
            return { ok: false, text: `Ajan yok: ${requestedAlias}. /autotrade list` };
        }
    } else {
        agent = agents[0];
    }

    if (!isAgentAutoTradeEnabled(agent)) {
        return { ok: false, text: `${agent.alias}: oto-trade kapalı.` };
    }

    const symbol =
        symbolOverride ||
        (process.env.TEST_TRADE_SYMBOL && process.env.TEST_TRADE_SYMBOL.trim()) ||
        'BTC/USDC:USDC';

    const hlCoin = extractHlCoin(symbol);
    const pairDegen = toDegenPairName(hlCoin).toUpperCase();

    let wallet = agent.walletAddress || null;
    if (!wallet) {
        try {
            wallet = await fetchAcpWallet(agent.apiKey);
        } catch (e) {
            return { ok: false, text: `[${agent.alias}] /acp/me: ${e.message}` };
        }
    }
    if (!wallet) {
        return { ok: false, text: `[${agent.alias}] cüzdan yok — AGENTS_JSON walletAddress veya geçerli apiKey.` };
    }

    let openCoins;
    try {
        openCoins = await fetchOpenPositionCoins(wallet);
    } catch (e) {
        return { ok: false, text: `HL pozisyon okunamadı: ${e.message}` };
    }

    if (openCoins.has(hlCoin)) {
        return {
            ok: false,
            text: `${hlCoin} için zaten açık pozisyon var — test atlanıyor.`
        };
    }

    const exchange = require('./exchange');
    let candles;
    try {
        candles = await exchange.fetchOHLCV(symbol, '5m', 2);
    } catch (e) {
        return { ok: false, text: `Fiyat alınamadı: ${e.message}` };
    }
    if (!candles || candles.length < 1) {
        return { ok: false, text: 'Yetersiz mum verisi.' };
    }

    const entry = Number(candles[candles.length - 1].close);
    if (!Number.isFinite(entry) || entry <= 0) {
        return { ok: false, text: 'Geçersiz fiyat.' };
    }

    const pctRaw = process.env.TEST_TRADE_PCT?.trim();
    const pctParsed = pctRaw ? parseFloat(pctRaw) : 0.01;
    const pctSafe =
        Number.isFinite(pctParsed) && pctParsed > 0 && pctParsed < 0.5 ? pctParsed : 0.01;

    const sl = entry * (1 - pctSafe);
    const tp0 = entry * (1 + pctSafe);

    const sizing = await suggestMarginLeverage('LONG', entry, sl, symbol);
    const notionalStr = String(Math.round(sizing.notionalUsdc));
    const lev = sizing.leverage;

    const serviceRequirements = {
        action: 'open',
        pair: pairDegen,
        side: 'long',
        size: notionalStr,
        leverage: lev,
        orderType: 'limit',
        limitPrice: formatHlPrice(entry),
        takeProfit: formatHlPrice(tp0),
        stopLoss: formatHlPrice(sl)
    };

    try {
        const data = await createPerpOpenJob(agent.apiKey, serviceRequirements);
        const jobId = data?.data?.jobId ?? data?.jobId ?? '?';
        const text =
            `🧪 Test trade (${agent.alias})\n` +
            `${pairDegen} LONG — limit + TP + SL (aynı job)\n` +
            `Giriş ~${formatHlPrice(entry)} · SL ${formatHlPrice(sl)} · TP ${formatHlPrice(tp0)}\n` +
            `Notional ${notionalStr} USDC · ${lev}x → job #${jobId}`;
        return { ok: true, text };
    } catch (e) {
        return { ok: false, text: `ACP: ${e.message}` };
    }
}

module.exports = {
    runAutoTradeOnSignal,
    fetchOpenPositionCoins,
    fetchAcpWallet,
    runTestTrade
};
