/* ── LIVRIAL — Vue Magasin ─────────────────────────────────── */

let stops = [];
let activePrepId = null;
let pendingPhotos = [];   // {base64, type} — photos à uploader
let existingPhotos = [];  // {id, photo_url} — photos déjà en DB

let activeTab = 'today';       // 'today' | 'tomorrow' | 'week'
let weekAnchor = startOfWeek(new Date()); // lundi de la semaine affichée

const DAYS_FR   = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const MONTHS_FR = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];

// ── Init ──────────────────────────────────────────────────────
async function init() {
  await checkAuth();
  setTodayDate();
  await loadStops();
}

// ── Onglets Aujourd'hui / Demain / Semaine ────────────────────
const TABS = { today: 'tab-today', tomorrow: 'tab-tomorrow', week: 'tab-week' };

function switchTab(tab) {
  activeTab = tab;

  for (const [key, id] of Object.entries(TABS)) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    const on = key === tab;
    btn.style.borderBottomColor = on ? 'var(--turquoise)' : 'transparent';
    btn.style.color             = on ? 'var(--turquoise)' : 'var(--ink-mute)';
    btn.style.fontWeight        = on ? '700' : '600';
  }

  const isWeek = tab === 'week';
  document.body.classList.toggle('magasin-week', isWeek);
  document.getElementById('week-nav').style.display   = isWeek ? 'flex' : 'none';
  document.getElementById('week-grid').style.display  = isWeek ? 'grid' : 'none';
  document.getElementById('stops-list').style.display = isWeek ? 'none' : 'flex';

  loadStops();
}

function weekShift(dir) {
  if (dir === 0) weekAnchor = startOfWeek(new Date());
  else {
    const d = new Date(weekAnchor);
    d.setDate(d.getDate() + dir * 7);
    weekAnchor = d;
  }
  loadStops();
}

function getTabDate() {
  const d = new Date();
  if (activeTab === 'tomorrow') d.setDate(d.getDate() + 1);
  return fmtDate(d);
}

function getWeekRange() {
  const end = new Date(weekAnchor);
  end.setDate(end.getDate() + 6);
  return { from: fmtDate(weekAnchor), to: fmtDate(end) };
}

function startOfWeek(d) {
  const r = new Date(d);
  const day = r.getDay();
  r.setDate(r.getDate() + (day === 0 ? -6 : 1 - day));
  r.setHours(0, 0, 0, 0);
  return r;
}

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/';
}

async function checkAuth() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) { window.location.href = '/'; return; }
    const user = await res.json();
    if (user.role !== 'MAGASIN') { window.location.href = '/'; }
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
  const isWeek = activeTab === 'week';
  try {
    let url;
    if (isWeek) {
      const { from, to } = getWeekRange();
      url = `/api/stops?from=${from}&to=${to}`;
    } else {
      url = `/api/stops?date=${getTabDate()}`;
    }

    const res = await fetch(url);
    if (res.status === 401) { window.location.href = '/'; return; }
    stops = await res.json();

    if (isWeek) renderWeek();
    else        renderList();
    updateCounts();
  } catch {
    const target = isWeek ? 'week-grid' : 'stops-list';
    document.getElementById(target).innerHTML =
      '<div style="text-align:center;padding:40px;color:var(--danger)">Erreur de chargement. Actualisez la page.</div>';
  }
}

// ── Vue semaine ───────────────────────────────────────────────
function renderWeek() {
  const grid  = document.getElementById('week-grid');
  const today = fmtDate(new Date());

  const label = document.getElementById('week-label');
  const end   = new Date(weekAnchor);
  end.setDate(end.getDate() + 6);
  label.textContent = `Semaine du ${weekAnchor.getDate()} ${MONTHS_FR[weekAnchor.getMonth()]} au ${end.getDate()} ${MONTHS_FR[end.getMonth()]} ${end.getFullYear()}`;

  // Regrouper par date
  const byDate = {};
  for (const s of stops) {
    if (!s.date_tournee) continue;
    (byDate[s.date_tournee] = byDate[s.date_tournee] || []).push(s);
  }

  let html = '';
  for (let i = 0; i < 7; i++) {
    const d   = new Date(weekAnchor);
    d.setDate(d.getDate() + i);
    const key = fmtDate(d);
    const dayStops = byDate[key] || [];
    const prets    = dayStops.filter(s => s.magasin_valide === true).length;

    const progressCls = dayStops.length && prets === dayStops.length ? 'done' : '';

    html += `
      <div class="week-col ${key === today ? 'today' : ''}">
        <div class="week-col-head">
          <div>
            <div class="wc-day">${DAYS_FR[i]}</div>
            <div class="wc-date">${d.getDate()} ${MONTHS_FR[d.getMonth()]}</div>
          </div>
          <span class="wc-progress ${progressCls}">${prets}/${dayStops.length}</span>
        </div>
        <div class="week-col-body">
          ${dayStops.length ? dayStops.map(weekCard).join('') : '<div class="week-empty">Rien à préparer</div>'}
        </div>
      </div>`;
  }

  grid.innerHTML = html;
}

