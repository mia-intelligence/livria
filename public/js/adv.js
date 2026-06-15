/* ── LIVRIAL — Vue ADV ────────────────────────────────────────── */

let allStops = [];
let activeFilter = 'ALL';
let advMap = null;
let pendingAssignId = null;

const STATUS_LABEL = { A_LIVRER: 'À livrer', EN_COURS: 'En cours', LIVRE: 'Livré' };
const STATUS_CLASS = { A_LIVRER: 'todo', EN_COURS: 'now', LIVRE: 'done' };

const TYPE_COLOR = {
  ATRIAL: '#4BBFBF',
  ENLEVEMENT: '#5B8DB8',
  TRANSPORTEUR: '#E8A838'
};

const TYPE_LABEL = {
  ATRIAL: 'Atrial',
  ENLEVEMENT: 'Enlèvement',
  TRANSPORTEUR: 'Transporteur'
};

// ── Init ───────────────────────────────────────────────────────
async function init() {
  await checkAuth();
  setTopbarDate();
  await loadStops();
}

async function checkAuth() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) {
      window.location.href = '/';
      return;
    }

    const user = await res.json();

    if (!['ADV', 'ADMIN'].includes(user.role)) {
      window.location.href = '/';
      return;
    }

    document.getElementById('user-name').textContent = `${user.prenom} ${user.nom}`;
    document.getElementById('user-av').textContent = (user.prenom[0] + user.nom[0]).toUpperCase();

    const greet = getGreeting();
    document.getElementById('dash-greeting').textContent = `${greet} ${user.prenom} 👋`;
  } catch {
    window.location.href = '/';
  }
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Bonjour';
  if (h < 18) return 'Bon après-midi';
  return 'Bonsoir';
}

