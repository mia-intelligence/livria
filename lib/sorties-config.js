// ══════════════════════════════════════════════════════════════════════════════
//  LIVRIAL — Planning des sorties (bêta) : TOUTES les règles métier
//
//  Ce fichier est le seul à modifier quand Michel fait évoluer une règle :
//  classement des lignes d'ARC (ALU / PVC / AUTRES / VR), codes affichés sur
//  les étiquettes, correspondance des statuts.
//
//  Les règles sont encore en cours de validation par Atrial.
// ══════════════════════════════════════════════════════════════════════════════

// ── 1. Classement des lignes d'ARC (arc_articles.designation) ────────────────
//
//  Chaque désignation est d'abord simplifiée : minuscules, accents retirés,
//  espaces en trop supprimés. Les motifs ci-dessous s'écrivent donc SANS accent
//  et en minuscules.
//
//  Les règles sont lues DANS L'ORDRE : la première qui correspond l'emporte.
//  Une désignation qui ne correspond à aucune règle n'est PAS comptée : elle
//  est signalée dans les logs (« désignation non reconnue »).
//
//  famille :
//    IGNORE      ligne qui n'est pas un produit (titre, remise, teinte, forfait…)
//    MENUISERIE  fabriquée par Atrial → comptée en ALU ou PVC selon la gamme de l'ARC
//    VR          volet roulant
//    AUTRES      acheté par Atrial pour être livré (volets battants, moustiquaires…)
//
//  code : initiales affichées sur l'étiquette. Pour les désignations du type
//  « OF2: … », le code est lu directement avant les deux-points (voir CODES_ARC).

// Codes reconnus avant les deux-points : « OF2: Ouvrant à la française… »
const CODES_ARC = ['OF1', 'OF2', 'OB1', 'OB2', 'PF1', 'PF2', 'PE1', 'PS1', 'F', 'S'];