function weekCard(s) {
  const ms = getMagasinStatus(s);

  const tags = [];
  if (s.type_produit)  tags.push(`<span class="wk-tag">${esc(s.type_produit)}</span>`);
  if (s.nombre_colis)  tags.push(`<span class="wk-tag colis">${s.nombre_colis} colis</span>`);
  if (s.emplacement)   tags.push(`<span class="wk-tag">${esc(s.emplacement)}</span>`);
  if ((s.stop_photos || []).length) tags.push(`<span class="wk-tag">📷 ${s.stop_photos.length}</span>`);
  if (ms === 'en-cours') tags.push('<span class="wk-tag draft">Brouillon</span>');
  if (ms === 'a-preparer') tags.push(`<span class="wk-tag">${BADGE_LABEL['a-preparer']}</span>`);

  return `
    <div class="week-card ${ms}" onclick="openPrepSheet('${s.id}')" title="Ouvrir la fiche de préparation">
      ${s.numero_affaire ? `<div class="wk-affaire">N° ${esc(s.numero_affaire)}</div>` : ''}
      <div class="wk-societe">${esc(s.societe)}</div>
      <div class="wk-meta">${esc(s.tournee || s.societe_livraison || '')}</div>
      ${tags.length ? `<div class="wk-tags">${tags.join('')}</div>` : ''}
    </div>`;
}

// ── Counts ────────────────────────────────────────────────────
function updateCounts() {
  const total     = stops.length;
  const prets     = stops.filter(s => s.magasin_valide === true).length;
  const apreparer = stops.filter(s => s.magasin_valide !== true).length;

  document.getElementById('cnt-total').innerHTML     = `<em style="font-style:normal;color:var(--turquoise)">${total}</em>`;
  document.getElementById('cnt-prets').textContent     = prets;
  document.getElementById('cnt-apreparer').textContent = apreparer;
}

// ── Render list ───────────────────────────────────────────────
function getMagasinStatus(s) {
  if (s.magasin_valide === true)                             return 'pret';
  if (!s.magasin_valide && s.nombre_colis)                   return 'en-cours';
  return 'a-preparer';
}

const BADGE_LABEL = {
  'a-preparer': 'À préparer',
  'en-cours':   'En cours',
  'pret':        'Prêt',
};

function renderList() {
  const container = document.getElementById('stops-list');

  if (!stops.length) {
    container.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--ink-mute);">Aucun stop prévu aujourd\'hui.</div>';
    return;
  }

  container.innerHTML = stops.map((s, i) => {
    const ms  = getMagasinStatus(s);
    const num = s.ordre ?? (i + 1);

    const numClass = s.statut === 'LIVRE' ? 'done' : ms === 'pret' ? 'ready' : 'prep';

    const badge = `<span class="mag-badge ${ms}">${BADGE_LABEL[ms]}</span>`;

    let footer = '';
    if (ms === 'pret') {
      const colisLabel = s.nombre_colis ? `${s.nombre_colis} colis` : '';
      const empLabel   = s.emplacement  ? s.emplacement             : '';
      const pillText   = [colisLabel, empLabel].filter(Boolean).join(' · ');
      const photoCnt   = (s.stop_photos || []).length;
      const photoInfo  = photoCnt ? ` · 📷 ${photoCnt}` : '';
      footer = `<div class="stop-footer">
        <span class="colis-pill">${esc(pillText)}${photoInfo}</span>
        ${s.commentaire_magasin ? `<span style="font-size:11.5px;color:var(--ink-soft);margin-top:4px;display:block">💬 ${esc(s.commentaire_magasin)}</span>` : ''}
      </div>`;
    } else {
      const btnLabel = ms === 'en-cours' ? 'Compléter' : 'Préparer';
      footer = `<div class="stop-footer">
        <button class="btn-preparer" onclick="openPrepSheet('${s.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          ${btnLabel}
        </button>
      </div>`;
    }

    return `
    <div class="stop-card-magasin">
      <div class="stop-num-mag ${numClass}">${num}</div>
      <div class="stop-body">
        <div class="stop-name">${esc(s.societe)}</div>
        <div class="stop-addr">${esc(s.adresse)}</div>
        <div class="stop-meta">
          ${s.numero_affaire ? `N° ${esc(s.numero_affaire)}` : ''}
          ${badge}
        </div>
        ${footer}
      </div>
    </div>`;
  }).join('');
}

