// Logique viewer commune à panel.html et overlay.html.
(function () {
    const { esc } = OF;
    const $ = s => document.querySelector(s);
    const isOverlay = !!$('#toggle-btn');

    let session = null;
    let allSpecies = [];
    let sessionIds = new Set();
    let obs = [];
    let thumbs = {};
    let panelMap = null;
    let timerRef = null;
    let panelOpen = false;

    const fmtTime = d => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const getThumb = sp => thumbs[sp.id] || sp.photo_url || null;

    // ── Overlay : bouton d'ouverture ──
    if (isOverlay) {
        $('#toggle-btn').onclick = () => {
            panelOpen = !panelOpen;
            $('#panel').classList.toggle('open', panelOpen);
            $('#toggle-btn').classList.toggle('active', panelOpen);
            $('#toggle-badge').classList.remove('show');
        };
    }

    function showPanel() {
        $('#no-session').style.display = 'none';
        $('#panel-main').style.display = isOverlay ? 'flex' : 'block';
        $('#p-session-name').textContent = session.title;
        $('#p-live-dot').style.display = 'block';
        $('#p-location-name').textContent = session.location_name || 'Non définie';
        renderGuide();
        renderStats();
        startTimer();
        if ($('#tab-carte').classList.contains('active')) initMap();
    }

    function hidePanel() {
        clearInterval(timerRef);
        $('#no-session').style.display = 'block';
        $('#panel-main').style.display = 'none';
        $('#p-live-dot').style.display = 'none';
        $('#p-session-name').textContent = '—';
    }

    function renderGuide() {
        const inSession = allSpecies.filter(s => sessionIds.has(s.id));
        const obsIds = new Set(obs.map(o => o.species_id));
        const grouped = {};
        for (const sp of inSession) (grouped[sp.subcategory || 'Autre'] ||= []).push(sp);

        let html = '';
        for (const [cat, sps] of Object.entries(grouped)) {
            const seen = sps.filter(s => obsIds.has(s.id)).length;
            html += `<div class="cat-title">${esc(cat)} <span class="cat-count">${seen}/${sps.length}</span></div><div class="s-grid">`;
            for (const sp of sps) {
                const isObs = obsIds.has(sp.id);
                const url = getThumb(sp);
                const imgHtml = url
                    ? `<img class="s-thumb" src="${esc(url)}" alt="${esc(sp.name_fr)}" loading="lazy">`
                    : `<div class="s-thumb-ph">${sp.category === 'bird' ? '🐦' : '🦊'}</div>`;
                const last = obs.find(o => o.species_id === sp.id);
                const t = last ? fmtTime(last.observed_at) : '';
                html += `<div class="s-card ${isObs ? 'observed' : 'not-observed'}" data-id="${esc(sp.id)}">${imgHtml}<div class="s-info"><div class="s-name">${esc(sp.name_fr)}</div><div class="s-latin">${esc(sp.name_latin)}</div>${isObs ? `<span class="s-obs-tag">✓ ${t}</span>` : ''}</div></div>`;
            }
            html += '</div>';
        }
        $('#species-container').innerHTML = html;
    }

    function renderStats() {
        const obsIds = new Set(obs.map(o => o.species_id));
        const total = allSpecies.filter(s => sessionIds.has(s.id)).length;
        $('#st-session').textContent = `${obsIds.size}/${total}`;
        $('#st-total').textContent = obs.length;

        const list = $('#recent-list');
        if (!obs.length) { list.innerHTML = '<p style="color:var(--text-dim);font-size:.82rem;">Aucune observation</p>'; return; }
        list.innerHTML = obs.slice(0, 10).map(o =>
            `<div class="recent-item"><span class="r-time">${fmtTime(o.observed_at)}</span><span class="r-dot"></span><span>${esc(o.species?.name_fr || '?')}</span></div>`
        ).join('');
    }

    function startTimer() {
        clearInterval(timerRef);
        const start = new Date(session.started_at).getTime();
        const update = () => {
            const d = Math.max(0, Date.now() - start);
            $('#st-duration').textContent = `${Math.floor(d / 3600000)}h${String(Math.floor((d % 3600000) / 60000)).padStart(2, '0')}`;
        };
        update();
        timerRef = setInterval(update, 30000);
    }

    function showAlert(sp) {
        const url = getThumb(sp);
        const thumb = $('#alert-thumb');
        if (url) { thumb.src = url; thumb.style.display = 'block'; } else thumb.style.display = 'none';
        $('#alert-name').textContent = sp.name_fr;
        $('#alert-latin').textContent = sp.name_latin;
        const el = $('#alert');
        el.classList.add('show');
        clearTimeout(showAlert.t);
        showAlert.t = setTimeout(() => el.classList.remove('show'), 5000);

        if (isOverlay && !panelOpen) {
            const badge = $('#toggle-badge');
            badge.textContent = '!';
            badge.classList.add('show');
        }
        const card = document.querySelector(`.s-card[data-id="${CSS.escape(sp.id)}"]`);
        if (card) { card.classList.add('just-seen'); setTimeout(() => card.classList.remove('just-seen'), 2000); }
    }

    function showDetail(id) {
        const sp = allSpecies.find(s => s.id === id);
        if (!sp) return;
        const url = getThumb(sp);
        const fields = [
            ['Habitat', sp.habitat], ['Taille', sp.size], ['Poids', sp.weight],
            ['Régime', sp.diet], ['Comportement', sp.behavior], ['Statut', sp.conservation_status],
        ].filter(([, v]) => v);
        const src = /^https?:\/\//.test(sp.source_url || '') ? sp.source_url : null;

        $('#detail-content').innerHTML = `
            ${url ? `<img class="detail-img" src="${esc(url)}" alt="${esc(sp.name_fr)}">` : ''}
            <div class="detail-body">
                <h2>${esc(sp.name_fr)}</h2>
                <p class="latin">${esc(sp.name_latin)}</p>
                ${sp.description ? `<p class="desc">${esc(sp.description)}</p>` : ''}
                ${fields.map(([l, v]) => `<p class="field"><strong>${l} :</strong> ${esc(v)}</p>`).join('')}
                ${src ? `<p style="margin-top:8px;"><a href="${esc(src)}" target="_blank" rel="noopener" style="font-size:.8rem;">Wikipédia →</a></p>` : ''}
                <p class="credit">Photo : ${esc(sp.photo_credit || 'Wikimedia Commons')}</p>
            </div>`;
        $('#detail').classList.add('open');
    }

    function initMap() {
        if (typeof L === 'undefined') return;
        if (panelMap) { panelMap.remove(); panelMap = null; }
        const lat = session?.latitude || 46.5;
        const lng = session?.longitude || 2.5;
        panelMap = L.map('panel-map').setView([lat, lng], session?.latitude ? 13 : 6);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OSM' }).addTo(panelMap);
        if (session?.latitude) {
            const popup = document.createElement('span');
            popup.textContent = session.location_name || '📍';
            L.marker([lat, lng]).addTo(panelMap).bindPopup(popup).openPopup();
        }
        setTimeout(() => panelMap && panelMap.invalidateSize(), 200);
    }

    function setupEvents() {
        document.querySelectorAll('.tab').forEach(tab => tab.onclick = () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
            const name = tab.dataset.tab;
            $(`#tab-${name}`)?.classList.add('active');
            if (name === 'carte') setTimeout(initMap, 50);
        });
        document.addEventListener('click', e => {
            const card = e.target.closest('.s-card');
            if (card?.dataset.id) showDetail(card.dataset.id);
        });
        $('#detail-back').onclick = () => $('#detail').classList.remove('open');
    }

    async function init() {
        setupEvents();
        allSpecies = await OF.loadSpecies();
        OF.startPolling({
            onSession(s, ids, o) { session = s; sessionIds = ids; obs = o; showPanel(); },
            onNoSession() { session = null; sessionIds = new Set(); obs = []; hidePanel(); },
            onSessionUpdate(s) {
                session = s;
                $('#p-session-name').textContent = s.title;
                $('#p-location-name').textContent = s.location_name || 'Non définie';
                if ($('#tab-carte').classList.contains('active')) initMap();
            },
            onObs(all, newest) {
                obs = all;
                renderGuide();
                renderStats();
                const sp = allSpecies.find(x => x.id === newest.species_id);
                if (sp) showAlert(sp);
            },
        });
        // Les miniatures arrivent en arrière-plan : ne bloquent plus l'affichage.
        thumbs = await OF.fetchThumbs(allSpecies);
        if (session) renderGuide();
    }

    init();
})();
