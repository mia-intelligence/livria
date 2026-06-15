/* ── LIVRIAL — Vue Livreur ─────────────────────────────────── */

let stops = [];
let map = null;
let markers = [];
let activeStopId = null;

const STATUS_LABEL     = { A_LIVRER: 'À livrer', EN_COURS: 'En cours', LIVRE: 'Livré' };
const STATUS_CLASS     = { A_LIVRER: 'todo',     EN_COURS: 'now',      LIVRE: 'done' };

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
    window._stops = stops;
    window._stopsReady = true;
    renderStopsList();
    updateSummary();
    if (window._mapReady) renderMap(stops);
  } catch {
    document.getElementById('stops-list').innerHTML =
      '<div style="text-align:center;padding:40px;color:var(--danger)">Erreur de chargement. Actualisez la page.</div>';
  }
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

  container.innerHTML = stops.map((s, i) => {
    const sc  = STATUS_CLASS[s.statut] || 'todo';
    const lbl = STATUS_LABEL[s.statut] || s.statut;
    const num = s.ordre ?? (i + 1);

    // ── Infos magasin ──
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
    if (s.photo_url) {
      extras.push(`<button onclick="event.stopPropagation();openPhotoModal('${s.id}')" style="display:inline-flex;align-items:center;gap:5px;background:var(--canvas);border:1px solid var(--line);border-radius:8px;padding:3px 10px;font:600 11.5px 'Inter',sans-serif;color:var(--ink-soft);cursor:pointer;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="13" r="4" stroke="currentColor" stroke-width="2"/></svg>Photo</button>`);
    }

    const magasinSection = (warning || extras.length)
      ? `<div style="margin-top:8px;display:flex;flex-wrap:wrap;align-items:center;gap:6px;">${warning}${extras.join('')}</div>`
      : '';

    return `
    <div class="stop-card" onclick="openSheet('${s.id}')">
      <div class="stop-num ${sc}">${num}</div>
      <div class="stop-info">
        <div class="stop-name">${esc(s.societe)}</div>
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

// ── Google Maps ───────────────────────────────────────────────
function renderMap(stopsData) {
  if (!stopsData.length) return;

  const located = stopsData.filter(s => s.latitude && s.longitude);
  const center  = located.length
    ? { lat: located[0].latitude, lng: located[0].longitude }
    : { lat: 43.3, lng: 5.9 };

  map = new google.maps.Map(document.getElementById('livreur-map'), {
    center,
    zoom: 10,
    disableDefaultUI: true,
    zoomControl: true,
    styles: [
      { featureType: 'poi', stylers: [{ visibility: 'off' }] },
      { featureType: 'transit', stylers: [{ visibility: 'off' }] },
    ],
  });

  markers = [];
  const bounds = new google.maps.LatLngBounds();

  stopsData.forEach((s, i) => {
    if (!s.latitude || !s.longitude) return;
    const pos   = { lat: s.latitude, lng: s.longitude };
    bounds.extend(pos);
    const sc    = STATUS_CLASS[s.statut] || 'todo';
    const color = { done: '#3DBE7A', now: '#F2A93B', todo: '#9AA3AD' }[sc];

    const marker = new google.maps.Marker({
      position: pos,
      map,
      label: { text: String(s.ordre ?? (i + 1)), color: '#fff', fontWeight: '700', fontSize: '12px' },
      icon:  { path: google.maps.SymbolPath.CIRCLE, scale: 14, fillColor: color, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
      title: s.societe,
    });

    marker.addListener('click', () => openSheet(s.id));
    markers.push(marker);
  });

  if (located.length > 1) map.fitBounds(bounds, { padding: 40 });
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

  renderStatusActions(stop);

  document.getElementById('sheet-overlay').classList.add('open');
  document.getElementById('stop-sheet').classList.add('open');
}

function closeSheet() {
  document.getElementById('sheet-overlay').classList.remove('open');
  document.getElementById('stop-sheet').classList.remove('open');
  activeStopId = null;
}

function renderStatusActions(stop) {
  const container = document.getElementById('status-actions');
  const transitions = {
    A_LIVRER: [{ statut: 'EN_COURS', label: 'Démarrer la livraison', cls: 'active-now' }],
    EN_COURS: [{ statut: 'LIVRE',    label: 'Marquer comme livré',   cls: 'active-done' },
               { statut: 'A_LIVRER', label: 'Remettre en attente',   cls: '' }],
    LIVRE:    [],
  };
  const actions = transitions[stop.statut] || [];

  if (!actions.length) {
    container.innerHTML = '<p style="text-align:center;color:var(--ink-mute);font-size:13px">Livraison terminée ✓</p>';
    return;
  }

  container.innerHTML = actions.map(a =>
    `<button class="status-btn ${a.cls}" onclick="changeStatus('${stop.id}','${a.statut}')">${a.label}</button>`
  ).join('');
}

async function changeStatus(id, newStatut) {
  try {
    const res = await fetch(`/api/stops/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ statut: newStatut }),
    });
    if (!res.ok) throw new Error();
    const updated = await res.json();
    const idx = stops.findIndex(s => s.id === id);
    if (idx !== -1) stops[idx] = updated;
    renderStopsList();
    updateSummary();
    updateMapMarker(updated);
    const sc  = STATUS_CLASS[updated.statut] || 'todo';
    const lbl = STATUS_LABEL[updated.statut] || updated.statut;
    document.getElementById('sheet-statut-current').innerHTML = `<span class="pill ${sc}">${lbl}</span>`;
    renderStatusActions(updated);
  } catch {
    alert('Erreur lors de la mise à jour. Réessayez.');
  }
}

function updateMapMarker(stop) {
  if (!map) return;
  const i = stops.findIndex(s => s.id === stop.id);
  if (i === -1 || !markers[i]) return;
  const sc    = STATUS_CLASS[stop.statut] || 'todo';
  const color = { done: '#3DBE7A', now: '#F2A93B', todo: '#9AA3AD' }[sc];
  markers[i].setIcon({ path: google.maps.SymbolPath.CIRCLE, scale: 14, fillColor: color, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 });
}

// ── Photo modal ───────────────────────────────────────────────
function openPhotoModal(id) {
  const stop = stops.find(s => s.id === id);
  if (!stop || !stop.photo_url) return;

  document.getElementById('photo-img').src = stop.photo_url;

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

function closePhotoModal() {
  document.getElementById('photo-overlay').classList.remove('open');
  document.getElementById('photo-sheet').classList.remove('open');
  document.getElementById('photo-img').src = '';
}

// ── Utils ─────────────────────────────────────────────────────
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Boot ──────────────────────────────────────────────────────
init();
