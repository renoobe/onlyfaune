// Logique pure des mini-jeux (aucun accès réseau / DOM) : validation des réponses du chat,
// génération des indices, duels, lecture du chat Twitch. Utilisé par jeux.html (backoffice).
(function (root) {
    'use strict';

    // ── Texte ──
    const norm = s => String(s ?? '')
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/œ/g, 'oe').replace(/æ/g, 'ae')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

    function levenshtein(a, b) {
        if (a === b) return 0;
        if (!a.length) return b.length;
        if (!b.length) return a.length;
        let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
        for (let i = 1; i <= a.length; i++) {
            const cur = [i];
            for (let j = 1; j <= b.length; j++) {
                cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            }
            prev = cur;
        }
        return prev[b.length];
    }

    // Tolérance aux fautes de frappe selon la longueur du mot.
    const tolerance = len => (len <= 5 ? 0 : len <= 8 ? 1 : 2);

    const STOP = new Set(['grand', 'petit', 'de', 'd', 'du', 'des', 'la', 'le', 'les', 'l', 'a', 'au']);

    // Réponses acceptées pour une espèce : nom complet + 1er mot significatif s'il est unique dans la liste
    // (« canard » suffit pour le Canard colvert, mais « mésange » seul ne suffit pas : il y en a trois).
    function buildAliases(sp, allSpecies) {
        const full = norm(sp.name_fr);
        const aliases = new Set([full]);
        const first = full.split(' ').find(t => !STOP.has(t));
        if (first && first.length >= 3 && first !== full) {
            // Le mot ne doit apparaître dans aucun autre nom (ni en début, ni en qualificatif : « huppe » / « roitelet huppé »).
            const clash = allSpecies.some(o => o.id !== sp.id && norm(o.name_fr).split(' ').includes(first));
            if (!clash) aliases.add(first);
        }
        return [...aliases];
    }

    // Vrai si le message contient l'une des réponses (avec tolérance sur les fautes et les accents).
    function matchesAnswer(message, aliases) {
        const tokens = norm(message).split(' ').filter(Boolean);
        if (!tokens.length) return false;
        for (const alias of aliases) {
            const n = alias.split(' ').length;
            const tol = tolerance(alias.replace(/ /g, '').length);
            for (let i = 0; i + n <= tokens.length; i++) {
                const win = tokens.slice(i, i + n).join(' ');
                if (win === alias || (tol > 0 && levenshtein(win, alias) <= tol)) return true;
            }
        }
        return false;
    }

    // ── Données chiffrées ──
    const num = s => parseFloat(String(s).replace(',', '.'));

    // « 8-15 kg (jusqu'à 20 kg…) » → 11500 (g, milieu de la 1re fourchette). null si illisible.
    function parseWeightG(str) {
        const m = String(str ?? '').match(/(\d+(?:[.,]\d+)?)(?:\s*-\s*(\d+(?:[.,]\d+)?))?\s*(kg|g)\b/i);
        if (!m) return null;
        const a = num(m[1]), b = m[2] ? num(m[2]) : a;
        return ((a + b) / 2) * (m[3].toLowerCase() === 'kg' ? 1000 : 1);
    }

    // « 17-23 cm (+ 3-6 cm de queue) » → 20 (cm, corps seul). null si illisible.
    function parseSizeCm(str) {
        const m = String(str ?? '').match(/(\d+(?:[.,]\d+)?)(?:\s*-\s*(\d+(?:[.,]\d+)?))?\s*(cm|m)\b/i);
        if (!m) return null;
        const a = num(m[1]), b = m[2] ? num(m[2]) : a;
        return ((a + b) / 2) * (m[3].toLowerCase() === 'm' ? 100 : 1);
    }

    const fmtWeight = g => (g >= 1000 ? `≈ ${+(g / 1000).toFixed(1)} kg` : `≈ ${Math.round(g)} g`).replace('.', ',');
    const fmtSize = cm => `≈ ${Math.round(cm)} cm`;

    // ── Indices de la devinette (du plus vague au plus précis) ──
    function maskName(text, name) {
        let out = String(text ?? '');
        const words = norm(name).split(' ').filter(w => w.length >= 4 && !STOP.has(w));
        for (const w of words) {
            // Remplace le mot en ignorant accents/casse, y compris le pluriel.
            const re = new RegExp(`\\b${[...w].map(c => ({ e: '[eéèêë]', a: '[aàâä]', i: '[iîï]', o: '[oôö]', u: '[uùûü]', c: '[cç]' }[c] || c)).join('')}s?\\b`, 'gi');
            out = out.replace(re, '▮▮▮');
        }
        return out;
    }

    const clip = (s, n = 150) => {
        s = String(s).trim();
        if (s.length <= n) return s;
        const cut = s.slice(0, n);
        const dot = cut.lastIndexOf('. ');
        return (dot > 60 ? cut.slice(0, dot + 1) : cut.slice(0, cut.lastIndexOf(' ')) + '…');
    };

    function letterPattern(name) {
        return name.split(' ').map(w => [...w].map((c, i) => (i === 0 ? c.toUpperCase() : '_')).join(' ')).join('   ');
    }

    function buildHints(sp) {
        const cat = sp.category === 'bird' ? 'Un oiseau' : 'Un mammifère';
        const raw = [
            ['Catégorie', cat],
            ['Habitat', sp.habitat],
            ['Régime', sp.diet],
            ['Taille', sp.size],
            ['Poids', sp.weight],
            ['Comportement', sp.behavior],
            ['Groupe', sp.subcategory],
            ['Lettres', letterPattern(sp.name_fr)],
        ];
        return raw.filter(([, v]) => v).map(([label, v]) => ({
            label,
            text: label === 'Lettres' ? v : clip(maskName(v, sp.name_fr)),
        }));
    }

    // ── Duel « plus lourd / plus grand » ──
    // Deux espèces de même catégorie, assez différentes pour que le choix soit jouable.
    function pickDuel(species, criterion, rand = Math.random) {
        const val = sp => (criterion === 'weight' ? parseWeightG(sp.weight) : parseSizeCm(sp.size));
        const pool = species.filter(s => val(s) != null);
        const minRatio = criterion === 'weight' ? 1.4 : 1.2;
        for (let i = 0; i < 300; i++) {
            const a = pool[Math.floor(rand() * pool.length)];
            const b = pool[Math.floor(rand() * pool.length)];
            if (!a || !b || a.id === b.id || a.category !== b.category) continue;
            const r = Math.max(val(a), val(b)) / Math.min(val(a), val(b));
            if (r >= minRatio && r <= 8) return { a, b, va: val(a), vb: val(b) };
        }
        return null;
    }

    // ── Chat Twitch (IRC) ──
    const unescapeTag = v => String(v).replace(/\\(.)/g, (_, c) => ({ s: ' ', ':': ';', r: '', n: '', '\\': '\\' }[c] ?? c));

    // Retourne { login, display, text } pour un message de chat, sinon null.
    function parseIrc(line) {
        let rest = String(line);
        const tags = {};
        if (rest[0] === '@') {
            const sp = rest.indexOf(' ');
            for (const kv of rest.slice(1, sp).split(';')) {
                const eq = kv.indexOf('=');
                tags[kv.slice(0, eq)] = unescapeTag(kv.slice(eq + 1));
            }
            rest = rest.slice(sp + 1);
        }
        const m = rest.match(/^:([^!\s]+)![^\s]* PRIVMSG #[^\s]+ :(.*)$/);
        if (!m) return null;
        return { login: m[1].toLowerCase(), display: tags['display-name'] || m[1], text: m[2] };
    }

    const api = { norm, levenshtein, buildAliases, matchesAnswer, parseWeightG, parseSizeCm, fmtWeight, fmtSize, maskName, buildHints, pickDuel, parseIrc };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.GameCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
