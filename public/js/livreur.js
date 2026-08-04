/* ── LIVRIAL — Vue Livreur ─────────────────────────────────── */

let stops = [];
let map = null;
let markerById = {};
let activeStopId = null;
let photoGallery = [];  // photos du stop actif pour le modal
let photoGalleryIndex = 0;
let livreurTab = 'liste';   // 'liste' | 'route'
let routeLoaded = false;

const STATUS_LABEL = { A_LIVRER: 'À livrer', EN_COURS: 'En cours', LIVRE: 'Livré' };
const STATUS_CLASS = { A_LIVRER: 'todo',     EN_COURS: 'now',      LIVRE: 'done' };

// ── Init ──────────────────────────────────────────────────────
async function init() {
  await checkAuth();
  setTodayDate();
  await loadStops();
}

async function checkAuth() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) { window.location.href = '/'; return; }
    const user = await res.json();
    if (user.role !== 'LIVREUR') { window.location.href = '/'; }
  } catch {
    window.location.href = '/';
  }
}

function setTodayDate() {
  const d = new Date();
  document.getElementById('today-date').textContent = d.toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

// ── Load stops ────────────────────────────────────────────────
async function loadStops() {
  try {
    const res = await fetch('/api/stops');
    if (res.status === 401) { window.location.href = '/'; return; }
    stops = await res.json();
    renderStopsList();
    updateSummary();
    renderMap(stops);
  } catch {
    document.getElementById('stops-list').innerHTML =
      '<div style="text-align:center;padding:40px;color:var(--danger)">Erreur de chargement. Actualisez la page.</div>';
  }
}

// ── Onglets Liste / Itinéraire ────────────────────────────────
function switchLivreurTab(tab) {
  livreurTab = tab;
  const isRoute = tab === 'route';

  document.getElementById('lv-tab-liste').classList.toggle('active', !isRoute);
  document.getElementById('lv-tab-route').classList.toggle('active', isRoute);
  document.getElementById('stops-list').style.display = isRoute ? 'none' : 'flex';
  document.getElementById('route-panel').classList.toggle('active', isRoute);

  if (isRoute && !routeLoaded) loadRoute();
}

// ── Feuille de route turn-by-turn ─────────────────────────────
async function loadRoute() {
  const panel = document.getElementById('route-panel');
  panel.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--ink-mute)">Calcul de l\'itinéraire…</div>';

  // Position actuelle si le livreur l'autorise → l'itinéraire démarre de là
  const start = await getCurrentPosition();

  try {
    const date = new Date().toISOString().split('T')[0];
    const qs   = new URLSearchParams({ date });
    if (start) qs.set('start', start);

    const res  = await fetch(`/api/routing/optimize?${qs}`);
    const data = await res.json();

    if (!res.ok) {
      panel.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--danger)">${esc(data.error || 'Impossible de calculer l\'itinéraire.')}</div>`;
      return;
    }
    if (!data.legs || !data.legs.length) {
      panel.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--ink-mute)">${esc(data.message || 'Aucun itinéraire à afficher.')}</div>`;
      return;
    }

    routeLoaded = true;
    renderRoute(data);
  } catch {
    panel.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--danger)">Erreur réseau. Réessayez.</div>';
  }
}

function getCurrentPosition() {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      p => resolve(`${p.coords.latitude},${p.coords.longitude}`),
      () => resolve(null),
      { timeout: 6000, maximumAge: 60000 }
    );
  });
}

