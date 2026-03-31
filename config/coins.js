/**
 * Varsayılan: 7 coin — hızlı tur + HL rate limit ile uyum.
 * SCAN_COINS ile override: "BTC,ETH,SOL" veya tam sembol (BTC/USDC:USDC).
 */

const DEFAULT_COINS = [
    'BTC/USDC:USDC',
    'ETH/USDC:USDC',
    'SOL/USDC:USDC',
    'VIRTUAL/USDC:USDC',
    'HYPE/USDC:USDC',
    'SUI/USDC:USDC',
    'ASTER/USDC:USDC',
];

function normalizePart(s) {
    const t = String(s).trim();
    if (!t) return '';
    return t;
}

function toHlSymbol(part) {
    const p = normalizePart(part);
    if (!p) return '';
    if (p.includes('/')) return p;
    return `${p.toUpperCase()}/USDC:USDC`;
}

function getScanCoins() {
    const raw = process.env.SCAN_COINS?.trim();
    if (!raw) return [...DEFAULT_COINS];
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return [...DEFAULT_COINS];
    return parts.map(toHlSymbol).filter(Boolean);
}

module.exports = { getScanCoins, DEFAULT_COINS };
