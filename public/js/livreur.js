/* ── LIVRIAL — Vue Livreur ─────────────────────────────────── */

let stops = [];
let map = null;
let markerById = {};
let activeStopId = null;
let photoGallery = [];  // photos du stop actif pour le modal
let photoGalleryIndex = 0;

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

function renderStatusActions(stop) {
  const container = document.getElementById('status-actions');
  const cbChecked = document.getElementById('cb-colis-confirme')?.checked;
  const needsCheck = stop.magasin_valide && stop.nombre_colis && stop.statut === 'A_LIVRER';

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
    const disabled = isStart && needsCheck && !cbChecked ? 'disabled' : '';
    const title = isStart && needsCheck && !cbChecked ? 'Confirmez la prise en charge des colis d\'abord' : '';
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
    const sc  = STATUS_CLASS[updated.statut] || 'todo';
    const lbl = STATUS_LABEL[updated.statut] || updated.statut;
    document.getElementById('sheet-statut-current').innerHTML = `<span class="pill ${sc}">${lbl}</span>`;
    renderColisConfirm(updated);
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