function renderRoute(data) {
  const panel = document.getElementById('route-panel');
  const veh   = data.vehicule === 'PL' ? '🚛 Poids lourd' : '🚗 Véhicule léger';

  let html = `
    <div class="route-summary">
      <div class="rs-item">
        <span class="rs-label">Distance totale</span>
        <span class="rs-value">${fmtKm(data.total.distance_m)}</span>
      </div>
      <div class="rs-item">
        <span class="rs-label">Durée estimée</span>
        <span class="rs-value">${fmtDuree(data.total.duree_s)}</span>
      </div>
      <div class="rs-item">
        <span class="rs-label">Véhicule</span>
        <span class="rs-value" style="font-size:14px">${veh}</span>
      </div>
    </div>
    <div style="font-size:12px;color:var(--ink-mute);margin-bottom:12px">
      Départ : ${esc(data.depart)} · touchez une étape pour dérouler les instructions
    </div>`;

  data.legs.forEach((leg, i) => {
    html += `
      <div class="route-leg" id="leg-${i}">
        <div class="route-leg-head" onclick="toggleLeg(${i})">
          <div class="rl-num">${i + 1}</div>
          <div class="rl-body">
            <div class="rl-name">${esc(leg.societe)}</div>
            <div class="rl-meta">${fmtKm(leg.distance_m)} · ${fmtDuree(leg.duree_s)}${leg.adresse ? ' · ' + esc(leg.adresse) : ''}</div>
          </div>
          <div class="rl-chev">›</div>
        </div>
        <div class="route-steps">
          ${leg.steps.length
            ? leg.steps.map(s => `
                <div class="route-step">
                  <span class="rs-icon">${maneuverIcon(s.maneuver)}</span>
                  <span>${esc(s.text)}${s.rue ? `<div class="rs-dist">${esc(s.rue)}</div>` : ''}</span>
                </div>`).join('')
            : '<div class="route-step"><span class="rs-icon">•</span><span>Aucune instruction détaillée pour ce tronçon.</span></div>'}
        </div>
      </div>`;
  });

  panel.innerHTML = html;
}

function toggleLeg(i) {
  document.getElementById(`leg-${i}`)?.classList.toggle('open');
}

// Traduction des manœuvres TomTom en pictos
function maneuverIcon(m) {
  if (!m) return '➡';
  if (m.includes('LEFT'))     return '⬅';
  if (m.includes('RIGHT'))    return '➡';
  if (m.includes('ROUNDABOUT')) return '🔄';
  if (m.includes('UTURN'))    return '↩';
  if (m.includes('ARRIVE'))   return '🏁';
  if (m.includes('DEPART'))   return '🚩';
  if (m.includes('MOTORWAY') || m.includes('FREEWAY')) return '🛣';
  return '⬆';
}

