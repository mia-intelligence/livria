/* ── LIVRIAL — Vue ADV ────────────────────────────────────────── */

let allStops = [];
let activeFilter = 'ALL';
let pendingRowChanges = {}; // { stopId: { field: value, ... } }
let advMap = null;
let pendingAssignId = null;
let pendingDeleteId = null;

// ── Suggestion tournée par code postal ────────────────────────
// Règles appliquées dans l'ordre ; première correspondance gagne.
const TOURNEE_RULES = [
  // Alpes-Maritimes
  { test: cp => cp.startsWith('06'),                                     tournee: 'MARDI T06-T83EST',   vehicule: 'VL' },
  // Bouches-du-Rhône
  { test: cp => cp.startsWith('13'),                                     tournee: 'MERCREDI T13',       vehicule: 'PL' },
  // Var EST : 83400-83999 (Hyères, Fréjus, Saint-Tropez, Sainte-Maxime…)
  { test: cp => cp.startsWith('83') && parseInt(cp) >= 83400,            tournee: 'MARDI T06-T83EST',   vehicule: 'VL' },
  // Var OUEST : 83000-83399 (Toulon, La Seyne, Six-Fours, Ollioules…)
  { test: cp => cp.startsWith('83') && parseInt(cp) < 83400,             tournee: 'VENDREDI T83 OUEST', vehicule: 'PL' },
  // Transporteur (societe_livraison = TRANSPORTEUR)
  { test: () => false, tournee: 'TRANSPORTEUR', vehicule: 'PL' }, // déclenché manuellement
];

function suggestTournee(stop) {
  if (stop.societe_livraison === 'ENLEVEMENT')   return { tournee: 'ENLEVEMENT',   vehicule: 'VL' };
  if (stop.societe_livraison === 'TRANSPORTEUR') return { tournee: 'TRANSPORTEUR', vehicule: 'PL' };

  const match = (stop.adresse || '').match(/\b(\d{5})\b/);
  if (!match) return null;
  const cp = match[1];
  const rule = TOURNEE_RULES.find(r => r.test(cp));
  return rule ? { tournee: rule.tournee, vehicule: rule.vehicule, cp } : null;
}

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
    pendingRowChanges = {};

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

  // Infos magasin
  let magasinLine = '';
  if (s.magasin_valide) {
    const parts = [];
    if (s.nombre_colis) parts.push(`${s.nombre_colis} colis`);
    if (s.emplacement)  parts.push(s.emplacement);
    magasinLine = `<div style="display:inline-flex;align-items:center;gap:5px;margin-top:4px">
      <span style="width:7px;height:7px;border-radius:50%;background:#3DBE7A;flex-shrink:0"></span>
      <span style="font-size:12px;color:#2E8F8F;font-weight:600">Magasin prêt${parts.length ? ' · ' + esc(parts.join(' · ')) : ''}</span>
    </div>`;
  } else if (s.nombre_colis) {
    magasinLine = `<div style="font-size:12px;color:#E8A838;margin-top:4px">⏳ Magasin en cours · ${s.nombre_colis} colis</div>`;
  } else {
    magasinLine = `<div style="font-size:12px;color:var(--ink-mute);margin-top:4px">⏳ En attente de préparation magasin</div>`;
  }

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
        ${magasinLine}
      </div>
      ${!compact ? (s.magasin_valide
        ? `<button class="btn sm primary" onclick="openAssignModal('${s.id}')">Planifier</button>`
        : `<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
             <button class="btn sm primary" onclick="openAssignModal('${s.id}')"
               style="background:var(--warn);border-color:var(--warn)">Planifier</button>
             <span style="font-size:10px;color:var(--warn);white-space:nowrap">⚠ Magasin non prêt</span>
           </div>`
      ) : ''}
    </div>
  `;
}

// ── Assign modal ───────────────────────────────────────────────
function openAssignModal(id) {
  const stop = allStops.find(s => s.id === id);
  if (!stop) return;

  pendingAssignId = id;

  document.getElementById('assign-modal-desc').textContent =
    `${stop.societe} — ${stop.adresse}`;

  // Suggestion automatique si pas encore de tournée
  const suggestion = !stop.tournee ? suggestTournee(stop) : null;
  const tourneeVal  = stop.tournee  || (suggestion ? suggestion.tournee  : '');
  const vehiculeVal = stop.vehicule || (suggestion ? suggestion.vehicule : '');

  document.getElementById('assign-tournee').value  = tourneeVal;
  document.getElementById('assign-vehicule').value = vehiculeVal;

  // Afficher ou masquer le bandeau suggestion
  const badge = document.getElementById('assign-suggestion');
  if (suggestion && !stop.tournee) {
    badge.textContent = `💡 Suggestion basée sur le CP ${suggestion.cp} : ${suggestion.tournee} · ${suggestion.vehicule}`;
    badge.style.display = 'block';
  } else {
    badge.style.display = 'none';
  }

  document.getElementById('assign-error').style.display = 'none';

  document.getElementById('assign-modal').classList.remove('hidden');
}

function closeAssignModal() {
  document.getElementById('assign-modal').classList.add('hidden');
  pendingAssignId = null;
}

async function confirmAssign() {
  if (!pendingAssignId) return;

  const tournee  = document.getElementById('assign-tournee').value;
  const vehicule = document.getElementById('assign-vehicule').value;
  const errEl    = document.getElementById('assign-error');

  errEl.style.display = 'none';

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
    const maxOrdre = allStops
      .filter(s => s.ordre !== 99)
      .reduce((m, s) => Math.max(m, s.ordre || 0), 0);

    const res = await fetch(`/api/stops/${pendingAssignId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ordre: maxOrdre + 1, tournee, vehicule })
    });

    if (!res.ok) throw new Error();

    closeAssignModal();
    await loadStops();
  } catch {
    errEl.textContent = 'Erreur lors de l\'ajout. Réessayez.';
    errEl.style.display = 'block';
  }
}

