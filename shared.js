// Code commun panel / overlay (viewer Twitch).
// Volontairement sans dépendance externe : pas de CDN, pas de WebSocket, pas de localStorage,
// car l'iframe d'une extension Twitch bloque les scripts externes et limite le stockage.
(function () {
    const SUPABASE_URL = 'https://czdkqsvzvldcjmyqrsxz.supabase.co';
    const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN6ZGtxc3Z6dmxkY2pteXFyc3h6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2ODM2OTYsImV4cCI6MjEwNTI1OTY5Nn0.dmMrP7xtrJx0xB59uEmc8hkoW26IOwfwJC5LVYvxddo';
    const POLL_MS = 5000;

    async function rest(path) {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
            headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
        });
        if (!r.ok) throw new Error(`${r.status} ${path}`);
        return r.json();
    }

    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const OBS_SELECT = '*,species:species_id(name_fr,name_latin,category)';

    const api = {
        esc,
        loadSpecies: () => rest('species?select=*&order=subcategory.asc&order=name_fr.asc').catch(() => []),
        getActive: async () => (await rest('observation_sessions?select=*&is_active=eq.true&order=created_at.desc&limit=1'))[0] || null,
        loadSessionSpecies: async sid => new Set((await rest(`session_species?select=species_id&session_id=eq.${sid}`)).map(d => d.species_id)),
        loadObs: sid => rest(`observations?select=${OBS_SELECT}&session_id=eq.${sid}&order=observed_at.desc`),

        async fetchThumbs(allSpecies) {
            const thumbs = {};
            const entries = allSpecies.filter(s => s.source_url).map(s => {
                const m = s.source_url.match(/\/wiki\/(.+)$/);
                return m ? { id: s.id, title: decodeURIComponent(m[1]) } : null;
            }).filter(Boolean);
            for (let i = 0; i < entries.length; i += 50) {
                const batch = entries.slice(i, i + 50);
                try {
                    const titles = batch.map(e => e.title).join('|');
                    const resp = await fetch(`https://fr.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(titles)}&prop=pageimages&format=json&pithumbsize=250&origin=*`);
                    const json = await resp.json();
                    if (!json.query?.pages) continue;
                    const byTitle = {};
                    for (const p of Object.values(json.query.pages)) if (p.thumbnail) byTitle[p.title.replace(/_/g, ' ')] = p.thumbnail.source;
                    for (const e of batch) {
                        const t = byTitle[e.title.replace(/_/g, ' ')];
                        if (t) thumbs[e.id] = t;
                    }
                } catch { /* miniatures facultatives */ }
            }
            return thumbs;
        },

        // Polling remplaçant Supabase Realtime (WebSocket souvent bloqué dans l'iframe Twitch).
        // app = { onSession(session, speciesIds, obs), onNoSession(), onSessionUpdate(session), onObs(obs, newest) }
        startPolling(app) {
            let session = null;
            let known = new Set();
            let busy = false;

            async function tick() {
                if (busy) return;
                busy = true;
                try {
                    const active = await api.getActive();
                    if (!active) {
                        if (session) { session = null; known = new Set(); app.onNoSession(); }
                    } else if (!session || active.id !== session.id) {
                        session = active;
                        const [ids, obs] = await Promise.all([api.loadSessionSpecies(active.id), api.loadObs(active.id)]);
                        known = new Set(obs.map(o => o.id));
                        app.onSession(active, ids, obs);
                    } else {
                        if (active.latitude !== session.latitude || active.longitude !== session.longitude || active.location_name !== session.location_name) {
                            session = active;
                            app.onSessionUpdate(active);
                        }
                        const obs = await api.loadObs(active.id);
                        const fresh = obs.filter(o => !known.has(o.id));
                        if (fresh.length) {
                            fresh.forEach(o => known.add(o.id));
                            app.onObs(obs, fresh[0]);
                        }
                    }
                } catch (e) { console.warn('poll', e); }
                busy = false;
            }
            tick();
            setInterval(tick, POLL_MS);
        },
    };

    window.OF = api;
})();
