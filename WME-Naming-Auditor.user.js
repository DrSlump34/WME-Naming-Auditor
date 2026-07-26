// ==UserScript==
// @name         WME Naming Auditor
// @namespace    https://github.com/DrSlump34
// @version      2.18
// @description  FRANCE UNIQUEMENT (pour l'instant) : audit du nommage et de l'adressage des voies selon les règles d'édition françaises (agglomération / hors agglomération, contours communaux INSEE). D'autres pays sont prévus par l'architecture, mais AUCUN n'est encore pris en charge.
// @author       DrSlump34
// @license      MIT
// @homepageURL  https://github.com/DrSlump34/WME-Naming-Auditor
// @supportURL   https://github.com/DrSlump34/WME-Naming-Auditor/issues
// @match        https://www.waze.com/editor*
// @match        https://www.waze.com/*/editor*
// @match        https://beta.waze.com/editor*
// @match        https://beta.waze.com/*/editor*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      geo.api.gouv.fr
// @connect      api.wazefrance.com
// @connect      raw.githubusercontent.com
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

  // ===========================================================================
  // WMEPrefs -- persistance partagee (COPIE CONFORME de la bibliotheque autonome)
  //
  // Copie a l'identique de C:\Users\drslu\Projets\WME-Prefs\WMEPrefs.js.
  // Ne PAS la diverger ici : corriger la lib d'origine, puis recopier. Meme
  // demarche que WCT.
  // ===========================================================================
  var WMEPrefs = (function () {
      'use strict';

      const FORMAT = 'wme-userscript-prefs/1';   // enveloppe des fichiers échangés

      // ── Accès au stockage du gestionnaire, quelle que soit sa génération ─────
      // Tampermonkey expose GM_getValue (synchrone), les autres GM.getValue
      // (promesse). On normalise tout en promesse, et on retombe sur localStorage
      // si aucun n'est accordé — un script sans @grant doit continuer de marcher.
      const _gm = {
          get disponible() {
              return (typeof GM_getValue === 'function' && typeof GM_setValue === 'function')
                  || (typeof GM !== 'undefined' && GM && typeof GM.getValue === 'function');
          },
          async get(cle) {
              if (typeof GM_getValue === 'function') return GM_getValue(cle, undefined);
              if (typeof GM !== 'undefined' && GM?.getValue) return await GM.getValue(cle, undefined);
              return undefined;
          },
          async set(cle, val) {
              if (typeof GM_setValue === 'function') return GM_setValue(cle, val);
              if (typeof GM !== 'undefined' && GM?.setValue) return await GM.setValue(cle, val);
          },
      };

      const _ls = {
          get(cle) { try { return localStorage.getItem(cle) ?? undefined; } catch (e) { return undefined; } },
          set(cle, val) { try { localStorage.setItem(cle, val); return true; } catch (e) { return false; } },
      };

      const _parse = (txt) => {
          if (typeof txt !== 'string' || !txt.trim()) return undefined;
          try { return JSON.parse(txt); } catch (e) { return undefined; }
      };
      const _estObjet = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

      // Fusion en profondeur. L'objet ENTRANT gagne sur les conflits de feuilles,
      // mais ne supprime jamais une clé absente de lui : importer des préréglages
      // partagés ne doit pas effacer les réglages personnels de l'éditeur.
      const _fusion = (base, entrant) => {
          if (!_estObjet(base)) return entrant;
          if (!_estObjet(entrant)) return entrant === undefined ? base : entrant;
          const out = { ...base };
          for (const [k, v] of Object.entries(entrant)) {
              out[k] = (_estObjet(v) && _estObjet(base[k])) ? _fusion(base[k], v) : v;
          }
          return out;
      };

      // Téléchargement par Blob : une data URL casserait sur un « # » ou un « ? »
      // présents dans les données.
      const _telecharger = (contenu, nomFichier) => {
          const url = URL.createObjectURL(new Blob([contenu], { type: 'application/json;charset=utf-8' }));
          const a = document.createElement('a');
          a.style.display = 'none'; a.href = url; a.download = nomFichier;
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 5000);
      };

      // ⚠️ La CSP de WME interdit tout fetch() vers un domaine externe : la
      // requête doit partir du contexte de l'extension, donc GM_xmlhttpRequest,
      // avec le domaine déclaré en @connect par le script hôte.
      const _recupererURL = (url) => new Promise((resolve, reject) => {
          if (typeof GM_xmlhttpRequest !== 'function' && !(typeof GM !== 'undefined' && GM?.xmlHttpRequest))
              return reject(new Error('GM_xmlhttpRequest non accordé : ajoute @grant GM_xmlhttpRequest et @connect <domaine>'));
          const req = (typeof GM_xmlhttpRequest === 'function') ? GM_xmlhttpRequest : GM.xmlHttpRequest;
          req({
              method: 'GET', url, timeout: 20000,
              onload: r => (r.status >= 200 && r.status < 300)
                  ? resolve(r.responseText)
                  : reject(new Error('HTTP ' + r.status)),
              onerror: () => reject(new Error('échec réseau (domaine déclaré en @connect ?)')),
              ontimeout: () => reject(new Error('délai dépassé')),
          });
      });

      class Store {
          constructor(opts) {
              if (!opts || !opts.scriptId) throw new Error('WMEPrefs : scriptId obligatoire');
              this.scriptId = String(opts.scriptId);
              this.scriptName = String(opts.scriptName || opts.scriptId);
              this.schema = Number.isFinite(opts.schema) ? opts.schema : 1;
              this.legacyKey = opts.legacyKey || null;
              this.migrate = typeof opts.migrate === 'function' ? opts.migrate : null;
              this.cle = 'wmeprefs:' + this.scriptId;
              this.dernierBackend = null;
          }

          // Charge les données. Ordre : stockage du gestionnaire, puis miroir
          // localStorage, puis REPRISE de l'ancienne clé du script (migration
          // unique et silencieuse — l'utilisateur ne doit rien perdre en migrant).
          async load() {
              let enveloppe = _parse(await _gm.get(this.cle));
              this.dernierBackend = enveloppe ? 'gm' : null;

              if (!enveloppe) {
                  enveloppe = _parse(_ls.get(this.cle));
                  if (enveloppe) this.dernierBackend = 'localStorage';
              }
              if (!enveloppe && this.legacyKey) {
                  const ancien = _parse(_ls.get(this.legacyKey));
                  if (ancien !== undefined) {
                      const donnees = this._migrer(ancien, 0);
                      await this.save(donnees);      // recopié dans le nouveau socle
                      // ⚠️ APRÈS le save, jamais avant : save() repositionne
                      // dernierBackend, et l'information « on vient de reprendre
                      // l'ancien stockage » serait perdue — or c'est précisément
                      // ce qu'on veut pouvoir dire à l'utilisateur.
                      this.dernierBackend = 'migration';
                      return donnees;
                  }
              }
              if (!enveloppe) { this.dernierBackend = 'vide'; return {}; }

              const brut = _estObjet(enveloppe) && 'payload' in enveloppe ? enveloppe.payload : enveloppe;
              const depuis = _estObjet(enveloppe) ? (enveloppe.schema ?? 0) : 0;
              return this._migrer(brut, depuis);
          }

          _migrer(donnees, depuis) {
              if (!_estObjet(donnees)) return {};
              if (depuis === this.schema || !this.migrate) return donnees;
              try { return this.migrate(donnees, depuis, this.schema) || donnees; }
              catch (e) { console.warn('[WMEPrefs] migration ' + this.scriptId + ' : ' + e.message); return donnees; }
          }

          _enveloppe(donnees) {
              return {
                  format: FORMAT, script: this.scriptId, scriptName: this.scriptName,
                  schema: this.schema, savedAt: new Date().toISOString(), payload: donnees,
              };
          }

          // Écrit dans le stockage du gestionnaire ET dans localStorage.
          // Le miroir est volontaire : il permet de relire les réglages même si
          // l'utilisateur retire les @grant, et sert de repli si GM est absent.
          async save(donnees) {
              const txt = JSON.stringify(this._enveloppe(donnees));
              let ok = false;
              if (_gm.disponible) { try { await _gm.set(this.cle, txt); ok = true; } catch (e) {} }
              const okLs = _ls.set(this.cle, txt);
              this.dernierBackend = ok ? 'gm' : (okLs ? 'localStorage' : 'aucun');
              return ok || okLs;
          }

          // opts.only : n'exporter QUE ces clés de premier niveau.
          // Sert au partage : envoyer ses préréglages à un autre éditeur ne doit pas
          // lui imposer au passage sa langue, son thème et ses préférences d'affichage.
          async exportData(opts = {}) {
              const tout = await this.load();
              if (!Array.isArray(opts.only) || !opts.only.length) return tout;
              const partiel = {};
              for (const k of opts.only) if (k in tout) partiel[k] = tout[k];
              return partiel;
          }

          async exportFile(nomFichier, opts = {}) {
              const donnees = await this.exportData(opts);
              const nom = nomFichier || (this.scriptId + '-prefs-' + new Date().toISOString().slice(0, 10) + '.json');
              _telecharger(JSON.stringify(this._enveloppe(donnees), null, 2), nom);
              return { nom, cles: Object.keys(donnees) };
          }

          // Contrôle strict avant d'écraser quoi que ce soit : un fichier d'un
          // AUTRE script, ou un JSON quelconque, doit être refusé avec une raison
          // lisible plutôt que d'écrire n'importe quoi dans les préférences.
          inspect(texte) {
              const j = _parse(texte);
              if (j === undefined) return { ok: false, raison: 'json-invalide' };
              if (!_estObjet(j)) return { ok: false, raison: 'json-invalide' };
              if (j.format !== FORMAT) return { ok: false, raison: 'format-inconnu', format: j.format ?? null };
              if (!_estObjet(j.payload)) return { ok: false, raison: 'contenu-absent' };
              if (j.script !== this.scriptId) return { ok: false, raison: 'autre-script', script: j.script ?? null };
              return { ok: true, schema: j.schema ?? 0, savedAt: j.savedAt || null, payload: j.payload };
          }

          // mode 'merge' (défaut) : complète l'existant sans rien effacer.
          // mode 'replace' : remplace tout — réservé à une restauration assumée.
          async importFromText(texte, opts = {}) {
              const info = this.inspect(texte);
              if (!info.ok) return { ok: false, raison: info.raison, script: info.script, format: info.format };
              const entrant = this._migrer(info.payload, info.schema);
              const donnees = (opts.mode === 'replace') ? entrant : _fusion(await this.load(), entrant);
              await this.save(donnees);
              return { ok: true, mode: opts.mode === 'replace' ? 'replace' : 'merge', donnees, savedAt: info.savedAt };
          }

          async importFromFile(fichier, opts = {}) {
              const texte = await new Promise((resolve, reject) => {
                  const fr = new FileReader();
                  fr.onload = () => resolve(String(fr.result || ''));
                  fr.onerror = () => reject(new Error('lecture impossible'));
                  fr.readAsText(fichier);
              });
              return this.importFromText(texte, opts);
          }

          async importFromURL(url, opts = {}) {
              return this.importFromText(await _recupererURL(url), opts);
          }

          // De quoi afficher honnêtement à l'utilisateur OÙ vivent ses réglages.
          info() {
              return {
                  scriptId: this.scriptId, schema: this.schema,
                  socle: _gm.disponible ? 'gestionnaire de scripts' : 'localStorage (navigateur)',
                  resistantAuNettoyage: _gm.disponible,
                  dernierAcces: this.dernierBackend,
              };
          }
      }

      return {
          FORMAT,
          create: (opts) => new Store(opts),
          _internes: { _fusion, _parse, _estObjet },   // exposés pour les tests
      };
  })();

  const SCRIPT_ID = 'wme-naming-auditor';
  const SCRIPT_NAME = 'WME Naming Auditor';
  // ⚠️ Ancien identifiant (jusqu'a la v2.01, « WME Agglo Naming ») : sert
  // UNIQUEMENT a reprendre le stockage existant au renommage — voir
  // `chargerPrefs`. Ne rien ecrire dessus, ne l'utiliser pour rien d'autre.
  const ANCIEN_SCRIPT_ID = 'wme-agglo-naming';
  /**
   * ⚠️ Le bandeau affichait une constante ecrite a la main, oubliee au bump :
   * la fenetre annoncait « v1.92 » alors que le fichier etait en 1.93. Un
   * editeur qui remonte un bug donnerait alors un mauvais numero. On lit donc
   * d'abord le `@version` reel (Tampermonkey l'expose dans `GM_info`), et la
   * constante ne sert que de repli — pour le test par injection, ou GM_info
   * n'existe pas.
   */
  const VERSION = (() => {
    try { if (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) return GM_info.script.version; }
    catch (e) { /* pas de Tampermonkey : on prend le repli */ }
    return '2.18';
  })();
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
  const LAYER_PANNEAUX = SCRIPT_ID + '-panneaux';   // points : EB10 / EB20 releves

  // Familles de problemes : chacune a sa couleur de surlignage, reglable.
  // Palette choisie pour NE PAS se confondre avec le rendu de WME : le reseau
  // routier y est massivement orange-jaune (#ee9900 releve en zone rurale),
  // les alertes rouges (#e53935), les rues blanches ou grises. On s'en tient
  // donc aux magentas, violets, cyans et turquoises — rares sur la carte — et
  // le trait est large et transparent pour se lire comme un halo DERRIERE le
  // segment plutot que comme un trait concurrent. Tout reste reglable.
  const FAMILLES = {
    agglo: { libelle: 'En agglomération (C / R)', defaut: '#00b0ff' },
    hors: { libelle: 'Hors agglomération (H)', defaut: '#d500f9' },
    eb10: { libelle: 'À couper — entrée agglo', defaut: '#ff1744' },
    lim: { libelle: 'À couper — limite communale', defaut: '#1de9b6' },
    cartouche: { libelle: 'Cartouche seul (nommage bon)', defaut: '#7c4dff' },
    forme: { libelle: 'Rédaction du nom seule', defaut: '#76ff03' },
    special: { libelle: 'Bretelle / voie ferrée / rocade', defaut: '#ff4081' },
    giratoire: { libelle: 'Giratoires', defaut: '#00e676' },
    // ⚠️ Les deux ecarts d'adressage sont de nature OPPOSEE et ne se lisent pas
    // pareil : le numero hors agglo est un defaut a corriger, le RPP en agglo
    // est une question à trancher (l'entree peut donner sur une autre voie).
    // Ils partageaient couleur ET forme : indistinguables sur la carte alors
    // qu'ils s'y cotoient. Le numero reste un DISQUE cyan, le RPP devient un
    // ANNEAU orchidee — la teinte oppose les deux, la forme les separe meme
    // pour un daltonien.
    adresse: { libelle: 'Numéro de rue hors agglomération', defaut: '#00e5ff' },
    rpp: { libelle: 'RPP en agglomération (à trancher)', defaut: '#e040fb' },
    // Les VRAIS POI (v2.15) : famille a part, pour ne pas les confondre avec les
    // RPP sur la carte — ce sont deux sujets differents.
    poiAdresse: { libelle: 'POI : adresse en écart', defaut: '#ffab00' },
    // Les panneaux ne sont pas des ecarts : ils ne passent pas par `familleDe`,
    // mais leurs deux couleurs se reglent au meme endroit que les autres.
    panneauNeutre: { libelle: 'Panneau relevé (rien à confronter)', defaut: '#546e7a' },
    panneauOk: { libelle: 'Panneau dans un polygone', defaut: '#00e676' },
    panneauHors: { libelle: 'Panneau HORS polygone', defaut: '#ff1744' }
  };
  const familleDe = f => f.poi ? 'poiAdresse'
    : f.adresse ? (f.sousType === 'poi' ? 'rpp' : 'adresse')
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

  /**
   * ⚠️⚠️ NOM COMPOSITE « numero - nom de la route » : c'est INTERDIT.
   *
   * Ancienne regle FR, abandonnee (signalee par l'auteur le 26/07 : « c'est une
   * vieille regle, c'est interdit »). Le numero et le nom de voie ne se
   * concatenent pas dans un seul libelle : le numero va au nom principal hors
   * agglomeration, ou en alternatif en agglomeration, et le nom de rue vit dans
   * son propre champ.
   *
   * ⚡ RELEVE SUR LE TERRAIN (segments 63412653 / 365882089 / 365882086, N580 a
   * Saint-Laurent-des-Arbres) : le principal porte « N580 », et les alternatifs
   * portent A LA FOIS « N580 - Route d'Avignon » (l'ancien format) ET « Route
   * d'Avignon » (le bon). Le composite est donc un RESIDU en doublon.
   *
   * On accepte les trois tirets (`-`, `–`, `—`) et un espacement libre autour :
   * la saisie reelle est irreguliere.
   */
  const RE_NOM_COMPOSITE =
    /^((?:A|N|D|M|E|T|CR|CV|CC|VC|RC|C)\s?\d+[a-zA-Z0-9]*)\s*[-–—]\s*(\S.*)$/;

  /**
   * POI (les VRAIS, pas les RPP) que l'audit d'adresse doit LAISSER TRANQUILLES.
   *
   * ⚠️ Demande de l'auteur (26/07) : « sortir de l'analyse les POI de type
   * Riviere, Fleuve, Mer, Lac, Etang, Ile, Foret, Plantation, en particulier
   * s'ils n'ont pas de nom ». Ces objets decrivent un element du paysage : ils
   * n'ont pas d'adresse postale, et leur en reclamer une n'aurait aucun sens.
   *
   * ⚡ Les cles ne sont PAS inventees : relevees dans les traductions de WME
   * (`I18n.translations[locale].venues.categories`, 134 categories) le 26/07.
   * Correspondance avec ce que l'auteur a nomme :
   *   RIVER_STREAM   « Riviere, fleuve »        SEA_LAKE_POOL « Mer, lac, etang »
   *   ISLAND         « Ile »                    FOREST_GROVE  « Foret, plantation »
   * On y ajoute les voisins de meme nature : CANAL, SWAMP_MARSH « Marais,
   * marecage », POOL « Bassin, mare », NATURAL_FEATURES « Sites naturels »,
   * BEACH « Plage ».
   * ⚠️ NE PAS y mettre : FARM (« Ferme »), SEAPORT_MARINA_HARBOR (« Port,
   * marina »), SWIMMING_POOL (« Piscine »), CARPOOL_SPOT — ce sont des lieux
   * batis ou amenages, qui ont bel et bien une adresse.
   */
  const POI_CATEGORIES_NATURELLES = new Set([
    'RIVER_STREAM', 'SEA_LAKE_POOL', 'ISLAND', 'FOREST_GROVE',
    'CANAL', 'SWAMP_MARSH', 'POOL', 'NATURAL_FEATURES', 'BEACH'
  ]);

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
    15: 'Ferry', 16: 'Escalier', 17: 'Voie privée', 18: 'Voie ferrée', 19: 'Piste',
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
  // Ecarts marques « traite », par commune : { <INSEE>: { <cle d'ecart>: true } }.
  // PERSONNEL (pas partage) : suit l'editeur d'un poste a l'autre, pas les
  // autres. Structure OBJET et non tableau pour que la fusion multi-poste soit
  // une union, jamais un ecrasement.
  let traites = {};
  let communeActive = null;
  let findings = [];
  let lastScan = null;
  let ui = {};
  // seuil : part de longueur (0-1) au-delà de laquelle un segment a cheval est
  // rattache d'office a un cote. Entre (1 - seuil) et seuil = zone grise.
  let options = {
    sansAdresse: false, altEnTrop: false, seuil: 0.8,
    zoomClic: true, zoomNiveau: 17, surligner: true,
    // Tableau et carte se choisissent SEPAREMENT, pour les segments comme pour
    // les adresses (demande de l'auteur, 23/07). Jusqu'ici la carte ne peignait
    // que l'onglet actif : ouvrir « Segments » effacait les adresses de la
    // carte, alors qu'on veut souvent garder les deux sous les yeux.
    vue: { segTable: true, segCarte: true, adrTable: true, adrCarte: true, panCarte: true,
           // Les VRAIS POI (v2.15) : leur propre onglet et leur propre calque.
           poiTable: true, poiCarte: true },
    // Charger tout seul les contours du departement survole. Coche par defaut :
    // c'est une corvee sans valeur ajoutee, et elle se refait a chaque fois.
    autoDep: true,
    controles: {},          // rempli d'apres le referentiel au demarrage
    couleurs: Object.fromEntries(Object.entries(FAMILLES).map(([k, v]) => [k, v.defaut])),
    // Panneau lateral (v2.03) : neuf sections empilees d'affilee etaient
    // illisibles (« c'est fouillis », auteur 26/07). Trois onglets, et chaque
    // section se replie. On retient l'onglet ouvert ET les replis : un reglage
    // qu'on referme est un reglage qu'on ne veut plus voir, pas seulement
    // aujourd'hui.
    panneau: { onglet: 'analyse', replis: {} }
  };

  // ===========================================================================
  // PROGRESSION — toute attente se voit, et s'interrompt
  //
  // Regle posee par l'auteur (22/07) : des que l'editeur est susceptible
  // d'attendre, il doit voir une barre. Une seule mecanique sert partout —
  // analyse, import de contours, lecture de fichier, series de corrections —
  // et la barre s'affiche AU PLUS PRES du bouton clique.
  //
  // ⚠️⚠️ Une barre ne suffit pas : la boucle d'analyse est SYNCHRONE (~25 s sur
  // 1607 segments). Tant qu'elle tourne, le navigateur ne repeint pas — la
  // barre resterait figee a 0 % puis sauterait a 100 %. Il faut donc RENDRE LA
  // MAIN periodiquement (`respirer()`), ce qui donne du meme coup le point
  // d'entree de l'annulation.
  // ===========================================================================

  /** Levee par un point de controle quand l'editeur a clique « Annuler ». */
  class AnnulationDemandee extends Error {
    constructor() { super('interrompu par l\'éditeur'); this.annulation = true; }
  }

  /**
   * Rend la main au navigateur, le temps qu'il repeigne.
   * ⚠️ PAS de `setTimeout` : Chrome le bride a 1 s dans un onglet en
   * arriere-plan (piege deja paye sur le balayage) — une boucle qui respire
   * toutes les 120 ms y durerait des minutes.
   * ⚠️ PAS de `requestAnimationFrame` non plus : lui est carrement SUSPENDU en
   * arriere-plan, l'analyse s'arreterait net jusqu'au retour de l'editeur.
   * Un message de `MessageChannel` echappe aux deux.
   */
  function rendreLaMain() {
    return new Promise(resolve => {
      const c = new MessageChannel();
      c.port1.onmessage = () => { c.port1.close(); resolve(); };
      c.port2.postMessage(0);
    });
  }

  /** Barre en cours, pour qu'une fonction profonde puisse afficher sa sous-etape. */
  let progEnCours = null;

  const duree = ms => ms < 1000 ? '< 1 s'
    : ms < 60000 ? Math.round(ms / 1000) + ' s'
    : Math.floor(ms / 60000) + ' min ' + String(Math.round((ms % 60000) / 1000)).padStart(2, '0');

  /**
   * Cree une barre dans `cible` (element ou fonction qui le rend).
   * `opts` : { titre, annulable }. Rend un objet de pilotage :
   *   etape(libelle, total) — total absent/0 ⇒ barre indeterminee (attente reseau)
   *   avance(n) / fixer(n) / total(n) / sous(texte)
   *   await respirer()      — point de controle : repeint, et leve si annule
   *   surAnnulation(fn)     — ce qu'il faut couper (requete en vol)
   *   fin(html)             — retire la barre, en laissant un message eventuel
   */
  function progression(cible, opts) {
    const o = opts || {};
    const zone = () => (typeof cible === 'function' ? cible() : cible);
    const t0 = Date.now();
    const etat = { libelle: o.titre || 'Travail en cours…', sous: '', info: '', n: 0, total: 0 };
    const abandons = [];
    let annulee = false, racine = null, dernierRendu = 0, dernierSouffle = Date.now(), timer = null;

    function construire() {
      const c = zone();
      if (!c) return null;
      if (!racine || racine.parentNode !== c) {
        c.innerHTML = '';
        racine = el(`<div class="agn-prog">
            <div class="agn-prog-t"><span class="agn-prog-lib"></span><span class="agn-prog-pct"></span></div>
            <div class="agn-prog-bar"><i></i></div>
            <div class="agn-prog-b"><span class="agn-prog-d"></span>
              <button class="agn-prog-x" style="display:none">Annuler</button></div>
            <div class="agn-prog-info"></div>
            <div class="agn-prog-note"></div>
          </div>`);
        c.appendChild(racine);
        if (o.annulable) {
          const x = racine.querySelector('.agn-prog-x');
          x.style.display = '';
          x.onclick = () => api.annuler();
        }
      }
      return racine;
    }

    function rendre(force) {
      const t = Date.now();
      if (!force && t - dernierRendu < 100) return;   // 10 rafraichissements/s suffisent
      dernierRendu = t;
      const r = construire();
      if (!r) return;
      const indet = !etat.total;
      const pct = indet ? 0 : Math.min(100, Math.round(etat.n / etat.total * 100));
      r.querySelector('.agn-prog-lib').textContent = etat.libelle + (etat.sous ? ' — ' + etat.sous : '');
      r.querySelector('.agn-prog-pct').textContent = indet ? '' : pct + ' %';
      const bar = r.querySelector('.agn-prog-bar');
      bar.classList.toggle('agn-indet', indet);
      bar.firstElementChild.style.width = indet ? '' : pct + '%';
      // Estimation du reste : seulement une fois le regime etabli, sinon elle
      // danse dans tous les sens et ne vaut rien.
      const ecoule = t - t0;
      let reste = '';
      if (!indet && etat.n > 0 && ecoule > 2000 && pct >= 5 && pct < 100) {
        reste = ' · reste ~' + duree(ecoule / etat.n * (etat.total - etat.n));
      }
      r.querySelector('.agn-prog-d').textContent =
        (indet ? '' : etat.n + ' / ' + etat.total + ' · ') + duree(ecoule) + reste;
      // ⚠️ Ce qui explique l'attente va SOUS la barre, pas dans le libelle : la
      // ligne de titre est etroite (fenetre de 400 px) et tronquait le nom de
      // la commune (vu en live sur « Balayage de Saint-Laurent-des-Arbres — la
      // carte se deplace, ... »).
      r.querySelector('.agn-prog-info').textContent = etat.info;
      // Onglet en arriere-plan : Chrome ralentit tout. Le dire, plutot que de
      // laisser croire a un plantage.
      r.querySelector('.agn-prog-note').textContent = document.hidden
        ? 'Onglet en arrière-plan : le navigateur ralentit le travail. Reviens sur cet onglet.' : '';
    }

    const api = {
      etape(libelle, total) {
        etat.libelle = libelle; etat.sous = ''; etat.info = ''; etat.n = 0; etat.total = total || 0;
        rendre(true); return api;
      },
      sous(texte) { etat.sous = texte || ''; rendre(); return api; },
      info(texte) { etat.info = texte || ''; rendre(); return api; },
      avance(k) { etat.n += (k == null ? 1 : k); rendre(); return api; },
      fixer(n) { etat.n = n; rendre(); return api; },
      total(n) { etat.total = n || 0; rendre(); return api; },
      get annulee() { return annulee; },
      verifier() { if (annulee) throw new AnnulationDemandee(); },
      /** Point de controle : repeint si on tient la main depuis trop longtemps,
       *  et interrompt si l'editeur a clique Annuler. */
      async respirer(forcer) {
        if (annulee) throw new AnnulationDemandee();
        const t = Date.now();
        if (!forcer && t - dernierSouffle < 120) return;
        dernierSouffle = t;
        rendre(true);
        await rendreLaMain();
        if (annulee) throw new AnnulationDemandee();
      },
      annuler() {
        if (annulee) return;
        annulee = true;
        // L'arret n'est pas instantane (mesure : ~2 s, le temps d'atteindre le
        // point de controle et de mettre en forme le partiel). On le DIT, et on
        // ferme le bouton : sans ca l'editeur reclique en croyant l'avoir rate.
        etat.sous = 'interruption en cours…';
        rendre(true);
        if (racine) {
          const x = racine.querySelector('.agn-prog-x');
          if (x) { x.disabled = true; x.textContent = 'Interruption…'; }
        }
        abandons.forEach(f => { try { f(); } catch (e) { /* */ } });
      },
      surAnnulation(f) {
        abandons.push(f);
        if (annulee) { try { f(); } catch (e) { /* */ } }
      },
      fin(html) {
        clearInterval(timer);
        if (progEnCours === api) progEnCours = null;
        const c = zone();
        if (c) c.innerHTML = html || '';
        racine = null;
      },
      get ecoule() { return Date.now() - t0; }
    };

    // Chrono vivant meme quand rien n'avance (attente reseau, barre indeterminee).
    timer = setInterval(() => rendre(true), 500);
    progEnCours = api;
    rendre(true);
    return api;
  }

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
  // ---------------------------------------------------------------------------
  // Persistance en ligne (WMEPrefs) + repli local
  //
  // « En ligne » = le stockage du GESTIONNAIRE DE SCRIPTS (GM_setValue), qui
  // survit a un « effacer les donnees du site » sur waze.com et entre dans les
  // sauvegardes du gestionnaire (Drive, OneDrive…). Ce n'est PAS un serveur
  // temps reel : la sync multi-poste n'est pas automatique, elle passe par un
  // fichier exporte/importe. WMEPrefs miroir aussi tout dans localStorage, ce
  // qui constitue le REPLI si le gestionnaire est absent ou echoue.
  //
  // Trois choses y vivent : les polygones (`agglos`), les declarations « sans
  // agglo » (`sansAgglo`) et les coches « traite » (`traites`). Les CONTOURS
  // communaux (volumineux, refabricables en un clic) restent hors de la, en
  // IndexedDB. Le PARTAGE communautaire n'emporte que polygones + sans-agglo,
  // jamais les traites (personnels) — voir `exporterPartage`.
  // ---------------------------------------------------------------------------

  const prefs = WMEPrefs.create({ scriptId: SCRIPT_ID, scriptName: SCRIPT_NAME, schema: 1 });
  // ⚠️ Garde-fou : tant que le chargement initial n'a pas eu lieu, `agglos` et
  // consorts sont vides — sauver a ce moment ECRASERAIT les donnees stockees.
  let prefsPret = false;

  const prefsVide = d => !d || (!d.agglos && !d.sansAgglo && !d.traites);

  /**
   * Charge polygones / sans-agglo / traites. Reprise EN CASCADE, pour que
   * personne ne perde rien — ni en passant a WMEPrefs, ni au renommage du
   * script (« WME Agglo Naming » → « WME Naming Auditor », v2.02) :
   *   1. le stockage courant (scriptId actuel) ;
   *   2. sinon le stockage de l'ANCIEN scriptId (WMEPrefs de la v2.00/2.01) ;
   *   3. sinon les toutes premieres cles localStorage brutes.
   * Chaque niveau, une fois repris, est recopie dans le socle courant.
   */
  async function chargerPrefs() {
    let data = {};
    try { data = (await prefs.load()) || {}; }
    catch (e) { log('WMEPrefs load', e); data = {}; }

    // 2. Ancien identifiant : le stockage WMEPrefs d'avant le renommage.
    if (prefsVide(data)) {
      try {
        const ancien = WMEPrefs.create({ scriptId: ANCIEN_SCRIPT_ID, scriptName: SCRIPT_NAME, schema: 1 });
        const d2 = await ancien.load();
        if (!prefsVide(d2)) {
          data = { agglos: d2.agglos || {}, sansAgglo: d2.sansAgglo || {}, traites: d2.traites || {} };
          await prefs.save(data);
          log('prefs : repris depuis l\'ancien identifiant « ' + ANCIEN_SCRIPT_ID + ' »');
        }
      } catch (e) { log('reprise ancien scriptId', e); }
    }

    // 3. Toutes premieres cles localStorage brutes (avant WMEPrefs).
    if (prefsVide(data)) {
      const a = lire(STORE_AGGLOS, null), sa = lire(STORE_SANS_AGGLO, null);
      if (a || sa) {
        data = { agglos: a || {}, sansAgglo: sa || {}, traites: {} };
        try { await prefs.save(data); log('prefs : anciennes clés localStorage reprises'); }
        catch (e) { log('WMEPrefs migration', e); }
      }
    }

    agglos = data.agglos || {};
    sansAgglo = data.sansAgglo || {};
    traites = data.traites || {};
    prefsPret = true;
  }

  /** Ecrit l'etat courant dans le gestionnaire (+ miroir localStorage). Appel
   *  asynchrone volontairement « tire et oublie » : l'UI ne l'attend pas. */
  function sauverPrefs() {
    if (!prefsPret) return;   // avant chargement : ne rien ecraser
    prefs.save({ agglos, sansAgglo, traites }).catch(e => log('WMEPrefs save', e));
  }
  const saveAgglos = () => sauverPrefs();
  const saveSansAgglo = () => sauverPrefs();
  const saveTraites = () => sauverPrefs();

  // ---------------------------------------------------------------------------
  // Partage communautaire — fichier exporte / importe
  //
  // On n'echange QUE les polygones et les declarations « sans agglo » : le
  // travail de zonage a de la valeur pour toute la communaute. Les coches
  // « traite » sont PERSONNELLES et restent en dehors (`only`). A l'import, on
  // ne touche jamais une commune deja tracee localement — on n'ajoute que les
  // manquantes (choix de l'auteur, 25/07) : le partage ENRICHIT, il n'ecrase pas.
  // ---------------------------------------------------------------------------

  const CLES_PARTAGE = ['agglos', 'sansAgglo'];

  async function exporterPartage() {
    return prefs.exportFile('wme-naming-auditor-partage-' +
      new Date().toISOString().slice(0, 10) + '.json', { only: CLES_PARTAGE });
  }

  /**
   * Fusionne un fichier de partage sans jamais ecraser le local. Rend
   * `{ ok, ajoutPoly, ajoutSans }` ou `{ ok:false, raison }` (jamais d'exception,
   * et rien n'est ecrit en cas de rejet — meme discipline que WMEPrefs).
   */
  /** Un code INSEE : 5 caracteres, chiffres, ou 2A/2B pour la Corse. */
  const codeInseeValide = c => typeof c === 'string' && /^(\d{5}|2[AB]\d{3})$/.test(c);

  /**
   * Un polygone d'agglomeration importe est-il exploitable ?
   *
   * ⚠️⚠️ CONTROLE INDISPENSABLE, et pas seulement pour la solidite de l'affichage :
   * un fichier de partage vient d'un TIERS. Un anneau absent fait lever
   * `a.ring.length` en pleine `renderAgglos` (volet casse), et surtout des
   * coordonnees non numeriques produisent un zonage en NaN — donc des ecarts
   * FAUX, donc des corrections a l'envers. C'est exactement le risque contre
   * lequel tout le reste du script se blinde ; l'import ne peut pas etre la
   * seule porte ouverte. Les outils du depot de partage valident deja, mais
   * c'est au CLIENT de se proteger : rien ne garantit d'ou vient le fichier.
   */
  function polygoneImporteValide(a) {
    if (!a || typeof a !== 'object') return false;
    if (!Array.isArray(a.ring) || a.ring.length < 4) return false;   // 3 sommets + fermeture
    for (const p of a.ring) {
      if (!Array.isArray(p) || p.length < 2) return false;
      const lon = p[0], lat = p[1];
      if (typeof lon !== 'number' || typeof lat !== 'number') return false;
      if (!isFinite(lon) || !isFinite(lat)) return false;            // NaN / Infinity
      if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return false;
    }
    // L'anneau doit etre FERME : le zonage suppose une surface, pas une ligne.
    const d = a.ring[0], f = a.ring[a.ring.length - 1];
    return d[0] === f[0] && d[1] === f[1];
  }

  function fusionnerPartage(texte) {
    const info = prefs.inspect(texte);
    if (!info.ok) return info;                 // { ok:false, raison, script?, format? }
    const p = info.payload || {};
    let ajoutPoly = 0, ajoutSans = 0, rejetes = 0;
    for (const [insee, liste] of Object.entries(p.agglos || {})) {
      if (!codeInseeValide(insee) || !Array.isArray(liste) || !liste.length) { rejetes++; continue; }
      // On ne garde que les polygones exploitables, et on n'accepte la commune
      // que s'il en reste au moins un : mieux vaut aucune donnee qu'un zonage
      // partiel, qui ferait passer pour « hors agglo » ce qui est en agglo.
      const propres = liste.filter(polygoneImporteValide);
      if (propres.length !== liste.length) rejetes += liste.length - propres.length;
      if (!propres.length) continue;
      // « n'ajouter que les absentes » : une commune deja tracee est intouchee.
      if (!agglos[insee] || !agglos[insee].length) {
        agglos[insee] = propres.map(a => ({
          // On RECONSTRUIT l'objet : un fichier tiers n'impose pas ses champs.
          label: typeof a.label === 'string' ? a.label.slice(0, 120) : '',
          rattache: !!a.rattache,
          ring: a.ring.map(pt => [pt[0], pt[1]])
        }));
        ajoutPoly++;
      }
    }
    for (const insee of Object.keys(p.sansAgglo || {})) {
      if (!codeInseeValide(insee)) { rejetes++; continue; }
      if (!sansAgglo[insee]) { sansAgglo[insee] = true; ajoutSans++; }
    }
    if (ajoutPoly || ajoutSans) { saveAgglos(); saveSansAgglo(); }
    return { ok: true, ajoutPoly, ajoutSans, rejetes };
  }

  function importerPartageFichier(fichier) {
    return new Promise(resolve => {
      const fr = new FileReader();
      fr.onload = () => resolve(fusionnerPartage(String(fr.result || '')));
      fr.onerror = () => resolve({ ok: false, raison: 'lecture-impossible' });
      fr.readAsText(fichier);
    });
  }

  async function importerPartageURL(url) {
    // ⚠️ On refuse tout ce qui n'est pas du HTTPS : `file://`, `javascript:` ou
    // `data:` n'ont rien a faire ici, et du HTTP simple exposerait le zonage a
    // une alteration en transit. Le controle est ici plutot que dans l'UI : une
    // verification qui vit dans le bouton se contourne en appelant la fonction.
    let u;
    try { u = new URL(String(url || '').trim()); }
    catch (e) { return { ok: false, raison: 'url-invalide' }; }
    if (u.protocol !== 'https:') return { ok: false, raison: 'url-non-https' };
    let texte;
    try { texte = await telecharger(u.href); }
    catch (e) { return { ok: false, raison: 'reseau', message: e.message }; }
    return fusionnerPartage(texte);
  }

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
      // uiV 3 : depuis la v1.87 la hauteur est bornee au pied de page de WME.
      // Une hauteur enregistree avant depassait dessus — on ne la reprend pas.
      vue: vueCourante, uiV: 3
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

  /**
   * Departement d'un code INSEE. ⚠️ Trois cas, pas un : outre-mer sur 3
   * chiffres (97x, 98x), Corse sur 2A/2B, metropole sur 2 chiffres.
   */
  const depDuCode = c => {
    const s = String(c || '');
    return /^9[78]/.test(s) ? s.slice(0, 3) : s.slice(0, 2).toUpperCase();
  };

  /** Les departements presents en base, dans l'ordre. */
  const depsCharges = () => [...new Set(communes.map(c => depDuCode(c.code)))].sort();

  /**
   * ⚠️⚠️ LES CONTOURS SE CUMULENT, ILS NE SE REMPLACENT PLUS (demande de
   * l'auteur, 22/07 : « surtout, de le refaire a chaque fois alors que ca a
   * deja peut-etre ete fait »). Avant, charger l'Aude effacait le Gard — vecu
   * le jour meme. On remplace donc uniquement les departements presents dans
   * le nouveau jeu (rechargement = mise a jour), et on garde les autres.
   */
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
    if (!out.length) throw new Error('aucune commune exploitable (nom introuvable dans les propriétés)');
    const depsNouveaux = new Set(out.map(c => depDuCode(c.code)));
    const gardees = communes.filter(c => !depsNouveaux.has(depDuCode(c.code)));
    communes = gardees.concat(out);
    const deps = depsCharges();
    metaContours = { nom: nomFichier, nb: communes.length, deps,
                     date: new Date().toISOString().slice(0, 10), sansNom };
    return { nb: out.length, total: communes.length, sansNom, deps };
  }

  /** Repart de zero : l'editeur doit pouvoir vider ce qu'il a accumule. */
  async function viderContours() {
    communes = []; metaContours = null; communeActive = null; oublierPanneaux();
    depsTentes.clear();
    try { await idbSet('communes', []); await idbSet('meta', null); }
    catch (e) { log('purge des contours impossible', e); }
    rafraichirCommunesDeLaVue(); renderContours(); renderAgglos();
    redrawCommune(); redrawAgglos();
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
    // Plus de confirmation destructive : depuis la v1.88 un chargement CUMULE
    // (seuls les departements du fichier sont remis a jour), il n'y a donc
    // plus rien a perdre.
    ui.statutContours.innerHTML = '';
    // Un departement pese ~3 Mo : la lecture se voit, et le `JSON.parse` qui
    // suit tient la main une bonne seconde — on affiche l'etape AVANT, en
    // laissant le navigateur repeindre, sinon la barre n'apparaitrait jamais.
    const prog = progression(ui.progContours, { titre: 'Lecture de ' + f.name });
    const r = new FileReader();
    r.onprogress = e => { if (e.lengthComputable) { prog.total(e.total); prog.fixer(e.loaded); } };
    r.onerror = () => prog.fin('<div class="agn-stat agn-alerte">Fichier illisible.</div>');
    r.onload = async () => {
      try {
        prog.etape('Analyse du fichier', 0);
        await prog.respirer(true);
        const fc = JSON.parse(r.result);
        prog.etape('Mise en base des contours', 0);
        await prog.respirer(true);
        const res = chargerFeatureCollection(fc, f.name);
        await idbSet('communes', communes); await idbSet('meta', metaContours);
        prog.fin();
        rafraichirCommunesDeLaVue(); renderContours();
        replierSection('contours', false);     // etape faite : on rend la place
        log(res.nb + ' commune(s) chargée(s)');
      } catch (e) {
        prog.fin();
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

  function telecharger(url, prog) {
    const gm = (typeof GM_xmlhttpRequest !== 'undefined') ? GM_xmlhttpRequest
             : (typeof GM !== 'undefined' && GM.xmlHttpRequest) ? GM.xmlHttpRequest : null;
    if (gm) {
      return new Promise((resolve, reject) => {
        const req = gm({ method: 'GET', url, timeout: 120000,
          onload: r => (r.status >= 200 && r.status < 300)
            ? resolve(r.responseText) : reject(new Error('HTTP ' + r.status)),
          onerror: () => reject(new Error('appel refusé')),
          ontimeout: () => reject(new Error('délai dépassé')) });
        // ⚠️ Sans `abort()`, « Annuler » pendant un departement de 3 Mo
        // attendrait quand meme la fin du telechargement : l'editeur croirait
        // le bouton mort. Le handle de GM_xmlhttpRequest le fournit.
        if (prog && req && typeof req.abort === 'function') {
          prog.surAnnulation(() => {
            try { req.abort(); } catch (e) { /* */ }
            reject(new AnnulationDemandee());
          });
        }
      });
    }
    return fetch(url).then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).catch(e => {
      throw new Error(e.message + ' — appel direct bloqué par WME ; ' +
        'installe le script dans Tampermonkey pour utiliser cette source');
    });
  }

  const SOURCES = {
    fichier: { libelle: 'Fichier GeoJSON local' },
    gouv: {
      libelle: 'API Découpage administratif (geo.api.gouv.fr)',
      // Contours Admin Express (IGN) + Code Officiel Geographique (INSEE).
      url: dep => 'https://geo.api.gouv.fr/departements/' + encodeURIComponent(dep) +
        '/communes?fields=nom,code,contour&format=geojson&geometry=contour',
      aide: 'Numéro de département (01 à 95, 2A, 2B, 971…). ~3 Mo et ~10 s par département.'
    },
    wazefrance: {
      libelle: 'api.wazefrance.com — à ÉCARTER pour les contours',
      // ⚠️ Tranche le 23/07 : son `/updates` nomme ses sources, et le decoupage
      // communal y est le « decoupage administratif issu d'OpenStreetMap »,
      // donc ODbL VIRAL. Admin Express (IGN) est en Licence Ouverte : on garde
      // `gouv`. Seuls les PANNEAUX de cette API sont exploitables (voir plus
      // bas), et pour une tout autre raison : ils viennent de l'Etat.
      indisponible: 'Ses contours de communes sont derives d\'OpenStreetMap (ODbL, ' +
        'licence virale). La source « geo.api.gouv.fr » ci-dessus livre les mêmes ' +
        'communes en Licence Ouverte : c\'est elle qu\'il faut utiliser.'
    }
  };

  // ---------------------------------------------------------------------------
  // PANNEAUX D'ENTREE D'AGGLOMERATION (EB10 / EB20)
  //
  // Idee de l'auteur (23/07), venue de Draw Borders France (Sebiseba) : les
  // panneaux d'entree d'agglo disent OU commence l'agglomeration, ce qu'aucune
  // donnee Waze ne dit. Deux usages : confronter les panneaux au polygone deja
  // trace, et proposer un pre-trace quand il n'y en a pas.
  //
  // ✅ SOURCE : `api.wazefrance.com/rs` republie le jeu data.gouv.fr
  // « signalisation routiere determinant la VMA », produit par le Ministere de
  // l'Interieur (DSR), en **Licence Ouverte 2.0** — permissive comme Admin
  // Express, sans la viralite de l'ODbL. Verifie le 23/07 via `/updates`.
  //
  // ⚠️ QUATRE LIMITES MESUREES EN LIVE le 23/07, toutes structurantes :
  //  1. Couverture : 86 departements / 11 regions. Pas l'Ile-de-France —
  //     Paris rend 0 panneau. Une commune sans panneau n'est donc PAS une
  //     commune sans agglomeration : il faut le dire, pas le deduire.
  //  2. `panneau_value` (le nom porte par le panneau) est presque toujours
  //     `null` (100 % a Gruissan, Saint-Laurent-des-Arbres, Carcassonne).
  //     On ne peut pas en tirer le nom d'une agglomeration.
  //  3. La reponse est PLAFONNEE A 500 items, et les B14 (limitations de
  //     vitesse) saturent le quota bien avant les EB10. D'ou le decoupage
  //     adaptatif ci-dessous : sans lui, on perdrait des panneaux EN SILENCE.
  //  4. EB10 et EB20 sont poses sur le MEME poteau, a ~15 m l'un de l'autre
  //     (les deux faces). Une « porte » d'agglomeration, c'est donc un couple,
  //     et le sens ne se lit pas dans la geometrie.
  // ---------------------------------------------------------------------------

  const URL_PANNEAUX = (lat, lon, zoom) =>
    'https://api.wazefrance.com/rs?lat=' + lat + '&lon=' + lon + '&zoom=' + zoom;

  /**
   * ⚠️ L'emprise d'une requete N'EST PAS DOCUMENTEE : elle a ete MESUREE le
   * 23/07 sur Carcassonne, a quatre zooms, et elle se divise exactement par
   * deux a chaque niveau (les quatre mesures se deduisent l'une de l'autre a
   * 1 % pres, donc ce sont bien les bords reels et pas l'etendue des donnees) :
   *
   *   zoom 13 → demi-emprise 0,1651° lat / 0,2240° lon   (384 items)
   *   zoom 14 → 0,0778 / 0,1107      zoom 15 → 0,0411 / 0,0557
   *   zoom 16 → 0,0208 / 0,0277      zoom 17 → vide, l'API ne sert plus
   *
   * Le rapport lon/lat vaut 1,36 ≈ 1/cos(43°) : c'est un rayon en metres
   * (~18 km au zoom 13). ⚠️ **Ne pas remplacer ces constantes par une formule
   * de tuile** (360/2^z) : ca n'en est pas une, je m'y suis trompe en premier
   * jet. Le zoom 12 est refuse par l'API (HTTP 400).
   */
  const DEMI_LAT_Z13 = 0.1651, DEMI_LON_Z13 = 0.2240;
  const ZOOM_PANNEAUX_DEPART = 13, ZOOM_PANNEAUX_MAX = 16, PLAFOND_API = 500;
  /** Demi-emprise d'une requete, en degres, a ce zoom. */
  const demiEmprise = z => {
    const k = Math.pow(2, ZOOM_PANNEAUX_DEPART - z);
    return { dLat: DEMI_LAT_Z13 * k, dLon: DEMI_LON_Z13 * k };
  };

  /** Clef de dedoublonnage : deux cellules qui se recouvrent rendent le meme
   *  panneau. Le 1e-5 degre (~1 m) evite de fusionner deux panneaux voisins. */
  const clePanneau = p => [p.latitude.toFixed(5), p.longitude.toFixed(5),
                           p.panneau_code, p.panneau_value].join('|');

  /**
   * Recupere tous les panneaux d'agglomeration sur une emprise.
   *
   * ⚠️⚠️ Le plafond de 500 ne se signale pas : l'API rend 500 items et se tait.
   * Une requete pleine est donc SUSPECTE, jamais complete — on la redecoupe en
   * quatre et on recommence, jusqu'au zoom 16. Sans ce garde-fou on croirait
   * avoir tout lu, et un polygone se fabriquerait sur des portes manquantes.
   * A l'inverse, une commune rurale tient en UNE requete : on ne decoupe que
   * lorsque c'est necessaire.
   *
   * Rend `{ panneaux: [...], cellules: n, tronque: bool }` — `tronque` reste
   * vrai si une cellule etait encore pleine au zoom maximal, et ce doute doit
   * remonter jusqu'a l'editeur.
   */
  async function chargerPanneauxAgglo(bbox, prog) {
    const vus = new Map();
    let cellules = 0, tronque = false;
    const aFaire = [];

    // Grille de depart couvrant la bbox. ⚠️ Une seule requete au centre ne
    // suffit pas : une grande commune (Arles fait 75 km) deborde largement
    // l'emprise du zoom 13, et ses bords seraient perdus en silence. On garde
    // 10 % de recouvrement entre cellules — le dedoublonnage absorbe le reste.
    {
      const { dLat, dLon } = demiEmprise(ZOOM_PANNEAUX_DEPART);
      const pasLat = dLat * 1.8, pasLon = dLon * 1.8;
      const nLat = Math.max(1, Math.ceil((bbox[3] - bbox[1]) / pasLat));
      const nLon = Math.max(1, Math.ceil((bbox[2] - bbox[0]) / pasLon));
      for (let i = 0; i < nLat; i++) for (let j = 0; j < nLon; j++) {
        aFaire.push({
          lat: bbox[1] + (i + 0.5) * (bbox[3] - bbox[1]) / nLat,
          lon: bbox[0] + (j + 0.5) * (bbox[2] - bbox[0]) / nLon,
          zoom: ZOOM_PANNEAUX_DEPART
        });
      }
    }

    while (aFaire.length) {
      if (prog) prog.verifier();
      const { lat, lon, zoom } = aFaire.shift();
      cellules++;
      if (prog) prog.info(cellules + ' zone(s) interrogee(s), ' + vus.size + ' panneau(x) d\'agglo');
      let data;
      try { data = JSON.parse(await telecharger(URL_PANNEAUX(lat, lon, zoom), prog)); }
      catch (e) {
        if (e instanceof AnnulationDemandee) throw e;
        throw new Error('api.wazefrance.com : ' + e.message);
      }
      const liste = (data && data.rs) || [];
      // On ne garde QUE les entrees/sorties d'agglo : les B14 (limitations de
      // vitesse) ne nous apprennent rien et font l'essentiel du volume.
      for (const p of liste) {
        if (p.panneau_code !== 'EB10' && p.panneau_code !== 'EB20') continue;
        if (typeof p.latitude !== 'number' || typeof p.longitude !== 'number') continue;
        vus.set(clePanneau(p), p);
      }
      // Cellule pleine = SUSPECTE, jamais complete (voir le bloc d'en-tete).
      if (liste.length < PLAFOND_API) continue;
      if (zoom >= ZOOM_PANNEAUX_MAX) { tronque = true; continue; }
      const { dLat, dLon } = demiEmprise(zoom + 1);
      for (const [dy, dx] of [[-dLat, -dLon], [-dLat, dLon], [dLat, -dLon], [dLat, dLon]]) {
        aFaire.push({ lat: lat + dy / 2, lon: lon + dx / 2, zoom: zoom + 1 });
      }
    }
    return { panneaux: [...vus.values()], cellules, tronque };
  }

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
  async function chargerDepuisGouv(codes, prog) {
    const liste = (Array.isArray(codes) ? codes : [codes]).map(c => String(c).trim().toUpperCase());
    if (!liste.length) throw new Error('aucun département sélectionné');
    const features = [];
    const echecs = [];
    // ~3 Mo et ~10 s par departement : l'attente est reelle, et proportionnelle
    // au nombre de cases cochees.
    if (prog) prog.etape('Téléchargement des contours', liste.length);
    for (let i = 0; i < liste.length; i++) {
      const d = liste[i];
      if (prog) { prog.verifier(); prog.fixer(i).sous('departement ' + d); await prog.respirer(true); }
      try {
        const fc = JSON.parse(await telecharger(SOURCES.gouv.url(d), prog));
        const lot = (fc.features || []).filter(f => f && f.geometry);
        if (!lot.length) throw new Error('aucun contour renvoye');
        features.push(...lot);
      } catch (e) {
        if (e && e.annulation) throw e;
        echecs.push(d + ' (' + e.message + ')');
      }
      if (prog) prog.fixer(i + 1);
    }
    if (!features.length) throw new Error('rien de recupere' + (echecs.length ? ' — ' + echecs[0] : ''));
    if (prog) { prog.etape('Mise en base des contours', 0).sous(features.length + ' communes'); await prog.respirer(true); }
    const nomSource = 'geo.api.gouv.fr — dep. ' + liste.join(', ');
    const res = chargerFeatureCollection({ type: 'FeatureCollection', features }, nomSource);
    await idbSet('communes', communes); await idbSet('meta', metaContours);
    rafraichirCommunesDeLaVue(); renderContours();
    replierSection('contours', false);         // etape faite : on rend la place
    return { nb: res.nb, echecs };
  }

  // ===========================================================================
  // CHARGEMENT AUTOMATIQUE DU DEPARTEMENT VISIBLE
  //
  // Demande de l'auteur (22/07) : « plus avoir a faire cette action de
  // chargement sans valeur ajoutee ». L'editeur survole Gruissan, il doit
  // pouvoir choisir Narbonne ou Fleury dans la liste — sans avoir su qu'il
  // fallait d'abord cocher « 11 Aude » quelque part.
  //
  // ⚠️ On ne DEVINE pas le departement depuis WME : la carte donne des noms de
  // ville, jamais un code INSEE. On le demande a la meme API que les contours
  // (`geo.api.gouv.fr/communes?lat&lon`), qui rend la commune d'un point — une
  // reponse de quelques centaines d'octets, sans rapport avec les 3 Mo d'un
  // departement.
  // ⚠️ On interroge le CENTRE ET LES QUATRE COINS : une vue large chevauche
  // souvent deux departements (a Gruissan, l'Aude et l'Herault).
  // ===========================================================================

  /** Departements deja tentes dans cette session (succes OU echec) : on ne
   *  relance pas indefiniment un telechargement qui ne passe pas. */
  const depsTentes = new Set();
  let autoEnCours = false;

  async function depsDeLaVue() {
    let ext; try { ext = sdk.Map.getMapExtent(); } catch (e) { return []; }
    if (!ext || ext.length !== 4) return [];
    const [x1, y1, x2, y2] = ext;
    const points = [[(x1 + x2) / 2, (y1 + y2) / 2], [x1, y1], [x2, y1], [x1, y2], [x2, y2]];
    const deps = new Set();
    // ⚠️ Un coin EN MER rend une liste vide avec un HTTP 200 — ce n'est pas une
    // panne (verifie : lat 43.10 / lon 3.40 → `[]`). Mais si TOUS les appels
    // echouent, c'est le reseau : il faut le dire, sinon l'editeur voit une
    // liste de communes vide sans savoir pourquoi.
    let echecs = 0, derniere = null;
    for (const [lon, lat] of points) {
      try {
        const t = await telecharger('https://geo.api.gouv.fr/communes?lat=' + lat.toFixed(5) +
          '&lon=' + lon.toFixed(5) + '&fields=code&format=json');
        const j = JSON.parse(t);
        (Array.isArray(j) ? j : []).forEach(c => { if (c && c.code) deps.add(depDuCode(c.code)); });
      } catch (e) { echecs++; derniere = e; }
    }
    if (echecs === points.length && derniere) throw derniere;
    return [...deps];
  }

  /**
   * Regarde ou on est, et charge ce qui manque. Ne fait rien si l'option est
   * decochee, si la fenetre est fermee, ou si un chargement tourne deja.
   */
  async function autoChargerDepartement() {
    if (!options.autoDep || autoEnCours) return;
    if (!ui.overlay || ui.overlay.style.display === 'none') return;
    // ⚠️ GARDE-FOU : si le centre de la vue tombe deja dans une commune en
    // base, il n'y a rien a aller chercher — et AUCUNE requete ne part. Sans
    // ca, cinq appels seraient lances a chaque deplacement de carte, y compris
    // en plein travail dans un departement deja charge.
    try {
      const ext = sdk.Map.getMapExtent();
      if (ext && ext.length === 4 && communeDuPoint((ext[0] + ext[2]) / 2, (ext[1] + ext[3]) / 2)) return;
    } catch (e) { /* pas d'extent : on tente la detection */ }
    autoEnCours = true;
    try {
      const deps = (await depsDeLaVue()).filter(d => d && !depsTentes.has(d));
      const dejaLa = new Set(depsCharges());
      const manquants = deps.filter(d => !dejaLa.has(d));
      manquants.forEach(d => depsTentes.add(d));      // une seule tentative
      if (!manquants.length) return;
      const noms = manquants.map(d => (DEPARTEMENTS.find(x => x.code === d) || {}).nom || d);
      const prog = progression(ui.progContours, { annulable: true,
        titre: 'Contours manquants — ' + noms.join(', ') });
      try {
        const r = await chargerDepuisGouv(manquants, prog);
        prog.fin();
        ui.statutContours.innerHTML = '<div class="agn-stat agn-ok">Contours de ' +
          esc(noms.join(', ')) + ' chargés automatiquement — <b>' + r.nb + '</b> commune(s).</div>';
        renderContours();
      } catch (e) {
        prog.fin();
        // ⚠️ On le DIT : un chargement silencieux qui echoue laisse une liste
        // de communes vide sans que l'editeur comprenne pourquoi.
        ui.statutContours.innerHTML = '<div class="agn-stat agn-alerte">Chargement automatique de ' +
          esc(noms.join(', ')) + ' impossible : ' + esc(e && e.annulation ? 'interrompu' : (e.message || String(e))) +
          '. Tu peux le relancer à la main ci-dessus.</div>';
      }
    } catch (e) {
      // Le reseau ne repond pas du tout. On ne le repete pas a chaque
      // deplacement de carte — une fois suffit a comprendre.
      log('detection du département impossible', e);
      if (!ui.autoDepPrevenu) {
        ui.autoDepPrevenu = true;
        ui.statutContours.innerHTML = '<div class="agn-stat agn-alerte">' +
          '<b>Chargement automatique indisponible.</b> ' + esc(e.message || String(e)) +
          '<br>Charge les contours à la main (sélecteur de départements ci-dessus), ' +
          'ou decoche l\'option dans les réglages.</div>';
      }
    } finally { autoEnCours = false; }
  }

  function communesDeLaVue() {
    if (!communes.length) return [];
    let ext; try { ext = sdk.Map.getMapExtent(); } catch (e) { return []; }
    if (!ext || ext.length !== 4) return [];
    return communes.filter(c => bboxIntersecte(c.bbox, ext)).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  }

  /** Contours plies, sauf s'il n'y a aucune commune a proposer dans la vue. */
  function replierContoursSelonListe() {
    const muette = !communes.length ||
      !ui.selCommune || ui.selCommune.options.length <= 1;
    replierSection('contours', muette);
  }

  /**
   * Combien de communes « a portee » on remonte en tete de liste. Au-dela, le
   * groupe cesse d'etre un raccourci et redevient une liste a lire.
   */
  const COMMUNES_EN_TETE = 5;

  /**
   * Communes les plus PERTINENTES pour l'endroit regarde.
   *
   * ⚠️ Diagnostic du 23/07 (« il ne trouve pas la commune ») : ce n'etait pas un
   * bug de detection mais une liste alphabetique — au zoom 12, Nimes arrivait
   * 56e sur 84. On remonte donc en tete celle qui est SOUS LE CENTRE de la vue,
   * puis les plus proches, sans casser l'ordre alphabetique du reste : on
   * cherche parfois un nom, et on veut alors pouvoir le lire.
   */
  function communesEnTete(liste) {
    if (liste.length < 4) return [];
    let ctr; try { ctr = sdk.Map.getMapCenter(); } catch (e) { return []; }
    if (!ctr || ctr.lon == null || ctr.lat == null) return [];
    const sousLeCentre = communeDuPoint(ctr.lon, ctr.lat);
    // Distance au centre de la BBOX : approximation suffisante pour ordonner,
    // et infiniment moins couteuse qu'un point-dans-polygone par commune.
    const dist = c => {
      const dx = ((c.bbox[0] + c.bbox[2]) / 2 - ctr.lon) * Math.cos(ctr.lat * Math.PI / 180);
      const dy = (c.bbox[1] + c.bbox[3]) / 2 - ctr.lat;
      return Math.sqrt(dx * dx + dy * dy);
    };
    const tri = liste.slice().sort((a, b) => dist(a) - dist(b));
    // Celle qui contient reellement le centre passe devant tout le monde : son
    // bbox peut etre excentre (commune allongee), la distance seule la raterait.
    if (sousLeCentre) {
      const i = tri.findIndex(c => c.code === sousLeCentre.code);
      if (i > 0) tri.unshift(tri.splice(i, 1)[0]);
    }
    return tri.slice(0, Math.min(COMMUNES_EN_TETE, liste.length - 1));
  }

  function rafraichirCommunesDeLaVue() {
    if (!ui.selCommune) return;
    const liste = communesDeLaVue();
    const avant = communeActive ? communeActive.code : '';
    // Le filtre ne touche PAS la commune en cours : on ne perd pas son travail
    // parce qu'on a tape trois lettres dans un champ de recherche.
    const f = normSansAccent((ui.filtreCommune && ui.filtreCommune.value || '').trim());
    const garde = c => !f || normSansAccent(c.nom).includes(f) || c.code.startsWith(f);
    const vus = liste.filter(garde);
    const tete = communesEnTete(vus);
    const codesTete = new Set(tete.map(c => c.code));
    const opt = c => `<option value="${esc(c.code)}">${esc(c.nom)}</option>`;
    // ⚠️ Sans groupe de tete, PAS d'optgroup : un `label` vide n'est pas neutre,
    // il ajoute une ligne fantome et indente toutes les options pour rien.
    const groupe = (libelle, arr) => !arr.length ? ''
      : libelle ? `<optgroup label="${esc(libelle)}">${arr.map(opt).join('')}</optgroup>`
                : arr.map(opt).join('');
    const reste = vus.filter(c => !codesTete.has(c.code));
    ui.selCommune.innerHTML = '<option value="">— choisir une commune —</option>' +
      groupe('📍 Sous les yeux', tete) +
      groupe(tete.length ? 'Toutes les communes de la vue' : '', reste);
    if (avant && vus.some(c => c.code === avant)) ui.selCommune.value = avant;
    else if (avant && liste.some(c => c.code === avant)) {
      // Filtree hors de la liste mais toujours en cours : on la rajoute a part,
      // sinon le `select` afficherait une commune differente de celle qu'on
      // analyse — le pire des deux mondes.
      ui.selCommune.insertAdjacentHTML('beforeend',
        `<optgroup label="Commune en cours">${opt(communeActive)}</optgroup>`);
      ui.selCommune.value = avant;
    }
    else if (communeActive) { communeActive = null; oublierPanneaux(); redrawCommune(); }
    ui.nbCommunes.textContent = !communes.length ? ''
      : (f ? vus.length + ' sur ' + liste.length + ' commune(s) dans la vue'
           : liste.length + ' commune(s) dans la vue sur ' + communes.length);
    replierContoursSelonListe();
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
          // ⚠️ `contour` distinct de `couleur` : c'est ce qui permet le HALO
          // BLANC. Sans lui, l'anneau orchidee du RPP se noyait dans le fond
          // satellite (remarque de l'auteur, 23/07). Meme recette que les
          // panneaux, seuls points bien lisibles jusque-la.
          contour: ctx => (ctx.feature.properties || {}).contour ||
                           (ctx.feature.properties || {}).couleur || '#00e5ff',
          rayon: ctx => (ctx.feature.properties || {}).rayon || 7,
          // Le style est UNIQUE pour tout le calque : chaque point porte ses
          // propres remplissage/trait. Disque plein = numero de rue ; anneau
          // creux cercle de blanc = RPP (voir `redrawEcarts`).
          remplissage: ctx => {
            const r = (ctx.feature.properties || {}).remplissage;
            return (r === undefined) ? 0.55 : r;
          },
          trait: ctx => (ctx.feature.properties || {}).trait || 2,
          etiquette: ctx => (ctx.feature.properties || {}).label || ''
        },
        styleRules: [{ style: Object.assign({
          pointRadius: '${rayon}', fillColor: '${couleur}', fillOpacity: '${remplissage}',
          strokeColor: '${contour}', strokeWidth: '${trait}', strokeOpacity: 0.95,
          label: '${etiquette}', fontColor: '#004d5a', fontSize: '11px', fontWeight: 'bold',
          labelOutlineColor: '#fff', labelOutlineWidth: 3, labelYOffset: 14 }, INERTE) }]
      });
      // Panneaux EB10 / EB20. Ils ne sont pas des ecarts mais une DONNEE DE
      // TERRAIN : calque a part, carre (aucune autre de nos features n'en a),
      // pour qu'on ne les confonde jamais avec un report a traiter.
      sdk.Map.addLayer({
        layerName: LAYER_PANNEAUX,
        styleContext: {
          couleur: ctx => (ctx.feature.properties || {}).couleur || '#ff1744',
          rayon: ctx => (ctx.feature.properties || {}).rayon || 6,
          etiquette: ctx => (ctx.feature.properties || {}).label || ''
        },
        styleRules: [{ style: Object.assign({
          graphicName: 'square', pointRadius: '${rayon}',
          fillColor: '${couleur}', fillOpacity: 0.85,
          strokeColor: '#ffffff', strokeWidth: 2, strokeOpacity: 0.9,
          label: '${etiquette}', fontColor: '#b71c1c', fontSize: '10px', fontWeight: 'bold',
          labelOutlineColor: '#fff', labelOutlineWidth: 3, labelYOffset: -13 }, INERTE) }]
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
    // ⚠️ L'infobulle ne parle que de ce qui est PEINT : sans ce filtre elle
    // decrirait un ecart d'une famille que l'editeur a retiree de la carte,
    // sur un point invisible.
    for (const f of findingsCarte()) {
      if (f.traite || !f.geom) continue;
      const d = distAuReport(p, f);
      if (d < dMin) { dMin = d; meilleur = f; }
    }
    return meilleur;
  }

  /**
   * WME affiche ses erreurs d'enregistrement dans une popover ancree en haut a
   * DROITE (`.save-popover-container`), pile ou se pose notre fenetre : elle la
   * masque, et un refus serveur (ex. adresse residuelle cote Waze) devient
   * alors incomprehensible — l'editeur voit « rien ne s'enregistre » sans le
   * message. Verifie en live le 21/07 sur le « 721 Chemin de la Begude ».
   *
   * Plutot que de bouger notre fenetre (l'editeur a choisi sa position), on
   * RECOPIE le message de WME dans un bandeau bien visible EN TETE de notre
   * fenetre — la ou son regard est deja. Le bandeau vit tant que l'erreur est
   * affichee cote WME, et disparait avec elle.
   */
  let derniereErreurSave = '';
  function surveillerErreursEnregistrement() {
    const relever = () => {
      const pop = document.querySelector('.save-popover-container');
      const txt = pop ? (pop.textContent || '').replace(/\s+/g, ' ').trim() : '';
      const erreur = txt && /erreur|invalide|impossible|error|invalid/i.test(txt);
      if (erreur) {
        const propre = txt.replace(/\s*Fermer\s*$/i, '').trim();
        if (propre !== derniereErreurSave) { derniereErreurSave = propre; afficherBandeauErreur(propre); }
      } else if (derniereErreurSave) {
        derniereErreurSave = ''; cacherBandeauErreur();
      }
    };
    try {
      new MutationObserver(relever).observe(document.body,
        { childList: true, subtree: true, characterData: true });
    } catch (e) { log('surveillance des erreurs d\'enregistrement impossible', e); }
  }

  function afficherBandeauErreur(texte) {
    if (!ui.corps) return;
    let b = document.querySelector('#agn-err-save');
    if (!b) {
      b = el('<div id="agn-err-save"></div>');
      ui.corps.insertBefore(b, ui.corps.firstChild);
    }
    b.innerHTML = '<b>⛔ WME a refusé l\'enregistrement</b><div class="agn-err-msg">' +
      esc(texte) + '</div><span class="agn-err-note">Message repris de WME (sa propre alerte est ' +
      'cachee derrière cette fenêtre). Il disparaitra quand l\'alerte de WME se fermera.</span>';
    // Si la fenetre est repliee ou fermee, on la rouvre : sinon le bandeau
    // resterait invisible et on n'aurait rien gagne.
    if (ui.overlay) {
      if (ui.overlay.style.display === 'none') ouvrirOverlay();
      if (ui.overlay.classList.contains('agn-replie')) {
        const red = ui.overlay.querySelector('#agn-reduire'); if (red) red.click();
      }
    }
    b.scrollIntoView({ block: 'nearest' });
  }
  function cacherBandeauErreur() {
    const b = document.querySelector('#agn-err-save');
    if (b) b.remove();
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
      (f.nb > 1 ? `<div class="agn-b-l"><b>${f.nb} segments</b> dans la même situation</div>` : '') +
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

  /** Identifiant stable d'un report d'adressage : le numero, ou le POI. */
  const cleAdresse = f => f.hnId || f.venueId || f.segId;

  /** Repeint les ecarts, en mettant en avant celui qui est courant. Les ecarts
   *  de nommage sont des lignes, ceux d'adressage des points : deux calques. */
  function redrawEcarts(idActif) {
    ensureLayers();
    [LAYER_ECARTS, LAYER_ADRESSES].forEach(n => {
      try { sdk.Map.removeAllFeaturesFromLayer({ layerName: n }); } catch (e) { /* */ }
    });
    if (!options.surligner || !findings.length) return;
    // ⚠️ La carte ne suit PLUS l'onglet actif (v1.93) : elle obeit a ses deux
    // cases propres. Ouvrir « Segments » n'efface plus les adresses — on peut
    // lister les numeros tout en gardant les segments surlignes sous les yeux.
    const vivants = findingsCarte().filter(f => f.geom && !f.traite);  // un ecart traite ne se surligne plus
    // ⚠️ `idActif` est l'INDEX du report (c'est ce que passe `allerA`), pas un
    // identifiant de segment : le comparer a `f.segId` ne matchait jamais, donc
    // l'element courant n'etait jamais mis en avant. Meme faute que l'ancienne
    // infobulle. On resout l'objet une fois, et on compare par reference.
    const actif = (typeof idActif === 'number' && idActif >= 0) ? findings[idActif] : null;
    try {
      const lignes = vivants.filter(f => !f.adresse).map(f => ({
        id: 'ec-' + f.segId, type: 'Feature', geometry: f.geom,
        properties: {
          couleur: options.couleurs[familleDe(f)] || '#888888',
          epaisseur: f === actif ? 22 : 14
        }
      }));
      if (lignes.length) sdk.Map.addFeaturesToLayer({ layerName: LAYER_ECARTS, features: lignes });
    } catch (e) { log('surlignage impossible', e); }
    try {
      // ⚠️ Cle = hnId (ou l'id du POI) : plusieurs numeros partagent un meme
      // segId, un id de feature base sur le segment les ferait se recouvrir.
      const points = [];
      vivants.filter(f => f.adresse).forEach(f => {
        const cle = cleAdresse(f), estActif = f === actif;
        if (f.sousType === 'poi') {
          // RPP = ANNEAU orchidee CERCLE DE BLANC. Deux cercles concentriques :
          // un anneau blanc epais DESSOUS (le halo qui le detache du satellite),
          // l'anneau orchidee DESSUS. C'est le seul moyen d'avoir a la fois un
          // creux (distinct du disque plein du numero) et un contour blanc.
          const r = estActif ? 13 : 10;
          points.push({ id: 'ad-halo-' + cle, type: 'Feature', geometry: f.geom,
            properties: { couleur: '#ffffff', contour: '#ffffff', rayon: r,
                          remplissage: 0, trait: estActif ? 8 : 6, label: '' } });
          points.push({ id: 'ad-' + cle, type: 'Feature', geometry: f.geom,
            properties: { couleur: options.couleurs.rpp || '#e040fb',
                          contour: options.couleurs.rpp || '#e040fb', rayon: r,
                          remplissage: 0.18, trait: estActif ? 4 : 3, label: '' } });
        } else {
          // Numero de rue = disque plein cyan, avec le numero ecrit dedans.
          points.push({ id: 'ad-' + cle, type: 'Feature', geometry: f.geom,
            properties: { couleur: options.couleurs.adresse || '#00e5ff',
                          contour: options.couleurs.adresse || '#00e5ff',
                          rayon: estActif ? 11 : 7, remplissage: 0.55, trait: 2,
                          label: (f.hns && f.hns.length === 1) ? String(f.hns[0].number) : '' } });
        }
      });
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
  // Panneaux : confrontation aux polygones traces
  //
  // ⚠️ Le panneau est un FAIT DE TERRAIN, le polygone une intention d'editeur.
  // Quand les deux divergent, c'est le polygone qu'on suspecte — mais on ne le
  // corrige jamais tout seul : la donnee data.gouv « peut presenter des ecarts
  // avec la signalisation reelle », et un panneau peut avoir ete depose.
  // ---------------------------------------------------------------------------

  let panneaux = [];          // le releve brut de la commune active
  let bilanPanneaux = null;

  /** Distance approximative d'un point a un anneau, en metres. */
  function distanceAuRing(lon, lat, ring) {
    const kLon = 111320 * Math.cos(lat * Math.PI / 180), kLat = 110540;
    const p = [lon * kLon, lat * kLat];
    let best = Infinity;
    for (let i = 1; i < ring.length; i++) {
      const a = [ring[i - 1][0] * kLon, ring[i - 1][1] * kLat];
      const b = [ring[i][0] * kLon, ring[i][1] * kLat];
      best = Math.min(best, distPointSegment(p, a, b));
    }
    return best;
  }

  /**
   * Classe chaque panneau de la commune par rapport aux polygones traces.
   * ⚠️ On ne juge QUE les EB10/EB20 tombant dans le contour INSEE : ceux des
   * communes voisines sont ramenes par l'API (l'emprise deborde largement) et
   * n'ont rien a dire du polygone d'ici.
   */
  function classerPanneaux() {
    if (!communeActive) return null;
    const zones = agglos[communeActive.code] || [];
    const dedans = [], dehors = [];
    for (const p of panneaux) {
      if (!pointInGeom(p.longitude, p.latitude, communeActive.geom)) continue;
      let meilleure = null;
      zones.forEach((z, i) => {
        const d = distanceAuRing(p.longitude, p.latitude, z.ring);
        const inclus = pointInRing(p.longitude, p.latitude, z.ring);
        if (!meilleure || d < meilleure.d) meilleure = { i, d, inclus, label: z.label };
      });
      const fiche = { p, zone: meilleure };
      if (meilleure && meilleure.inclus) dedans.push(fiche); else dehors.push(fiche);
    }
    return { dedans, dehors, zones: zones.length };
  }

  /** Repeint le calque des panneaux d'apres le classement courant. */
  function redrawPanneaux() {
    ensureLayers();
    try { sdk.Map.removeAllFeaturesFromLayer({ layerName: LAYER_PANNEAUX }); } catch (e) { /* */ }
    if (!options.vue.panCarte || !panneaux.length) return;
    const cl = classerPanneaux();
    if (!cl) return;
    const feat = (f, couleur) => ({
      id: 'pn-' + f.p.latitude + '-' + f.p.longitude + '-' + f.p.panneau_code,
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [f.p.longitude, f.p.latitude] },
      properties: {
        couleur, rayon: 6,
        // Le nom porte par le panneau est presque toujours vide : on n'affiche
        // que le code, sinon l'etiquette ment par omission.
        label: f.p.panneau_code + (f.p.panneau_value ? ' ' + f.p.panneau_value : '')
      }
    });
    // ⚠️ Sans polygone trace, il n'y a RIEN a confronter : tout peindre en
    // rouge ferait croire a 15 anomalies alors qu'aucune n'a ete constatee
    // (vu en live sur Narbonne). Dans ce cas les panneaux sont NEUTRES.
    const features = cl.zones
      ? [...cl.dedans.map(f => feat(f, options.couleurs.panneauOk || '#00e676')),
         ...cl.dehors.map(f => feat(f, options.couleurs.panneauHors || '#ff1744'))]
      : [...cl.dedans, ...cl.dehors].map(f => feat(f, options.couleurs.panneauNeutre || '#546e7a'));
    if (features.length) {
      try { sdk.Map.addFeaturesToLayer({ layerName: LAYER_PANNEAUX, features }); }
      catch (e) { log('affichage des panneaux impossible', e); }
    }
  }

  // ---------------------------------------------------------------------------
  // PRE-TRACE d'un polygone a partir des panneaux
  //
  // ⚠️⚠️ CE QUE CE POLYGONE EST, ET CE QU'IL N'EST PAS. Les panneaux ne sont
  // poses que SUR LES ROUTES : ils donnent les « portes » de l'agglomeration,
  // pas son pourtour. Entre deux routes, la ligne est INVENTEE par le calcul.
  // Le trace obtenu est donc un BROUILLON a corriger aux poignees — l'auteur
  // l'a acte le 23/07 (« le polygone sera grossier entre 2 panneaux, c'est a
  // l'utilisateur de tirer les poignees pour le parfaire »). Il ne doit jamais
  // etre presente comme un contour valide, et l'interface le dit a chaque fois.
  // ---------------------------------------------------------------------------

  const R_TERRE = 6378137;
  /** Repere metrique local : les calculs d'enveloppe et de distance n'ont aucun
   *  sens en degres (un degre de longitude vaut 0,73 degre de latitude ici). */
  const versM = (ref) => {
    const kLon = 111320 * Math.cos(ref.lat * Math.PI / 180), kLat = 110540;
    return {
      aller: p => [(p[0] - ref.lon) * kLon, (p[1] - ref.lat) * kLat],
      retour: p => [ref.lon + p[0] / kLon, ref.lat + p[1] / kLat]
    };
  };
  const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

  /** Enveloppe convexe (parcours monotone d'Andrew), points en metres. */
  function hullConvexe(pts) {
    if (pts.length < 3) return pts.slice();
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const croix = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const moitie = liste => {
      const out = [];
      for (const q of liste) {
        while (out.length >= 2 && croix(out[out.length - 2], out[out.length - 1], q) <= 0) out.pop();
        out.push(q);
      }
      out.pop();
      return out;
    };
    return moitie(p).concat(moitie(p.slice().reverse()));
  }

  /**
   * ⚠️⚠️ LE POLYGONE PASSE PAR LES PANNEAUX, ON N'Y TOUCHE PAS.
   *
   * Erreur de conception corrigee en v1.96 sur remarque de l'auteur (« le trace
   * ne s'aligne pas aux panneaux »). La v1.95 ecartait chaque sommet de 150 m
   * vers l'exterieur, au motif que le bati deborde ses entrees. **C'est faux et
   * c'est meme contre-productif** : l'EB10 marque PRECISEMENT ou l'agglomeration
   * commence sur cet axe. Un polygone pose 150 m plus loin fait passer pour
   * « en agglo » des segments que le panneau declare hors agglo — soit
   * exactement le genre d'ecart que ce script est cense trouver.
   *
   * Les sommets restent donc EXACTEMENT sur les portes. Seul le MILIEU de
   * chaque cote est bombe vers l'exterieur : entre deux entrees, l'enveloppe
   * convexe coupe en ligne droite a travers le bati (visible sur Coursan, au
   * sud). Ce bombage-la est assume comme une approximation — il ne deplace
   * aucun point releve, et il se corrige a la poignee.
   */
  function bomberCotes(ring, part, plafond) {
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
    const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const out = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      out.push(a);                                   // le sommet releve, intact
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const dx = mx - cx, dy = my - cy, d = Math.hypot(dx, dy);
      if (!d) continue;
      const pousse = Math.min(plafond, Math.hypot(b[0] - a[0], b[1] - a[1]) * part);
      out.push([mx + dx / d * pousse, my + dy / d * pousse]);
    }
    return out;
  }

  const PORTE_FUSION_M = 60;    // EB10 et EB20 du meme poteau : ~15 m mesures
  const CLUSTER_SEUIL_M = 2000; // au-dela, deux agglomerations distinctes
  // Bombage des cotes seulement (les sommets ne bougent pas) : 15 % de la
  // longueur du cote, jamais plus de 250 m.
  const BOMBAGE_PART = 0.15, BOMBAGE_MAX_M = 250;

  /**
   * Des panneaux bruts aux polygones proposes.
   * 1. les panneaux d'un meme poteau deviennent UNE porte (EB10 + EB20) ;
   * 2. les portes proches se regroupent — une commune a souvent plusieurs
   *    agglomerations (bourg + hameaux), il ne faut surtout pas toutes les
   *    enfermer dans un seul polygone ;
   * 3. chaque groupe donne une enveloppe convexe dilatee.
   */
  function proposerPolygones(fiches) {
    if (!fiches.length) return [];
    const ref = { lon: fiches[0].p.longitude, lat: fiches[0].p.latitude };
    const proj = versM(ref);
    const pts = fiches.map(f => ({ m: proj.aller([f.p.longitude, f.p.latitude]), f }));

    // 1. portes
    const portes = [];
    for (const pt of pts) {
      const prox = portes.find(g => dist2(g.m, pt.m) <= PORTE_FUSION_M ** 2);
      if (prox) { prox.membres.push(pt); }
      else portes.push({ m: pt.m, membres: [pt] });
    }

    // 2. clusters, par liaison simple
    const groupes = [];
    const restant = portes.slice();
    while (restant.length) {
      const g = [restant.shift()];
      let bouge = true;
      while (bouge) {
        bouge = false;
        for (let i = restant.length - 1; i >= 0; i--) {
          if (g.some(x => dist2(x.m, restant[i].m) <= CLUSTER_SEUIL_M ** 2)) {
            g.push(restant.splice(i, 1)[0]); bouge = true;
          }
        }
      }
      groupes.push(g);
    }

    // 3. enveloppes — mais SEULEMENT quand les portes forment une vraie surface
    //
    // ⚠️⚠️ ON NE TRACE PLUS DE CERCLE INVENTE. Le repli en cercle (v1.95-97)
    // produisait des « ronds autour des panneaux » denonces par l'auteur sur
    // Narbonne : ses 15 entrees sont eparpillees sur 14 km (hameaux et
    // quartiers distincts), et chaque groupe de 1 a 3 portes ALIGNEES le long
    // d'une route tombait sur le cercle. Or une poignee de portes alignees ne
    // dit RIEN de l'etendue d'une agglo — juste ou elle commence sur cet axe.
    // Meme faute que la dilatation de v1.95 : deviner une surface la ou on n'a
    // qu'un point ou une ligne, c'est fabriquer de la donnee fausse.
    //
    // Regle : un groupe ne donne un polygone que si son enveloppe convexe est
    // une VRAIE surface (>= 3 portes, aire >= 15 % de sa boite englobante).
    // Les autres groupes sont RENDUS, mais sans `ring` : l'appelant les compte
    // et invite a les tracer a la main, panneaux affiches en repere.
    const props = groupes.map((g, i) => {
      const m = g.map(x => x.m);
      let ring = null;
      if (m.length >= 3) {
        const h = hullConvexe(m);
        if (h.length >= 3) {
          let aire = 0;
          for (let k = 0, n = h.length; k < n; k++) {
            const a = h[k], b = h[(k + 1) % n];
            aire += a[0] * b[1] - b[0] * a[1];
          }
          aire = Math.abs(aire) / 2;
          const lx = Math.max(...h.map(p => p[0])) - Math.min(...h.map(p => p[0]));
          const ly = Math.max(...h.map(p => p[1])) - Math.min(...h.map(p => p[1]));
          if (aire >= 0.15 * Math.max(1, lx * ly)) ring = bomberCotes(h, BOMBAGE_PART, BOMBAGE_MAX_M);
        }
      }
      const info = { idx: i, portes: g.length,
                     panneaux: g.reduce((s, x) => s + x.membres.length, 0) };
      if (!ring) {
        // Groupe non tracable : on garde son centre pour pouvoir cadrer dessus,
        // mais aucun anneau — rien a proposer, rien d'invente.
        const cx = m.reduce((s, p) => s + p[0], 0) / m.length;
        const cy = m.reduce((s, p) => s + p[1], 0) / m.length;
        const c = proj.retour([cx, cy]);
        return Object.assign(info, { ring: null, centre: { lon: c[0], lat: c[1] } });
      }
      const anneau = ring.map(proj.retour);
      anneau.push(anneau[0].slice());       // un anneau se referme
      const centre = anneau.reduce((s, p) => [s[0] + p[0], s[1] + p[1]], [0, 0])
        .map(v => v / anneau.length);
      return Object.assign(info, { ring: anneau, centre: { lon: centre[0], lat: centre[1] } });
    });
    // Les vrais polygones d'abord (le plus de portes en tete), les non-tracables
    // ensuite : l'appelant les distingue par la presence de `ring`.
    return props.sort((a, b) => (!!b.ring - !!a.ring) || (b.portes - a.portes));
  }

  /** Efface le releve courant : appele des que la commune change. */
  function oublierPanneaux() {
    panneaux = []; bilanPanneaux = null;
    if (ui.btnPreTrace) ui.btnPreTrace.disabled = true;
    redrawPanneaux(); renderBilanPanneaux();
  }

  /** Va chercher les panneaux de la commune active, puis les confronte. */
  async function releverPanneaux() {
    if (!communeActive) return;
    const btn = ui.btnPanneaux, bilan = ui.bilanPanneaux;
    btn.disabled = true;
    // Total 0 = barre indeterminee : on ne sait pas d'avance combien de zones
    // il faudra interroger, le decoupage depend de ce que l'API repond.
    const prog = progression(ui.progPanneaux,
      { titre: 'Panneaux d\'agglomération', annulable: true }).etape('Interrogation de la source', 0);
    try {
      const r = await chargerPanneauxAgglo(communeActive.bbox, prog);
      panneaux = r.panneaux;
      const cl = classerPanneaux();
      bilanPanneaux = { ...r, ...cl };
      redrawPanneaux();
      renderBilanPanneaux();
      ui.btnPreTrace.disabled = !panneaux.length;
    } catch (e) {
      panneaux = []; bilanPanneaux = null;
      redrawPanneaux();
      bilan.innerHTML = (e instanceof AnnulationDemandee)
        ? 'Relevé interrompu.'
        : '⚠ ' + esc(e.message) +
          '<br>Cette source exige Tampermonkey (la page de WME ne peut pas appeler l\'extérieur).';
    } finally {
      prog.fin();
      btn.disabled = !communeActive;
    }
  }

  function renderBilanPanneaux() {
    const z = ui.bilanPanneaux;
    if (!z) return;
    if (!bilanPanneaux) { z.textContent = ''; return; }
    const b = bilanPanneaux;
    const total = b.dedans.length + b.dehors.length;
    if (!total) {
      // ⚠️ Ne JAMAIS traduire « aucun panneau » par « aucune agglomeration » :
      // 86 departements sur 101 sont couverts, et le releve peut etre muet.
      z.innerHTML = '<b>Aucun panneau EB10 / EB20 relevé dans cette commune.</b><br>' +
        'Le jeu national ne couvre que 86 départements, et une commune couverte ' +
        'peut n\'avoir aucun panneau saisi : cela ne dit RIEN sur son agglomération.';
      return;
    }
    const lignes = ['<b>' + total + ' panneau(x) d\'agglomération</b> dans la commune (' +
      b.cellules + ' requete(s)).'];
    if (!b.zones) {
      lignes.push('Aucun polygone tracé : rien à confronter pour l\'instant.');
    } else {
      // ⚠️ Le decompte « n dedans / n dehors » et les distances au bord ont ete
      // retires a la demande de l'auteur (23/07) : ils n'apprennent rien
      // d'actionnable, et ils sont devenus trompeurs depuis que le trace passe
      // PAR les panneaux — un point pile sur le bord bascule d'un cote ou de
      // l'autre selon l'arrondi, d'ou des « 0 m » absurdes. Ce qui compte,
      // c'est de regarder si le trace englobe le bati.
      lignes.push('Vérifie que le tracé englobe bien les habitations de ' +
        'l\'agglomération, et ajuste-le aux poignees (✎) si besoin.');
    }
    if (b.tronque) {
      lignes.push('⚠️ <b>Relevé peut-être incomplet</b> : une zone rendait le maximum ' +
        'de résultats que l\'API accepte, même découpée au plus fin.');
    }
    z.innerHTML = lignes.join('<br>');
  }

  /**
   * Les villes que WME connait dans la vue courante. ⚠️ C'est la demande
   * expresse de l'auteur (23/07) : « il faut que WME parcoure la liste, en
   * fonction de la vue, les communes existantes dans WME, et on demandera a
   * l'utilisateur de choisir ». On ne fait donc PAS saisir un nom a la main —
   * une faute de frappe se propagerait sur toute une agglomeration — et on ne
   * l'invente pas davantage. Verifie en live sur Gruissan : la liste rend
   * « Gruissan », « Gruissan-Plage (Gruissan) » et la ville vide.
   */
  function villesDeWME() {
    try {
      return (sdk.DataModel.Cities.getAll() || [])
        .map(c => c && c.name).filter(n => n)     // la ville VIDE n'est pas un nom
        .filter((n, i, t) => t.indexOf(n) === i)
        .sort((a, b) => a.localeCompare(b, 'fr'));
    } catch (e) { log('lecture des villes de WME impossible', e); return []; }
  }

  /**
   * Alimente la liste de suggestions partagee par l'etiquette du volet et la
   * boite de nommage. Un `datalist` PROPOSE sans enfermer : l'editeur choisit
   * dans les villes que WME connait, ou tape ce qu'il veut — c'est la demande
   * de l'auteur (« saisie manuelle qui doit rester possible »).
   * ⚠️ Elle vit dans le `body` : la boite de dialogue et le volet sont dans
   * deux arbres differents, un `datalist` local ne servirait qu'a l'un des deux.
   */
  function majDatalistVilles() {
    let dl = document.getElementById('agn-villes-wme');
    if (!dl) {
      dl = document.createElement('datalist');
      dl.id = 'agn-villes-wme';
      document.body.appendChild(dl);
    }
    const commune = communeActive ? communeActive.nom : null;
    const villes = villesDeWME();
    // La commune elle-meme en tete : c'est le cas du bourg principal.
    const choix = commune ? [commune, ...villes.filter(v => v !== commune)] : villes;
    dl.innerHTML = choix.map(v => '<option value="' + esc(v) + '"></option>').join('');
    return choix;
  }

  /**
   * Demande le nom d'un polygone propose. Rend `{label, rattache}` ou null.
   * ⚠️ Le format « Village (Commune) » coche tout seul « village rattache » :
   * c'est ce format, et lui seul, qui change la ville appliquee par l'analyse.
   */
  function demanderNomAgglo(prop, rang, total) {
    return new Promise(resolve => {
      const commune = communeActive.nom;
      majDatalistVilles();
      const boite = el(`
        <div id="agn-modale">
          <div class="agn-modale-in">
            <div class="agn-modale-t">Polygone ${rang} / ${total} — quel nom ?</div>
            <div class="agn-modale-c">
              Ce trace vient de <b>${prop.portes}</b> entrée(s) d'agglomération
              (${prop.panneaux} panneau(x)).
              <div class="agn-modale-geo">
                <div class="agn-d">⚠️ <b>Trace grossier</b> : les panneaux ne sont
                  poses que sur les routes. Entre deux entrées, la ligne est
                  calculée, pas relevée — <b>à corriger aux poignées</b> ensuite.</div>
              </div>
              L'étiquette sert de repère. Le format
              <b>Village (Commune)</b> est le seul qui change la ville appliquée.
            </div>
            <input type="text" class="agn-sel" id="agn-na-sel" list="agn-villes-wme"
                   value="${esc(commune)}" autocomplete="off"
                   placeholder="Choisis une ville, ou saisis un nom">
            <div class="agn-note" id="agn-na-apercu"></div>
            <label class="agn-sb-c"><input type="checkbox" id="agn-na-rat" title="Village rattaché : le nom appliqué devient « Village (Commune) » au lieu du seul nom de la commune INSEE">
              Village rattache (ville = « Village (Commune) »)</label>
            <button class="agn-btn primary" id="agn-na-ok">Créer ce polygone</button>
            <button class="agn-btn" id="agn-na-skip">Passer celui-ci</button>
            <button class="agn-btn" id="agn-na-stop">Tout arrêter</button>
          </div>
        </div>`);
      document.body.appendChild(boite);
      // Deplacable par son titre : ces boites masquent l'endroit de la carte
      // dont elles parlent (demande de l'auteur, 26/07).
      rendreDeplacable(boite.querySelector('.agn-modale-in'),
                       boite.querySelector('.agn-modale-t'));
      boite.addEventListener('mousedown', e => e.stopPropagation());
      ['keydown', 'keypress', 'keyup'].forEach(ev =>
        boite.addEventListener(ev, e => e.stopPropagation()));
      const sel = boite.querySelector('#agn-na-sel'), rat = boite.querySelector('#agn-na-rat');
      const apercu = boite.querySelector('#agn-na-apercu');
      /**
       * ⚠️ « Le script ne me propose pas de choisir la Commune de » (auteur,
       * 23/07, sur Gruissan-Les Ayguades). Un village rattache s'ecrit
       * « Village (Commune) », et c'est la COMMUNE INSEE qui va entre
       * parentheses — l'editeur n'a donc a choisir QUE le village, le reste
       * se compose tout seul. Il peut taper un nom qui n'existe pas encore
       * dans WME : la liste propose, elle n'enferme pas.
       */
      const composer = () => {
        const brut = sel.value.trim();
        if (!rat.checked) return brut;
        const village = brut.replace(/\s*\(.*\)\s*$/, '').trim();   // « X (Y) » → « X »
        return village && village !== commune ? village + ' (' + commune + ')' : commune;
      };
      const maj = () => {
        apercu.textContent = rat.checked
          ? 'Ville appliquée : ' + composer()
          : 'Ville appliquée : ' + (sel.value.trim() || commune);
      };
      // Un nom deja au format « X (Y) » coche la case tout seul.
      sel.oninput = () => { if (/\s\(.+\)\s*$/.test(sel.value)) rat.checked = true; maj(); };
      rat.onchange = maj;
      maj();
      const finir = v => { boite.remove(); resolve(v); };
      boite.querySelector('#agn-na-ok').onclick =
        () => finir({ label: composer(), rattache: rat.checked });
      boite.querySelector('#agn-na-skip').onclick = () => finir({ passe: true });
      boite.querySelector('#agn-na-stop').onclick = () => finir(null);
    });
  }

  /**
   * Pre-trace : un polygone A LA FOIS, cadre sur la carte avant d'etre nomme.
   * ⚠️ Deposer trois polygones anonymes d'un bloc serait ingerable — l'auteur
   * a demande qu'on ne « s'emmele pas les pinceaux ». On montre donc chaque
   * proposition la ou elle est, et on la nomme avant de passer a la suivante.
   */
  async function preTracerDepuisPanneaux() {
    if (!communeActive) return;
    const cl = classerPanneaux();
    const fiches = cl ? [...cl.dedans, ...cl.dehors] : [];
    if (!fiches.length) {
      ui.bilanPanneaux.innerHTML = 'Aucun panneau relevé : rien à proposer. ' +
        'Lance d\'abord « 🪧 Panneaux d\'agglomération ».';
      return;
    }
    const tous = proposerPolygones(fiches);
    // ⚠️ Seuls les groupes qui forment une VRAIE surface sont proposables. Les
    // autres (portes isolees ou alignees) ne sont pas traces — on ne devine
    // pas une etendue qu'on ne connait pas —, mais on les COMPTE pour le dire.
    const props = tous.filter(p => p.ring);
    const nonTracables = tous.filter(p => !p.ring);
    const nManuels = nonTracables.reduce((s, p) => s + p.portes, 0);
    const phraseManuels = nManuels
      ? ' <b>' + nManuels + ' entrée(s)</b> supplementaire(s) sont trop isolees ou ' +
        'alignées pour deviner un contour : trace-les à la main, les panneaux ' +
        '(carres) restent affiches en repère.'
      : '';

    if (!props.length) {
      // Rien a proposer : c'est le cas Narbonne. On le dit clairement plutot
      // que de sortir des ronds arbitraires.
      ui.bilanPanneaux.innerHTML = 'Les <b>' + fiches.length + '</b> panneau(x) relevé(s) ' +
        'ne forment <b>aucune surface exploitable</b> : leurs entrées sont eparpillees ' +
        'ou alignées le long des routes.<br>Aucun tracé proposé — <b>trace les ' +
        'agglomérations à la main</b> en t\'appuyant sur les panneaux affiches (carres).';
      return;
    }

    const vueAvant = { centre: sdk.Map.getMapCenter(), zoom: sdk.Map.getZoomLevel() };
    let crees = 0;
    try {
      for (let i = 0; i < props.length; i++) {
        const p = props[i];
        // On MONTRE avant de demander : nommer un polygone qu'on ne voit pas
        // n'a aucun sens.
        try { sdk.Map.setMapCenter({ lonLat: p.centre, zoomLevel: 14 }); } catch (e) { /* */ }
        agglos[communeActive.code] = agglos[communeActive.code] || [];
        const apercu = { id: 'apercu', label: '(proposition)', rattache: false, ring: p.ring };
        agglos[communeActive.code].push(apercu);
        redrawAgglos();
        const rep = await demanderNomAgglo(p, i + 1, props.length);
        // L'apercu ne survit jamais a la reponse : il n'est pas une donnee.
        const liste = agglos[communeActive.code];
        liste.splice(liste.indexOf(apercu), 1);
        if (rep === null) break;
        if (rep.passe) { redrawAgglos(); continue; }
        liste.push({ id: 'a' + Date.now() + '-' + i, label: rep.label,
                     rattache: rep.rattache, ring: p.ring });
        crees++;
        saveAgglos(); redrawAgglos(); renderAgglos();
      }
    } finally {
      redrawAgglos(); renderAgglos();
      try { sdk.Map.setMapCenter({ lonLat: vueAvant.centre, zoomLevel: vueAvant.zoom }); } catch (e) { /* */ }
      ui.bilanPanneaux.innerHTML = crees
        ? '<b>' + crees + ' polygone(s) créé(s)</b> à partir de ' + props.length +
          ' groupe(s) d\'entrées.<br>⚠️ <b>Ces tracés sont grossiers</b> : ouvre chaque ' +
          'polygone (✎) et tire les poignees pour les ajuster au terrain avant d\'analyser.' +
          phraseManuels
        : 'Aucun polygone créé.' + phraseManuels;
    }
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

  /**
   * Tracer demande la carte ENTIERE : nos panneaux s'effacent le temps du
   * trace, et reviennent des que le polygone est boucle — c'est a ce
   * moment-la, et pas avant, qu'il y a quelque chose a nommer et a enregistrer
   * (demande de l'auteur, 23/07).
   *
   * ⚠️ On ne rouvre que ce qu'on a soi-meme ferme : une fenetre deja repliee
   * par l'editeur avant le clic doit le rester. Le `finally` garantit le
   * retour meme si le trace est annule (double-clic a vide, echappement).
   */
  async function tracerAgglo() {
    if (!communeActive) return;
    ui.btnTracer.disabled = true;
    ui.btnTracer.textContent = 'Tracé en cours… (double-clic pour fermer)';
    const etaitReplie = ui.overlay.classList.contains('agn-replie');
    const voletEtaitOuvert = ui.volet && ui.volet.classList.contains('agn-volet-ouvert');
    if (!etaitReplie) basculerRepli(true);   // ferme aussi le volet (voir basculerRepli)
    else basculerVolet(false);
    try {
      const ring = extractRing(await sdk.Map.drawPolygon());
      if (!ring || ring.length < 4) throw new Error('tracé inexploitable');
      const dedans = ring.filter(c => pointInGeom(c[0], c[1], communeActive.geom)).length;
      if (dedans === 0 && !confirm('Le polygone tracé est entièrement HORS de ' +
        communeActive.nom + '.\n\nL\'enregistrer quand même ?')) return;
      if (!agglos[communeActive.code]) agglos[communeActive.code] = [];
      agglos[communeActive.code].push({ id: 'a' + Date.now(), label: communeActive.nom, rattache: false, ring });
      saveAgglos(); redrawAgglos(); renderAgglos();
    } catch (e) { log('tracé annulé ou échoué', e); }
    finally {
      if (!etaitReplie) basculerRepli(false);
      if (voletEtaitOuvert) basculerVolet(true);
      // La section « agglomeration » porte le nom a donner au polygone qu'on
      // vient de tracer : la deplier evite de la chercher.
      replierSection('agglo', true);
      ui.btnTracer.disabled = false;
      ui.btnTracer.textContent = '＋ Tracer l\'agglomération';
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
      const h = el('<div class="agn-poi agn-poi-s" title="Glisser pour déplacer, clic droit pour supprimer"></div>');
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
    // Donnees venues de l'API : le nommage est deja resolu, pas d'aller-retour.
    if (seg && seg._nam) return seg._nam;
    const addr = sdk.DataModel.Segments.getAddress({ segmentId: seg.id });
    if (!addr) return null;
    const one = (street, city) => ({
      name: (street && !street.isEmpty && street.name) ? street.name : '',
      cityName: (city && !city.isEmpty && city.name) ? city.name : '',
      signText: (street && street.signText) ? street.signText : '',
      signType: (street && street.signType != null) ? street.signType : null
    });
    return { primary: one(addr.street, addr.city),
             // ⚠️ Id de la Street PRINCIPALE : le cartouche vit dessus, et
             // c'est par lui qu'on regroupe les segments d'une meme voie.
             primaryId: (addr.street && addr.street.id != null) ? addr.street.id : null,
             alts: (addr.altStreets || []).map(a => one(a.street, a.city)) };
  }

  const isRoute = e => !!e.name && (RE_ROUTE.test(e.name.trim()) || (!!e.signText && e.signText.trim() === e.name.trim()));
  const isCommunale = e => !!e.name && RE_COMMUNALE.test(e.name.trim());

  /**
   * Ville a appliquer dans une agglomeration.
   *
   * /!\ La ville de reference est le nom de la COMMUNE INSEE, jamais le libelle
   * du polygone : celui-ci n'est qu'une etiquette de travail, et s'en servir
   * propagerait une faute de saisie sur toute la commune. Seul le village
   * rattache fait exception, et son nom se lit alors sur la City deja portee par
   * le segment — pas sur le polygone non plus.
   *
   * ⚠️⚠️ EXTRAITE de `expectedNaming` en v2.11 pour etre PARTAGEE avec les
   * GIRATOIRES, qui appliquaient `communeActive.nom` en dur et ignoraient donc
   * les villages rattaches. Mesure a Gruissan : 22 giratoires portaient
   * correctement « Les Ayguades (Gruissan) » ou « Gruissan-Plage (Gruissan) » et
   * le script reclamait de les remplacer par « Gruissan » — il DEGRADAIT 22
   * nommages justes. Deux endroits qui decident de la meme chose doivent
   * partager le meme code.
   */
  function villeAgglo(nam, agglo, nomCommune) {
    if (!agglo || !agglo.rattache) return { ville: nomCommune, doute: null };
    const villeSeg = nam.primary.cityName ||
                     (nam.alts.find(a => a.cityName) || {}).cityName || '';
    // la ville du segment peut deja etre au format « Village (Commune) »
    const village = (villeSeg.match(/^\s*(.+?)\s*\(/) || [null, villeSeg])[1].trim();
    if (village) return { ville: village + ' (' + nomCommune + ')', doute: null };
    return { ville: nomCommune, doute: 'village rattaché : aucune ville sur le segment, ' +
             'impossible d\'en déduire le nom du village' };
  }

  function expectedNaming(nam, agglo, nomCommune) {
    // ⚠️⚠️ UN NOM COMPOSITE « Dxxx - Nom de la route » NE DOIT JAMAIS SERVIR DE
    // CIBLE (corrige en v2.14, defaut vu en live a Saint-Laurent-des-Arbres).
    // `isRoute` ne le reconnait pas comme un numero — il y a du texte apres —
    // donc il passait pour un NOM DE RUE valide et pouvait etre retenu comme
    // cible : le script reclamait alors d'AJOUTER « N580 - Route d'Avignon » en
    // alternatif, c'est-a-dire de CREER le format interdit, tout en demandant
    // par ailleurs de le supprimer. Deux consignes contradictoires sur le meme
    // segment.
    // On le ramene donc a son nom seul AVANT tout raisonnement : si le bon nom
    // existe deja ailleurs, les deux se confondent et il n'y a plus d'ecart
    // fantome ; s'il est le seul, la cible proposee est le nom PROPRE.
    const nettoyer = e => {
      const m = (e.name || '').match(RE_NOM_COMPOSITE);
      return m ? { name: m[2].trim(), cityName: e.cityName,
                   signText: e.signText, signType: e.signType } : e;
    };
    const vues = new Set();
    const entries = [nam.primary, ...nam.alts]
      .filter(e => e.name || e.cityName)
      .map(nettoyer)
      // Le nettoyage peut creer des doublons (« N580 - Route d'Avignon » et
      // « Route d'Avignon » deviennent identiques) : on les fond en un seul,
      // sinon le doute « plusieurs noms de rue » se declencherait a tort.
      .filter(e => {
        const k = (e.name || '').trim().toLowerCase() + '|' + (e.cityName || '').trim().toLowerCase();
        if (vues.has(k)) return false;
        vues.add(k); return true;
      });
    const routes = entries.filter(isRoute);
    const noms = entries.filter(e => e.name && !isRoute(e));
    const route = routes[0] || null, nomRue = noms[0] || null;

    let doute = null;
    if (routes.length > 1) doute = 'plusieurs numéros de route sur le segment';
    else if (noms.length > 1) doute = 'plusieurs noms de rue — noms alternatifs reels ?';

    const P = (name, city) => ({ name: name || '', cityName: city || '' });

    /**
     * ⚠️⚠️ QUAND PLUSIEURS CANDIDATS SE PRESENTENT, ON NE CHOISIT PAS A LA
     * PLACE DE L'EDITEUR (remarque de l'auteur, 22/07 : « la correction
     * automatique prend le premier. Pas bon »).
     * Cas typique : un segment en agglomeration nomme au format hors agglo
     * (numero de route en principal, nom de rue en alternatif). La correction
     * bascule le nom de rue en principal — mais s'il y a DEUX alternatifs
     * (nom d'usage, ancien nom, lotissement…), `noms[0]` est un tirage au
     * sort. On expose donc la liste, et `appliquerCorrection` demande.
     * Meme regle pour les numeros de route quand c'est l'un d'eux qui doit
     * passer en principal (H6, H9, C4).
     */
    const fin = res => {
      const p = ((res.primary && res.primary.name) || '').trim();
      if (!p) return res;
      const ville = res.primary.cityName;
      const source = (noms.length > 1 && noms.some(n => (n.name || '').trim() === p)) ? noms
                   : (routes.length > 1 && routes.some(n => (n.name || '').trim() === p)) ? routes
                   : null;
      if (!source) return res;
      // ⚠️ DEDUPLIQUER PAR NOM. Un meme libelle apparait souvent deux fois —
      // en principal et en alternatif, ou avec deux villes differentes. Sans
      // ca on proposait « D26 ou D26 » (vu en live), question absurde qui use
      // la confiance dans le reste des questions.
      const vus = new Set(), uniq = [];
      source.forEach(n => {
        const k = (n.name || '').trim();
        if (!k || vus.has(k)) return;
        vus.add(k); uniq.push({ nom: n.name, ville });
      });
      if (uniq.length > 1) res.candidatsPrincipal = uniq;
      return res;
    };

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
      const va = villeAgglo(nam, agglo, nomCommune);
      const v = va.ville;
      if (va.doute) doute = (doute ? doute + ' ; ' : '') + va.doute;
      const s = agglo.rattache ? 'R' : 'C';
      if (nomRue && route) return fin({ cas: s + '1', primary: P(nomRue.name, v), alts: [P(route.name, v)], doute });
      if (nomRue)          return fin({ cas: s + '2', primary: P(nomRue.name, v), alts: [], doute });
      if (route)           return fin({ cas: s + '4', primary: P(route.name, v), alts: [], doute });
      return { cas: s + '3', primary: P('', v), alts: [], doute };
    }
    const vAlt = nomCommune;
    if (!nomRue && !route) return { cas: 'H5', primary: P('', ''), alts: [], doute };
    if (!nomRue && route)  return fin({ cas: 'H6', primary: P(route.name, ''), alts: [P(route.name, vAlt)], doute });
    if (nomRue && !route)  return fin({ cas: 'H7', primary: P(nomRue.name, ''), alts: [P(nomRue.name, vAlt)], doute });
    if (route && isCommunale(route)) return fin({ cas: 'H8', primary: P(nomRue.name, ''),
      alts: [P(route.name, vAlt), P(nomRue.name, vAlt)], doute });
    return fin({ cas: 'H9', primary: P(route.name, ''), alts: [P(nomRue.name, vAlt)], doute });
  }

  /**
   * Cartouches (road shields). Dans WME, l'ecusson est porte par la Street via
   * signText + signType. Trois controles, de gravite decroissante :
   *  1. le NOM PRINCIPAL est un numero de route mais n'a pas de cartouche ;
   *  2. un NOM ALTERNATIF est un numero de route sans cartouche (moins grave) ;
   *
   * ⚠️⚠️ IL N'Y A PLUS DE TROISIEME CONTROLE. La v1.92 signalait « le numero est
   * en alternatif, le principal est un nom de rue ⇒ le principal devrait porter
   * le cartouche ». L'auteur a rappele la regle officielle le 26/07 : EN
   * AGGLOMERATION, on ne met AUCUN cartouche sur le nom de rue en principal,
   * peu importe qu'il existe ou non en alternatif. Ce « rappel » proposait donc
   * une correction qui ABIMAIT le nommage.
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
    // ⚠️ Le cartouche sur le NOM DE RUE principal n'est plus propose EN
    // AGGLOMERATION (v2.17) : la regle officielle l'interdit. Hors
    // agglomeration, le jugement reste de GROUPE — le cartouche vit sur la
    // Street, PARTAGEE par toute la voie, donc le poser depuis un seul segment
    // le colle a tous — et se fait dans `cartouchesPrincipal()`.
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
        apres: '‹sans nom› — à basculer en nom alternatif (utile à la recherche)' });
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
          apres: 'écrire le type de voie en toutes lettres' });
      }
      if (c.contractions && (RE_SAINT.test(nom) || initialeIsolee(nom))) {
        ecarts.push({ champ: 'contraction' + ou, avant: nom,
          apres: 'écrire le nom complet (contractions interdites)' });
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
      // ⚠️⚠️ « Dxxx - Nom de la route » : ancienne regle FR, INTERDITE aujourd'hui.
      // Le remede depend de l'endroit ou le composite se trouve, et on le DIT,
      // parce que les deux cas ne se corrigent pas de la meme facon :
      //  - en PRINCIPAL : il suffit de le remplacer par le nom seul ;
      //  - en ALTERNATIF : ⚠️ le SDK n'a PAS de `removeAlternateStreet` (voir
      //    [[wme-sdk-pieges]]), donc le script ne peut pas le retirer — c'est un
      //    geste manuel, et promettre le contraire serait mentir.
      if (c.nomComposite) {
        const m = nom.match(RE_NOM_COMPOSITE);
        if (m) {
          const nomSeul = m[2].trim();
          // Le bon nom existe-t-il DEJA ailleurs sur ce segment ? Alors le
          // composite n'est qu'un doublon a supprimer, et on le dit.
          const dejaLa = [nam.primary, ...nam.alts]
            .some(x => x !== e && (x.name || '').trim().toLowerCase() === nomSeul.toLowerCase());
          ecarts.push({ champ: 'numéro collé au nom' + ou, avant: nom,
            apres: i === 0
              ? nomSeul + ' — le numéro va en alternatif (ou en principal hors agglomération), jamais collé au nom'
              : (dejaLa
                  ? '⚠️ à SUPPRIMER à la main : « ' + nomSeul + ' » est déjà présent, ce nom en est un doublon (ancienne règle)'
                  : '⚠️ à corriger à la main en « ' + nomSeul + ' » : le script ne sait pas retirer un nom alternatif') });
        }
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
      // Partagee avec le traitement des giratoires : la ville d'une agglomeration
      // se decide au meme endroit pour tout le monde (village rattache compris).
      villeAgglo: villeAgglo,

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
        { cle: 'nommageZone', portee: 'zone', libelle: 'Nommage agglo / hors agglo (cœur)' },
        { cle: 'cartouches', portee: 'segment', libelle: 'Cartouches des Dxxx / Nxxx / Cxxx',
          executer: verifierCartouches },
        { cle: 'bretelles', portee: 'type', libelle: 'Bretelles : jamais de ville' },
        { cle: 'rails', portee: 'type', libelle: 'Voies ferrées, pistes, ferries : ni ville ni nom' },
        { cle: 'rocades', portee: 'type', libelle: 'Rocades et périphériques : jamais de ville' },
        { cle: 'giratoires', portee: 'type', libelle: 'Giratoires : sans nom (ville selon la zone)' },
        { cle: 'abreviations', portee: 'forme', libelle: 'Abréviations interdites (Av., Bd., Rte...)' },
        { cle: 'contractions', portee: 'forme', libelle: 'Contractions interdites (St-, R. Poincaré)' },
        { cle: 'majuscule', portee: 'forme', libelle: 'Nom commençant par une minuscule' },
        // Ancienne regle FR, aujourd'hui interdite : « D980 - Route de Bagnols ».
        { cle: 'nomComposite', portee: 'forme',
          libelle: 'Numéro collé au nom (« D980 - Route de… », interdit)' },
        { cle: 'fonctionDirection', portee: 'forme', libelle: 'Fonction ou direction dans le nom' },
        { cle: 'hnHorsAgglo', portee: 'adresse',
          libelle: 'Numéros de rue (HN) hors agglomération' },
        { cle: 'poiAgglo', portee: 'adresse',
          libelle: 'POI résidentiels en agglomération (à vérifier)' },
        // ── Les VRAIS POI (pas les RPP) : audit de leur adresse ───────────────
        { cle: 'poiAdresse', portee: 'poi',
          libelle: 'POI : adresse incomplète (rue ou commune manquante)' },
        { cle: 'poiVilleCommune', portee: 'poi',
          libelle: 'POI : commune différente du contour INSEE (à vérifier)' },
        // ⚠️ DECOCHE PAR DEFAUT (arbitrage de l'auteur) : mesure a
        // Saint-Laurent-des-Arbres, 49 POI sur 98 n'ont pas de numero. L'activer
        // d'office noierait les rues et communes manquantes, qui sont 25.
        { cle: 'poiNumero', portee: 'poi', defaut: false,
          libelle: 'POI : numéro de rue manquant' }
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

  // ===========================================================================
  // GARDE-FOU TERRITORIAL — le script ne travaille qu'en France (v2.03)
  //
  // Les regles de nommage codees ici sont FRANCAISES. Applique ailleurs, le
  // script ne se tromperait pas a la marge : il renommerait massivement de
  // travers. Jusqu'a la v2.02, `detecterPays()` retombait sur la France quand
  // il ne savait pas — donc l'outil marchait partout. On inverse la charge de
  // la preuve : sans France DEMONTREE, l'outil se ferme.
  // ===========================================================================

  /**
   * Territoires FRANCAIS, tels que Waze les nomme.
   *
   * ⚠️⚠️ L'outre-mer n'est PAS « la France » dans le modele Waze : Guadeloupe,
   * Martinique, Guyane, Reunion, Mayotte y sont des pays a part entiere, avec
   * leur propre identifiant et leurs propres villes. Les bloquer serait un
   * contresens — le code de la route et les regles de nommage y sont les
   * memes. On les enumere donc, par code ISO ET par nom, en anglais comme en
   * francais : WME nomme les pays selon la langue du profil de l'editeur.
   */
  const FR_CODES = new Set(['FR', 'GP', 'MQ', 'GF', 'RE', 'YT', 'MF', 'BL',
                            'PM', 'NC', 'PF', 'WF', 'TF']);
  const FR_NOMS = new Set([
    'france', 'france métropolitaine', 'corse',
    'guadeloupe', 'martinique',
    'guyane', 'guyane française', 'french guiana',
    'la reunion', 'reunion', 'mayotte',
    'saint-martin', 'saint martin', 'saint-barthelemy', 'saint barthelemy',
    'saint-pierre-et-miquelon', 'saint pierre and miquelon',
    'nouvelle-caledonie', 'nouvelle caledonie', 'new caledonia',
    'polynesie française', 'french polynesia',
    'wallis-et-futuna', 'wallis et futuna', 'wallis and futuna',
    'terres australes et antarctiques françaises',
    'french southern and antarctic lands', 'french southern territories'
  ].map(n => normSansAccent(n)));

  /** Ce nom ou ce code designe-t-il un territoire francais ? */
  function estTerritoireFrancais(nomOuCode) {
    const t = String(nomOuCode || '').trim();
    if (!t) return false;
    if (t.length <= 3 && FR_CODES.has(t.toUpperCase())) return true;
    return FR_NOMS.has(normSansAccent(t));
  }

  /**
   * Pays de la zone REGARDEE. Renvoie `{ nom, code }`, ou `null` quand rien ne
   * permet encore de conclure.
   *
   * ⚠️⚠️ PIEGE VERIFIE EN LIVE (26/07, Coursan → Barcelone) : le modele Waze
   * ACCUMULE les pays visites, il ne les remplace pas. Apres un saut a
   * Barcelone, `W.model.countries` contenait `["France", "Spain"]` et
   * `sdk.DataModel.Countries.getTopCountry()` repondait encore **France**.
   * `getTopCountry()` est donc REMANENT : il dit « un pays deja rencontre dans
   * la session », PAS « le pays sous les yeux ». L'utiliser pour un garde-fou
   * territorial donne un faux feu vert a l'etranger. NE PAS Y REVENIR.
   *
   * On ne se fie donc qu'a des preuves attachees a la vue COURANTE :
   *   1. le centre de la vue tombe dans un contour communal INSEE deja charge —
   *      preuve directe et instantanee, independante du zoom ;
   *   2. sinon, les pays des segments dont la GEOMETRIE est dans l'emprise
   *      courante (le filtre par emprise est ce qui elimine la remanence), au
   *      MAJORITAIRE : en zone frontaliere, un segment isole ne fait pas foi.
   */
  function detecterPays() {
    // 1. Preuve geometrique : nos propres contours INSEE.
    try {
      const ctr = sdk.Map.getMapCenter();
      if (ctr && communes.length && communeDuPoint(ctr.lon, ctr.lat)) {
        return { nom: 'France', code: 'FR' };
      }
    } catch (e) { /* on essaie la suite */ }
    // 2. Pays majoritaire des segments REELLEMENT dans la vue.
    try {
      let ext; try { ext = sdk.Map.getMapExtent(); } catch (e) { ext = null; }
      const comptes = new Map();
      for (const s of sdk.DataModel.Segments.getAll()) {
        // ⚠️ Le filtre par emprise n'est pas cosmetique : juste apres un saut
        // de carte, `getAll()` rend encore des segments de l'ancienne vue.
        if (ext) {
          const co = s.geometry && s.geometry.coordinates;
          if (!co || !co.length) continue;
          const p = co[Math.floor(co.length / 2)];
          if (!p || p[0] < ext[0] || p[0] > ext[2] || p[1] < ext[1] || p[1] > ext[3]) continue;
        }
        let a; try { a = sdk.DataModel.Segments.getAddress({ segmentId: s.id }); } catch (e) { continue; }
        const c = a && a.country;
        const cle = c && (c.name || c.abbr);
        if (!cle) continue;
        const e0 = comptes.get(cle) || { n: 0, nom: c.name || null, code: c.abbr || null };
        e0.n++; comptes.set(cle, e0);
        if (comptes.size === 1 && e0.n >= 20) break;   // unanimite franche : inutile d'aller plus loin
      }
      let meilleur = null;
      for (const e0 of comptes.values()) if (!meilleur || e0.n > meilleur.n) meilleur = e0;
      if (meilleur) return { nom: meilleur.nom, code: meilleur.code };
    } catch (e) { /* rien de lisible */ }
    return null;
  }

  /**
   * Etat territorial courant : `fr`, `hors` ou `inconnu`.
   *
   * ⚠️ « inconnu » BLOQUE aussi. C'est volontaire : tant qu'aucun segment n'est
   * charge, il n'y a de toute facon rien a analyser, et laisser passer le doute
   * remettrait exactement le repli permissif qu'on vient de retirer. L'etat est
   * reevalue a chaque deplacement de carte, donc la levee est automatique.
   */
  let pays = { etat: 'inconnu', nom: null, code: null };

  function evaluerPays() {
    const p = detecterPays();
    const avant = pays.etat;
    if (!p) pays = { etat: 'inconnu', nom: null, code: null };
    else pays = {
      etat: (estTerritoireFrancais(p.nom) || estTerritoireFrancais(p.code)) ? 'fr' : 'hors',
      nom: p.nom, code: p.code
    };
    if (pays.etat !== avant) {
      log('territoire : ' + pays.etat + (pays.nom ? ' (' + pays.nom + ')' : ''));
      // Le blocage change ce que l'editeur peut faire : les boutons et le
      // bandeau doivent suivre immediatement, pas au prochain clic.
      try { renderAgglos(); majBandeauPays(); } catch (e) { /* UI pas encore prete */ }
    }
    return pays;
  }

  const enFrance = () => pays.etat === 'fr';

  /** Ce qu'on affiche a l'editeur quand l'outil se ferme. */
  function messagePays() {
    if (pays.etat === 'hors') {
      return '<b>Hors de France : outil désactivé.</b><br>' +
        'Les règles de nommage de ce script sont françaises' +
        (pays.nom ? ' et la carte est sur <b>' + esc(pays.nom) + '</b>' : '') +
        '. Les appliquer ailleurs abîmerait la carte.<br>' +
        'La France métropolitaine, la Corse et l\'outre-mer sont acceptés.';
    }
    // ⚠️ Message ACTIONNABLE : la cause est presque toujours un zoom trop
    // faible (WME ne charge aucun segment avant le zoom 14, cf.
    // [[wme-sdk-pieges]]), pas un vrai probleme de territoire.
    return '<b>Territoire indéterminé : analyse en attente.</b><br>' +
      'Zoome à 14 ou plus sur la commune : WME ne charge aucune donnée en dessous, ' +
      'et le script a besoin de lire le pays avant d\'appliquer des règles françaises.';
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
  /** Profondeur de subdivision d'un cote : 4 => jusqu'a 16 morceaux. */
  const PROF_SUBDIV = 4;

  /**
   * Part de longueur du cote [a,b] qui est DANS la zone.
   *
   * ⚠️⚠️ Ne PAS se contenter de l'etat des deux extremites (defaut corrige en
   * v2.08, trouve par les tests de `tools/test-zonage.js`) : un cote peut
   * TRAVERSER la zone sans qu'aucun de ses bouts n'y soit (une route qui passe
   * de part en part d'un village), ou au contraire en SORTIR en son milieu quand
   * le polygone est concave. Le code d'origine comptait le premier cas pour 0 %
   * et le second pour 100 %.
   * Mesure sur les communes de l'auteur avant correction : 1 segment sur 838 a
   * Coursan (100 % annonce contre 78 % reels — le segment passait « en agglo »
   * au lieu d'etre signale « a couper ») et 1 sur 2922 a Gruissan. C'est rare,
   * mais c'est une erreur sur le CŒUR du script, et la corriger coute un seul
   * test de point par cote.
   *
   * ⚠️ Ce n'est pas une garantie absolue : une incursion plus courte que le pas
   * de subdivision reste invisible. On divise le risque, on ne l'annule pas.
   */
  function partCote(a, b, dedans, da, db, prof) {
    const d = longueur(a, b);
    if (!d) return 0;
    if (da !== db) {
      // Franchissement : la dichotomie situe le passage a ~0,02 % pres.
      let lo = 0, hi = 1;
      for (let k = 0; k < 12; k++) {
        const t = (lo + hi) / 2;
        if (dedans(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t) === da) lo = t; else hi = t;
      }
      const t = (lo + hi) / 2;
      return d * (da ? t : 1 - t);
    }
    // Meme etat aux deux bouts : le MILIEU peut pourtant differer. S'il differe,
    // on coupe le cote en deux et on recommence sur chaque moitie.
    if (prof > 0) {
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const dm = dedans(m[0], m[1]);
      if (dm !== da) {
        return partCote(a, m, dedans, da, dm, prof - 1) +
               partCote(m, b, dedans, dm, db, prof - 1);
      }
    }
    return da ? d : 0;
  }

  /**
   * Part de LONGUEUR d'un trace situee a l'interieur d'une zone.
   *
   * On raisonne en longueur et non en nombre de sommets : un virage concentre
   * dix points sur vingt metres quand une ligne droite en compte deux sur un
   * kilometre.
   */
  function partDedans(coords, dedans) {
    let total = 0, dans = 0;
    for (let i = 1; i < coords.length; i++) {
      const a = coords[i - 1], b = coords[i];
      const d = longueur(a, b);
      if (!d) continue;
      total += d;
      dans += partCote(a, b, dedans, dedans(a[0], a[1]), dedans(b[0], b[1]), PROF_SUBDIV);
    }
    return { total, dans };
  }

  // ===========================================================================
  // ROUTES MITOYENNES : une voie qui SUIT la limite communale (v2.08)
  //
  // ⚠️⚠️ RETOUR TERRAIN de l'auteur (26/07, vecu a Saint-Michel-d'Euzet) : des
  // routes HORS AGGLO epousent exactement la limite entre deux communes —
  // chacune en possede un cote. Leur geometrie oscille alors de part et d'autre
  // de la frontiere au gre des micro-ecarts de trace, `partCommune` retombe vers
  // 50 %, et le script reclamait « a couper sur la limite communale ».
  // IL N'Y A RIEN A COUPER : la route appartient bien aux deux communes.
  //
  // Regle posee par l'auteur : tant que la voie est SUPERPOSEE a la limite, et
  // que le nom de la commune analysee figure dans le nom principal OU dans un
  // alternatif, c'est bon. Ce n'est qu'a la fin de la superposition — la ou la
  // voie entre franchement dans une commune — qu'une coupe se justifie.
  // ===========================================================================

  /** Tolerance de superposition. Au-dela, la voie ne « longe » plus la limite. */
  const TOL_MITOYEN_M = 12;

  /**
   * En dessous de ce debordement, on ne dit RIEN : c'est l'ecart normal entre le
   * contour INSEE et le trace de Waze, tous deux au metre pres, pas une
   * information exploitable. 10 m se verifient a l'œil sur la carte.
   */
  const SEUIL_DEBORD_M = 10;
  const DEG_PAR_M = 1 / 111320;      // ~1 degre de latitude = 111,32 km

  /**
   * Cotes du contour communal, mis en cache : le contour d'une commune INSEE
   * compte des centaines de sommets et on l'interroge une fois par segment.
   */
  let cacheCotes = { code: null, cotes: null };
  function cotesDuContour(commune) {
    if (cacheCotes.code === commune.code) return cacheCotes.cotes;
    const cotes = [];
    const ajouterAnneaux = anneaux => {
      for (const ring of anneaux) {
        for (let i = 1; i < ring.length; i++) cotes.push([ring[i - 1], ring[i]]);
      }
    };
    const g = commune.geom;
    if (g && g.type === 'Polygon') ajouterAnneaux(g.coordinates);
    else if (g && g.type === 'MultiPolygon') g.coordinates.forEach(ajouterAnneaux);
    cacheCotes = { code: commune.code, cotes };
    return cotes;
  }

  /**
   * Distance d'un point a la frontiere communale, en metres approches.
   * Le calcul se fait dans un plan local (longitudes corrigees du cosinus de la
   * latitude), suffisant a cette echelle.
   */
  function distanceALaLimite(lon, lat, commune) {
    const cotes = cotesDuContour(commune);
    const k = Math.cos(lat * Math.PI / 180);
    const px = lon * k, py = lat;
    // Fenetre de recherche : au-dela, inutile de calculer une distance exacte.
    const marge = TOL_MITOYEN_M * DEG_PAR_M * 3;
    let min = Infinity;
    for (const [a, b] of cotes) {
      // Rejet rapide par boite englobante du cote.
      if (lon < Math.min(a[0], b[0]) - marge || lon > Math.max(a[0], b[0]) + marge ||
          lat < Math.min(a[1], b[1]) - marge || lat > Math.max(a[1], b[1]) + marge) continue;
      const ax = a[0] * k, ay = a[1], bx = b[0] * k, by = b[1];
      const dx = bx - ax, dy = by - ay;
      const l2 = dx * dx + dy * dy;
      let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
      const ex = px - (ax + t * dx), ey = py - (ay + t * dy);
      const d = Math.sqrt(ex * ex + ey * ey);
      if (d < min) min = d;
    }
    return min === Infinity ? Infinity : min / DEG_PAR_M;
  }

  /**
   * Part de longueur de la voie qui LONGE la limite communale.
   * On reutilise `partDedans` avec « etre pres de la frontiere » comme critere :
   * la dichotomie et la subdivision situent les entrees et sorties de la bande
   * de tolerance aussi bien que celles d'un polygone.
   */
  function partLeLongDeLaLimite(coords, commune) {
    const r = partDedans(coords, (x, y) =>
      distanceALaLimite(x, y, commune) <= TOL_MITOYEN_M);
    return r.total ? r.dans / r.total : 0;
  }

  /** La commune analysee est-elle portee par le nom principal ou un alternatif ? */
  function communePortee(nam, nomCommune) {
    const cible = normSansAccent(String(nomCommune || '').trim());
    if (!cible) return false;
    return [nam.primary, ...nam.alts]
      .some(e => e && e.cityName && normSansAccent(e.cityName.trim()) === cible);
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

    // ⚠️⚠️ On mesure la part de l'UNION des polygones, pas la SOMME de leurs
    // parts (defaut corrige en v2.08). Additionner comptait DEUX FOIS la portion
    // commune a deux polygones qui se chevauchent : un trace a moitie en
    // agglomeration pouvait ressortir a 80 % et basculer « en agglo » a tort.
    // Le `Math.min(1, …)` d'avant masquait le debordement sans corriger le
    // calcul. ⚡ Verifie le 26/07 : aucun chevauchement dans la base de l'auteur
    // (7 communes, 3 avec plusieurs polygones), donc le defaut ne s'y voyait
    // pas — mais le pre-trace automatique peut produire deux polygones voisins,
    // et un fichier de partage vient de n'importe qui.
    let partAgglo = 0, aggloMaj = null, meilleure = 0;
    if (listeAgglos.length === 1) {
      // Cas courant : l'union se confond avec le seul polygone, un passage suffit.
      const r = partDedans(coords, (x, y) => pointInRings(x, y, [listeAgglos[0].ring]));
      partAgglo = r.total ? r.dans / r.total : 0;
      if (partAgglo > 0) aggloMaj = listeAgglos[0];
    } else {
      const ru = partDedans(coords, (x, y) =>
        listeAgglos.some(a => pointInRings(x, y, [a.ring])));
      partAgglo = ru.total ? ru.dans / ru.total : 0;
      // Le polygone MAJORITAIRE sert a nommer (village rattache) : il se
      // determine polygone par polygone, contrairement a la part totale.
      for (const ag of listeAgglos) {
        const r = partDedans(coords, (x, y) => pointInRings(x, y, [ag.ring]));
        const part = r.total ? r.dans / r.total : 0;
        if (part > meilleure) { meilleure = part; aggloMaj = ag; }
      }
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
   * Les MESURES de debordement sont neutralisees dans la cle : « deborde de
   * 12 m » et « de 40 m » decrivent la meme situation et doivent se regrouper.
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
        ? (f.editable === false ? 1 : 0) : 0
    }));
    for (const f of liste.filter(x => !x.adresse)) {
      const cle = JSON.stringify([
        f.cas, f.libelle,
        f.ecarts.map(e => [e.champ, e.avant, e.apres]),
        // ⚠️ Les MESURES sont neutralisees dans la cle : « deborde de 12 m » et
        // « de 40 m » decrivent la meme situation et doivent se regrouper. Depuis
        // la v2.18 elles sont en METRES ; le motif des pourcentages est conserve,
        // d'anciens doutes pouvant encore en porter.
        (f.doute || '').replace(/\d+(?:[.,]\d+)?\s?(?:%|m)/g, 'N')
      ]);
      const g = carte.get(cle);
      if (g) { g.segIds.push(f.segId); g.geoms.push(f.geom); g.centres.push(f.centre);
               g.editables.push(f.editable); }
      else carte.set(cle, Object.assign({}, f,
        { segIds: [f.segId], geoms: [f.geom], centres: [f.centre], editables: [f.editable] }));
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
      // ⚠️ Releve au balayage (`editable`), pas redemande ici : apres le
      // balayage la carte est ailleurs et `hasPermissions` ne repondrait plus.
      verrouilles: g.editables ? g.editables.filter(x => x === false).length : 0
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
    // Jusqu'a 4 s d'attente ici : si une barre tourne deja (serie de
    // corrections), elle dit ce qu'on attend plutot que de sembler bloquee.
    const p = progEnCours;
    // ⚠️⚠️ ON CADRE TOUJOURS, meme si les numeros paraissent deja charges
    // (demande de l'auteur, 22/07 : « si on n'a pas clique sur l'ecart, ca ne
    // positionne pas »). Cliquer l'eclair sans avoir clique la ligne doit
    // amener la carte sur l'endroit, pas convertir a l'aveugle : l'editeur
    // enchaine ensuite sur le point d'entree du POI, il faut qu'il le voie.
    // Le cadrage est celui du clic sur la ligne — meme centre, meme zoom —
    // mais le zoom est IMPOSE ici : sous le 18, WME ne charge pas les numeros,
    // donc le reglage « zoomer au clic » ne peut pas s'y opposer.
    if (p) p.sous('cadrage sur l\'écart…');
    cadrerSur(f, true);
    await new Promise(r => setTimeout(r, 700));      // la carte doit avoir bouge
    if (p) p.verifier();
    if (hnsManipulables(f).length === (f.hns || []).length) return f.hns.length;
    if (p) p.sous('chargement des numéros de rue…');
    for (let essai = 0; essai < 8; essai++) {
      await new Promise(r => setTimeout(r, 500));
      if (p) p.verifier();          // 4 s d'attente : « Annuler » doit la rompre
      if (hnsManipulables(f).length) break;
    }
    if (p) p.sous(f.libelle || '');
    return hnsManipulables(f).length;
  }

  // ===========================================================================
  // POI (les VRAIS, pas les RPP) — audit de leur ADRESSE (v2.15)
  //
  // Deux controles demandes par l'auteur le 26/07 :
  //   1. adresse INCOMPLETE : pas d'adresse du tout, ou rue absente, ou ville
  //      absente, ou numero absent — ce dernier en controle A PART, decoche par
  //      defaut (mesure : 49 POI sur 98 en manquent a Saint-Laurent-des-Arbres,
  //      l'activer d'office noierait les autres ecarts) ;
  //   2. un POI situe dans le contour INSEE de la commune analysee doit porter
  //      la ville de CETTE commune.
  // ===========================================================================

  /**
   * Ou se trouve un POI, pour decider de quelle commune il releve.
   *
   * ⚠️⚠️ Regle posee par l'auteur : c'est le POINT D'ACCES PRINCIPAL qui compte,
   * pas le centre du POI. Un batiment peut chevaucher deux communes alors que son
   * entree — donc son adresse — n'est que d'un cote. L'API `app/Features` expose
   * ces points dans `entryExitPoints` (releve le 26/07 : `{point, entry,
   * primary}`), et 64 des 79 POI surfaciques de la commune testee en ont un.
   *
   * Ordre de preference, du plus fiable au dernier recours :
   *   1. le point d'acces marque `primary` ;
   *   2. n'importe quel point d'acces d'entree ;
   *   3. la geometrie elle-meme si c'est un point ;
   *   4. faute de mieux, la part de surface majoritaire — approchee par les
   *      SOMMETS du contour, ce qui suffit a trancher « majoritairement dans » et
   *      coute infiniment moins qu'une integration de surface.
   * Rend `{ point, source }` — la source est DITE a l'editeur, parce qu'un
   * verdict fonde sur une part de surface n'a pas la meme force qu'un point
   * d'acces explicite.
   */
  function positionPoi(v) {
    const pts = v.entryExitPoints || v.navigationPoints || [];
    const coordDe = p => {
      const g = p && (p.point || p.geometry || p);
      const c = g && (g.coordinates || g);
      return (Array.isArray(c) && typeof c[0] === 'number') ? c : null;
    };
    const principal = pts.find(p => p && p.primary);
    if (principal && coordDe(principal)) return { point: coordDe(principal), source: 'accès principal' };
    const entree = pts.find(p => p && p.entry !== false && coordDe(p));
    if (entree) return { point: coordDe(entree), source: 'point d\'accès' };
    const g = v.geometry;
    if (g && g.type === 'Point' && Array.isArray(g.coordinates)) {
      return { point: g.coordinates, source: 'position du lieu' };
    }
    return { point: null, source: 'part de surface' };
  }

  /** Sommets d'une geometrie, a plat. */
  function sommetsDe(geom) {
    const pts = [];
    if (!geom || !geom.coordinates) return pts;
    (function ap(c) { if (typeof c[0] === 'number') pts.push(c); else c.forEach(ap); })(geom.coordinates);
    return pts;
  }

  /**
   * Ce POI releve-t-il de la commune analysee ?
   * Rend `{ dedans, source, part }` — `part` n'est renseignee que dans le cas du
   * dernier recours, ou l'on a du peser une surface.
   */
  function poiDansCommune(v, commune) {
    const pos = positionPoi(v);
    if (pos.point) {
      return { dedans: pointInGeom(pos.point[0], pos.point[1], commune.geom),
               source: pos.source, part: null, point: pos.point };
    }
    // Dernier recours : la PART DE SURFACE, comme l'a demande l'auteur.
    const pts = sommetsDe(v.geometry);
    if (!pts.length) return { dedans: false, source: 'aucune géométrie', part: null, point: null };
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    // ⚠️⚠️ NE PAS approcher la surface par les SOMMETS (erreur que les tests ont
    // attrapee) : un rectangle a cheval dont 5 % de la surface seulement est dans
    // la commune peut avoir 3 sommets sur 5 dedans, soit « 60 % » — verdict
    // inverse. Et l'anneau etant FERME, le premier sommet compte deux fois.
    // On echantillonne donc une GRILLE sur la boite englobante, en ne retenant
    // que les points qui tombent dans le POI : le rapport obtenu est bien une
    // part de surface. ~144 tests de point par POI concerne, et seuls les
    // surfaciques SANS point d'acces y passent (15 sur 79 mesures).
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    const y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    const N = 12;
    let dansPoi = 0, dansCommune = 0;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const x = x0 + (i + 0.5) * (x1 - x0) / N;
        const y = y0 + (j + 0.5) * (y1 - y0) / N;
        if (!pointInGeom(x, y, v.geometry)) continue;
        dansPoi++;
        if (pointInGeom(x, y, commune.geom)) dansCommune++;
      }
    }
    // Polygone trop mince pour que la grille l'attrape : on tranche au centre.
    if (!dansPoi) {
      return { dedans: pointInGeom(cx, cy, commune.geom),
               source: 'centre du lieu', part: null, point: [cx, cy] };
    }
    const part = dansCommune / dansPoi;
    return { dedans: part > 0.5, source: 'part de surface', part, point: [cx, cy] };
  }

  /**
   * Audite les adresses des VRAIS POI d'une commune.
   *
   * `venues` vient de l'API (`app/Features`), avec les dictionnaires `streets` et
   * `cities` de la meme reponse : les noms se resolvent sans appel de plus.
   * ⚠️ Les objets de l'API ne sont PAS dans le data model (cf. [[wme-sdk-pieges]]) :
   * on ne cherche donc rien par identifiant, on fait circuler ce qu'on a lu.
   */
  function auditerPoi(venues, dicoRues, dicoVilles, commune, stats) {
    const c = options.controles;
    const out = [];
    for (const v of venues) {
      if (v.isResidential || v.residential) continue;         // les RPP ont leur propre onglet
      const cats = v.categories || [];
      // ⚠️ Elements du paysage : aucune adresse a reclamer (voir POI_CATEGORIES_NATURELLES).
      if (cats.some(x => POI_CATEGORIES_NATURELLES.has(x))) { stats.poiNaturels++; continue; }
      // ⚠️⚠️ LE BATI SANS NOM N'EST PAS UNE ADRESSE (precision de l'auteur, 26/07) :
      // « c'est courant, c'est pour visualiser sur l'ecran de l'application le
      // bati, et on traite les commerces a l'interieur avec des vrais POI, point
      // ou zone ». Une ZONE SANS NOM sert donc a dessiner un batiment ; lui
      // reclamer une rue et une commune serait un contresens. Les commerces qu'il
      // abrite sont, eux, des POI a part entiere et restent audites.
      // ⚡ Mesure a Saint-Laurent-des-Arbres : 10 des 17 ecarts venaient de ces
      // batis — ils representaient la majorite d'un onglet qui n'avait rien a
      // signaler. Un POI PONCTUEL sans nom reste signale, lui : un point sans nom
      // ne dessine rien, il n'a pas cette excuse.
      const estZone = !!(v.geometry && v.geometry.type !== 'Point');
      if (estZone && !(v.name || '').trim()) { stats.poiBati++; continue; }
      const situation = poiDansCommune(v, commune);
      if (!situation.dedans) { stats.poiHorsCommune++; continue; }
      stats.poiAudites++;

      const rue = v.streetID != null ? dicoRues[v.streetID] : null;
      const nomRue = (rue && !rue.isEmpty && rue.name) ? String(rue.name).trim() : '';
      const villeObj = rue ? dicoVilles[rue.cityID] : null;
      const ville = (villeObj && !villeObj.isEmpty && villeObj.name) ? String(villeObj.name).trim() : '';
      const numero = (v.houseNumber == null ? '' : String(v.houseNumber)).trim();
      const nom = (v.name || '').trim();

      const ecarts = [];
      // ── 1. Adresse incomplete ────────────────────────────────────────────
      if (c.poiAdresse) {
        if (v.streetID == null) {
          ecarts.push({ champ: 'adresse absente', avant: '—',
            apres: 'renseigner la rue et la commune (' + esc(commune.nom) + ')' });
        } else {
          if (!nomRue) ecarts.push({ champ: 'rue absente', avant: '—',
            apres: 'renseigner le nom de la voie' });
          if (!ville) ecarts.push({ champ: 'commune absente', avant: '—',
            apres: 'renseigner ' + esc(commune.nom) });
        }
      }
      // ── 2. Numero : controle A PART, decoche par defaut ──────────────────
      if (c.poiNumero && v.streetID != null && !numero) {
        ecarts.push({ champ: 'numéro absent', avant: '—',
          apres: 'renseigner le numéro de rue' });
      }
      // ── 3. Ville differente de la commune INSEE ───────────────────────────
      // ⚠️ Presente comme A VERIFIER, pas comme une faute : le cas mesure a
      // Saint-Laurent-des-Arbres (« Guinguette la Grange ») est sur le CHEMIN DE
      // LA PLANQUE, voie MITOYENNE des deux communes — l'adresse postale peut
      // parfaitement etre celle de la voisine. Meme prudence que pour les RPP en
      // agglomeration (v1.86). On DIT donc pourquoi le doute existe.
      if (c.poiVilleCommune && ville && ville !== commune.nom) {
        const p = situation.point;
        const d = p ? distanceALaLimite(p[0], p[1], commune) : Infinity;
        const pres = isFinite(d) && d <= 60;
        ecarts.push({ champ: 'commune à vérifier', avant: ville,
          apres: pres
            ? esc(commune.nom) + ' ? — à ' + Math.round(d) + ' m de la limite communale, ' +
              'l\'adresse de la commune voisine peut être la bonne'
            : esc(commune.nom) + ' — le lieu est dans le contour de ' + esc(commune.nom) +
              (isFinite(d) ? ', à ' + Math.round(d) + ' m de la limite' : '') });
      }

      if (!ecarts.length) { stats.poiConformes++; continue; }
      out.push({
        poi: true, cas: 'POI', segId: 'v' + v.id, venueId: String(v.id),
        // ⚠️ Un POI SANS NOM doit rester retrouvable : on met sa categorie en
        // clair a la place du nom, sinon la liste affiche dix lignes identiques
        // « ‹POI sans nom› » et l'editeur ne sait pas laquelle il regarde
        // (constate en live : 10 batiments commerciaux sans nom a
        // Saint-Laurent-des-Arbres).
        libelle: (nom || '‹sans nom : ' + libelleCategorie(cats[0]) + '›') +
                 ' — ' + (nomRue || '‹sans rue›') +
                 ' / ' + (ville || '‹sans commune›') + (numero ? ' n° ' + numero : ''),
        categorie: cats[0] || '',
        centre: situation.point ? { lon: situation.point[0], lat: situation.point[1] } : null,
        geom: v.geometry, ecarts, editable: true,
        // La provenance de la position est DITE : un verdict fonde sur une part de
        // surface n'a pas la meme force qu'un point d'acces explicite.
        doute: situation.source === 'part de surface'
          ? 'position deduite de la surface (' + Math.round((situation.part || 0) * 100) +
            ' % dans la commune) : ce POI n\'a pas de point d\'accès'
          : (situation.source !== 'accès principal'
              ? 'position prise sur : ' + situation.source : null)
      });
    }
    return out;
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
  /**
   * Calques necessaires a un travail sur la numerotation : sans eux l'editeur
   * ne VOIT ni les numeros ni les POI residentiels dont on lui parle (demande
   * de l'auteur, 22/07 — « la premiere chose a faire »).
   * ⚠️ On CLIQUE la case plutot que de forcer la propriete : dans WME seul le
   * clic sur l'item du selecteur de calques declenche le chargement des
   * donnees (deja vu sur les fermetures, cf. [[wct-closures-toolkit]]).
   * ⚠️ Le groupe « Lieux Waze » doit etre coche AUSSI : s'il ne l'est pas, les
   * POI residentiels restent invisibles meme si leur propre case est cochee.
   */
  function activerCalquesNumerotation() {
    const aCocher = ['layer-switcher-group_places',        // Lieux Waze (parent)
                     'layer-switcher-item_residential_places',
                     'layer-switcher-item_house_numbers'];
    const actives = [];
    for (const id of aCocher) {
      const e = document.getElementById(id);
      if (!e) continue;
      if (e.checked === false) { try { e.click(); actives.push(id); } catch (err) { /* */ } }
    }
    if (actives.length) log('calques activés pour la numérotation : ' + actives.join(', '));
    return actives;
  }

  async function analyserAdresses(segs, listeAgglos, stats, phases, venuesFournis, prog) {
    const c = options.controles;
    const faireHn = (!phases || phases.hn) && c.hnHorsAgglo;
    const fairePoi = (!phases || phases.poi) && c.poiAgglo;
    if (!faireHn && !fairePoi) return;
    // Avant toute chose : rendre visibles les objets qu'on va commenter.
    stats.calquesActives = activerCalquesNumerotation();
    if (stats.calquesActives.length) {
      if (prog) prog.etape('Activation des calques de numérotation', 0);
      await new Promise(r => setTimeout(r, 1200));
    }
    if (prog) prog.verifier();
    const dansAgglo = (lon, lat) => listeAgglos.some(a => pointInRings(lon, lat, [a.ring]));
    const dansCommune = (lon, lat) => pointInGeom(lon, lat, communeActive.geom);
    // ⚠️⚠️ BUG DE LA v1.83, prouve en live le 22/07 : les segments lus par
    // l'API ne sont PAS dans le modele de WME tant que la carte n'est pas
    // dessus. Aller les rechercher par `getById` rendait donc `null`, et TOUS
    // les reports de numeros perdaient leur nom de rue (« segment 150189381 »
    // au lieu de « Chemin de la Coste ») — donc plus aucune conversion
    // possible : 51 reports, 0 bouton ⚡. Le nommage est deja dans l'objet
    // fourni (`_nam`, resolu par `adapterReponseApi`) : on s'en sert d'abord,
    // et le modele ne sert plus que de repli (mode balayage).
    const parId = new Map((segs || []).map(s => [String(s.id), s]));
    const segmentDe = id => parId.get(String(id)) ||
      (() => { try { return sdk.DataModel.Segments.getById({ segmentId: id }); } catch (e) { return null; } })();

    // --- 1. Numeros de rue hors agglomeration -------------------------------
    if (faireHn) {
      const parSegment = new Map();
      try {
        // ⚠️ `fetchHouseNumbers` a une LIMITE DE LOT non documentee : mesuree en
        // live, 500 segments passent, 600 sont rejetes d'emblee (« Server
        // Response Error » en 98 ms). Une commune depasse vite ce seuil — 879
        // segments dans une vue de test — donc on tronconne. Cout : ~0,5 s par
        // lot de 250, soit une paire de secondes pour une commune entiere.
        const TAILLE_LOT = 250;
        // ⚠️ On analyse TOUS les types, y compris les voies privees et les
        // parkings : un numero mal place s'y voit aussi, et l'editeur veut le
        // savoir (arbitrage de l'auteur, 21/07 : « on doit quand meme pouvoir
        // detecter les ecarts sur les voies privees, on inhibe juste la
        // correction auto »). C'est la CORRECTION qui est fermee sur ces types,
        // pas la detection — voir `planDeCorrection`.
        const tousIds = segs.map(s => s.id);
        const hns = [];
        const nbLots = Math.ceil(tousIds.length / TAILLE_LOT);
        if (prog && nbLots > 1) prog.etape('Lecture des numéros de rue', nbLots);
        for (let i = 0; i < tousIds.length; i += TAILLE_LOT) {
          if (prog) { prog.verifier(); if (nbLots > 1) prog.fixer(i / TAILLE_LOT + 1); }
          const lot = await sdk.DataModel.HouseNumbers.fetchHouseNumbers(
            { segmentIds: tousIds.slice(i, i + TAILLE_LOT) });
          hns.push(...lot);
        }
        stats.hnLus += hns.length;
        for (const hn of hns) {
          // Les cellules du balayage se chevauchent : un meme numero peut
          // remonter deux fois.
          if (stats.hnVus && stats.hnVus.has(hn.id)) continue;
          if (stats.hnVus) stats.hnVus.add(hn.id);
          const p = hn.geometry && hn.geometry.coordinates;
          if (!p) continue;
          if (!dansCommune(p[0], p[1])) { stats.hnHorsCommune++; continue; }
          if (dansAgglo(p[0], p[1])) continue;                 // a sa place
          if (!parSegment.has(hn.segmentId)) parSegment.set(hn.segmentId, []);
          parSegment.get(hn.segmentId).push(hn);
        }
      } catch (e) {
        if (e && e.annulation) throw e;      // une interruption n'est pas une panne
        log('lecture des numéros de rue impossible', e);
        stats.hnErreur = e.message || String(e);
      }

      // ⚠️⚠️ UN REPORT PAR NUMERO, jamais par segment (demande de l'auteur,
      // 22/07). Grouper les numeros d'un meme segment faisait convertir
      // plusieurs POI d'un coup : ils se retrouvaient tous selectionnes
      // ensemble, et il devenait impossible d'en editer UN SEUL — or on
      // enchaine justement sur le point d'entree, POI par POI.
      for (const [segId, liste] of parSegment) {
        const seg = segmentDe(segId);
        const nam = seg ? readNaming(seg) : null;
        const rue = rueDuPoi(nam);
        const nomVoie = nam ? fmt(nam.primary) : 'segment ' + segId;
        const sansAdressage = seg ? REF.typesSansAdresse.has(seg.roadType) : false;
        stats.hnHorsAgglo += liste.length;
        for (const h of liste) {
        findings.push({
          adresse: true, sousType: 'hn', cas: 'HN-H', segId,
          // Cle unique du report : deux numeros d'un meme segment partagent le
          // segId, il faut autre chose pour les distinguer (feature de carte,
          // infobulle, ligne de liste).
          hnId: h.id,
          libelle: nomVoie + ' — n° ' + h.number,
          roadType: seg ? seg.roadType : null,
          // Voie privee, parking… : l'ecart se signale, mais la conversion
          // automatique reste fermee (arbitrage de l'auteur).
          typeSansAdressage: sansAdressage,
          nbPoints: 1,
          hns: [{ id: h.id, number: h.number, geometry: h.geometry }],
          geom: h.geometry,
          centre: (p => ({ lon: p[0], lat: p[1] }))(centreGeom(h.geometry)),
          rueCible: rue,
          ecarts: [{ champ: 'numéro hors agglo',
                     avant: 'n° ' + h.number + ' porte par le segment',
                     apres: !rue ? 'à passer en POI résidentiel'
                       : rue.saisieRequise ? 'à passer en POI résidentiel — adresse à saisir à la conversion'
                       : rue.ambigu ? 'à passer en POI résidentiel — adresse à choisir à la conversion'
                       : 'à passer en POI résidentiel — ' + rue.nom + ' / ' + rue.ville }],
          doute: !rue
            ? 'aucune adresse exploitable sur ce segment : la rue du POI ne peut pas être determinee'
            : rue.saisieRequise
              ? 'ce segment ne porte qu\'un numéro de route : le nom du POI sera demandé à la conversion'
              : rue.plusieursNoms
              ? 'plusieurs noms de rue sur ce segment (' +
                rue.candidats.map(c => c.nom).join(', ') + ') : le choix sera demandé'
              : rue.ambigu
                ? 'voie en limite communale (' + rue.candidats[0].villes.join(', ') +
                  ') : la commune de chaque numéro sera demandée'
                : rue.villeSeg
                  ? 'le segment porte la ville « ' + rue.villeSeg + ' » alors que le contour donne « ' +
                    communeActive.nom + ' » : c\'est la commune INSEE qui est appliquée au POI'
                  : null
        });
        }
      }
    }

    // --- 2. POI residentiels en agglomeration -------------------------------
    if (fairePoi) {
      // Voie rapide : les POI arrivent avec les donnees (`venuesFournis`).
      // Sinon on retombe sur ce que le modele a bien voulu charger.
      let venues = [];
      if (venuesFournis) venues = venuesFournis.filter(v => v.isResidential);
      else {
        try { venues = sdk.DataModel.Venues.getAll().filter(v => v.isResidential); }
        catch (e) { log('lecture des POI impossible', e); }
      }
      stats.poiLus += venues.length;
      for (const v of venues) {
        if (stats.poiVus && stats.poiVus.has(v.id)) continue;   // cellules qui se recouvrent
        if (stats.poiVus) stats.poiVus.add(v.id);
        const p = centreGeom(v.geometry);
        if (!p) continue;
        if (!dansCommune(p[0], p[1])) continue;
        if (!dansAgglo(p[0], p[1])) continue;                  // a sa place
        let num = '', rueNom = '';
        if (v._adr) {
          num = v._adr.houseNumber || '';
          rueNom = (v._adr.street && v._adr.street.name) || '';
        } else {
          try { const a = sdk.DataModel.Venues.getAddress({ venueId: String(v.id) });
                num = (a && a.houseNumber) || '';
                rueNom = (a && a.street && a.street.name) || ''; } catch (e) { /* */ }
        }
        stats.poiAgglo++;
        findings.push({
          adresse: true, sousType: 'poi', cas: 'POI-C', segId: 'v' + v.id,
          libelle: (v.name || 'POI résidentiel') + (num ? ' — n° ' + num : ''),
          roadType: null, nbPoints: 1,
          geom: { type: 'Point', coordinates: p },
          centre: { lon: p[0], lat: p[1] }, venueId: String(v.id),
          // On n'annonce PAS une correction a appliquer — on pose la question :
          // en agglomeration le numero va sur le segment, sauf si l'entree
          // donne sur une autre voie. Ecrire « a passer sur le segment »
          // ferait corriger a tort les cas ou le POI a justement raison.
          ecarts: [{ champ: 'POI résidentiel en agglo',
                     avant: num ? 'n° ' + num + ' porte par un POI résidentiel' : 'POI résidentiel sans numéro',
                     apres: 'à trancher : numéro sur le segment, ou entrée sur une autre voie' }],
          // ⚠️⚠️ CE REPORT N'EST PAS UN DEFAUT A CORRIGER : c'est une question a
          // trancher sur place, et les deux reponses sont bonnes.
          // ⚠️ LA raison qui justifie de garder le POI (precisee par l'auteur le
          // 22/07) : **l'adresse postale est sur une rue, mais l'entree — la
          // boite aux lettres — donne sur une AUTRE voie.** Un numero porte par
          // un segment ne sait exprimer qu'une adresse sur SA voie ; le POI
          // residentiel est alors le seul moyen de dire la verite du terrain.
          // ⚠️ Le sens POI → numero n'est pas automatise, et ce n'est pas une
          // limite du SDK (`addHouseNumber` et `deleteVenue` existent) : le
          // script ne sait dire ni sur QUEL segment ni a QUEL endroit poser le
          // numero, et supprimer le POI emporterait son nom, son point d'entree
          // et ses photos. On guide donc l'editeur au lieu de decider pour lui.
          aideTitre: 'Deux issues possibles — c\'est le terrain qui tranche',
          aide: [
            'Si l\'entrée (la boite aux lettres) donne bien sur ' +
              (rueNom ? '« ' + rueNom + ' »' : 'la rue de l\'adresse') +
              ' : le numéro doit passer sur le segment. Sélectionné la voie, ouvre ' +
              '« Ajouter des numéros de rue », pose' + (num ? ' le n° ' + num : ' le numéro') +
              ' du bon côté, vérifie qu\'il tombe devant l\'entrée, puis supprime ce POI.',
            'Si l\'entrée donne sur une AUTRE voie que l\'adresse postale : laisse le POI en place. ' +
              'C\'est précisément ce qu\'il sert à dire, et un numéro sur segment ne saurait pas ' +
              'l\'exprimer. Marque la ligne comme traitée (✓) pour ne pas la revoir.'
          ],
          doute: null
        });
      }
    }
  }

  // ===========================================================================
  // BALAYAGE — parcourir la commune en damier plutot que de se contenter de la
  // vue courante.
  //
  // ⚠️⚠️ LE ZOOM 16 EST IMPOSE, mesure en live le 2026-07-22 : c'est le premier
  // auquel WME charge TOUT. Aux zooms inferieurs il ne descend que les axes
  // principaux (zoom 15 : 47 segments manquants sur 76 ; zoom 14 : 165 sur
  // 208), donc justement pas les rues residentielles qui portent les numeros.
  // Un balayage plus large serait plus rapide, et faux.
  // ===========================================================================
  // ===========================================================================
  // LECTURE DIRECTE — la voie rapide
  //
  // WME peuple sa carte via `app/Features?bbox=...`. Cet appel prend une bbox
  // ARBITRAIRE et ne depend pas du zoom : une seule requete rend toute la
  // commune. Mesure sur la commune de test (2026-07-22) :
  //   API      : 1 appel de 314 ms → 1607 segments, 32 POI residentiels
  //   balayage : 15 deplacements de carte, 88 s, et AUCUN POI residentiel
  //              (le zoom 16 ne les descend pas)
  // Soit ~55x plus rapide, complet, et sans bouger la carte de l'editeur.
  //
  // ⚠️ C'est une API INTERNE, pas le SDK : elle peut changer sans preavis. D'ou
  // le repli automatique sur le balayage, et un message explicite pour que
  // l'auteur sache que la voie rapide est tombee (demande du 22/07).
  // ⚠️ Le prefixe d'environnement n'est PAS en dur : `W.Config.paths.features`
  // le donne (`/row-Descartes/app/Features` ici, autre chose sur NA).
  // ===========================================================================

  /** Etat de la derniere collecte : sert au bandeau et aux statistiques. */
  let sourceDonnees = { mode: null, raison: null };

  async function chargerParApi(bbox) {
    const chemin = hote.W && hote.W.Config && hote.W.Config.paths && hote.W.Config.paths.features;
    if (!chemin) throw new Error('chemin de l\'API introuvable (W.Config.paths.features)');
    const p = new URLSearchParams({
      bbox: bbox.join(','), language: 'fr', v: '2', apiV2: 'true',
      roadTypes: '1,2,3,4,5,6,7,8,9,10,15,16,17,18,19,20,22',
      venueLevel: '4', venueFilter: '1,1,1,0', zoomLevel: '18'
    });
    const res = await fetch(chemin + '?' + p.toString(), { credentials: 'same-origin' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    if (!j || !j.segments || !j.segments.objects) throw new Error('reponse inattendue');
    return adapterReponseApi(j);
  }

  /**
   * Transforme la reponse brute en objets de la meme forme que ceux du SDK,
   * pour que le moteur d'analyse n'ait pas a savoir d'ou viennent les donnees.
   * Les noms se resolvent par les dictionnaires `streets` / `cities` livres
   * dans la meme reponse — pas d'appel supplementaire.
   */
  function adapterReponseApi(j) {
    const rues = {}; (j.streets && j.streets.objects || []).forEach(r => { rues[r.id] = r; });
    const villes = {}; (j.cities && j.cities.objects || []).forEach(v => { villes[v.id] = v; });
    const entree = id => {
      const r = rues[id];
      if (!r) return { name: '', cityName: '', signText: '', signType: null };
      const v = villes[r.cityID];
      return { name: (r.isEmpty || !r.name) ? '' : r.name,
               cityName: (!v || v.isEmpty || !v.name) ? '' : v.name,
               signText: r.signText || '', signType: r.signType != null ? r.signType : null };
    };
    // Rang de l'editeur : sert a deduire l'editabilite sans `hasPermissions`,
    // indisponible sur un objet qui n'est pas dans le modele.
    const rang = (() => { try { return _fp().n; } catch (e) { return -1; } })();
    const segments = (j.segments.objects || []).map(s => ({
      id: s.id, roadType: s.roadType, geometry: s.geometry,
      junctionId: s.junctionID != null ? s.junctionID : null,
      lockRank: s.lockRank || 0,
      hasHNs: !!s.hasHNs,
      // ⚠️ Approximation assumee : le verrou se compare au rang. La verification
      // ferme se refait de toute facon a l'ecriture, sur l'objet charge.
      editable: rang < 0 ? true : (s.lockRank || 0) <= rang,
      _nam: { primary: entree(s.primaryStreetID),
              primaryId: s.primaryStreetID != null ? s.primaryStreetID : null,
              alts: (s.streetIDs || []).filter(x => x).map(entree) }
    }));
    const venues = (j.venues && j.venues.objects || []).map(v => ({
      id: v.id, isResidential: !!v.residential, geometry: v.geometry,
      // ⚠️ Champs necessaires a l'audit des VRAIS POI (v2.15) : sans eux, seuls
      // les RPP etaient exploitables. `entryExitPoints` porte le point d'acces,
      // et c'est LUI qui dit de quelle commune releve un POI surfacique.
      name: v.name || '', streetID: v.streetID != null ? v.streetID : null,
      houseNumber: v.houseNumber == null ? '' : v.houseNumber,
      categories: v.categories || [],
      entryExitPoints: v.entryExitPoints || [],
      _adr: { houseNumber: v.houseNumber || '',
              street: rues[v.streetID] ? { name: rues[v.streetID].name } : null,
              city: (rues[v.streetID] && villes[rues[v.streetID].cityID])
                ? { name: villes[rues[v.streetID].cityID].name } : null }
    }));
    // Les dictionnaires suivent : `auditerPoi` en a besoin pour resoudre rue et
    // commune sans un appel de plus (et les objets de l'API ne sont pas dans le
    // data model, donc rien ne se retrouve par identifiant).
    return { segments, venues, rues, villes };
  }

  const ZOOM_BALAYAGE = 16;
  // ⚠️ Les POI residentiels ne descendent qu'a partir du zoom 17 (WME les sert
  // en `venueLevel=4`) : au zoom 16 on n'en voit aucun. Mesure en live.
  const ZOOM_POI = 17;
  const RECOUVREMENT = 0.85;     // les cellules se chevauchent : pas de couture manquee

  /** Cellules couvrant les polygones d'agglomeration, pour la passe POI. */
  function cellulesPourAgglos(listeAgglos) {
    const v = sdk.Map.getMapExtent();
    // A zoom egal la vue depend de la fenetre : on deduit la taille d'une
    // cellule de zoom 17 à partir de la vue courante, puis on l'ajuste.
    const facteur = Math.pow(2, sdk.Map.getZoomLevel() - ZOOM_POI);
    const largeur = (v[2] - v[0]) * facteur * RECOUVREMENT;
    const hauteur = (v[3] - v[1]) * facteur * RECOUVREMENT;
    const cellules = [];
    for (const a of listeAgglos) {
      const xs = a.ring.map(p => p[0]), ys = a.ring.map(p => p[1]);
      const x1 = Math.min(...xs), x2 = Math.max(...xs);
      const y1 = Math.min(...ys), y2 = Math.max(...ys);
      const cols = Math.max(1, Math.ceil((x2 - x1) / largeur));
      const lignes = Math.max(1, Math.ceil((y2 - y1) / hauteur));
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < lignes; j++) {
          cellules.push({ lon: x1 + (i + 0.5) * ((x2 - x1) / cols),
                          lat: y1 + (j + 0.5) * ((y2 - y1) / lignes) });
        }
      }
    }
    return cellules;
  }

  /** Decoupe la commune en cellules, en ne gardant que celles qui la touchent. */
  async function preparerBalayage() {
    // La taille d'une cellule depend de la fenetre : on la MESURE au lieu de la
    // supposer (un ecran large couvre plus de terrain a zoom egal).
    const centreCommune = centreDe(bboxCentreCoords(communeActive.bbox));
    sdk.Map.setMapCenter({ lonLat: centreCommune, zoomLevel: ZOOM_BALAYAGE });
    await new Promise(r => setTimeout(r, 1500));
    const v = sdk.Map.getMapExtent();
    const largeur = (v[2] - v[0]) * RECOUVREMENT;
    const hauteur = (v[3] - v[1]) * RECOUVREMENT;
    const [x1, y1, x2, y2] = communeActive.bbox;
    const cols = Math.max(1, Math.ceil((x2 - x1) / largeur));
    const lignes = Math.max(1, Math.ceil((y2 - y1) / hauteur));
    const cellules = [];
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < lignes; j++) {
        const cx = x1 + (i + 0.5) * ((x2 - x1) / cols);
        const cy = y1 + (j + 0.5) * ((y2 - y1) / lignes);
        // Une commune n'est pas un rectangle : on saute les cellules qui
        // tombent entierement hors du contour, ca economise des passes.
        if (celluleTouche(cx, cy, (x2 - x1) / cols, (y2 - y1) / lignes)) {
          cellules.push({ lon: cx, lat: cy });
        }
      }
    }
    return cellules;
  }

  const bboxCentreCoords = b => [[(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]];

  /** La cellule recoupe-t-elle le contour communal ? */
  function celluleTouche(cx, cy, dx, dy) {
    const pts = [[cx, cy], [cx - dx / 2, cy - dy / 2], [cx + dx / 2, cy - dy / 2],
                 [cx - dx / 2, cy + dy / 2], [cx + dx / 2, cy + dy / 2]];
    if (pts.some(p => pointInGeom(p[0], p[1], communeActive.geom))) return true;
    // Contour tres decoupe : un sommet de la commune peut tomber dans la
    // cellule sans qu'aucun coin de celle-ci ne soit dans la commune.
    const dedans = (x, y) => x >= cx - dx / 2 && x <= cx + dx / 2 && y >= cy - dy / 2 && y <= cy + dy / 2;
    let touche = false;
    (function creuser(co) {
      if (touche || !Array.isArray(co)) return;
      if (typeof co[0] === 'number') { if (dedans(co[0], co[1])) touche = true; return; }
      co.forEach(creuser);
    })(communeActive.geom.coordinates);
    return touche;
  }

  /**
   * Attend que WME ait fini de descendre les objets de la cellule : on guette
   * la stabilisation du nombre de segments plutot qu'un delai fixe, qui serait
   * soit trop court sur une zone dense, soit du temps perdu ailleurs.
   */
  async function attendreChargement(prog) {
    // ⚠️ Plafond en TEMPS REEL, jamais en nombre d'iterations : Chrome BRIDE
    // les minuteries d'un onglet en arriere-plan (mesure : un `setTimeout(300)`
    // rend la main apres 965 ms, et ca se degrade au-dela de 5 min). Compter
    // les tours faisait donc durer une cellule 30 s au lieu de 9 des que
    // l'editeur changeait d'onglet — et le balayage n'en finissait plus.
    const limite = Date.now() + 9000;
    let precedent = -1, stable = 0;
    while (Date.now() < limite) {
      await new Promise(r => setTimeout(r, 300));
      // ⚠️ MESURE : sans ce controle ici, « Annuler » mettait jusqu'a 9 s a
      // prendre effet (7 s mesurees en live) — l'editeur croit son clic perdu
      // et reclique. Une attente longue doit se rompre, pas seulement se
      // signaler.
      if (prog) prog.verifier();
      const n = sdk.DataModel.Segments.getAll().length;
      if (n === precedent) { stable++; if (stable >= 3 && n > 0) return n; }
      else { stable = 0; precedent = n; }
    }
    return precedent;
  }

  async function scan() {
    // ⚠️⚠️ Garde-fou territorial AVANT tout le reste (v2.03) : les regles sont
    // francaises. On reevalue ici plutot que de se fier a l'etat memorise — la
    // carte a pu bouger depuis le dernier controle.
    if (evaluerPays().etat !== 'fr') {
      ui.stats.innerHTML = '<div class="agn-stat agn-alerte">' + messagePays() + '</div>';
      ui.results.innerHTML = ''; return;
    }
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
        <b>Aucune agglomération tracée pour ${esc(communeActive.nom)}.</b><br>
        Sans polygone, toute la commune serait tenue pour hors agglomération et
        l'analyse remonterait des écarts qui n'existent pas.<br>
        Trace l'agglomération (bouton ci-dessus), ou coche
        <b>« commune sans agglomération »</b> si elle n'en a réellement aucune.</div>`;
      ui.results.innerHTML = '';
      replierSection('agglo', true);
      return;
    }

    // `pays` vient d'etre reevalue en tete de fonction : on lit son nom, sans
    // relancer une detection.
    choisirReferentiel(pays.nom || pays.code);
    replierTout();                 // l'analyse prend toute la place
    findings = [];
    const skipped = { horsRegle: 0, sansAdresse: 0, horsCommune: 0, sansGeom: 0 };
    const zones = { agglo: 0, hors: 0, cheval: 0, limCom: 0, limitrophe: 0, cartouche: 0, special: 0, giratoire: 0,
                    // `mitoyen` : voies qui epousent la limite communale — aucune
                    // coupe a faire. Comptees pour qu'on VOIE que le script les a
                    // examinees plutot que de les taire. `mitoyenSansVille` en
                    // isole celles qui ne portent pas notre commune : hors agglo
                    // c'est normal, en agglo cela meriterait un coup d'œil.
                    mitoyen: 0, mitoyenSansVille: 0, villes: new Map() };
    const c = options.controles;
    const dejaVus = new Set();     // un segment vu dans deux cellules ne compte qu'une fois
    // Cartouche sur le nom principal : jugement de VOIE, pas de segment. On
    // recense chaque voie (par id de Street principale) et l'etat de tous ses
    // segments, puis on tranche apres l'analyse (voir cartouchesPrincipal).
    const cartInfo = new Map();

    /**
     * Analyse les segments d'une cellule. Appelee une fois par cellule du
     * balayage : les objets ne sont exploitables que TANT QU'ILS SONT CHARGES,
     * d'ou une analyse au fil de l'eau plutot qu'une collecte puis un calcul.
     */
    async function analyserSegments(segs, prog) {
    for (const seg of segs) {
      // ⚠️ Point de controle OBLIGATOIRE : sans lui cette boucle tient la main
      // ~25 s d'affilee (1607 segments), la barre reste figee et le bouton
      // Annuler ne repond pas. `respirer()` ne rend la main que toutes les
      // 120 ms — le surcout est negligeable devant le calcul.
      if (prog) { await prog.respirer(); prog.avance(); }
      if (dejaVus.has(seg.id)) continue;
      dejaVus.add(seg.id);
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
      // ⚠️ L'editabilite se releve MAINTENANT, pendant que le segment est
      // charge : apres le balayage la carte sera revenue ailleurs et
      // `hasPermissions` ne repondrait plus.
      // ⚠️⚠️ NE PAS INTERROGER LE MODELE SUR UN OBJET VENU DE L'API : il n'y
      // est pas, `hasPermissions` leve `DataModelNotFoundError`, le catch
      // rendait `false` et le script annoncait « verrouille au-dessus de ton
      // niveau » sur un segment L1 a un editeur L6 (signale par l'auteur sur
      // le 332839183). Pire : le bouton de correction disparaissait avec.
      // L'objet de l'API porte deja son editabilite (lockRank vs rang) ;
      // `hasPermissions` ne sert que pour le balayage, ou l'objet EST charge.
      const base = { segId: seg.id, roadType: seg.roadType, libelle: fmt(nam.primary),
                     centre: centreDe(coords), geom: seg.geometry,
                     editable: seg.editable !== undefined ? seg.editable : (() => { try {
                       return sdk.DataModel.Segments.hasPermissions({ segmentId: seg.id });
                     } catch (e) { return false; } })() };
      const forme = REF.verifierForme(nam);

      // --- Type de voie : determine ICI, avant toute branche, parce que le
      //     garde-fou « ville sans polygone » juste en dessous en a besoin ---
      const estRail = REF.typesSansAdresseTotale.has(seg.roadType);      // rail, piste, ferry
      const estBretelle = seg.roadType === REF.typeBretelle;
      const estRocade = REF.estRocade(nomsBruts);
      const enAgglo = loc.partAgglo >= haut;

      // ⚠️⚠️ GARDE-FOU « VILLE SANS POLYGONE » — VILLE PORTEE PAR LE NOM
      // PRINCIPAL = « ce segment se dit en agglomeration ». C'est la regle FR :
      // en agglomeration la ville est renseignee sur le principal, hors
      // agglomeration le principal n'en a pas. On tient donc le compte, par
      // ville, des segments qui l'annoncent et de ceux qui tombent vraiment dans
      // un polygone (voir `villesSansPolygone`).
      //
      // ⚠️⚠️ LE COMPTAGE EST FAIT AVANT LES BRANCHES (corrige en v2.10, trouve par
      // l'audit). Il etait place tout en bas, APRES les `continue` du giratoire,
      // des voies a regle propre et des zones grises : un GIRATOIRE portant la
      // ville n'etait donc JAMAIS compte. Consequence exacte que ce garde-fou est
      // censé empecher : dans un village dont le polygone manque, le rond-point
      // se voyait reclamer le RETRAIT de sa ville — une correction a l'envers —
      // et aucune alerte ne se declenchait.
      //
      // ⚠️ Les voies a regle propre (rail, bretelle, rocade) sont EXCLUES : elles
      // ne doivent jamais porter de ville, quelle que soit la zone. Y voir une
      // « declaration d'agglomeration » produirait de fausses alertes sur une
      // simple bretelle mal nommee.
      const villePrincipale = nam.primary && nam.primary.cityName;
      if (villePrincipale && !estRail && !estBretelle && !estRocade) {
        let v = zones.villes.get(villePrincipale);
        if (!v) { v = { total: 0, dansPolygone: 0 }; zones.villes.set(villePrincipale, v); }
        v.total++;
        if (enAgglo) v.dansPolygone++;
      }

      // --- Giratoire : reconnu par son junctionId, quelle que soit la zone ---
      if (seg.junctionId != null && c.giratoires) {
        // ⚠️⚠️ La ville passe par `REF.villeAgglo`, PAS par `communeActive.nom` en
        // dur (corrige en v2.11) : dans un VILLAGE RATTACHE, la ville attendue est
        // « Village (Commune) », comme pour les rues alentour. Mesure a Gruissan :
        // 22 giratoires portaient deja correctement « Les Ayguades (Gruissan) » ou
        // « Gruissan-Plage (Gruissan) », et le script reclamait « Gruissan » — il
        // DEGRADAIT 22 nommages justes.
        const va = enAgglo ? REF.villeAgglo(nam, loc.agglo, communeActive.nom)
                           : { ville: '', doute: null };
        const villeG = va.ville;
        const ecartsG = verifierGiratoire(nam, villeG).concat(forme);
        if (!ecartsG.length) continue;
        zones.giratoire++;
        findings.push(Object.assign({}, base, {
          cas: 'GIR', ecarts: ecartsG, special: true, doute: va.doute,
          cible: { primary: { name: '', cityName: villeG }, alts: [] }
        }));
        continue;
      }
      if (seg.junctionId != null && !c.giratoires) { skipped.horsRegle++; continue; }

      // --- Voies a regle propre : elles sortent du raisonnement agglo ---
      // (les trois drapeaux sont calcules plus haut, pour le garde-fou)
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
          doute: estRocade ? 'identifiée comme rocade d\'après son nom' : null }));
        continue;
      }

      // Recensement pour le cartouche-sur-principal : tout segment de voie
      // ordinaire (ni giratoire, ni rail/bretelle/rocade) dont le principal est
      // un vrai nom de rue. On note quels cartouches de route il porte en alt.
      //
      // ⚠️⚠️ SAUF EN AGGLOMERATION (regle rappelee par l'auteur le 26/07, qui
      // ANNULE le comportement de la v1.92) : « officiellement, en agglo, on ne
      // met AUCUN cartouche sur le nom de rue en principal, peu importe qu'il
      // existe ou non en Alt ». Ce n'etait donc pas un ecart a signaler, mais une
      // correction qui aurait ABIME le nommage. On ne recense plus ces voies —
      // ni report, ni proposition, ni bouton.
      if (!enAgglo) collecterCartouche(seg, nam, base);

      // Zone grise sur la limite COMMUNALE : il faut couper avant de nommer,
      // le bon nommage depend de l'endroit de la coupe.
      if (loc.partCommune < haut) {
        // ⚠️⚠️ SAUF si la voie EPOUSE la limite : route MITOYENNE, chaque commune
        // en possede un cote, IL N'Y A RIEN A COUPER (retour terrain de l'auteur,
        // vecu a Saint-Michel-d'Euzet). On ne fait ce calcul QUE dans la zone
        // grise : il coute une distance a la frontiere par point, inutile sur les
        // segments francs.
        const partLimite = partLeLongDeLaLimite(coords, communeActive);
        if (partLimite >= haut) {
          // ⚠️⚠️ On ne signale PAS de coupe, mais on NE SAUTE PAS le segment : il
          // doit rester audite sur son NOM. Deux controles distincts, deux
          // verdicts — confondre « faut-il couper ? » et « est-ce bien nomme ? »
          // ferait disparaitre ces voies de l'audit.
          // ⚡ MESURE a Saint-Michel-d'Euzet (26/07) : les 3 segments concernes
          // longent la limite a 100 % et ne portent AUCUNE ville — ce qui est le
          // nommage ATTENDU hors agglomeration (le principal n'a pas de ville).
          // Exiger que la commune soit portee les aurait donc tous rejetes : la
          // superposition suffit a ecarter la coupe, le nom est juge apres.
          zones.mitoyen++;
          if (!communePortee(nam, communeActive.nom)) zones.mitoyenSansVille++;
        } else {
          zones.limCom++;
          findings.push(Object.assign({}, base, { cas: 'LIM', doute: null, ecarts: [{
            champ: 'limite communale',
            avant: pourcent(loc.partCommune) + ' dans ' + communeActive.nom +
                   (partLimite > bas ? ' · longe la limite sur ' + pourcent(partLimite) : ''),
            // La coupe se justifie la ou la superposition CESSE, pas n'importe ou.
            apres: partLimite > bas
              ? 'à couper là où la voie quitte la limite communale'
              : 'à couper sur la limite communale' }] }));
          continue;
        }
      }

      // Zone grise sur la limite d'AGGLO : idem, coupure au panneau EB10.
      if (loc.partAgglo > bas && loc.partAgglo < haut) {
        zones.cheval++;
        findings.push(Object.assign({}, base, { cas: 'EB10', doute: null, ecarts: [{
          champ: 'limite d\'agglo',
          avant: pourcent(loc.partAgglo) + ' dans l\'agglomération',
          apres: 'à couper au panneau d\'entrée d\'agglomération (EB10)' }] }));
        continue;
      }

      // `enAgglo` et le comptage des villes sont faits plus haut, avant les
      // branches : ici on ne totalise plus que les voies ORDINAIRES analysees.
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
      // Dit AVANT le clic qu'une question viendra : l'editeur choisit d'y
      // aller en connaissance de cause, au lieu d'etre surpris par une modale.
      // ⚠️ Ce texte entre dans la cle de regroupement : deux segments dont les
      // candidats different ne seront donc pas fondus dans le meme report.
      if (exp.candidatsPrincipal && exp.candidatsPrincipal.length > 1) {
        notes.push('plusieurs noms possibles en principal (' +
          exp.candidatsPrincipal.map(c => c.nom).join(', ') +
          ') : le choix sera demandé à la correction');
      }
      // ⚠️⚠️ DEBORDEMENTS : en METRES, et pas en dessous du bruit de trace.
      // « déborde de 0 % sur la commune voisine » ne disait rien (signalé par
      // l'auteur, 26/07). Mesure de son exemple, le segment 481514185 : 788 m de
      // long, débordement de 0,5 m — soit 0,068 %, arrondi à « 0 % ». Ce n'est
      // pas un débordement, c'est l'écart normal entre le contour INSEE et le
      // tracé de Waze, tous deux au mètre près.
      // ⚠️ Un seuil en POURCENTAGE ne peut pas trancher : 2 % font 0,5 m sur un
      // tronçon de 25 m et 60 m sur une départementale de 3 km. On raisonne donc
      // en mètres — et on l'AFFICHE en mètres, parce que « déborde de 45 m » se
      // vérifie sur la carte, « 2 % » non.
      const longM = (loc.longueurDeg || 0) * 111320;
      const enMetres = part => Math.round(part * longM);
      const dCommune = enMetres(1 - loc.partCommune);
      const dAgglo = enMetres(enAgglo ? 1 - loc.partAgglo : loc.partAgglo);
      if (dCommune >= SEUIL_DEBORD_M) notes.push('déborde de ' + dCommune + ' m sur la commune voisine');
      if (enAgglo && dAgglo >= SEUIL_DEBORD_M) notes.push('déborde de ' + dAgglo + ' m hors de l\'agglomération');
      if (!enAgglo && dAgglo >= SEUIL_DEBORD_M) notes.push('mord de ' + dAgglo + ' m sur l\'agglomération');
      if (dCommune >= SEUIL_DEBORD_M || dAgglo >= SEUIL_DEBORD_M) zones.limitrophe++;

      findings.push(Object.assign({}, base, { cas: exp.cas, ecarts, cible: exp,
        // Un segment dont le SEUL defaut est un cartouche absent, ou une faute
        // de redaction, merite sa propre couleur : le zonage, lui, est bon.
        seulementCartouche: ecartsCart.length > 0 && ecartsNom.length === 0 && !forme.length,
        seulementForme: forme.length > 0 && !ecartsNom.length && !ecartsCart.length,
        doute: notes.length ? notes.join(' ; ') : null }));
    }
    }   // fin analyserSegments

    /**
     * Recense un segment de voie ordinaire pour le jugement cartouche-principal.
     * On retient, PAR VOIE (id de Street principale) : son nom, sa ville, si le
     * principal porte deja un cartouche, et — pour chaque segment — les
     * cartouches de route qu'il porte en alternatif (Dxx/Nxx/Cxx AVEC cartouche,
     * JAMAIS les autoroutes : « ca vaut pour tout sauf les Axxx », auteur 23/07).
     */
    function collecterCartouche(seg, nam, base) {
      const p = nam.primary;
      if (!p.name || estNumero(p) || nam.primaryId == null) return;   // principal = vrai nom de rue
      const sid = nam.primaryId;
      let g = cartInfo.get(sid);
      if (!g) { g = { streetId: sid, name: p.name, city: p.cityName,
                      dejaCartouche: !sansCartouche(p), segs: [] }; cartInfo.set(sid, g); }
      const shields = nam.alts
        .filter(a => estNumero(a) && !RE_AUTOROUTE.test((a.name || '').trim()) && !sansCartouche(a))
        .map(a => ({ key: a.signText + '|' + a.signType, signText: a.signText,
                     signType: a.signType, name: a.name }));
      g.segs.push({ segId: seg.id, geom: seg.geometry, centre: base.centre,
                    editable: base.editable, roadType: seg.roadType, shields });
    }

    /**
     * Apres l'analyse : pour chaque voie recensee, le cartouche du numero de
     * route peut passer sur le nom principal SEULEMENT si TOUS ses segments
     * portent le MEME Dxx-cartouche en alternatif. Si un seul ne l'a pas, la
     * voie n'est que partiellement cette route : on n'ajoute rien (sinon le
     * cartouche, pose sur la Street partagee, deborderait sur les segments qui
     * ne sont pas la route). Rend des reports deja groupes (un par voie).
     */
    function cartouchesPrincipal() {
      const out = [];
      for (const g of cartInfo.values()) {
        if (g.dejaCartouche || !g.segs.length) continue;
        // Regle de l'auteur : au moins un segment sans Dxx-cartouche ⇒ rien.
        if (g.segs.some(s => !s.shields.length)) continue;
        // Cartouche commun a TOUS les segments (intersection), et unique.
        let inter = g.segs[0].shields.map(x => x.key);
        for (const s of g.segs.slice(1)) inter = inter.filter(k => s.shields.some(x => x.key === k));
        if (new Set(inter).size !== 1) continue;      // aucun commun, ou plusieurs ⇒ on s'abstient
        const sh = g.segs[0].shields.find(x => x.key === inter[0]);
        const editables = g.segs.map(s => s.editable);
        out.push({
          cas: 'CART', seulementCartouche: true, roadType: g.segs[0].roadType,
          libelle: fmt({ name: g.name, cityName: g.city }),
          segId: g.segs[0].segId, segIds: g.segs.map(s => s.segId),
          geoms: g.segs.map(s => s.geom), geom: g.segs[0].geom,
          centres: g.segs.map(s => s.centre), centre: g.segs[0].centre,
          editables, editable: editables.some(Boolean),
          nb: g.segs.length, disperse: false,
          verrouilles: editables.filter(x => x === false).length,
          cartouche: { streetId: g.streetId, signText: sh.signText, signType: sh.signType },
          ecarts: [{ champ: 'cartouche (principal)',
                     avant: g.name + ' sans cartouche',
                     apres: 'poser le cartouche ' + sh.signText + ' sur le nom principal' }],
          doute: 's\'applique à toute la voie « ' + g.name + ' » (' + g.segs.length +
                 ' segment' + (g.segs.length > 1 ? 's' : '') + ') : le cartouche est porte par la rue, pas par un segment'
        });
      }
      return out;
    }

    // Les adresses sont analysees a part : lecture serveur, et objets ponctuels.
    const statsAdr = { hnLus: 0, hnHorsAgglo: 0, hnHorsCommune: 0, poiLus: 0,
                       poiAgglo: 0, hnErreur: null, calquesActives: [], hnVus: new Set(), poiVus: new Set() };
    // Les VRAIS POI (pas les RPP) ont leur propre onglet et leurs propres comptes.
    // ⚠️ `poiNaturels` est compte pour qu'on VOIE que le script les a ecartes
    // exprès (rivieres, forets…), plutot que de les passer sous silence.
    const statsPoi = { poiAudites: 0, poiHorsCommune: 0, poiNaturels: 0,
                       // `poiBati` : zones sans nom qui dessinent un batiment.
                       poiBati: 0,
                       poiConformes: 0, erreur: null, indisponible: null };
    let poiFindings = [];

    // Une analyse dure de quelques secondes (lecture directe) a plus d'une
    // minute (balayage) : elle se montre, et elle s'interrompt.
    const prog = progression(ui.prog, { annulable: true, titre: 'Analyse en cours…' });
    let vueARendre = null;      // vue a restaurer si le balayage a deplace la carte
    try {

    // ------------------------------------------------------------------
    // BALAYAGE DE LA COMMUNE
    // Le perimetre d'analyse, c'est le CONTOUR de la commune — pas la vue.
    // Faire tracer un polygone puis n'analyser que l'ecran n'aurait aucun sens
    // (remarque de l'auteur, 22/07).
    // ⚠️ Le pas est impose par WME : mesure en live, le zoom 16 est le PREMIER
    // qui charge tout. A 15 il manque 47 segments sur 76, a 14 il en manque 165
    // sur 208 — seuls les axes principaux descendent. Balayer plus large
    // raterait donc exactement les rues qui portent les numeros.
    // ------------------------------------------------------------------
    // --- VOIE RAPIDE : tout la commune en un appel -------------------------
    sourceDonnees = { mode: null, raison: null };
    let donneesApi = null;
    try {
      prog.etape('Lecture de ' + communeActive.nom, 0);      // duree inconnue : barre glissante
      donneesApi = await chargerParApi(communeActive.bbox);
      sourceDonnees = { mode: 'api', raison: null };
    } catch (e) {
      if (e && e.annulation) throw e;
      sourceDonnees = { mode: 'balayage', raison: e.message || String(e) };
      log('lecture directe indisponible, repli sur le balayage : ' + sourceDonnees.raison);
    }
    prog.verifier();

    if (donneesApi) {
      prog.etape('Analyse des segments', donneesApi.segments.length);
      await analyserSegments(donneesApi.segments, prog);
      // Les numeros ne sont pas dans cette reponse, mais `hasHNs` dit lesquels
      // en portent : on n'interroge que ceux-la.
      const porteurs = donneesApi.segments.filter(s => s.hasHNs);
      try {
        await analyserAdresses(porteurs.length ? porteurs : donneesApi.segments,
                               listeAgglos, statsAdr, { hn: true, poi: false }, null, prog);
      } catch (e) {
        if (e && e.annulation) throw e;
        log('analyse des numéros impossible', e); statsAdr.hnErreur = e.message || String(e);
      }
      try {
        await analyserAdresses([], listeAgglos, statsAdr, { hn: false, poi: true }, donneesApi.venues, prog);
      } catch (e) { if (e && e.annulation) throw e; log('analyse des POI impossible', e); }
      // --- Les VRAIS POI (pas les RPP) : audit de leur adresse (v2.15) -------
      // ⚠️ Ne marche QU'EN VOIE RAPIDE : le point d'acces (`entryExitPoints`) et
      // les categories viennent de l'API. Le balayage par la carte ne les livre
      // pas, et on le DIT plutot que de rendre un onglet vide sans explication.
      if (c.poiAdresse || c.poiVilleCommune || c.poiNumero) {
        try {
          prog.etape('Audit des POI', 0);
          await prog.respirer(true);
          poiFindings = auditerPoi(donneesApi.venues, donneesApi.rues, donneesApi.villes,
                                   communeActive, statsPoi);
        } catch (e) {
          if (e && e.annulation) throw e;
          log('audit des POI impossible', e); statsPoi.erreur = e.message || String(e);
        }
      }
      statsAdr.segmentsLus = donneesApi.segments.length;
    } else {
    // --- REPLI : balayage de la commune, cellule par cellule ---------------
    const vueInitiale = { centre: sdk.Map.getMapCenter(), zoom: sdk.Map.getZoomLevel() };
    // ⚠️ Le balayage DEPLACE la carte : quoi qu'il arrive — fin normale, echec
    // ou annulation — l'editeur doit retrouver sa vue. D'ou le `finally`.
    vueARendre = vueInitiale;
    prog.etape('Preparation du balayage', 0);
    const cellules = await preparerBalayage();
    prog.etape('Balayage de ' + communeActive.nom, cellules.length);
    prog.info('La carte se déplace le temps du balayage, puis revient à sa vue.');
    let n = 0;
    for (const cel of cellules) {
      n++;
      prog.fixer(n);
      await prog.respirer(true);
      try { sdk.Map.setMapCenter({ lonLat: cel, zoomLevel: ZOOM_BALAYAGE }); }
      catch (e) { log('cadrage de cellule impossible', e); }
      await attendreChargement(prog);
      prog.verifier();
      const segsCellule = sdk.DataModel.Segments.getAll();
      await analyserSegments(segsCellule, null);   // une cellule est courte : pas de sous-barre
      // Phase 1 : segments et NUMEROS. Les numeros se lisent par appel serveur,
      // donc le zoom 16 suffit.
      try { await analyserAdresses(segsCellule, listeAgglos, statsAdr, { hn: true, poi: false }, null, prog); }
      catch (e) {
        if (e && e.annulation) throw e;
        log('analyse des adresses impossible', e); statsAdr.hnErreur = e.message || String(e);
      }
    }

    // ------------------------------------------------------------------
    // Phase 2 : POI RESIDENTIELS, seulement si le controle est actif.
    // ⚠️ Mesure en live : au zoom 16 WME ne descend AUCUN POI residentiel (il
    // les sert en `venueLevel=4`, a partir du zoom 17 seulement) — la phase 1
    // en aurait donc rate la totalite. Mais ce controle ne cherche que les POI
    // DANS l'agglomeration : inutile de repasser toute la commune au zoom 17,
    // il suffit de couvrir les polygones, bien plus petits.
    // ------------------------------------------------------------------
    if (options.controles.poiAgglo && listeAgglos.length) {
      const cellulesPoi = cellulesPourAgglos(listeAgglos);
      prog.etape('POI résidentiels', cellulesPoi.length);
      let m = 0;
      for (const cel of cellulesPoi) {
        m++;
        prog.fixer(m);
        await prog.respirer(true);
        try { sdk.Map.setMapCenter({ lonLat: cel, zoomLevel: ZOOM_POI }); } catch (e) { /* */ }
        await attendreChargement(prog);
        prog.verifier();
        try { await analyserAdresses([], listeAgglos, statsAdr, { hn: false, poi: true }, null, prog); }
        catch (e) { if (e && e.annulation) throw e; log('analyse des POI impossible', e); }
      }
      statsAdr.cellulesPoi = cellulesPoi.length;
    }
    statsAdr.cellules = cellules.length;
    // ⚠️ En mode BALAYAGE, l'audit des VRAIS POI n'est pas possible : le point
    // d'accès et les catégories ne viennent que de l'API. On le DIT, plutôt que
    // de rendre un onglet vide que l'éditeur croirait « sans écart » (v2.15).
    if (c.poiAdresse || c.poiVilleCommune || c.poiNumero) {
      statsPoi.indisponible = 'lecture directe indisponible — l\'audit des POI a ' +
        'besoin des points d\'accès et des catégories, que le balayage de la carte ' +
        'ne fournit pas. Relance quand la lecture directe remarchera.';
    }
    }   // fin du repli par balayage

    prog.etape('Mise en forme des résultats', 0);
    await prog.respirer(true);
    const nbSegmentsEnEcart = findings.length;
    findings = regrouperFindings(findings);
    // Les reports cartouche-principal sont DEJA groupes par voie : on les ajoute
    // apres `regrouperFindings`, qui ne sait fusionner que des reports d'un
    // seul segment.
    const cartFindings = cartouchesPrincipal();
    zones.cartouche += cartFindings.length;
    findings = findings.concat(cartFindings);
    // Les reports POI rejoignent la meme liste : tout le rendu, le marquage
    // « traite » et la navigation fonctionnent deja dessus. Ils s'en distinguent
    // par `f.poi`, lu par `vueDe()` — un seul endroit decide de la famille.
    findings = findings.concat(poiFindings);
    lastScan = { poi: poiFindings, statsPoi,
                 analyses: zones.agglo + zones.hors + zones.cheval + zones.limCom, skipped, zones,
                 ecarts: nbSegmentsEnEcart, lignes: findings.length, nbAgglos: listeAgglos.length,
                 adr: statsAdr, interrompu: false };
    renderResults();
    redrawEcarts(null);
    } catch (e) {
      // ⚠️ Une annulation n'est pas une panne : on GARDE ce qui a ete trouve
      // avant l'arret, en le disant clairement. Jeter le travail deja fait
      // serait la pire reponse a un clic sur « Annuler ».
      if (!(e && e.annulation)) throw e;
      const nbSegmentsEnEcart = findings.length;
      findings = regrouperFindings(findings);
      // Interrompue : le recensement cartouche est forcement partiel (tous les
      // segments d'une voie n'ont pas ete vus), donc on ne conclut PAS dessus —
      // une voie jugee « eligible » sur un echantillon serait un faux positif.
      lastScan = { poi: poiFindings, statsPoi,
                 analyses: zones.agglo + zones.hors + zones.cheval + zones.limCom, skipped, zones,
                   ecarts: nbSegmentsEnEcart, lignes: findings.length, nbAgglos: listeAgglos.length,
                   adr: statsAdr, interrompu: true };
      renderResults();
      redrawEcarts(null);
    } finally {
      // Le balayage a pu deplacer la carte : elle revient chez l'editeur quoi
      // qu'il arrive — fin normale, echec ou annulation.
      if (vueARendre) {
        try { sdk.Map.setMapCenter({ lonLat: vueARendre.centre, zoomLevel: vueARendre.zoom }); }
        catch (e) { /* */ }
      }
      prog.fin();
    }
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

  /**
   * Contexte administratif d'un segment, exige par les mises a jour d'adresse
   * « brutes » (SDK v2.359).
   * ⚠️ `stateId` est OBLIGATOIRE bien que la doc le donne optionnel : sans lui,
   * `ValidationError: stateId is required for raw address updates` (verifie en
   * live le 22/07). On prend aussi `countryId`, par prudence et parce qu'il est
   * gratuit — les deux se lisent sur l'adresse actuelle du segment.
   */
  function contexteAdresse(segmentId) {
    const a = sdk.DataModel.Segments.getAddress({ segmentId });
    return { stateId: a && a.state && a.state.id, countryId: a && a.country && a.country.id };
  }

  /**
   * Resout — en la creant au besoin — la Street correspondant a (nom, ville).
   * ⚠️ Ne sert plus QUE pour `addAlternateStreet`, qui reclame un identifiant de
   * rue. Le nom PRINCIPAL, lui, s'ecrit desormais en clair (voir
   * `contexteAdresse`), sans passer par la creation d'objets City/Street.
   */
  function resoudreStreet(nom, nomVille) {
    const DM = sdk.DataModel;
    let city = null;
    if (nomVille) {
      city = DM.Cities.getCity({ cityName: nomVille });
      // ⚠️⚠️ ON NE CREE JAMAIS DE COMMUNE (doctrine de l'auteur, 25/07). Une
      // commune INSEE existe normalement deja dans Waze ; si elle est absente,
      // c'est une anomalie a regler a la main, pas a fabriquer d'office. On
      // refuse donc la correction — le message remonte a l'editeur via le
      // try/catch de `appliquerCorrection`. (Auparavant : `addCity` de repli.)
      if (!city) throw new Error('commune « ' + nomVille + ' » absente de Waze : ' +
        'le script ne crée pas de commune. Vérifie ou crée-la à la main, puis relance.');
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
   * Ecrit un cartouche (signText + signType) sur une Street.
   * ⚠️ Le SDK ne sait PAS le faire : `Streets.updateStreet({signText})` repond
   * OK sans rien ecrire (meme piege silencieux que `updateAddress` avec un
   * attribut inconnu — verifie le 23/07). On passe donc par l'action INTERNE
   * `UpdateObject`, la meme couche que celle ou le script lit deja (`hote.W`).
   * L'action est annulable ; `save()` reste, comme toujours, a la main de
   * l'editeur. La Street etant PARTAGEE, l'ecriture vaut pour toute la voie —
   * c'est justement l'effet voulu, et pourquoi l'eligibilite est jugee sur la
   * voie entiere en amont.
   */
  function ecrireCartouche(streetId, signText, signType) {
    try {
      const UpdateObject = hote.require && hote.require('Waze/Action/UpdateObject');
      if (!UpdateObject) throw new Error('action UpdateObject indisponible');
      const st = hote.W.model.streets.getObjectById(streetId);
      if (!st) return false;                    // rue pas encore chargee
      hote.W.model.actionManager.add(new UpdateObject(st, { signText: signText, signType: signType }));
      return true;
    } catch (e) { log('ecriture du cartouche impossible', e); return false; }
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
      // Les voies privees et parkings sont convertibles comme les autres.
      // (Elles avaient ete bridees en v1.77 en soupconnant le refus
      // d'enregistrement du « 721 Chemin de la Begude » : enquete faite, ce
      // refus vient d'une donnee residuelle cote serveur Waze sur UN numero
      // precis, sans rapport avec le type de voie — voir [[wme-sdk-pieges]].)
      if (!f.rueCible || !f.hns || !f.hns.length) return null;
      if (f.editable === false) return null;
      // ⚠️ On ne regarde PAS ici si les numeros sont deja dans le modele : ca
      // depend du zoom courant, pas du report. La correction les chargera.
      return [{ type: 'hn2poi', nb: f.hns.length, rue: f.rueCible }];
    }
    // --- Cartouche sur le nom principal (voie entiere, deja jugee eligible) ---
    if (f.cartouche) {
      if (f.verrouilles === f.nb) return null;   // toute la voie hors de portee
      return [{ type: 'cartouchePrincipal', streetId: f.cartouche.streetId,
                signText: f.cartouche.signText, signType: f.cartouche.signType }];
    }
    if (!f.cible) return null;
    const ops = [];
    const cur = f.ecarts || [];
    // Nom principal : on ne touche que si la cible porte un nom (renommer vers
    // « sans nom » demande un objet Street vide, cas rare et delicat).
    // ⚠️ Cible SANS NOM : on l'applique quand le segment n'en a pas non plus
    // (cas C3/R3 « sans nom + ville » en agglomeration, H5 hors agglo) — on ne
    // detruit alors aucun nom, on ne fait que poser ou retirer la ville.
    // Depuis la v1.80 c'est ecrivable directement (`streetName: ''`), il n'y a
    // plus besoin de retrouver un objet Street vide.
    const segSansNom = /^‹sans nom›/.test(f.libelle || '');
    if (cur.some(e => e.champ === 'principal') && f.cible.primary &&
        (f.cible.primary.name || segSansNom)) {
      // `candidats` : plusieurs noms pouvaient prendre la place de principal.
      // La correction les proposera au lieu d'en elire un d'office.
      ops.push({ type: 'principal', nom: f.cible.primary.name, ville: f.cible.primary.cityName,
                 candidats: (f.cible.candidatsPrincipal && f.cible.candidatsPrincipal.length > 1)
                   ? f.cible.candidatsPrincipal : null });
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
  /**
   * ⚠️ « Absent du modele » n'est PAS « verrouille ». `hasPermissions` leve
   * `DataModelNotFoundError` sur un segment que WME n'a pas charge — le
   * traiter comme un refus faisait disparaitre des corrections legitimes.
   * On distingue donc les deux : `abs` recueille les segments a charger, que
   * l'appelant fera venir en cadrant dessus.
   */
  function segmentsEditables(ids, abs) {
    return ids.filter(id => {
      try { return sdk.DataModel.Segments.hasPermissions({ segmentId: id }); }
      catch (e) {
        if (e && e.name === 'DataModelNotFoundError' && abs) abs.push(id);
        return false;
      }
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
    if (!nomRue) throw new Error('nom de rue indéterminé');
    // Contexte administratif du segment porteur : le POI est cree a cote, donc
    // il partage son Etat et son pays.
    const ctx = contexteAdresse(f.segId);
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
    // ⚠️ Les echecs CRITIQUES sont tenus a part : ceux qui laissent la carte
    // dans un etat abime (adresse en double, POI sans adresse). Ils doivent
    // remonter INTACTS et EN TETE jusqu'a l'editeur, jamais etre noyes dans un
    // compteur ni tronques (defaut corrige en v2.09).
    const critiques = [];
    const villesUtilisees = new Set();
    const laisses = f.hns.length - hnsManipulables(f).length;
    /**
     * Retire un POI qu'on vient de creer. Rend `true` si la carte est bien
     * revenue en arriere. ⚠️ Le resultat DOIT etre lu : c'est lui qui distingue
     * « rattrape » de « doublon en place ».
     */
    const retirerPoi = venueId => {
      try { DM.Venues.deleteVenue({ venueId }); return true; }
      catch (e) { return false; }
    };
    for (const hn of hnsManipulables(f)) {
      let venueId = null;
      const ville = villePour(hn);
      // ⚠️⚠️ PAS DE COMMUNE ⇒ PAS DE CONVERSION (defaut corrige en v2.09, trouve
      // par tools/test-hn-rpp.js). Sans ce garde, le POI etait cree avec
      // `cityName: ''` ET le numero supprime : l'adresse perdait sa commune,
      // alors que la doctrine du projet est justement que la ville du POI EST la
      // commune INSEE. Le cas arrive en limite de departement — numero tombant
      // hors des contours charges, sur un segment sans ville (donc hors agglo,
      // ou c'est le nommage attendu). Meme logique que le garde sur le nom.
      if (!ville) {
        echecs.push(hn.number + ' : commune indéterminable (aucun contour chargé sous ' +
          'ce numéro et le segment n\'en porte pas) — charge le département voisin, ' +
          'ou choisis la commune à la main');
        continue;
      }
      // ── 1. Creation du POI ─────────────────────────────────────────────────
      try {
        // /!\ addVenue rend un NOMBRE, les autres methodes veulent une CHAINE.
        venueId = String(DM.Venues.addVenue({
          category: REF.adressage.categoriePoi, geometry: hn.geometry }));
      } catch (e) {
        echecs.push(hn.number + ' : POI non créé (' + (e.message || e) + ')');
        continue;                       // rien n'a ete touche ⇒ on garde le numero
      }
      // ── 2. Adresse du POI ──────────────────────────────────────────────────
      // ⚠️⚠️ ETAPE A NE PAS CONFONDRE AVEC LA PRECEDENTE (defaut corrige en
      // v2.09, trouve par tools/test-hn-rpp.js) : les deux etaient dans le MEME
      // try, et un echec d'adressage laissait sur la carte un POI residentiel
      // SANS ADRESSE, en plus du numero conserve. Or l'erreur est reelle et
      // documentee — `stateId is required for raw address updates`.
      try {
        DM.Venues.updateAddress({ venueId, addressData: Object.assign(
          { houseNumber: String(hn.number), streetName: nomRue, cityName: ville }, ctx) });
      } catch (e) {
        const annule = retirerPoi(venueId);
        const m = hn.number + ' : adresse du POI refusée (' + (e.message || e) + ')' +
          (annule ? ', POI retiré' :
            ' — ⚠️ LE POI EST RESTÉ SANS ADRESSE, à supprimer à la main');
        echecs.push(m);
        if (!annule) critiques.push(m);
        continue;
      }
      // ── 3. Retrait du numero : c'est ici que se joue le « tout ou rien » ───
      try {
        DM.HouseNumbers.deleteHouseNumber({ houseNumberId: hn.id });
        faits++; villesUtilisees.add(ville);
        crees.push(venueId);            // pour selectionner le POI ensuite
      } catch (e) {
        // ⚠️ Le POI existe mais le numero resiste : on RETIRE le POI, sinon
        // l'adresse serait en double — pire que l'ecart de depart.
        // ⚠️⚠️ Et si ce retrait echoue AUSSI, il faut le DIRE : l'ancien message
        // annoncait « POI annule » sans verifier, donc il rassurait a tort et
        // l'editeur enregistrait un doublon sans le savoir (defaut corrige en
        // v2.09). Un message faux est pire que pas de message.
        if (retirerPoi(venueId)) {
          echecs.push(hn.number + ' : numéro non retirable, POI annulé (' + (e.message || e) + ')');
        } else {
          const m = hn.number + ' : ⚠️ ADRESSE EN DOUBLE — le POI a été créé mais ni ' +
            'le numéro ni le POI n\'ont pu être retirés. N\'enregistre pas : annule dans WME ' +
            '(Ctrl+Z) ou supprime le POI à la main.';
          echecs.push(m); critiques.push(m);
        }
      }
    }
    return { faits, echecs, critiques, laisses, villes: [...villesUtilisees] };
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
            libelle: esc(c.nom) + ' — <b>selon la position</b> de chaque numéro', fort: true });
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
                ? 'Ce segment ne porte qu\'un numéro de route, qui ne fait pas une adresse. ' +
                  'Saisis le nom à donner ' + (f.hns.length > 1
                    ? 'aux <b>' + f.hns.length + '</b> numéros' : 'au numéro <b>' + esc(f.hns[0].number) + '</b>') + '.'
                : 'Quelle adresse donner ' + (f.hns.length > 1
                    ? 'aux <b>' + f.hns.length + '</b> numéros' : 'au numéro <b>' + esc(f.hns[0].number) + '</b>') + ' ?'}
              <div class="agn-modale-geo">D'après les contours INSEE :${
                detail || '<div class="agn-d">indéterminable</div>'}</div>
            </div>
            ${options.map((o, i) => `<button class="agn-btn ${o.fort ? 'primary' : ''}" data-i="${i}">${o.libelle}</button>`).join('')}
            <div class="agn-modale-saisie">
              <div class="agn-note">${r.saisieRequise ? 'Nom de la rue' : 'Ou saisir une autre adresse'}</div>
              <input type="text" id="agn-saisie-nom" placeholder="Nom de la rue…" autocomplete="off" title="Le nom de voie à donner à cette adresse. Il sera écrit tel quel.">
              <select class="agn-sel" id="agn-saisie-ville" title="Laisse vide pour que chaque numéro prenne la commune où il tombe géographiquement">
                <option value="">Commune selon la position de chaque numéro</option>
                ${villesSaisie.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}
              </select>
              <button class="agn-btn ${r.saisieRequise ? 'primary' : ''}" id="agn-saisie-ok" disabled>Utiliser cette adresse</button>
            </div>
            <button class="agn-btn" data-i="-1">Annuler</button>
          </div>
        </div>`);
      document.body.appendChild(boite);
      // Deplacable par son titre : ces boites masquent l'endroit de la carte
      // dont elles parlent (demande de l'auteur, 26/07).
      rendreDeplacable(boite.querySelector('.agn-modale-in'),
                       boite.querySelector('.agn-modale-t'));
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

  /**
   * Quel nom doit devenir le nom PRINCIPAL, quand plusieurs le pouvaient.
   * Rend { nom, ville } ou null si l'editeur renonce.
   * ⚠️ Meme doctrine que pour les adresses : le script ne propose que ce que le
   * segment porte DEJA — il n'invente aucun nom. La saisie libre existe, mais
   * c'est alors l'editeur qui ecrit, pas nous.
   */
  function demanderNomPrincipal(f, op) {
    return new Promise(resolve => {
      const cands = op.candidats;
      const boite = el(`
        <div id="agn-modale">
          <div class="agn-modale-in">
            <div class="agn-modale-t">Plusieurs noms possibles</div>
            <div class="agn-modale-c">
              Ce segment porte <b>${cands.length}</b> noms. Lequel doit devenir le
              <b>nom principal</b> ?
              <div class="agn-modale-geo">
                <div class="agn-d"><b>${esc(f.libelle)}</b></div>
                <div class="agn-d" style="opacity:.8">${f.nb > 1
                  ? 'Le choix s\'applique aux <b>' + f.nb + '</b> segments de ce report.'
                  : 'Les autres noms restent en alternatif.'}</div>
              </div>
            </div>
            ${cands.map((c, i) => `<button class="agn-btn${i === 0 ? ' primary' : ''}" data-i="${i}">${
              esc(c.nom)}${c.ville ? ' / ' + esc(c.ville) : ''}</button>`).join('')}
            <div class="agn-modale-saisie">
              <div class="agn-note">Ou saisir un autre nom</div>
              <input type="text" id="agn-np-nom" placeholder="Nom de la rue…" autocomplete="off">
              <button class="agn-btn" id="agn-np-ok" disabled>Utiliser ce nom</button>
            </div>
            <button class="agn-btn" data-i="-1">Annuler</button>
          </div>
        </div>`);
      document.body.appendChild(boite);
      // Deplacable par son titre : ces boites masquent l'endroit de la carte
      // dont elles parlent (demande de l'auteur, 26/07).
      rendreDeplacable(boite.querySelector('.agn-modale-in'),
                       boite.querySelector('.agn-modale-t'));
      boite.addEventListener('mousedown', e => e.stopPropagation());
      // ⚠️ Sans ca, les frappes partent dans les raccourcis clavier de WME.
      ['keydown', 'keypress', 'keyup'].forEach(ev =>
        boite.addEventListener(ev, e => e.stopPropagation()));
      const champ = boite.querySelector('#agn-np-nom');
      const ok = boite.querySelector('#agn-np-ok');
      champ.oninput = () => { ok.disabled = !champ.value.trim(); };
      champ.onkeydown = e => { if (e.key === 'Enter' && champ.value.trim()) ok.click(); };
      ok.onclick = () => {
        const nom = champ.value.trim();
        if (!nom) return;
        boite.remove();
        resolve({ nom, ville: op.ville });
      };
      boite.querySelectorAll('button[data-i]').forEach(b => {
        b.onclick = () => {
          const i = parseInt(b.dataset.i, 10);
          boite.remove();
          resolve(i < 0 ? null : cands[i]);
        };
      });
    });
  }

  async function appliquerCorrection(f) {
    // ⚠️⚠️ Dernier verrou territorial (v2.03), et le seul qui protege VRAIMENT
    // la carte : les autres ne grisent que des boutons. Un report affiche en
    // France reste cliquable apres un saut a l'etranger — on revalide donc ici,
    // au moment d'ecrire, et pas seulement au moment d'afficher.
    if (evaluerPays().etat !== 'fr') {
      return { ok: false, motif: pays.etat === 'hors'
        ? 'hors de France (' + (pays.nom || pays.code || 'territoire inconnu') +
          ') : ce script n\'applique que les règles françaises'
        : 'territoire indéterminé : impossible de garantir que la carte est en France' };
    }
    const plan = planDeCorrection(f);
    if (!plan) return { ok: false, motif: 'rien d\'automatisable' };
    // ⚠️ On demande AVANT d'ecrire quoi que ce soit : une correction ne doit
    // jamais commencer par une ecriture puis s'interrompre sur une question.
    for (const op of plan) {
      if (op.type !== 'principal' || !op.candidats) continue;
      const choix = await demanderNomPrincipal(f, op);
      if (!choix) return { ok: false, motif: 'choix du nom principal annule' };
      op.nom = choix.nom;
      if (choix.ville != null) op.ville = choix.ville;
    }
    if (f.adresse) {
      // Les numeros n'entrent dans le modele qu'a partir du zoom 18 : on les
      // fait charger plutot que de renvoyer l'editeur a un reglage de carte.
      const dispo = await chargerNumeros(f);
      if (!dispo) {
        return { ok: false, motif: 'numéros non chargés par WME malgré le cadrage — ' +
          'réessaie après avoir zoome sur la zone' };
      }
      // Adresse ambigue (limite communale, ou plusieurs noms de rue) : on
      // demande, on ne choisit pas a la place de l'editeur.
      let choix = null;
      if (f.rueCible.ambigu) {
        choix = await demanderAdresse(f);
        if (!choix) return { ok: false, motif: 'conversion annulée' };
      }
      try {
        const r = convertirHnEnPoi(f, choix);
        if (!r.faits) return { ok: false, motif: r.echecs[0] || 'aucun numéro converti',
                               critiques: r.critiques };
        // ⚠️⚠️ NE PAS reduire les echecs a un COMPTEUR (defaut corrige en v2.09) :
        // l'ancien message disait « N numéro(s) laissés de côté » et jetait le
        // detail — donc un « ADRESSE EN DOUBLE » n'arrivait JAMAIS a l'editeur.
        // Un numero simplement non charge et une carte abimee ne se comptent pas
        // ensemble.
        const parts = [];
        if (r.laisses) parts.push(r.laisses + ' numéro(s) non chargé(s) par WME, laissés de côté');
        if (r.echecs.length) parts.push(r.echecs.join(' ; '));
        // Converti partiellement : la ligne reste a traiter, on ne la barre pas.
        return { ok: true, nb: r.faits, ops: r.faits, bloques: 0,
                 partiel: parts.length > 0,
                 critiques: r.critiques,
                 avertissement: parts.join(' · ') };
      } catch (e) {
        log('conversion impossible', e);
        return { ok: false, motif: e.message || String(e) };
      }
    }
    const tous = f.segIds || [f.segId];
    let absents = [];
    let ids = segmentsEditables(tous, absents);
    // ⚠️ Meme regle que pour les numeros (v1.85) : l'eclair CADRE d'abord.
    // Sans ca, cliquer la correction sans avoir clique la ligne travaillait sur
    // des segments que WME n'avait pas charges — et le script les declarait
    // « verrouilles », ce qui etait faux.
    if (absents.length) {
      const p = progEnCours;
      if (p) p.sous('chargement du segment…');
      cadrerSur(f, true);
      for (let essai = 0; essai < 8 && absents.length; essai++) {
        await new Promise(r => setTimeout(r, 500));
        if (p) p.verifier();
        absents = [];
        ids = segmentsEditables(tous, absents);
      }
      if (p) p.sous(f.libelle || '');
    }
    if (!ids.length) {
      return { ok: false, motif: absents.length
        ? 'segment(s) non chargé(s) par WME malgré le cadrage — réessaie'
        : 'segment(s) verrouille(s) au-dessus de ton niveau' };
    }
    const bloques = tous.length - ids.length;
    try {
      for (const op of plan) {
        if (op.type === 'cartouchePrincipal') {
          // Cartouche pose sur la Street principale (voie entiere). Ecriture par
          // l'action interne : le SDK ne sait pas le faire.
          if (!ecrireCartouche(op.streetId, op.signText, op.signType)) {
            throw new Error('cartouche : la rue n\'est pas encore chargée — réessaie');
          }
        } else if (op.type === 'principal') {
          // Nom principal : ecriture BRUTE (SDK v2.359). Plus besoin de resoudre
          // ni de creer City/Street — et « sans nom » / « sans ville » s'ecrivent
          // avec une chaine vide, au lieu de retrouver les objets vides.
          ids.forEach(id => sdk.DataModel.Segments.updateAddress({
            segmentId: id,
            addressData: Object.assign({ streetName: op.nom || '', cityName: op.ville || '' },
                                       contexteAdresse(id))
          }));
        } else {
          // Alternatif : `addAlternateStreet` veut un ID, donc on resout encore.
          // On n'utilise PAS `alternateStreetIds` de `addressData` : il REMPLACE
          // la liste, ce qui effacerait des alternatifs legitimes.
          const rue = resoudreStreet(op.nom, op.ville);
          if (!rue) throw new Error('rue « ' + op.nom + ' » introuvable');
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

  const CSS = `  /* ─── Charte (v2.07) ────────────────────────────────────────────────────
     Une echelle de 4 tailles (10/11/12/13) et de 4 rayons (3/4/6/8), et des
     couleurs nommees. Avant : 8 tailles dont des demi-pixels arbitraires,
     8 rayons, 61 couleurs en dur.
     ⚠️ Definies sur :root parce que nos elements vivent dans TROIS racines
     DOM distinctes (fenetre flottante, volet, panneau lateral de WME) : c'est
     le seul point commun qui les fasse heriter.
     ⚠️ Chaque usage porte son fallback — var(--agn-bleu, #1e88e5) — pour
     qu'une variable manquante ne fasse jamais disparaitre une couleur. */
  :root{
    --agn-texte:#1f2933; --agn-gris:#546e7a; --agn-gris-clair:#78909c;
    --agn-gris-titre:#607d8b; --agn-gris-pale:#b0bec5;
    --agn-bord:#cfd8dc; --agn-fond-doux:#eceff1; --agn-fond-survol:#f5f7f9;
    --agn-bleu:#1e88e5; --agn-bleu-fonce:#1565c0;
    --agn-vert:#2e7d32; --agn-rouge:#c62828; --agn-orange:#e65100;
    --agn-brun:#a34a00; --agn-ambre:#ffb300;
  }
  /* Une hauteur par defaut est nécessaire : sans elle la fenêtre grandit avec
     la liste et deborde par le bas de l'ecran au lieu de faire defiler. */
  /* La fenêtre descend desormais bas dans l'ecran : la liste des écarts est
     longue, et chaque pixel gagne en hauteur est un coup d'ascenseur en moins. */
  /* ⚠️ Hauteur fixee en JS d'après les bornes MESUREES de la carte : un
     calc(100vh - …) ignore le pied de page de WME (« Conditions | Mentions
     legales | … », 20 px) et la fenêtre passait dessus. */
  #agn-overlay{position:fixed;z-index:9000;width:400px;min-width:300px;min-height:200px;
    background:#fff;border:1px solid var(--agn-gris-pale, #b0bec5);border-radius:8px;
    box-shadow:0 6px 26px rgba(0,0,0,.28);display:flex;flex-direction:column;
    font:12px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--agn-texte, #1f2933);
    resize:both;overflow:hidden}
  #agn-main{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;overflow:hidden;border-radius:6px}
  /* Repliee, la fenêtre se limite a son en-tete : le min-height de travail
     n'a plus lieu d'être. */
  #agn-overlay.agn-replie{min-height:0;height:auto}
  /* Volet des données de référence : il se DEPLOIE VERS LA GAUCHE de la fenêtre,
     pour ne pas lui voler de largeur. Il vit HORS de #agn-overlay, dans le
     body : un enfant debordant obligerait a mettre overflow:visible, et la
     poignee de redimensionnement cesse alors de fonctionner. Sa position est
     donc calculee a la main (voir placerVolet). */
  #agn-volet{position:fixed;z-index:9001;width:300px;
    background:#fff;border:1px solid var(--agn-gris-pale, #b0bec5);border-radius:8px;box-shadow:0 6px 26px rgba(0,0,0,.28);
    display:none;flex-direction:column;overflow:hidden;
    font:12px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--agn-texte, #1f2933)}
  #agn-volet.agn-volet-ouvert{display:flex}
  #agn-volet-in{padding:10px 12px 14px;overflow-y:auto;flex:1 1 auto;min-height:0}
  .agn-volet-t{font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.05em;
    color:var(--agn-gris, #546e7a);margin-bottom:8px;border-bottom:1px solid var(--agn-fond-doux, #eceff1);padding-bottom:5px}
  /* Le bouton du volet vit dans la barre d'onglets, PAS dans l'en-tete : la
     ligne de titre n'a pas la place et il la rendait illisible des que la
     fenêtre retrecissait (signale par l'auteur). */
  #agn-données{flex:0 0 auto;width:30px;padding:7px 0;border:none;background:none;cursor:pointer;
    font-size:13px;color:var(--agn-gris, #546e7a);border-right:1px solid var(--agn-bord, #cfd8dc);border-bottom:2px solid transparent}
  #agn-données:hover{background:#e3eaf0}
  #agn-données.agn-on{background:#fff;color:var(--agn-bleu-fonce, #1565c0);border-bottom-color:var(--agn-bleu, #1e88e5)}
  /* Onglets : on ne montre JAMAIS les deux familles d'écarts en même temps —
     melangees, la liste devient illisible (demande de l'auteur). */
  #agn-onglets{display:flex;gap:0;flex:0 0 auto;border-bottom:1px solid var(--agn-bord, #cfd8dc);background:var(--agn-fond-doux, #eceff1)}
  .agn-tab{flex:1;padding:7px 6px;border:none;border-bottom:2px solid transparent;background:none;
    cursor:pointer;font-size:11px;color:var(--agn-gris, #546e7a);font-weight:600}
  .agn-tab:hover{background:#e3eaf0}
  .agn-tab.agn-tab-on{background:#fff;color:var(--agn-bleu-fonce, #1565c0);border-bottom-color:var(--agn-bleu, #1e88e5)}
  .agn-tab-n{display:inline-block;min-width:16px;padding:0 5px;margin-left:3px;border-radius:8px;
    background:var(--agn-gris-pale, #b0bec5);color:#fff;font-size:10px;font-weight:700}
  .agn-tab.agn-tab-on .agn-tab-n{background:var(--agn-bleu, #1e88e5)}
  #agn-tete{display:flex;align-items:center;gap:8px;padding:7px 10px;background:var(--agn-bleu, #1e88e5);color:#fff;
    border-radius:6px 6px 0 0;cursor:move;user-select:none;flex:0 0 auto;overflow:hidden}
  #agn-tete button{flex:0 0 auto}
  /* Le titre cede la place plutot que de pousser les boutons hors de la vue. */
  #agn-tete b{font-size:12px;flex:0 1 auto;min-width:0;overflow:hidden;
    text-overflow:ellipsis;white-space:nowrap}
  #agn-tete .agn-v{opacity:.75;font-size:11px;flex:0 0 auto}
  #agn-tete .agn-sp{flex:1}
  #agn-tete button{background:rgba(255,255,255,.18);border:none;color:#fff;cursor:pointer;
    width:22px;height:22px;border-radius:4px;font-size:13px;line-height:1}
  #agn-tete button:hover{background:rgba(255,255,255,.34)}
  /* min-height:0 est INDISPENSABLE : sans lui un élément flex refuse de
     descendre sous la hauteur de son contenu, donc il pousse la fenêtre au
     lieu de faire defiler la liste. */
  #agn-corps{padding:10px 12px 14px;overflow-y:auto;flex:1 1 auto;min-height:0}
  #agn-corps h3{font-size:11px;margin:13px 0 5px;text-transform:uppercase;letter-spacing:.05em;color:var(--agn-gris-titre, #607d8b)}
  #agn-corps h3:first-child{margin-top:0}
  .agn-sect{border:1px solid #e3e7ea;border-radius:4px;margin-bottom:6px;overflow:hidden}
  .agn-sect-t{display:flex;align-items:center;gap:7px;padding:6px 8px;background:var(--agn-fond-survol, #f5f7f9);
    cursor:pointer;user-select:none;font-size:11px}
  .agn-sect-t:hover{background:var(--agn-fond-doux, #eceff1)}
  .agn-sect-t .agn-chev{color:var(--agn-gris-clair, #78909c);width:9px;flex:0 0 auto}
  .agn-sect-t b{flex:1;font-weight:600;text-transform:uppercase;letter-spacing:.03em;font-size:11px;color:var(--agn-gris, #546e7a)}
  .agn-sect-r{font-size:11px;color:var(--agn-bleu-fonce, #1565c0);font-weight:600;max-width:180px;overflow:hidden;
    text-overflow:ellipsis;white-space:nowrap}
  .agn-sect-c{padding:7px 8px 9px}
  .agn-sect.agn-ferme .agn-sect-t{background:#eef4fa}
  /* ⚠️⚠️ WME impose height:32px aux <button> par sa feuille de style globale.
     Un libelle qui passe sur deux lignes etait donc COUPE NET : « — selon la
     position de chaque numero » perdait son dernier mot (signale par l'auteur le
     26/07, mesure : 32 px affiches pour 41 px de contenu). On rend la hauteur au
     contenu, en gardant 32 px comme MINIMUM pour ne pas tasser les boutons
     courts. Meme famille que le box-sizing du panneau lateral : un style de WME
     qu'il faut neutraliser explicitement, jamais supposer absent. */
  .agn-btn{display:block;width:100%;padding:6px 10px;margin:3px 0;border:1px solid #bbb;border-radius:4px;
    background:#fff;cursor:pointer;font-size:12px;color:inherit;
    height:auto;min-height:32px;line-height:1.45;white-space:normal;text-align:center}
  .agn-btn:hover:not(:disabled){background:#f3f3f3}
  .agn-btn:disabled{opacity:.45;cursor:default}
  .agn-btn.primary{background:var(--agn-bleu, #1e88e5);color:#fff;border-color:#1976d2;font-weight:600}
  .agn-btn.primary:disabled{background:#9e9e9e;border-color:#9e9e9e}
  .agn-sel{width:100%;box-sizing:border-box;padding:5px;font-size:12px;margin:3px 0;
    border:1px solid #bbb;border-radius:4px;background:#fff}
  .agn-sel optgroup{font-style:normal;font-weight:700;color:var(--agn-gris, #546e7a)}
  .agn-sel optgroup option{font-weight:400;color:initial}
  .agn-filtre{width:100%;box-sizing:border-box;padding:4px 6px;font-size:12px;margin:0 0 2px;
    border:1px solid var(--agn-bord, #cfd8dc);border-radius:4px}
  .agn-filtre:focus{border-color:var(--agn-bleu, #1e88e5);outline:none}
  .agn-note{font-size:11px;color:var(--agn-gris-clair, #78909c);margin:2px 0}
  .agn-deps{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:0 6px;
    max-height:120px;overflow-y:auto;border:1px solid #ddd;border-radius:4px;padding:4px;margin:4px 0;background:#fafafa}
  .agn-dep{display:flex;align-items:center;gap:4px;font-size:11px;padding:1px 2px;cursor:pointer;border-radius:3px}
  .agn-dep:hover{background:var(--agn-fond-doux, #eceff1)}
  .agn-dep code{color:var(--agn-gris-clair, #78909c);font-size:10px;min-width:20px}
  .agn-dep-chip{display:inline-block;background:var(--agn-vert, #2e7d32);color:#fff;border-radius:8px;
    padding:0 6px;margin:1px 2px 0 0;font-size:10px;font-weight:700}
  .agn-dep span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .agn-poly{border:1px solid #ddd;border-radius:4px;padding:6px;margin:5px 0;background:#fafafa}
  .agn-poly input[type=text]{width:100%;box-sizing:border-box;margin:2px 0;padding:3px 5px;font-size:12px}
  .agn-row{display:flex;gap:6px;align-items:center;margin-top:4px}
  .agn-row label{flex:1;font-size:11px}
  .agn-mini{border:none;background:none;cursor:pointer;font-size:12px;padding:2px 4px;opacity:.7}
  .agn-mini:hover{opacity:1}
  .agn-stat{background:var(--agn-fond-doux, #eceff1);border-radius:4px;padding:6px 8px;margin:6px 0;font-size:11px}
  /* Progression. Bleu franc : c'est du travail en cours, ni une alerte (orange)
     ni un résultat (vert). Les chiffres en chasse fixe pour qu'ils ne dansent
     pas d'un rafraichissement a l'autre. */
  .agn-prog{background:#e3f2fd;border:1px solid #90caf9;border-radius:4px;padding:6px 8px;
    margin:6px 0;font-size:11px;color:#0d47a1}
  .agn-prog-t{display:flex;align-items:center;gap:6px}
  .agn-prog-lib{flex:1 1 auto;min-width:0;font-weight:600;overflow:hidden;
    text-overflow:ellipsis;white-space:nowrap}
  .agn-prog-pct{flex:0 0 auto;font-variant-numeric:tabular-nums}
  .agn-prog-bar{height:6px;background:#bbdefb;border-radius:3px;overflow:hidden;margin:4px 0 3px}
  .agn-prog-bar > i{display:block;height:100%;width:0;background:var(--agn-bleu, #1e88e5);border-radius:3px;
    transition:width .15s linear}
  /* Attente de duree inconnue (appel réseau, lecture de fichier) : la barre
     glisse au lieu d'afficher un pourcentage invente. */
  .agn-prog-bar.agn-indet > i{width:35%;animation:agn-glisse 1.1s ease-in-out infinite}
  @keyframes agn-glisse{0%{margin-left:-35%}100%{margin-left:100%}}
  .agn-prog-b{display:flex;align-items:center;gap:6px}
  .agn-prog-d{flex:1 1 auto;opacity:.8;font-variant-numeric:tabular-nums}
  .agn-prog-x{flex:0 0 auto;border:1px solid #ef9a9a;background:#fff;color:var(--agn-rouge, #c62828);border-radius:3px;
    cursor:pointer;font-size:11px;padding:1px 7px}
  .agn-prog-x:hover:not(:disabled){background:#ffebee}
  .agn-prog-x:disabled{opacity:.6;cursor:default}
  .agn-prog-info{opacity:.75;margin-top:2px}
  .agn-prog-info:empty{display:none}
  .agn-prog-note{color:var(--agn-brun, #a34a00);font-weight:600;margin-top:3px}
  .agn-prog-note:empty{display:none}
  .agn-alerte{background:#fff3e0;border:1px solid #ffb74d;color:var(--agn-brun, #a34a00)}
  .agn-ok{background:#e8f5e9;border:1px solid #a5d6a7;color:var(--agn-vert, #2e7d32)}
  .agn-item{border:1px solid #e0e0e0;border-left-width:4px;border-radius:3px;padding:5px 7px;margin:4px 0;
    cursor:pointer;background:#fff}
  .agn-item:hover{background:#f6f9ff}
  .agn-item.agn-actif{background:#fff8e1;border-color:var(--agn-ambre, #ffb300);border-left-color:#ff6f00;box-shadow:0 0 0 1px var(--agn-ambre, #ffb300)}
  .agn-item.agn-traite{background:#e8f5e9;border-color:#a5d6a7}
  .agn-item.agn-traite .agn-h > span:first-child{text-decoration:line-through;opacity:.6}
  .agn-item.agn-traite .agn-d,.agn-item.agn-traite .agn-warn{opacity:.45}
  .agn-fix-btn{border:1px solid #ffe082;background:#fffde7;color:var(--agn-orange, #e65100);border-radius:3px;cursor:pointer;
    font-size:11px;padding:0;line-height:15px;flex:0 0 auto;width:20px;text-align:center}
  .agn-fix-btn:hover{background:#fff8e1;border-color:var(--agn-ambre, #ffb300)}
  .agn-fix-grp{border:1px solid #ffe082;background:#fffde7;color:var(--agn-orange, #e65100);border-radius:3px;cursor:pointer;
    font-size:10px;padding:1px 6px;flex:0 0 auto;margin-right:2px}
  .agn-fix-grp:hover{background:#fff8e1;border-color:var(--agn-ambre, #ffb300)}
  .agn-ok-btn{border:1px solid #c8e6c9;background:#fff;color:var(--agn-vert, #2e7d32);border-radius:3px;cursor:pointer;
    font-size:11px;padding:0;line-height:15px;flex:0 0 auto;width:20px;text-align:center}
  .agn-ok-btn:hover{background:#e8f5e9}
  .agn-item.agn-traite .agn-ok-btn{background:var(--agn-vert, #2e7d32);color:#fff;border-color:var(--agn-vert, #2e7d32)}
  /* Ligne traitée : plus d'eclair non plus — il ne ferait rien. */
  .agn-item.agn-traite .agn-fix-btn{display:none}
  .agn-traites{color:var(--agn-vert, #2e7d32);font-weight:600}
  .agn-nb{color:var(--agn-bleu-fonce, #1565c0);font-weight:700}
  .agn-lock{color:var(--agn-rouge, #c62828);font-weight:700}
  .agn-cartouche{border-left-color:#fbc02d}
  .agn-a{border-left-color:#8e24aa}
  #agn-poignees{position:fixed;inset:0;z-index:8500;pointer-events:none}
  .agn-poi{position:fixed;transform:translate(-50%,-50%);border-radius:50%;pointer-events:auto;cursor:grab}
  .agn-poi-s{width:12px;height:12px;background:#e91e63;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.5)}
  .agn-poi-s:hover{background:#ad1457;transform:translate(-50%,-50%) scale(1.25)}
  .agn-poi-m{width:9px;height:9px;background:rgba(255,255,255,.85);border:2px dashed #e91e63;cursor:copy}
  .agn-poi-m:hover{background:#fff;transform:translate(-50%,-50%) scale(1.3)}
  .agn-poly.agn-en-édition{border-color:#e91e63;box-shadow:0 0 0 1px #e91e63}
  .agn-edit-barre{margin-top:6px;padding-top:6px;border-top:1px dashed #e0e0e0}
  .agn-edit-barre span{display:block;font-size:10px;color:var(--agn-gris-clair, #78909c);margin-bottom:4px}
  .agn-edit-barre button{display:inline-block;width:auto;margin-right:5px}
  .agn-forme{border-left-color:#00acc1}
  .agn-special{border-left-color:var(--agn-gris, #546e7a)}
  .agn-giratoire{border-left-color:#00e676}
  /* Le libelle absorbe la largeur disponible et le badge a une largeur
     minimale : sans ca, la coche se decale selon la longueur du nom et la
     taille du code de cas, et les ✓ ne sont plus alignes d'une ligne a l'autre. */
  .agn-item .agn-h{display:flex;align-items:flex-start;gap:6px;font-weight:600}
  .agn-item .agn-h > span:first-child{flex:1 1 auto;min-width:0;word-break:break-word}
  .agn-item .agn-cas{font-size:10px;background:#eee;border-radius:3px;padding:1px 5px;font-weight:600;
    white-space:nowrap;flex:0 0 auto;min-width:38px;text-align:center}
  .agn-item .agn-d{font-size:11px;margin-top:3px;opacity:.85}
  .agn-item .agn-warn{color:var(--agn-rouge, #c62828);font-size:11px;margin-top:3px}
  /* Marche a suivre manuelle : ce n'est ni une alerte (rouge) ni un écart —
     c'est une consigne. Bleu discret, pour qu'elle se lise sans crier. */
  .agn-item .agn-aide{color:#0d47a1;background:#e8f2fd;border-left:3px solid #90caf9;
    border-radius:0 3px 3px 0;font-size:11px;margin-top:4px;padding:4px 6px;line-height:1.45}
  /* Une issue par ligne, entrée par une puce : les deux options doivent se
     distinguer d'un coup d'oeil, l'éditeur choisit, il ne lit pas un pave. */
  .agn-item .agn-aide-l{position:relative;padding-left:11px;margin-top:3px}
  .agn-item .agn-aide-l::before{content:'▸';position:absolute;left:0;opacity:.65}
  .agn-c1,.agn-c2,.agn-c3,.agn-c4,.agn-r1,.agn-r2,.agn-r3,.agn-r4{border-left-color:var(--agn-bleu, #1e88e5)}
  .agn-h5,.agn-h6,.agn-h7,.agn-h8,.agn-h9{border-left-color:#8e24aa}
  .agn-eb10{border-left-color:#f57c00}
  .agn-lim{border-left-color:#00897b}
  #agn-bulle{position:fixed;z-index:9600;display:none;max-width:420px;pointer-events:none;
    background:#263238;color:var(--agn-fond-doux, #eceff1);border-radius:6px;padding:8px 10px;
    box-shadow:0 4px 18px rgba(0,0,0,.45);font:11.5px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  #agn-bulle .agn-b-t{display:flex;align-items:center;gap:6px;font-weight:700;font-size:12px;margin-bottom:4px}
  #agn-bulle .agn-cas{background:rgba(255,255,255,.18);border-radius:3px;padding:1px 5px;font-size:10px}
  #agn-bulle .agn-b-l{opacity:.9;margin-top:2px}
  #agn-bulle .agn-b-l b{color:#80d8ff;font-weight:600}
  #agn-bulle .agn-b-w{color:#ffab91;margin-top:4px}
  #agn-bulle .agn-b-ok{color:#a5d6a7;margin-top:4px}
  .agn-grp{border:1px solid #e0e0e0;border-radius:4px;margin:5px 0;overflow:hidden}
  .agn-grp-t{display:flex;align-items:center;gap:7px;padding:6px 8px;background:var(--agn-fond-survol, #f5f7f9);
    cursor:pointer;user-select:none;font-size:12px}
  .agn-grp-t:hover{background:var(--agn-fond-doux, #eceff1)}
  .agn-grp-t .agn-chev{color:var(--agn-gris-clair, #78909c);width:9px}
  .agn-grp-t b{flex:1;font-weight:600}
  .agn-pastille{width:11px;height:11px;border-radius:3px;flex:0 0 auto;box-shadow:0 0 0 1px rgba(0,0,0,.15)}
  .agn-grp-n{background:var(--agn-gris, #546e7a);color:#fff;border-radius:8px;padding:1px 7px;font-size:11px;font-weight:700}
  .agn-grp-c{padding:4px 6px 6px}
  .agn-lien{border:none;background:none;color:var(--agn-bleu, #1e88e5);cursor:pointer;font-size:11px;
    text-decoration:underline;padding:2px;margin-left:auto}
  .agn-empty{opacity:.6;font-style:italic;padding:8px 0;font-size:11px}
  .agn-sansagglo{display:flex;align-items:flex-start;gap:6px;margin-top:6px;
    font-style:normal;opacity:1;cursor:pointer;color:var(--agn-brun, #a34a00)}
  #agn-modale{position:fixed;inset:0;z-index:9700;background:rgba(0,0,0,.35);
    display:flex;align-items:center;justify-content:center;
    font:12px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--agn-texte, #1f2933)}
  .agn-modale-in{background:#fff;border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,.4);
    padding:14px 16px;width:380px;max-width:92vw}
  .agn-modale-t{font-weight:700;font-size:13px;margin-bottom:8px;color:var(--agn-rouge, #c62828)}
  .agn-modale-c{font-size:12px;margin-bottom:10px}
  .agn-modale-geo{background:var(--agn-fond-doux, #eceff1);border-radius:4px;padding:6px 8px;margin-top:8px;font-size:11px}
  #agn-err-save{background:#fdecea;border:1px solid #f5a29a;border-left:4px solid var(--agn-rouge, #c62828);
    border-radius:4px;padding:8px 10px;margin-bottom:8px;font-size:11px;color:#8a1c14}
  #agn-err-save b{font-size:12px}
  #agn-err-save .agn-err-msg{margin:4px 0;font-weight:600}
  #agn-err-save .agn-err-note{display:block;font-size:11px;opacity:.8;font-style:italic}
  .agn-modale-saisie{border-top:1px dashed var(--agn-bord, #cfd8dc);margin-top:8px;padding-top:8px}
  .agn-modale-saisie input{width:100%;box-sizing:border-box;padding:5px 7px;font-size:12px;
    border:1px solid #bbb;border-radius:4px;margin:3px 0}
  /* WCT reinsere son bouton en dernier dans le conteneur (il le surveille) :
     inutile de se battre dans le DOM, le conteneur est une grille, donc on se
     place après lui par l'ordre CSS. */
  #agn-fab-wrap{width:40px;height:40px;order:99}
  #agn-fab-btn{width:40px;height:40px;padding:0;border:none;border-radius:50%;cursor:pointer;
    background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.3);font-size:19px;line-height:1;
    display:flex;align-items:center;justify-content:center}
  #agn-fab-btn:hover{background:#eef3f8}
  #agn-fab-btn.agn-fab-on{box-shadow:0 0 0 2px var(--agn-bleu, #1e88e5),0 2px 6px rgba(0,0,0,.3)}
  /* ⚠️⚠️ Le panneau lateral de WME est ETROIT (~300 px) et sa largeur varie.
     Sans box-sizing:border-box, un bouton en width:100% mesure 100 % PLUS ses
     12 px de marge interne et ses 2 px de bordure : il sortait du panneau,
     coupe a droite (signale par l'auteur le 26/07). La règle vaut pour TOUT ce
     qu'on met la-dedans, pas seulement les boutons — et min-width:0 autorise
     les libelles flex a retrecir au lieu de pousser la ligne dehors.
     ⚠️ Ce bloc CSS vit dans un template literal : PAS de backtick ici. */
  .agn-sb, .agn-sb *{box-sizing:border-box}
  .agn-sb{font:12px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:2px;
    max-width:100%;overflow-x:hidden}
  .agn-sb-t{font-weight:700;font-size:13px;margin-bottom:2px;
    display:flex;align-items:baseline;gap:5px}
  .agn-sb-t span{opacity:.5;font-weight:400;font-size:11px}
  .agn-sb h4{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--agn-gris-titre, #607d8b);
    margin:14px 0 5px;border-bottom:1px solid var(--agn-fond-doux, #eceff1);padding-bottom:3px}
  /* Section repliable : le titre h4 devient le bouton de repli. Le chevron est
     a DROITE et l'ensemble reste un h4, pour ne rien changer a la lecture. */
  .agn-sb h4.agn-sb-h{cursor:pointer;display:flex;align-items:center;gap:6px;
    user-select:none;margin-bottom:0}
  .agn-sb h4.agn-sb-h:hover{color:var(--agn-bleu, #1e88e5)}
  .agn-sb h4.agn-sb-h > b{flex:1;min-width:0;font-weight:inherit;overflow-wrap:break-word}
  /* Le chevron doit se VOIR : a 10 px et 70 % d'opacite il passait pour un
     artefact, et rien ne disait que le titre etait cliquable. */
  .agn-sb h4.agn-sb-h .agn-sb-chev{flex:0 0 auto;font-size:13px;line-height:1;
    opacity:.85;color:var(--agn-gris-clair, #78909c)}
  .agn-sb h4.agn-sb-h:hover .agn-sb-chev{opacity:1;color:var(--agn-bleu, #1e88e5)}
  .agn-sb-sect{margin-bottom:2px}
  .agn-sb-sect > .agn-sb-corps{padding-top:5px}
  .agn-sb-sect.agn-ferme > .agn-sb-corps{display:none}
  /* Barre d'onglets du panneau. Trois onglets se partagent la largeur a egalite
     et le libelle retrecit plutot que de deborder. */
  .agn-sb-onglets{display:flex;gap:0;margin:8px 0 0;border-bottom:1px solid var(--agn-bord, #cfd8dc)}
  .agn-sb-onglets button{flex:1 1 0;min-width:0;padding:6px 2px;border:0;background:none;
    font:inherit;font-size:11px;color:var(--agn-gris, #546e7a);cursor:pointer;border-bottom:2px solid transparent;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .agn-sb-onglets button:hover{color:var(--agn-bleu, #1e88e5);background:var(--agn-fond-survol, #f5f7f9)}
  .agn-sb-onglets button.agn-sb-on{color:var(--agn-bleu-fonce, #1565c0);font-weight:700;border-bottom-color:var(--agn-bleu, #1e88e5)}
  .agn-sb-vue{display:none}
  .agn-sb-vue.agn-sb-vue-on{display:block}
  /* La première section d'un onglet n'a pas besoin de reprendre du champ : la
     barre d'onglets fait déjà la separation. */
  .agn-sb-vue > .agn-sb-sect:first-child > h4{margin-top:10px}
  .agn-sb-l{display:flex;align-items:center;gap:6px;margin:5px 0}
  .agn-sb-l span{flex:1;min-width:0}
  .agn-sb-l input{width:58px;flex:0 0 auto;padding:2px 4px;font-size:12px}
  .agn-sb-c{display:flex;align-items:flex-start;gap:6px;margin:5px 0;cursor:pointer;min-width:0}
  .agn-sb-c input{flex:0 0 auto}
  .agn-sb-col{display:flex;align-items:center;gap:7px;margin:4px 0;cursor:pointer}
  .agn-sb-col input{width:34px;height:22px;padding:0;border:1px solid #ccc;border-radius:3px;background:none;cursor:pointer}
  .agn-sb-n{font-size:11px;color:var(--agn-orange, #e65100);min-height:14px;margin-top:4px;
    overflow-wrap:break-word;word-break:break-word}
  /* Alerte de zonage : elle doit se voir AVANT qu'on lise les reports, sinon
     l'éditeur corrige de travers sans savoir que le zonage est incomplet. */
  .agn-alerte-bloc{margin:6px 0;padding:8px 10px;border-radius:6px;font-size:12px;
    background:#fff3e0;border:1px solid #ffb74d;color:#5d4037;line-height:1.45}
  /* « Segments : ☑ tableau ☑ carte » sur une seule ligne : deux cases par
     famille tiendraient mal sur deux lignes chacune dans un panneau etroit. */
  /* ⚠️ flex-wrap indispensable : dans un panneau retreci, « Segments ☑ tableau
     ☑ carte » depassait a droite au lieu de passer a la ligne. */
  .agn-sb-oc{display:flex;align-items:center;flex-wrap:wrap;gap:4px 10px;margin:4px 0;font-size:12px}
  .agn-sb-oc b{flex:0 0 auto;min-width:62px}
  .agn-sb-oc .agn-sb-c{margin:0;white-space:nowrap;flex:0 0 auto}
  .agn-sb-b{width:100%;padding:6px;margin-top:6px;border:1px solid #bbb;border-radius:4px;
    background:#fff;cursor:pointer;font:inherit;font-size:12px;text-align:center;
    overflow-wrap:break-word}
  .agn-sb-b:hover{background:#f3f3f3}
  .agn-sb-i{width:100%;box-sizing:border-box;padding:4px 6px;font-size:12px;
    border:1px solid #bbb;border-radius:4px;margin-top:2px}
  .agn-sb-b.agn-sb-p{background:var(--agn-bleu, #1e88e5);color:#fff;border-color:#1976d2;font-weight:600}
  .agn-nav{display:flex;gap:6px;align-items:center;margin:6px 0}
  .agn-nav button{flex:0 0 auto;padding:4px 9px}
  .agn-nav span{font-size:11px;color:var(--agn-gris-titre, #607d8b)}
  `;

  function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }

  /**
   * Ou la fenetre a le droit de vivre. Tout est MESURE, rien n'est suppose —
   * les trois bords se deplacent selon l'ecran et l'etat de WME :
   *  - a GAUCHE, le volet lateral de WME (bandeau d'icones, panneau d'edition
   *    ouvert) : `#WazeMap` commence a 95 px replie, 264 ouvert (mesure).
   *  - a DROITE, la colonne de boutons (calques, permalien, scripts) : la
   *    fenetre se range a SA gauche, sinon elle masque le bouton du script.
   *  - en BAS, le pied de page de WME (« Conditions | Mentions legales… »,
   *    20 px) : la fenetre ne doit pas passer dessus (remarque de l'auteur).
   */
  function bornesCarte() {
    const carte = document.querySelector('#WazeMap') || document.querySelector('.olMapViewport');
    const b = carte ? carte.getBoundingClientRect()
                    : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    const pied = document.querySelector('.wz-map-ol-footer');
    const hPied = pied ? pied.getBoundingClientRect().height : 22;
    const col = document.querySelector('.overlay-buttons-container.top') ||
                document.querySelector('.overlay-buttons-container');
    const droite = col ? col.getBoundingClientRect().left - 12 : b.right - 64;
    return {
      gauche: Math.round(b.left) + 8,
      droite: Math.round(droite),
      haut: Math.round(b.top) + 8,
      bas: Math.round(b.bottom - hPied - 6)
    };
  }

  /**
   * Place et dimensionne la fenetre en la RAMENANT dans les bornes.
   * ⚠️ Une position memorisee n'est pas parole d'evangile : l'auteur a vu la
   * fenetre s'ouvrir « tout a gauche, par-dessus le volet de WME ». Une
   * position hors bornes n'est donc pas conservee — on la recale, et si elle
   * mord sur le volet gauche on repart de la position par defaut (a droite).
   */
  function placerFenetre(x, y, h) {
    const o = ui.overlay;
    if (!o) return;
    const z = bornesCarte();
    const larg = o.offsetWidth || 400;
    const hMax = Math.max(240, z.bas - z.haut);
    // ⚠️ `memo` est LOCAL a buildOverlay : on relit le stockage plutot que de
    // le capturer (ReferenceError vecu a la premiere ecriture de cette
    // fonction — et `node --check` ne voit pas un symbole absent).
    const uiV = (lire(STORE_UI, {}) || {}).uiV || 0;
    const haut = Math.min(h && h >= 260 && uiV >= 3 ? h : hMax, hMax);
    o.style.height = haut + 'px';
    // Position par defaut : collee a droite, sous la barre d'outils.
    const defX = Math.max(z.gauche, z.droite - larg);
    const defY = z.haut;
    let px = (x == null || isNaN(x)) ? defX : x;
    let py = (y == null || isNaN(y)) ? defY : y;
    // ⚠️ Mordre sur le volet gauche de WME = position refusee, pas rabotee :
    // l'editeur l'avait forcement posee la par accident.
    if (px < z.gauche) px = defX;
    px = Math.min(px, Math.max(z.gauche, z.droite - larg));
    py = Math.min(Math.max(py, z.haut), Math.max(z.haut, z.bas - haut));
    o.style.left = Math.round(px) + 'px';
    o.style.top = Math.round(py) + 'px';
  }
  /**
   * Echappement HTML. ⚠️ Les cinq caracteres, pas trois : `>` et `'` manquaient.
   * Aucun cas exploitable n'existe aujourd'hui (nos attributs sont tous
   * delimites par des guillemets doubles), mais un `esc` incomplet est une mine
   * posee pour la prochaine fois qu'on ecrira un attribut entre apostrophes —
   * et les noms de rues, de POI et les etiquettes de polygones viennent de
   * Waze ou d'un fichier de partage TIERS, donc de l'exterieur.
   */
  /**
   * Rend une boite de dialogue DEPLACABLE par sa poignee (son titre).
   *
   * ⚠️ Demande de l'auteur (26/07) : ces boites se posent au milieu de l'ecran et
   * masquent justement l'endroit de la carte dont elles parlent — on ne peut pas
   * verifier de quel cote de la limite tombe un numero sans les bouger.
   *
   * La boite est centree par le flex du fond ; on ne passe en positionnement
   * absolu qu'AU PREMIER GLISSEMENT, en figeant d'abord sa position courante,
   * sinon elle sauterait dans un coin au moment ou on l'attrape.
   */
  function rendreDeplacable(boite, poignee) {
    if (!boite || !poignee) return;
    poignee.style.cursor = 'move';
    poignee.style.userSelect = 'none';
    poignee.title = 'Glisser pour déplacer cette fenêtre';
    let ox = 0, oy = 0, actif = false;
    const bouger = e => {
      if (!actif) return;
      // Bornage a l'ecran : une boite tiree dehors serait irrecuperable, faute
      // de barre de titre a rattraper.
      const l = Math.max(4, Math.min(e.clientX - ox, window.innerWidth - boite.offsetWidth - 4));
      const t = Math.max(4, Math.min(e.clientY - oy, window.innerHeight - boite.offsetHeight - 4));
      boite.style.left = Math.round(l) + 'px';
      boite.style.top = Math.round(t) + 'px';
    };
    const lacher = () => {
      if (!actif) return;
      actif = false;
      document.removeEventListener('mousemove', bouger);
      document.removeEventListener('mouseup', lacher);
    };
    poignee.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      const r = boite.getBoundingClientRect();
      // On fige la position AVANT de sortir du flux : sans ca, la boite saute.
      boite.style.position = 'fixed';
      boite.style.margin = '0';
      boite.style.left = Math.round(r.left) + 'px';
      boite.style.top = Math.round(r.top) + 'px';
      ox = e.clientX - r.left;
      oy = e.clientY - r.top;
      actif = true;
      document.addEventListener('mousemove', bouger);
      document.addEventListener('mouseup', lacher);
      e.preventDefault();
      e.stopPropagation();          // le glissement ne part pas dans la carte
    });
  }

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function buildOverlay() {
    const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
    const memo = lire(STORE_UI, {});
    if (memo.options) {
      // ⚠️ `Object.assign` est PLAT : un `vue` enregistre avant l'ajout d'une
      // case la ferait revenir `undefined` (donc decochee) au lieu de prendre
      // le defaut. On refusionne les sous-objets sur leurs valeurs par defaut.
      const vueDefaut = options.vue, couleursDefaut = options.couleurs;
      options = Object.assign(options, memo.options);
      options.vue = Object.assign({}, vueDefaut, memo.options.vue || {});
      // Meme piege pour les couleurs : la famille `rpp`, ajoutee en v1.93,
      // serait `undefined` chez qui a deja des reglages enregistres.
      options.couleurs = Object.assign({}, couleursDefaut, memo.options.couleurs || {});
      // Meme piege pour le panneau lateral (v2.03) : `replis` doit rester un
      // objet meme si l'enregistrement est anterieur a son existence.
      const p = memo.options.panneau || {};
      options.panneau = { onglet: p.onglet || 'analyse', replis: p.replis || {} };
    }
    // Les controles disponibles dependent du referentiel : on active par defaut
    // ceux qu'il declare et que l'utilisateur n'a pas deja regles.
    REF.controles.forEach(ct => {
      // ⚠️ Un controle peut demander a etre DECOCHE au depart (`defaut: false`) :
      // c'est le cas du numero de rue manquant sur les POI, qui concerne la
      // moitie d'entre eux et noierait le reste (arbitrage de l'auteur, 26/07).
      if (options.controles[ct.cle] === undefined) {
        options.controles[ct.cle] = ct.defaut !== undefined ? ct.defaut : true;
      }
    });

    const o = el(`
      <div id="agn-overlay">
        <div id="agn-main">
        <div id="agn-tete">
          <b>🏙️ Naming Auditor</b><span class="agn-v">v${VERSION}</span><span class="agn-sp"></span>
          <button id="agn-reduire" title="Réduire">–</button>
          <button id="agn-fermer" title="Fermer">✕</button>
        </div>
        <div id="agn-onglets">
          <button id="agn-donnees" title="Contours, commune, agglomération">☰</button>
          <button class="agn-tab" data-vue="segments" title="Les écarts de nommage des segments (agglomération, cartouches, rédaction)">Segments <span class="agn-tab-n"></span></button>
          <button class="agn-tab" data-vue="adresses" title="Les écarts de numérotation : numéros de rue et POI résidentiels">Numérotation <span class="agn-tab-n"></span></button>
          <button class="agn-tab" data-vue="poi" title="Les écarts d'adresse sur les vrais POI (hors POI résidentiels)">POI <span class="agn-tab-n"></span></button>
        </div>
        <div id="agn-corps">
          <!-- Garde-fou territorial (v2.03) : en tete du corps, AVANT le bouton
               d'analyse — c'est la raison pour laquelle il est grise. -->
          <div id="agn-pays"></div>
          <button class="agn-btn primary" id="agn-scan" disabled title="Analyse le nommage et l'adressage de toute la commune choisie. Rien n'est enregistré : tu reliras chaque correction dans WME.">Analyser la commune</button>
          <!-- Conteneur PROPRE a la progression : agn-stats est reecrit par
               renderResults(), une barre qui y vivrait serait effacee. -->
          <div id="agn-prog"></div>
          <div id="agn-stats"></div>
          <div id="agn-fix"></div>
          <div id="agn-results"></div>
        </div>
      </div>
      <div id="agn-volet"><div id="agn-volet-in">
          <div class="agn-volet-t">Données de référence</div>
          <div class="agn-sect" data-s="contours">
            <div class="agn-sect-t"><span class="agn-chev">▾</span><b>1. Contours communaux</b>
              <span class="agn-sect-r"></span></div>
            <div class="agn-sect-c">
              <select class="agn-sel" id="agn-source" title="D'où viennent les contours communaux à charger">
                <option value="gouv">Télécharger (geo.api.gouv.fr)</option>
                <option value="fichier">Charger un fichier GeoJSON</option>
                <option value="wazefrance">api.wazefrance.com</option>
              </select>
              <div id="agn-src-gouv">
                <div class="agn-row">
                  <input type="search" id="agn-dep-filtre" title="Filtre la liste par numéro ou par nom de département" placeholder="Filtrer un département…" style="flex:1">
                  <span class="agn-note" id="agn-dep-n">0</span>
                </div>
                <div class="agn-deps" id="agn-deps"></div>
                <button class="agn-btn" id="agn-dep-go" disabled title="Télécharge les contours des départements cochés (~3 Mo et ~10 s chacun) et les AJOUTE à ta base, sans effacer les autres">Télécharger et charger</button>
              </div>
              <div id="agn-src-fichier" style="display:none">
                <button class="agn-btn" id="agn-contours" title="Charge un fichier GeoJSON de contours communaux. ⚠️ Remplace les contours en base ; les agglomérations tracées sont conservées">Choisir un fichier GeoJSON</button>
              </div>
              <div id="agn-src-wazefrance" style="display:none"><div class="agn-empty"></div></div>
              <input type="file" id="agn-fichier" accept=".geojson,.json" style="display:none">
              <div id="agn-prog-contours"></div>
              <div id="agn-statut-contours"></div>
            </div>
          </div>

          <div class="agn-sect" data-s="commune">
            <div class="agn-sect-t"><span class="agn-chev">▾</span><b>2. Commune à traiter</b>
              <span class="agn-sect-r"></span></div>
            <div class="agn-sect-c">
              <!-- Filtre (v2.03) : au zoom 12 la vue peut contenir 80 communes,
                   et l'ordre alphabetique noyait celle qu'on regarde. -->
              <input type="text" class="agn-filtre" id="agn-commune-f"
                     placeholder="filtrer par nom ou code INSEE…" autocomplete="off">
              <select class="agn-sel" id="agn-commune" title="La commune sur laquelle porte l'analyse. Celle qui est sous le centre de la carte est remontée en tête de liste."><option value="">— charger d'abord les contours —</option></select>
              <div class="agn-note" id="agn-nb-communes"></div>
            </div>
          </div>

          <div class="agn-sect" data-s="agglo">
            <div class="agn-sect-t"><span class="agn-chev">▾</span><b>3. Agglomération</b>
              <span class="agn-sect-r"></span></div>
            <div class="agn-sect-c">
              <div class="agn-sb-n" id="agn-voies">Trois façons d'obtenir le zonage :
                tracer à la main, regarder les panneaux, ou partir d'un tracé proposé.</div>
              <button class="agn-btn" id="agn-tracer" disabled title="Dessine à la main, sur la carte, le polygone de l'agglomération (double-clic pour fermer le tracé)">＋ Tracer l'agglomération</button>
              <button class="agn-btn" id="agn-panneaux" disabled title="Récupère les panneaux EB10 / EB20 (entrée et sortie d'agglomération) et les confronte aux polygones traces.">🪧 Panneaux d'agglomération</button>
              <button class="agn-btn" id="agn-pretrace" disabled title="Fabrique un polygone par groupe d'entrées d'agglomération. Tracé grossier, à ajuster aux poignées.">✏️ Proposer un tracé</button>
              <div id="agn-prog-panneaux"></div>
              <div id="agn-bilan-panneaux" class="agn-sb-n"></div>
              <div id="agn-agglos"></div>
            </div>
          </div>
          <button class="agn-btn" id="agn-volet-ok" title="Referme ce volet et rend la place à la fenêtre de travail">Terminer et replier</button>
      </div></div>`);
    document.body.appendChild(o);

    ui.overlay = o;
    ui.statutContours = o.querySelector('#agn-statut-contours');
    ui.progContours = o.querySelector('#agn-prog-contours');
    ui.prog = o.querySelector('#agn-prog');
    ui.inputFichier = o.querySelector('#agn-fichier');
    ui.selCommune = o.querySelector('#agn-commune');
    ui.filtreCommune = o.querySelector('#agn-commune-f');
    ui.nbCommunes = o.querySelector('#agn-nb-communes');
    ui.btnTracer = o.querySelector('#agn-tracer');
    ui.listeAgglos = o.querySelector('#agn-agglos');
    ui.btnPanneaux = o.querySelector('#agn-panneaux');
    ui.btnPreTrace = o.querySelector('#agn-pretrace');
    ui.progPanneaux = o.querySelector('#agn-prog-panneaux');
    ui.bilanPanneaux = o.querySelector('#agn-bilan-panneaux');
    ui.btnScan = o.querySelector('#agn-scan');
    ui.bandeauPays = o.querySelector('#agn-pays');
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

    // position / taille memorisees, bornees aux limites MESUREES de la carte
    const largeur = Math.max(300, Math.min(memo.w || 400, bornesCarte().droite - bornesCarte().gauche));
    o.style.width = largeur + 'px';
    placerFenetre(memo.x, memo.y, memo.h);
    if (memo.ouvert === false) o.style.display = 'none';
    // L'ecran peut changer sous nos pieds (fenetre redimensionnee, panneau
    // d'edition de WME ouvert) : on se remet dans les clous plutot que de
    // laisser la fenetre a cheval sur le pied de page ou sous le volet gauche.
    window.addEventListener('resize', () => {
      clearTimeout(ui.tEcran);
      ui.tEcran = setTimeout(() => {
        if (o.style.display === 'none' || o.classList.contains('agn-replie')) return;
        placerFenetre(parseInt(o.style.left, 10), parseInt(o.style.top, 10), o.offsetHeight);
        placerVolet();
      }, 250);
    });

    // Volet des donnees : ouvert d'office tant qu'il n'y a pas de contours, car
    // c'est par la qu'il faut commencer ; referme des que le travail est pret.
    o.querySelector('#agn-donnees').onclick = () => basculerVolet();
    o.querySelector('#agn-volet-ok').onclick = () => basculerVolet(false);
    ui.onglets.forEach(t => { t.onclick = () => choisirVue(t.dataset.vue); });
    choisirVue(memo.vue === 'adresses' ? 'adresses' : 'segments');
    majOnglets();   // un onglet decoche la session derniere reste masque

    o.querySelector('#agn-contours').onclick = () => ui.inputFichier.click();
    ui.inputFichier.onchange = surFichierContours;
    brancherSources(o);
    ui.btnTracer.onclick = tracerAgglo;
    ui.btnPanneaux.onclick = releverPanneaux;
    ui.btnPreTrace.onclick = preTracerDepuisPanneaux;
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
      // ⚠️ Un releve de panneaux appartient a UNE commune : le garder en
      // changeant de commune afficherait un bilan qui ne parle plus de rien.
      oublierPanneaux();
      redrawCommune(); redrawAgglos(); renderAgglos();
      if (communeActive) replierSection('commune', false);   // choix fait
      // Cadrage sur la commune choisie, dans la zone reellement visible (v2.12).
      if (communeActive) {
        const em = empriseDeGeom(communeActive.geom);
        if (em) centrerSurZoneVisible(em.centre, zoomPour(2 * em.rx, 2 * em.ry, em.centre.lat));
      }
    };

    // Filtre des communes. `input` et non `change` : la liste doit se resserrer
    // a la frappe, sinon le champ ne fait pas gagner de temps.
    ui.filtreCommune.oninput = () => rafraichirCommunesDeLaVue();

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
    o.querySelector('#agn-reduire').onclick = () => basculerRepli();

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
      // Meme regle a la souris qu'au demarrage : la fenetre ne va pas se ranger
      // sous le volet gauche de WME ni sur son pied de page.
      const z = bornesCarte();
      const x = Math.min(Math.max(z.gauche, e.clientX - drag.dx), Math.max(z.gauche, z.droite - 120));
      const y = Math.min(Math.max(z.haut, e.clientY - drag.dy), Math.max(z.haut, z.bas - 40));
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
  /**
   * Replie ou deplie la fenetre de travail. Sans argument, elle bascule.
   *
   * ⚠️⚠️ Reduire la fenetre ne doit JAMAIS ecraser sa hauteur de travail.
   * Bug vecu (auteur, 21/07 : « l'overlay est devenu tres petit apres quelques
   * manipulations ») : replier posait `height:auto`, le ResizeObserver voyait
   * la fenetre retrecir et `saveUI` enregistrait la hauteur REPLIEE (~40 px) —
   * qui devenait la taille au demarrage suivant. On memorise donc la hauteur
   * avant repli, et `saveUI` n'ecrit rien tant qu'on est replie.
   */
  function basculerRepli(force) {
    const o = ui.overlay;
    if (!o) return;
    const replie = o.classList.contains('agn-replie');
    const veut = force === undefined ? !replie : !!force;
    if (veut === replie) return;
    if (veut) ui.hAvantRepli = o.offsetHeight;      // on la garde sous le coude
    o.classList.toggle('agn-replie', veut);
    ui.corps.style.display = veut ? 'none' : '';
    const ong = o.querySelector('#agn-onglets');
    if (ong) ong.style.display = veut ? 'none' : '';
    o.style.height = veut ? 'auto' : (ui.hAvantRepli || 560) + 'px';
    o.style.resize = veut ? 'none' : 'both';
    if (veut) basculerVolet(false); else placerVolet();
    if (!veut) saveUI();
  }

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
  // ⚠️ TROIS familles de reports depuis la v2.15, et un seul endroit qui en
  // decide : `familleDe`. Les tests en cascade `f.adresse ? … : …` ne tenaient
  // plus a trois, et c'est exactement le genre de duplication qui a produit le
  // defaut des giratoires (deux endroits decidant de la meme chose).
  const VUES = ['segments', 'adresses', 'poi'];
  const CASE_TABLE = { segments: 'segTable', adresses: 'adrTable', poi: 'poiTable' };
  const CASE_CARTE = { segments: 'segCarte', adresses: 'adrCarte', poi: 'poiCarte' };
  const vueDe = f => f.poi ? 'poi' : (f.adresse ? 'adresses' : 'segments');

  let vueCourante = 'segments';
  function choisirVue(vue) {
    vueCourante = VUES.includes(vue) ? vue : 'segments';
    ui.onglets.forEach(t => t.classList.toggle('agn-tab-on', t.dataset.vue === vueCourante));
    saveUI();
    renderResults();
    redrawEcarts(null);
  }

  /** Les reports de l'onglet courant (le TABLEAU). */
  const findingsVisibles = () => findings.filter(f => vueDe(f) === vueCourante);

  /** Les reports a peindre sur la CARTE — reglage independant de l'onglet. */
  const findingsCarte = () =>
    findings.filter(f => options.vue[CASE_CARTE[vueDe(f)]]);

  /**
   * Un onglet decoche disparait de la barre. ⚠️ On ne peut pas les masquer TOUS :
   * la fenetre n'aurait plus rien a montrer. Le premier reste, et sa case se
   * recoche toute seule (`majOnglets` est aussi appele apres coup).
   */
  function majOnglets() {
    if (!ui.onglets) return;
    if (!VUES.some(v => options.vue[CASE_TABLE[v]])) options.vue.segTable = true;
    ui.onglets.forEach(t => {
      const montre = !!options.vue[CASE_TABLE[t.dataset.vue]];
      t.style.display = montre ? '' : 'none';
    });
    // L'onglet actif vient d'etre masque : on bascule sur le premier qui reste.
    if (!options.vue[CASE_TABLE[vueCourante]]) {
      choisirVue(VUES.find(v => options.vue[CASE_TABLE[v]]) || 'segments');
    }
  }

  /** Chaque onglet annonce son nombre de reports, meme quand il n'est pas actif. */
  function majCompteursOnglets() {
    if (!ui.onglets) return;
    const n = { segments: 0, adresses: 0, poi: 0 };
    findings.forEach(f => { n[vueDe(f)]++; });
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
      : sansAgglo[communeActive.code] ? 'sans agglomération (déclarée)'
      : '⚠ à tracer');
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
    // ⚠️⚠️ COUPURE A DROITE DU PANNEAU — cause racine, mesuree en live le 26/07.
    // WME pose `width: 330px` EN DUR sur le `tab-pane` qu'il nous donne, mais
    // son conteneur (`.tabContent--…`, `overflow-y:auto` + `overflow-x:hidden`)
    // n'offre que **315 px** utiles des que la barre de defilement verticale
    // apparait — c'est-a-dire des qu'un onglet est un peu long. Le contenu,
    // cale sur 330, depassait alors de 13 px et se faisait couper SANS barre
    // horizontale : « objets et texte coupes, selon les onglets ».
    // `width:auto` rend la largeur FLUIDE : le bloc se cale sur la place
    // reellement disponible (315 avec barre, 330 sans), donc plus jamais de
    // coupure et aucune oscillation a gerer.
    // ⚠️ Ne PAS remplacer par `max-width:100%` sur notre conteneur : le parent
    // mesure deja 330, un pourcentage s'y resout et ne corrige rien (essaye).
    // ⚠️⚠️ Et surtout : le poser sur le SEUL `pane` NE SUFFIT PAS — mesure faite.
    // `registerScriptTab()` rend un DIV **interne** au `section.tab-pane`, et
    // c'est la SECTION au-dessus qui porte le 330 px. On remonte donc jusqu'au
    // conteneur qui coupe (exclu) en liberant la largeur de chaque ancetre : on
    // ne sait pas lequel WME choisira de contraindre demain.
    try {
      for (let n = pane; n && n !== document.body; n = n.parentElement) {
        if (getComputedStyle(n).overflowX !== 'visible') break;   // le coupeur : on n'y touche pas
        n.style.width = 'auto';
        n.style.maxWidth = '100%';
      }
    } catch (e) { /* structure de WME differente : on laisse tel quel */ }
    /**
     * Une section repliable. Le titre porte le repli, le corps le contenu.
     * `cle` sert a memoriser l'etat : elle doit rester stable d'une version a
     * l'autre, sinon les replis de l'editeur se perdent au prochain lancement.
     */
    const sect = (cle, titre, corps) => `
        <div class="agn-sb-sect" data-sect="${cle}">
          <h4 class="agn-sb-h" title="Replier ou déplier cette section"><b>${titre}</b><span class="agn-sb-chev">▾</span></h4>
          <div class="agn-sb-corps">${corps}</div>
        </div>`;

    pane.innerHTML = `
      <div class="agn-sb">
        <div class="agn-sb-t">${SCRIPT_NAME} <span>v${VERSION}</span></div>
        <!-- ⚠️ Le bouton de la fenêtre de travail reste HORS des onglets : c'est
             le seul geste qu'on refait tout le temps, il n'a rien a faire cache
             au fond d'un onglet de réglages (arbitrage auteur, 26/07). -->
        <button class="agn-sb-b agn-sb-p" id="agn-rouvrir" title="Réaffiche la fenêtre de travail si tu l'as fermée">Afficher la fenêtre</button>

        <div class="agn-sb-onglets">
          <button data-vue="analyse" title="Ce que l'analyse regarde">Analyse</button>
          <button data-vue="affichage" title="Où et comment les écarts se voient">Affichage</button>
          <button data-vue="donnees" title="Contours, sauvegarde et partage">Données</button>
        </div>

        <div class="agn-sb-vue" data-vue="analyse">
          ${sect('analyse', 'Analyse', `
            <label class="agn-sb-l" title="Part de longueur au-delà de laquelle un segment à cheval est rattaché d'office à un côté. En dessous, il est signalé comme à couper.">
              <span>Seuil de rattachement</span>
              <input type="number" id="agn-r-seuil" min="50" max="100" step="5"> %</label>
            <label class="agn-sb-c"><input type="checkbox" id="agn-r-sansadresse" title="Parkings et voies privées sont exclus par défaut : ils n'ont pas d'adressage. Les inclure remonte des écarts de rédaction sur leur nom.">
              Inclure parkings et voies privées</label>
            <label class="agn-sb-c"><input type="checkbox" id="agn-r-alt" title="Un nom alternatif en trop est souvent légitime (voie connue sous plusieurs noms) : désactivé par défaut pour ne pas noyer les vrais écarts.">
              Signaler les noms alternatifs surnuméraires</label>`)}
          ${sect('controles', 'Contrôles', `
            <div id="agn-r-controles"></div>
            <div class="agn-sb-n" id="agn-r-relance"></div>`)}
          ${sect('correction', 'Correction', `
            <div class="agn-sb-n" id="agn-r-droits"></div>`)}
        </div>

        <div class="agn-sb-vue" data-vue="affichage">
          ${sect('resultats', 'Où voir les résultats', `
            <div class="agn-sb-n">Tableau et carte se choisissent séparément. La carte
              ne suit plus l'onglet ouvert : on peut lister les numéros en gardant
              les segments surlignes.</div>
            <div class="agn-sb-oc"><b>Segments</b>
              <label class="agn-sb-c"><input type="checkbox" id="agn-r-segtable" title="Lister les écarts de nommage dans l'onglet Segments"> tableau</label>
              <label class="agn-sb-c"><input type="checkbox" id="agn-r-segcarte" title="Surligner les segments en écart sur la carte"> carte</label></div>
            <div class="agn-sb-oc"><b>Adresses</b>
              <label class="agn-sb-c"><input type="checkbox" id="agn-r-adrtable" title="Lister les écarts d'adressage dans l'onglet Numérotation"> tableau</label>
              <label class="agn-sb-c"><input type="checkbox" id="agn-r-adrcarte" title="Marquer les numéros de rue et POI en écart sur la carte : disque plein pour un numéro hors agglomération, anneau pour un RPP en agglomération"> carte</label></div>
            <div class="agn-sb-oc"><b>POI</b>
              <label class="agn-sb-c"><input type="checkbox" id="agn-r-poitable" title="Lister les écarts d'adresse des vrais POI dans l'onglet POI"> tableau</label>
              <label class="agn-sb-c"><input type="checkbox" id="agn-r-poicarte" title="Marquer sur la carte les POI dont l'adresse est en écart"> carte</label></div>
            <div class="agn-sb-oc"><b>Panneaux</b>
              <label class="agn-sb-c"><input type="checkbox" id="agn-r-pancarte" title="Afficher les panneaux d'entrée et de sortie d'agglomération relevés : vert dans un polygone, rouge dehors, gris si aucun polygone n'est tracé"> carte</label></div>`)}
          ${sect('surlignage', 'Surlignage sur la carte', `
            <label class="agn-sb-c"><input type="checkbox" id="agn-r-surligner" title="Peint les segments et les points en écart directement sur la carte">
              Surligner les écarts sur la carte</label>
            <div class="agn-sb-n">Numéro de rue hors agglo = disque plein ·
              RPP en agglo = anneau.</div>
            <div id="agn-r-couleurs"></div>
            <button class="agn-sb-b" id="agn-r-reset" title="Remet les couleurs d'origine">Couleurs par défaut</button>`)}
          ${sect('navigation', 'Navigation', `
            <label class="agn-sb-c"><input type="checkbox" id="agn-r-zoom" title="Recentre la carte sur le segment quand tu cliques un écart">
              Cadrer sur le segment au clic</label>
            <label class="agn-sb-l" title="Le zoom s'adapte à l'emprise des segments ; cette valeur en est le plafond.">
              <span>Zoom maximal</span>
              <input type="number" id="agn-r-zoomniv" min="12" max="22" step="1"></label>`)}
        </div>

        <div class="agn-sb-vue" data-vue="donnees">
          ${sect('contours', 'Contours communaux', `
            <label class="agn-sb-c" title="Interroge geo.api.gouv.fr pour savoir quel département est sous les yeux, et télécharge ses contours s'ils manquent."><input type="checkbox" id="agn-r-autodep">
              Charger tout seul le département visible</label>
            <div class="agn-sb-n">Les contours se cumulent : charger un département n'efface pas les autres.</div>`)}
          ${sect('partage', 'Sauvegarde &amp; partage', `
            <div class="agn-sb-n" id="agn-r-socle"></div>
            <div class="agn-sb-n">Polygones, communes « sans agglo » et coches « traité »
              sont conservés dans le gestionnaire de scripts (survit au nettoyage du
              navigateur), avec repli local.</div>
            <button class="agn-sb-b" id="agn-r-exporter" title="Écrit un fichier JSON contenant tes polygones et tes communes « sans agglo », à transmettre à un autre éditeur. Tes coches « traité » restent personnelles et n'y sont pas.">⬇️ Exporter (polygones + communes)</button>
            <div class="agn-sb-n">Le fichier partage les <b>polygones</b> et les
              communes « sans agglo ». Les coches « traité » restent personnelles.</div>
            <button class="agn-sb-b" id="agn-r-importer-f" title="Ajoute les communes d'un fichier reçu. ⚠️ Tes communes existantes ne sont JAMAIS écrasées : seules les absentes sont ajoutées.">⬆️ Importer un fichier</button>
            <input type="file" id="agn-r-fichier-partage" accept=".json,application/json" style="display:none">
            <label class="agn-sb-l" style="margin-top:8px"><span>Importer depuis une URL</span></label>
            <input type="text" id="agn-r-url" class="agn-sb-i" title="Adresse https d'un fichier de partage (les autres protocoles sont refusés)" placeholder="https://raw.githubusercontent.com/…/zone.json" autocomplete="off">
            <button class="agn-sb-b" id="agn-r-importer-u" title="Télécharge ce fichier et ajoute les communes qui te manquent">🌐 Importer depuis l'URL</button>
            <div class="agn-sb-n" id="agn-r-partage-etat"></div>`)}
        </div>
      </div>`;

    const q = s => pane.querySelector(s);

    // ── Onglets et replis ───────────────────────────────────────────────────
    const vues = [...pane.querySelectorAll('.agn-sb-vue')];
    const tabs = [...pane.querySelectorAll('.agn-sb-onglets button')];
    const choisirVueReglages = nom => {
      // Un nom enregistre par une version qui n'a plus cet onglet ne doit pas
      // laisser le panneau VIDE : on retombe sur le premier.
      if (!vues.some(v => v.dataset.vue === nom)) nom = vues[0].dataset.vue;
      vues.forEach(v => v.classList.toggle('agn-sb-vue-on', v.dataset.vue === nom));
      tabs.forEach(t => t.classList.toggle('agn-sb-on', t.dataset.vue === nom));
      options.panneau.onglet = nom; saveUI();
    };
    tabs.forEach(t => { t.onclick = () => choisirVueReglages(t.dataset.vue); });

    pane.querySelectorAll('.agn-sb-sect').forEach(s => {
      const cle = s.dataset.sect;
      const chev = s.querySelector('.agn-sb-chev');
      const poser = ferme => {
        s.classList.toggle('agn-ferme', ferme);
        chev.textContent = ferme ? '▸' : '▾';
      };
      poser(!!options.panneau.replis[cle]);
      s.querySelector('.agn-sb-h').onclick = () => {
        const ferme = !s.classList.contains('agn-ferme');
        poser(ferme);
        options.panneau.replis[cle] = ferme; saveUI();
      };
    });
    choisirVueReglages(options.panneau.onglet);
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

    // Les 4 cases « tableau / carte » vivent dans `options.vue`, pas a la
    // racine : `coche` ne sait pas les atteindre.
    const CASES_VUE = { '#agn-r-segtable': 'segTable', '#agn-r-adrtable': 'adrTable',
                        '#agn-r-segcarte': 'segCarte', '#agn-r-adrcarte': 'adrCarte',
                        '#agn-r-poitable': 'poiTable', '#agn-r-poicarte': 'poiCarte',
                        '#agn-r-pancarte': 'panCarte' };
    // ⚠️ Relire l'etat APRES coup, sur les quatre : `majOnglets` peut avoir
    // recoche « Segments / tableau » de force (on ne masque pas les deux
    // onglets). Sans ca, la case resterait vide alors que l'onglet est la.
    const syncVue = () => {
      for (const [id, cle] of Object.entries(CASES_VUE)) q(id).checked = !!options.vue[cle];
    };
    for (const [id, cle] of Object.entries(CASES_VUE)) {
      q(id).onchange = () => {
        options.vue[cle] = q(id).checked; saveUI();
        if (cle === 'segTable' || cle === 'adrTable') { majOnglets(); renderResults(); }
        else if (cle === 'panCarte') redrawPanneaux();
        else redrawEcarts(null);
        syncVue();
      };
    }
    syncVue();
    // Recocher la case doit tenter TOUT DE SUITE : l'editeur vient d'exprimer
    // son besoin, il n'a pas a bouger la carte pour que ca se declenche.
    coche('#agn-r-autodep', 'autoDep', () => { if (options.autoDep) autoChargerDepartement(); });

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
        const l = el(`<label class="agn-sb-col" title="Couleur de cette famille d'écarts sur la carte">
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
        ? 'Correction activée — ' + esc(d.motifs.join(', ')) +
          '.<br>Les corrections ne sont <b>jamais enregistrées</b> automatiquement.'
        : d.rangsLus
          ? 'Correction désactivée : réservée aux L5, L6, Global Editors et staff (ton rang : ' +
            esc(d.niveau) + ').'
          : 'Lecture du profil en cours…';
      return d.rangsLus > 0;
    };
    if (!peindreDroits()) {
      let n = 0;
      const t = setInterval(() => { if (peindreDroits() || ++n > 20) clearInterval(t); }, 1000);
    }

    // ── Sauvegarde & partage ────────────────────────────────────────────────
    const socle = q('#agn-r-socle');
    const info = prefs.info();
    socle.innerHTML = info.resistantAuNettoyage
      ? 'Socle : <b>gestionnaire de scripts</b> — résistant au nettoyage du navigateur.'
      : '⚠️ Socle : <b>localStorage</b> seul (gestionnaire non accordé) — un nettoyage ' +
        'du navigateur effacerait tout. Réinstalle le script dans Tampermonkey.';

    const etatPartage = q('#agn-r-partage-etat');
    const dire = (txt, err) => { etatPartage.textContent = txt; etatPartage.style.color = err ? '#c62828' : '#2e7d32'; };
    const RAISONS = {
      'json-invalide': 'fichier illisible (pas du JSON).',
      'format-inconnu': 'ce fichier n\'est pas un partage WME Naming Auditor.',
      'autre-script': 'ce fichier vient d\'un autre script.',
      'contenu-absent': 'fichier vide.',
      'lecture-impossible': 'lecture du fichier impossible.',
      'reseau': 'téléchargement impossible (URL joignable ? domaine autorisé ?).',
      'url-invalide': 'cette adresse n\'est pas une URL valide.',
      'url-non-https': 'seules les adresses https:// sont acceptées.'
    };
    const apresImport = r => {
      if (!r.ok) { dire('Import refusé : ' + (RAISONS[r.raison] || r.raison), true); return; }
      // ⚠️ Un rejet ne doit JAMAIS être silencieux : un import qui n'a pris que
      // la moitié du fichier, sans le dire, laisse croire à un zonage complet.
      const rejet = r.rejetes ? ' ⚠️ ' + r.rejetes + ' entrée(s) écartée(s) : code INSEE ou ' +
        'polygone invalide (le fichier est peut-être abîmé).' : '';
      if (!r.ajoutPoly && !r.ajoutSans) {
        dire('Rien de nouveau : les communes du fichier étaient déjà chez toi.' + rejet, !!r.rejetes);
      } else {
        dire(r.ajoutPoly + ' commune(s) avec polygone et ' + r.ajoutSans +
          ' « sans agglo » ajoutée(s). Tes communes existantes n\'ont pas été touchées.' + rejet);
      }
      // Rafraichir ce que l'editeur voit : liste des communes, agglos, carte.
      rafraichirCommunesDeLaVue(); renderAgglos(); redrawAgglos();
    };

    q('#agn-r-exporter').onclick = async () => {
      try { const r = await exporterPartage();
            dire('Exporté : ' + (r.cles.join(' + ') || 'rien à exporter') + '.'); }
      catch (e) { dire('Export impossible : ' + e.message, true); }
    };
    const inputPartage = q('#agn-r-fichier-partage');
    q('#agn-r-importer-f').onclick = () => inputPartage.click();
    inputPartage.onchange = async () => {
      if (!inputPartage.files || !inputPartage.files[0]) return;
      apresImport(await importerPartageFichier(inputPartage.files[0]));
      inputPartage.value = '';
    };
    q('#agn-r-importer-u').onclick = async () => {
      const url = (q('#agn-r-url').value || '').trim();
      if (!url) { dire('Colle d\'abord une URL.', true); return; }
      dire('Téléchargement…');
      apresImport(await importerPartageURL(url));
    };

    q('#agn-rouvrir').onclick = ouvrirOverlay;
  }

  function ouvrirOverlay() {
    ui.overlay.style.display = '';
    // On reprend la position d'avant la fermeture, mais recalee : WME a pu
    // ouvrir son panneau d'edition entre-temps, ou l'ecran changer de taille.
    placerFenetre(parseInt(ui.overlay.style.left, 10), parseInt(ui.overlay.style.top, 10),
                  ui.overlay.offsetHeight);
    // Meme regle qu'au demarrage : sans commune en cours, on montre par ou
    // commencer plutot que d'ouvrir une fenetre vide.
    if (!communes.length || !communeActive) basculerVolet(true);
    // ⚠️ Les contours prennent beaucoup de place pour une etape qu'on ne refait
    // presque jamais (demande de l'auteur, 23/07) : la section reste PLIEE.
    // Seule exception, la seule qui compte : la liste des communes de la vue
    // est vide — la ou il faut agir est alors precisement la, sous les yeux.
    replierContoursSelonListe();
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
    [LAYER_COMMUNE, LAYER_AGGLO, LAYER_ECARTS, LAYER_ADRESSES, LAYER_PANNEAUX].forEach(n => {
      try { sdk.Map.removeAllFeaturesFromLayer({ layerName: n }); } catch (e) { /* */ }
    });
  }

  /** Reouverture : on remet ce qui correspond a l'etat courant. */
  function repeindreCarte() {
    redrawCommune(); redrawAgglos(); redrawEcarts(null); redrawPanneaux();
  }

  /**
   * Bouton flottant dans la colonne d'icones de droite de WME, a la suite de
   * celui de WCT (meme conteneur `.overlay-buttons-container.top`, donc il
   * s'empile juste en dessous). Le conteneur n'existe pas forcement au
   * demarrage : on réessaie tant qu'il n'est pas la.
   */
  function poserFab() {
    const cont = document.querySelector('.overlay-buttons-container.top') ||
                 document.querySelector('.overlay-buttons-container');
    if (!cont) return false;
    // Deja en place DANS le conteneur courant ? (un wrap orphelin, detache par un
    // re-rendu, ne compte pas — d'ou le test de contenance et non d'existence.)
    if (cont.querySelector('#agn-fab-wrap')) return true;
    const vieux = document.querySelector('#agn-fab-wrap');
    if (vieux) vieux.remove();               // orphelin : on ne laisse pas de doublon
    const wrap = el(`<div id="agn-fab-wrap"><button id="agn-fab-btn" type="button"
        title="${esc(SCRIPT_NAME)}">🏙️</button></div>`);
    cont.appendChild(wrap);
    wrap.querySelector('button').onclick = () => {
      if (ui.overlay.style.display === 'none') ouvrirOverlay(); else fermerOverlay();
    };
    majFab();
    return true;
  }

  /**
   * Bouton flottant dans la colonne d'icones de droite de WME, a la suite de
   * celui de WCT (meme conteneur `.overlay-buttons-container.top`, donc il
   * s'empile juste en dessous — voir `order:99` dans le CSS).
   *
   * ⚠️⚠️ IL NE SUFFIT PAS DE LE POSER UNE FOIS (bug signale par l'auteur le
   * 26/07 : « apres avoir fait pas mal de choses, puis en fermant l'overlay, le
   * FAB a disparu »). WME est une application React : le conteneur d'icones est
   * RE-RENDU quand l'interface change, et tout ce qu'un script y a ajoute a la
   * main est detruit avec. L'ancienne version arretait sa boucle des que le
   * bouton etait pose et ne regardait plus jamais — le FAB disparu, l'editeur
   * n'avait plus AUCUN moyen de rouvrir la fenetre, sinon l'onglet lateral.
   * C'est la meme famille que le retrait du FAB de WCT, qui lui SURVEILLE son
   * conteneur (voir [[wct-closures-toolkit]]).
   *
   * ⚠️ SURVEILLANCE PAR INTERVALLE, PAS PAR `MutationObserver` — et c'est un choix
   * mesure, pas de la paresse. J'avais d'abord mis un observateur sur le body
   * (`childList` + `subtree`) : en live, il ne reposait PAS le bouton (c'est le
   * filet periodique qui l'a fait), et dans une application aussi mouvante que
   * WME il se declenche des dizaines de fois par seconde pour rien. Un
   * `querySelector` sur un conteneur toutes les 2 s coute infiniment moins et
   * fonctionne, lui. Le prix est de voir le bouton revenir en 2 s au pire —
   * acceptable pour un raccourci de confort, l'onglet lateral restant disponible.
   */
  function installerFab() {
    poserFab();
    setInterval(poserFab, 2000);
    // ⚠️ Chrome BRIDE les minuteries d'un onglet en arriere-plan : d'abord a
    // 1 tour/seconde, puis a environ 1 tour/MINUTE au-dela de quelques minutes
    // (mesure pendant ce test, et deja note dans [[wme-sdk-pieges]]). Un
    // re-rendu survenu pendant que l'editeur etait sur un autre onglet laisserait
    // donc le bouton absent jusqu'a une minute apres son retour. On verifie donc
    // aussi au moment ou l'onglet redevient visible : c'est exactement l'instant
    // ou l'editeur regarde l'ecran et cherche son bouton.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) poserFab();
    });
  }

  function majFab() {
    const b = document.querySelector('#agn-fab-btn');
    if (!b || !ui.overlay) return;
    const ouvert = ui.overlay.style.display !== 'none';
    b.classList.toggle('agn-fab-on', ouvert);
    b.title = SCRIPT_NAME + (ouvert ? ' — masquer la fenêtre' : ' — afficher la fenêtre');
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
      const prog = progression(ui.progContours, { annulable: true, titre: 'Téléchargement…' });
      try {
        const r = await chargerDepuisGouv(codes, prog);
        prog.fin();
        if (r.echecs.length) ui.statutContours.innerHTML +=
          '<div class="agn-stat agn-alerte">Echec : ' + esc(r.echecs.join(' ; ')) + '</div>';
      } catch (e) {
        prog.fin();
        // Une interruption voulue n'est pas un echec : on ne la peint pas en orange.
        ui.statutContours.innerHTML = e && e.annulation
          ? '<div class="agn-stat">Téléchargement interrompu — rien n\'a été modifié.</div>'
          : '<div class="agn-stat agn-alerte">' + esc(e.message) + '</div>';
      } finally { go.disabled = choisis.size === 0; }
    };
  }

  function renderContours() {
    if (!metaContours || !communes.length) {
      ui.statutContours.innerHTML = '<div class="agn-empty">Aucun contour chargé. ' +
        (options.autoDep
          ? 'Déplace-toi sur ta zone : le département se télécharge tout seul.'
          : 'Coche un département ci-dessus, ou charge un fichier GeoJSON.') + '</div>';
      return;
    }
    // On liste les DEPARTEMENTS en base, pas le dernier fichier charge : depuis
    // que les contours se cumulent, « dep. 11 » ne dit plus ce qu'on a sous la
    // main. L'editeur doit voir qu'il possede deja le 30 et le 34.
    const deps = (metaContours.deps && metaContours.deps.length) ? metaContours.deps : depsCharges();
    const noms = deps.map(d => {
      const dd = DEPARTEMENTS.find(x => x.code === d);
      return '<span class="agn-dep-chip" title="' + esc(dd ? dd.nom : d) + '">' + esc(d) + '</span>';
    }).join('');
    ui.statutContours.innerHTML = `<div class="agn-stat agn-ok">
        <b>${communes.length}</b> commune(s) en base — ${deps.length} département(s) : ${noms}</div>
      <button class="agn-lien" id="agn-vider">tout vider</button>`;
    const v = ui.statutContours.querySelector('#agn-vider');
    if (v) v.onclick = () => {
      if (confirm('Vider tous les contours en base (' + communes.length + ' communes) ?\n\n' +
        'Les agglomérations tracées, elles, sont conservées : elles sont rangees par code INSEE.')) viderContours();
    };
  }

  /**
   * Bandeau du garde-fou territorial. Il n'apparait QUE quand l'outil est
   * ferme : en France, rien ne doit encombrer la fenetre.
   *
   * ⚠️ Nuance qui evite un bandeau permanent et inutile : « territoire
   * indetermine » est l'etat NORMAL au zoom 12-13, ou WME n'a encore charge
   * aucun segment — c'est justement le zoom auquel on choisit sa commune et
   * l'on trace les polygones. On ne le signale donc que si l'editeur avait de
   * quoi lancer une analyse (commune choisie et zonage pret) : la, le bandeau
   * explique un bouton grise. Le refus franc (« hors de France ») s'affiche,
   * lui, toujours.
   */
  function majBandeauPays() {
    const z = ui.bandeauPays;
    if (!z) return;
    let montrer = false;
    if (pays.etat === 'hors') montrer = true;
    else if (pays.etat === 'inconnu' && communeActive) {
      montrer = !!(agglos[communeActive.code] || []).length || !!sansAgglo[communeActive.code];
    }
    z.innerHTML = montrer
      ? '<div class="agn-alerte-bloc">' + (pays.etat === 'hors' ? '⛔ ' : '⏳ ') + messagePays() + '</div>'
      : '';
  }

  function renderAgglos() {
    // Garde-fou territorial (v2.03). ⚠️⚠️ DEUX cas a ne pas confondre :
    //  - « hors » (etranger DEMONTRE) : on ferme tout, tracage compris ;
    //  - « inconnu » : on ne ferme QUE l'analyse. Bloquer le tracage y serait
    //    une regression — on trace au zoom 12, precisement la ou WME n'a charge
    //    aucun segment et ou le pays est donc illisible.
    const horsFrance = pays.etat === 'hors';
    ui.btnTracer.disabled = !communeActive || horsFrance;
    ui.btnPanneaux.disabled = !communeActive || horsFrance;
    if (ui.btnPreTrace) ui.btnPreTrace.disabled = !communeActive || !panneaux.length || horsFrance;
    if (horsFrance) {
      ui.btnScan.disabled = true;
      ui.listeAgglos.innerHTML = '<div class="agn-empty">' + messagePays() + '</div>';
      majBandeauPays();
      return;
    }
    if (!communeActive) {
      ui.btnScan.disabled = true;
      ui.listeAgglos.innerHTML = '<div class="agn-empty">Choisis une commune.</div>';
      majResumeSections();     // sinon l'en-tete annonce encore la commune perdue
      majBandeauPays();        // et le bandeau n'a plus de raison d'etre
      return;
    }
    const liste = agglos[communeActive.code] || [];
    // ⚠️ Le bouton d'analyse reste FERME tant qu'on n'a ni polygone ni
    // declaration explicite : sans zonage, tous les ecarts seraient faux.
    const declaree = !!sansAgglo[communeActive.code];
    // Et le garde-fou territorial : l'analyse exige une France DEMONTREE. Le
    // bandeau juste au-dessus du bouton dit pourquoi il est ferme — un bouton
    // grise sans explication ne vaut pas mieux qu'une promesse vide.
    ui.btnScan.disabled = (!liste.length && !declaree) || !enFrance();
    if (!liste.length) {
      ui.listeAgglos.innerHTML = '';
      const bloc = el(`<div class="agn-empty">
          Aucune agglomération tracée pour <b>${esc(communeActive.nom)}</b>.<br>
          <label class="agn-sansagglo" title="À cocher seulement si la commune n'a RÉELLEMENT aucun panneau d'agglomération : toute la commune sera alors analysée comme hors agglomération."><input type="checkbox" ${declaree ? 'checked' : ''}>
            cette commune n'a <b>aucune agglomération</b> (tout est hors agglo)</label>
        </div>`);
      bloc.querySelector('input').onchange = e => {
        if (e.target.checked) sansAgglo[communeActive.code] = true;
        else delete sansAgglo[communeActive.code];
        saveSansAgglo(); renderAgglos(); majResumeSections();
      };
      ui.listeAgglos.appendChild(bloc);
      majResumeSections();
      majBandeauPays();
      return;
    }
    majResumeSections();
    majBandeauPays();
    majDatalistVilles();
    ui.listeAgglos.innerHTML = '';
    liste.forEach((a, i) => {
      const node = el(`
        <div class="agn-poly">
          <input type="text" class="agn-label" list="agn-villes-wme"
                 title="Choisis dans les villes que WME connait, ou saisis librement."
                 placeholder="Étiquette (repérage seul)" value="${esc(a.label)}">
          <div class="agn-row">
            <label title="Le nom appliqué devient « Village (Commune) » au lieu du seul nom de la commune INSEE. Le village est lu sur la City du segment."><input type="checkbox" class="agn-ratt" ${a.rattache ? 'checked' : ''}> village rattaché</label>
            <button class="agn-mini agn-edit" title="Éditer les sommets">✎</button>
            <button class="agn-mini agn-zoom" title="Centrer">◎</button>
            <button class="agn-mini agn-del" title="Supprimer">✕</button>
          </div>
          <div class="agn-note">${a.ring.length - 1} sommets — ville appliquée : <b>${
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
        // ⚠️ Pas `centerMapOnGeometry` : il centre sur le canevas ENTIER, donc le
        // polygone finit a moitie derriere la fenetre. On calcule l'emprise et on
        // cadre sur la zone reellement visible (v2.12).
        const em = emprise(a.ring);
        centrerSurZoneVisible(em.centre, zoomPour(2 * em.rx, 2 * em.ry, em.centre.lat));
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
   * Cles ELEMENTAIRES d'un report, stables entre deux analyses. Un report de
   * nommage regroupe plusieurs segments : chacun donne sa cle, si bien qu'un
   * groupe qui retrecit (des segments corriges) reste « traite » sur ce qu'il
   * lui reste. Un report d'adresse s'identifie par son numero (hnId) ou son POI
   * (venueId). ⚠️ Le `cas` entre dans la cle : si l'ecart change de nature, le
   * traite ne s'y applique plus et l'editeur le revoit — c'est voulu.
   */
  function clesTraite(f) {
    if (f.adresse) return [f.cas + '|' + (f.hnId || f.venueId || f.segId)];
    return (f.segIds || [f.segId]).map(id => f.cas + '|' + id);
  }

  /** Un report est « traite » si TOUTES ses cles elementaires le sont. */
  function estTraite(f) {
    if (!communeActive) return false;
    const t = traites[communeActive.code];
    if (!t) return false;
    const cs = clesTraite(f);
    return cs.length > 0 && cs.every(c => t[c]);
  }

  /** Reapplique l'etat « traite » memorise a la liste courante. Idempotent :
   *  `traites` est la source de verite, `f.traite` n'en est que le reflet. */
  function appliquerTraites() {
    if (!communeActive) return;
    findings.forEach(f => { f.traite = estTraite(f); });
  }

  /**
   * Marque un ecart comme traite : il reste dans la liste, barre et coche, mais
   * son surlignage disparait de la carte. A la prochaine analyse il ne devrait
   * plus remonter du tout — c'est la verification que la correction a pris.
   * L'etat est PERSISTE (WMEPrefs) et suit l'editeur d'un poste a l'autre.
   * Cette fonction sera aussi le point d'entree de la correction automatique.
   */
  function marquerTraite(f, node, force) {
    f.traite = force !== undefined ? force : !f.traite;
    node.classList.toggle('agn-traite', !!f.traite);
    // Persistance : on repercute sur `traites[INSEE]` puis on sauve.
    const insee = communeActive && communeActive.code;
    if (insee) {
      const t = traites[insee] || (traites[insee] = {});
      const cs = clesTraite(f);
      if (f.traite) cs.forEach(c => { t[c] = true; });
      else cs.forEach(c => { delete t[c]; });
      if (!Object.keys(t).length) delete traites[insee];
      saveTraites();
    }
    redrawEcarts(null);
    majCompteurTraites();
    majBoutonsGroupes();
  }

  /**
   * Le « ⚡ corriger » d'un groupe n'a plus de sens quand tout y est coche :
   * `planDeCorrection` rend null sur une ligne traitee, le bouton ne ferait
   * donc rien — et un bouton qui ne fait rien se lit comme un bug (pinaillage
   * de l'auteur, 22/07, et il a raison).
   */
  function majBoutonsGroupes() {
    if (!ui.results) return;
    ui.results.querySelectorAll('.agn-grp').forEach(grp => {
      const b = grp.querySelector('.agn-fix-grp');
      if (!b) return;
      const membres = [...grp.querySelectorAll('.agn-item')]
        .map(n => findings[parseInt(n.dataset.idx, 10)]).filter(Boolean);
      b.style.display = membres.some(planDeCorrection) ? '' : 'none';
    });
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
    // ⚠️⚠️ Messages CRITIQUES : ceux qui signalent une carte laissee dans un
    // mauvais etat (adresse en double, POI sans adresse). Tenus a part pour etre
    // affiches EN ENTIER et EN PREMIER — le bandeau tronque les echecs ordinaires
    // a trois, et un avertissement de doublon n'a pas le droit de tomber dans la
    // partie coupee (v2.09).
    const critiques = [];
    // Une conversion HN→POI cadre la carte et attend le chargement des numeros :
    // compter ~1 a 2 s par numero. Sur un groupe, l'editeur attend pour de bon.
    const prog = progression(ui.prog, { annulable: liste.length > 1, titre: 'Correction en cours…' });
    let interrompu = false, traites = 0;
    try {
      prog.etape('Correction', liste.length);
      for (let i = 0; i < liste.length; i++) {
        const f = liste[i];
        prog.fixer(i).sous(f.libelle);
        await prog.respirer(true);
        const res = await appliquerCorrection(f);
        if (res.critiques && res.critiques.length) {
          for (const m of res.critiques) critiques.push(f.libelle + ' — ' + m);
        }
        if (res.ok) {
          ok++; segments += res.nb; bloques += (res.bloques || 0);
          // Une conversion partielle laisse du travail : on ne barre pas la ligne.
          if (res.partiel) echecs.push(f.libelle + ' — ' + res.avertissement);
          else if (noeuds && noeuds[i]) marquerTraite(f, noeuds[i], true);
        } else echecs.push(f.libelle + ' — ' + res.motif);
        traites++;
        prog.fixer(i + 1);
      }
    } catch (e) {
      // ⚠️ Ce qui a deja ete applique RESTE applique : on s'arrete entre deux
      // corrections, jamais au milieu de l'une d'elles (la regle « tout ou
      // rien » d'une conversion tient a l'interieur d'`appliquerCorrection`).
      if (!(e && e.annulation)) { prog.fin(); throw e; }
      interrompu = true;
      echecs.push('série interrompue : ' + (liste.length - traites) + ' report(s) non traite(s)');
    }
    prog.fin();
    redrawEcarts(null);
    majBoutonsGroupes();      // une serie corrigee vide souvent tout un groupe
    majBandeauCorrection(ok, segments, echecs, bloques, unite, interrompu, critiques);
    // Demande de l'auteur : apres une conversion, c'est le POI qui doit etre
    // selectionne, pas le segment d'origine — on enchaine en general sur son
    // point d'entree.
    if (crees.length) {
      try { sdk.Editing.setSelection({ selection: { ids: crees.slice(), objectType: 'venue' } }); }
      catch (e) { log('sélection des POI créées impossible', e); }
      crees = [];
    }
  }

  function majBandeauCorrection(ok, segments, echecs, bloques, unite, interrompu, critiques) {
    if (!ui.bandeauFix) return;
    const enAttente = nbModifsEnAttente();
    const crit = critiques || [];
    if (!ok && (!echecs || !echecs.length) && !crit.length) { ui.bandeauFix.innerHTML = ''; return; }
    // ⚠️⚠️ Les messages critiques passent AVANT le bilan, en entier, dans un bloc
    // a part : ils disent que la carte est abimee et ce qu'il faut faire tout de
    // suite. Les noyer dans la liste tronquee des echecs revenait a ne pas les
    // dire (v2.09).
    const blocCritique = crit.length
      ? `<div class="agn-alerte-bloc"><b>⛔ À RÉGLER AVANT D'ENREGISTRER</b><br>` +
        crit.map(esc).join('<br>') + '</div>'
      : '';
    ui.bandeauFix.innerHTML = blocCritique +
      `<div class="agn-stat ${echecs.length ? 'agn-alerte' : 'agn-ok'}">
        ${interrompu ? '<b>⚠ Série interrompue.</b> ' : ''}
        <b>${ok}</b> correction(s) appliquée(s) sur <b>${segments}</b> ${(unite || 'segment')}(s).
        ${bloques ? '<b>' + bloques + '</b> segment(s) ignoré(s), verrouillé(s) au-dessus de ton niveau. ' : ''}
        ${enAttente != null ? '<b>' + enAttente + '</b> modification(s) en attente dans WME — ' : ''}
        <b>rien n'est enregistré</b> : relis, puis clique sur Enregistrer dans WME.
        ${echecs.length ? '<br>Échecs : ' + echecs.slice(0, 3).map(esc).join(' ; ') +
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
    // ⚠️ `f.poi` (les VRAIS POI, v2.15) autant que les RPP : sans ce test, un
    // ecart de POI partait dans la branche « segment » avec un identifiant de
    // venue, et la selection echouait silencieusement.
    if (f.poi || (f.adresse && f.sousType === 'poi')) {
      try { sdk.Editing.setSelection({ selection: { ids: [f.venueId], objectType: 'venue' } }); }
      catch (e) { log('sélection du POI impossible', e); }
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
      catch (e) { log('sélection impossible', e); }
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
   * Emprise d'une geometrie GeoJSON, quel que soit son type. Rend `null` si elle
   * ne porte aucun point exploitable.
   * ⚠️ Sert a remplacer `centerMapOnGeometry`, qui centre sur le canevas entier
   * et pose donc l'objet a moitie derriere nos fenetres (v2.12). Au passage, il
   * REJETTE les MultiLineString — celle-ci accepte tout.
   */
  function empriseDeGeom(geom) {
    if (!geom || !geom.coordinates) return null;
    const pts = [];
    const aplatir = co => {
      if (typeof co[0] === 'number') pts.push(co);
      else co.forEach(aplatir);
    };
    aplatir(geom.coordinates);
    return pts.length ? emprise(pts) : null;
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
  // ===========================================================================
  // CENTRER SUR CE QUI EST REELLEMENT VISIBLE (v2.12)
  //
  // ⚠️⚠️ Demande de l'auteur (26/07) : `setMapCenter` pose le point au centre
  // GEOMETRIQUE du canevas — or ce centre est souvent CACHE. Le panneau lateral
  // de WME mange la gauche, notre fenetre de travail et son volet mangent la
  // droite : l'objet qu'on vient de cadrer peut se retrouver derriere une
  // fenetre, et l'editeur doit deplacer la carte a la main pour le voir.
  //
  // On mesure donc la surface de carte qui reste VISIBLE, et on decale le centre
  // pour que la cible tombe au milieu de CETTE surface. Le calcul se refait a
  // chaque cadrage : fermer l'overlay ou replier le panneau agrandit la zone, et
  // le centrage suit tout seul.
  // ===========================================================================

  /** Le rectangle du canevas de la carte, en pixels ecran. */
  function rectCarte() {
    const c = document.querySelector('#map') ||
              document.querySelector('.olMapViewport') ||
              document.querySelector('.wm-map') || document.body;
    return c.getBoundingClientRect();
  }

  const estVisible = e => {
    if (!e) return false;
    if (e.style && e.style.display === 'none') return false;
    const r = e.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };

  /**
   * Surface de carte qui n'est masquee par rien. On retranche ce qui recouvre
   * la carte SUR LES COTES ; un element qui la couvrirait en son milieu ne se
   * retranche pas proprement, et ce cas ne se produit pas ici.
   */
  function zoneVisible() {
    const rc = rectCarte();
    let gauche = rc.left, droite = rc.right, haut = rc.top, bas = rc.bottom;
    // --- le panneau lateral de WME (a gauche) ---
    ['#sidebarContent', '.sidebar-layout', '#user-info'].forEach(sel => {
      const e = document.querySelector(sel);
      if (!estVisible(e)) return;
      const r = e.getBoundingClientRect();
      // il ne mord la carte que s'il la chevauche vraiment
      if (r.right > gauche && r.left <= gauche + 2) gauche = Math.max(gauche, r.right);
    });
    // --- nos fenetres (a droite en general, mais on ne le suppose pas) ---
    [ui.overlay, ui.volet].forEach(e => {
      if (!estVisible(e)) return;
      const r = e.getBoundingClientRect();
      if (r.bottom < haut || r.top > bas) return;              // pas en travers
      // On rogne du cote ou l'element laisse le PLUS de place.
      if (r.left - gauche > droite - r.right) droite = Math.min(droite, r.left);
      else gauche = Math.max(gauche, r.right);
    });
    // --- la barre d'outils du bas (Toolbox, barre d'edition de WME) ---
    ['.WMEToolbox', '#toolbox', '.edit-buttons', '.footer'].forEach(sel => {
      const e = document.querySelector(sel);
      if (!estVisible(e)) return;
      const r = e.getBoundingClientRect();
      if (r.top < bas && r.bottom >= bas - 4) bas = Math.min(bas, r.top);
    });
    // Garde-fou : si les retranchements se croisent (fenetres tres larges sur un
    // petit ecran), on rend le canevas entier plutot qu'une zone absurde.
    if (droite - gauche < 80 || bas - haut < 80) {
      return { gauche: rc.left, droite: rc.right, haut: rc.top, bas: rc.bottom, rc, complet: true };
    }
    return { gauche, droite, haut, bas, rc, complet: false };
  }

  /**
   * Centre la carte pour que `lonLat` tombe au milieu de la zone VISIBLE.
   *
   * ⚠️ Le decalage se calcule pour le zoom d'ARRIVEE : a chaque niveau de zoom
   * l'echelle double, donc on extrapole depuis l'emprise courante plutot que de
   * faire un aller-retour (zoomer, attendre le rendu, puis recentrer) qui se
   * verrait a l'ecran.
   */
  function centrerSurZoneVisible(lonLat, zoomCible) {
    if (!lonLat) return;
    try {
      const z = zoneVisible();
      const ext = sdk.Map.getMapExtent();
      const zoomActuel = sdk.Map.getZoomLevel();
      if (!z.complet && ext && ext.length === 4 && z.rc.width > 0 && z.rc.height > 0) {
        // degres par pixel au zoom courant, puis mis a l'echelle du zoom cible
        const f = (zoomCible == null || zoomCible === zoomActuel)
          ? 1 : Math.pow(2, zoomActuel - zoomCible);
        const dpxLon = ((ext[2] - ext[0]) / z.rc.width) * f;
        const dpxLat = ((ext[3] - ext[1]) / z.rc.height) * f;
        // ecart, en pixels, entre le centre du canevas et celui de la zone visible
        const dx = ((z.gauche + z.droite) / 2) - ((z.rc.left + z.rc.right) / 2);
        const dy = ((z.haut + z.bas) / 2) - ((z.rc.top + z.rc.bottom) / 2);
        // Pour que la cible apparaisse au centre VISIBLE, le centre de la carte
        // doit s'en ecarter en sens inverse. ⚠️ L'axe Y de l'ecran descend, la
        // latitude monte : le signe s'inverse.
        lonLat = { lon: lonLat.lon - dx * dpxLon, lat: lonLat.lat + dy * dpxLat };
      }
      if (zoomCible == null) sdk.Map.setMapCenter({ lonLat });
      else sdk.Map.setMapCenter({ lonLat, zoomLevel: zoomCible });
    } catch (e) {
      // Jamais d'echec silencieux qui laisse la carte immobile : on retombe sur
      // le centrage brut, quitte a ce que la cible soit derriere une fenetre.
      log('centrage sur la zone visible impossible', e);
      try {
        if (zoomCible == null) sdk.Map.setMapCenter({ lonLat });
        else sdk.Map.setMapCenter({ lonLat, zoomLevel: zoomCible });
      } catch (e2) { /* */ }
    }
  }

  /**
   * Amene la carte sur un report. `forcerZoom` passe outre le reglage
   * « zoomer au clic » : une conversion de numero EXIGE le zoom 18 pour que WME
   * descende les numeros — ce n'est plus un confort de lecture, c'est technique.
   */
  function cadrerSur(f, forcerZoom) {
    const geoms = (f.geoms || [f.geom]).filter(g => g && g.coordinates && g.coordinates.length);
    if (!geoms.length) {
      if (f.centre) centrerSurZoneVisible(f.centre, null);
      return;
    }
    // ⚠️⚠️ Chaque type de geometrie imbrique ses coordonnees d'un cran de plus :
    // un Point porte `[lon, lat]`, une ligne `[[lon,lat], …]`, un POLYGONE
    // `[[[lon,lat], …]]`. Etaler `coordinates` a la main marchait pour les deux
    // premiers et donnait des ANNEAUX au lieu de points pour le troisieme :
    // l'emprise partait en NaN et la carte ne bougeait pas. C'est le bug signale
    // par l'auteur le 26/07 — « le clic sur un ecart de POI ne centre pas
    // dessus » — les POI etant justement souvent surfaciques (79 sur 136 mesures).
    // `sommetsDe` aplatit n'importe quelle profondeur : on ne devine plus.
    const tous = [];
    geoms.forEach(g => { tous.push.apply(tous, sommetsDe(g)); });
    if (!tous.length) {
      if (f.centre) centrerSurZoneVisible(f.centre, null);
      return;
    }
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
      // ⚠️ Meme precaution que plus haut : on aplatit au lieu de supposer la
      // profondeur des coordonnees.
      e = emprise(sommetsDe(meilleur));
      z = zoomPour(2 * e.rx, 2 * e.ry, e.centre.lat);
    }

    // Un report d'ADRESSE se regarde de pres : sous le zoom 18, WME n'affiche
    // meme pas les numeros dont on parle (et ne les charge pas non plus).
    if (f.adresse) z = Math.max(z, ZOOM_NUMEROS);
    // ⚠️ Le zoom est passe a `centrerSurZoneVisible` plutot qu'applique apres :
    // le decalage depend de l'echelle d'ARRIVEE, et zoomer ensuite le rendrait
    // faux (l'objet reviendrait sous une fenetre).
    const zoomVoulu = (options.zoomClic || forcerZoom) ? z : null;
    centrerSurZoneVisible(e.centre, zoomVoulu);
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

  /**
   * D'ou viennent les donnees de la derniere analyse. En temps normal on ne dit
   * rien — c'est le fonctionnement attendu. Mais si la lecture directe est
   * tombee, il FAUT que ca se voie : le repli marche, mais il est bien plus
   * lent et il deplace la carte (demande de l'auteur, 22/07).
   */
  /**
   * Une analyse interrompue rend quand meme ses trouvailles — mais il faut dire
   * qu'elles sont PARTIELLES, sinon « aucun ecart plus loin » se lit comme
   * « plus rien a corriger ».
   */
  function bandeauInterrompu() {
    if (!lastScan || !lastScan.interrompu) return '';
    return `<div class="agn-stat agn-alerte">
      <b>⚠ Analyse interrompue.</b> Les reports ci-dessous sont ceux trouves
      avant l'arret : la commune n'a pas ete parcourue en entier.</div>`;
  }

  function bandeauSource() {
    if (!sourceDonnees || sourceDonnees.mode !== 'balayage') return '';
    return `<div class="agn-stat agn-alerte">
      <b>⚠ Lecture directe indisponible — analyse en mode degrade.</b><br>
      La commune a ete parcourue en deplacant la carte, ce qui est beaucoup plus
      lent et peut manquer des objets en bordure.<br>
      <span style="opacity:.85">Motif : ${esc(sourceDonnees.raison || 'inconnu')}</span><br>
      Si ca se reproduit, l'API interne de WME a probablement change : c'est a
      signaler, le script doit être adapte.</div>`;
  }

  /**
   * ⚠️⚠️ UNE VILLE WAZE SANS POLYGONE FAUSSE TOUT — alerte demandee par
   * l'auteur (23/07). Une ville portee par le NOM PRINCIPAL d'un segment
   * signifie « ce segment se dit en agglomeration » (regle FR : hors agglo, le
   * principal n'a pas de ville). Si aucun des segments qui portent cette ville
   * ne tombe dans un polygone, c'est qu'il MANQUE un polygone : tous ces
   * segments vont passer pour hors agglomeration, les ecarts seront faux, et —
   * bien pire — le script proposera de les « corriger » dans le mauvais sens.
   * Meme famille que le blindage de la v1.70, mais sur les agglos SECONDAIRES,
   * que le garde-fou « aucun polygone du tout » ne voyait pas.
   */
  /**
   * Villes annoncees en agglomeration mais mal (ou pas) couvertes par un polygone.
   * Deux degres, parce qu'ils n'ont pas la meme force :
   *  - `aucun`   : AUCUN segment dans un polygone ⇒ il en manque un, c'est sur ;
   *  - `presque` : une PART INFIME seulement ⇒ le polygone existe mais parait
   *                trop petit. Ajoute en v2.10 : le seul test « aucun » laissait
   *                passer « 1 segment sur 27 dans le polygone », ou les 26 autres
   *                recevaient malgre tout des corrections a l'envers.
   *
   * ⚠️ Ce seuil est PROPRE au garde-fou, et n'est PAS `1 - options.seuil`. J'avais
   * d'abord voulu reutiliser le seuil de rattachement par elegance : c'etait faux
   * de sens (constate par les tests). Les deux notions n'ont rien a voir — l'une
   * porte sur la LONGUEUR d'UN segment a cheval, l'autre sur la PROPORTION des
   * segments d'une ville. Pire, `1 - seuil` inversait la logique : un seuil de
   * rattachement plus EXIGEANT (90 %) rendait l'alerte moins sensible (10 %),
   * alors que l'editeur demandait justement plus de rigueur.
   */
  const PART_MIN_EN_POLYGONE = 0.25;

  function villesSansPolygone() {
    if (!lastScan || !lastScan.zones || !lastScan.zones.villes) return [];
    const bas = PART_MIN_EN_POLYGONE;
    return [...lastScan.zones.villes.entries()]
      .map(([nom, v]) => ({ nom, total: v.total, dans: v.dansPolygone,
                            degre: v.dansPolygone === 0 ? 'aucun'
                              : (v.dansPolygone / v.total < bas ? 'presque' : null) }))
      .filter(v => v.degre)
      .sort((a, b) => b.total - a.total);
  }

  function bandeauVillesSansPolygone() {
    const manquantes = villesSansPolygone();
    if (!manquantes.length) return '';
    // ⚠️⚠️ Une analyse INTERROMPUE n'a pas vu toute la commune : les segments qui
    // tombent dans le polygone peuvent etre precisement ceux qui manquent. On
    // n'AFFIRME donc plus rien dans ce cas — meme doctrine que pour les
    // cartouches, qui ne concluent pas sur un recensement partiel (v2.10).
    const partiel = !!(lastScan && lastScan.interrompu);
    const titre = partiel
      ? '⚠️ <b>Zonage a verifier</b> — analyse interrompue, ce constat n\'est pas fiable :'
      : '⚠️ <b>Il manque au moins un polygone.</b>';
    const lignes = manquantes.map(v => v.degre === 'aucun'
      ? '« <b>' + esc(v.nom) + '</b> » est portée par ' + v.total +
        ' segment(s), dont <b>aucun</b> n\'est dans un polygone.'
      : '« <b>' + esc(v.nom) + '</b> » est portée par ' + v.total + ' segment(s), dont ' +
        '<b>' + v.dans + ' seulement</b> dans un polygone — il est probablement trop petit.');
    return '<div class="agn-alerte-bloc">' + titre + '<br>' + lignes.join('<br>') +
      (partiel ? '<br>Relance l\'analyse en entier pour trancher.'
        : '<br>Ces segments se déclarent en agglomération, mais le zonage les place ' +
          'dehors : <b>les écarts les concernant sont faux, et les corrections proposées ' +
          'iraient dans le mauvais sens</b>. Trace le polygone manquant, puis relance.') +
      '</div>';
  }

  /**
   * Libelle FRANCAIS d'une categorie de POI, lu dans les traductions de WME.
   * ⚠️ `I18n` n'est lu qu'ICI, au moment du rendu — donc bien apres les gardes
   * d'attente de WME. Le lire au niveau racine leverait un `ReferenceError`
   * (piege connu, voir [[wme-sdk-pieges]]).
   * Sans traduction, on rend la cle brute plutot que rien : « SHOPPING_AND_SERVICES »
   * reste plus parlant qu'un vide.
   */
  function libelleCategorie(cle) {
    if (!cle) return 'POI';
    try {
      const I = hote.I18n || window.I18n;
      const t = I && I.translations && I.translations[I.locale];
      const v = t && t.venues && t.venues.categories && t.venues.categories[cle];
      if (typeof v === 'string' && v) return v;
    } catch (e) { /* traductions indisponibles : on garde la cle */ }
    return cle;
  }

  /**
   * Bilan de l'onglet POI. ⚠️ On DIT ce qui a ete ecarte volontairement (elements
   * du paysage, POI hors du contour) : un compteur muet laisserait croire que le
   * script n'a rien vu, alors qu'il a decide de ne rien dire.
   */
  function bilanPoi() {
    const s = lastScan, p = s && s.statsPoi;
    if (!p) return '<div class="agn-stat">Analyse non lancée.</div>';
    if (p.indisponible) {
      return '<div class="agn-alerte-bloc">⚠️ <b>Audit des POI indisponible.</b><br>' +
        esc(p.indisponible) + '</div>';
    }
    const n = (s.poi || []).length;
    return '<div class="agn-stat">' +
      '<b>' + n + '</b> POI en écart sur <b>' + p.poiAudites + '</b> audité(s) à ' +
      esc(communeActive.nom) + '.<br>' +
      p.poiConformes + ' conforme(s)' +
      (p.poiHorsCommune ? ' · ' + p.poiHorsCommune + ' hors du contour communal' : '') +
      (p.poiNaturels
        ? ' · <span title="Rivière, fleuve, mer, lac, étang, île, forêt, plantation, canal, marais, plage : ces lieux décrivent le paysage et n\'ont pas d\'adresse postale. Ils sont écartés volontairement.">' +
          p.poiNaturels + ' élément(s) naturel(s) écarté(s)</span>' : '') +
      (p.poiBati
        ? ' · <span title="Zones sans nom qui servent à dessiner le bâti sur l\'écran de l\'application. Ce ne sont pas des adresses : les commerces qu\'elles abritent sont des POI à part entière, eux-mêmes audités.">' +
          p.poiBati + ' bâti(s) sans nom écarté(s)</span>' : '') + '.' +
      (options.controles.poiNumero ? ''
        : '<br><span style="opacity:.8">Le contrôle « numéro de rue manquant » est ' +
          'décoché : il concerne environ la moitié des POI. Coche-le dans les réglages ' +
          'quand tu veux t\'y attaquer.</span>') +
      (p.erreur ? '<br><span class="agn-alerte">Audit des POI : ' + esc(p.erreur) + '</span>' : '') +
      '</div>' + bandeauInterrompu() + bandeauSource();
  }

  function renderResults() {
    const s = lastScan;
    // Ce que l'editeur avait marque « traite » (memorise, meme d'un autre poste)
    // se retrouve coche des la premiere analyse — avant tout affichage.
    appliquerTraites();
    // Chaque onglet ne montre QUE ses propres reports, et son propre bilan :
    // afficher les deux ensemble rendait la liste illisible.
    const liste = findingsVisibles();
    majCompteursOnglets();
    if (s && communeActive) {
      const z = s.zones;
      ui.stats.innerHTML = vueCourante === 'poi'
        ? bilanPoi()
        : vueCourante === 'segments'
        ? `<div class="agn-stat">
        <b>${s.ecarts}</b> segment(s) en écart sur <b>${s.analyses}</b> analyses a ${esc(communeActive.nom)}${
          s.lignes && s.lignes !== s.ecarts ? ', regroupes en <b>' + s.lignes + '</b> report(s)' : ''}.<br>
        ${z.agglo} en agglo · ${z.hors} hors agglo · ${z.cheval} à couper (agglo) · ${z.limCom} à couper (commune)${
          z.mitoyen ? ' · <span title="Voies qui épousent la limite entre deux communes : chacune en possède un côté. Elles portent déjà le nom de la commune, il n\'y a rien à couper.">' +
            z.mitoyen + ' mitoyenne(s) conformes</span>' : ''}${
          z.limitrophe ? ' · ' + z.limitrophe + ' débordent légèrement' : ''}${
          z.cartouche ? ' · ' + z.cartouche + ' cartouche(s) a poser' : ''}${
          z.special ? ' · ' + z.special + ' voie(s) a règle propre' : ''}${
          z.giratoire ? ' · ' + z.giratoire + ' giratoire(s)' : ''}.<br>
        Ignores : ${s.skipped.horsCommune} hors commune, ${s.skipped.sansAdresse} sans adressage, ${s.skipped.horsRegle} règles propres.
      </div>${bandeauVillesSansPolygone()}${bandeauInterrompu()}${bandeauSource()}`
        : `<div class="agn-stat">
        ${s.adr ? '<b>' + s.adr.hnLus + '</b> numéro(s) lu(s) a ' + esc(communeActive.nom) +
            ', dont <b>' + s.adr.hnHorsAgglo + '</b> hors agglomération.<br><b>' +
            s.adr.poiLus + '</b> POI résidentiel(s), dont <b>' + s.adr.poiAgglo + '</b> en agglomération.' +
            (s.adr.hnErreur ? '<br><span class="agn-alerte">Lecture des numéros : ' + esc(s.adr.hnErreur) + '</span>' : '') +
            (s.adr.hnHorsAgglo
              ? '<br><span style="opacity:.8">La conversion cadre elle-même sur les numéros : ' +
                'WME ne les charge qu\'à partir du zoom ' + ZOOM_NUMEROS + '.</span>' : '')
          : 'Analyse non lancee.'}
      </div>${bandeauVillesSansPolygone()}${bandeauInterrompu()}${bandeauSource()}`;
    }
    ui.results.innerHTML = '';
    indexCourant = -1;
    if (!liste.length) {
      ui.results.innerHTML = '<div class="agn-empty">' + (findings.length
        ? 'Aucun écart dans cet onglet — regarde les autres.'
        : 'Aucun écart détecté.') + '</div>';
      return;
    }
    const nav = el(`<div class="agn-nav">
        <button class="agn-btn" id="agn-prec" style="width:auto">‹ Précédent</button>
        <button class="agn-btn" id="agn-suiv" style="width:auto">Suivant ›</button>
        <span id="agn-compteur">— / ${liste.length}</span>
        <span id="agn-traites" class="agn-traites"></span>
        <button class="agn-lien" id="agn-tout" title="Déplie ou replie tous les groupes de résultats">tout déplier</button></div>`);
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

    // ⚠️⚠️ PAS DE CORRECTION EN MASSE SUR LES ADRESSES (arbitrage de l'auteur,
    // 22/07) : la famille `adresse` n'a pas de bouton « ⚡ corriger » de groupe.
    // Convertir un numero en POI residentiel deplace la carte, cree un objet et
    // s'enchaine en general sur son point d'entree — ca se fait un par un, en
    // regardant. Le nommage des segments, lui, garde son bouton de groupe.
    //
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
            ${_ft() && _fv() && cle !== 'adresse' && cle !== 'rpp' && membres.some(planDeCorrection)
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
          'Rien ne sera enregistré : tu reliras dans WME avant de cliquer sur Enregistrer.')) return;
        corriger(aFaire, aFaire.map(x => corps.querySelector('.agn-item[data-idx="' + findings.indexOf(x) + '"]')));
      };

      membres.forEach(f => {
        const node = el(`
          <div class="agn-item agn-${cle}${f.traite ? ' agn-traite' : ''}" data-seg="${f.segId}" data-idx="${findings.indexOf(f)}">
            <div class="agn-h"><span>${esc(f.libelle)}</span>
              ${planDeCorrection(f) && _ft() && f.verrouilles !== f.nb
                ? '<button class="agn-fix-btn" title="Appliquer la correction (sans enregistrer)">⚡</button>' : ''}
              <button class="agn-ok-btn" title="Marquer comme traite">✓</button>
              <span class="agn-cas">${f.cas}</span></div>
            <div class="agn-note">${f.poi
              ? esc(libelleCategorie(f.categorie))
              : f.adresse
                ? (f.sousType === 'hn' ? 'Numéros de rue' : 'POI résidentiel')
                : (ROADTYPE_LABEL[f.roadType] || f.roadType)} · ${
              f.poi
                ? 'POI ' + esc(String(f.venueId || '').slice(-8))
                : f.adresse
                ? (f.sousType === 'hn'
                    ? '<b class="agn-nb">' + f.nb + ' numero' + (f.nb > 1 ? 's' : '') + '</b> · #' + f.segId
                    : 'POI ' + f.segId)
                : f.nb > 1 ? '<b class="agn-nb">' + f.nb + ' segments</b>' : '#' + f.segId}${
              f.verrouilles ? ' · <b class="agn-lock" title="Verrouillés au-dessus de ton niveau : non modifiables">🔒 ' +
                f.verrouilles + '</b>' : ''}${
              f.disperse ? ' · <span class="agn-note" title="Troncons eloignes : la carte se pose sur le plus long">eparpilles</span>' : ''}</div>
            ${f.ecarts.map(e => `<div class="agn-d"><b>${e.champ}</b> : ${esc(e.avant)} → ${esc(e.apres)}</div>`).join('')}
            ${f.aide && f.aide.length ? `<div class="agn-aide">${
              f.aideTitre ? '<b>🛠 ' + esc(f.aideTitre) + '</b>' : ''}${
              f.aide.map(t => '<div class="agn-aide-l">' + esc(t) + '</div>').join('')}</div>` : ''}
            ${f.doute ? `<div class="agn-warn">⚠ ${esc(f.doute)}</div>` : ''}
            ${f.adresse && f.sousType === 'hn' && !f.rueCible
              ? '<div class="agn-warn">⚠ Nom de rue introuvable ou ambigu sur ce segment : ' +
                'la conversion ne peut pas être proposée.</div>'
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

    await chargerPrefs();   // polygones + sans-agglo + traites (WMEPrefs, repli local)
    buildOverlay();
    installerFab();
    ensureLayers();
    installerInfobulle();
    surveillerErreursEnregistrement();

    // Le panneau lateral porte les REGLAGES ; l'overlay porte le travail.
    const { tabLabel, tabPane } = await sdk.Sidebar.registerScriptTab();
    tabLabel.textContent = '🏙️';
    tabLabel.title = SCRIPT_NAME;
    tabLabel.style.fontSize = '15px';
    buildReglages(tabPane);

    await restaurerContours();
    renderContours();
    // ⚠️ AVANT le premier rendu : `renderAgglos` lit l'etat territorial pour
    // decider quels boutons ouvrir. Au demarrage, WME n'a souvent encore rien
    // charge — l'etat reste « inconnu » et la surveillance de la carte le
    // corrigera d'elle-meme dans la seconde qui suit.
    evaluerPays();
    rafraichirCommunesDeLaVue();
    renderAgglos();
    if (ui.overlay.style.display === 'none') nettoyerCarte();
    // ⚠️ Rien a se mettre sous la dent = volet OUVERT, pour montrer par ou
    // commencer (demande de l'auteur, 22/07). « Rien » ne veut pas seulement
    // dire « aucun contour » : tant qu'aucune commune n'est choisie, il n'y a
    // pas de travail possible, et une fenetre vide avec un bouton grise
    // n'explique rien. Des qu'une commune est en cours, on rend la place.
    if (!communes.length || !communeActive) basculerVolet(true);

    let debounce = null;
    try {
      sdk.Events.on({ eventName: 'wme-map-move-end', eventHandler: () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          // Le garde-fou territorial se reevalue a chaque arret de la carte :
          // c'est ce qui rend le blocage reversible sans rechargement.
          evaluerPays();
          rafraichirCommunesDeLaVue();
          // ⚠️ Apres le rafraichissement, pas avant : si les contours sont deja
          // la, il n'y a rien a telecharger et rien ne part sur le reseau.
          autoChargerDepartement().then(rafraichirCommunesDeLaVue);
        }, 700);
        dessinerPoignees(); } });
    } catch (e) { log('abonnement au déplacement impossible', e); }

    // Au demarrage aussi : l'editeur arrive souvent deja pose sur sa zone.
    autoChargerDepartement().then(rafraichirCommunesDeLaVue);

    log('v' + VERSION + ' pret — fenêtre flottante — ' +
      (communes.length ? communes.length + ' commune(s)' : 'aucun contour'));
  }

  init().catch(e => console.error('[' + SCRIPT_NAME + '] echec du demarrage :', e));
})();
