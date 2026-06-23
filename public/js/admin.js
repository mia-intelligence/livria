/* ── LIVRIAL — Vue Admin ──────────────────────────────────────── */

let users = [];
let currentUserId = null;
let pendingRevokeId = null;
let pendingResetId = null;
let currentTab = 'users';
let debugStops = [];
let editStopId = null;

// ── Init ───────────────────────────────────────────────────────
async function init() {
  await checkAuth();
  setTopbarDate();
  await loadUsers();
}

async function checkAuth() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) { window.location.href = '/'; return; }
    const user = await res.json();
    if (user.role !== 'ADMIN') { window.location.href = '/'; return; }
    currentUserId = user.id;
    document.getElementById('user-name').textContent = `${user.prenom} ${user.nom}`;
    document.getElementById('user-av').textContent   = (user.prenom[0] + user.nom[0]).toUpperCase();
  } catch {
    window.location.href = '/';
  }
}

function setTopbarDate() {
  document.getElementById('topbar-date').textContent = new Date().toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

// ── Tab navigation ─────────────────────────────────────────────
function switchTab(tab) {
  currentTab = tab;
  ['users','stops','logs','planning'].forEach(t => {
    document.getElementById(`tab-${t}`).style.display = t === tab ? '' : 'none';
  });
  document.querySelectorAll('.sidebar nav a').forEach((el, i) => {
    el.classList.toggle('active', ['users','stops','logs','planning'][i] === tab);
  });

  const titles = { users: 'Utilisateurs', stops: 'Stops (debug)', logs: 'Logs activité', planning: 'Planning des livraisons' };
  document.getElementById('topbar-title').textContent = titles[tab];

  const actionsEl = document.getElementById('topbar-actions');
  if (tab === 'users') {
    actionsEl.innerHTML = `<button class="btn primary" onclick="openCreateModal()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>
      Créer un accès</button>`;
  } else {
    actionsEl.innerHTML = '';
  }

  if (tab === 'logs') loadLogs();
  if (tab === 'stops') {
    const today = new Date().toISOString().slice(0, 10);
    const inp = document.getElementById('debug-date');
    if (!inp.value) { inp.value = today; loadDebugStops(); }
  }
  if (tab === 'planning') initPlanning();
}

// ── Load users ─────────────────────────────────────────────────
async function loadUsers() {
  try {
    const res = await fetch('/api/users');
    if (res.status === 401 || res.status === 403) { window.location.href = '/'; return; }
    users = await res.json();
    renderUsers();
  } catch {
    showFeedback('Erreur lors du chargement des utilisateurs.', 'danger');
  }
}

// ── Render users table ─────────────────────────────────────────
function renderUsers() {
  const total   = users.length;
  const actifs  = users.filter(u => u.actif).length;
  const revoked = total - actifs;
  document.getElementById('users-lead').textContent =
    `${total} compte${total > 1 ? 's' : ''} · ${actifs} actif${actifs > 1 ? 's' : ''} · ${revoked} révoqué${revoked > 1 ? 's' : ''}`;

  const tbody = document.getElementById('users-tbody');
  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--ink-mute)">Aucun utilisateur.</td></tr>';
    return;
  }

  tbody.innerHTML = users.map(u => `
    <tr>
      <td>
        <div style="display:flex;align-items:center;gap:10px">
          <div class="av" style="${u.actif ? '' : 'background:#D1D5DB;'}">${initials(u)}</div>
          <div><div class="strong">${esc(u.prenom)} ${esc(u.nom)}</div></div>
        </div>
      </td>
      <td class="muted">${esc(u.email)}</td>
      <td><span class="role-badge ${u.role}">${u.role}</span></td>
      <td>
        ${u.actif
          ? '<span class="user-actif">● Actif</span>'
          : '<span class="user-revoked">● Révoqué</span>'}
      </td>
      <td class="muted">${u.last_login ? formatDate(u.last_login) : 'Jamais connecté'}</td>
      <td>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <button class="btn sm" onclick="openResetPwdModal('${u.id}')">🔑 Mot de passe</button>
          ${u.actif
            ? `<button class="btn sm danger" onclick="openRevokeModal('${u.id}')" ${u.id === currentUserId ? 'disabled title="Impossible de révoquer votre propre compte"' : ''}>Révoquer</button>`
            : `<button class="btn sm" style="color:var(--success);border-color:var(--success)" onclick="reactivate('${u.id}')">Réactiver</button>`}
        </div>
      </td>
    </tr>
    <tr class="history-row">
      <td colspan="6">
        Compte créé le ${formatDate(u.created_at)}
        ${u.last_login ? ` · Dernière connexion : ${formatDate(u.last_login)}` : ''}
      </td>
    </tr>
  `).join('');
}