function setTopbarDate() {
  const d = new Date();

  document.getElementById('topbar-date').textContent = d.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

// ── Navigation sections ────────────────────────────────────────
const SECTION_TITLES = {
  dashboard: 'Tableau de bord',
  affaires: 'Affaires à planifier',
  tournee: 'Tournée du jour'
};

function showSection(name) {
  document.querySelectorAll('.stops-section').forEach(el => el.classList.remove('active'));
  document.getElementById(`section-${name}`).classList.add('active');

  document.querySelectorAll('#sidebar-nav a').forEach(a => {
    a.classList.toggle('active', a.dataset.section === name);
  });

  document.getElementById('topbar-title').textContent = SECTION_TITLES[name] || name;
}

// ── Load stops ─────────────────────────────────────────────────
async function loadStops() {
  try {
    const res = await fetch('/api/stops');

    if (res.status === 401) {
      window.location.href = '/';
      return;
    }

    if (!res.ok) {
      const errorText = await res.text();
      console.error('Erreur API /api/stops:', res.status, errorText);
      return;
    }

    allStops = await res.json();

    renderDashboard();
    renderAffaires();
    renderTournee();
    renderAdvMap();
  } catch (error) {
    console.error('Erreur chargement stops:', error);
  }
}

// ── Dashboard ──────────────────────────────────────────────────
function renderDashboard() {
  const today = allStops;
  const done = today.filter(s => s.statut === 'LIVRE').length;
  const pending = today.filter(s => s.statut !== 'LIVRE').length;
  const unplanned = today.filter(s => s.ordre === 99).length;
  const pct = today.length ? Math.round((done / today.length) * 100) : 0;

  document.getElementById('kpi-total').textContent = today.length;
  document.getElementById('kpi-done').textContent = done;
  document.getElementById('kpi-done-pct').textContent = `${pct}% de la tournée`;
  document.getElementById('kpi-pending').textContent = pending;
  document.getElementById('kpi-affaires').textContent = unplanned;

  document.getElementById('badge-affaires').textContent = unplanned;

  document.getElementById('dash-lead').textContent =
    `${today.length} stop${today.length > 1 ? 's' : ''} aujourd'hui · ${done} livré${done > 1 ? 's' : ''} · ${pending} en attente`;

  const preview = [...today].slice(0, 5);
  const previewEl = document.getElementById('dash-stops-preview');

  if (!preview.length) {
    previewEl.innerHTML = '<p style="color:var(--ink-mute);font-size:13px;text-align:center;padding:16px 0">Aucun stop aujourd\'hui.</p>';
  } else {
    previewEl.innerHTML = preview.map(s => {
      const societeLivraison = s.societe_livraison || 'ATRIAL';

      return `
        <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--line-soft)">
          <div style="width:26px;height:26px;border-radius:50%;background:${TYPE_COLOR[societeLivraison] || '#9AA3AD'};color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0">${s.ordre ?? '?'}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:13px">${esc(s.societe)}</div>
            <div style="font-size:11.5px;color:var(--ink-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.adresse)}</div>
          </div>
          <span class="pill ${STATUS_CLASS[s.statut] || 'todo'}">${STATUS_LABEL[s.statut] || s.statut}</span>
        </div>
      `;
    }).join('');
  }

  renderAffairesPreview();
}

function renderAffairesPreview() {
  const unplanned = allStops.filter(s => s.ordre === 99).slice(0, 3);
  const el = document.getElementById('dash-affaires-preview');

  if (!unplanned.length) {
    el.innerHTML = '<p style="color:var(--ink-mute);font-size:13px;text-align:center;padding:16px 0">Aucune affaire en attente ✓</p>';
    return;
  }

  el.innerHTML = unplanned.map(s => affaireRowHTML(s, true)).join('');
}

// ── Affaires à planifier ───────────────────────────────────────
function renderAffaires() {
  const unplanned = allStops.filter(s => s.ordre === 99);
  const el = document.getElementById('affaires-list');

  if (!unplanned.length) {
    el.innerHTML = '<p style="color:var(--ink-mute);font-size:13px;text-align:center;padding:32px 0">Aucune affaire en attente — toutes ont été planifiées ✓</p>';
    return;
  }

  el.innerHTML = unplanned.map(s => affaireRowHTML(s, false)).join('');
}

function affaireRowHTML(s, compact) {
  const societeLivraison = s.societe_livraison || 'ATRIAL';

  return `
    <div class="affaire-row">
      <div style="width:10px;height:10px;border-radius:50%;background:${TYPE_COLOR[societeLivraison] || '#9AA3AD'};flex-shrink:0;margin-top:4px"></div>
      <div class="affaire-info">
        <div class="a-name">${esc(s.societe)}</div>
        <div class="a-addr">${esc(s.adresse)}</div>
        <div class="a-meta">
          ${s.numero_affaire ? `N° ${esc(s.numero_affaire)} · ` : ''}
          <span class="type-badge ${societeLivraison.toLowerCase()}">${TYPE_LABEL[societeLivraison] || societeLivraison}</span>
        </div>
      </div>
      ${!compact ? `<button class="btn sm primary" onclick="openAssignModal('${s.id}')">Ajouter à la tournée</button>` : ''}
    </div>
  `;
}

// ── Assign modal ───────────────────────────────────────────────
function openAssignModal(id) {
  const stop = allStops.find(s => s.id === id);
  if (!stop) return;

  pendingAssignId = id;

  document.getElementById('assign-modal-desc').textContent =
    `${stop.societe} — ${stop.adresse} sera ajouté à la tournée du jour avec le statut "À livrer".`;

  document.getElementById('assign-modal').classList.remove('hidden');
}

function closeAssignModal() {
  document.getElementById('assign-modal').classList.add('hidden');
  pendingAssignId = null;
}

async function confirmAssign() {
  if (!pendingAssignId) return;

  try {
    const maxOrdre = allStops
      .filter(s => s.ordre !== 99)
      .reduce((m, s) => Math.max(m, s.ordre || 0), 0);

    const res = await fetch(`/api/stops/${pendingAssignId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ordre: maxOrdre + 1 })
    });

    if (!res.ok) throw new Error();

    closeAssignModal();
    await loadStops();
  } catch {
    alert('Erreur lors de l\'ajout. Réessayez.');
  }
}

// ── Tournée du jour ────────────────────────────────────────────
function setFilter(f) {
  activeFilter = f;

  document.querySelectorAll('.filter-bar .chip').forEach(c => {
    c.classList.toggle('active', c.dataset.filter === f);
  });

  renderTournee();
}

function renderTournee() {
  const filtered = activeFilter === 'ALL'
    ? allStops
    : allStops.filter(s => s.societe_livraison === activeFilter);

  const total = allStops.length;
  const done = allStops.filter(s => s.statut === 'LIVRE').length;

  document.getElementById('tournee-lead').textContent =
    `${total} stop${total > 1 ? 's' : ''} · ${done} livré${done > 1 ? 's' : ''} · Aujourd'hui`;

  const tbody = document.getElementById('tournee-tbody');

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--ink-mute)">Aucun stop pour ce filtre.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(s => {
    const societeLivraison = s.societe_livraison || 'ATRIAL';

    // Colonne magasin
    let magasinCell = '';
    if (s.magasin_valide) {
      const colis = s.nombre_colis ? `${s.nombre_colis} colis` : '';
      const emp   = s.emplacement  ? s.emplacement              : '';
      const info  = [colis, emp].filter(Boolean).join(' · ');
      magasinCell = `<span style="display:inline-flex;align-items:center;gap:5px">
        <span style="width:7px;height:7px;border-radius:50%;background:#3DBE7A;flex-shrink:0"></span>
        <span style="font-size:12px;color:var(--ink-soft)">${esc(info) || 'Prêt'}</span>
      </span>`;
    } else if (s.nombre_colis) {
      magasinCell = `<span style="font-size:12px;color:#E8A838">En cours</span>`;
    } else {
      magasinCell = `<span style="font-size:12px;color:var(--ink-mute)">—</span>`;
    }

    return `
      <tr>
        <td class="strong">${s.ordre ?? '—'}</td>
        <td class="strong">${esc(s.societe)}</td>
        <td class="muted" style="max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.adresse)}</td>
        <td class="muted">${s.numero_affaire ? esc(s.numero_affaire) : '—'}</td>
        <td><span class="type-badge ${societeLivraison.toLowerCase()}">${TYPE_LABEL[societeLivraison] || societeLivraison}</span></td>
        <td>${magasinCell}</td>
        <td><span class="pill ${STATUS_CLASS[s.statut] || 'todo'}">${STATUS_LABEL[s.statut] || s.statut}</span></td>
        <td>
          ${s.statut !== 'LIVRE' ? `
            <select style="border:1px solid var(--line);border-radius:8px;padding:4px 8px;font:inherit;font-size:12px;color:var(--ink);cursor:pointer"
              onchange="changeStopStatus('${s.id}', this.value)">
              <option value="A_LIVRER" ${s.statut === 'A_LIVRER' ? 'selected' : ''}>À livrer</option>
              <option value="EN_COURS" ${s.statut === 'EN_COURS' ? 'selected' : ''}>En cours</option>
              <option value="LIVRE" ${s.statut === 'LIVRE' ? 'selected' : ''}>Livré</option>
            </select>` : '<span style="color:var(--success);font-weight:600;font-size:12px">✓ Livré</span>'}
        </td>
      </tr>
    `;
  }).join('');
}