// ── Fiche préparation ─────────────────────────────────────────
function openPrepSheet(id) {
  const stop = stops.find(s => s.id === id);
  if (!stop) return;
  activePrepId  = id;
  pendingPhotos = [];
  existingPhotos = (stop.stop_photos || []).slice();

  document.getElementById('prep-societe').textContent = stop.societe;
  document.getElementById('prep-adresse').textContent = stop.adresse;
  const meta = [
    stop.numero_affaire ? `N° ${stop.numero_affaire}` : null,
    stop.tournee        ? stop.tournee                 : null,
    stop.date_tournee   ? `Livraison le ${new Date(stop.date_tournee + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}` : null,
  ].filter(Boolean).join(' · ');
  document.getElementById('prep-meta').textContent = meta;

  document.getElementById('prep-colis').value       = stop.nombre_colis || '';
  document.getElementById('prep-emplacement').value = stop.emplacement  || '';
  document.getElementById('prep-commentaire').value = stop.commentaire_magasin || '';

  document.getElementById('prep-photo-input').value = '';
  document.getElementById('prep-error').style.display = 'none';
  resetPrepButtons();

  renderPhotosGrid();

  document.getElementById('prep-overlay').classList.add('open');
  document.getElementById('prep-sheet').classList.add('open');

  setTimeout(() => document.getElementById('prep-colis').focus(), 350);
}

function closePrepSheet() {
  document.getElementById('prep-overlay').classList.remove('open');
  document.getElementById('prep-sheet').classList.remove('open');
  activePrepId   = null;
  pendingPhotos  = [];
  existingPhotos = [];
}

// ── Galerie photos ────────────────────────────────────────────
function renderPhotosGrid() {
  const grid = document.getElementById('prep-photos-grid');

  const existingHtml = existingPhotos.map((p, i) => `
    <div class="photo-thumb-wrap">
      <img src="${esc(p.photo_url)}" alt="Photo ${i + 1}">
    </div>
  `).join('');

  const pendingHtml = pendingPhotos.map((p, i) => `
    <div class="photo-thumb-wrap">
      <img src="${esc(p.base64)}" alt="Nouvelle photo ${i + 1}">
      <button class="photo-thumb-del" onclick="removePendingPhoto(${i})" title="Supprimer">×</button>
    </div>
  `).join('');

  grid.innerHTML = existingHtml + pendingHtml;
}

function removePendingPhoto(index) {
  pendingPhotos.splice(index, 1);
  renderPhotosGrid();
}

// ── Sélection photo ───────────────────────────────────────────
function handlePhotoSelected(input) {
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1280;
      let w = img.width;
      let h = img.height;
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
        else       { w = Math.round(w * MAX / h); h = MAX; }
      }
      const canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      pendingPhotos.push({ base64: dataUrl, type: 'image/jpeg' });
      input.value = '';
      renderPhotosGrid();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// ── Enregistrer sans valider (brouillon) ──────────────────────
// Le magasinier peut saisir ce qu'il a, fermer, et revenir plus tard.
function saveDraft() { persistPrep(false); }
function submitPrep() { persistPrep(true); }