// ── Create user ────────────────────────────────────────────────
function openCreateModal() {
  ['cu-prenom','cu-nom','cu-email','cu-password'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('cu-role').value = 'LIVREUR';
  document.getElementById('create-error').style.display = 'none';
  document.getElementById('create-modal').classList.remove('hidden');
}
function closeCreateModal() {
  document.getElementById('create-modal').classList.add('hidden');
}

async function createUser() {
  const prenom   = document.getElementById('cu-prenom').value.trim();
  const nom      = document.getElementById('cu-nom').value.trim();
  const email    = document.getElementById('cu-email').value.trim();
  const role     = document.getElementById('cu-role').value;
  const password = document.getElementById('cu-password').value;
  const errEl    = document.getElementById('create-error');
  errEl.style.display = 'none';

  if (!prenom || !nom || !email || !password) {
    errEl.textContent = 'Tous les champs marqués * sont obligatoires.';
    errEl.style.display = 'block'; return;
  }
  if (password.length < 8) {
    errEl.textContent = 'Le mot de passe doit contenir au moins 8 caractères.';
    errEl.style.display = 'block'; return;
  }

  try {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prenom, nom, email, role, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || 'Erreur serveur';
      errEl.style.display = 'block'; return;
    }
    closeCreateModal();
    showFeedback(`Accès créé pour ${prenom} ${nom} (${role}).`, 'success');
    await loadUsers();
  } catch {
    errEl.textContent = 'Erreur réseau. Réessayez.';
    errEl.style.display = 'block';
  }
}

// ── Reset mot de passe ─────────────────────────────────────────
function openResetPwdModal(id) {
  const user = users.find(u => u.id === id);
  if (!user) return;
  pendingResetId = id;
  document.getElementById('reset-pwd-desc').textContent =
    `${user.prenom} ${user.nom} (${user.email})`;
  document.getElementById('reset-pwd-input').value = '';
  document.getElementById('reset-pwd-error').style.display = 'none';
  document.getElementById('reset-pwd-modal').classList.remove('hidden');
}
function closeResetPwdModal() {
  document.getElementById('reset-pwd-modal').classList.add('hidden');
  pendingResetId = null;
}