// ── Supprimer stop ─────────────────────────────────────────────
function openDeleteStopModal(id) {
  const stop = allStops.find(s => s.id === id);
  if (!stop) return;
  pendingDeleteId = id;
  document.getElementById('delete-stop-desc').textContent =
    `${stop.societe} — ${stop.adresse}`;
  document.getElementById('delete-stop-modal').classList.remove('hidden');
}

function closeDeleteStopModal() {
  document.getElementById('delete-stop-modal').classList.add('hidden');
  pendingDeleteId = null;
}

async function confirmDeleteStop() {
  if (!pendingDeleteId) return;
  try {
    const res = await fetch(`/api/stops/${pendingDeleteId}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) throw new Error();
    closeDeleteStopModal();
    await loadStops();
  } catch {
    alert('Erreur lors de la suppression. Réessayez.');
  }
}

// ── Reporter stop ─────────────────────────────────────────────
let pendingReporterId = null;

function openReporterModal(id, currentDate) {
  pendingReporterId = id;
  const stop = allStops.find(s => s.id === id);
  document.getElementById('reporter-modal-desc').textContent = stop ? `${stop.societe} — ${stop.adresse}` : '';
  document.getElementById('reporter-date').value = currentDate || new Date().toISOString().split('T')[0];
  document.getElementById('reporter-error').style.display = 'none';
  document.getElementById('reporter-modal').classList.remove('hidden');
}

function closeReporterModal() {
  document.getElementById('reporter-modal').classList.add('hidden');
  pendingReporterId = null;
}

async function confirmReporter() {
  if (!pendingReporterId) return;
  const newDate = document.getElementById('reporter-date').value;
  const errEl   = document.getElementById('reporter-error');
  errEl.style.display = 'none';

  if (!newDate) {
    errEl.textContent   = 'Sélectionnez une date.';
    errEl.style.display = 'block';
    return;
  }

  try {
    const res = await fetch(`/api/stops/${pendingReporterId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date_tournee: newDate }),
    });
    if (!res.ok) {
      const d = await res.json();
      errEl.textContent   = d.error || 'Erreur serveur';
      errEl.style.display = 'block';
      return;
    }
    closeReporterModal();
    await loadStops();
  } catch {
    errEl.textContent   = 'Erreur réseau. Réessayez.';
    errEl.style.display = 'block';
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
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--ink-mute)">Aucun stop pour ce filtre.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(s => {
    const societeLivraison = s.societe_livraison || 'ATRIAL';

    // Colonne tournée/véhicule — selects inline avec validation manuelle
    const tourneeCell = `
      <div style="display:flex;flex-direction:column;gap:3px">
        <select id="sel-tournee-${s.id}" style="border:1px solid var(--line);border-radius:6px;padding:3px 6px;font:inherit;font-size:11px;color:var(--ink);cursor:pointer;max-width:140px"
          onchange="markRowChange('${s.id}','tournee',this.value)">
          <option value="">— Tournée —</option>
          <option value="ENLEVEMENT"        ${s.tournee==='ENLEVEMENT'         ?'selected':''}>Enlèvement</option>
          <option value="TOURNEE LUNDI"     ${s.tournee==='TOURNEE LUNDI'      ?'selected':''}>Tournée Lundi</option>
          <option value="MARDI T06-T83EST"  ${s.tournee==='MARDI T06-T83EST'   ?'selected':''}>Mardi T06-T83EST</option>
          <option value="MERCREDI T13"      ${s.tournee==='MERCREDI T13'        ?'selected':''}>Mercredi T13</option>
          <option value="TOURNEE JEUDI"     ${s.tournee==='TOURNEE JEUDI'      ?'selected':''}>Tournée Jeudi</option>
          <option value="VENDREDI T83 OUEST"${s.tournee==='VENDREDI T83 OUEST' ?'selected':''}>Vendredi T83 Ouest</option>
          <option value="LIVRAISON CHANTIER"${s.tournee==='LIVRAISON CHANTIER' ?'selected':''}>Livraison Chantier</option>
          <option value="TRANSPORTEUR"      ${s.tournee==='TRANSPORTEUR'        ?'selected':''}>Transporteur</option>
        </select>
        <select id="sel-vehicule-${s.id}" style="border:1px solid var(--line);border-radius:6px;padding:3px 6px;font:inherit;font-size:11px;color:var(--ink);cursor:pointer;max-width:140px"
          onchange="markRowChange('${s.id}','vehicule',this.value)">
          <option value="">— Véhicule —</option>
          <option value="VL" ${s.vehicule==='VL'?'selected':''}>VL — Véhicule léger</option>
          <option value="PL" ${s.vehicule==='PL'?'selected':''}>PL — Poids lourd</option>
        </select>
      </div>`;

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

    // Colonne actions
    const isDirty = !!(pendingRowChanges[s.id] && Object.keys(pendingRowChanges[s.id]).length);
    let actionsCell = '';
    if (s.statut === 'LIVRE') {
      actionsCell = `
        <div style="display:flex;align-items:center;gap:6px">
          <span style="color:var(--success);font-weight:600;font-size:12px">✓ Livré</span>
          ${isDirty ? `<button onclick="saveRowChanges('${s.id}')" style="background:var(--turquoise);color:#fff;border:none;border-radius:8px;padding:4px 10px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">💾 Sauvegarder</button>` : ''}
          <button onclick="openDeleteStopModal('${s.id}')" title="Supprimer"
            style="border:none;background:none;cursor:pointer;color:var(--ink-mute);padding:2px 4px;border-radius:6px"
            onmouseover="this.style.color='var(--danger)'" onmouseout="this.style.color='var(--ink-mute)'">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M9 6V4h6v2" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
          </button>
        </div>`;
    } else {
      actionsCell = `
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          ${isDirty ? `<button onclick="saveRowChanges('${s.id}')" style="background:var(--turquoise);color:#fff;border:none;border-radius:8px;padding:4px 10px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">💾 Sauvegarder</button>` : `
          <select style="border:1px solid var(--line);border-radius:8px;padding:4px 8px;font:inherit;font-size:12px;color:var(--ink);cursor:pointer"
            onchange="changeStopStatus('${s.id}', this.value)">
            <option value="A_LIVRER" ${s.statut === 'A_LIVRER' ? 'selected' : ''}>À livrer</option>
            <option value="EN_COURS" ${s.statut === 'EN_COURS' ? 'selected' : ''}>En cours</option>
            <option value="LIVRE">Livré</option>
          </select>
          <button onclick="changeStopStatus('${s.id}','LIVRE')"
            style="background:var(--success);color:#fff;border:none;border-radius:8px;padding:4px 10px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap"
            title="Marquer comme livré">
            ✓ Livré
          </button>`}
          <button onclick="openDeleteStopModal('${s.id}')" title="Supprimer"
            style="border:none;background:none;cursor:pointer;color:var(--ink-mute);padding:2px 4px;border-radius:6px"
            onmouseover="this.style.color='var(--danger)'" onmouseout="this.style.color='var(--ink-mute)'">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M9 6V4h6v2" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
          </button>
        </div>`;
    }

    const rowStyle = isDirty ? 'background:rgba(75,191,191,.07);outline:2px solid var(--turquoise);outline-offset:-1px;' : '';
    const dateStr = s.date_tournee
      ? new Date(s.date_tournee + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })
      : '—';

    return `
      <tr style="${rowStyle}">
        <td class="strong">${s.ordre ?? '—'}</td>
        <td class="strong">${esc(s.societe)}</td>
        <td class="muted" style="max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.adresse)}</td>
        <td class="muted">${s.numero_affaire ? esc(s.numero_affaire) : '—'}</td>
        <td><span class="type-badge ${societeLivraison.toLowerCase()}">${TYPE_LABEL[societeLivraison] || societeLivraison}</span></td>
        <td class="muted" style="white-space:nowrap">
          ${dateStr}
          <button onclick="openReporterModal('${s.id}','${s.date_tournee || ''}')" title="Reporter" style="border:none;background:none;cursor:pointer;color:var(--ink-mute);padding:1px 3px;border-radius:4px;vertical-align:middle" onmouseover="this.style.color='var(--turquoise)'" onmouseout="this.style.color='var(--ink-mute)'">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/><path d="M16 2v4M8 2v4M3 10h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </td>
        <td>${tourneeCell}</td>
        <td>${magasinCell}</td>
        <td><span class="pill ${STATUS_CLASS[s.statut] || 'todo'}">${STATUS_LABEL[s.statut] || s.statut}</span></td>
        <td>${actionsCell}</td>
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

function markRowChange(id, field, value) {
  if (!pendingRowChanges[id]) pendingRowChanges[id] = {};
  pendingRowChanges[id][field] = value;
  renderTournee();
}

async function saveRowChanges(id) {
  const changes = pendingRowChanges[id];
  if (!changes || !Object.keys(changes).length) return;

  const body = { ...changes };

  // Déduire societe_livraison depuis tournee si changé
  if (changes.tournee !== undefined) {
    if (changes.tournee === 'ENLEVEMENT')        body.societe_livraison = 'ENLEVEMENT';
    else if (changes.tournee === 'TRANSPORTEUR') body.societe_livraison = 'TRANSPORTEUR';
    else if (changes.tournee)                    body.societe_livraison = 'ATRIAL';
  }

  try {
    const res = await fetch(`/api/stops/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error();
    const updated = await res.json();
    const idx = allStops.findIndex(s => s.id === id);
    if (idx !== -1) allStops[idx] = { ...updated, stop_photos: allStops[idx]?.stop_photos || [] };
    delete pendingRowChanges[id];
    renderDashboard();
    renderTournee();
  } catch {
    alert('Erreur lors de la sauvegarde. Réessayez.');
    await loadStops();
  }
}