function fmtKm(m) {
  if (!m) return '0 km';
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

function fmtDuree(s) {
  if (!s) return '0 min';
  const h = Math.floor(s / 3600);
  const min = Math.round((s % 3600) / 60);
  return h ? `${h} h ${String(min).padStart(2, '0')}` : `${min} min`;
}

// ── Summary strip ─────────────────────────────────────────────
function updateSummary() {
  const total = stops.length;
  const done  = stops.filter(s => s.statut === 'LIVRE').length;
  document.getElementById('sum-total').innerHTML     = `<em>${total}</em>`;
  document.getElementById('sum-done').innerHTML      = `<em>${done}</em>`;
  document.getElementById('sum-remaining').innerHTML = `<em>${total - done}</em>`;
}

// ── Render stop list ──────────────────────────────────────────
function renderStopsList() {
  const container = document.getElementById('stops-list');

  if (!stops.length) {
    container.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--ink-mute);">Aucun stop prévu aujourd\'hui.</div>';
    return;
  }

  // Grouper visuellement : reference_client en priorité, sinon societe
  const groupCount = {};
  stops.forEach(s => {
    const key = s.reference_client
      ? `ref:${s.reference_client.trim().toLowerCase()}`
      : `soc:${(s.societe || '').trim().toLowerCase()}`;
    groupCount[key] = (groupCount[key] || 0) + 1;
  });

  container.innerHTML = stops.map((s, i) => {
    const sc  = STATUS_CLASS[s.statut] || 'todo';
    const lbl = STATUS_LABEL[s.statut] || s.statut;
    const num = s.ordre ?? (i + 1);

    // Badge type produit (PVC/ALU)
    const typeBadge = s.type_produit
      ? `<span style="display:inline-flex;align-items:center;background:${s.type_produit === 'PVC' ? '#E8F4FD' : '#FDF0E8'};color:${s.type_produit === 'PVC' ? '#1A6FA8' : '#A85A1A'};border-radius:6px;padding:1px 7px;font-size:11px;font-weight:700;margin-left:4px">${esc(s.type_produit)}</span>`
      : '';

    // Indicateur groupe livraison (reference_client ou société)
    const groupKey = s.reference_client
      ? `ref:${s.reference_client.trim().toLowerCase()}`
      : `soc:${(s.societe || '').trim().toLowerCase()}`;
    const isGrouped = (groupCount[groupKey] || 0) > 1;
    const groupBadge = isGrouped
      ? `<span style="display:inline-flex;align-items:center;gap:3px;font-size:11px;color:var(--ink-mute);margin-left:6px">🔗 Livraison groupée</span>`
      : '';

    // Info magasin
    const notReady = s.magasin_valide === false;
    const warning  = notReady
      ? `<div style="margin-top:6px;font-size:11.5px;color:#8A5A12;background:var(--warn-soft);border-radius:8px;padding:3px 10px;display:inline-block;">⏳ En attente de préparation magasin</div>`
      : '';

    const extras = [];
    if (s.nombre_colis) {
      extras.push(`<span style="display:inline-flex;align-items:center;gap:5px;background:var(--turquoise-soft);color:var(--turquoise-dark);border-radius:99px;padding:2px 10px;font-size:11.5px;font-weight:600;">${esc(String(s.nombre_colis))} colis</span>`);
    }
    if (s.emplacement) {
      extras.push(`<span style="font-size:11.5px;color:var(--ink-mute);">${esc(s.emplacement)}</span>`);
    }
    if (s.colis_livres !== null && s.colis_livres !== undefined) {
      const ecart = s.nombre_colis && s.colis_livres !== s.nombre_colis;
      extras.push(`<span style="display:inline-flex;align-items:center;gap:5px;background:${ecart ? 'var(--warn-soft)' : 'var(--status-done-bg)'};color:${ecart ? '#8A5A12' : 'var(--status-done-fg)'};border-radius:99px;padding:2px 10px;font-size:11.5px;font-weight:600;">${ecart ? '⚠ ' : '✓ '}${esc(String(s.colis_livres))} livré${s.colis_livres > 1 ? 's' : ''}</span>`);
    }

    const photos = s.stop_photos || (s.photo_url ? [{ photo_url: s.photo_url }] : []);
    if (photos.length) {
      const label = photos.length === 1 ? 'Photo' : `${photos.length} photos`;
      extras.push(`<button onclick="event.stopPropagation();openPhotoGallery('${s.id}')" style="display:inline-flex;align-items:center;gap:5px;background:var(--canvas);border:1px solid var(--line);border-radius:8px;padding:3px 10px;font:600 11.5px 'Inter',sans-serif;color:var(--ink-soft);cursor:pointer;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="13" r="4" stroke="currentColor" stroke-width="2"/></svg>${label}</button>`);
    }

    if (s.commentaire_magasin) {
      extras.push(`<div style="width:100%;margin-top:2px;font-size:11.5px;color:var(--ink-soft);background:var(--canvas);border-radius:8px;padding:4px 10px;">💬 ${esc(s.commentaire_magasin)}</div>`);
    }

    const magasinSection = (warning || extras.length)
      ? `<div style="margin-top:8px;display:flex;flex-wrap:wrap;align-items:center;gap:6px;">${warning}${extras.join('')}</div>`
      : '';

    return `
    <div class="stop-card" onclick="openSheet('${s.id}')">
      <div class="stop-num ${sc}">${num}</div>
      <div class="stop-info">
        <div class="stop-name">${esc(s.societe)}${typeBadge}${groupBadge}</div>
        <div class="stop-addr">${esc(s.adresse)}</div>
        <div class="stop-meta">
          ${s.numero_affaire ? `N° ${esc(s.numero_affaire)}` : ''}
          ${s.telephone ? ` · <a href="tel:${esc(s.telephone)}" onclick="event.stopPropagation()">${esc(s.telephone)}</a>` : ''}
        </div>
        ${magasinSection}
      </div>
      <div class="stop-status"><span class="pill ${sc}">${lbl}</span></div>
    </div>`;
  }).join('');
}