async function changeStopStatus(id, newStatut) {
  try {
    const res = await fetch(`/api/stops/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ statut: newStatut })
    });

    if (!res.ok) throw new Error();

    const updated = await res.json();
    const idx = allStops.findIndex(s => s.id === id);

    if (idx !== -1) {
      allStops[idx] = updated;
    }

    renderDashboard();
    renderTournee();
    renderAdvMap();
  } catch {
    alert('Erreur lors de la mise à jour.');
    await loadStops();
  }
}

// ── Nouvelle livraison ADV ────────────────────────────────────
function openNewStopModal() {
  document.getElementById('new-stop-modal').classList.remove('hidden');
  document.getElementById('ns-societe').value   = '';
  document.getElementById('ns-adresse').value   = '';
  document.getElementById('ns-telephone').value = '';
  document.getElementById('ns-affaire').value   = '';
  document.getElementById('ns-type').value      = 'ATRIAL';
  document.getElementById('ns-tournee').value   = '';
  document.getElementById('ns-vehicule').value  = '';
  document.getElementById('modal-error').style.display = 'none';
}

function closeNewStopModal() {
  document.getElementById('new-stop-modal').classList.add('hidden');
}

async function createStop() {
  const societe           = document.getElementById('ns-societe').value.trim();
  const adresse           = document.getElementById('ns-adresse').value.trim();
  const telephone         = document.getElementById('ns-telephone').value.trim();
  const affaire           = document.getElementById('ns-affaire').value.trim();
  const societe_livraison = document.getElementById('ns-type').value;
  const tournee           = document.getElementById('ns-tournee').value;
  const vehicule          = document.getElementById('ns-vehicule').value;
  const errEl             = document.getElementById('modal-error');

  errEl.style.display = 'none';

  if (!societe || !adresse) {
    errEl.textContent = 'La société et l\'adresse sont obligatoires.';
    errEl.style.display = 'block';
    return;
  }
  if (!tournee) {
    errEl.textContent = 'La tournée est obligatoire.';
    errEl.style.display = 'block';
    return;
  }
  if (!vehicule) {
    errEl.textContent = 'Le véhicule est obligatoire.';
    errEl.style.display = 'block';
    return;
  }

  try {
    const res = await fetch('/api/stops', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        societe,
        adresse,
        telephone:      telephone || null,
        numero_affaire: affaire   || null,
        societe_livraison,
        tournee,
        vehicule,
      })
    });

    if (!res.ok) {
      const d = await res.json();
      errEl.textContent = d.error || 'Erreur serveur';
      errEl.style.display = 'block';
      return;
    }

    closeNewStopModal();
    await loadStops();
  } catch {
    errEl.textContent = 'Erreur réseau. Réessayez.';
    errEl.style.display = 'block';
  }
}

// ── Leaflet Map ADV ────────────────────────────────────────────
function renderAdvMap() {
  const located = allStops.filter(s => s.latitude && s.longitude);

  const defaultCenter = [43.3, 5.9];
  const defaultZoom   = 10;

  if (!advMap) {
    advMap = L.map('adv-map', { zoomControl: true }).setView(defaultCenter, defaultZoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 18,
    }).addTo(advMap);
  }

  if (window._advMarkers) {
    window._advMarkers.forEach(m => advMap.removeLayer(m));
  }
  window._advMarkers = [];

  if (!located.length) return;

  const bounds = [];

  located.forEach((s, i) => {
    const color = { LIVRE: '#3DBE7A', EN_COURS: '#F2A93B', A_LIVRER: '#9AA3AD' }[s.statut] || '#9AA3AD';
    const label = String(s.ordre ?? i + 1);

    const icon = L.divIcon({
      className: '',
      html: `<div style="width:26px;height:26px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff">${label}</div>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    });

    const m = L.marker([s.latitude, s.longitude], { icon, title: s.societe }).addTo(advMap);
    m.bindPopup(`<b>${s.societe}</b><br>${s.adresse}`);
    window._advMarkers.push(m);
    bounds.push([s.latitude, s.longitude]);
  });

  if (bounds.length > 1) {
    advMap.fitBounds(bounds, { padding: [20, 20] });
  } else if (bounds.length === 1) {
    advMap.setView(bounds[0], 13);
  }
}

// ── Logout ────────────────────────────────────────────────────
async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/';
}

// ── Utils ──────────────────────────────────────────────────────
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Boot ───────────────────────────────────────────────────────
init();
