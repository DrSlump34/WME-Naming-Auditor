// ==UserScript==
// @name         WME Agglo Naming (FR)
// @namespace    https://github.com/DrSlump34
// @version      1.75
// @description  Audit du nommage des segments selon la regle FR agglomeration / hors agglomeration : contours communaux INSEE + polygone d'agglomeration trace a la main
// @author       DrSlump34
// @match        https://www.waze.com/editor*
// @match        https://www.waze.com/*/editor*
// @match        https://beta.waze.com/editor*
// @match        https://beta.waze.com/*/editor*
// @grant        GM_xmlhttpRequest
// @connect      geo.api.gouv.fr
// @connect      api.wazefrance.com
// @run-at       document-idle
// ==/UserScript==

/* eslint-disable no-console */
(function () {
  'use strict';

  /**
   * Fenetre de la PAGE. Des qu'un @grant est declare, Tampermonkey execute le
   * script dans un contexte isole ou `window` n'est plus celui de WME : le SDK
   * et le modele ne s'y trouvent pas. `unsafeWindow` rend la vraie fenetre ;
   * le repli sur `window` sert quand le script est charge autrement (test).
   */
  const hote = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;

  const SCRIPT_ID = 'wme-agglo-naming';
  const SCRIPT_NAME = 'WME Agglo Naming';
  const VERSION = '1.75';
  const STORE_AGGLOS = 'wmeAggloNaming.agglos';
  // Communes declarees SANS agglomeration, par code INSEE. Un choix explicite
  // et durable, pas une boite de dialogue qu'on clique sans lire.
  const STORE_SANS_AGGLO = 'wmeAggloNaming.sansAgglo';
  const STORE_UI = 'wmeAggloNaming.ui';
  const IDB_NAME = 'wmeAggloNaming';
  const IDB_STORE = 'contours';
  const LAYER_COMMUNE = SCRIPT_ID + '-commune';
  const LAYER_AGGLO = SCRIPT_ID + '-agglo';
  const LAYER_ECARTS = SCRIPT_ID + '-ecarts';
  const LAYER_ADRESSES = SCRIPT_ID + '-adresses';   // points : HN et POI residentiels

  // Familles de problemes : chacune a sa couleur de surlignage, reglable.
  // Palette choisie pour NE PAS se confondre avec le rendu de WME : le reseau
  // routier y est massivement orange-jaune (#ee9900 releve en zone rurale),
  // les alertes rouges (#e53935), les rues blanches ou grises. On s'en tient
  // donc aux magentas, violets, cyans et turquoises — rares sur la carte — et
  // le trait est large et transparent pour se lire comme un halo DERRIERE le
  // segment plutot que comme un trait concurrent. Tout reste reglable.
  const FAMILLES = {
    agglo: { libelle: 'En agglomeration (C / R)', defaut: '#00b0ff' },
    hors: { libelle: 'Hors agglomeration (H)', defaut: '#d500f9' },
    eb10: { libelle: 'A couper — entree agglo', defaut: '#ff1744' },
    lim: { libelle: 'A couper — limite communale', defaut: '#1de9b6' },
    cartouche: { libelle: 'Cartouche seul (nommage bon)', defaut: '#7c4dff' },
    forme: { libelle: 'Redaction du nom seule', defaut: '#76ff03' },
    special: { libelle: 'Bretelle / voie ferree / rocade', defaut: '#ff4081' },
    giratoire: { libelle: 'Giratoires', defaut: '#00e676' },
    adresse: { libelle: 'Adressage (numeros / POI residentiels)', defaut: '#00e5ff' }
  };
  const familleDe = f => f.adresse ? 'adresse'
    : f.cas === 'GIR' ? 'giratoire'
    : f.special ? 'special'
    : f.seulementCartouche ? 'cartouche' : f.seulementForme ? 'forme'
    : f.cas === 'EB10' ? 'eb10' : f.cas === 'LIM' ? 'lim'
    : (f.cas[0] === 'C' || f.cas[0] === 'R') ? 'agglo' : 'hors';

  const log = (...a) => console.log('[' + SCRIPT_NAME + ']', ...a);

  // ---------------------------------------------------------------------------
  // Regles metier (logigramme "Regle de nommage en France", Wazeopedia FR)
  //   En ville / commune          : C1 C2 C3 C4
  //   En ville / village rattache : R1 R2 R3 R4
  //   Hors agglomeration          : H5 H6 H7 H8 H9
  //
  // Le script n'INVENTE jamais un nom ni un numero : il reventile ce qui est
  // deja saisi. Seule la VILLE vient d'ailleurs : du contour INSEE (hors agglo)
  // ou du libelle du polygone d'agglo (en ville).
  // ---------------------------------------------------------------------------

  // ===========================================================================
  // REFERENTIEL FRANCE
  //
  // Tout ce qui suit est propre au pays. Le moteur, lui, ne connait que
  // l'interface decrite en bas de bloc (`REFERENTIELS.FR`) : vocabulaire des
  // numeros de route, types de voies sans adressage, cles du fichier de
  // contours, etat cible du nommage, liste des controles. Ajouter un pays =
  // ecrire un second bloc de ce genre, sans toucher au moteur.
  // ===========================================================================

  // Numero de route : une lettre de reseau, AU MOINS un chiffre, puis
  // eventuellement lettres et chiffres (D6, D2e, N88, A9, M113, C6, VC3, D981a).
  const RE_ROUTE = /^(?:A|N|D|M|E|T|CR|CV|CC|VC|RC|C)\s?\d+[a-zA-Z0-9]*$/;
  const RE_COMMUNALE = /^(?:C|CV|CC|VC|RC|CR)\s?\d+/i;
  // Autoroute Axxx : AUCUNE ville, ni en principal ni en alternatif, et ce
  // quelle que soit la zone traversee. Regle systematique, sans exception.
  const RE_AUTOROUTE = /^A\s?\d+/;

  // Voies qui ne portent NI ville NI nom de rue : ferry, voie ferree, piste.
  const ROADTYPE_SANS_ADRESSE_TOTALE = new Set([15, 18, 19]);

  // Types sans vocation d'adressage : une absence de nom n'y est PAS une
  // anomalie (retour terrain : parkings et voies privees de Saint-Laurent-des-
  // Arbres). Exclus par defaut, reintegrables par la case a cocher.
  //  17 = voie privee, 20 = parking
  // /!\ Sentiers (5) et escaliers (16) N'EN SONT PAS : l'auteur a tranche le
  // 21/07 — ils repondent aux regles de nommage meme s'ils ne sont pas
  // circulables. Ils sont donc analyses comme n'importe quelle voie.
  const ROADTYPE_SANS_ADRESSE = new Set([17, 20]);

  const ROADTYPE_LABEL = {
    1: 'Rue', 2: 'Route principale', 3: 'Autoroute', 4: 'Bretelle', 5: 'Sentier',
    6: 'Voie rapide', 7: 'Route secondaire', 8: 'Chemin de terre', 10: 'Chemin pietonnier',
    15: 'Ferry', 16: 'Escalier', 17: 'Voie privee', 18: 'Voie ferree', 19: 'Piste',
    20: 'Voie de parking', 22: 'Ruelle'
  };

  // ⚠️ Identifier une rocade est le point faible : rien dans le modele Waze ne
  // dit « ceci est une rocade ». On s'en tient au NOM, seul indice fiable — une
  // rocade nommee autrement passera au travers, et c'est assume.
  const RE_ROCADE = /(p[ée]riph[ée]rique|rocade|voie rapide urbaine|ceinture)/i;

  // --- Controles de forme du nom (guide FR, section « Ce qu'il ne faut PAS faire ») ---
  // Abreviations de type de voie : le point est exige pour eviter les faux
  // positifs (« Bd » seul est rare, « Bd. » ne l'est pas).
  const RE_ABREV = /(^|\s)(av|bd|bld|blvd|bvd|rte|rt|ch|pl|imp|all|sq|fbg)\.(\s|$)/i;
  const RE_ABREV_SANS_POINT = /^(av|bd|bld|blvd|rte)\s+[a-zà-ÿ]/i;
  // Contraction de saint : « St-Fargeau », « Ste Marie ».
  const RE_SAINT = /(^|\s)[Ss]te?s?[-\s][A-ZÀ-Ý]/;
  // Fonction du segment ou nature du lieu dans le nom.
  const RE_FONCTION = /(voie de bus|voie bus|couloir bus|piste cyclable|parking|par[ck]ing|acc[eè]s livraison|voie de service)/i;
  // Direction dans le nom, hors bretelles (ou elle est la regle).
  const RE_DIRECTION = /\s:\s|\s>\s|^>\s/;

  /** Une initiale isolee (« R. Poincare ») est une contraction interdite ; deux
   *  ou plus (« T.I.V. », « D.B. ») sont une abreviation officielle, autorisee. */
  function initialeIsolee(nom) {
    const points = (nom.match(/\b[A-ZÀ-Ý]\./g) || []).length;
    return points === 1;
  }

  const CLES_NOM = ['nom', 'NOM', 'name', 'NOM_COM', 'nom_commune', 'libelle', 'LIBELLE', 'com_name', 'nomcom'];
  const CLES_CODE = ['code', 'INSEE_COM', 'insee', 'code_insee', 'codeInsee', 'CODE_INSEE', 'com_code', 'insee_com'];

  // ---------------------------------------------------------------------------
  // Etat
  // ---------------------------------------------------------------------------

  let sdk = null;
  let communes = [];
  let metaContours = null;
  let agglos = {};
  let sansAgglo = {};        // { <code INSEE>: true }
  let communeActive = null;
  let findings = [];
  let lastScan = null;
  let ui = {};
  // seuil : part de longueur (0-1) au-dela de laquelle un segment a cheval est
  // rattache d'office a un cote. Entre (1 - seuil) et seuil = zone grise.
  let options = {
    sansAdresse: false, altEnTrop: false, seuil: 0.8,
    zoomClic: true, zoomNiveau: 17, surligner: true,
    controles: {},          // rempli d'apres le referentiel au demarrage
    couleurs: Object.fromEntries(Object.entries(FAMILLES).map(([k, v]) => [k, v.defaut]))
  };

  // ---------------------------------------------------------------------------
  // Stockage
  // ---------------------------------------------------------------------------

  function idb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbSet(cle, valeur) {
    const db = await idb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(valeur, cle);
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
  }
  async function idbGet(cle) {
    const db = await idb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(cle);
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
  }

  const lire = (cle, defaut) => {
    try { const v = localStorage.getItem(cle); return v ? JSON.parse(v) : defaut; }
    catch (e) { return defaut; }
  };
  const ecrire = (cle, val) => {
    try { localStorage.setItem(cle, JSON.stringify(val)); } catch (e) { log('ecriture ' + cle, e); }
  };
  const saveAgglos = () => ecrire(STORE_AGGLOS, agglos);
  const saveSansAgglo = () => ecrire(STORE_SANS_AGGLO, sansAgglo);

  function saveUI() {
    const o = ui.overlay;
    const r = o.getBoundingClientRect();
    const memo = lire(STORE_UI, {});
    // ⚠️ Fenetre repliee : sa hauteur ne represente rien (juste l'en-tete). La
    // memoriser la rendait minuscule au demarrage suivant — bug vecu.
    const replie = o.classList.contains('agn-replie');
    ecrire(STORE_UI, {
      x: r.left, y: r.top,
      w: o.offsetWidth,
      h: replie ? (ui.hAvantRepli || memo.h || 560) : o.offsetHeight,
      ouvert: o.style.display !== 'none', options,
      vue: vueCourante, uiV: 2
    });
  }

  // ---------------------------------------------------------------------------
  // Geometrie
  // ---------------------------------------------------------------------------

  function pointInRing(lon, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  function pointInRings(lon, lat, rings) {
    if (!rings || !rings.length || !pointInRing(lon, lat, rings[0])) return false;
    for (let i = 1; i < rings.length; i++) if (pointInRing(lon, lat, rings[i])) return false;
    return true;
  }
  function pointInGeom(lon, lat, geom) {
    if (!geom) return false;
    if (geom.type === 'Polygon') return pointInRings(lon, lat, geom.coordinates);
    if (geom.type === 'MultiPolygon') return geom.coordinates.some(p => pointInRings(lon, lat, p));
    return false;
  }
  function bboxOf(geom) {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    const p = co => {
      if (typeof co[0] === 'number') {
        if (co[0] < a) a = co[0]; if (co[0] > c) c = co[0];
        if (co[1] < b) b = co[1]; if (co[1] > d) d = co[1];
      } else co.forEach(p);
    };
    p(geom.coordinates);
    return [a, b, c, d];
  }
  const bboxIntersecte = (x, y) => !(x[2] < y[0] || x[0] > y[2] || x[3] < y[1] || x[1] > y[3]);

  function centreDe(coords) {
    const i = Math.floor(coords.length / 2);
    return { lon: coords[i][0], lat: coords[i][1] };
  }

  // ---------------------------------------------------------------------------
  // Contours communaux
  // ---------------------------------------------------------------------------

  function litPropriete(props, cles) {
    for (const c of cles) if (props && props[c] != null && props[c] !== '') return String(props[c]);
    return null;
  }

  function chargerFeatureCollection(fc, nomFichier) {
    const feats = fc.type === 'FeatureCollection' ? fc.features : [fc];
    const out = []; let sansNom = 0;
    for (const f of feats) {
      if (!f || !f.geometry) continue;
      const nom = litPropriete(f.properties, REF.clesNom);
      const code = litPropriete(f.properties, REF.clesCode);
      if (!nom) { sansNom++; continue; }
      out.push({ code: code || nom, nom, geom: f.geometry, bbox: bboxOf(f.geometry) });
    }
    if (!out.length) throw new Error('aucune commune exploitable (nom introuvable dans les proprietes)');
    communes = out;
    metaContours = { nom: nomFichier, nb: out.length, date: new Date().toISOString().slice(0, 10), sansNom };
    return { nb: out.length, sansNom };
  }

  async function restaurerContours() {
    try {
      const c = await idbGet('communes'), m = await idbGet('meta');
      if (Array.isArray(c) && c.length) { communes = c; metaContours = m || null; return true; }
    } catch (e) { log('restauration des contours impossible', e); }
    return false;
  }

  function surFichierContours() {
    const f = ui.inputFichier.files[0]; if (!f) return;
    // Un chargement REMPLACE les contours en base. Sans ce garde-fou, on perd
    // silencieusement le fichier precedent (vecu).
    if (metaContours && metaContours.nb && !confirm(
      'Des contours sont deja charges : ' + metaContours.nb + ' commune(s) (' + metaContours.nom + ').\n\n' +
      'Charger ce fichier va les REMPLACER.\n\nContinuer ?')) { ui.inputFichier.value = ''; return; }
    ui.statutContours.innerHTML = '<div class="agn-stat">Lecture de ' + esc(f.name) + '…</div>';
    const r = new FileReader();
    r.onload = async () => {
      try {
        const res = chargerFeatureCollection(JSON.parse(r.result), f.name);
        await idbSet('communes', communes); await idbSet('meta', metaContours);
        rafraichirCommunesDeLaVue(); renderContours();
        replierSection('contours', false);     // etape faite : on rend la place
        log(res.nb + ' commune(s) chargee(s)');
      } catch (e) {
        ui.statutContours.innerHTML = '<div class="agn-stat agn-alerte">Fichier illisible : ' + esc(e.message) + '</div>';
      }
    };
    r.readAsText(f);
  }

  // ---------------------------------------------------------------------------
  // Sources de contours
  //
  // ⚠️ La CSP de WME interdit tout appel reseau sortant depuis la page : seul
  // GM_xmlhttpRequest passe, d'ou le @grant. Quand il est absent (script charge
  // hors gestionnaire, pour tester), on retombe sur fetch — qui echouera dans
  // WME, mais on le dit clairement plutot que d'echouer en silence.
  // ---------------------------------------------------------------------------

  function telecharger(url) {
    const gm = (typeof GM_xmlhttpRequest !== 'undefined') ? GM_xmlhttpRequest
             : (typeof GM !== 'undefined' && GM.xmlHttpRequest) ? GM.xmlHttpRequest : null;
    if (gm) {
      return new Promise((resolve, reject) => {
        gm({ method: 'GET', url, timeout: 120000,
          onload: r => (r.status >= 200 && r.status < 300)
            ? resolve(r.responseText) : reject(new Error('HTTP ' + r.status)),
          onerror: () => reject(new Error('appel refuse')),
          ontimeout: () => reject(new Error('delai depasse')) });
      });
    }
    return fetch(url).then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).catch(e => {
      throw new Error(e.message + ' — appel direct bloque par WME ; ' +
        'installe le script dans Tampermonkey pour utiliser cette source');
    });
  }

  const SOURCES = {
    fichier: { libelle: 'Fichier GeoJSON local' },
    gouv: {
      libelle: 'API Decoupage administratif (geo.api.gouv.fr)',
      // Contours Admin Express (IGN) + Code Officiel Geographique (INSEE).
      url: dep => 'https://geo.api.gouv.fr/departements/' + encodeURIComponent(dep) +
        '/communes?fields=nom,code,contour&format=geojson&geometry=contour',
      aide: 'Numero de departement (01 a 95, 2A, 2B, 971…). ~3 Mo et ~10 s par departement.'
    },
    wazefrance: {
      libelle: 'api.wazefrance.com (a confirmer)',
      indisponible: 'Cette source expose des statistiques BAN, mais aucun point ' +
        'd\'entree documente pour les contours de communes. ' +
        'A confirmer avec Sebiseba avant activation.'
    }
  };

  // Les 101 departements, pour le selecteur integre a la fenetre.
  const DEPARTEMENTS = [
{"code":"01","nom":"Ain"},{"code":"02","nom":"Aisne"},{"code":"03","nom":"Allier"},{"code":"04","nom":"Alpes-de-Haute-Provence"},
{"code":"05","nom":"Hautes-Alpes"},{"code":"06","nom":"Alpes-Maritimes"},{"code":"07","nom":"Ardèche"},{"code":"08","nom":"Ardennes"},
{"code":"09","nom":"Ariège"},{"code":"10","nom":"Aube"},{"code":"11","nom":"Aude"},{"code":"12","nom":"Aveyron"},
{"code":"13","nom":"Bouches-du-Rhône"},{"code":"14","nom":"Calvados"},{"code":"15","nom":"Cantal"},{"code":"16","nom":"Charente"},
{"code":"17","nom":"Charente-Maritime"},{"code":"18","nom":"Cher"},{"code":"19","nom":"Corrèze"},{"code":"21","nom":"Côte-d'Or"},
{"code":"22","nom":"Côtes-d'Armor"},{"code":"23","nom":"Creuse"},{"code":"24","nom":"Dordogne"},{"code":"25","nom":"Doubs"},
{"code":"26","nom":"Drôme"},{"code":"27","nom":"Eure"},{"code":"28","nom":"Eure-et-Loir"},{"code":"29","nom":"Finistère"},
{"code":"2A","nom":"Corse-du-Sud"},{"code":"2B","nom":"Haute-Corse"},{"code":"30","nom":"Gard"},{"code":"31","nom":"Haute-Garonne"},
{"code":"32","nom":"Gers"},{"code":"33","nom":"Gironde"},{"code":"34","nom":"Hérault"},{"code":"35","nom":"Ille-et-Vilaine"},
{"code":"36","nom":"Indre"},{"code":"37","nom":"Indre-et-Loire"},{"code":"38","nom":"Isère"},{"code":"39","nom":"Jura"},
{"code":"40","nom":"Landes"},{"code":"41","nom":"Loir-et-Cher"},{"code":"42","nom":"Loire"},{"code":"43","nom":"Haute-Loire"},
{"code":"44","nom":"Loire-Atlantique"},{"code":"45","nom":"Loiret"},{"code":"46","nom":"Lot"},{"code":"47","nom":"Lot-et-Garonne"},
{"code":"48","nom":"Lozère"},{"code":"49","nom":"Maine-et-Loire"},{"code":"50","nom":"Manche"},{"code":"51","nom":"Marne"},
{"code":"52","nom":"Haute-Marne"},{"code":"53","nom":"Mayenne"},{"code":"54","nom":"Meurthe-et-Moselle"},{"code":"55","nom":"Meuse"},
{"code":"56","nom":"Morbihan"},{"code":"57","nom":"Moselle"},{"code":"58","nom":"Nièvre"},{"code":"59","nom":"Nord"},
{"code":"60","nom":"Oise"},{"code":"61","nom":"Orne"},{"code":"62","nom":"Pas-de-Calais"},{"code":"63","nom":"Puy-de-Dôme"},
{"code":"64","nom":"Pyrénées-Atlantiques"},{"code":"65","nom":"Hautes-Pyrénées"},{"code":"66","nom":"Pyrénées-Orientales"},
{"code":"67","nom":"Bas-Rhin"},{"code":"68","nom":"Haut-Rhin"},{"code":"69","nom":"Rhône"},{"code":"70","nom":"Haute-Saône"},
{"code":"71","nom":"Saône-et-Loire"},{"code":"72","nom":"Sarthe"},{"code":"73","nom":"Savoie"},{"code":"74","nom":"Haute-Savoie"},
{"code":"75","nom":"Paris"},{"code":"76","nom":"Seine-Maritime"},{"code":"77","nom":"Seine-et-Marne"},{"code":"78","nom":"Yvelines"},
{"code":"79","nom":"Deux-Sèvres"},{"code":"80","nom":"Somme"},{"code":"81","nom":"Tarn"},{"code":"82","nom":"Tarn-et-Garonne"},
{"code":"83","nom":"Var"},{"code":"84","nom":"Vaucluse"},{"code":"85","nom":"Vendée"},{"code":"86","nom":"Vienne"},
{"code":"87","nom":"Haute-Vienne"},{"code":"88","nom":"Vosges"},{"code":"89","nom":"Yonne"},{"code":"90","nom":"Territoire de Belfort"},
{"code":"91","nom":"Essonne"},{"code":"92","nom":"Hauts-de-Seine"},{"code":"93","nom":"Seine-Saint-Denis"},{"code":"94","nom":"Val-de-Marne"},
{"code":"95","nom":"Val-d'Oise"},{"code":"971","nom":"Guadeloupe"},{"code":"972","nom":"Martinique"},{"code":"973","nom":"Guyane"},
{"code":"974","nom":"La Réunion"},{"code":"976","nom":"Mayotte"}
];

  const normSansAccent = t => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  /**
   * Telecharge un ou plusieurs departements et les fusionne en un seul jeu de
   * contours — l'equivalent de l'outil Recuperer-Communes.html, mais sans
   * passer par un fichier.
   */
  async function chargerDepuisGouv(codes, surAvancement) {
    const liste = (Array.isArray(codes) ? codes : [codes]).map(c => String(c).trim().toUpperCase());
    if (!liste.length) throw new Error('aucun departement selectionne');
    const features = [];
    const echecs = [];
    for (let i = 0; i < liste.length; i++) {
      const d = liste[i];
      if (surAvancement) surAvancement(i + 1, liste.length, d);
      try {
        const fc = JSON.parse(await telecharger(SOURCES.gouv.url(d)));
        const lot = (fc.features || []).filter(f => f && f.geometry);
        if (!lot.length) throw new Error('aucun contour renvoye');
        features.push(...lot);
      } catch (e) { echecs.push(d + ' (' + e.message + ')'); }
    }
    if (!features.length) throw new Error('rien de recupere' + (echecs.length ? ' — ' + echecs[0] : ''));
    const nomSource = 'geo.api.gouv.fr — dep. ' + liste.join(', ');
    const res = chargerFeatureCollection({ type: 'FeatureCollection', features }, nomSource);
    await idbSet('communes', communes); await idbSet('meta', metaContours);
    rafraichirCommunesDeLaVue(); renderContours();
    replierSection('contours', false);         // etape faite : on rend la place
    return { nb: res.nb, echecs };
  }

  function communesDeLaVue() {
    if (!communes.length) return [];
    let ext; try { ext = sdk.Map.getMapExtent(); } catch (e) { return []; }
    if (!ext || ext.length !== 4) return [];
    return communes.filter(c => bboxIntersecte(c.bbox, ext)).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  }

  function rafraichirCommunesDeLaVue() {
    if (!ui.selCommune) return;
    const liste = communesDeLaVue();
    const avant = communeActive ? communeActive.code : '';
    ui.selCommune.innerHTML = '<option value="">— choisir une commune —</option>' +
      liste.map(c => `<option value="${esc(c.code)}">${esc(c.nom)}</option>`).join('');
    if (avant && liste.some(c => c.code === avant)) ui.selCommune.value = avant;
    else if (communeActive) { communeActive = null; redrawCommune(); }
    ui.nbCommunes.textContent = communes.length
      ? liste.length + ' commune(s) dans la vue sur ' + communes.length : '';
    renderAgglos();
  }

  // ---------------------------------------------------------------------------
  // Calques
  // ---------------------------------------------------------------------------

  let calquesPrets = false;
  /**
   * ⚠️⚠️ `pointerEvents:'none'` EST OBLIGATOIRE SUR TOUS NOS CALQUES.
   *
   * WME rend les couches vectorielles en SVG, et une feature y nait avec
   * `pointer-events: visiblepainted` : elle capte donc la souris sur toute sa
   * surface peinte. Consequences vecues (bug remonte par l'auteur le 21/07,
   * « quand un segment est surligne, impossible de le selectionner ») :
   *  - le surlignage est un trait de 14 px pose SUR le segment : il avalait le
   *    clic, et WME ne voyait jamais le segment en dessous ;
   *  - pire, le contour communal et le polygone d'agglo sont des surfaces
   *    REMPLIES (fillOpacity 0,05 et 0,12) : elles captaient le clic sur toute
   *    leur etendue, donc sur la commune entiere.
   * Verifie en live : le style est bien transmis (`getFeatureDomElement` rend
   * `pointer-events: none`), et nos calques cessent d'intercepter la souris.
   * ⚠️ En contrepartie, le survol de nos features ne declenche plus les
   * evenements du SDK : l'infobulle est donc calculee a la main (voir
   * `installerInfobulle`). Ne PAS remettre `trackLayerEvents` sans rendre le
   * clic a WME d'une autre facon.
   */
  const INERTE = { pointerEvents: 'none' };
  function ensureLayers() {
    if (calquesPrets) return;
    const etiquette = { etiquette: ctx => (ctx.feature.properties || {}).label || '' };
    try {
      sdk.Map.addLayer({
        layerName: LAYER_COMMUNE, styleContext: etiquette,
        styleRules: [{ style: Object.assign({
          strokeColor: '#1e88e5', strokeWidth: 3, strokeOpacity: 0.95, strokeDashstyle: 'dash',
          fillColor: '#1e88e5', fillOpacity: 0.05, label: '${etiquette}',
          fontColor: '#1565c0', fontSize: '15px', fontWeight: 'bold',
          labelOutlineColor: '#fff', labelOutlineWidth: 3 }, INERTE) }]
      });
      sdk.Map.addLayer({
        layerName: LAYER_AGGLO, styleContext: etiquette,
        styleRules: [{ style: Object.assign({
          strokeColor: '#e91e63', strokeWidth: 3, strokeOpacity: 0.9,
          fillColor: '#e91e63', fillOpacity: 0.12, label: '${etiquette}',
          fontColor: '#c2185b', fontSize: '14px', fontWeight: 'bold',
          labelOutlineColor: '#fff', labelOutlineWidth: 3 }, INERTE) }]
      });
      // Surlignage des segments en ecart : la couleur et l'epaisseur sont
      // portees par la feature et resolues via le styleContext.
      sdk.Map.addLayer({
        layerName: LAYER_ECARTS,
        styleContext: {
          couleur: ctx => (ctx.feature.properties || {}).couleur || '#888888',
          epaisseur: ctx => (ctx.feature.properties || {}).epaisseur || 9
        },
        styleRules: [{ style: Object.assign({
          strokeColor: '${couleur}', strokeWidth: '${epaisseur}', strokeOpacity: 0.45,
          strokeLinecap: 'round', fill: false }, INERTE) }]
      });
      // Les ecarts d'ADRESSE sont des points (un numero, un POI), pas des
      // lignes : le calque des segments a `fill:false` et ne les montrerait
      // pas. D'ou un calque a part, avec un rayon plutot qu'une epaisseur.
      sdk.Map.addLayer({
        layerName: LAYER_ADRESSES,
        styleContext: {
          couleur: ctx => (ctx.feature.properties || {}).couleur || '#00e5ff',
          rayon: ctx => (ctx.feature.properties || {}).rayon || 7,
          etiquette: ctx => (ctx.feature.properties || {}).label || ''
        },
        styleRules: [{ style: Object.assign({
          pointRadius: '${rayon}', fillColor: '${couleur}', fillOpacity: 0.55,
          strokeColor: '${couleur}', strokeWidth: 2, strokeOpacity: 0.95,
          label: '${etiquette}', fontColor: '#004d5a', fontSize: '11px', fontWeight: 'bold',
          labelOutlineColor: '#fff', labelOutlineWidth: 3, labelYOffset: 14 }, INERTE) }]
      });
      calquesPrets = true;
    } catch (e) { log('creation des calques impossible', e); }
  }

  // ---------------------------------------------------------------------------
  // Infobulle de survol sur la carte
  //
  // ⚠️ Elle NE PEUT PLUS reposer sur `wme-layer-feature-mouse-enter` : nos
  // calques sont volontairement inertes a la souris (voir `INERTE`), faute de
  // quoi ils avalent les clics et rendent les segments inselectionnables. On
  // retrouve donc le report survole a la main, par PROXIMITE geometrique : la
  // position de la souris est convertie en coordonnees, puis comparee aux
  // geometries des reports. Calcul limite par un pas de temps et par une boite
  // englobante, sinon on le referait des centaines de fois par seconde.
  // ---------------------------------------------------------------------------

  let souris = { x: 0, y: 0 };
  let bulle = null;
  let survole = null;          // report actuellement sous le curseur
  let tSurvol = 0;

  /** Distance (en degres) d'un point a un segment [a,b]. */
  function distPointSegment(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = a[0] + t * dx, cy = a[1] + t * dy;
    return Math.hypot(p[0] - cx, p[1] - cy);
  }

  /** Distance d'un point a la geometrie d'un report (ligne ou point). */
  function distAuReport(p, f) {
    let best = Infinity;
    for (const g of (f.geoms || [f.geom])) {
      if (!g || !g.coordinates) continue;
      if (g.type === 'Point') { best = Math.min(best, Math.hypot(p[0] - g.coordinates[0], p[1] - g.coordinates[1])); continue; }
      const c = g.coordinates;
      for (let i = 1; i < c.length; i++) best = Math.min(best, distPointSegment(p, c[i - 1], c[i]));
      if (c.length === 1) best = Math.min(best, Math.hypot(p[0] - c[0][0], p[1] - c[0][1]));
    }
    return best;
  }

  function chercherSousLeCurseur() {
    if (!options.surligner || !findings.length) return null;
    let ll;
    try { ll = sdk.Map.getLonLatFromPixel({ x: souris.x, y: souris.y }); } catch (e) { return null; }
    if (!ll) return null;
    const p = [ll.lon, ll.lat];
    // Tolerance = l'epaisseur du trait, convertie en degres a ce zoom.
    let tol = 0.00012;
    try {
      const a = sdk.Map.getLonLatFromPixel({ x: souris.x, y: souris.y });
      const b = sdk.Map.getLonLatFromPixel({ x: souris.x + 9, y: souris.y });
      if (a && b) tol = Math.abs(b.lon - a.lon) || tol;
    } catch (e) { /* on garde la valeur par defaut */ }
    let meilleur = null, dMin = tol;
    for (const f of findings) {
      if (f.traite || !f.geom) continue;
      const d = distAuReport(p, f);
      if (d < dMin) { dMin = d; meilleur = f; }
    }
    return meilleur;
  }

  function installerInfobulle() {
    document.addEventListener('mousemove', e => {
      souris = { x: e.clientX, y: e.clientY };
      if (bulle && bulle.style.display !== 'none') placerBulle();
      // La recherche du report survole coute une passe sur les reports : on ne
      // la refait pas plus de ~12 fois par seconde, et jamais au-dessus de nos
      // propres panneaux.
      const t = Date.now();
      if (t - tSurvol < 80) return;
      tSurvol = t;
      if (e.target && e.target.closest && e.target.closest('#agn-overlay, .agn-sb, #agn-bulle')) {
        if (survole) { survole = null; cacherBulle(); }
        return;
      }
      const f = chercherSousLeCurseur();
      if (f === survole) return;
      survole = f;
      if (f) montrerBulle(f); else cacherBulle();
    }, { passive: true });
  }

  function montrerBulle(f) {
    if (!bulle) { bulle = el('<div id="agn-bulle"></div>'); document.body.appendChild(bulle); }
    bulle.innerHTML =
      `<div class="agn-b-t"><span class="agn-pastille" style="background:${
        options.couleurs[familleDe(f)] || '#888'}"></span>${esc(f.libelle)}
        <span class="agn-cas">${f.cas}</span></div>` +
      (f.nb > 1 ? `<div class="agn-b-l"><b>${f.nb} segments</b> dans la meme situation</div>` : '') +
      f.ecarts.map(e => `<div class="agn-b-l"><b>${esc(e.champ)}</b> : ${esc(e.avant)} → ${esc(e.apres)}</div>`).join('') +
      (f.doute ? `<div class="agn-b-w">⚠ ${esc(f.doute)}</div>` : '') +
      (f.traite ? '<div class="agn-b-ok">✓ marque comme traite</div>' : '');
    bulle.style.display = 'block';
    placerBulle();
  }

  function cacherBulle() { if (bulle) bulle.style.display = 'none'; }

  /** Bascule a gauche / au-dessus du curseur quand on approche des bords. */
  function placerBulle() {
    const l = bulle.offsetWidth, h = bulle.offsetHeight;
    let x = souris.x + 16, y = souris.y + 16;
    if (x + l > window.innerWidth - 8) x = souris.x - l - 16;
    if (y + h > window.innerHeight - 8) y = souris.y - h - 16;
    bulle.style.left = Math.max(4, x) + 'px';
    bulle.style.top = Math.max(4, y) + 'px';
  }

  /** Repeint les ecarts, en mettant en avant celui qui est courant. Les ecarts
   *  de nommage sont des lignes, ceux d'adressage des points : deux calques. */
  function redrawEcarts(idActif) {
    ensureLayers();
    [LAYER_ECARTS, LAYER_ADRESSES].forEach(n => {
      try { sdk.Map.removeAllFeaturesFromLayer({ layerName: n }); } catch (e) { /* */ }
    });
    if (!options.surligner || !findings.length) return;
    // On ne peint que l'onglet courant : sinon la carte montre des ecarts que
    // la liste n'affiche pas, et les deux ne se lisent plus ensemble.
    const vivants = findingsVisibles().filter(f => f.geom && !f.traite);  // un ecart traite ne se surligne plus
    try {
      const lignes = vivants.filter(f => !f.adresse).map(f => ({
        id: 'ec-' + f.segId, type: 'Feature', geometry: f.geom,
        properties: {
          couleur: options.couleurs[familleDe(f)] || '#888888',
          epaisseur: f.segId === idActif ? 22 : 14
        }
      }));
      if (lignes.length) sdk.Map.addFeaturesToLayer({ layerName: LAYER_ECARTS, features: lignes });
    } catch (e) { log('surlignage impossible', e); }
    try {
      const points = vivants.filter(f => f.adresse).map(f => ({
        id: 'ad-' + f.segId, type: 'Feature', geometry: f.geom,
        properties: {
          couleur: options.couleurs.adresse || '#00e5ff',
          rayon: f.segId === idActif ? 11 : 7,
          label: f.nbPoints > 1 ? String(f.nbPoints) : ''
        }
      }));
      if (points.length) sdk.Map.addFeaturesToLayer({ layerName: LAYER_ADRESSES, features: points });
    } catch (e) { log('surlignage des adresses impossible', e); }
  }

  function redrawCommune() {
    ensureLayers();
    try { sdk.Map.removeAllFeaturesFromLayer({ layerName: LAYER_COMMUNE }); } catch (e) { /* */ }
    if (!communeActive) return;
    try {
      sdk.Map.addFeaturesToLayer({ layerName: LAYER_COMMUNE, features: [{
        id: 'commune-' + communeActive.code, type: 'Feature',
        geometry: communeActive.geom, properties: { label: communeActive.nom } }] });
    } catch (e) { log('affichage du contour communal impossible', e); }
  }

  function redrawAgglos() {
    ensureLayers();
    try { sdk.Map.removeAllFeaturesFromLayer({ layerName: LAYER_AGGLO }); } catch (e) { /* */ }
    const liste = communeActive ? (agglos[communeActive.code] || []) : [];
    if (!liste.length) return;
    try {
      sdk.Map.addFeaturesToLayer({ layerName: LAYER_AGGLO, features: liste.map(a => ({
        id: a.id, type: 'Feature', geometry: { type: 'Polygon', coordinates: [a.ring] },
        properties: { label: a.label || '' } })) });
    } catch (e) { log('affichage des agglos impossible', e); }
  }

  // ---------------------------------------------------------------------------
  // Tracer une agglomeration
  // ---------------------------------------------------------------------------

  function extractRing(res) {
    if (!res) return null;
    if (Array.isArray(res) && Array.isArray(res[0]) && typeof res[0][0] === 'number') return res;
    if (res.type === 'Feature' && res.geometry) return extractRing(res.geometry);
    if (res.type === 'Polygon' && res.coordinates) return res.coordinates[0];
    if (res.geometry) return extractRing(res.geometry);
    if (res.coordinates) return Array.isArray(res.coordinates[0][0]) ? res.coordinates[0] : res.coordinates;
    if (res.components && res.components[0] && res.components[0].components) {
      return res.components[0].components.map(pt => [pt.x, pt.y]);
    }
    return null;
  }

  async function tracerAgglo() {
    if (!communeActive) return;
    ui.btnTracer.disabled = true;
    ui.btnTracer.textContent = 'Trace en cours… (double-clic pour fermer)';
    try {
      const ring = extractRing(await sdk.Map.drawPolygon());
      if (!ring || ring.length < 4) throw new Error('trace inexploitable');
      const dedans = ring.filter(c => pointInGeom(c[0], c[1], communeActive.geom)).length;
      if (dedans === 0 && !confirm('Le polygone trace est entierement HORS de ' +
        communeActive.nom + '.\n\nL\'enregistrer quand meme ?')) return;
      if (!agglos[communeActive.code]) agglos[communeActive.code] = [];
      agglos[communeActive.code].push({ id: 'a' + Date.now(), label: communeActive.nom, rattache: false, ring });
      saveAgglos(); redrawAgglos(); renderAgglos();
    } catch (e) { log('trace annule ou echoue', e); }
    finally {
      ui.btnTracer.disabled = false;
      ui.btnTracer.textContent = '＋ Tracer l\'agglomeration';
    }
  }

  // ---------------------------------------------------------------------------
  // Edition d'un polygone : poignees maison
  //
  // Le SDK ne sait pas editer un polygone de notre calque (enablePolygonResize
  // ne vise que la selection interne de WME). On pose donc nos propres poignees
  // en HTML par-dessus la carte : `getPixelFromLonLat` rend des pixels ecran,
  // directement comparables a clientX/clientY, donc aucun offset a gerer.
  // Poignee pleine = sommet (glisser pour deplacer, clic droit pour supprimer) ;
  // poignee creuse = milieu d'un cote (cliquer pour inserer un sommet).
  // ---------------------------------------------------------------------------

  let edition = null;

  function entrerEdition(a) {
    if (edition) sortirEdition(false);
    const zone = el('<div id="agn-poignees"></div>');
    document.body.appendChild(zone);
    edition = {
      agglo: a, zone,
      points: a.ring.slice(0, -1).map(p => [p[0], p[1]]),   // anneau ouvert
      ringAvant: a.ring.slice()
    };
    dessinerPoignees();
    renderAgglos();
  }

  function sortirEdition(sauver) {
    if (!edition) return;
    if (sauver) {
      const p = edition.points;
      edition.agglo.ring = p.concat([p[0].slice()]);        // on referme
    } else {
      edition.agglo.ring = edition.ringAvant;
    }
    edition.zone.remove();
    edition = null;
    saveAgglos(); redrawAgglos(); renderAgglos();
  }

  function dessinerPoignees() {
    if (!edition) return;
    const z = edition.zone;
    z.innerHTML = '';
    const pts = edition.points;
    const px = p => { try { return sdk.Map.getPixelFromLonLat({ lonLat: { lon: p[0], lat: p[1] } }); }
                      catch (e) { return null; } };

    pts.forEach((p, i) => {
      const q = px(p); if (!q) return;
      const h = el('<div class="agn-poi agn-poi-s" title="Glisser pour deplacer, clic droit pour supprimer"></div>');
      h.style.left = q.x + 'px'; h.style.top = q.y + 'px';
      h.onmousedown = e => { if (e.button === 0) demarrerDrag(e, i); };
      h.oncontextmenu = e => {
        e.preventDefault(); e.stopPropagation();
        if (pts.length <= 3) return;                        // un polygone garde 3 sommets
        pts.splice(i, 1); majPolygoneEnEdition();
      };
      z.appendChild(h);

      // milieu du cote [i, i+1] : cliquer y insere un sommet
      const suivant = pts[(i + 1) % pts.length];
      const m = px([(p[0] + suivant[0]) / 2, (p[1] + suivant[1]) / 2]);
      if (!m) return;
      const a = el('<div class="agn-poi agn-poi-m" title="Cliquer pour ajouter un sommet"></div>');
      a.style.left = m.x + 'px'; a.style.top = m.y + 'px';
      a.onmousedown = e => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        pts.splice(i + 1, 0, [(p[0] + suivant[0]) / 2, (p[1] + suivant[1]) / 2]);
        majPolygoneEnEdition();
        demarrerDrag(e, i + 1);                             // on enchaine sur le glisser
      };
      z.appendChild(a);
    });
  }

  function demarrerDrag(e, index) {
    e.preventDefault(); e.stopPropagation();
    const bouger = ev => {
      let ll;
      try { ll = sdk.Map.getLonLatFromPixel({ x: ev.clientX, y: ev.clientY }); } catch (err) { return; }
      if (!ll) return;
      edition.points[index] = [ll.lon, ll.lat];
      majPolygoneEnEdition();
      ev.preventDefault();
    };
    const finir = () => {
      document.removeEventListener('mousemove', bouger, true);
      document.removeEventListener('mouseup', finir, true);
    };
    document.addEventListener('mousemove', bouger, true);
    document.addEventListener('mouseup', finir, true);
  }

  /** Redessine le polygone et ses poignees pendant l'edition. */
  function majPolygoneEnEdition() {
    if (!edition) return;
    const p = edition.points;
    edition.agglo.ring = p.concat([p[0].slice()]);
    redrawAgglos();
    dessinerPoignees();
  }

  // ---------------------------------------------------------------------------
  // Lecture de l'adressage + moteur
  // ---------------------------------------------------------------------------

  function readNaming(seg) {
    const addr = sdk.DataModel.Segments.getAddress({ segmentId: seg.id });
    if (!addr) return null;
    const one = (street, city) => ({
      name: (street && !street.isEmpty && street.name) ? street.name : '',
      cityName: (city && !city.isEmpty && city.name) ? city.name : '',
      signText: (street && street.signText) ? street.signText : '',
      signType: (street && street.signType != null) ? street.signType : null
    });
    return { primary: one(addr.street, addr.city), alts: (addr.altStreets || []).map(a => one(a.street, a.city)) };
  }

  const isRoute = e => !!e.name && (RE_ROUTE.test(e.name.trim()) || (!!e.signText && e.signText.trim() === e.name.trim()));
  const isCommunale = e => !!e.name && RE_COMMUNALE.test(e.name.trim());

  function expectedNaming(nam, agglo, nomCommune) {
    const entries = [nam.primary, ...nam.alts].filter(e => e.name || e.cityName);
    const routes = entries.filter(isRoute);
    const noms = entries.filter(e => e.name && !isRoute(e));
    const route = routes[0] || null, nomRue = noms[0] || null;

    let doute = null;
    if (routes.length > 1) doute = 'plusieurs numeros de route sur le segment';
    else if (noms.length > 1) doute = 'plusieurs noms de rue — noms alternatifs reels ?';

    const P = (name, city) => ({ name: name || '', cityName: city || '' });

    // Autoroute : aucune ville nulle part, agglo ou pas. On garde les noms
    // alternatifs existants (E15, second numero...) mais debarrasses de leur
    // ville, et on force le signalement des alternatifs qui en portent une.
    const auto = entries.find(e => RE_AUTOROUTE.test((e.name || '').trim()));
    if (auto) {
      return {
        cas: 'A', strict: true, doute,
        primary: P(auto.name, ''),
        alts: nam.alts.filter(a => a.name && a.name.trim() !== auto.name.trim())
                      .map(a => P(a.name, ''))
      };
    }

    if (agglo) {
      // /!\ La ville de reference est le nom de la COMMUNE INSEE, jamais le
      // libelle du polygone : celui-ci n'est qu'une etiquette de travail, et
      // s'en servir propagerait une faute de saisie sur toute la commune.
      // Seul le village rattache fait exception, et son nom se lit alors sur la
      // City deja portee par le segment — pas sur le polygone non plus.
      let v = nomCommune;
      if (agglo.rattache) {
        const villeSeg = nam.primary.cityName ||
                         (nam.alts.find(a => a.cityName) || {}).cityName || '';
        // la ville du segment peut deja etre au format « Village (Commune) »
        const village = (villeSeg.match(/^\s*(.+?)\s*\(/) || [null, villeSeg])[1].trim();
        if (village) v = village + ' (' + nomCommune + ')';
        else doute = (doute ? doute + ' ; ' : '') +
          'village rattache : aucune ville sur le segment, impossible d\'en deduire le nom du village';
      }
      const s = agglo.rattache ? 'R' : 'C';
      if (nomRue && route) return { cas: s + '1', primary: P(nomRue.name, v), alts: [P(route.name, v)], doute };
      if (nomRue)          return { cas: s + '2', primary: P(nomRue.name, v), alts: [], doute };
      if (route)           return { cas: s + '4', primary: P(route.name, v), alts: [], doute };
      return { cas: s + '3', primary: P('', v), alts: [], doute };
    }
    const vAlt = nomCommune;
    if (!nomRue && !route) return { cas: 'H5', primary: P('', ''), alts: [], doute };
    if (!nomRue && route)  return { cas: 'H6', primary: P(route.name, ''), alts: [P(route.name, vAlt)], doute };
    if (nomRue && !route)  return { cas: 'H7', primary: P(nomRue.name, ''), alts: [P(nomRue.name, vAlt)], doute };
    if (route && isCommunale(route)) return { cas: 'H8', primary: P(nomRue.name, ''),
      alts: [P(route.name, vAlt), P(nomRue.name, vAlt)], doute };
    return { cas: 'H9', primary: P(route.name, ''), alts: [P(nomRue.name, vAlt)], doute };
  }

  /**
   * Cartouches (road shields). Dans WME, l'ecusson est porte par la Street via
   * signText + signType. Trois controles, de gravite decroissante :
   *  1. le NOM PRINCIPAL est un numero de route mais n'a pas de cartouche ;
   *  2. un NOM ALTERNATIF est un numero de route sans cartouche (moins grave) ;
   *  3. le numero est en alternatif et le principal est un nom de rue : c'est
   *     alors le principal qui devrait probablement porter le cartouche — mais
   *     ca depend du terrain, donc on le signale sans l'affirmer.
   */
  const estNumero = e => RE_ROUTE.test((e.name || '').trim());
  const sansCartouche = e => !(e.signText && e.signText.trim()) || e.signType == null;

  function verifierCartouches(nam) {
    const ecarts = [];
    if (estNumero(nam.primary) && sansCartouche(nam.primary)) {
      ecarts.push({ champ: 'cartouche', avant: nam.primary.name + ' sans cartouche',
        apres: 'poser le cartouche ' + nam.primary.name + ' sur le nom principal' });
    }
    for (const a of nam.alts) {
      if (estNumero(a) && sansCartouche(a)) {
        ecarts.push({ champ: 'cartouche (alt)', avant: a.name + ' sans cartouche',
          apres: 'poser le cartouche ' + a.name + ' sur ce nom alternatif' });
      }
    }
    const numAlt = nam.alts.find(estNumero);
    if (numAlt && nam.primary.name && !estNumero(nam.primary) && sansCartouche(nam.primary)) {
      ecarts.push({ champ: 'cartouche (principal)', avant: nam.primary.name + ' sans cartouche',
        apres: 'porte peut-etre le cartouche ' + numAlt.name + ' — a verifier sur le terrain' });
    }
    return ecarts;
  }

  /**
   * Giratoire : en France il ne porte PAS de nom. Waze le reconnait a son
   * `junctionId` — tous les segments d'un meme rond-point partagent le meme.
   * En agglomeration il porte la ville, hors agglomeration il n'a ni nom ni
   * ville. On ne touche pas aux noms alternatifs : le SDK ne sait pas les
   * retirer, et un alternatif peut avoir ete pose sciemment.
   */
  function verifierGiratoire(nam, villeCible) {
    const ecarts = [];
    if (nam.primary.name) {
      ecarts.push({ champ: 'nom interdit (giratoire)', avant: fmt(nam.primary),
        apres: '‹sans nom› / ' + (villeCible || '‹sans ville›') });
    } else if ((nam.primary.cityName || '') !== (villeCible || '')) {
      ecarts.push({ champ: 'ville du giratoire', avant: fmt(nam.primary),
        apres: '‹sans nom› / ' + (villeCible || '‹sans ville›') });
    }
    return ecarts;
  }

  /**
   * Regles propres a certains types de voies (guide FR, « Cas particuliers ») :
   * voies ferrees, pistes et ferries ne portent NI ville NI rue ; bretelles et
   * rocades sont systematiquement hors agglomeration, donc jamais de ville.
   */
  function verifierSansVille(nam, nomPrincipalInterdit) {
    const ecarts = [];
    [nam.primary, ...nam.alts].forEach((e, i) => {
      const ou = i === 0 ? 'principal' : 'alt';
      if (e.cityName) {
        ecarts.push({ champ: 'ville interdite (' + ou + ')', avant: fmt(e),
          apres: (e.name || '‹sans nom›') + ' / ‹sans ville›' });
      }
    });
    // Voie ferree : le nom PRINCIPAL doit rester vide, mais un nom alternatif
    // est admis — il sert la recherche dans l'application.
    if (nomPrincipalInterdit && nam.primary.name) {
      ecarts.push({ champ: 'nom principal interdit', avant: nam.primary.name,
        apres: '‹sans nom› — a basculer en nom alternatif (utile a la recherche)' });
    }
    return ecarts;
  }

  /**
   * Forme du nom, independamment de la zone. Chaque controle est active
   * separement : ce sont des regles de redaction, pas de zonage, et l'auteur
   * doit pouvoir n'en retenir qu'une partie.
   */
  function verifierForme(nam) {
    const ecarts = [];
    const c = options.controles;
    [nam.primary, ...nam.alts].forEach((e, i) => {
      const nom = (e.name || '').trim();
      if (!nom) return;
      const ou = i === 0 ? '' : ' (alt)';
      if (c.abreviations && (RE_ABREV.test(nom) || RE_ABREV_SANS_POINT.test(nom))) {
        ecarts.push({ champ: 'abreviation' + ou, avant: nom,
          apres: 'ecrire le type de voie en toutes lettres' });
      }
      if (c.contractions && (RE_SAINT.test(nom) || initialeIsolee(nom))) {
        ecarts.push({ champ: 'contraction' + ou, avant: nom,
          apres: 'ecrire le nom complet (contractions interdites)' });
      }
      if (c.majuscule && /^[a-zà-ÿ]/.test(nom)) {
        ecarts.push({ champ: 'majuscule' + ou, avant: nom,
          apres: nom.charAt(0).toUpperCase() + nom.slice(1) });
      }
      if (c.fonctionDirection && RE_FONCTION.test(nom)) {
        ecarts.push({ champ: 'fonction dans le nom' + ou, avant: nom,
          apres: 'le nom ne doit pas decrire la fonction du segment' });
      }
      if (c.fonctionDirection && RE_DIRECTION.test(nom)) {
        ecarts.push({ champ: 'direction dans le nom' + ou, avant: nom,
          apres: 'la direction n\'est admise que sur les bretelles' });
      }
    });
    return ecarts;
  }

  const fmt = e => (e.name || '‹sans nom›') + ' / ' + (e.cityName || '‹sans ville›');
  const key = e => (e.name || '').trim().toLowerCase() + '|' + (e.cityName || '').trim().toLowerCase();

  function diffNaming(nam, exp) {
    const ecarts = [];
    if (key(nam.primary) !== key(exp.primary)) {
      ecarts.push({ champ: 'principal', avant: fmt(nam.primary), apres: fmt(exp.primary) });
    }
    const cur = nam.alts.map(key), tgt = exp.alts.map(key);
    for (const a of exp.alts) if (!cur.includes(key(a))) ecarts.push({ champ: 'alt manquant', avant: '—', apres: fmt(a) });
    // Un nom alternatif surnumeraire est souvent LEGITIME (nom d'usage, ancien
    // nom, voie a deux villes). On ne le signale que sur demande explicite —
    // sauf regle stricte (autoroute), ou une ville en alternatif est une faute.
    if (options.altEnTrop || exp.strict) {
      for (const a of nam.alts) if (!tgt.includes(key(a))) ecarts.push({ champ: 'alt en trop', avant: fmt(a), apres: '—' });
    }
    return ecarts;
  }

  // ---------------------------------------------------------------------------
  // Descripteur du referentiel francais : c'est le SEUL point de contact entre
  // le pays et le moteur. Un autre pays fournit le meme objet.
  // ---------------------------------------------------------------------------

  const REFERENTIELS = {
    FR: {
      code: 'FR',
      nom: 'France',
      // Reconnu sur le nom ou l'abreviation du pays renvoyes par WME.
      correspond: pays => /^(FR|France)$/i.test(String(pays || '').trim()),

      // Decoupage administratif de reference et cles admises dans le GeoJSON.
      libelleDecoupage: 'communes INSEE',
      clesNom: CLES_NOM,
      clesCode: CLES_CODE,

      // Types de voies : sans vocation d'adressage / sans nom ni ville du tout.
      typesSansAdresse: ROADTYPE_SANS_ADRESSE,
      typesSansAdresseTotale: ROADTYPE_SANS_ADRESSE_TOTALE,
      typeBretelle: 4,
      estRocade: noms => RE_ROCADE.test(noms),

      // Etat cible du nommage selon la zone (le logigramme C/R/H).
      etatCible: expectedNaming,

      // Ou doit vivre une adresse, selon la zone. En France : numero de rue
      // (House Number) porte par le segment EN agglomeration, POI de type
      // residentiel HORS agglomeration.
      adressage: { hnEnAgglo: true, poiHorsAgglo: true, categoriePoi: 'RESIDENTIAL' },

      // Controles activables. `portee` dit au moteur quand les appeler :
      //   'zone'    → compare l'etat courant a l'etat cible
      //   'segment' → s'applique a tout segment ordinaire
      //   'type'    → propre a un type de voie, gere par le moteur
      //   'adresse' → porte sur les numeros et les POI, pas sur les segments
      controles: [
        { cle: 'nommageZone', portee: 'zone', libelle: 'Nommage agglo / hors agglo (coeur)' },
        { cle: 'cartouches', portee: 'segment', libelle: 'Cartouches des Dxxx / Nxxx / Cxxx',
          executer: verifierCartouches },
        { cle: 'bretelles', portee: 'type', libelle: 'Bretelles : jamais de ville' },
        { cle: 'rails', portee: 'type', libelle: 'Voies ferrees, pistes, ferries : ni ville ni nom' },
        { cle: 'rocades', portee: 'type', libelle: 'Rocades et peripheriques : jamais de ville' },
        { cle: 'giratoires', portee: 'type', libelle: 'Giratoires : sans nom (ville selon la zone)' },
        { cle: 'abreviations', portee: 'forme', libelle: 'Abreviations interdites (Av., Bd., Rte...)' },
        { cle: 'contractions', portee: 'forme', libelle: 'Contractions interdites (St-, R. Poincare)' },
        { cle: 'majuscule', portee: 'forme', libelle: 'Nom commencant par une minuscule' },
        { cle: 'fonctionDirection', portee: 'forme', libelle: 'Fonction ou direction dans le nom' },
        { cle: 'hnHorsAgglo', portee: 'adresse',
          libelle: 'Numeros de rue (HN) hors agglomeration' },
        { cle: 'poiAgglo', portee: 'adresse',
          libelle: 'POI residentiels en agglomeration (a verifier)' }
      ],
      // Les controles de forme partagent une seule fonction, qui lit elle-meme
      // quelles cases sont cochees.
      verifierForme: verifierForme,
      verifierSansVille: verifierSansVille
    }
  };

  /** Referentiel actif. On demarre sur la France et on ajuste des que WME nous
   *  dit dans quel pays on travaille. */
  let REF = REFERENTIELS.FR;

  function choisirReferentiel(nomPays) {
    const trouve = Object.values(REFERENTIELS).find(r => r.correspond(nomPays));
    if (trouve && trouve !== REF) { REF = trouve; log('referentiel : ' + REF.nom); }
    return REF;
  }

  /** Pays de la zone courante, d'apres l'adresse d'un segment charge. */
  function detecterPays() {
    try {
      const segs = sdk.DataModel.Segments.getAll();
      for (const s of segs.slice(0, 40)) {
        const a = sdk.DataModel.Segments.getAddress({ segmentId: s.id });
        const p = a && a.country && (a.country.name || a.country.abbr);
        if (p) return p;
      }
    } catch (e) { /* on reste sur le referentiel courant */ }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Analyse
  // ---------------------------------------------------------------------------

  /** Longueur approchee d'un cote, en degres corriges de la latitude. */
  function longueur(a, b) {
    const dx = (b[0] - a[0]) * Math.cos((a[1] + b[1]) * Math.PI / 360);
    const dy = b[1] - a[1];
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Part de LONGUEUR d'un trace situee a l'interieur d'une zone.
   *
   * On raisonne en longueur et non en nombre de sommets : un virage concentre
   * dix points sur vingt metres quand une ligne droite en compte deux sur un
   * kilometre. Et on ne se contente PAS de tester le milieu de chaque cote —
   * un cote a deux points qui franchit la limite basculerait alors d'un bloc a
   * 0 ou 100 %, rendant invisibles les segments courts a cheval. Quand les deux
   * extremites d'un cote different, une dichotomie situe le franchissement.
   */
  function partDedans(coords, dedans) {
    let total = 0, dans = 0;
    for (let i = 1; i < coords.length; i++) {
      const a = coords[i - 1], b = coords[i];
      const d = longueur(a, b);
      if (!d) continue;
      total += d;
      const da = dedans(a[0], a[1]), db = dedans(b[0], b[1]);
      if (da && db) { dans += d; continue; }
      if (!da && !db) continue;
      let lo = 0, hi = 1;
      for (let k = 0; k < 12; k++) {           // ~0,02 % de precision
        const t = (lo + hi) / 2;
        if (dedans(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t) === da) lo = t; else hi = t;
      }
      const t = (lo + hi) / 2;
      dans += d * (da ? t : 1 - t);
    }
    return { total, dans };
  }

  function localiser(coords, listeAgglos) {
    const dansCommune = (x, y) => pointInGeom(x, y, communeActive.geom);
    const rc = partDedans(coords, dansCommune);

    // Segment degenere (un seul point, ou longueur nulle) : test ponctuel,
    // sinon il serait classe « hors commune » a tort.
    if (!rc.total) {
      const c = coords[0];
      const ag = listeAgglos.find(a => pointInRings(c[0], c[1], [a.ring])) || null;
      return { partCommune: dansCommune(c[0], c[1]) ? 1 : 0, partAgglo: ag ? 1 : 0, agglo: ag };
    }

    let partAgglo = 0, aggloMaj = null, meilleure = 0;
    for (const ag of listeAgglos) {
      const r = partDedans(coords, (x, y) => pointInRings(x, y, [ag.ring]));
      const part = r.dans / r.total;
      partAgglo += part;
      if (part > meilleure) { meilleure = part; aggloMaj = ag; }
    }

    return {
      partCommune: rc.dans / rc.total,
      partAgglo: Math.min(1, partAgglo),
      agglo: aggloMaj
    };
  }

  const pourcent = x => Math.round(x * 100) + ' %';

  /**
   * Fusionne les segments STRICTEMENT dans la meme situation : meme cas, meme
   * libelle, memes ecarts. Une rue decoupee en vingt troncons ne fait alors
   * qu'une ligne, et le clic les selectionne tous d'un bloc.
   * Les pourcentages de debordement sont neutralises dans la cle : « deborde de
   * 3 % » et « de 7 % » decrivent la meme situation et doivent se regrouper.
   */
  function regrouperFindings(liste) {
    const carte = new Map();
    // ⚠️ Les ecarts d'ADRESSE ne se regroupent pas : chacun porte ses propres
    // numeros, et un POI n'a pas de segment (donc rien a verrouiller). Les
    // fusionner ferait perdre les numeros a corriger.
    const adresses = liste.filter(f => f.adresse).map(f => Object.assign({}, f, {
      segIds: [f.segId], geoms: [f.geom], centres: [f.centre],
      nb: f.nbPoints || 1, disperse: false,
      verrouilles: f.sousType === 'hn'
        ? (segmentsEditables([f.segId]).length ? 0 : 1) : 0
    }));
    for (const f of liste.filter(x => !x.adresse)) {
      const cle = JSON.stringify([
        f.cas, f.libelle,
        f.ecarts.map(e => [e.champ, e.avant, e.apres]),
        (f.doute || '').replace(/\d+(?:[.,]\d+)?\s?%/g, 'N %')
      ]);
      const g = carte.get(cle);
      if (g) { g.segIds.push(f.segId); g.geoms.push(f.geom); g.centres.push(f.centre); }
      else carte.set(cle, Object.assign({}, f,
        { segIds: [f.segId], geoms: [f.geom], centres: [f.centre] }));
    }
    return [...carte.values()].map(g => Object.assign(g, {
      nb: g.segIds.length,
      disperse: (() => {           // troncons eloignes les uns des autres ?
        const pts = []; g.geoms.forEach(x => { if (x && x.coordinates) pts.push(...x.coordinates); });
        if (pts.length < 2) return false;
        let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
        pts.forEach(c => { x1 = Math.min(x1, c[0]); x2 = Math.max(x2, c[0]);
                           y1 = Math.min(y1, c[1]); y2 = Math.max(y2, c[1]); });
        return (x2 - x1) > 0.012 || (y2 - y1) > 0.012;   // ~1 km
      })(),
      // Un segment verrouille au-dessus de notre niveau ne peut pas etre edite :
      // l'ecriture passerait a l'ecran puis serait refusee a l'enregistrement.
      verrouilles: g.segIds.length - segmentsEditables(g.segIds).length
    })).concat(adresses);
  }

  // ===========================================================================
  // ADRESSAGE — numeros de rue (HN) et POI residentiels
  //
  // Regle FR : le numero est porte par le SEGMENT en agglomeration, et par un
  // POI de type residentiel hors agglomeration. On cherche donc les deux
  // situations inverses. Un POI residentiel en ville a souvent une bonne
  // raison d'exister (residence fermee, lotissement) : on le signale comme « a
  // verifier », jamais comme une faute.
  //
  // Verifie en live (2026-07-21) :
  //  - `fetchHouseNumbers({segmentIds})` est une lecture SERVEUR : rapide
  //    (120 numeros en 138 ms) mais elle NE PEUPLE PAS le data model.
  //  - donc `deleteHouseNumber` echoue tant que l'editeur n'est pas entre une
  //    fois dans le mode « numeros de rue », qui charge toute la vue d'un coup.
  //  - un POI de categorie RESIDENTIAL porte `isResidential:true` d'office.
  // ===========================================================================

  /** Centre d'une geometrie quelconque (Point, LineString, Polygon). */
  function centreGeom(geom) {
    if (!geom) return null;
    if (geom.type === 'Point') return geom.coordinates;
    const plat = [];
    (function creuser(x) {
      if (!Array.isArray(x)) return;
      if (typeof x[0] === 'number') { plat.push(x); return; }
      x.forEach(creuser);
    })(geom.coordinates);
    if (!plat.length) return null;
    return [plat.reduce((s, p) => s + p[0], 0) / plat.length,
            plat.reduce((s, p) => s + p[1], 0) / plat.length];
  }

  /**
   * CE numero precis est-il manipulable, c'est-a-dire present dans le modele
   * d'edition ?
   *
   * ⚠️⚠️ CE N'EST PAS UN ETAT FIGE — c'est une question de ZOOM.
   * Mesure en live (2026-07-21) : le depot `W.model.segmentHouseNumbers` est
   * VIDE aux zooms 16 et 17, et contient d'un coup les 358 numeros de la zone
   * **des le zoom 18**. Autrement dit : des que l'editeur voit les numeros a
   * l'ecran, ils sont chargés et supprimables — l'auteur avait raison de
   * contester le message « ces numeros ne sont pas charges ».
   * (J'avais d'abord cru qu'il fallait ouvrir « Ajouter des numeros de rue » :
   * faux, ce bouton zoomait sur le segment, et c'est le zoom qui chargeait.)
   *
   * Consequence de conception : on ne decide RIEN au moment d'afficher la
   * liste — l'analyse tourne souvent au zoom 16/17, ou le depot est vide. On
   * verifie au moment d'AGIR, apres avoir au besoin provoque le chargement.
   */
  function hnManipulable(id) {
    try {
      return hote.W.model.segmentHouseNumbers.getObjectArray()
        .some(o => String(o.getID ? o.getID() : o.id) === String(id));
    } catch (e) { return false; }
  }
  /** Combien de numeros d'un report sont reellement manipulables. */
  const hnsManipulables = f => (f.hns || []).filter(h => hnManipulable(h.id));

  /** Zoom a partir duquel WME charge les numeros dans le modele (mesure). */
  const ZOOM_NUMEROS = 18;

  /**
   * Provoque le chargement des numeros d'un report : on cadre dessus a un zoom
   * suffisant, puis on laisse a WME le temps de les recevoir. Rend le nombre de
   * numeros devenus manipulables.
   */
  async function chargerNumeros(f) {
    if (hnsManipulables(f).length === (f.hns || []).length) return f.hns.length;
    try {
      if (f.centre) sdk.Map.setMapCenter({ lonLat: f.centre });
      const z = sdk.Map.getZoomLevel();
      if (z < ZOOM_NUMEROS) sdk.Map.setZoomLevel({ zoomLevel: ZOOM_NUMEROS });
    } catch (e) { log('cadrage sur les numeros impossible', e); }
    for (let essai = 0; essai < 8; essai++) {
      await new Promise(r => setTimeout(r, 500));
      if (hnsManipulables(f).length) break;
    }
    return hnsManipulables(f).length;
  }

  /** La commune INSEE qui contient ce point, d'apres les contours charges. */
  function communeDuPoint(lon, lat) {
    for (const c of communes) {
      if (!bboxIntersecte(c.bbox, [lon, lat, lon, lat])) continue;
      if (pointInGeom(lon, lat, c.geom)) return c;
    }
    return null;
  }

  /**
   * L'adresse a donner au POI qu'on cree a la place d'un numero.
   *
   * Hors agglomeration, le segment porte le numero de route en principal et le
   * nom de rue AVEC sa ville en alternatif : c'est ce dernier qui fait
   * l'adresse postale (choix de l'auteur, 21/07).
   *
   * ⚠️ On n'INVENTE jamais un nom : seules les adresses REELLEMENT portees par
   * le segment sont candidates, et un numero de route seul n'en est pas une
   * (« 43 D981 » n'est pas une adresse).
   *
   * ⚠️ La VILLE, elle, ne se lit pas sur le segment quand il n'y a pas
   * d'ambiguite : c'est la commune INSEE determinee par geometrie, comme le
   * `vAlt` du logigramme hors agglo — reprendre celle du segment propagerait
   * sa faute eventuelle (meme piege que l'etiquette de polygone, corrige en
   * v1.10).
   *
   * ⚠️⚠️ AMBIGUITE ⇒ ON DEMANDE, ON NE REFUSE PAS (arbitrage de l'auteur, 21/07) :
   *  - meme nom, deux villes  → voie en limite communale, on demande la ville ;
   *  - plusieurs noms         → on demande le couple NOM + VILLE.
   * Rendre `null` ne subsiste que s'il n'y a aucune adresse exploitable.
   */
  function rueDuPoi(nam) {
    if (!nam) return null;
    // Adresses portees par le segment, groupees par nom de rue.
    const parNom = new Map();
    for (const e of [nam.primary, ...nam.alts]) {
      const nom = (e.name || '').trim();
      if (!nom || RE_ROUTE.test(nom)) continue;      // pas de nom, ou numero de route
      if (!parNom.has(nom)) parNom.set(nom, new Set());
      const v = (e.cityName || '').trim();
      if (v) parNom.get(nom).add(v);
    }
    const candidats = [...parNom.entries()].map(([nom, villes]) => ({ nom, villes: [...villes] }));

    // ⚠️ Aucune adresse exploitable (le segment ne porte qu'un numero de route,
    // « 43 D981 ») : on ne refuse PAS et on n'invente pas non plus — la boite
    // proposera a l'editeur de SAISIR le nom a donner au POI (arbitrage de
    // l'auteur, 21/07). C'est lui qui connait le terrain.
    if (!candidats.length) {
      return { nom: null, ville: communeActive.nom, candidats: [],
               ambigu: true, plusieursNoms: false, saisieRequise: true, villeSeg: null };
    }
    const plusieursNoms = candidats.length > 1;
    const plusieursVilles = candidats.some(c => c.villes.length > 1);

    const seul = candidats[0];
    const villeSeg = seul.villes[0] || '';
    return {
      // Proposition par defaut : le nom s'il est unique, la commune INSEE pour
      // la ville. Elle ne sert que s'il n'y a rien a demander.
      nom: plusieursNoms ? null : seul.nom,
      ville: communeActive.nom,
      candidats,
      ambigu: plusieursNoms || plusieursVilles,
      plusieursNoms,
      villeSeg: !plusieursNoms && seul.villes.length === 1 && villeSeg !== communeActive.nom
        ? villeSeg : null
    };
  }

  /**
   * Analyse des adresses. Rendue a part du scan des segments : elle est
   * asynchrone (un aller-retour serveur) et ne concerne pas la geometrie des
   * voies mais des points.
   */
  async function analyserAdresses(segs, listeAgglos, stats) {
    const c = options.controles;
    if (!c.hnHorsAgglo && !c.poiAgglo) return;
    const dansAgglo = (lon, lat) => listeAgglos.some(a => pointInRings(lon, lat, [a.ring]));
    const dansCommune = (lon, lat) => pointInGeom(lon, lat, communeActive.geom);

    // --- 1. Numeros de rue hors agglomeration -------------------------------
    if (c.hnHorsAgglo) {
      const parSegment = new Map();
      try {
        // ⚠️ `fetchHouseNumbers` a une LIMITE DE LOT non documentee : mesuree en
        // live, 500 segments passent, 600 sont rejetes d'emblee (« Server
        // Response Error » en 98 ms). Une commune depasse vite ce seuil — 879
        // segments dans une vue de test — donc on tronconne. Cout : ~0,5 s par
        // lot de 250, soit une paire de secondes pour une commune entiere.
        const TAILLE_LOT = 250;
        const tousIds = segs.map(s => s.id);
        const hns = [];
        for (let i = 0; i < tousIds.length; i += TAILLE_LOT) {
          const lot = await sdk.DataModel.HouseNumbers.fetchHouseNumbers(
            { segmentIds: tousIds.slice(i, i + TAILLE_LOT) });
          hns.push(...lot);
        }
        stats.hnLus = hns.length;
        for (const hn of hns) {
          const p = hn.geometry && hn.geometry.coordinates;
          if (!p) continue;
          if (!dansCommune(p[0], p[1])) { stats.hnHorsCommune++; continue; }
          if (dansAgglo(p[0], p[1])) continue;                 // a sa place
          if (!parSegment.has(hn.segmentId)) parSegment.set(hn.segmentId, []);
          parSegment.get(hn.segmentId).push(hn);
        }
      } catch (e) {
        log('lecture des numeros de rue impossible', e);
        stats.hnErreur = e.message || String(e);
      }

      // Un report par segment porteur : ce sont les memes rue et zone.
      for (const [segId, liste] of parSegment) {
        const seg = sdk.DataModel.Segments.getById({ segmentId: segId });
        const nam = seg ? readNaming(seg) : null;
        const rue = rueDuPoi(nam);
        const nums = liste.map(h => h.number);
        stats.hnHorsAgglo += liste.length;
        findings.push({
          adresse: true, sousType: 'hn', cas: 'HN-H', segId,
          libelle: (nam ? fmt(nam.primary) : 'segment ' + segId) +
                   ' — ' + liste.length + ' numero' + (liste.length > 1 ? 's' : ''),
          roadType: seg ? seg.roadType : null,
          nbPoints: liste.length,
          hns: liste.map(h => ({ id: h.id, number: h.number, geometry: h.geometry })),
          geom: liste[0].geometry,
          centre: (p => ({ lon: p[0], lat: p[1] }))(centreGeom(liste[0].geometry)),
          rueCible: rue,
          ecarts: [{ champ: 'numeros hors agglo',
                     avant: nums.slice(0, 8).join(', ') + (nums.length > 8 ? '…' : '') +
                            ' porte' + (nums.length > 1 ? 's' : '') + ' par le segment',
                     apres: !rue ? 'a passer en POI residentiel'
                       : rue.saisieRequise ? 'a passer en POI residentiel — adresse a saisir a la conversion'
                       : rue.ambigu ? 'a passer en POI residentiel — adresse a choisir a la conversion'
                       : 'a passer en POI residentiel — ' + rue.nom + ' / ' + rue.ville }],
          doute: !rue
            ? 'aucune adresse exploitable sur ce segment : la rue du POI ne peut pas etre determinee'
            : rue.saisieRequise
              ? 'ce segment ne porte qu\'un numero de route : le nom du POI sera demande a la conversion'
              : rue.plusieursNoms
              ? 'plusieurs noms de rue sur ce segment (' +
                rue.candidats.map(c => c.nom).join(', ') + ') : le choix sera demande'
              : rue.ambigu
                ? 'voie en limite communale (' + rue.candidats[0].villes.join(', ') +
                  ') : la commune de chaque numero sera demandee'
                : rue.villeSeg
                  ? 'le segment porte la ville « ' + rue.villeSeg + ' » alors que le contour donne « ' +
                    communeActive.nom + ' » : c\'est la commune INSEE qui est appliquee au POI'
                  : null
        });
      }
    }

    // --- 2. POI residentiels en agglomeration -------------------------------
    if (c.poiAgglo) {
      let venues = [];
      try { venues = sdk.DataModel.Venues.getAll().filter(v => v.isResidential); }
      catch (e) { log('lecture des POI impossible', e); }
      stats.poiLus = venues.length;
      for (const v of venues) {
        const p = centreGeom(v.geometry);
        if (!p) continue;
        if (!dansCommune(p[0], p[1])) continue;
        if (!dansAgglo(p[0], p[1])) continue;                  // a sa place
        let num = '';
        try { const a = sdk.DataModel.Venues.getAddress({ venueId: String(v.id) });
              num = (a && a.houseNumber) || ''; } catch (e) { /* */ }
        stats.poiAgglo++;
        findings.push({
          adresse: true, sousType: 'poi', cas: 'POI-C', segId: 'v' + v.id,
          libelle: (v.name || 'POI residentiel') + (num ? ' — n° ' + num : ''),
          roadType: null, nbPoints: 1,
          geom: { type: 'Point', coordinates: p },
          centre: { lon: p[0], lat: p[1] }, venueId: String(v.id),
          ecarts: [{ champ: 'POI residentiel en agglo',
                     avant: num ? 'n° ' + num : 'sans numero',
                     apres: 'en ville, le numero se porte sur le segment (a verifier)' }],
          doute: 'un POI residentiel en ville peut etre legitime (residence, lotissement ferme) : a juger sur place'
        });
      }
    }
  }

  async function scan() {
    if (!communeActive) {
      ui.stats.innerHTML = '<div class="agn-stat agn-alerte">Choisis d\'abord une commune.</div>';
      ui.results.innerHTML = ''; return;
    }
    const listeAgglos = agglos[communeActive.code] || [];
    // ⚠️⚠️ SANS POLYGONE, TOUTE LA COMMUNE PASSE POUR HORS AGGLOMERATION, et
    // le script deverse alors des centaines d'ecarts qui n'existent pas —
    // vecu par l'auteur le 21/07 : commune changee (Saint-Genies) sans y
    // tracer d'agglo, et tous les numeros du village signales « hors agglo ».
    // Une simple confirmation ne suffisait pas : on la clique par reflexe.
    // Il faut donc un choix EXPLICITE et memorise, commune par commune.
    if (!listeAgglos.length && !sansAgglo[communeActive.code]) {
      ui.stats.innerHTML = `<div class="agn-stat agn-alerte">
        <b>Aucune agglomeration tracee pour ${esc(communeActive.nom)}.</b><br>
        Sans polygone, toute la commune serait tenue pour hors agglomeration et
        l'analyse remonterait des ecarts qui n'existent pas.<br>
        Trace l'agglomeration (bouton ci-dessus), ou coche
        <b>« commune sans agglomeration »</b> si elle n'en a reellement aucune.</div>`;
      ui.results.innerHTML = '';
      replierSection('agglo', true);
      return;
    }

    choisirReferentiel(detecterPays());
    replierTout();                 // l'analyse prend toute la place
    findings = [];
    const skipped = { horsRegle: 0, sansAdresse: 0, horsCommune: 0, sansGeom: 0 };
    const zones = { agglo: 0, hors: 0, cheval: 0, limCom: 0, limitrophe: 0, cartouche: 0, special: 0, giratoire: 0 };
    const segs = sdk.DataModel.Segments.getAll();

    const c = options.controles;

    for (const seg of segs) {
      if (!options.sansAdresse && REF.typesSansAdresse.has(seg.roadType)) { skipped.sansAdresse++; continue; }
      const coords = seg.geometry && seg.geometry.coordinates;
      if (!coords || !coords.length) { skipped.sansGeom++; continue; }
      const nam = readNaming(seg);
      if (!nam) { skipped.sansGeom++; continue; }

      const loc = localiser(coords, listeAgglos);
      const haut = options.seuil, bas = 1 - options.seuil;

      // Majoritairement chez la voisine : ce n'est pas notre chantier.
      if (loc.partCommune < bas) { skipped.horsCommune++; continue; }

      const nomsBruts = [nam.primary.name, ...nam.alts.map(a => a.name)].join(' ');
      const base = { segId: seg.id, roadType: seg.roadType, libelle: fmt(nam.primary),
                     centre: centreDe(coords), geom: seg.geometry };
      const forme = REF.verifierForme(nam);

      // --- Giratoire : reconnu par son junctionId, quelle que soit la zone ---
      if (seg.junctionId != null && c.giratoires) {
        const enAggloG = loc.partAgglo >= haut;
        const villeG = enAggloG ? communeActive.nom : '';
        const ecartsG = verifierGiratoire(nam, villeG).concat(forme);
        if (!ecartsG.length) continue;
        zones.giratoire++;
        findings.push(Object.assign({}, base, {
          cas: 'GIR', ecarts: ecartsG, special: true, doute: null,
          cible: { primary: { name: '', cityName: villeG }, alts: [] }
        }));
        continue;
      }
      if (seg.junctionId != null && !c.giratoires) { skipped.horsRegle++; continue; }

      // --- Voies a regle propre : elles sortent du raisonnement agglo ---
      const estRail = REF.typesSansAdresseTotale.has(seg.roadType);      // rail, piste, ferry
      const estBretelle = seg.roadType === REF.typeBretelle;
      const estRocade = REF.estRocade(nomsBruts);

      if (estRail || estBretelle || estRocade) {
        const actif = estRail ? c.rails : estBretelle ? c.bretelles : c.rocades;
        if (!actif) { skipped.horsRegle++; continue; }
        // Rail/piste/ferry : ni ville ni rue. Bretelle et rocade : jamais de
        // ville (elles sont hors agglomeration par nature), mais un nom est
        // normal — c'est meme lui qui porte la direction sur une bretelle.
        const ecarts = REF.verifierSansVille(nam, estRail).concat(estBretelle ? [] : forme);
        if (!ecarts.length) continue;
        zones.special++;
        findings.push(Object.assign({}, base, {
          cas: estRail ? 'RAIL' : estBretelle ? 'BRET' : 'ROC', ecarts, special: true,
          cible: { primary: { name: estRail ? '' : nam.primary.name, cityName: '' },
                   alts: nam.alts.map(a => ({ name: a.name, cityName: '' })) },
          doute: estRocade ? 'identifiee comme rocade d\'apres son nom' : null }));
        continue;
      }

      // Zone grise sur la limite COMMUNALE : il faut couper avant de nommer,
      // le bon nommage depend de l'endroit de la coupe.
      if (loc.partCommune < haut) {
        zones.limCom++;
        findings.push(Object.assign({}, base, { cas: 'LIM', doute: null, ecarts: [{
          champ: 'limite communale',
          avant: pourcent(loc.partCommune) + ' dans ' + communeActive.nom,
          apres: 'a couper sur la limite communale' }] }));
        continue;
      }

      // Zone grise sur la limite d'AGGLO : idem, coupure au panneau EB10.
      if (loc.partAgglo > bas && loc.partAgglo < haut) {
        zones.cheval++;
        findings.push(Object.assign({}, base, { cas: 'EB10', doute: null, ecarts: [{
          champ: 'limite d\'agglo',
          avant: pourcent(loc.partAgglo) + ' dans l\'agglomeration',
          apres: 'a couper au panneau d\'entree d\'agglomeration (EB10)' }] }));
        continue;
      }

      const enAgglo = loc.partAgglo >= haut;
      if (enAgglo) zones.agglo++; else zones.hors++;

      const exp = REF.etatCible(nam, enAgglo ? loc.agglo : null, communeActive.nom);
      const ecartsNom = c.nommageZone ? diffNaming(nam, exp) : [];
      const ecartsCart = REF.controles
        .filter(ct => ct.portee === 'segment' && c[ct.cle] && ct.executer)
        .reduce((acc, ct) => acc.concat(ct.executer(nam)), []);
      const ecarts = ecartsNom.concat(ecartsCart, forme);
      if (!ecarts.length) continue;
      if (ecartsCart.length) zones.cartouche++;

      // Alertes mineures : le segment deborde un peu, sans que ca change son
      // rattachement. On le dit, on ne bloque pas.
      const notes = [];
      if (exp.doute) notes.push(exp.doute);
      if (loc.partCommune < 1) notes.push('deborde de ' + pourcent(1 - loc.partCommune) + ' sur la commune voisine');
      if (enAgglo && loc.partAgglo < 1) notes.push('deborde de ' + pourcent(1 - loc.partAgglo) + ' hors de l\'agglomeration');
      if (!enAgglo && loc.partAgglo > 0) notes.push('mord de ' + pourcent(loc.partAgglo) + ' sur l\'agglomeration');
      if (loc.partCommune < 1 || (enAgglo ? loc.partAgglo < 1 : loc.partAgglo > 0)) zones.limitrophe++;

      findings.push(Object.assign({}, base, { cas: exp.cas, ecarts, cible: exp,
        // Un segment dont le SEUL defaut est un cartouche absent, ou une faute
        // de redaction, merite sa propre couleur : le zonage, lui, est bon.
        seulementCartouche: ecartsCart.length > 0 && ecartsNom.length === 0 && !forme.length,
        seulementForme: forme.length > 0 && !ecartsNom.length && !ecartsCart.length,
        doute: notes.length ? notes.join(' ; ') : null }));
    }

    // Les adresses sont analysees a part : lecture serveur, et objets ponctuels.
    const statsAdr = { hnLus: 0, hnHorsAgglo: 0, hnHorsCommune: 0, poiLus: 0,
                       poiAgglo: 0, hnErreur: null };
    try { await analyserAdresses(segs, listeAgglos, statsAdr); }
    catch (e) { log('analyse des adresses impossible', e); statsAdr.hnErreur = e.message || String(e); }

    const nbSegmentsEnEcart = findings.length;
    findings = regrouperFindings(findings);
    lastScan = { analyses: zones.agglo + zones.hors + zones.cheval + zones.limCom, skipped, zones,
                 ecarts: nbSegmentsEnEcart, lignes: findings.length, nbAgglos: listeAgglos.length,
                 adr: statsAdr };
    renderResults();
    redrawEcarts(null);
  }

  // ===========================================================================
  // CORRECTION
  //
  // Reservee aux rangs eleves (L5/L6) et aux responsables : une correction de
  // masse sur le nommage se voit, et se discute.
  //
  // Regles de sureté tenues ici :
  //  - on n'appelle JAMAIS sdk.Editing.save(). Les modifications restent en
  //    attente dans WME, l'editeur les relit et enregistre lui-meme.
  //  - on n'applique QUE ce dont on connait la cible exacte. Tout le reste
  //    (coupures, cartouches, redaction) reste a faire a la main.
  //  - un report couvrant N segments s'applique aux N d'un coup : l'API
  //    `addAlternateStreet` prend deja `segmentIds` au pluriel.
  // ===========================================================================

  // Habilitation. Ne pas modifier sans accord de l'auteur du script.
  const _fx = t => { let x = 0x811c9dc5;
    for (let i = 0; i < t.length; i++) { x ^= t.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
    return x >>> 0; };
  const _fz = [0x953f8f3, 0x853f760, 0xb53fc19, 0x10202895, 0x851b8c9];
  const _fq = 0x122263d6;

  /**
   * Profil courant, lu sur DEUX sources independantes ; on retient la valeur la
   * plus basse, de sorte qu'en alterer une seule ne change rien.
   */
  function _fp() {
    const v = [];
    try { const u = sdk.State.getUserInfo() || {};
          if (typeof u.rank === 'number') v.push(u.rank); } catch (e) { /* */ }
    let g = false, t = false;
    try { const a = hote.W.loginManager.user.attributes;
          if (typeof a.rank === 'number') v.push(a.rank);
          g = !!a.globalEditor; t = !!a.isStaff; } catch (e) { /* */ }
    return { n: v.length ? Math.min(...v) : -1, g, t, src: v.length };
  }

  /** Jeton d'habilitation : 0 si le profil n'ouvre aucun droit. */
  function _ft() {
    const p = _fp();
    const c = [];
    if (p.n >= 0) c.push('r' + p.n);
    if (p.g) c.push('g1');
    if (p.t) c.push('s1');
    for (const x of c) { const h = _fx(x); if (_fz.indexOf(h) >= 0) return h; }
    return 0;
  }

  /** Recoupement : le jeu de reference doit etre intact. */
  const _fv = () => (_fz.reduce((a, b) => (a ^ b) >>> 0, 0) >>> 0) === _fq;

  let _fcache = null;

  /**
   * Habilitation, calculee a la demande. Au demarrage, `getUserInfo()` et
   * `loginManager` peuvent ne pas etre encore garnis : figer le resultat a ce
   * moment-la afficherait « rang : ? » et desactiverait la correction a tort.
   * On ne met donc en cache QUE si une source a effectivement repondu.
   */
  function droits() {
    if (_fcache && _fcache.rangsLus) return _fcache;
    _fcache = droitDeCorriger();
    return _fcache;
  }

  function droitDeCorriger() {
    const p = _fp();
    const j = _ft();
    const niveau = p.n >= 0 ? 'L' + (p.n + 1) : '?';
    const motifs = [];
    if (j && _fv()) {
      if (_fz.indexOf(_fx('r' + p.n)) >= 0) motifs.push(niveau);
      if (p.g) motifs.push('Global Editor');
      if (p.t) motifs.push('Staff');
    }
    return { autorise: !!j && _fv(), niveau, motifs, rangsLus: p.src };
  }

  /** La « ville vide » de la zone : c'est un objet City reel, pas un null. */
  function villeVide() {
    try { return sdk.DataModel.Cities.getAll().find(c => c.isEmpty) || null; }
    catch (e) { return null; }
  }

  /** Resout — en la creant au besoin — la Street correspondant a (nom, ville). */
  function resoudreStreet(nom, nomVille) {
    const DM = sdk.DataModel;
    let city = null;
    if (nomVille) {
      city = DM.Cities.getCity({ cityName: nomVille });
      if (!city) city = DM.Cities.addCity({ cityName: nomVille });
    } else {
      city = villeVide();
    }
    if (!city) throw new Error('ville « ' + (nomVille || 'sans ville') + ' » introuvable');
    // Le « sans nom » est un objet Street vide, pas un null : getStreet('')
    // le rend directement (verifie).
    return DM.Streets.getStreet({ streetName: nom || '', cityId: city.id }) ||
           DM.Streets.addStreet({ streetName: nom, cityId: city.id });
  }

  /**
   * Ce qu'on sait appliquer d'un report. Rend null si rien n'est automatisable :
   * le bouton n'apparait alors pas, plutot que de promettre une correction
   * qu'on ne saurait pas faire.
   */
  function planDeCorrection(f) {
    if (f.traite) return null;
    // --- Adressage : convertir des numeros en POI residentiels --------------
    // Regle TOUT OU RIEN : creer le POI sans retirer le numero laisserait
    // l'adresse en double, donc pire qu'avant. Si l'un des deux ne peut pas se
    // faire, le bouton n'apparait pas et la ligne dit pourquoi.
    if (f.adresse) {
      if (f.sousType !== 'hn') return null;          // un POI en ville se juge sur place
      if (!f.rueCible || !f.hns || !f.hns.length) return null;
      if (!segmentsEditables([f.segId]).length) return null;
      // ⚠️ On ne regarde PAS ici si les numeros sont deja dans le modele : ca
      // depend du zoom courant, pas du report. La correction les chargera.
      return [{ type: 'hn2poi', nb: f.hns.length, rue: f.rueCible }];
    }
    if (!f.cible) return null;
    const ops = [];
    const cur = f.ecarts || [];
    // Nom principal : on ne touche que si la cible porte un nom (renommer vers
    // « sans nom » demande un objet Street vide, cas rare et delicat).
    if (cur.some(e => e.champ === 'principal') && f.cible.primary && f.cible.primary.name) {
      ops.push({ type: 'principal', nom: f.cible.primary.name, ville: f.cible.primary.cityName });
    }
    // Giratoire : la cible est justement « sans nom », donc on l'applique meme
    // si le nom vise est vide.
    if (f.cas === 'GIR' && cur.some(e => /giratoire/.test(e.champ))) {
      ops.push({ type: 'principal', nom: '', ville: f.cible.primary.cityName });
    }
    // Villes interdites (autoroute, bretelle, rocade, rail) : on repointe le nom
    // principal sur la meme rue, sans ville.
    if (cur.some(e => /^ville interdite \(principal\)/.test(e.champ)) && f.cible.primary.name) {
      ops.push({ type: 'principal', nom: f.cible.primary.name, ville: '' });
    }
    for (const e of cur) {
      if (e.champ !== 'alt manquant') continue;
      const m = String(e.apres).split(' / ');
      const nom = m[0], ville = m.slice(1).join(' / ');
      if (!nom || nom === '‹sans nom›') continue;
      ops.push({ type: 'alt', nom, ville: ville === '‹sans ville›' ? '' : ville });
    }
    // Doublons eventuels
    const vus = new Set();
    const propres = ops.filter(o => {
      const k = o.type + '|' + o.nom + '|' + o.ville;
      if (vus.has(k)) return false; vus.add(k); return true;
    });
    return propres.length ? propres : null;
  }

  /** Ce qui restera a faire a la main apres application. */
  function resteAlaMain(f) {
    const plan = planDeCorrection(f) || [];
    const auto = plan.length;
    const total = (f.ecarts || []).length;
    return Math.max(0, total - auto);
  }

  /** Parmi ces segments, ceux que le rang de l'editeur autorise a modifier. */
  function segmentsEditables(ids) {
    return ids.filter(id => {
      try { return sdk.DataModel.Segments.hasPermissions({ segmentId: id }); }
      catch (e) { return false; }
    });
  }

  /**
   * Conversion des numeros d'un segment en POI residentiels. Chaque numero
   * devient un POI de categorie RESIDENTIAL pose a SA position, portant le
   * numero et la rue (nom + ville), puis le numero est retire du segment.
   * ⚠️ Si la creation d'un POI echoue, on NE supprime pas le numero
   * correspondant : mieux vaut un ecart qui reste qu'une adresse perdue.
   */
  // POI crees par la derniere conversion : on les selectionne pour que
  // l'editeur puisse enchainer a la main (typiquement poser le point d'entree).
  let crees = [];

  function convertirHnEnPoi(f, choix) {
    const DM = sdk.DataModel;
    // Le NOM vient du choix de l'editeur quand il y avait ambiguite, sinon de
    // l'unique adresse portee par le segment.
    const nomRue = (choix && choix.nom) || f.rueCible.nom;
    if (!nomRue) throw new Error('nom de rue indetermine');
    const rues = new Map();               // ville → Street, resolue une seule fois
    const rueDe = ville => {
      if (!rues.has(ville)) {
        const r = resoudreStreet(nomRue, ville);
        if (!r) throw new Error('rue « ' + nomRue + ' / ' + ville + ' » introuvable');
        rues.set(ville, r);
      }
      return rues.get(ville);
    };
    // Ville a retenir pour CE numero : soit celle imposee par l'editeur, soit
    // celle de la commune INSEE qui contient reellement le point.
    const villePour = hn => {
      if (choix && choix.mode === 'fixe') return choix.ville;
      const p = hn.geometry && hn.geometry.coordinates;
      const c = p && communeDuPoint(p[0], p[1]);
      return (c && c.nom) || f.rueCible.ville;
    };
    let faits = 0;
    const echecs = [];
    const villesUtilisees = new Set();
    const laisses = f.hns.length - hnsManipulables(f).length;
    for (const hn of hnsManipulables(f)) {
      let venueId = null;
      const ville = villePour(hn);
      try {
        const rue = rueDe(ville);
        // /!\ addVenue rend un NOMBRE, les autres methodes veulent une CHAINE.
        venueId = String(DM.Venues.addVenue({
          category: REF.adressage.categoriePoi, geometry: hn.geometry }));
        DM.Venues.updateAddress({ venueId, houseNumber: String(hn.number), streetId: rue.id });
      } catch (e) {
        echecs.push(hn.number + ' : ' + (e.message || e));
        continue;                       // POI rate ⇒ on garde le numero
      }
      try {
        DM.HouseNumbers.deleteHouseNumber({ houseNumberId: hn.id });
        faits++; villesUtilisees.add(ville);
        crees.push(venueId);            // pour selectionner le POI ensuite
      } catch (e) {
        // ⚠️ Le POI existe mais le numero resiste : on RETIRE le POI, sinon
        // l'adresse serait en double — pire que l'ecart de depart.
        try { DM.Venues.deleteVenue({ venueId }); } catch (e2) { /* */ }
        echecs.push(hn.number + ' : numero non retirable, POI annule (' + (e.message || e) + ')');
      }
    }
    return { faits, echecs, laisses, villes: [...villesUtilisees] };
  }


  /**
   * Adresse ambigue : on DEMANDE plutot que de choisir a la place de l'editeur.
   * Deux situations, traitees par la meme boite :
   *  - un seul nom, deux communes → voie en limite communale : sur une rue qui
   *    SEPARE deux territoires, les numeros ne sont pas tous du meme cote, d'ou
   *    l'option « suivre la position de chaque numero » ;
   *  - plusieurs noms de rue → on demande le couple NOM + VILLE (l'auteur :
   *    « il faudra demander le choix du nom+ville »). La geometrie ne peut rien
   *    dire du NOM : elle n'est proposee que pour trancher la ville d'un nom
   *    donne.
   */
  function demanderAdresse(f) {
    return new Promise(resolve => {
      const r = f.rueCible;
      // Repartition reelle des numeros d'apres les contours INSEE.
      const parVille = new Map();
      for (const hn of (f.hns || [])) {
        const p = hn.geometry && hn.geometry.coordinates;
        const c = p && communeDuPoint(p[0], p[1]);
        const nom = (c && c.nom) || '—';
        if (!parVille.has(nom)) parVille.set(nom, []);
        parVille.get(nom).push(hn.number);
      }
      const detail = [...parVille.entries()]
        .map(([v, ns]) => `<div class="agn-d"><b>${esc(v)}</b> : ${esc(ns.slice(0, 10).join(', '))}${
          ns.length > 10 ? '…' : ''} <span style="opacity:.7">(${ns.length})</span></div>`).join('');

      // Une option par adresse reellement portee par le segment ; et, pour un
      // nom present avec plusieurs villes, l'option « selon la position ».
      const options = [];
      for (const c of r.candidats) {
        const villes = c.villes.length ? c.villes : [communeActive.nom];
        if (c.villes.length > 1) {
          options.push({ mode: 'geo', nom: c.nom,
            libelle: esc(c.nom) + ' — <b>selon la position</b> de chaque numero', fort: true });
        }
        villes.forEach(v => options.push({ mode: 'fixe', nom: c.nom, ville: v,
          libelle: esc(c.nom) + ' / ' + esc(v) }));
      }

      // Villes offertes a la saisie libre : celles du segment, la commune du
      // contour, et le mode « position » qui suit chaque numero.
      const villesSaisie = [...new Set(r.candidats.flatMap(c => c.villes).concat([communeActive.nom]))];

      const boite = el(`
        <div id="agn-modale">
          <div class="agn-modale-in">
            <div class="agn-modale-t">${r.saisieRequise
              ? 'Aucune adresse sur ce segment'
              : r.plusieursNoms ? 'Plusieurs adresses sur ce segment' : 'Voie en limite communale'}</div>
            <div class="agn-modale-c">
              ${r.saisieRequise
                ? 'Ce segment ne porte qu\'un numero de route, qui ne fait pas une adresse. ' +
                  'Saisis le nom a donner ' + (f.hns.length > 1
                    ? 'aux <b>' + f.hns.length + '</b> numeros' : 'au numero <b>' + esc(f.hns[0].number) + '</b>') + '.'
                : 'Quelle adresse donner ' + (f.hns.length > 1
                    ? 'aux <b>' + f.hns.length + '</b> numeros' : 'au numero <b>' + esc(f.hns[0].number) + '</b>') + ' ?'}
              <div class="agn-modale-geo">D'apres les contours INSEE :${
                detail || '<div class="agn-d">indeterminable</div>'}</div>
            </div>
            ${options.map((o, i) => `<button class="agn-btn ${o.fort ? 'primary' : ''}" data-i="${i}">${o.libelle}</button>`).join('')}
            <div class="agn-modale-saisie">
              <div class="agn-note">${r.saisieRequise ? 'Nom de la rue' : 'Ou saisir une autre adresse'}</div>
              <input type="text" id="agn-saisie-nom" placeholder="Nom de la rue…" autocomplete="off">
              <select class="agn-sel" id="agn-saisie-ville">
                <option value="">Commune selon la position de chaque numero</option>
                ${villesSaisie.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}
              </select>
              <button class="agn-btn ${r.saisieRequise ? 'primary' : ''}" id="agn-saisie-ok" disabled>Utiliser cette adresse</button>
            </div>
            <button class="agn-btn" data-i="-1">Annuler</button>
          </div>
        </div>`);
      document.body.appendChild(boite);
      boite.addEventListener('mousedown', e => e.stopPropagation());
      // La saisie ne doit pas partir dans les raccourcis clavier de WME.
      ['keydown', 'keypress', 'keyup'].forEach(ev =>
        boite.addEventListener(ev, e => e.stopPropagation()));

      const champ = boite.querySelector('#agn-saisie-nom');
      const selVille = boite.querySelector('#agn-saisie-ville');
      const okSaisie = boite.querySelector('#agn-saisie-ok');
      const valider = () => { okSaisie.disabled = !champ.value.trim(); };
      champ.oninput = valider;
      champ.onkeydown = e => { if (e.key === 'Enter' && champ.value.trim()) okSaisie.click(); };
      okSaisie.onclick = () => {
        const nom = champ.value.trim();
        if (!nom) return;
        boite.remove();
        resolve(selVille.value
          ? { mode: 'fixe', nom, ville: selVille.value }
          : { mode: 'geo', nom });
      };
      boite.querySelectorAll('button[data-i]').forEach(b => {
        b.onclick = () => {
          const i = parseInt(b.dataset.i, 10);
          boite.remove();
          resolve(i < 0 ? null : options[i]);
        };
      });
      setTimeout(() => { if (r.saisieRequise) champ.focus(); }, 50);
    });
  }

  async function appliquerCorrection(f) {
    const plan = planDeCorrection(f);
    if (!plan) return { ok: false, motif: 'rien d\'automatisable' };
    if (f.adresse) {
      // Les numeros n'entrent dans le modele qu'a partir du zoom 18 : on les
      // fait charger plutot que de renvoyer l'editeur a un reglage de carte.
      const dispo = await chargerNumeros(f);
      if (!dispo) {
        return { ok: false, motif: 'numeros non charges par WME malgre le cadrage — ' +
          'reessaie apres avoir zoome sur la zone' };
      }
      // Adresse ambigue (limite communale, ou plusieurs noms de rue) : on
      // demande, on ne choisit pas a la place de l'editeur.
      let choix = null;
      if (f.rueCible.ambigu) {
        choix = await demanderAdresse(f);
        if (!choix) return { ok: false, motif: 'conversion annulee' };
      }
      try {
        const r = convertirHnEnPoi(f, choix);
        if (!r.faits) return { ok: false, motif: r.echecs[0] || 'aucun numero converti' };
        // Converti partiellement : la ligne reste a traiter, on ne la barre pas.
        return { ok: true, nb: r.faits, ops: r.faits, bloques: 0,
                 partiel: (r.echecs.length + (r.laisses || 0)) > 0,
                 avertissement: (r.echecs.length + (r.laisses || 0)) +
                   ' numero(s) laisses de cote' };
      } catch (e) {
        log('conversion impossible', e);
        return { ok: false, motif: e.message || String(e) };
      }
    }
    const tous = f.segIds || [f.segId];
    const ids = segmentsEditables(tous);
    if (!ids.length) return { ok: false, motif: 'segment(s) verrouille(s) au-dessus de ton niveau' };
    const bloques = tous.length - ids.length;
    try {
      for (const op of plan) {
        const rue = resoudreStreet(op.nom, op.ville);
        if (!rue) throw new Error('rue « ' + op.nom + ' » introuvable');
        if (op.type === 'principal') {
          ids.forEach(id => sdk.DataModel.Segments.updateAddress(
            { segmentId: id, primaryStreetId: rue.id }));
        } else {
          sdk.DataModel.Segments.addAlternateStreet({ segmentIds: ids, streetId: rue.id });
        }
      }
      return { ok: true, nb: ids.length, ops: plan.length, bloques };
    } catch (e) {
      log('correction impossible', e);
      return { ok: false, motif: e.message || String(e) };
    }
  }

  function nbModifsEnAttente() {
    try { return hote.W.model.actionManager.getActions().length; } catch (e) { return null; }
  }

  // ---------------------------------------------------------------------------
  // Interface — overlay flottant (le panneau lateral fait disparaitre la liste
  // des qu'on selectionne un segment : inutilisable pour travailler)
  // ---------------------------------------------------------------------------

  const CSS = `
  /* Une hauteur par defaut est necessaire : sans elle la fenetre grandit avec
     la liste et deborde par le bas de l'ecran au lieu de faire defiler. */
  /* La fenetre descend desormais bas dans l'ecran : la liste des ecarts est
     longue, et chaque pixel gagne en hauteur est un coup d'ascenseur en moins. */
  #agn-overlay{position:fixed;z-index:9000;width:400px;min-width:300px;min-height:200px;
    height:calc(100vh - 130px);max-height:calc(100vh - 70px);
    background:#fff;border:1px solid #b0bec5;border-radius:8px;
    box-shadow:0 6px 26px rgba(0,0,0,.28);display:flex;flex-direction:column;
    font:12px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1f2933;
    resize:both;overflow:hidden}
  #agn-main{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;overflow:hidden;border-radius:7px}
  /* Repliee, la fenetre se limite a son en-tete : le min-height de travail
     n'a plus lieu d'etre. */
  #agn-overlay.agn-replie{min-height:0;height:auto}
  /* Volet des donnees de reference : il se DEPLOIE VERS LA GAUCHE de la fenetre,
     pour ne pas lui voler de largeur. Il vit HORS de #agn-overlay, dans le
     body : un enfant debordant obligerait a mettre overflow:visible, et la
     poignee de redimensionnement cesse alors de fonctionner. Sa position est
     donc calculee a la main (voir placerVolet). */
  #agn-volet{position:fixed;z-index:9001;width:300px;
    background:#fff;border:1px solid #b0bec5;border-radius:8px;box-shadow:0 6px 26px rgba(0,0,0,.28);
    display:none;flex-direction:column;overflow:hidden;
    font:12px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1f2933}
  #agn-volet.agn-volet-ouvert{display:flex}
  #agn-volet-in{padding:10px 12px 14px;overflow-y:auto;flex:1 1 auto;min-height:0}
  .agn-volet-t{font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.05em;
    color:#546e7a;margin-bottom:8px;border-bottom:1px solid #eceff1;padding-bottom:5px}
  /* Le bouton du volet vit dans la barre d'onglets, PAS dans l'en-tete : la
     ligne de titre n'a pas la place et il la rendait illisible des que la
     fenetre retrecissait (signale par l'auteur). */
  #agn-donnees{flex:0 0 auto;width:30px;padding:7px 0;border:none;background:none;cursor:pointer;
    font-size:13px;color:#546e7a;border-right:1px solid #cfd8dc;border-bottom:2px solid transparent}
  #agn-donnees:hover{background:#e3eaf0}
  #agn-donnees.agn-on{background:#fff;color:#1565c0;border-bottom-color:#1e88e5}
  /* Onglets : on ne montre JAMAIS les deux familles d'ecarts en meme temps —
     melangees, la liste devient illisible (demande de l'auteur). */
  #agn-onglets{display:flex;gap:0;flex:0 0 auto;border-bottom:1px solid #cfd8dc;background:#eceff1}
  .agn-tab{flex:1;padding:7px 6px;border:none;border-bottom:2px solid transparent;background:none;
    cursor:pointer;font-size:11.5px;color:#546e7a;font-weight:600}
  .agn-tab:hover{background:#e3eaf0}
  .agn-tab.agn-tab-on{background:#fff;color:#1565c0;border-bottom-color:#1e88e5}
  .agn-tab-n{display:inline-block;min-width:16px;padding:0 5px;margin-left:3px;border-radius:9px;
    background:#b0bec5;color:#fff;font-size:10px;font-weight:700}
  .agn-tab.agn-tab-on .agn-tab-n{background:#1e88e5}
  #agn-tete{display:flex;align-items:center;gap:8px;padding:7px 10px;background:#1e88e5;color:#fff;
    border-radius:7px 7px 0 0;cursor:move;user-select:none;flex:0 0 auto;overflow:hidden}
  #agn-tete button{flex:0 0 auto}
  /* Le titre cede la place plutot que de pousser les boutons hors de la vue. */
  #agn-tete b{font-size:12.5px;flex:0 1 auto;min-width:0;overflow:hidden;
    text-overflow:ellipsis;white-space:nowrap}
  #agn-tete .agn-v{opacity:.75;font-size:11px;flex:0 0 auto}
  #agn-tete .agn-sp{flex:1}
  #agn-tete button{background:rgba(255,255,255,.18);border:none;color:#fff;cursor:pointer;
    width:22px;height:22px;border-radius:4px;font-size:13px;line-height:1}
  #agn-tete button:hover{background:rgba(255,255,255,.34)}
  /* min-height:0 est INDISPENSABLE : sans lui un element flex refuse de
     descendre sous la hauteur de son contenu, donc il pousse la fenetre au
     lieu de faire defiler la liste. */
  #agn-corps{padding:10px 12px 14px;overflow-y:auto;flex:1 1 auto;min-height:0}
  #agn-corps h3{font-size:11px;margin:13px 0 5px;text-transform:uppercase;letter-spacing:.05em;color:#607d8b}
  #agn-corps h3:first-child{margin-top:0}
  .agn-sect{border:1px solid #e3e7ea;border-radius:5px;margin-bottom:6px;overflow:hidden}
  .agn-sect-t{display:flex;align-items:center;gap:7px;padding:6px 8px;background:#f5f7f9;
    cursor:pointer;user-select:none;font-size:11.5px}
  .agn-sect-t:hover{background:#eceff1}
  .agn-sect-t .agn-chev{color:#78909c;width:9px;flex:0 0 auto}
  .agn-sect-t b{flex:1;font-weight:600;text-transform:uppercase;letter-spacing:.03em;font-size:10.5px;color:#546e7a}
  .agn-sect-r{font-size:11px;color:#1565c0;font-weight:600;max-width:180px;overflow:hidden;
    text-overflow:ellipsis;white-space:nowrap}
  .agn-sect-c{padding:7px 8px 9px}
  .agn-sect.agn-ferme .agn-sect-t{background:#eef4fa}
  .agn-btn{display:block;width:100%;padding:6px 10px;margin:3px 0;border:1px solid #bbb;border-radius:4px;
    background:#fff;cursor:pointer;font-size:12px;color:inherit}
  .agn-btn:hover:not(:disabled){background:#f3f3f3}
  .agn-btn:disabled{opacity:.45;cursor:default}
  .agn-btn.primary{background:#1e88e5;color:#fff;border-color:#1976d2;font-weight:600}
  .agn-btn.primary:disabled{background:#9e9e9e;border-color:#9e9e9e}
  .agn-sel{width:100%;padding:5px;font-size:12px;margin:3px 0;border:1px solid #bbb;border-radius:4px;background:#fff}
  .agn-note{font-size:10.5px;color:#78909c;margin:2px 0}
  .agn-deps{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:0 6px;
    max-height:120px;overflow-y:auto;border:1px solid #ddd;border-radius:4px;padding:4px;margin:4px 0;background:#fafafa}
  .agn-dep{display:flex;align-items:center;gap:4px;font-size:11px;padding:1px 2px;cursor:pointer;border-radius:3px}
  .agn-dep:hover{background:#eceff1}
  .agn-dep code{color:#78909c;font-size:10px;min-width:20px}
  .agn-dep span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .agn-poly{border:1px solid #ddd;border-radius:4px;padding:6px;margin:5px 0;background:#fafafa}
  .agn-poly input[type=text]{width:100%;box-sizing:border-box;margin:2px 0;padding:3px 5px;font-size:12px}
  .agn-row{display:flex;gap:6px;align-items:center;margin-top:4px}
  .agn-row label{flex:1;font-size:11px}
  .agn-mini{border:none;background:none;cursor:pointer;font-size:12px;padding:2px 4px;opacity:.7}
  .agn-mini:hover{opacity:1}
  .agn-stat{background:#eceff1;border-radius:4px;padding:6px 8px;margin:6px 0;font-size:11px}
  .agn-alerte{background:#fff3e0;border:1px solid #ffb74d;color:#a34a00}
  .agn-ok{background:#e8f5e9;border:1px solid #a5d6a7;color:#2e7d32}
  .agn-item{border:1px solid #e0e0e0;border-left-width:4px;border-radius:3px;padding:5px 7px;margin:4px 0;
    cursor:pointer;background:#fff}
  .agn-item:hover{background:#f6f9ff}
  .agn-item.agn-actif{background:#fff8e1;border-color:#ffb300;border-left-color:#ff6f00;box-shadow:0 0 0 1px #ffb300}
  .agn-item.agn-traite{background:#e8f5e9;border-color:#a5d6a7}
  .agn-item.agn-traite .agn-h > span:first-child{text-decoration:line-through;opacity:.6}
  .agn-item.agn-traite .agn-d,.agn-item.agn-traite .agn-warn{opacity:.45}
  .agn-fix-btn{border:1px solid #ffe082;background:#fffde7;color:#e65100;border-radius:3px;cursor:pointer;
    font-size:11px;padding:0;line-height:15px;flex:0 0 auto;width:20px;text-align:center}
  .agn-fix-btn:hover{background:#fff8e1;border-color:#ffb300}
  .agn-fix-grp{border:1px solid #ffe082;background:#fffde7;color:#e65100;border-radius:3px;cursor:pointer;
    font-size:10px;padding:1px 6px;flex:0 0 auto;margin-right:2px}
  .agn-fix-grp:hover{background:#fff8e1;border-color:#ffb300}
  .agn-ok-btn{border:1px solid #c8e6c9;background:#fff;color:#2e7d32;border-radius:3px;cursor:pointer;
    font-size:11px;padding:0;line-height:15px;flex:0 0 auto;width:20px;text-align:center}
  .agn-ok-btn:hover{background:#e8f5e9}
  .agn-item.agn-traite .agn-ok-btn{background:#2e7d32;color:#fff;border-color:#2e7d32}
  .agn-traites{color:#2e7d32;font-weight:600}
  .agn-nb{color:#1565c0;font-weight:700}
  .agn-lock{color:#c62828;font-weight:700}
  .agn-cartouche{border-left-color:#fbc02d}
  .agn-a{border-left-color:#8e24aa}
  #agn-poignees{position:fixed;inset:0;z-index:8500;pointer-events:none}
  .agn-poi{position:fixed;transform:translate(-50%,-50%);border-radius:50%;pointer-events:auto;cursor:grab}
  .agn-poi-s{width:12px;height:12px;background:#e91e63;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.5)}
  .agn-poi-s:hover{background:#ad1457;transform:translate(-50%,-50%) scale(1.25)}
  .agn-poi-m{width:9px;height:9px;background:rgba(255,255,255,.85);border:2px dashed #e91e63;cursor:copy}
  .agn-poi-m:hover{background:#fff;transform:translate(-50%,-50%) scale(1.3)}
  .agn-poly.agn-en-edition{border-color:#e91e63;box-shadow:0 0 0 1px #e91e63}
  .agn-edit-barre{margin-top:6px;padding-top:6px;border-top:1px dashed #e0e0e0}
  .agn-edit-barre span{display:block;font-size:10px;color:#78909c;margin-bottom:4px}
  .agn-edit-barre button{display:inline-block;width:auto;margin-right:5px}
  .agn-forme{border-left-color:#00acc1}
  .agn-special{border-left-color:#546e7a}
  .agn-giratoire{border-left-color:#00e676}
  /* Le libelle absorbe la largeur disponible et le badge a une largeur
     minimale : sans ca, la coche se decale selon la longueur du nom et la
     taille du code de cas, et les ✓ ne sont plus alignes d'une ligne a l'autre. */
  .agn-item .agn-h{display:flex;align-items:flex-start;gap:6px;font-weight:600}
  .agn-item .agn-h > span:first-child{flex:1 1 auto;min-width:0;word-break:break-word}
  .agn-item .agn-cas{font-size:10px;background:#eee;border-radius:3px;padding:1px 5px;font-weight:600;
    white-space:nowrap;flex:0 0 auto;min-width:38px;text-align:center}
  .agn-item .agn-d{font-size:11px;margin-top:3px;opacity:.85}
  .agn-item .agn-warn{color:#c62828;font-size:11px;margin-top:3px}
  .agn-c1,.agn-c2,.agn-c3,.agn-c4,.agn-r1,.agn-r2,.agn-r3,.agn-r4{border-left-color:#1e88e5}
  .agn-h5,.agn-h6,.agn-h7,.agn-h8,.agn-h9{border-left-color:#8e24aa}
  .agn-eb10{border-left-color:#f57c00}
  .agn-lim{border-left-color:#00897b}
  #agn-bulle{position:fixed;z-index:9600;display:none;max-width:420px;pointer-events:none;
    background:#263238;color:#eceff1;border-radius:6px;padding:8px 10px;
    box-shadow:0 4px 18px rgba(0,0,0,.45);font:11.5px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  #agn-bulle .agn-b-t{display:flex;align-items:center;gap:6px;font-weight:700;font-size:12px;margin-bottom:4px}
  #agn-bulle .agn-cas{background:rgba(255,255,255,.18);border-radius:3px;padding:1px 5px;font-size:10px}
  #agn-bulle .agn-b-l{opacity:.9;margin-top:2px}
  #agn-bulle .agn-b-l b{color:#80d8ff;font-weight:600}
  #agn-bulle .agn-b-w{color:#ffab91;margin-top:4px}
  #agn-bulle .agn-b-ok{color:#a5d6a7;margin-top:4px}
  .agn-grp{border:1px solid #e0e0e0;border-radius:4px;margin:5px 0;overflow:hidden}
  .agn-grp-t{display:flex;align-items:center;gap:7px;padding:6px 8px;background:#f5f7f9;
    cursor:pointer;user-select:none;font-size:12px}
  .agn-grp-t:hover{background:#eceff1}
  .agn-grp-t .agn-chev{color:#78909c;width:9px}
  .agn-grp-t b{flex:1;font-weight:600}
  .agn-pastille{width:11px;height:11px;border-radius:2px;flex:0 0 auto;box-shadow:0 0 0 1px rgba(0,0,0,.15)}
  .agn-grp-n{background:#546e7a;color:#fff;border-radius:9px;padding:1px 7px;font-size:10.5px;font-weight:700}
  .agn-grp-c{padding:4px 6px 6px}
  .agn-lien{border:none;background:none;color:#1e88e5;cursor:pointer;font-size:11px;
    text-decoration:underline;padding:2px;margin-left:auto}
  .agn-empty{opacity:.6;font-style:italic;padding:8px 0;font-size:11px}
  .agn-sansagglo{display:flex;align-items:flex-start;gap:6px;margin-top:6px;
    font-style:normal;opacity:1;cursor:pointer;color:#a34a00}
  #agn-modale{position:fixed;inset:0;z-index:9700;background:rgba(0,0,0,.35);
    display:flex;align-items:center;justify-content:center;
    font:12px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1f2933}
  .agn-modale-in{background:#fff;border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,.4);
    padding:14px 16px;width:380px;max-width:92vw}
  .agn-modale-t{font-weight:700;font-size:13px;margin-bottom:8px;color:#c62828}
  .agn-modale-c{font-size:12px;margin-bottom:10px}
  .agn-modale-geo{background:#eceff1;border-radius:4px;padding:6px 8px;margin-top:8px;font-size:11px}
  .agn-modale-saisie{border-top:1px dashed #cfd8dc;margin-top:8px;padding-top:8px}
  .agn-modale-saisie input{width:100%;box-sizing:border-box;padding:5px 7px;font-size:12px;
    border:1px solid #bbb;border-radius:4px;margin:3px 0}
  /* WCT reinsere son bouton en dernier dans le conteneur (il le surveille) :
     inutile de se battre dans le DOM, le conteneur est une grille, donc on se
     place apres lui par l'ordre CSS. */
  #agn-fab-wrap{width:40px;height:40px;order:99}
  #agn-fab-btn{width:40px;height:40px;padding:0;border:none;border-radius:50%;cursor:pointer;
    background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.3);font-size:19px;line-height:1;
    display:flex;align-items:center;justify-content:center}
  #agn-fab-btn:hover{background:#eef3f8}
  #agn-fab-btn.agn-fab-on{box-shadow:0 0 0 2px #1e88e5,0 2px 6px rgba(0,0,0,.3)}
  .agn-sb{font:12px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:2px}
  .agn-sb-t{font-weight:700;font-size:13px;margin-bottom:2px}
  .agn-sb-t span{opacity:.5;font-weight:400;font-size:11px}
  .agn-sb h4{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#607d8b;
    margin:14px 0 5px;border-bottom:1px solid #eceff1;padding-bottom:3px}
  .agn-sb-l{display:flex;align-items:center;gap:6px;margin:5px 0}
  .agn-sb-l span{flex:1}
  .agn-sb-l input{width:58px;padding:2px 4px;font-size:12px}
  .agn-sb-c{display:flex;align-items:flex-start;gap:6px;margin:5px 0;cursor:pointer}
  .agn-sb-col{display:flex;align-items:center;gap:7px;margin:4px 0;cursor:pointer}
  .agn-sb-col input{width:34px;height:22px;padding:0;border:1px solid #ccc;border-radius:3px;background:none;cursor:pointer}
  .agn-sb-n{font-size:11px;color:#e65100;min-height:14px;margin-top:4px}
  .agn-sb-b{width:100%;padding:6px;margin-top:6px;border:1px solid #bbb;border-radius:4px;
    background:#fff;cursor:pointer;font-size:12px}
  .agn-sb-b:hover{background:#f3f3f3}
  .agn-sb-b.agn-sb-p{background:#1e88e5;color:#fff;border-color:#1976d2;font-weight:600}
  .agn-nav{display:flex;gap:6px;align-items:center;margin:6px 0}
  .agn-nav button{flex:0 0 auto;padding:4px 9px}
  .agn-nav span{font-size:11px;color:#607d8b}
  `;

  function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

  function buildOverlay() {
    const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
    const memo = lire(STORE_UI, {});
    if (memo.options) options = Object.assign(options, memo.options);
    // Les controles disponibles dependent du referentiel : on active par defaut
    // ceux qu'il declare et que l'utilisateur n'a pas deja regles.
    REF.controles.forEach(ct => {
      if (options.controles[ct.cle] === undefined) options.controles[ct.cle] = true;
    });

    const o = el(`
      <div id="agn-overlay">
        <div id="agn-main">
        <div id="agn-tete">
          <b>🏙️ Agglo Naming</b><span class="agn-v">v${VERSION}</span><span class="agn-sp"></span>
          <button id="agn-reduire" title="Reduire">–</button>
          <button id="agn-fermer" title="Fermer">✕</button>
        </div>
        <div id="agn-onglets">
          <button id="agn-donnees" title="Contours, commune, agglomeration">☰</button>
          <button class="agn-tab" data-vue="segments">Segments <span class="agn-tab-n"></span></button>
          <button class="agn-tab" data-vue="adresses">Numerotation <span class="agn-tab-n"></span></button>
        </div>
        <div id="agn-corps">
          <button class="agn-btn primary" id="agn-scan" disabled>Analyser la commune</button>
          <div id="agn-stats"></div>
          <div id="agn-fix"></div>
          <div id="agn-results"></div>
        </div>
      </div>
      <div id="agn-volet"><div id="agn-volet-in">
          <div class="agn-volet-t">Donnees de reference</div>
          <div class="agn-sect" data-s="contours">
            <div class="agn-sect-t"><span class="agn-chev">▾</span><b>1. Contours communaux</b>
              <span class="agn-sect-r"></span></div>
            <div class="agn-sect-c">
              <select class="agn-sel" id="agn-source">
                <option value="gouv">Telecharger (geo.api.gouv.fr)</option>
                <option value="fichier">Charger un fichier GeoJSON</option>
                <option value="wazefrance">api.wazefrance.com</option>
              </select>
              <div id="agn-src-gouv">
                <div class="agn-row">
                  <input type="search" id="agn-dep-filtre" placeholder="Filtrer un departement…" style="flex:1">
                  <span class="agn-note" id="agn-dep-n">0</span>
                </div>
                <div class="agn-deps" id="agn-deps"></div>
                <button class="agn-btn" id="agn-dep-go" disabled>Telecharger et charger</button>
              </div>
              <div id="agn-src-fichier" style="display:none">
                <button class="agn-btn" id="agn-contours">Choisir un fichier GeoJSON</button>
              </div>
              <div id="agn-src-wazefrance" style="display:none"><div class="agn-empty"></div></div>
              <input type="file" id="agn-fichier" accept=".geojson,.json" style="display:none">
              <div id="agn-statut-contours"></div>
            </div>
          </div>

          <div class="agn-sect" data-s="commune">
            <div class="agn-sect-t"><span class="agn-chev">▾</span><b>2. Commune a traiter</b>
              <span class="agn-sect-r"></span></div>
            <div class="agn-sect-c">
              <select class="agn-sel" id="agn-commune"><option value="">— charger d'abord les contours —</option></select>
              <div class="agn-note" id="agn-nb-communes"></div>
            </div>
          </div>

          <div class="agn-sect" data-s="agglo">
            <div class="agn-sect-t"><span class="agn-chev">▾</span><b>3. Agglomeration</b>
              <span class="agn-sect-r"></span></div>
            <div class="agn-sect-c">
              <button class="agn-btn" id="agn-tracer" disabled>＋ Tracer l'agglomeration</button>
              <div id="agn-agglos"></div>
            </div>
          </div>
          <button class="agn-btn" id="agn-volet-ok">Terminer et replier</button>
      </div></div>`);
    document.body.appendChild(o);

    ui.overlay = o;
    ui.statutContours = o.querySelector('#agn-statut-contours');
    ui.inputFichier = o.querySelector('#agn-fichier');
    ui.selCommune = o.querySelector('#agn-commune');
    ui.nbCommunes = o.querySelector('#agn-nb-communes');
    ui.btnTracer = o.querySelector('#agn-tracer');
    ui.listeAgglos = o.querySelector('#agn-agglos');
    ui.btnScan = o.querySelector('#agn-scan');
    ui.stats = o.querySelector('#agn-stats');
    ui.bandeauFix = o.querySelector('#agn-fix');
    ui.results = o.querySelector('#agn-results');
    ui.corps = o.querySelector('#agn-corps');
    ui.volet = o.querySelector('#agn-volet');
    ui.btnDonnees = o.querySelector('#agn-donnees');
    ui.onglets = [...o.querySelectorAll('.agn-tab')];
    ui.sections = {};
    o.querySelectorAll('.agn-sect').forEach(sec => {
      ui.sections[sec.dataset.s] = sec;
      sec.querySelector('.agn-sect-t').onclick = () =>
        replierSection(sec.dataset.s, sec.classList.contains('agn-ferme'));
    });

    // position / taille memorisees
    // Par defaut la fenetre se range a DROITE, sous la barre d'outils, du meme
    // cote que le bouton flottant. La position choisie par l'editeur prime,
    // mais on la rejette si elle tombe hors de l'ecran : une taille d'ecran a
    // pu changer depuis, et une fenetre invisible passe pour un script casse.
    const largeur = memo.w || 400;
    // La colonne d'icones de WME (calques, permalien, boutons de scripts) occupe
    // le bord droit : on se range a SA gauche, sinon la fenetre passe dessus.
    const col = document.querySelector('.overlay-buttons-container.top') ||
                document.querySelector('.overlay-buttons-container');
    const reserve = col ? (window.innerWidth - col.getBoundingClientRect().left + 12) : 76;
    const parDefaut = { x: Math.max(0, window.innerWidth - largeur - reserve), y: 90 };
    let x = memo.x != null ? memo.x : parDefaut.x;
    let y = memo.y != null ? memo.y : parDefaut.y;
    if (x < 0 || y < 0 || x > window.innerWidth - 120 || y > window.innerHeight - 60) {
      x = parDefaut.x; y = parDefaut.y;
    }
    o.style.left = x + 'px';
    o.style.top = y + 'px';
    // On borne la hauteur memorisee : l'ecran a pu retrecir depuis, ou la
    // fenetre avoir ete etiree au-dela quand la liste la poussait encore.
    // ⚠️ `uiV` marque la refonte de la v1.70 : la fenetre descend desormais
    // bien plus bas, et une hauteur memorisee sous l'ancienne mise en page
    // annulerait tout le benefice. On ne reprend donc la hauteur enregistree
    // que si elle a ete choisie APRES la refonte.
    // ⚠️ Une taille ABERRANTE (fenetre repliee enregistree par erreur, ecran
    // reduit depuis) n'est pas rattrapee au plancher mais simplement IGNOREE :
    // on rend alors la taille par defaut, la seule confortable. Rattraper au
    // minimum laisserait l'editeur avec une fenetre riquiqui sans qu'il
    // comprenne pourquoi.
    if (memo.h && memo.uiV >= 2 && memo.h >= 260) {
      o.style.height = Math.min(memo.h, window.innerHeight - 70) + 'px';
    }
    if (memo.w && memo.w >= 300) o.style.width = Math.min(memo.w, window.innerWidth - 40) + 'px';
    if (memo.ouvert === false) o.style.display = 'none';

    // Volet des donnees : ouvert d'office tant qu'il n'y a pas de contours, car
    // c'est par la qu'il faut commencer ; referme des que le travail est pret.
    o.querySelector('#agn-donnees').onclick = () => basculerVolet();
    o.querySelector('#agn-volet-ok').onclick = () => basculerVolet(false);
    ui.onglets.forEach(t => { t.onclick = () => choisirVue(t.dataset.vue); });
    choisirVue(memo.vue === 'adresses' ? 'adresses' : 'segments');

    o.querySelector('#agn-contours').onclick = () => ui.inputFichier.click();
    ui.inputFichier.onchange = surFichierContours;
    brancherSources(o);
    ui.btnTracer.onclick = tracerAgglo;
    // Le scan est asynchrone depuis qu'il lit les numeros de rue (aller-retour
    // serveur) : on verrouille le bouton le temps qu'il tourne, et on affiche
    // l'echec plutot que de laisser une promesse tomber en silence.
    ui.btnScan.onclick = async () => {
      const btn = ui.btnScan, texte = btn.textContent;
      btn.disabled = true; btn.textContent = 'Analyse en cours…';
      try { await scan(); }
      catch (e) {
        log('analyse impossible', e);
        ui.stats.innerHTML = '<div class="agn-stat agn-alerte">Analyse impossible : ' +
          esc(e.message || String(e)) + '</div>';
      }
      finally { btn.disabled = false; btn.textContent = texte; }
    };
    ui.selCommune.onchange = () => {
      communeActive = communes.find(c => c.code === ui.selCommune.value) || null;
      redrawCommune(); redrawAgglos(); renderAgglos();
      if (communeActive) replierSection('commune', false);   // choix fait
      if (communeActive) { try { sdk.Map.centerMapOnGeometry({ geometry: communeActive.geom }); } catch (e) { /* */ } }
    };

    o.querySelector('#agn-fermer').onclick = fermerOverlay;
    /**
     * ⚠️⚠️ Reduire la fenetre ne doit JAMAIS ecraser sa hauteur de travail.
     * Bug vecu (auteur, 21/07 : « l'overlay est devenu tres petit apres
     * quelques manipulations ») : replier mettait `height:auto`, le
     * ResizeObserver voyait la fenetre retrecir et `saveUI` enregistrait la
     * hauteur REPLIEE (~40 px) — qui devenait la taille au demarrage suivant.
     * On memorise donc la hauteur avant repli, et `saveUI` n'ecrit rien tant
     * qu'on est replie.
     */
    o.querySelector('#agn-reduire').onclick = () => {
      const replie = o.classList.contains('agn-replie');
      if (!replie) ui.hAvantRepli = o.offsetHeight;      // on la garde sous le coude
      o.classList.toggle('agn-replie', !replie);
      ui.corps.style.display = replie ? '' : 'none';
      const ong = o.querySelector('#agn-onglets');
      if (ong) ong.style.display = replie ? '' : 'none';
      o.style.height = replie ? (ui.hAvantRepli || 560) + 'px' : 'auto';
      o.style.resize = replie ? 'both' : 'none';
      if (replie) placerVolet(); else basculerVolet(false);
      if (replie) saveUI();
    };

    // Deplacement par l'en-tete. On coupe la propagation : sans ca, le
    // glissement part dans la carte de WME.
    const tete = o.querySelector('#agn-tete');
    let drag = null;
    tete.addEventListener('mousedown', e => {
      if (e.target.tagName === 'BUTTON') return;
      const r = o.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      e.preventDefault(); e.stopPropagation();
    });
    document.addEventListener('mousemove', e => {
      if (!drag) return;
      const x = Math.min(Math.max(0, e.clientX - drag.dx), window.innerWidth - 120);
      const y = Math.min(Math.max(0, e.clientY - drag.dy), window.innerHeight - 40);
      o.style.left = x + 'px'; o.style.top = y + 'px';
      placerVolet();                    // le volet reste colle a la fenetre
      e.preventDefault();
    });
    document.addEventListener('mouseup', () => { if (drag) { drag = null; saveUI(); } });

    // La molette et les clics dans nos panneaux ne doivent pas atteindre la carte.
    ['wheel', 'mousedown', 'dblclick', 'contextmenu'].forEach(evt => {
      o.addEventListener(evt, e => e.stopPropagation());
      ui.volet.addEventListener(evt, e => e.stopPropagation());
    });

    new ResizeObserver(() => {
      placerVolet();
      clearTimeout(ui.tResize); ui.tResize = setTimeout(saveUI, 400);
    }).observe(o);

    // ⚠️ EN DERNIER : le volet quitte la fenetre pour vivre dans le body. Tous
    // les querySelector ci-dessus le parcourent encore ; deplacer plus tot
    // casserait le branchement des contours, de la commune et de l'agglo.
    document.body.appendChild(ui.volet);
  }

  /**
   * Une fois l'analyse lancee, les reglages (contours, commune, agglo, options)
   * n'ont plus d'interet immediat : on les replie pour rendre la hauteur a la
   * liste des ecarts. Le bandeau resume rappelle le contexte et rouvre au clic.
   */
  /**
   * Sections repliables. Une fois une etape faite, son contenu n'a plus
   * d'interet immediat : on la referme en laissant un resume, pour rendre la
   * hauteur a la liste des ecarts.
   */
  function replierSection(cle, ouvrir) {
    const sec = ui.sections && ui.sections[cle];
    if (!sec) return;
    sec.classList.toggle('agn-ferme', !ouvrir);
    sec.querySelector('.agn-sect-c').style.display = ouvrir ? '' : 'none';
    sec.querySelector('.agn-chev').textContent = ouvrir ? '▾' : '▸';
    majResumeSections();
  }

  function replierTout() {
    ['contours', 'commune', 'agglo'].forEach(k => replierSection(k, false));
    basculerVolet(false);       // l'analyse commence : place au travail
  }

  /**
   * Volet des donnees de reference. Il se deploie a GAUCHE de la fenetre, en
   * dehors d'elle : la zone de travail garde toute sa largeur. S'il n'y a pas
   * la place a gauche, il bascule a droite plutot que de sortir de l'ecran.
   */
  function basculerVolet(force) {
    const ouvrir = force !== undefined ? force : !ui.volet.classList.contains('agn-volet-ouvert');
    ui.volet.classList.toggle('agn-volet-ouvert', ouvrir);
    ui.btnDonnees.classList.toggle('agn-on', ouvrir);
    if (ouvrir) { placerVolet(); majResumeSections(); }
  }

  /**
   * Colle le volet contre le bord GAUCHE de la fenetre, a la meme hauteur.
   * S'il n'y a pas la place a gauche, il passe a droite plutot que de sortir
   * de l'ecran.
   */
  function placerVolet() {
    if (!ui.volet || !ui.volet.classList.contains('agn-volet-ouvert')) return;
    const r = ui.overlay.getBoundingClientRect();
    const L = 300, marge = 8;
    const aGauche = r.left >= L + marge;
    ui.volet.style.left = (aGauche ? r.left - L - marge : Math.min(r.right + marge, window.innerWidth - L - 4)) + 'px';
    ui.volet.style.top = r.top + 'px';
    ui.volet.style.height = r.height + 'px';
  }

  /**
   * Onglet courant : segments OU numerotation, jamais les deux. Melangees, les
   * deux familles rendent la liste illisible (contrainte de l'auteur). Une
   * seule analyse alimente les deux vues : changer d'onglet ne relance rien.
   */
  let vueCourante = 'segments';
  function choisirVue(vue) {
    vueCourante = (vue === 'adresses') ? 'adresses' : 'segments';
    ui.onglets.forEach(t => t.classList.toggle('agn-tab-on', t.dataset.vue === vueCourante));
    saveUI();
    renderResults();
    redrawEcarts(null);
  }

  /** Les reports de l'onglet courant. */
  const findingsVisibles = () =>
    findings.filter(f => (vueCourante === 'adresses') === !!f.adresse);

  /** Chaque onglet annonce son nombre de reports, meme quand il n'est pas actif. */
  function majCompteursOnglets() {
    if (!ui.onglets) return;
    const n = { segments: 0, adresses: 0 };
    findings.forEach(f => { n[f.adresse ? 'adresses' : 'segments']++; });
    ui.onglets.forEach(t => {
      const c = t.querySelector('.agn-tab-n');
      if (c) c.textContent = n[t.dataset.vue] || '0';
    });
  }

  /** Chaque en-tete rappelle l'essentiel de ce qu'elle contient. */
  function majResumeSections() {
    if (!ui.sections) return;
    const mettre = (cle, txt) => {
      const sec = ui.sections[cle]; if (!sec) return;
      sec.querySelector('.agn-sect-r').textContent = txt || '';
    };
    mettre('contours', metaContours ? metaContours.nb + ' communes' : 'aucun');
    mettre('commune', communeActive ? communeActive.nom : 'aucune');
    const n = communeActive ? (agglos[communeActive.code] || []).length : 0;
    mettre('agglo', !communeActive ? '—'
      : n ? n + ' polygone' + (n > 1 ? 's' : '')
      : sansAgglo[communeActive.code] ? 'sans agglomeration (declare)'
      : '⚠ a tracer');
  }

  /**
   * Panneau de reglages, dans l'onglet du panneau lateral. Tout ce qui se
   * regle une fois pour toutes vit ici ; l'overlay ne garde que le travail
   * courant. Un changement d'option d'analyse demande une nouvelle analyse :
   * on le dit plutot que de relancer d'office (le scan coute plusieurs secondes).
   * /!\ Cette fonction a disparu par accident en v1.53 alors que son appel
   * restait dans init() : ReferenceError, et tout ce qui suivait l'appel
   * (restauration des contours, rendu, abonnement carte) ne tournait plus.
   */
  function buildReglages(pane) {
    pane.innerHTML = `
      <div class="agn-sb">
        <div class="agn-sb-t">${SCRIPT_NAME} <span>v${VERSION}</span></div>

        <h4>Analyse</h4>
        <label class="agn-sb-l" title="Part de longueur au-dela de laquelle un segment a cheval est rattache d'office a un cote. En dessous, il est signale comme a couper.">
          <span>Seuil de rattachement</span>
          <input type="number" id="agn-r-seuil" min="50" max="100" step="5"> %</label>
        <label class="agn-sb-c"><input type="checkbox" id="agn-r-sansadresse">
          Inclure parkings et voies privees</label>
        <label class="agn-sb-c"><input type="checkbox" id="agn-r-alt">
          Signaler les noms alternatifs surnumeraires</label>

        <h4>Controles</h4>
        <div id="agn-r-controles"></div>
        <div class="agn-sb-n" id="agn-r-relance"></div>

        <h4>Navigation</h4>
        <label class="agn-sb-c"><input type="checkbox" id="agn-r-zoom">
          Cadrer sur le segment au clic</label>
        <label class="agn-sb-l" title="Le zoom s'adapte a l'emprise des segments ; cette valeur en est le plafond.">
          <span>Zoom maximal</span>
          <input type="number" id="agn-r-zoomniv" min="12" max="22" step="1"></label>

        <h4>Surlignage des segments</h4>
        <label class="agn-sb-c"><input type="checkbox" id="agn-r-surligner">
          Surligner les segments en ecart sur la carte</label>
        <div id="agn-r-couleurs"></div>
        <button class="agn-sb-b" id="agn-r-reset">Couleurs par defaut</button>

        <h4>Correction</h4>
        <div class="agn-sb-n" id="agn-r-droits"></div>

        <h4>Fenetre de travail</h4>
        <button class="agn-sb-b agn-sb-p" id="agn-rouvrir">Afficher la fenetre</button>
      </div>`;

    const q = s => pane.querySelector(s);
    const prevenir = () => { q('#agn-r-relance').textContent = 'Relance une analyse pour appliquer.'; };

    const seuil = q('#agn-r-seuil');
    seuil.value = Math.round(options.seuil * 100);
    seuil.onchange = () => {
      const v = Math.min(100, Math.max(50, parseInt(seuil.value, 10) || 80));
      seuil.value = v; options.seuil = v / 100; saveUI(); prevenir();
    };

    const coche = (id, cle, apres) => {
      const c = q(id); c.checked = !!options[cle];
      c.onchange = () => { options[cle] = c.checked; saveUI(); if (apres) apres(); };
    };
    coche('#agn-r-sansadresse', 'sansAdresse', prevenir);
    coche('#agn-r-alt', 'altEnTrop', prevenir);

    // La liste des controles vient du REFERENTIEL du pays, pas d'une liste en
    // dur : un autre pays affichera automatiquement les siens.
    const zoneCtrl = q('#agn-r-controles');
    REF.controles.forEach(({ cle, libelle }) => {
      const l = el(`<label class="agn-sb-c"><input type="checkbox"> ${esc(libelle)}</label>`);
      const inp = l.querySelector('input');
      inp.checked = !!options.controles[cle];
      inp.onchange = () => { options.controles[cle] = inp.checked; saveUI(); prevenir(); };
      zoneCtrl.appendChild(l);
    });
    coche('#agn-r-zoom', 'zoomClic');
    coche('#agn-r-surligner', 'surligner', () => redrawEcarts(null));

    const zn = q('#agn-r-zoomniv');
    zn.value = options.zoomNiveau;
    zn.onchange = () => {
      const v = Math.min(22, Math.max(12, parseInt(zn.value, 10) || 17));
      zn.value = v; options.zoomNiveau = v; saveUI();
    };

    const zoneCouleurs = q('#agn-r-couleurs');
    const peindre = () => {
      zoneCouleurs.innerHTML = '';
      for (const [cle, f] of Object.entries(FAMILLES)) {
        const l = el(`<label class="agn-sb-col">
            <input type="color" value="${options.couleurs[cle] || f.defaut}">
            <span>${f.libelle}</span></label>`);
        l.querySelector('input').onchange = e => {
          options.couleurs[cle] = e.target.value; saveUI(); redrawEcarts(null);
        };
        zoneCouleurs.appendChild(l);
      }
    };
    peindre();
    q('#agn-r-reset').onclick = () => {
      for (const [cle, f] of Object.entries(FAMILLES)) options.couleurs[cle] = f.defaut;
      saveUI(); peindre(); redrawEcarts(null);
    };

    // Le profil n'est pas lisible au demarrage : on retente tant qu'il est muet
    // (bug vecu — « ton rang : ? » et correction desactivee a tort).
    const zoneDroits = q('#agn-r-droits');
    const peindreDroits = () => {
      const d = droits();
      zoneDroits.style.color = d.autorise ? '#2e7d32' : '#a34a00';
      zoneDroits.innerHTML = d.autorise
        ? 'Correction activee — ' + esc(d.motifs.join(', ')) +
          '.<br>Les corrections ne sont <b>jamais enregistrees</b> automatiquement.'
        : d.rangsLus
          ? 'Correction desactivee : reservee aux L5, L6, Global Editors et staff (ton rang : ' +
            esc(d.niveau) + ').'
          : 'Lecture du profil en cours…';
      return d.rangsLus > 0;
    };
    if (!peindreDroits()) {
      let n = 0;
      const t = setInterval(() => { if (peindreDroits() || ++n > 20) clearInterval(t); }, 1000);
    }

    q('#agn-rouvrir').onclick = ouvrirOverlay;
  }

  function ouvrirOverlay() {
    ui.overlay.style.display = '';
    ui.overlay.style.left = Math.min(parseInt(ui.overlay.style.left, 10) || 0, window.innerWidth - 200) + 'px';
    repeindreCarte();
    saveUI(); majFab();
  }

  function fermerOverlay() {
    ui.overlay.style.display = 'none';
    nettoyerCarte();
    saveUI(); majFab();
  }

  /** Fenetre fermee = carte rendue a WME : plus un seul de nos calques. */
  function nettoyerCarte() {
    if (edition) sortirEdition(false);
    cacherBulle();
    [LAYER_COMMUNE, LAYER_AGGLO, LAYER_ECARTS, LAYER_ADRESSES].forEach(n => {
      try { sdk.Map.removeAllFeaturesFromLayer({ layerName: n }); } catch (e) { /* */ }
    });
  }

  /** Reouverture : on remet ce qui correspond a l'etat courant. */
  function repeindreCarte() {
    redrawCommune(); redrawAgglos(); redrawEcarts(null);
  }

  /**
   * Bouton flottant dans la colonne d'icones de droite de WME, a la suite de
   * celui de WCT (meme conteneur `.overlay-buttons-container.top`, donc il
   * s'empile juste en dessous). Le conteneur n'existe pas forcement au
   * demarrage : on reessaie tant qu'il n'est pas la.
   */
  function installerFab() {
    const poser = () => {
      if (document.querySelector('#agn-fab-wrap')) return true;
      const cont = document.querySelector('.overlay-buttons-container.top') ||
                   document.querySelector('.overlay-buttons-container');
      if (!cont) return false;
      const wrap = el(`<div id="agn-fab-wrap"><button id="agn-fab-btn" type="button">🏙️</button></div>`);
      cont.appendChild(wrap);
      wrap.querySelector('button').onclick = () => {
        if (ui.overlay.style.display === 'none') ouvrirOverlay(); else fermerOverlay();
      };
      majFab();
      return true;
    };
    if (poser()) return;
    let essais = 0;
    const t = setInterval(() => { if (poser() || ++essais > 40) clearInterval(t); }, 500);
  }

  function majFab() {
    const b = document.querySelector('#agn-fab-btn');
    if (!b || !ui.overlay) return;
    const ouvert = ui.overlay.style.display !== 'none';
    b.classList.toggle('agn-fab-on', ouvert);
    b.title = SCRIPT_NAME + (ouvert ? ' — masquer la fenetre' : ' — afficher la fenetre');
  }

  // ---------------------------------------------------------------------------
  // Rendus
  // ---------------------------------------------------------------------------

  /** Selecteur de source + liste des departements, integres a la fenetre. */
  function brancherSources(o) {
    const sel = o.querySelector('#agn-source');
    const zones = { gouv: o.querySelector('#agn-src-gouv'),
                    fichier: o.querySelector('#agn-src-fichier'),
                    wazefrance: o.querySelector('#agn-src-wazefrance') };
    o.querySelector('#agn-src-wazefrance').firstElementChild.textContent = SOURCES.wazefrance.indisponible;
    sel.onchange = () => {
      Object.entries(zones).forEach(([k, z]) => { z.style.display = k === sel.value ? '' : 'none'; });
      ecrire('wmeAggloNaming.source', sel.value);
    };
    sel.value = lire('wmeAggloNaming.source', 'gouv');
    sel.onchange();

    const grille = o.querySelector('#agn-deps');
    const compte = o.querySelector('#agn-dep-n');
    const go = o.querySelector('#agn-dep-go');
    const choisis = new Set();
    const majCompte = () => {
      compte.textContent = choisis.size ? choisis.size + ' coche(s)' : '0';
      go.disabled = choisis.size === 0;
    };
    DEPARTEMENTS.forEach(d => {
      const l = el('<label class="agn-dep" data-cle="' + esc(normSansAccent(d.code + ' ' + d.nom)) +
        '"><input type="checkbox"><code>' + esc(d.code) + '</code><span>' + esc(d.nom) + '</span></label>');
      l.querySelector('input').onchange = e => {
        if (e.target.checked) choisis.add(d.code); else choisis.delete(d.code);
        majCompte();
      };
      grille.appendChild(l);
    });
    majCompte();
    o.querySelector('#agn-dep-filtre').oninput = e => {
      const q = normSansAccent(e.target.value.trim());
      grille.querySelectorAll('.agn-dep').forEach(l => {
        l.style.display = !q || l.dataset.cle.includes(q) ? '' : 'none';
      });
    };
    go.onclick = async () => {
      go.disabled = true;
      const codes = [...choisis].sort();
      try {
        const r = await chargerDepuisGouv(codes, (i, n, d) => {
          ui.statutContours.innerHTML = '<div class="agn-stat">Telechargement ' + i + ' / ' + n +
            ' — departement ' + esc(d) + '…</div>';
        });
        if (r.echecs.length) ui.statutContours.innerHTML +=
          '<div class="agn-stat agn-alerte">Echec : ' + esc(r.echecs.join(' ; ')) + '</div>';
      } catch (e) {
        ui.statutContours.innerHTML = '<div class="agn-stat agn-alerte">' + esc(e.message) + '</div>';
      } finally { go.disabled = choisis.size === 0; }
    };
  }

  function renderContours() {
    if (!metaContours) {
      ui.statutContours.innerHTML = '<div class="agn-empty">Aucun contour charge. ' +
        'Fabrique le fichier avec Recuperer-Communes.html.</div>';
      return;
    }
    ui.statutContours.innerHTML = `<div class="agn-stat agn-ok">
      <b>${metaContours.nb}</b> commune(s) — <span style="opacity:.75">${esc(metaContours.nom)}</span></div>`;
  }

  function renderAgglos() {
    ui.btnTracer.disabled = !communeActive;
    if (!communeActive) {
      ui.btnScan.disabled = true;
      ui.listeAgglos.innerHTML = '<div class="agn-empty">Choisis une commune.</div>';
      majResumeSections();     // sinon l'en-tete annonce encore la commune perdue
      return;
    }
    const liste = agglos[communeActive.code] || [];
    // ⚠️ Le bouton d'analyse reste FERME tant qu'on n'a ni polygone ni
    // declaration explicite : sans zonage, tous les ecarts seraient faux.
    const declaree = !!sansAgglo[communeActive.code];
    ui.btnScan.disabled = !liste.length && !declaree;
    if (!liste.length) {
      ui.listeAgglos.innerHTML = '';
      const bloc = el(`<div class="agn-empty">
          Aucune agglomeration tracee pour <b>${esc(communeActive.nom)}</b>.<br>
          <label class="agn-sansagglo"><input type="checkbox" ${declaree ? 'checked' : ''}>
            cette commune n'a <b>aucune agglomeration</b> (tout est hors agglo)</label>
        </div>`);
      bloc.querySelector('input').onchange = e => {
        if (e.target.checked) sansAgglo[communeActive.code] = true;
        else delete sansAgglo[communeActive.code];
        saveSansAgglo(); renderAgglos(); majResumeSections();
      };
      ui.listeAgglos.appendChild(bloc);
      majResumeSections();
      return;
    }
    majResumeSections();
    ui.listeAgglos.innerHTML = '';
    liste.forEach((a, i) => {
      const node = el(`
        <div class="agn-poly">
          <input type="text" class="agn-label" title="Simple etiquette de reperage : elle n'entre PAS dans l'analyse"
                 placeholder="Etiquette (reperage seul)" value="${esc(a.label)}">
          <div class="agn-row">
            <label><input type="checkbox" class="agn-ratt" ${a.rattache ? 'checked' : ''}> village rattache</label>
            <button class="agn-mini agn-edit" title="Editer les sommets">✎</button>
            <button class="agn-mini agn-zoom" title="Centrer">◎</button>
            <button class="agn-mini agn-del" title="Supprimer">✕</button>
          </div>
          <div class="agn-note">${a.ring.length - 1} sommets — ville appliquee : <b>${
            esc(a.rattache ? '‹ville du segment› (' + communeActive.nom + ')' : communeActive.nom)}</b></div>
        </div>`);
      node.querySelector('.agn-label').onchange = e => { a.label = e.target.value.trim(); saveAgglos(); redrawAgglos(); renderAgglos(); };
      node.querySelector('.agn-ratt').onchange = e => { a.rattache = e.target.checked; saveAgglos(); renderAgglos(); };
      node.querySelector('.agn-del').onclick = () => {
        liste.splice(i, 1);
        if (!liste.length) delete agglos[communeActive.code];
        saveAgglos(); redrawAgglos(); renderAgglos();
      };
      node.querySelector('.agn-zoom').onclick = () => {
        try { sdk.Map.centerMapOnGeometry({ geometry: { type: 'Polygon', coordinates: [a.ring] } }); } catch (e) { /* */ }
      };
      node.querySelector('.agn-edit').onclick = () => entrerEdition(a);
      if (edition && edition.agglo === a) {
        node.classList.add('agn-en-edition');
        const barre = el(`<div class="agn-edit-barre">
            <span>Glisser un point plein · cliquer un point creux pour en ajouter · clic droit pour supprimer</span>
            <button class="agn-btn" data-a="ok">Terminer</button>
            <button class="agn-btn" data-a="ko">Annuler</button></div>`);
        barre.querySelector('[data-a=ok]').onclick = () => sortirEdition(true);
        barre.querySelector('[data-a=ko]').onclick = () => sortirEdition(false);
        node.appendChild(barre);
      }
      ui.listeAgglos.appendChild(node);
    });
  }

  let indexCourant = -1;

  /**
   * Marque un ecart comme traite : il reste dans la liste, barre et coche, mais
   * son surlignage disparait de la carte. A la prochaine analyse il ne devrait
   * plus remonter du tout — c'est la verification que la correction a pris.
   * Cette fonction sera aussi le point d'entree de la correction automatique.
   */
  function marquerTraite(f, node, force) {
    f.traite = force !== undefined ? force : !f.traite;
    node.classList.toggle('agn-traite', !!f.traite);
    redrawEcarts(null);
    majCompteurTraites();
  }

  /**
   * Applique une serie de corrections, puis rend la main. On ne sauvegarde
   * pas : le compteur rappelle combien de modifications attendent dans WME,
   * c'est l'editeur qui relit et enregistre.
   */
  async function corriger(liste, noeuds) {
    let ok = 0, segments = 0, bloques = 0;
    crees = [];                 // on ne selectionne que les POI de CETTE serie
    // Une conversion d'adresses compte des NUMEROS, pas des segments.
    const unite = liste.every(f => f.adresse) ? 'numero' : 'segment';
    const echecs = [];
    for (let i = 0; i < liste.length; i++) {
      const f = liste[i];
      const res = await appliquerCorrection(f);
      if (res.ok) {
        ok++; segments += res.nb; bloques += (res.bloques || 0);
        // Une conversion partielle laisse du travail : on ne barre pas la ligne.
        if (res.partiel) echecs.push(f.libelle + ' — ' + res.avertissement);
        else if (noeuds && noeuds[i]) marquerTraite(f, noeuds[i], true);
      } else echecs.push(f.libelle + ' — ' + res.motif);
    }
    redrawEcarts(null);
    majBandeauCorrection(ok, segments, echecs, bloques, unite);
    // Demande de l'auteur : apres une conversion, c'est le POI qui doit etre
    // selectionne, pas le segment d'origine — on enchaine en general sur son
    // point d'entree.
    if (crees.length) {
      try { sdk.Editing.setSelection({ selection: { ids: crees.slice(), objectType: 'venue' } }); }
      catch (e) { log('selection des POI creees impossible', e); }
      crees = [];
    }
  }

  function majBandeauCorrection(ok, segments, echecs, bloques, unite) {
    if (!ui.bandeauFix) return;
    const enAttente = nbModifsEnAttente();
    if (!ok && (!echecs || !echecs.length)) { ui.bandeauFix.innerHTML = ''; return; }
    ui.bandeauFix.innerHTML =
      `<div class="agn-stat ${echecs.length ? 'agn-alerte' : 'agn-ok'}">
        <b>${ok}</b> correction(s) appliquee(s) sur <b>${segments}</b> ${(unite || 'segment')}(s).
        ${bloques ? '<b>' + bloques + '</b> segment(s) ignore(s), verrouille(s) au-dessus de ton niveau. ' : ''}
        ${enAttente != null ? '<b>' + enAttente + '</b> modification(s) en attente dans WME — ' : ''}
        <b>rien n'est enregistre</b> : relis, puis clique sur Enregistrer dans WME.
        ${echecs.length ? '<br>Echecs : ' + echecs.slice(0, 3).map(esc).join(' ; ') +
          (echecs.length > 3 ? ' …' : '') : ''}
      </div>`;
  }

  function majCompteurTraites() {
    if (!ui.traites) return;
    const n = findings.filter(f => f.traite).length;
    ui.traites.textContent = n ? n + ' traite' + (n > 1 ? 's' : '') : '';
  }

  function allerA(i) {
    const items = [...ui.results.querySelectorAll('.agn-item')];
    if (!items.length) return;
    indexCourant = Math.min(Math.max(0, i), items.length - 1);
    const node = items[indexCourant];
    items.forEach(n => n.classList.remove('agn-actif'));
    node.classList.add('agn-actif');
    // un item dans un groupe replie ne peut pas etre montre : on ouvre d'abord
    const grp = node.closest('.agn-grp');
    if (grp && !grp.classList.contains('agn-ouvert')) ouvrirGroupe(grp, true);
    node.scrollIntoView({ block: 'nearest' });
    ui.compteur.textContent = (indexCourant + 1) + ' / ' + items.length;

    // /!\ Ne PAS deduire le report de la position dans la liste : les lignes
    // sont reparties par thematique, l'ordre du DOM differe de celui du tableau.
    const idx = parseInt(node.dataset.idx, 10);
    const f = findings[idx];
    if (!f) return;
    // On cadre AVANT de selectionner : deplacer la carte fait perdre la
    // selection (les objets sortis de la vue sont laches par WME), et on se
    // retrouvait avec un cadrage correct mais plus rien de selectionne.
    cadrerSur(f);
    // Un POI n'est pas un segment : on le selectionne comme venue, et on ne
    // retente pas — il est deja charge puisqu'on vient de le lire.
    if (f.adresse && f.sousType === 'poi') {
      try { sdk.Editing.setSelection({ selection: { ids: [f.venueId], objectType: 'venue' } }); }
      catch (e) { log('selection du POI impossible', e); }
      redrawEcarts(idx);
      return;
    }
    // On ne peut selectionner que ce qui est CHARGE dans le modele : apres un
    // deplacement, les troncons eloignes n'arrivent qu'au chargement suivant.
    // D'ou plusieurs tentatives, sur les seuls segments reellement presents.
    const selectionner = () => {
      const dispo = f.segIds.filter(id => {
        try { return !!sdk.DataModel.Segments.getById({ segmentId: id }); } catch (e) { return false; }
      });
      if (!dispo.length) return false;
      try { sdk.Editing.setSelection({ selection: { ids: dispo, objectType: 'segment' } }); }
      catch (e) { log('selection impossible', e); }
      return dispo.length === f.segIds.length;
    };
    if (!selectionner()) {
      let n = 0;
      const t = setInterval(() => { if (selectionner() || ++n > 6) clearInterval(t); }, 600);
    }

    redrawEcarts(idx);
  }

  /**
   * Centre la carte sur un report et zoome.
   * ⚠️ `centerMapOnGeometry` n'accepte que Point, LineString et Polygon — il
   * REJETTE MultiLineString (ValidationError), ce qui faisait echouer en
   * silence le cadrage de tous les reports multi-segments. On calcule donc
   * l'emprise nous-memes : centrage au milieu, puis zoom reglé ; et si
   * l'emprise ne tient pas a l'ecran a ce zoom, on cadre la boite englobante,
   * seul moyen de voir d'un coup tout ce qui vient d'etre selectionne.
   */
  /** Emprise d'une liste de points : centre de gravite et rayon. */
  function emprise(pts) {
    let sx = 0, sy = 0;
    pts.forEach(c => { sx += c[0]; sy += c[1]; });
    const centre = { lon: sx / pts.length, lat: sy / pts.length };
    let rx = 0, ry = 0;
    pts.forEach(c => { rx = Math.max(rx, Math.abs(c[0] - centre.lon));
                       ry = Math.max(ry, Math.abs(c[1] - centre.lat)); });
    return { centre, rx, ry };
  }

  /**
   * Cadre la carte sur un report.
   *
   * Un report peut couvrir des troncons CONTIGUS (une rue decoupee) ou
   * DISPERSES sur plusieurs kilometres (une departementale qui traverse la
   * commune). Cadrer l'ensemble dans le second cas donne un zoom si large que
   * la selection devient illisible, et un centre qui tombe entre les groupes,
   * donc a cote de tout. On cadre donc l'ensemble tant qu'il tient a un zoom
   * de travail, et sinon on se pose sur le troncon le plus long — les autres
   * restent surlignes sur la carte pour qu'on sache ou ils sont.
   */
  function cadrerSur(f) {
    const geoms = (f.geoms || [f.geom]).filter(g => g && g.coordinates && g.coordinates.length);
    if (!geoms.length) {
      if (f.centre) { try { sdk.Map.setMapCenter({ lonLat: f.centre }); } catch (e) { /* */ } }
      return;
    }
    // ⚠️ Un Point porte `coordinates: [lon, lat]`, une ligne `[[lon,lat], ...]` :
    // les etaler pareil donnerait une liste de NOMBRES et casserait l'emprise.
    const tous = [];
    geoms.forEach(g => { if (g.type === 'Point') tous.push(g.coordinates);
                         else tous.push(...g.coordinates); });
    let e = emprise(tous);
    let z = zoomPour(2 * e.rx, 2 * e.ry, e.centre.lat);

    if (f.disperse && geoms.length > 1) {
      // Trop disperse : on se pose sur le troncon le plus long.
      let meilleur = geoms[0], long = -1;
      geoms.forEach(g => {
        let d = 0;
        for (let i = 1; i < g.coordinates.length; i++) d += longueur(g.coordinates[i - 1], g.coordinates[i]);
        if (d > long) { long = d; meilleur = g; }
      });
      e = emprise(meilleur.coordinates);
      z = zoomPour(2 * e.rx, 2 * e.ry, e.centre.lat);
    }

    // Un report d'ADRESSE se regarde de pres : sous le zoom 18, WME n'affiche
    // meme pas les numeros dont on parle (et ne les charge pas non plus).
    if (f.adresse) z = Math.max(z, ZOOM_NUMEROS);
    try {
      sdk.Map.setMapCenter({ lonLat: e.centre });
      if (options.zoomClic) sdk.Map.setZoomLevel({ zoomLevel: z });
    } catch (err) { log('cadrage impossible', err); }
  }

  /**
   * Zoom adapte a l'emprise a montrer, plutot qu'une valeur fixe : un tronçon
   * de dix metres et une departementale de trois kilometres n'appellent pas le
   * meme cadrage. `options.zoomNiveau` sert de plafond, ZOOM_PLANCHER de
   * limite basse. Marge volontairement faible, et arrondi au plus proche : un
   * arrondi vers le bas perdait un niveau entier, soit un facteur deux.
   */
  const ZOOM_PLANCHER = 12;
  function zoomPour(dLon, dLat, lat) {
    const marge = 1.12;
    const cos = Math.max(0.15, Math.cos(lat * Math.PI / 180));
    const zLon = Math.log2(window.innerWidth * 360 / (256 * Math.max(dLon, 1e-6) * marge));
    const zLat = Math.log2(window.innerHeight * 360 * cos / (256 * Math.max(dLat, 1e-6) * marge));
    return Math.max(ZOOM_PLANCHER, Math.min(options.zoomNiveau, Math.round(Math.min(zLon, zLat))));
  }

  function renderResults() {
    const s = lastScan;
    // Chaque onglet ne montre QUE ses propres reports, et son propre bilan :
    // afficher les deux ensemble rendait la liste illisible.
    const liste = findingsVisibles();
    majCompteursOnglets();
    if (s && communeActive) {
      const z = s.zones;
      ui.stats.innerHTML = vueCourante === 'segments'
        ? `<div class="agn-stat">
        <b>${s.ecarts}</b> segment(s) en ecart sur <b>${s.analyses}</b> analyses a ${esc(communeActive.nom)}${
          s.lignes && s.lignes !== s.ecarts ? ', regroupes en <b>' + s.lignes + '</b> report(s)' : ''}.<br>
        ${z.agglo} en agglo · ${z.hors} hors agglo · ${z.cheval} a couper (agglo) · ${z.limCom} a couper (commune)${
          z.limitrophe ? ' · ' + z.limitrophe + ' debordent legerement' : ''}${
          z.cartouche ? ' · ' + z.cartouche + ' cartouche(s) a poser' : ''}${
          z.special ? ' · ' + z.special + ' voie(s) a regle propre' : ''}${
          z.giratoire ? ' · ' + z.giratoire + ' giratoire(s)' : ''}.<br>
        Ignores : ${s.skipped.horsCommune} hors commune, ${s.skipped.sansAdresse} sans adressage, ${s.skipped.horsRegle} regles propres.
      </div>`
        : `<div class="agn-stat">
        ${s.adr ? '<b>' + s.adr.hnLus + '</b> numero(s) lu(s) a ' + esc(communeActive.nom) +
            ', dont <b>' + s.adr.hnHorsAgglo + '</b> hors agglomeration.<br><b>' +
            s.adr.poiLus + '</b> POI residentiel(s), dont <b>' + s.adr.poiAgglo + '</b> en agglomeration.' +
            (s.adr.hnErreur ? '<br><span class="agn-alerte">Lecture des numeros : ' + esc(s.adr.hnErreur) + '</span>' : '') +
            (s.adr.hnHorsAgglo
              ? '<br><span style="opacity:.8">La conversion cadre elle-meme sur les numeros : ' +
                'WME ne les charge qu\'a partir du zoom ' + ZOOM_NUMEROS + '.</span>' : '')
          : 'Analyse non lancee.'}
      </div>`;
    }
    ui.results.innerHTML = '';
    indexCourant = -1;
    if (!liste.length) {
      ui.results.innerHTML = '<div class="agn-empty">' + (findings.length
        ? 'Aucun ecart dans cet onglet — regarde l\'autre.'
        : 'Aucun ecart detecte.') + '</div>';
      return;
    }
    const nav = el(`<div class="agn-nav">
        <button class="agn-btn" id="agn-prec" style="width:auto">‹ Precedent</button>
        <button class="agn-btn" id="agn-suiv" style="width:auto">Suivant ›</button>
        <span id="agn-compteur">— / ${liste.length}</span>
        <span id="agn-traites" class="agn-traites"></span>
        <button class="agn-lien" id="agn-tout">tout deplier</button></div>`);
    ui.results.appendChild(nav);
    ui.compteur = nav.querySelector('#agn-compteur');
    ui.traites = nav.querySelector('#agn-traites');
    nav.querySelector('#agn-prec').onclick = () => allerA(indexCourant - 1);
    nav.querySelector('#agn-suiv').onclick = () => allerA(indexCourant + 1);
    nav.querySelector('#agn-tout').onclick = () => {
      const grps = [...ui.results.querySelectorAll('.agn-grp')];
      const toutOuvert = grps.every(g => g.classList.contains('agn-ouvert'));
      grps.forEach(g => ouvrirGroupe(g, !toutOuvert));
    };

    // Regroupement par thematique : une famille = une couleur sur la carte,
    // donc la liste et la carte se lisent avec la meme cle. Replie par defaut :
    // sur plusieurs centaines d'ecarts, la liste a plat est illisible.
    const parFamille = new Map();
    liste.slice()
      .sort((a, b) => a.cas.localeCompare(b.cas) || a.libelle.localeCompare(b.libelle))
      .forEach(f => {
        const cle = familleDe(f);
        if (!parFamille.has(cle)) parFamille.set(cle, []);
        parFamille.get(cle).push(f);
      });

    for (const [cle, fam] of Object.entries(FAMILLES)) {
      const membres = parFamille.get(cle);
      if (!membres || !membres.length) continue;
      const grp = el(`<div class="agn-grp" data-fam="${cle}">
          <div class="agn-grp-t">
            <span class="agn-chev">▸</span>
            <span class="agn-pastille" style="background:${options.couleurs[cle] || fam.defaut}"></span>
            <b>${esc(fam.libelle)}</b>
            ${_ft() && _fv() && membres.some(planDeCorrection)
              ? '<button class="agn-fix-grp" title="Appliquer toutes les corrections automatisables de ce groupe">⚡ corriger</button>' : ''}
            <span class="agn-grp-n">${membres.length}</span>
          </div>
          <div class="agn-grp-c" style="display:none"></div></div>`);
      const corps = grp.querySelector('.agn-grp-c');
      grp.querySelector('.agn-grp-t').onclick = () => ouvrirGroupe(grp, !grp.classList.contains('agn-ouvert'));
      const fixGrp = grp.querySelector('.agn-fix-grp');
      if (fixGrp) fixGrp.onclick = e => {
        e.stopPropagation();
        const aFaire = membres.filter(planDeCorrection);
        const nbSeg = aFaire.reduce((n, x) => n + (x.nb || 1), 0);
        if (!confirm('Appliquer ' + aFaire.length + ' correction(s) sur ' + nbSeg + ' segment(s) ?\n\n' +
          'Rien ne sera enregistre : tu reliras dans WME avant de cliquer sur Enregistrer.')) return;
        corriger(aFaire, aFaire.map(x => corps.querySelector('.agn-item[data-idx="' + findings.indexOf(x) + '"]')));
      };

      membres.forEach(f => {
        const node = el(`
          <div class="agn-item agn-${cle}" data-seg="${f.segId}" data-idx="${findings.indexOf(f)}">
            <div class="agn-h"><span>${esc(f.libelle)}</span>
              ${planDeCorrection(f) && _ft() && f.verrouilles !== f.nb
                ? '<button class="agn-fix-btn" title="Appliquer la correction (sans enregistrer)">⚡</button>' : ''}
              <button class="agn-ok-btn" title="Marquer comme traite">✓</button>
              <span class="agn-cas">${f.cas}</span></div>
            <div class="agn-note">${f.adresse
              ? (f.sousType === 'hn' ? 'Numeros de rue' : 'POI residentiel')
              : (ROADTYPE_LABEL[f.roadType] || f.roadType)} · ${
              f.adresse
                ? (f.sousType === 'hn'
                    ? '<b class="agn-nb">' + f.nb + ' numero' + (f.nb > 1 ? 's' : '') + '</b> · #' + f.segId
                    : 'POI ' + f.segId)
                : f.nb > 1 ? '<b class="agn-nb">' + f.nb + ' segments</b>' : '#' + f.segId}${
              f.verrouilles ? ' · <b class="agn-lock" title="Verrouilles au-dessus de ton niveau : non modifiables">🔒 ' +
                f.verrouilles + '</b>' : ''}${
              f.disperse ? ' · <span class="agn-note" title="Troncons eloignes : la carte se pose sur le plus long">eparpilles</span>' : ''}</div>
            ${f.ecarts.map(e => `<div class="agn-d"><b>${e.champ}</b> : ${esc(e.avant)} → ${esc(e.apres)}</div>`).join('')}
            ${f.doute ? `<div class="agn-warn">⚠ ${esc(f.doute)}</div>` : ''}
            ${f.adresse && f.sousType === 'hn' && !f.rueCible
              ? '<div class="agn-warn">⚠ Nom de rue introuvable ou ambigu sur ce segment : ' +
                'la conversion ne peut pas etre proposee.</div>'
              : ''}
          </div>`);
        node.onclick = () => allerA([...ui.results.querySelectorAll('.agn-item')].indexOf(node));
        node.querySelector('.agn-ok-btn').onclick = e => {
          e.stopPropagation();               // ne pas declencher la navigation
          marquerTraite(f, node);
        };
        const fix = node.querySelector('.agn-fix-btn');
        // La correction d'adresses est asynchrone (elle fait charger les
        // numeros) : on desarme le bouton le temps qu'elle tourne.
        if (fix) fix.onclick = async e => {
          e.stopPropagation();
          fix.disabled = true;
          try { await corriger([f], [node]); } finally { fix.disabled = false; }
        };
        corps.appendChild(node);
      });
      ui.results.appendChild(grp);
    }
  }

  function ouvrirGroupe(grp, ouvrir) {
    grp.classList.toggle('agn-ouvert', ouvrir);
    grp.querySelector('.agn-grp-c').style.display = ouvrir ? '' : 'none';
    grp.querySelector('.agn-chev').textContent = ouvrir ? '▾' : '▸';
  }

  // ---------------------------------------------------------------------------
  // Demarrage
  // ---------------------------------------------------------------------------

  function waitForSdk() {
    if (hote.SDK_INITIALIZED) return hote.SDK_INITIALIZED;
    return new Promise(resolve => {
      const done = () => { clearInterval(timer); resolve(hote.SDK_INITIALIZED); };
      const timer = setInterval(() => { if (hote.SDK_INITIALIZED) done(); }, 300);
      document.addEventListener('wme-initialized', done, { once: true });
      document.addEventListener('wme-ready', done, { once: true });
    });
  }

  async function init() {
    await waitForSdk();
    await hote.SDK_INITIALIZED;
    sdk = hote.getWmeSdk({ scriptId: SCRIPT_ID, scriptName: SCRIPT_NAME });
    // /!\ Ne PAS appeler sdk.Events.waitForWmeReady() : la methode existe mais
    // son appel leve une TypeError et fait echouer tout le demarrage.

    agglos = lire(STORE_AGGLOS, {});
    sansAgglo = lire(STORE_SANS_AGGLO, {});
    buildOverlay();
    installerFab();
    ensureLayers();
    installerInfobulle();

    // Le panneau lateral porte les REGLAGES ; l'overlay porte le travail.
    const { tabLabel, tabPane } = await sdk.Sidebar.registerScriptTab();
    tabLabel.textContent = '🏙️';
    tabLabel.title = SCRIPT_NAME;
    tabLabel.style.fontSize = '15px';
    buildReglages(tabPane);

    await restaurerContours();
    renderContours();
    rafraichirCommunesDeLaVue();
    renderAgglos();
    if (ui.overlay.style.display === 'none') nettoyerCarte();
    // Rien a se mettre sous la dent : on ouvre le volet, c'est par la qu'on
    // commence. Sinon on laisse toute la place au travail.
    if (!communes.length) basculerVolet(true);

    let debounce = null;
    try {
      sdk.Events.on({ eventName: 'wme-map-move-end', eventHandler: () => {
        clearTimeout(debounce); debounce = setTimeout(rafraichirCommunesDeLaVue, 400);
        dessinerPoignees(); } });
    } catch (e) { log('abonnement au deplacement impossible', e); }

    log('v' + VERSION + ' pret — fenetre flottante — ' +
      (communes.length ? communes.length + ' commune(s)' : 'aucun contour'));
  }

  init().catch(e => console.error('[' + SCRIPT_NAME + '] echec du demarrage :', e));
})();