async function confirmResetPwd() {
  if (!pendingResetId) return;
  const password = document.getElementById('reset-pwd-input').value;
  const errEl = document.getElementById('reset-pwd-error');
  errEl.style.display = 'none';

  if (!password || password.length < 8) {
    errEl.textContent = 'Mot de passe trop court (min. 8 caractères).';
    errEl.style.display = 'block'; return;
  }

  try {
    const res = await fetch(`/api/users/${pendingResetId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || 'Erreur serveur';
      errEl.style.display = 'block'; return;
    }
    const user = users.find(u => u.id === pendingResetId);
    closeResetPwdModal();
    showFeedback(`Mot de passe de ${user?.prenom} ${user?.nom} réinitialisé. Communiquez le nouveau mot de passe à l'utilisateur.`, 'success');
  } catch {
    errEl.textContent = 'Erreur réseau. Réessayez.';
    errEl.style.display = 'block';
  }
}

// ── Revoke user ────────────────────────────────────────────────
function openRevokeModal(id) {
  const user = users.find(u => u.id === id);
  if (!user) return;
  pendingRevokeId = id;
  document.getElementById('revoke-desc').textContent =
    `${user.prenom} ${user.nom} (${user.email}) — ${user.role}`;
  document.getElementById('revoke-modal').classList.remove('hidden');
}
function closeRevokeModal() {
  document.getElementById('revoke-modal').classList.add('hidden');
  pendingRevokeId = null;
}
async function confirmRevoke() {
  if (!pendingRevokeId) return;
  await setUserActive(pendingRevokeId, false);
  closeRevokeModal();
}

async function reactivate(id) {
  const user = users.find(u => u.id === id);
  if (!confirm(`Réactiver le compte de ${user?.prenom} ${user?.nom} ?`)) return;
  await setUserActive(id, true);
}

async function setUserActive(id, actif) {
  try {
    const res = await fetch(`/api/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actif }),
    });
    if (!res.ok) {
      const d = await res.json();
      showFeedback(d.error || 'Erreur serveur', 'danger'); return;
    }
    const user = users.find(u => u.id === id);
    const action = actif ? 'réactivé' : 'révoqué';
    showFeedback(`Compte de ${user?.prenom} ${user?.nom} ${action}.`, actif ? 'success' : 'danger');
    await loadUsers();
  } catch {
    showFeedback('Erreur réseau. Réessayez.', 'danger');
  }
}

// ── Debug stops ────────────────────────────────────────────────
async function loadDebugStops() {
  const date = document.getElementById('debug-date').value;
  if (!date) return;
  document.getElementById('stops-debug-lead').textContent = `Chargement…`;
  try {
    const res = await fetch(`/api/stops?date=${date}`);
    if (!res.ok) { showFeedback('Erreur chargement stops', 'danger'); return; }
    debugStops = await res.json();
    renderDebugStops(date);
  } catch {
    showFeedback('Erreur réseau', 'danger');
  }
}

function renderDebugStops(date) {
  document.getElementById('stops-debug-lead').textContent =
    `${debugStops.length} stop${debugStops.length > 1 ? 's' : ''} — ${date}`;
  const tbody = document.getElementById('stops-debug-tbody');
  if (!debugStops.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--ink-mute)">Aucun stop ce jour.</td></tr>';
    return;
  }
  tbody.innerHTML = debugStops.map((s, i) => `
    <tr>
      <td class="muted">${i + 1}</td>
      <td><b>${esc(s.societe)}</b></td>
      <td class="muted">${esc(s.numero_affaire || '—')}</td>
      <td>${s.type_produit ? `<span class="type-badge ${s.type_produit.toLowerCase()}">${s.type_produit}</span>` : '—'}</td>
      <td class="muted">${s.date_tournee ? s.date_tournee.slice(0,10) : '—'}</td>
      <td class="muted">${esc(s.tournee || '—')}</td>
      <td><span class="statut-badge ${s.statut}">${labelStatut(s.statut)}</span></td>
      <td>${s.magasin_valide ? '✅' : '—'}</td>
      <td><button class="btn sm" onclick="openEditStop('${s.id}')">✏️ Modifier</button></td>
    </tr>
  `).join('');
}

function openEditStop(id) {
  const s = debugStops.find(x => x.id === id);
  if (!s) return;
  editStopId = id;
  document.getElementById('edit-stop-desc').textContent = `${s.societe} — ${s.numero_affaire || 'sans affaire'}`;
  document.getElementById('edit-stop-error').style.display = 'none';

  document.getElementById('es-societe').value          = s.societe || '';
  document.getElementById('es-affaire').value          = s.numero_affaire || '';
  document.getElementById('es-adresse').value          = s.adresse || '';
  document.getElementById('es-telephone').value        = s.telephone || '';
  document.getElementById('es-date').value             = s.date_tournee ? s.date_tournee.slice(0,10) : '';
  document.getElementById('es-societe-livraison').value = s.societe_livraison || 'ATRIAL';
  document.getElementById('es-statut').value           = s.statut || 'A_LIVRER';
  document.getElementById('es-tournee').value          = s.tournee || '';
  document.getElementById('es-vehicule').value         = s.vehicule || '';
  document.getElementById('es-ordre').value            = s.ordre || '';
  document.getElementById('es-colis').value            = s.nombre_colis || '';
  document.getElementById('es-emplacement').value      = s.emplacement || '';
  document.getElementById('es-type-produit').value     = s.type_produit || '';
  document.getElementById('es-reference-client').value = s.reference_client || '';
  document.getElementById('es-groupe').value           = s.groupe_livraison || '';

  document.getElementById('edit-stop-modal').classList.remove('hidden');
}
function closeEditStopModal() {
  document.getElementById('edit-stop-modal').classList.add('hidden');
  editStopId = null;
}

async function saveEditStop() {
  if (!editStopId) return;
  const errEl = document.getElementById('edit-stop-error');
  errEl.style.display = 'none';

  const body = {
    societe:          document.getElementById('es-societe').value.trim() || null,
    numero_affaire:   document.getElementById('es-affaire').value.trim() || null,
    adresse:          document.getElementById('es-adresse').value.trim() || null,
    telephone:        document.getElementById('es-telephone').value.trim() || null,
    date_tournee:     document.getElementById('es-date').value || null,
    societe_livraison: document.getElementById('es-societe-livraison').value,
    statut:           document.getElementById('es-statut').value,
    tournee:          document.getElementById('es-tournee').value || null,
    vehicule:         document.getElementById('es-vehicule').value || null,
    ordre:            parseInt(document.getElementById('es-ordre').value) || null,
    nombre_colis:     parseInt(document.getElementById('es-colis').value) || null,
    emplacement:      document.getElementById('es-emplacement').value.trim() || null,
    type_produit:     document.getElementById('es-type-produit').value || null,
    reference_client: document.getElementById('es-reference-client').value.trim() || null,
    groupe_livraison: document.getElementById('es-groupe').value.trim() || null,
  };

  try {
    const res = await fetch(`/api/stops/${editStopId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || 'Erreur serveur';
      errEl.style.display = 'block'; return;
    }
    // Update local cache
    const idx = debugStops.findIndex(x => x.id === editStopId);
    if (idx !== -1) debugStops[idx] = { ...debugStops[idx], ...data };
    closeEditStopModal();
    renderDebugStops(document.getElementById('debug-date').value);
    showFeedback('Stop mis à jour.', 'success');
  } catch {
    errEl.textContent = 'Erreur réseau. Réessayez.';
    errEl.style.display = 'block';
  }
}

// ── Logs ───────────────────────────────────────────────────────
async function loadLogs() {
  const container = document.getElementById('logs-container');
  container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--ink-mute)">Chargement…</div>';
  try {
    const res = await fetch('/api/logs');
    if (!res.ok) { container.innerHTML = '<div style="color:var(--danger);padding:20px">Erreur chargement logs.</div>'; return; }
    const logs = await res.json();
    renderLogs(logs);
  } catch {
    container.innerHTML = '<div style="color:var(--danger);padding:20px">Erreur réseau.</div>';
  }
}

function renderLogs(logs) {
  const container = document.getElementById('logs-container');
  document.getElementById('logs-lead').textContent = `${logs.length} entrée${logs.length > 1 ? 's' : ''}`;
  if (!logs.length) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--ink-mute)">Aucun log.</div>';
    return;
  }
  container.innerHTML = logs.map(l => {
    const dotClass = ['LOGIN','STOP_LIVRE','STOP_EN_COURS','STOP_A_LIVRER','STOP_MAGASIN_VALIDE',
      'USER_REVOKED','USER_REACTIVATED','USER_CREATED','PASSWORD_RESET'].includes(l.action)
      ? l.action : 'DEFAULT';
    const detail = l.details ? Object.entries(l.details).map(([k,v]) => `${k}: ${v}`).join(' · ') : '';
    return `<div class="log-entry">
      <div class="log-dot ${dotClass}"></div>
      <div>
        <div><span class="log-action">${esc(l.action)}</span>
          ${l.user_email ? `<span class="log-detail"> — ${esc(l.user_email)}</span>` : ''}</div>
        ${detail ? `<div class="log-detail">${esc(detail)}</div>` : ''}
      </div>
      <div class="log-time">${formatDate(l.created_at)}</div>
    </div>`;
  }).join('');
}