// ── Carte Leaflet/OSM ─────────────────────────────────────────
function renderMap(stopsData) {
  if (!map) {
    map = L.map('livreur-map', { zoomControl: true, attributionControl: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(map);
  }

  // Supprimer marqueurs existants
  Object.values(markerById).forEach(m => map.removeLayer(m));
  markerById = {};

  const located = stopsData.filter(s => s.latitude && s.longitude);
  if (!located.length) return;

  const bounds = [];

  stopsData.forEach((s, i) => {
    if (!s.latitude || !s.longitude) return;
    const sc    = STATUS_CLASS[s.statut] || 'todo';
    const color = { done: '#3DBE7A', now: '#F2A93B', todo: '#9AA3AD' }[sc];
    const num   = s.ordre ?? (i + 1);

    const icon = L.divIcon({
      className: '',
      html: `<div style="width:28px;height:28px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:12px;font-family:Inter,sans-serif">${num}</div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });

    const m = L.marker([s.latitude, s.longitude], { icon })
      .addTo(map)
      .on('click', () => openSheet(s.id));

    markerById[s.id] = m;
    bounds.push([s.latitude, s.longitude]);
  });

  if (bounds.length > 1) map.fitBounds(bounds, { padding: [40, 40] });
  else if (bounds.length === 1) map.setView(bounds[0], 13);
}

// ── Stop detail sheet ─────────────────────────────────────────
function openSheet(id) {
  const stop = stops.find(s => s.id === id);
  if (!stop) return;
  activeStopId = id;

  document.getElementById('sheet-title').textContent   = stop.societe;
  document.getElementById('sheet-affaire').textContent = stop.numero_affaire ? `Affaire N° ${stop.numero_affaire}` : '';
  document.getElementById('sheet-adresse').textContent = stop.adresse;
  document.getElementById('sheet-tel').innerHTML = stop.telephone
    ? `<a href="tel:${esc(stop.telephone)}">${esc(stop.telephone)}</a>`
    : '—';

  const sc  = STATUS_CLASS[stop.statut] || 'todo';
  const lbl = STATUS_LABEL[stop.statut] || stop.statut;
  document.getElementById('sheet-statut-current').innerHTML = `<span class="pill ${sc}">${lbl}</span>`;

  // Info magasin
  renderMagasinInfo(stop);

  // Checkbox colis
  renderColisConfirm(stop);

  // Phrase à trous « J'ai livré ___ colis »
  renderColisLivres(stop);

  renderStatusActions(stop);

  document.getElementById('sheet-overlay').classList.add('open');
  document.getElementById('stop-sheet').classList.add('open');
}

function closeSheet() {
  document.getElementById('sheet-overlay').classList.remove('open');
  document.getElementById('stop-sheet').classList.remove('open');
  activeStopId = null;
}

function renderMagasinInfo(stop) {
  const container = document.getElementById('sheet-magasin-info');
  const photos = stop.stop_photos || (stop.photo_url ? [{ photo_url: stop.photo_url }] : []);
  const items = [];

  if (stop.nombre_colis) {
    items.push(`<span style="background:var(--turquoise-soft);color:var(--turquoise-dark);border-radius:99px;padding:2px 12px;font-size:12px;font-weight:700;">${stop.nombre_colis} colis</span>`);
  }
  if (stop.emplacement) {
    items.push(`<span style="font-size:12.5px;color:var(--ink-soft);">📍 ${esc(stop.emplacement)}</span>`);
  }
  if (photos.length) {
    const label = photos.length === 1 ? 'Voir la photo' : `Voir les ${photos.length} photos`;
    items.push(`<button onclick="openPhotoGallery('${stop.id}')" style="display:inline-flex;align-items:center;gap:5px;background:var(--canvas);border:1px solid var(--line);border-radius:8px;padding:4px 12px;font:600 12.5px 'Inter',sans-serif;color:var(--ink-soft);cursor:pointer;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="13" r="4" stroke="currentColor" stroke-width="2"/></svg>${label}</button>`);
  }

  if (!items.length && !stop.commentaire_magasin) {
    container.innerHTML = '';
    return;
  }

  let html = '';
  if (items.length) {
    html += `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:${stop.commentaire_magasin ? '10px' : '0'}">${items.join('')}</div>`;
  }
  if (stop.commentaire_magasin) {
    html += `<div style="background:var(--canvas);border-radius:10px;padding:10px 14px;font-size:13px;color:var(--ink-soft);border-left:3px solid var(--turquoise)">💬 ${esc(stop.commentaire_magasin)}</div>`;
  }

  container.innerHTML = `<div style="margin:12px 0">${html}</div>`;
}

function renderColisConfirm(stop) {
  const el = document.getElementById('sheet-colis-confirm');
  const cb = document.getElementById('cb-colis-confirme');

  if (stop.magasin_valide && stop.nombre_colis && stop.statut === 'A_LIVRER') {
    const empText = stop.emplacement ? ` (${stop.emplacement})` : '';
    document.getElementById('cb-colis-label').textContent =
      `J'ai bien pris les ${stop.nombre_colis} colis${empText}`;
    cb.checked = stop.livreur_colis_confirme || false;
    el.style.display = 'block';
  } else {
    el.style.display = 'none';
  }
}

function onColisCheckChange() {
  // Re-render actions to update disabled state
  const stop = stops.find(s => s.id === activeStopId);
  if (stop) renderStatusActions(stop);
}

// ── « J'ai livré ___ colis » ──────────────────────────────────
// Visible dès que la livraison est démarrée. La saisie conditionne le
// passage en LIVRE : c'est elle qui valide la livraison.
function renderColisLivres(stop) {
  const el   = document.getElementById('sheet-colis-livres');
  const inp  = document.getElementById('in-colis-livres');
  const att  = document.getElementById('colis-livres-attendu');
  const prep = document.getElementById('colis-livres-prepare');

  if (stop.statut === 'A_LIVRER') {
    el.style.display = 'none';
    return;
  }

  // Rappel du colissage saisi par le magasin — toujours affiché, y
  // compris quand l'information manque : le livreur doit savoir ce qui
  // était attendu, ou qu'il n'y a rien d'annoncé.
  prep.style.display = 'block';
  if (stop.nombre_colis) {
    const bits = [`<b style="color:var(--turquoise-dark)">${stop.nombre_colis} colis à livrer</b>`];
    if (stop.emplacement) bits.push(esc(stop.emplacement));
    prep.innerHTML = `Annoncé par le magasin : ${bits.join(' · ')}`;
  } else if (stop.emplacement) {
    prep.innerHTML = `Annoncé par le magasin : ${esc(stop.emplacement)} — `
                   + '<span style="color:#8A5A12">nombre de colis non renseigné</span>';
  } else {
    prep.innerHTML = '<span style="color:#8A5A12">⚠ Le magasin n\'a pas renseigné '
                   + 'le nombre de colis pour ce stop.</span>';
  }

  att.textContent = stop.nombre_colis ? ` sur les ${stop.nombre_colis} prévus` : '';
  inp.value = (stop.colis_livres ?? '') === '' ? '' : String(stop.colis_livres);
  el.style.display = 'block';
  renderColisEcart(stop);
}

// Saisie valide = entier >= 0. Conditionne le bouton « Marquer comme livré ».
function colisLivresValue() {
  const inp = document.getElementById('in-colis-livres');
  if (!inp) return null;
  const val = inp.value.trim();
  if (val === '') return null;
  const n = parseInt(val, 10);
  return Number.isNaN(n) || n < 0 ? null : n;
}

function renderColisEcart(stop) {
  const box = document.getElementById('colis-livres-ecart');
  const val = document.getElementById('in-colis-livres').value.trim();

  if (!val || !stop.nombre_colis) { box.style.display = 'none'; return; }

  const n = parseInt(val, 10);
  if (Number.isNaN(n) || n === stop.nombre_colis) { box.style.display = 'none'; return; }

  const diff = stop.nombre_colis - n;
  box.textContent = diff > 0
    ? `⚠ ${diff} colis non livré${diff > 1 ? 's' : ''} sur ${stop.nombre_colis}. Signalez-le à l'ADV.`
    : `⚠ ${-diff} colis de plus que prévu (${stop.nombre_colis} annoncés).`;
  box.style.display = 'block';
}

function onColisLivresInput() {
  const stop = stops.find(s => s.id === activeStopId);
  if (!stop) return;
  renderColisEcart(stop);
  renderStatusActions(stop);   // débloque « Marquer comme livré »
}

// Renvoie true si la livraison peut être clôturée.
async function saveColisLivres(id) {
  const n = colisLivresValue();
  if (n === null) return false;   // le bouton est déjà désactivé dans ce cas

  try {
    const res = await fetch(`/api/stops/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ colis_livres: n }),
    });
    if (!res.ok) throw new Error();
    const stop = stops.find(s => s.id === id);
    if (stop) stop.colis_livres = n;
    return true;
  } catch {
    // Ne pas perdre l'information en silence : le livreur tranche.
    return confirm(
      'Le nombre de colis livrés n\'a pas pu être enregistré (problème réseau ou serveur).\n\n' +
      'Marquer quand même le stop comme livré ?'
    );
  }
}

function renderStatusActions(stop) {
  const container = document.getElementById('status-actions');
  const cbChecked = document.getElementById('cb-colis-confirme')?.checked;
  const needsCheck = stop.magasin_valide && stop.nombre_colis && stop.statut === 'A_LIVRER';

  // La phrase « J'ai livré ___ colis » vaut validation de la livraison :
  // sans nombre saisi, on ne peut pas clôturer le stop.
  const needsColis = stop.statut === 'EN_COURS' && colisLivresValue() === null;
  const requisEl = document.getElementById('colis-livres-requis');
  if (requisEl) requisEl.style.display = needsColis ? 'block' : 'none';

  const transitions = {
    A_LIVRER: [{ statut: 'EN_COURS', label: 'Démarrer la livraison', cls: 'active-now' }],
    EN_COURS: [{ statut: 'LIVRE',    label: 'Marquer comme livré',   cls: 'active-done' },
               { statut: 'A_LIVRER', label: 'Remettre en attente',   cls: '' }],
    LIVRE:    [{ statut: 'A_LIVRER', label: 'Annuler la livraison', cls: '' }],
  };
  const actions = transitions[stop.statut] || [];

  if (!actions.length) return;

  container.innerHTML = actions.map(a => {
    const isStart = a.statut === 'EN_COURS';
    const isDone  = a.statut === 'LIVRE';

    const blockStart = isStart && needsCheck && !cbChecked;
    const blockDone  = isDone  && needsColis;

    const disabled = blockStart || blockDone ? 'disabled' : '';
    let title = '';
    if (blockStart) title = 'Confirmez la prise en charge des colis d\'abord';
    if (blockDone)  title = 'Indiquez le nombre de colis livrés d\'abord';

    return `<button class="status-btn ${a.cls}" onclick="changeStatus('${stop.id}','${a.statut}')" ${disabled} title="${title}">${a.label}</button>`;
  }).join('');
}

async function changeStatus(id, newStatut) {
  const stop = stops.find(s => s.id === id);
  const cb = document.getElementById('cb-colis-confirme');

  // Si on démarre la livraison et checkbox cochée → sauvegarder la confirmation
  if (newStatut === 'EN_COURS' && cb && cb.checked && stop && !stop.livreur_colis_confirme) {
    try {
      await fetch(`/api/stops/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ livreur_colis_confirme: true }),
      });
    } catch { /* non-bloquant */ }
  }

  // Le nombre de colis livrés valide la livraison : il doit être
  // enregistré avant que le stop passe en LIVRE.
  if (newStatut === 'LIVRE') {
    const saved = await saveColisLivres(id);
    if (!saved) return;
  }

  try {
    const res = await fetch(`/api/stops/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ statut: newStatut }),
    });
    if (!res.ok) throw new Error();
    const updated = await res.json();
    const idx = stops.findIndex(s => s.id === id);
    if (idx !== -1) stops[idx] = { ...updated, stop_photos: stops[idx]?.stop_photos || [] };
    renderStopsList();
    updateSummary();
    updateMapMarker(updated);
    routeLoaded = false;   // la tournée a changé → itinéraire à recalculer
    const sc  = STATUS_CLASS[updated.statut] || 'todo';
    const lbl = STATUS_LABEL[updated.statut] || updated.statut;
    document.getElementById('sheet-statut-current').innerHTML = `<span class="pill ${sc}">${lbl}</span>`;
    renderColisConfirm(updated);
    renderColisLivres(updated);
    renderStatusActions(updated);
  } catch {
    alert('Erreur lors de la mise à jour. Réessayez.');
  }
}

function updateMapMarker(stop) {
  if (!map || !markerById[stop.id]) return;
  const sc    = STATUS_CLASS[stop.statut] || 'todo';
  const color = { done: '#3DBE7A', now: '#F2A93B', todo: '#9AA3AD' }[sc];
  const i     = stops.findIndex(s => s.id === stop.id);
  const num   = stop.ordre ?? (i + 1);
  const icon  = L.divIcon({
    className: '',
    html: `<div style="width:28px;height:28px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:12px;font-family:Inter,sans-serif">${num}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
  markerById[stop.id].setIcon(icon);
}

// ── Galerie photos ────────────────────────────────────────────
function openPhotoGallery(id) {
  const stop = stops.find(s => s.id === id);
  if (!stop) return;

  const photos = stop.stop_photos || (stop.photo_url ? [{ photo_url: stop.photo_url }] : []);
  if (!photos.length) return;

  photoGallery = photos;
  photoGalleryIndex = 0;
  renderPhotoGallery();

  if (stop.magasin_valide_at) {
    const expiresAt = new Date(new Date(stop.magasin_valide_at).getTime() + 30 * 24 * 60 * 60 * 1000);
    document.getElementById('photo-notice').textContent =
      `Supprimée automatiquement le ${expiresAt.toLocaleDateString('fr-FR')}`;
  } else {
    document.getElementById('photo-notice').textContent = 'Supprimée automatiquement après 30 jours';
  }

  document.getElementById('photo-overlay').classList.add('open');
  document.getElementById('photo-sheet').classList.add('open');
}

function renderPhotoGallery() {
  const img = document.getElementById('photo-img');
  const nav = document.getElementById('photo-nav');
  const current = photoGallery[photoGalleryIndex];
  if (!current) return;

  img.src = current.photo_url;

  if (photoGallery.length > 1) {
    nav.style.display = 'flex';
    document.getElementById('photo-nav-label').textContent = `${photoGalleryIndex + 1} / ${photoGallery.length}`;
    document.getElementById('photo-prev').disabled = photoGalleryIndex === 0;
    document.getElementById('photo-next').disabled = photoGalleryIndex === photoGallery.length - 1;
  } else {
    nav.style.display = 'none';
  }
}

function photoNavPrev() {
  if (photoGalleryIndex > 0) { photoGalleryIndex--; renderPhotoGallery(); }
}

function photoNavNext() {
  if (photoGalleryIndex < photoGallery.length - 1) { photoGalleryIndex++; renderPhotoGallery(); }
}

function closePhotoModal() {
  document.getElementById('photo-overlay').classList.remove('open');
  document.getElementById('photo-sheet').classList.remove('open');
  document.getElementById('photo-img').src = '';
  photoGallery = [];
  photoGalleryIndex = 0;
}

// Garder l'ancienne fonction pour la compat avec la liste (bouton Photo dans la card)
function openPhotoModal(id) { openPhotoGallery(id); }

// ── Optimiser itinéraire TomTom ───────────────────────────────
async function optimizeRoute() {
  const btn = document.getElementById('btn-optimize');
  btn.disabled = true;
  btn.textContent = 'Calcul en cours…';

  try {
    const date = new Date().toISOString().split('T')[0];
    const res = await fetch('/api/routing/optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date }),
    });
    const data = await res.json();

    if (!res.ok) {
      alert(data.error || 'Erreur lors de l\'optimisation.');
      return;
    }

    if (data.stops && data.stops.length) {
      stops = data.stops;
      renderStopsList();
      updateSummary();
      if (map) { Object.values(markerById).forEach(m => map.removeLayer(m)); markerById = {}; renderMap(stops); }
    }

    // L'ordre a changé → la feuille de route doit être recalculée
    routeLoaded = false;
    if (livreurTab === 'route') loadRoute();

    const veh = data.vehicule === 'PL' ? '🚛 PL' : '🚗 VL';
    btn.textContent = `✓ Optimisé (${veh})`;
    setTimeout(() => {
      btn.textContent = 'Optimiser l\'itinéraire';
      btn.disabled = false;
    }, 3000);
  } catch {
    alert('Erreur réseau. Réessayez.');
    btn.textContent = 'Optimiser l\'itinéraire';
    btn.disabled = false;
  }
}

// ── Auth ──────────────────────────────────────────────────────
async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/';
}

// ── Utils ─────────────────────────────────────────────────────
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Boot ──────────────────────────────────────────────────────
init();
