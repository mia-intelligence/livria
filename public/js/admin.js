/* ── LIVRIAL — Vue Admin ──────────────────────────────────────── */

let users = [];
let currentUserId = null;
let pendingRevokeId = null;

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
          <div>
            <div class="strong">${esc(u.prenom)} ${esc(u.nom)}</div>
          </div>
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
        <div style="display:flex;gap:6px;align-items:center">
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
    errEl.style.display = 'block';
    return;
  }
  if (password.length < 8) {
    errEl.textContent = 'Le mot de passe doit contenir au moins 8 caractères.';
    errEl.style.display = 'block';
    return;
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
      errEl.style.display = 'block';
      return;
    }
    closeCreateModal();
    showFeedback(`Accès créé pour ${prenom} ${nom} (${role}).`, 'success');
    await loadUsers();
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

// ── Reactivate user ────────────────────────────────────────────
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
      showFeedback(d.error || 'Erreur serveur', 'danger');
      return;
    }
    const user = users.find(u => u.id === id);
    const action = actif ? 'réactivé' : 'révoqué';
    showFeedback(`Compte de ${user?.prenom} ${user?.nom} ${action}.`, actif ? 'success' : 'danger');
    await loadUsers();
  } catch {
    showFeedback('Erreur réseau. Réessayez.', 'danger');
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

// ── Boot ────────────────────────────────────────────────────────
init();
