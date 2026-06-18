/* ── LIVRIAL — Vue Magasin ─────────────────────────────────── */

let stops = [];
let activePrepId = null;
let pendingPhotos = [];   // {base64, type} — photos à uploader
let existingPhotos = [];  // {id, photo_url} — photos déjà en DB

let activeTab = 'today';

// ── Init ──────────────────────────────────────────────────────
async function init() {
  await checkAuth();
  setTodayDate();
  await loadStops();
}

// ── Onglets Aujourd'hui / Demain ──────────────────────────────
function switchTab(tab) {
  activeTab = tab;
  const isToday = tab === 'today';

  const btnToday    = document.getElementById('tab-today');
  const btnTomorrow = document.getElementById('tab-tomorrow');

  btnToday.style.borderBottomColor = isToday ? 'var(--turquoise)' : 'transparent';
  btnToday.style.color             = isToday ? 'var(--turquoise)' : 'var(--ink-mute)';
  btnToday.style.fontWeight        = isToday ? '700' : '600';

  btnTomorrow.style.borderBottomColor = !isToday ? 'var(--turquoise)' : 'transparent';
  btnTomorrow.style.color             = !isToday ? 'var(--turquoise)' : 'var(--ink-mute)';
  btnTomorrow.style.fontWeight        = !isToday ? '700' : '600';

  loadStops();
}

function getTabDate() {
  const d = new Date();
  if (activeTab === 'tomorrow') d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
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
  try {
    const date = getTabDate();
    const res = await fetch(`/api/stops?date=${date}`);
    if (res.status === 401) { window.location.href = '/'; return; }
    stops = await res.json();
    renderList();
    updateCounts();
  } catch {
    document.getElementById('stops-list').innerHTML =
      '<div style="text-align:center;padding:40px;color:var(--danger)">Erreur de chargement. Actualisez la page.</div>';
  }
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
  ].filter(Boolean).join(' · ');
  document.getElementById('prep-meta').textContent = meta;

  document.getElementById('prep-colis').value       = stop.nombre_colis || '';
  document.getElementById('prep-emplacement').value = stop.emplacement  || '';
  document.getElementById('prep-commentaire').value = stop.commentaire_magasin || '';

  document.getElementById('prep-photo-input').value = '';
  document.getElementById('prep-error').style.display = 'none';
  document.getElementById('prep-submit-btn').disabled = false;

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

// ── Soumettre la préparation ──────────────────────────────────
async function submitPrep() {
  const colisVal    = document.getElementById('prep-colis').value.trim();
  const emplacement = document.getElementById('prep-emplacement').value.trim();
  const commentaire = document.getElementById('prep-commentaire').value.trim();
  const errEl       = document.getElementById('prep-error');
  const btn         = document.getElementById('prep-submit-btn');

  errEl.style.display = 'none';

  if (!colisVal || parseInt(colisVal, 10) < 1) {
    errEl.textContent    = 'Le nombre de colis est obligatoire (minimum 1).';
    errEl.style.display  = 'block';
    return;
  }

  btn.disabled    = true;
  btn.textContent = 'Validation en cours…';

  try {
    // 1. PATCH principal
    const patchRes = await fetch(`/api/stops/${activePrepId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre_colis:        parseInt(colisVal, 10),
        emplacement:         emplacement || null,
        commentaire_magasin: commentaire || null,
        magasin_valide:      true,
      }),
    });

    if (!patchRes.ok) {
      const d = await patchRes.json();
      errEl.textContent   = d.error || 'Erreur serveur. Réessayez.';
      errEl.style.display = 'block';
      return;
    }

    const updated = await patchRes.json();
    const idx = stops.findIndex(s => s.id === activePrepId);
    if (idx !== -1) stops[idx] = { ...updated, stop_photos: stops[idx].stop_photos || [] };

    // 2. Upload photos en attente
    let photoErrors = 0;
    for (const photo of pendingPhotos) {
      try {
        const photoRes = await fetch('/api/stops/photo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stop_id:      activePrepId,
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
      errEl.textContent   = `⚠ Colis enregistrés mais ${photoErrors} photo(s) non sauvegardée(s).`;
      errEl.style.display = 'block';
    }

    closePrepSheet();
    renderList();
    updateCounts();

    const feedback = document.createElement('div');
    feedback.textContent = `✓ ${updated.societe || 'Stop'} — colis prêts !`;
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
    btn.disabled  = false;
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg> Valider — colis prêts';
  }
}

// ── Utils ─────────────────────────────────────────────────────
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Boot ──────────────────────────────────────────────────────
init();