// ── Géocodage stops manquants ──────────────────────────────────
async function geocodeMissing() {
  const btn = document.getElementById('btn-geocode');
  btn.disabled = true;
  btn.textContent = '⏳ Géocodage…';
  try {
    const res = await fetch('/api/routing/geocode-missing', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) { showFeedback(data.error || 'Erreur', 'danger'); return; }
    showFeedback(data.message, 'success');
    // Recharger les stops si une date est sélectionnée
    if (document.getElementById('debug-date').value) loadDebugStops();
  } catch {
    showFeedback('Erreur réseau', 'danger');
  } finally {
    btn.textContent = '📍 Géocoder manquants';
    btn.disabled = false;
  }
}

// ── Logout ─────────────────────────────────────────────────────
async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/';
}

// ── Feedback banner ────────────────────────────────────────────
function showFeedback(msg, type) {
  const el = document.getElementById('feedback');
  el.textContent = msg;
  el.style.display = 'block';
  el.style.background = type === 'success' ? 'var(--success-soft)' : 'var(--danger-soft)';
  el.style.color = type === 'success' ? '#20764A' : '#A14444';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}

// ── Utils ───────────────────────────────────────────────────────
function initials(u) {
  return ((u.prenom?.[0] || '') + (u.nom?.[0] || '')).toUpperCase();
}
function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function labelStatut(s) {
  return { A_LIVRER: 'À livrer', EN_COURS: 'En cours', LIVRE: 'Livré' }[s] || s;
}

// ── Boot ────────────────────────────────────────────────────────
init();
