/**
 * super-saiyan-raichu `src/lib/agents.ts` ile aynı AGENTS_JSON formatı.
 * Örnek: [{"alias":"raichu","apiKey":"...","walletAddress":"0x..."}]
 */

function normalizeAlias(s) {
    return String(s).trim().toLowerCase().replace(/^@/, '');
}

function parseAgentsFromEnv() {
    const raw = process.env.AGENTS_JSON?.trim();
    if (!raw) return [];

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        console.error('[agents] AGENTS_JSON parse hatası:', e.message);
        return [];
    }

    if (!Array.isArray(parsed) || parsed.length === 0) return [];

    const out = [];
    const seen = new Set();
    for (const row of parsed) {
        if (!row || typeof row !== 'object') continue;
        const alias = normalizeAlias(row.alias ?? '');
        const apiKey = String(row.apiKey ?? '').trim();
        if (!alias || !apiKey) continue;
        if (seen.has(alias)) {
            console.error(`[agents] Yinelenen alias: ${alias}`);
            continue;
        }
        seen.add(alias);
        out.push({
            alias,
            apiKey,
            label: row.label != null ? String(row.label).trim() : undefined,
            walletAddress: row.walletAddress != null ? String(row.walletAddress).trim() : undefined,
            /** false ise bu ajan için oto-trade kapalı (varsayılan: açık) */
            autoTrade: row.autoTrade !== false
        });
    }
    return out.sort((a, b) => a.alias.localeCompare(b.alias));
}

module.exports = { parseAgentsFromEnv, normalizeAlias };