async function persistPrep(validate) {
  const colisVal    = document.getElementById('prep-colis').value.trim();
  const emplacement = document.getElementById('prep-emplacement').value.trim();
  const commentaire = document.getElementById('prep-commentaire').value.trim();
  const errEl       = document.getElementById('prep-error');
  const btn         = document.getElementById(validate ? 'prep-submit-btn' : 'prep-draft-btn');
  const otherBtn    = document.getElementById(validate ? 'prep-draft-btn' : 'prep-submit-btn');
  const stopId      = activePrepId;

  errEl.style.display = 'none';

  const colisNum = colisVal ? parseInt(colisVal, 10) : null;

  if (validate && (!colisNum || colisNum < 1)) {
    errEl.textContent    = 'Le nombre de colis est obligatoire pour valider (minimum 1). Utilisez « Enregistrer » pour reprendre plus tard.';
    errEl.style.display  = 'block';
    return;
  }
  if (colisVal && (Number.isNaN(colisNum) || colisNum < 1)) {
    errEl.textContent    = 'Le nombre de colis doit être un entier supérieur à 0.';
    errEl.style.display  = 'block';
    return;
  }
  if (!validate && !colisVal && !emplacement && !commentaire && !pendingPhotos.length) {
    errEl.textContent    = 'Rien à enregistrer : renseignez au moins un champ ou ajoutez une photo.';
    errEl.style.display  = 'block';
    return;
  }

  btn.disabled      = true;
  otherBtn.disabled = true;
  btn.textContent   = validate ? 'Validation en cours…' : 'Enregistrement…';

  try {
    // 1. PATCH principal — `magasin_valide` seulement en validation
    const payload = {
      nombre_colis:        colisNum,
      emplacement:         emplacement || null,
      commentaire_magasin: commentaire || null,
    };
    if (validate) payload.magasin_valide = true;

    const patchRes = await fetch(`/api/stops/${stopId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!patchRes.ok) {
      const d = await patchRes.json();
      errEl.textContent   = d.error || 'Erreur serveur. Réessayez.';
      errEl.style.display = 'block';
      return;
    }

    const updated = await patchRes.json();
    const idx = stops.findIndex(s => s.id === stopId);
    if (idx !== -1) stops[idx] = { ...updated, stop_photos: stops[idx].stop_photos || [] };

    // 2. Upload photos en attente
    let photoErrors = 0;
    for (const photo of pendingPhotos) {
      try {
        const photoRes = await fetch('/api/stops/photo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stop_id:      stopId,
            image:        photo.base64,
            content_type: photo.type,
          }),
        });
        if (photoRes.ok) {
          const photoData = await photoRes.json();
          if (idx !== -1) {
            if (!stops[idx].stop_photos) stops[idx].stop_photos = [];
            stops[idx].stop_photos.push({ photo_url: photoData.photo_url });
          }
        } else {
          photoErrors++;
        }
      } catch {
        photoErrors++;
      }
    }

    if (photoErrors > 0) {
      errEl.textContent   = `⚠ Enregistré, mais ${photoErrors} photo(s) non sauvegardée(s). Rouvrez la fiche pour réessayer.`;
      errEl.style.display = 'block';
      pendingPhotos = [];
      renderPhotosGrid();
      if (activeTab === 'week') renderWeek(); else renderList();
      updateCounts();
      return;
    }

    closePrepSheet();
    if (activeTab === 'week') renderWeek(); else renderList();
    updateCounts();

    const feedback = document.createElement('div');
    feedback.textContent = validate
      ? `✓ ${updated.societe || 'Stop'} — colis prêts !`
      : `✓ ${updated.societe || 'Stop'} — préparation enregistrée`;
    Object.assign(feedback.style, {
      position: 'fixed', bottom: '32px', left: '50%',
      transform: 'translateX(-50%)',
      background: '#4BBFBF', color: '#fff',
      padding: '14px 28px', borderRadius: '99px',
      fontSize: '15px', fontWeight: '700',
      zIndex: '99999', whiteSpace: 'nowrap',
      boxShadow: '0 6px 24px rgba(75,191,191,.5)',
      transition: 'opacity .3s',
    });
    document.body.appendChild(feedback);
    setTimeout(() => { feedback.style.opacity = '0'; setTimeout(() => feedback.remove(), 300); }, 3500);

  } catch {
    errEl.textContent   = 'Erreur réseau. Vérifiez votre connexion.';
    errEl.style.display = 'block';
  } finally {
    resetPrepButtons();
  }
}

function resetPrepButtons() {
  const submit = document.getElementById('prep-submit-btn');
  const draft  = document.getElementById('prep-draft-btn');
  submit.disabled  = false;
  draft.disabled   = false;
  submit.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg> Valider — colis prêts';
  draft.textContent = 'Enregistrer';
}

// ── Utils ─────────────────────────────────────────────────────
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Boot ──────────────────────────────────────────────────────
init();
