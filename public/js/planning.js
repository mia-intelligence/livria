/* ── LIVRIAL — Planning des livraisons (partagé ADV + Admin) ──── */

(function () {
  const DAYS_FR  = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  const MONTHS_FR = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

  let planningMode = 'semaine'; // 'semaine' | 'mois' | 'trimestre'
  let planningAnchor = null;    // Date objet représentant la semaine/mois/trimestre en cours

  /* ── Point d'entrée ───────────────────────────────────────── */
  window.initPlanning = function () {
    if (!planningAnchor) planningAnchor = startOfWeek(new Date());
    renderPlanningUI();
  };

  /* ── Rendu de la coquille UI ──────────────────────────────── */
  function renderPlanningUI() {
    const container = document.getElementById('planning-container');
    if (!container) return;

    container.innerHTML = `
      <div class="planning-toolbar">
        <div class="planning-mode-toggle">
          <button class="chip ${planningMode==='semaine'?'active':''}"   onclick="setPlanningMode('semaine')">Semaine</button>
          <button class="chip ${planningMode==='mois'?'active':''}"      onclick="setPlanningMode('mois')">Mois</button>
          <button class="chip ${planningMode==='trimestre'?'active':''}" onclick="setPlanningMode('trimestre')">Trimestre</button>
        </div>
        <div class="planning-nav">
          <button class="btn sm" onclick="planningPrev()">&#8249;</button>
          <button class="btn sm" onclick="planningToday()" style="min-width:90px">Aujourd'hui</button>
          <button class="btn sm" onclick="planningNext()">&#8250;</button>
        </div>
      </div>
      <div id="planning-grid-wrapper">
        <div style="color:var(--ink-mute);font-size:13px;text-align:center;padding:40px 0">Chargement…</div>
      </div>
    `;

    fetchAndRender();
  }

  /* ── Navigation ───────────────────────────────────────────── */
  window.setPlanningMode = function (mode) {
    planningMode = mode;
    if (mode === 'semaine')   planningAnchor = startOfWeek(new Date());
    if (mode === 'mois')      planningAnchor = startOfMonth(new Date());
    if (mode === 'trimestre') planningAnchor = startOfQuarter(new Date());
    renderPlanningUI();
  };

  window.planningPrev = function () {
    planningAnchor = shift(planningAnchor, -1);
    fetchAndRender();
  };

  window.planningNext = function () {
    planningAnchor = shift(planningAnchor, +1);
    fetchAndRender();
  };

  window.planningToday = function () {
    if (planningMode === 'semaine')   planningAnchor = startOfWeek(new Date());
    if (planningMode === 'mois')      planningAnchor = startOfMonth(new Date());
    if (planningMode === 'trimestre') planningAnchor = startOfQuarter(new Date());
    fetchAndRender();
  };

  function shift(date, dir) {
    const d = new Date(date);
    if (planningMode === 'semaine')   d.setDate(d.getDate() + dir * 7);
    if (planningMode === 'mois')      d.setMonth(d.getMonth() + dir);
    if (planningMode === 'trimestre') d.setMonth(d.getMonth() + dir * 3);
    return d;
  }

  /* ── Fetch API ────────────────────────────────────────────── */
  function fetchAndRender() {
    const wrapper = document.getElementById('planning-grid-wrapper');
    if (!wrapper) return;
    wrapper.innerHTML = '<div style="color:var(--ink-mute);font-size:13px;text-align:center;padding:40px 0">Chargement…</div>';

    const { from, to } = dateRange();
    fetch(`/api/stops?planning=true&from=${from}&to=${to}`)
      .then(r => r.json())
      .then(data => renderGrid(data, from, to))
      .catch(() => {
        wrapper.innerHTML = '<div style="color:var(--danger);font-size:13px;text-align:center;padding:40px 0">Erreur de chargement</div>';
      });
  }

  function dateRange() {
    if (planningMode === 'semaine') {
      const end = new Date(planningAnchor);
      end.setDate(end.getDate() + 6);
      return { from: fmt(planningAnchor), to: fmt(end) };
    }
    if (planningMode === 'mois') {
      const end = new Date(planningAnchor.getFullYear(), planningAnchor.getMonth() + 1, 0);
      return { from: fmt(planningAnchor), to: fmt(end) };
    }
    // trimestre
    const end = new Date(planningAnchor);
    end.setMonth(end.getMonth() + 3);
    end.setDate(end.getDate() - 1);
    return { from: fmt(planningAnchor), to: fmt(end) };
  }

  /* ── Rendu grille ─────────────────────────────────────────── */
  function renderGrid(data, from, to) {
    const wrapper = document.getElementById('planning-grid-wrapper');
    if (!wrapper) return;

    if (planningMode === 'semaine') {
      wrapper.innerHTML = renderWeek(data, planningAnchor);
    } else if (planningMode === 'mois') {
      wrapper.innerHTML = renderMonth(data, planningAnchor.getFullYear(), planningAnchor.getMonth());
    } else {
      wrapper.innerHTML = renderQuarter(data, planningAnchor);
    }
  }

  /* ── Vue SEMAINE ──────────────────────────────────────────── */
  function renderWeek(data, weekStart) {
    const today = fmt(new Date());
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      days.push(d);
    }

    const label = `Semaine du ${days[0].getDate()} ${MONTHS_FR[days[0].getMonth()]} ${days[0].getFullYear()}`;

    let html = `<div class="planning-period-label">${label}</div><div class="planning-week-grid">`;

    for (const d of days) {
      const key = fmt(d);
      const info = data[key] || { total: 0, livre: 0, en_cours: 0, a_livrer: 0 };
      const isToday = key === today;
      const dayName = DAYS_FR[d.getDay() === 0 ? 6 : d.getDay() - 1];
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;

      html += `
        <div class="planning-day-cell ${isToday ? 'today' : ''} ${isWeekend ? 'weekend' : ''}">
          <div class="pdc-head">
            <span class="pdc-dayname">${dayName}</span>
            <span class="pdc-date">${d.getDate()} ${MONTHS_FR[d.getMonth()].slice(0,3)}</span>
          </div>
          <div class="pdc-count">${info.total > 0 ? info.total : '<span class="pdc-empty">—</span>'}</div>
          ${info.total > 0 ? `<div class="pdc-label">stop${info.total > 1 ? 's' : ''}</div>` : ''}
          ${info.total > 0 && info.clients && info.clients.length > 0 ? renderClients(info.clients) : ''}
          ${info.total > 0 ? renderBar(info) : ''}
        </div>`;
    }

    html += '</div>';
    return html;
  }

  /* ── Vue MOIS ─────────────────────────────────────────────── */
  function renderMonth(data, year, month) {
    const today = fmt(new Date());
    const label = `${MONTHS_FR[month]} ${year}`;
    const firstDay = new Date(year, month, 1);
    const lastDay  = new Date(year, month + 1, 0);

    // Day of week of first day (Mon=0)
    let startOffset = firstDay.getDay() - 1;
    if (startOffset < 0) startOffset = 6;

    let html = `<div class="planning-period-label">${label}</div>`;
    html += '<div class="planning-month-grid">';

    // Header
    for (const d of DAYS_FR) html += `<div class="pmg-header">${d}</div>`;

    // Empty cells before start
    for (let i = 0; i < startOffset; i++) html += '<div class="pmg-cell empty"></div>';

    // Days
    for (let day = 1; day <= lastDay.getDate(); day++) {
      const key = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      const info = data[key] || { total: 0 };
      const isToday = key === today;
      const dow = new Date(year, month, day).getDay();
      const isWeekend = dow === 0 || dow === 6;

      html += `
        <div class="pmg-cell ${isToday ? 'today' : ''} ${isWeekend ? 'weekend' : ''}">
          <div class="pmg-day">${day}</div>
          ${info.total > 0 ? `<div class="pmg-count">${info.total}</div>` : ''}
        </div>`;
    }

    html += '</div>';
    return html;
  }

  /* ── Vue TRIMESTRE ────────────────────────────────────────── */
  function renderQuarter(data, quarterStart) {
    const m0 = quarterStart.getMonth();
    const yr = quarterStart.getFullYear();
    const qLabel = `T${Math.floor(m0/3)+1} ${yr} — ${MONTHS_FR[m0]} à ${MONTHS_FR[Math.min(m0+2, 11)]}`;

    let html = `<div class="planning-period-label">${qLabel}</div><div class="planning-quarter-grid">`;

    for (let mi = 0; mi < 3; mi++) {
      html += `<div class="pqg-month">`;
      html += `<div class="pqg-month-name">${MONTHS_FR[m0+mi]} ${yr}</div>`;
      html += `<div class="pqg-mini-grid">`;
      for (const d of DAYS_FR) html += `<div class="pqg-mini-header">${d.slice(0,1)}</div>`;

      const firstDay = new Date(yr, m0+mi, 1);
      const lastDay  = new Date(yr, m0+mi+1, 0);
      let offset = firstDay.getDay() - 1;
      if (offset < 0) offset = 6;

      for (let i = 0; i < offset; i++) html += '<div class="pqg-mini-cell empty"></div>';

      const today = fmt(new Date());
      for (let day = 1; day <= lastDay.getDate(); day++) {
        const key = `${yr}-${String(m0+mi+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        const info = data[key] || { total: 0 };
        const isToday = key === today;
        const dow = new Date(yr, m0+mi, day).getDay();
        const isWeekend = dow === 0 || dow === 6;
        const hasStops = info.total > 0;

        html += `
          <div class="pqg-mini-cell ${isToday ? 'today' : ''} ${isWeekend ? 'weekend' : ''} ${hasStops ? 'has-stops' : ''}" title="${hasStops ? info.total+' stop'+(info.total>1?'s':'') : ''}">
            <span class="pqg-day-num">${day}</span>
            ${hasStops ? `<span class="pqg-count">${info.total}</span>` : ''}
          </div>`;
      }

      html += '</div></div>';
    }

    html += '</div>';
    return html;
  }

  /* ── Liste clients ────────────────────────────────────────── */
  function renderClients(clients) {
    const MAX = 4;
    const shown = clients.slice(0, MAX);
    const rest  = clients.length - MAX;
    let html = '<div class="pdc-clients">';
    for (const c of shown) html += `<div class="pdc-client-tag">${c}</div>`;
    if (rest > 0) html += `<div class="pdc-client-more">+${rest}</div>`;
    html += '</div>';
    return html;
  }

  /* ── Barre statut ─────────────────────────────────────────── */
  function renderBar(info) {
    if (!info.total) return '';
    const pLivre    = Math.round(info.livre    / info.total * 100);
    const pEnCours  = Math.round(info.en_cours / info.total * 100);
    const pALivrer  = 100 - pLivre - pEnCours;
    return `
      <div class="pdc-bar">
        ${pLivre   > 0 ? `<div style="width:${pLivre}%;background:var(--status-done-dot)"></div>` : ''}
        ${pEnCours > 0 ? `<div style="width:${pEnCours}%;background:var(--status-now-dot)"></div>` : ''}
        ${pALivrer > 0 ? `<div style="width:${pALivrer}%;background:var(--status-todo-dot)"></div>` : ''}
      </div>`;
  }

  /* ── Utilitaires date ─────────────────────────────────────── */
  function fmt(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  function startOfWeek(d) {
    const r = new Date(d);
    const day = r.getDay();
    const diff = (day === 0 ? -6 : 1 - day);
    r.setDate(r.getDate() + diff);
    r.setHours(0,0,0,0);
    return r;
  }

  function startOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }

  function startOfQuarter(d) {
    const q = Math.floor(d.getMonth() / 3);
    return new Date(d.getFullYear(), q * 3, 1);
  }
})();