async function updateStopField(id, field, value) {
  try {
    const body = { [field]: value || null };
    if (field === 'tournee') {
      if (value === 'ENLEVEMENT')   body.societe_livraison = 'ENLEVEMENT';
      else if (value === 'TRANSPORTEUR') body.societe_livraison = 'TRANSPORTEUR';
      else if (value)               body.societe_livraison = 'ATRIAL';
    }
    const res = await fetch(`/api/stops/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error();
    const updated = await res.json();
    const idx = allStops.findIndex(s => s.id === id);
    if (idx !== -1) allStops[idx] = updated;
    renderDashboard();
    renderTournee();
  } catch {
    alert('Erreur lors de la mise à jour. Réessayez.');
    await loadStops();
  }
}

// ── Nouvelle livraison ADV ────────────────────────────────────
function openNewStopModal() {
  document.getElementById('new-stop-modal').classList.remove('hidden');
  document.getElementById('ns-societe').value         = '';
  document.getElementById('ns-adresse').value         = '';
  document.getElementById('ns-telephone').value       = '';
  document.getElementById('ns-affaire').value         = '';
  document.getElementById('ns-type').value            = 'ATRIAL';
  document.getElementById('ns-tournee').value         = '';
  document.getElementById('ns-vehicule').value        = '';
  document.getElementById('ns-type-produit').value    = '';
  document.getElementById('ns-groupe-livraison').value = '';
  document.getElementById('ns-date-tournee').value     = new Date().toISOString().split('T')[0];
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
  const type_produit      = document.getElementById('ns-type-produit').value || null;
  const groupe_livraison  = document.getElementById('ns-groupe-livraison').value.trim() || null;
  const date_tournee      = document.getElementById('ns-date-tournee').value || new Date().toISOString().split('T')[0];
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
        telephone:        telephone       || null,
        numero_affaire:   affaire         || null,
        societe_livraison,
        tournee,
        vehicule,
        type_produit,
        groupe_livraison,
        date_tournee,
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
