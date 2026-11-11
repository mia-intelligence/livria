// LIVRIAL — Planning des sorties (bêta) : classement des lignes d'ARC.
// Les règles sont dans lib/sorties-config.js ; ce fichier ne fait que les appliquer.

const CONFIG = require('./sorties-config');

// Minuscules, sans accent, espaces simples : « Châssis  FIXE » → « chassis fixe ».
function simplifier(texte) {
  return String(texte || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’`]/g, "'")
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

const REGLES = CONFIG.REGLES_DESIGNATION.map(r => ({ ...r, regex: new RegExp(r.motif) }));
// « OF2: … » ou « OF2 : … » en début de désignation
const REGEX_CODE = new RegExp('^(' + CONFIG.CODES_ARC.join('|') + ')\\s*:', 'i');

// Classe une désignation.
// Renvoie { famille, code } ; famille = 'INCONNU' si aucune règle ne correspond.
function classerDesignation(designation) {
  const brut = String(designation || '').trim();
  const avecCode = REGEX_CODE.exec(brut);
  if (avecCode) return { famille: 'MENUISERIE', code: avecCode[1].toUpperCase() };

  const texte = simplifier(brut);
  for (const r of REGLES) {
    if (r.regex.test(texte)) return { famille: r.famille, code: r.code || null };
  }
  return { famille: 'INCONNU', code: null };
}

// Résume les lignes d'une commande.
//   articles : lignes de arc_articles (designation, quantite, ligne)
//   gamme    : arc_commandes.gamme (ALU, PVC, MIXTE ou vide)
// Renvoie { alu, pvc, autres, vr, contenu: [{ code, qte }], inconnues: [désignations] }.
function resumerCommande(articles, gamme) {
  const total = { alu: 0, pvc: 0, autres: 0, vr: 0 };
  const parCode = {};
  const inconnues = [];
  const familleMenuiserie = (gamme === 'ALU' || gamme === 'PVC' ? gamme : CONFIG.GAMME_PAR_DEFAUT).toLowerCase();

  const lignes = [...(articles || [])].sort((a, b) => (a.ligne || 0) - (b.ligne || 0));
  for (const a of lignes) {
    const { famille, code } = classerDesignation(a.designation);
    if (famille === 'IGNORE') continue;
    if (famille === 'INCONNU') { inconnues.push(a.designation); continue; }

    const qte = Number(a.quantite) || 0;
    if (famille === 'MENUISERIE')  total[familleMenuiserie] += qte;
    else if (famille === 'VR')     total.vr += qte;
    else                           total.autres += qte;
    if (code) parCode[code] = (parCode[code] || 0) + qte;
  }

  const rang = c => { const i = CONFIG.ORDRE_CODES.indexOf(c); return i === -1 ? 999 : i; };
  const contenu = Object.keys(parCode)
    .sort((x, y) => rang(x) - rang(y) || x.localeCompare(y))
    .map(code => ({ code, qte: parCode[code] }));

  return { ...total, contenu, inconnues, gamme_incertaine: !(gamme === 'ALU' || gamme === 'PVC') };
}

module.exports = { simplifier, classerDesignation, resumerCommande };