const REGLES_DESIGNATION = [
  // ── Lignes ignorées ────────────────────────────────────────────────────────
  // « Ensemble(s) comprenant : » est suivie des éléments qui la composent :
  // on ignore le titre et on compte les éléments (pas de double comptage).
  { famille: 'IGNORE', motif: '^ensemble(\\(s\\))?( comprenant| compose)?[ :]*$' },
  { famille: 'IGNORE', motif: '^ensemble(\\(s\\))? (comprenant|compose)' },
  { famille: 'IGNORE', motif: '^remise' },
  { famille: 'IGNORE', motif: '^fourniture de remplissage' },
  { famille: 'IGNORE', motif: '^ral ?[0-9#]' },
  { famille: 'IGNORE', motif: '^profils? ' },
  { famille: 'IGNORE', motif: '^forfait' },
  { famille: 'IGNORE', motif: '^(frais de )?livraison' },
  { famille: 'IGNORE', motif: '^compte prorata' },
  { famille: 'IGNORE', motif: '^franco' },
  { famille: 'IGNORE', motif: '^transport' },
  { famille: 'IGNORE', motif: '^frais de port' },
  { famille: 'IGNORE', motif: '^avoir ' },
  { famille: 'IGNORE', motif: '^cout commande' },
  { famille: 'IGNORE', motif: '^plus valu' },
  { famille: 'IGNORE', motif: '^option ' },
  { famille: 'IGNORE', motif: '^mur-rideau comprenant' },
  { famille: 'IGNORE', motif: '^a mettre avec' },
  { famille: 'IGNORE', motif: '^anodic' },          // teinte seule
  { famille: 'IGNORE', motif: '^gris [0-9#]' },     // teinte seule

  // ── Volets roulants ────────────────────────────────────────────────────────
  // « lou-?vr » et « vr ?tra » rattrapent aussi les codes Loubat déformés à
  // la lecture du PDF (LOUVR-VRI, LOEJ-VR-VR1 : VRTRADI…).
  { famille: 'VR', code: 'VR', motif: '^lou-?vr' },
  { famille: 'VR', code: 'VR', motif: 'vr ?tra' },
  { famille: 'VR', code: 'VR', motif: '^vr ' },
  { famille: 'VR', code: 'VR', motif: '^tablier' },
  { famille: 'VR', code: 'VR', motif: '^volets? roulant' },
  { famille: 'VR', code: 'VR', motif: '^volet tradi' },
  { famille: 'VR', code: 'VR', motif: '^tradi ' },
  { famille: 'VR', code: 'VR', motif: '^bloc volet' },

  // ── Achetés pour être livrés (AUTRES) ──────────────────────────────────────
  { famille: 'AUTRES', code: 'VB',    motif: '^lou-vb-' },
  { famille: 'AUTRES', code: 'VB',    motif: '^volets? battant' },
  { famille: 'AUTRES', code: 'VB',    motif: '^volet alu a cadre' },
  { famille: 'AUTRES', code: 'MOUST', motif: '^lou-moust-' },
  { famille: 'AUTRES', code: 'MOUST', motif: '^moust' },             // Moustiquaire, Moust.
  { famille: 'AUTRES', code: 'COFFRE', motif: '^lou-a-c' },
  { famille: 'AUTRES', code: 'COFFRE', motif: ': ?coffre' },           // codes Loubat déformés (LOUA-C1 : COFFRE…)
  { famille: 'AUTRES', code: 'DIV',   motif: '^lou-a-a' },             // accessoire seul ou axe
  { famille: 'AUTRES', code: 'DIV',   motif: '^lou-vc-' },             // volets coulissants
  { famille: 'AUTRES', code: 'DIV',   motif: '^volets? coulissant' },
  { famille: 'AUTRES', code: 'DIV',   motif: '^lou-l' },               // portes enroulables Loubatech
  { famille: 'AUTRES', code: 'DIV',   motif: '^porte sectionnelle' },  // avant la règle « porte »
  { famille: 'AUTRES', code: 'DIV',   motif: 'vmc' },
  { famille: 'AUTRES', code: 'DIV',   motif: '^poignee' },
  { famille: 'AUTRES', code: 'DIV',   motif: '^accessoires?' },
  { famille: 'AUTRES', code: 'DIV',   motif: '^nuki' },
  { famille: 'AUTRES', code: 'DIV',   motif: '^corniere' },
  { famille: 'AUTRES', code: 'DIV',   motif: '^tube ' },
  { famille: 'AUTRES', code: 'DIV',   motif: '^couvre joint' },
  // Quincaillerie et accessoires vendus seuls
  { famille: 'AUTRES', code: 'DIV',   motif: '^([0-9]+ )?gaches?( |$)' },
  { famille: 'AUTRES', code: 'DIV',   motif: '^(organigramme )?cylindre' },
  { famille: 'AUTRES', code: 'DIV',   motif: '^serrure' },
  { famille: 'AUTRES', code: 'DIV',   motif: '^cremone' },
  { famille: 'AUTRES', code: 'DIV',   motif: '^verrou' },
  { famille: 'AUTRES', code: 'DIV',   motif: '^compas' },
  { famille: 'AUTRES', code: 'DIV',   motif: '^ferme imposte' },
  { famille: 'AUTRES', code: 'DIV',   motif: '^fermeture' },
  { famille: 'AUTRES', code: 'DIV',   motif: '^(judas|butoir|cuvette|equerre|rehausse|appui|stylo|malette)' },
  { famille: 'AUTRES', code: 'DIV',   motif: '^plat ' },
  { famille: 'AUTRES', code: 'DIV',   motif: '^habillage' },
  { famille: 'AUTRES', code: 'DIV',   motif: '^tole ' },
  { famille: 'AUTRES', code: 'DIV',   motif: '^lame ' },
  { famille: 'AUTRES', code: 'DIV',   motif: '^axe ' },
  { famille: 'AUTRES', code: 'DIV',   motif: '^boite de vis' },
  { famille: 'AUTRES', code: 'DIV',   motif: '^([0-9]+ metres de )?joint' },
  { famille: 'AUTRES', code: 'DIV',   motif: '^sous[- ]face' },
  { famille: 'AUTRES', code: 'DIV',   motif: '^cadre n' },
  { famille: 'AUTRES', code: 'DIV',   motif: '^dormant renovation' },
  { famille: 'AUTRES', code: 'DIV',   motif: '^traverse' },
  { famille: 'AUTRES', code: 'DIV',   motif: '^(telecommande|tahoma|emeteur|cde )' },
  { famille: 'AUTRES', code: 'DIV',   motif: '^accesssoire' },          // faute de frappe rencontrée
  { famille: 'AUTRES', code: 'DIV',   motif: '^cnorniere' },            // faute de frappe rencontrée
  { famille: 'AUTRES', code: 'DIV',   motif: '^ensemble (de corniere|parcloses)' },

  // ── Menuiseries fabriquées par Atrial (ALU ou PVC selon la gamme) ──────────
  { famille: 'MENUISERIE', code: 'COUL',  motif: '^couliss' },           // Coulissant, Couliss.
  { famille: 'MENUISERIE', code: 'COUL',  motif: '^baie coulissante' },
  { famille: 'MENUISERIE', code: 'COUL',  motif: '^galandage' },
  { famille: 'MENUISERIE', code: 'PF',    motif: '^p\\.fenetre' },
  { famille: 'MENUISERIE', code: 'PF',    motif: '^porte fenetre' },     // avant la règle « porte »
  { famille: 'MENUISERIE', code: 'FEN',   motif: '^fenetre' },
  { famille: 'MENUISERIE', code: 'PE',    motif: "^porte d'entree" },
  { famille: 'MENUISERIE', code: 'PS',    motif: '^porte de service' },
  { famille: 'MENUISERIE', code: 'PORTE', motif: '^porte' },             // porte lourde, panneau…
  { famille: 'MENUISERIE', code: 'F',     motif: '^chassis' },
  { famille: 'MENUISERIE', code: 'F',     motif: '^fixe' },
];

// Ordre d'affichage des codes dans la ligne « contenu » de l'étiquette.
// Un code absent de cette liste est affiché à la fin.
const ORDRE_CODES = [
  'COUL', 'OF1', 'OF2', 'OB1', 'OB2', 'FEN', 'PF1', 'PF2', 'PF', 'F', 'S',
  'PE1', 'PE', 'PS1', 'PS', 'PORTE', 'VR', 'VB', 'MOUST', 'COFFRE', 'DIV',
];

// Légende affichée en bas de l'écran.
const LEGENDE_CODES = {
  OF: 'ouvrant à la française', OB: 'oscillo-battant', PF: 'porte-fenêtre', FEN: 'fenêtre',
  F: 'châssis fixe', S: 'soufflet', COUL: 'coulissant', PE: 'porte d’entrée',
  PS: 'porte de service', PORTE: 'autre porte', VR: 'volet roulant', VB: 'volet battant',
  MOUST: 'moustiquaire', COFFRE: 'coffre', DIV: 'divers (accessoires, kits…)',
};

// Ligne « Ensemble(s) comprenant » avec une quantité supérieure à 1 : faut-il
// multiplier ses éléments ? Non par défaut (à trancher par Michel).
const MULTIPLIER_PAR_ENSEMBLE = false;

// Gamme de l'ARC absente ou MIXTE : on ne sait pas répartir les menuiseries
// entre ALU et PVC. Elles sont comptées dans cette famille, et l'affaire est
// signalée dans les logs. Valeurs possibles : 'ALU' ou 'PVC'.
const GAMME_PAR_DEFAUT = 'ALU';

// ── 2. Statut Production (arc_commandes.statut_suivi) ────────────────────────
//  null = affaire non affichée.
const STATUT_PRODUCTION = {
  attente_acompte: 'GAGNEE',
  appro:           'APPRO',
  planifie:        'FAB',
  fabrication:     'FAB',
  fini:            'FINI',
  attente_solde:   'FINI',
  livre:           'FINI',   // sortie réalisée : voir SUIVI_SORTIE_REALISEE
  attente:         null,
  annule:          null,
};

// Statut du suivi Atrial qui vaut « sortie réalisée », même si le stop LIVRIAL
// est encore « à livrer » (affaire livrée sans passer par l'application).
const SUIVI_SORTIE_REALISEE = 'livre';

// ── 3. Statut Sortie (phases LIVRIAL) ────────────────────────────────────────
//  Libellés affichés. LIVREE devient « ENLEVÉE » pour un enlèvement ou un
//  transporteur.
const LIBELLES_PRODUCTION = { GAGNEE: 'GAGNÉE', APPRO: 'APPRO', FAB: 'FAB', FINI: 'FINI' };
const LIBELLES_SORTIE = {
  NON_PRETE: 'NON PRÊTE', PREPARATION: 'EN PRÉPARATION', PRETE: 'PRÊTE',
  EN_LIVRAISON: 'EN LIVRAISON', LIVREE: 'LIVRÉE', ENLEVEE: 'ENLEVÉE',
};

// ── 4. Retard (règle provisoire) ─────────────────────────────────────────────
//  Une sortie non réalisée est en retard si :
//    - sa date est atteinte ou dépassée et la production n'est pas FINI ;
//    - ou sa date est dépassée (strictement avant aujourd'hui).
//  RETARD_DES_LE_JOUR_MEME = true : toute sortie non réalisée est aussi en
//  retard dès le jour prévu (lecture stricte de la règle ; tout le jour en
//  cours passerait alors en rouge dès le matin).
const RETARD_DES_LE_JOUR_MEME = false;

// Nombre maximal de jours lus en une requête (garde-fou).
const PERIODE_MAX_JOURS = 31;

module.exports = {
  CODES_ARC, REGLES_DESIGNATION, ORDRE_CODES, LEGENDE_CODES,
  MULTIPLIER_PAR_ENSEMBLE, GAMME_PAR_DEFAUT,
  STATUT_PRODUCTION, SUIVI_SORTIE_REALISEE,
  LIBELLES_PRODUCTION, LIBELLES_SORTIE, RETARD_DES_LE_JOUR_MEME, PERIODE_MAX_JOURS,
};
