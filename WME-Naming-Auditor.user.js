// ==UserScript==
// @name         WME Naming Auditor
// @namespace    https://github.com/DrSlump34
// @version      2.31.00
// @description  FRANCE UNIQUEMENT (pour l'instant) : audit du nommage et de l'adressage des voies selon les règles d'édition françaises (agglomération / hors agglomération, contours communaux INSEE). D'autres pays sont prévus par l'architecture, mais AUCUN n'est encore pris en charge.
// @author       DrSlump34
// @license      MIT
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgdmlld0JveD0iMCAwIDY0IDY0Ij48cmVjdCB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHJ4PSIxMiIgZmlsbD0iIzFlODhlNSIvPjxwYXRoIGQ9Ik0zMSAxNEgyMGE2IDYgMCAwIDAtNiA2djExYTYgNiAwIDAgMCAxLjc2IDQuMjRsMTUgMTVhNiA2IDAgMCAwIDguNDggMGwxMS0xMWE2IDYgMCAwIDAgMC04LjQ4bC0xNS0xNUE2IDYgMCAwIDAgMzEgMTR6IiBmaWxsPSIjZmZmIi8+PGNpcmNsZSBjeD0iMjMiIGN5PSIyMyIgcj0iMy41IiBmaWxsPSIjMWU4OGU1Ii8+PC9zdmc+
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
// @connect      docs.google.com
// @connect      googleusercontent.com
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
   * d'abord le `@version` reel (Tampermonkey l'expose dans `GM_info`), et le
   * repli ne sert que pour le test par injection, ou GM_info n'existe pas.
   * ⚠️ Le repli etait un NUMERO ecrit a la main ('2.18') : il n'avait pas suivi
   * neuf versions et affichait donc exactement le mauvais numero que ce bloc
   * cherche a eviter. Un repli qui doit etre maintenu se perime — on prefere
   * '?', qui n'affirme rien (recette reprise de WCT). Ne pas y remettre un
   * numero.
   */
  const VERSION = (() => {
    try { if (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) return GM_info.script.version; }
    catch (e) { /* pas de Tampermonkey : on prend le repli */ }
    return '?';
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
    // ⚠️ MESURE, PAS ECART — et la couleur le dit : un GRIS neutre, quand toutes
    // les familles d'ecarts sont saturees. Un cas qu'aucune regle n'interdit ne
    // doit pas s'allumer sur la carte comme un defaut.
    hnRoute: { libelle: '📏 Mesure : numéro sur une voie « Dxxx » (pas un écart)',
               defaut: '#90a4ae' },
    // Les VRAIS POI (v2.15) : famille a part, pour ne pas les confondre avec les
    // RPP sur la carte — ce sont deux sujets differents.
    poiAdresse: { libelle: 'POI : adresse en écart', defaut: '#ffab00' },
    // Les panneaux ne sont pas des ecarts : ils ne passent pas par `familleDe`,
    // mais leurs deux couleurs se reglent au meme endroit que les autres.
    panneauNeutre: { libelle: 'Panneau relevé (rien à confronter)', defaut: '#546e7a' },
    panneauOk: { libelle: 'Panneau dans un polygone', defaut: '#00e676' },
    panneauHors: { libelle: 'Panneau HORS polygone', defaut: '#ff1744' }
  };
  // ⚠️⚠️ LA MESURE PASSE EN PREMIER, ET SE RANGE A PART. Elle porte
  // `adresse:true` et `sousType:'hn'` comme un vrai ecart : sans ce test en
  // tete, elle atterrissait dans « Numéro de rue hors agglomération » et se
  // lisait comme un defaut a corriger — exactement ce qu'elle n'est pas.
  const familleDe = f => f.mesure ? 'hnRoute'
    : f.poi ? 'poiAdresse'
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

  // ===========================================================================
  // DICTIONNAIRE DE REDACTION FR — emprunte a WME Check Road Name (CRN)
  //
  // ⭐ ON NE REECRIT PAS CE QUI EXISTE. La communaute FR maintient depuis 2015
  // un dictionnaire de ~1 430 regles de redaction (abreviations, titres,
  // accents, prenoms, apostrophes, casse des articles, numeros de route) dans
  // deux feuilles Google publiques, pilotees par le script WME Check Road Name
  // de buchet37 (GreasyFork 3776). Ecrire nos propres regles serait moins bon
  // des le premier jour, et divergerait aussitot.
  //
  // ⚡ MESURE DE FAISABILITE (01/08, hors ligne, sur les 2 feuilles reelles) :
  // 1 428 regles chargees sur 1 434 ; 19 ecarts vus sur 19 noms fautifs ;
  // 0 faux positif sur 7 noms deja corrects, « D18 » compris.
  //
  // ⚠️⚠️ AUCUN eval, JAMAIS. Les feuilles contiennent des cellules qui sont du
  // CODE (« function(a) {return(a.toUpperCase());} »). Les evaluer reviendrait
  // a executer, dans le navigateur de l'editeur, du JavaScript ecrit par
  // quiconque a le droit d'edition sur un classeur partage. On les reconnait
  // donc par TABLE DE CORRESPONDANCE EXACTE, et une cellule non reconnue est
  // IGNOREE. CRN procede de meme depuis qu'il a retire son eval.
  //
  // ⚠️ LA LIMITE MESUREE, ET ELLE COMMANDE UN GARDE-FOU : le dictionnaire ne
  // sait PAS redresser un nom tout en MAJUSCULES — il suppose une casse deja a
  // peu pres correcte. Mesure sur 12 noms en capitales : 3 sorties franchement
  // cassees (« RUE DES ECOLES » donne « RUE DES ÉcolES », parce que la regle
  // des ecoles restitue ses groupes tels quels) et 9 batardes (« ROUTE de
  // PARIS »). ⇒ `ecartDeRedaction` REFUSE de proposer quoi que ce soit dans ce
  // cas : on signale la capitale, on ne devine pas le nom.
  // ===========================================================================

  /**
   * ✅ ACCORD DE L'AUTEUR DES DICTIONNAIRES — buchet37, 2026-08-03 :
   * « Quant a l'emploi des dico par un autre script, je n'y vois aucune
   *   objection. Comme dit, ils sont le resultat d'un travail communautaire. »
   *
   * ⚠️⚠️ SA SEULE RESERVE, ET ELLE NOUS ENGAGE : « Peut-etre eviter l'acces
   * direct au dico pour modif (mon bouton "FRA"), pour eviter que des
   * utilisateurs "non utilisateurs de CRN" y aient acces et fassent des
   * betises. » ⇒ WNA LIT, ET RIEN D'AUTRE : la seule URL construite est
   * `export?format=csv` (lecture), aucune interface n'expose de lien vers les
   * classeurs, et l'aide renvoie vers CRN pour qui veut proposer une regle.
   * Ne JAMAIS ajouter de raccourci d'edition, meme « pour rendre service ».
   * Verrou de test : voir tools/test-dictionnaire.js, tests 31-34.
   */
  const DICO_FEUILLES = [
    // Dictionnaire principal FR (regles generiques) puis dictionnaire public
    // (contributions : sigles, patronymes, lieux). Les numeros de ligne du
    // second sont decales de 2000, comme chez CRN, pour qu'un signalement
    // designe la bonne feuille.
    //
    // ⚠️ CE QUE BUCHET37 NOUS A APPRIS LE 03/08 — LES DEUX N'ONT PAS LE MEME
    // STATUT, ET CE N'EST PLUS CELUI D'ORIGINE. Le montage initial (le public
    // = antichambre de regles nouvelles, promues au principal une fois
    // validees) a ete ABANDONNE, « trop complexe, et ce qui etait valide un
    // jour ne l'etait peut-etre plus ensuite ». Aujourd'hui :
    //   - `principal` est FIGE dans son etat actuel et ne devrait plus bouger ;
    //   - `public` VIT au gre des editeurs, sans validation prealable (son
    //     mainteneur lui-meme n'est pas toujours d'accord avec les regles qui
    //     y entrent).
    // ⇒ On le charge quand meme (c'est celui que la communaute fait vivre, et
    //    c'est celui que CRN applique), mais l'aide le DIT : une proposition de
    //    ce dictionnaire n'est pas une regle arbitree, elle se relit.
    { cle: '1fZNOmDQSYgAam6Lj3z9YpNFu0-Sb6AjAyFdy_dH-roA', depart: 1, nom: 'principal' },
    { cle: '1T-UVFQtp5OrKqMZPRsfRBMohIAwdgNoWQcA6Ry4UEgA', depart: 2001, nom: 'public' }
  ];
  /**
   * ⚠️⚠️ MESURE DU 03/08 — POURQUOI IL Y A **DEUX** @connect POUR UNE SEULE URL.
   *
   * `docs.google.com/…/export?format=csv` ne sert pas le CSV : il repond une
   * **307** vers `doc-0k-50-sheets.googleusercontent.com` (mesure a la trace :
   * 1 redirection, puis 200). Or Tampermonkey applique la liste `@connect` a
   * **CHAQUE saut de redirection**, pas seulement au premier. Avec le seul
   * `@connect docs.google.com`, le second saut est refuse, `GM_xmlhttpRequest`
   * tombe dans `onerror`, et l'editeur lit « appel refuse » sans savoir pourquoi
   * — symptome exact remonte par l'auteur au premier test live.
   *
   * ⇒ `@connect googleusercontent.com` est indispensable, et c'est le domaine
   *   **PARENT** qu'il faut declarer : le sous-domaine (`doc-0k-50-…`) change
   *   d'un appel a l'autre, l'ecrire en dur ne tiendrait pas.
   * ⚠️ Ne pas « simplifier » en retirant l'un des deux : les deux sauts sont
   *   controles separement. Verrou de test : tools/test-dictionnaire.js, n°36.
   */
  const dicoUrl = cle => 'https://docs.google.com/spreadsheets/d/' + cle + '/export?format=csv';

  /**
   * Cellules-fonctions reconnues, par correspondance EXACTE de la chaine.
   * ⚠️ Ne jamais remplacer cette table par une evaluation dynamique : c'est le
   * seul rempart entre un classeur partage et le navigateur de l'editeur.
   */
  const DICO_FONCTIONS = (() => {
    const t = {
      'function(a) {return(a.toUpperCase());}': a => a.toUpperCase(),
      'function(a) {return(a.toLowerCase());}': a => a.toLowerCase(),
      'function(a,x,y) {return(x+y.toUpperCase());}': (a, x, y) => x + y.toUpperCase(),
      'function(a,x,y) {return(x+y.toLowerCase());}': (a, x, y) => x + y.toLowerCase(),
      'function(a,x,y) {return(x.toUpperCase()+y.toLowerCase());}': (a, x, y) => x.toUpperCase() + y.toLowerCase()
    };
    // Familles « split/join » : reaccentuer une voyelle. La classe de caracteres
    // et la lettre visee viennent du libelle lui-meme, ce qui evite d'ecrire les
    // 24 variantes a la main.
    [['éeèëê', 'e'], ['oöô', 'o'], ['iïî', 'i'], ['uüûù', 'u'], ['aàä', 'a']].forEach(([classe]) => {
      for (const cible of classe) {
        t['function(a) {return(a.split(/[' + classe + ']/i).join(\'' + cible + '\'));}'] =
          a => a.split(new RegExp('[' + classe + ']', 'i')).join(cible);
      }
    });
    t['function(a) {return(a.split(/c/i).join(\'ç\'));}'] = a => a.split(/c/i).join('ç');
    return t;
  })();

  /**
   * Analyse une feuille CSV en liste de regles. PURE.
   * Reprend la grammaire de CRN : une ligne utile commence par « / », « // » est
   * un commentaire, la virgule separe les colonnes et « @ » y represente une
   * virgule litterale (contrainte du format CSV cote redacteurs).
   */
  function analyserDictionnaire(texte, depart) {
    const regles = [];
    let ignorees = 0, invalides = 0;
    const lignes = String(texte || '').replace(/\t\t/g, '\t').replace(/\r/g, '\n').split('\n');
    lignes.forEach((brute, i) => {
      let ligne = brute;
      if (ligne.indexOf('"') === 0) ligne = ligne.replace(/^"/, '').replace(/",/, ',');
      if (ligne.indexOf('/') !== 0 || ligne.indexOf('//') === 0) return;
      const pos = ligne.indexOf('//');
      if (pos !== -1) ligne = ligne.substring(0, pos - 1);
      ligne = ligne.replace(/"""/g, '"').replace(/""/g, '"');
      const champs = ligne.split(/,/);
      if (champs.length < 2) return;
      let motifBrut = champs[0];
      if (motifBrut.substring(0, 1) !== '/') motifBrut = '/' + motifBrut + '/';
      const fin = motifBrut.lastIndexOf('/');
      const motif = motifBrut.substring(1, fin).replace(/@/g, ',');
      const flags = motifBrut.substring(fin + 1).replace(/"/g, '');
      let corr = champs[1].replace(/[ ]*$/g, '').replace(/@/g, ',');
      if (corr === '()') corr = '("")';
      let remplacement;
      if (corr[0] === '"') {
        remplacement = corr.slice(1, corr.length - 1);
      } else if (corr.slice(0, 8) === 'function') {
        remplacement = DICO_FONCTIONS[corr];
        if (!remplacement) { ignorees++; return; }   // cellule-code non reconnue : on passe
      } else { return; }
      let re;
      try { re = new RegExp(motif, flags); } catch (e) { invalides++; return; }
      regles.push({ ligne: i + depart, re, remplacement });
    });
    return { regles, ignorees, invalides };
  }

  /** Nettoyage d'encadrement de CRN (`genericCorrection`), avant ET apres la
   *  cascade : espaces multiples, espaces de tete et de queue. PURE. */
  const nettoyerNom = n => String(n || '').replace(/ +/g, ' ').replace(/^[ ]*/g, '').replace(/[ ]*$/g, '');

  /**
   * Applique la cascade complete a un nom. PURE.
   * ⚠️ L'ORDRE DES REGLES EST SIGNIFIANT (le dictionnaire s'appuie dessus :
   * encadrement par des espaces, puis traitements, puis retrait). Ne pas trier,
   * ne pas dedupliquer, ne pas paralleliser.
   */
  function appliquerDictionnaire(nom, regles) {
    let s = nettoyerNom(nom);
    const lignes = [];
    for (const r of (regles || [])) {
      const avant = s;
      try { s = s.replace(r.re, r.remplacement); } catch (e) { continue; }
      if (s !== avant) lignes.push(r.ligne);
    }
    return { nom: nettoyerNom(s), lignes };
  }

  /**
   * Un nom est « en capitales » des qu'il porte au moins deux mots alphabetiques
   * d'au moins DEUX lettres sans la moindre minuscule. Ce critere epargne les
   * numeros de route (« D18 », « A9 »), les sigles seuls (« ZA ») et les
   * abreviations a points (« T.I.V. », dont les lettres sont isolees). PURE.
   *
   * ⚠️⚠️ LE SEUIL EST PASSE DE 3 A 2 LETTRES LE 03/08, ET C'EST UN CORRECTIF DE
   * SURETE, PAS UN REGLAGE. A 3 lettres, « AV. DU CHATEAU » ne laissait qu'UN
   * seul mot (« CHATEAU ») : le garde-fou ne se declenchait pas, et le nom
   * partait au dictionnaire comme un nom ordinaire.
   *
   * ⚡ MESURE SUR LES VRAIES FEUILLES CRN (1 428 regles) — ce que le
   * dictionnaire produisait alors :
   *     AV. DU CHATEAU   -> « Avenue DU ChâtEAU »
   *     BD DE LA GARE    -> « Boulevard de la GARE »
   *     PL. DE L EGLISE  -> « Place de L Église »
   * Trois noms batards. Tant que la redaction n'etait qu'AFFICHEE, l'editeur les
   * voyait et ne les appliquait pas. Depuis que le ⚡ sait ecrire une correction
   * de redaction (v2.30.00), ils seraient POSES SUR LA CARTE.
   *
   * ⭐ La lecon, et c'est la deuxieme fois sur ce dictionnaire : un garde-fou
   * suffisant pour un AFFICHAGE ne l'est plus des qu'on ECRIT. Le changement
   * dangereux n'etait pas dans le garde-fou, il etait dans ce qu'on fait de sa
   * sortie. ⇒ Verrous : tools/test-dictionnaire.js 13-18 et
   * tools/test-redaction-eclair.js 11-12b.
   */
  function nomEnCapitales(nom) {
    const mots = String(nom || '').split(/[^A-Za-zÀ-ÿ]+/).filter(m => m.length >= 2);
    if (mots.length < 2) return false;
    return mots.every(m => m === m.toUpperCase()) && /[A-ZÀ-Ý]/.test(nom);
  }

  /**
   * Confronte un nom au dictionnaire et rend un ecart, ou `null`. PURE.
   *
   * ⭐ TROIS REFUS DELIBERES, parce qu'une correction devinee coute plus cher
   * qu'un silence :
   *  1. nom en CAPITALES : le dictionnaire n'est pas fait pour ca (mesure du
   *     01/08) — on signale la capitale, sans proposer de nom ;
   *  2. proposition vide : une regle mal ecrite effacerait le nom ;
   *  3. proposition identique a la casse et aux accents pres de rien du tout —
   *     deja couvert par le point 2, garde ici pour etre explicite.
   */
  function ecartDeRedaction(nom, regles) {
    const origine = String(nom || '').trim();
    if (!origine || !regles || !regles.length) return null;
    if (nomEnCapitales(origine)) {
      // ⚠️ Libelle COURT : il s'affiche dans une colonne de tableau. Le pourquoi
      // est dans l'aide (section « Ce que chaque controle verifie »).
      // ⚠️⚠️ AUCUN BOUTON ⚡ NE PEUT NAITRE DE CET ECART, ET C'EST DELIBERE.
      // Depuis la v2.30.00, `planDeCorrection` SAIT appliquer une correction de
      // redaction — mais il ne reconnait que le champ « rédaction (dictionnaire
      // FR) », et il refuse en plus tout ecart marque `sansProposition`. Ce
      // cas-ci porte un AUTRE champ (« nom en capitales ») ET le drapeau : deux
      // verrous, parce qu'il n'y a ici aucun nom juste a ecrire.
      // (Avant la v2.30.00 la garantie venait de ce qu'AUCUNE redaction n'etait
      // applicable. Ce n'est plus vrai — ne pas se fier a l'ancienne lecture.)
      return { champ: 'nom en capitales', avant: origine,
        apres: 'à réécrire en minuscules accentuées (nom non proposé)',
        sansProposition: true };
    }
    const res = appliquerDictionnaire(origine, regles);
    if (!res.nom || res.nom === origine) return null;
    return { champ: 'rédaction (dictionnaire FR)', avant: origine, apres: res.nom,
             lignes: res.lignes };
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
  // Dictionnaire de redaction FR : regles chargees + de quoi le DIRE dans l'UI.
  // ⭐ « Pas charge » est un RESULTAT, pas un silence : sans cet etat, un
  // controle coche qui ne trouve rien se lit comme « tout est propre » alors
  // que le reseau a peut-etre echoue (meme lecon que le zero de la v2.26).
  let dico = { regles: [], etat: 'attente', detail: '', ignorees: 0, feuilles: 0 };
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
    // ⚠️ Infobulle de survol : COCHEE par defaut (c'est un apport apprecie —
    // « très très utile », Glenan56, 27/07), mais debrayable. Signale le meme
    // jour : d'AUTRES SCRIPTS posent leur propre bulle au survol, et les deux se
    // recouvrent. On ne peut pas arbitrer chez le voisin ; on peut se taire.
    bulleSurvol: true,
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
    // Guidage pas a pas (v2.21) : montre le geste suivant tant qu'il reste
    // quelque chose a faire. Decochable — un editeur qui connait l'outil n'a pas
    // besoin qu'on lui tienne la main a chaque commune.
    guidage: true,
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

  /**
   * ⚠️⚠️ DEUX ONGLETS WME S'ECRASAIENT L'UN L'AUTRE — defaut trouve le 27/07 en
   * cherchant tout autre chose (l'auteur en avait deux ouverts).
   *
   * Chaque onglet charge les prefs UNE FOIS au demarrage et gardait sa copie en
   * memoire. `sauverPrefs` reecrivait ensuite l'objet ENTIER : le dernier onglet
   * a sauvegarder effacait donc, EN SILENCE, tout ce que l'autre avait fait
   * depuis — un polygone trace dans l'onglet A disparaissait des que l'onglet B
   * cochait une ligne. Ce ne sont pas des reglages qui se perdaient la, c'est le
   * travail de zonage.
   *
   * ⇒ On RELIT le stockage juste avant d'ecrire, et on FUSIONNE par cle. C'est
   * la meme regle que celle apprise sur les preferences d'interface : ne jamais
   * remplacer un objet dont on ne possede qu'une partie.
   *
   * PURE, donc eprouvable sans navigateur ni stockage.
   *
   * REGLE DE FUSION, cle par cle :
   *  - une cle que CET onglet ne connait pas (jamais chargee, jamais touchee)
   *    est conservee telle quelle depuis le stockage ;
   *  - une cle presente en memoire fait FOI : c'est le geste que l'editeur vient
   *    de faire ici, y compris quand il a tout efface.
   * ⚠️⚠️ C'est pour cela qu'une commune videe garde desormais sa cle (tableau
   * vide) au lieu d'etre supprimee : sans cette trace, la fusion ne pourrait pas
   * distinguer « je n'ai jamais vu cette commune » de « je viens de l'effacer »,
   * et RESSUSCITERAIT le polygone supprime a la sauvegarde suivante.
   */
  function fusionnerPrefs(distant, local) {
    const d = distant || {}, l = local || {};
    const union = (a, b) => Object.assign({}, a || {}, b || {});
    // `traites` a DEUX niveaux ({INSEE: {cle: true}}) : l'union au premier niveau
    // suffit — un onglet ne travaille que sur une commune a la fois, et sa vue de
    // CETTE commune est la bonne (decochages compris).
    return {
      agglos: union(d.agglos, l.agglos),
      sansAgglo: union(d.sansAgglo, l.sansAgglo),
      traites: union(d.traites, l.traites)
    };
  }

  /**
   * Ecrit l'etat courant dans le gestionnaire (+ miroir localStorage).
   *
   * ⚠️ Les ecritures sont SERIALISEES : deux `sauverPrefs()` lances coup sur coup
   * (cocher plusieurs lignes vite) reliraient tous les deux l'etat d'AVANT et le
   * second annulerait le premier — la course qu'on vient justement de corriger,
   * en plus petit.
   */
  let chaineSauvegarde = Promise.resolve();
  function sauverPrefs() {
    if (!prefsPret) return chaineSauvegarde;   // avant chargement : ne rien ecraser
    chaineSauvegarde = chaineSauvegarde.then(async () => {
      let distant = {};
      // ⚠️ Une relecture qui echoue ne doit PAS faire perdre l'ecriture : on
      // repart alors de ce qu'on a, comme avant. Mieux vaut le comportement
      // d'hier qu'aucune sauvegarde.
      try { distant = (await prefs.load()) || {}; } catch (e) { log('WMEPrefs relecture', e); }
      const fusion = fusionnerPrefs(distant, { agglos, sansAgglo, traites });
      // La memoire de CET onglet adopte la fusion : sans ca, il continuerait a
      // ignorer le travail de l'autre jusqu'au prochain rechargement de page.
      agglos = fusion.agglos; sansAgglo = fusion.sansAgglo; traites = fusion.traites;
      await prefs.save(fusion);
    }).catch(e => log('WMEPrefs save', e));
    return chaineSauvegarde;
  }
  const saveAgglos = () => sauverPrefs();
  const saveSansAgglo = () => sauverPrefs();
  const saveTraites = () => sauverPrefs();

  /**
   * Un AUTRE onglet vient d'ecrire : on se remet a jour au lieu de continuer sur
   * une copie perimee. `WMEPrefs` double son stockage d'un miroir localStorage,
   * et l'evenement `storage` ne se declenche QUE dans les autres onglets — donc
   * aucune boucle avec nos propres sauvegardes.
   *
   * ⚠️ On ne touche a rien pendant une EDITION de polygone : l'objet en cours
   * d'edition serait remplace sous les poignees.
   */
  function ecouterAutresOnglets() {
    window.addEventListener('storage', e => {
      if (!prefsPret || !e || e.key !== prefs.cle) return;
      if (edition) return;                       // trace ouvert : on ne bouge pas
      chargerPrefs().then(() => {
        try { redrawAgglos(); renderAgglos(); redrawEcarts(null); }
        catch (err) { log('rafraichissement apres ecriture d\'un autre onglet', err); }
      }).catch(err => log('relecture apres storage', err));
    });
  }

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
      // ⚠️ Depuis la 2.26.04 une case DECOCHEE se stocke `false` au lieu d'etre
      // supprimee (pour la fusion multi-onglets). Un fichier de partage peut donc
      // en contenir : l'importer comme une declaration inverserait le choix de
      // celui qui l'a envoye.
      if (!p.sansAgglo[insee]) continue;
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
      // ⚠️ `mairie` n'existe que sur les contours telecharges depuis la v2.23 :
      // elle est facultative partout ou elle sert.
      const m = f.properties && f.properties.mairie;
      const mairie = (m && Array.isArray(m.coordinates)) ? m.coordinates
        : (Array.isArray(m) && typeof m[0] === 'number') ? m : null;
      out.push({ code: code || nom, nom, geom: f.geometry, bbox: bboxOf(f.geometry), mairie });
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

  /**
   * Charge les deux feuilles du dictionnaire FR. Ne rejette JAMAIS : un echec
   * reseau laisse le controle muet mais l'etat le DIT (voir `dico.etat`).
   * ⚠️ Les deux feuilles sont demandees en parallele, mais concatenees dans
   * l'ordre principal PUIS public : la cascade en depend.
   */
  function chargerDictionnaireFr() {
    // ⚠️ Les seules requetes que WNA adresse a buchet37 partent d'ici, et elles
    // sont en LECTURE (`export?format=csv`). Sa reserve du 03/08 porte sur
    // l'ecriture : ne jamais ouvrir de chemin vers l'edition des classeurs.
    dico = { regles: [], etat: 'chargement', detail: '', ignorees: 0, feuilles: 0 };
    return Promise.all(DICO_FEUILLES.map(f =>
      telecharger(dicoUrl(f.cle))
        .then(txt => ({ f, res: analyserDictionnaire(txt, f.depart) }))
        .catch(e => ({ f, err: e }))
    )).then(sorties => {
      const regles = [];
      let ignorees = 0, ok = 0, principaleLa = false;
      const soucis = [];
      sorties.forEach(s => {
        if (s.err) { soucis.push(s.f.nom + ' : ' + s.err.message); return; }
        regles.push(...s.res.regles);
        ignorees += s.res.ignorees;
        ok++;
        if (s.f.nom === 'principal') principaleLa = true;
      });
      // ⚠️⚠️ LA FEUILLE PRINCIPALE N'EST PAS UNE FEUILLE PARMI DEUX.
      // Presque toutes les regles exigent un espace avant ET apres leur motif ;
      // elles ne matchent que grace a la regle d'encadrement « /^(.*)$/ » qui
      // n'existe QUE dans la principale. Sans elle, la cascade se tait sur
      // presque tout — sans rien dire, donc en affirmant « aucun defaut ».
      // ⇒ On prefere l'echec franc au faux « tout va bien ». (Decouvert en
      // ecrivant tools/test-dictionnaire.js, tests 29-30.)
      if (ok && !principaleLa) {
        soucis.push('feuille principale absente : les règles ne peuvent pas s\'appliquer');
      }
      const utilisable = ok > 0 && principaleLa;
      dico = {
        regles: utilisable ? regles : [], ignorees, feuilles: ok,
        etat: !utilisable ? 'echec' : (ok === DICO_FEUILLES.length ? 'ok' : 'partiel'),
        detail: soucis.join(' · ')
      };
      log('dictionnaire FR : ' + regles.length + ' règle(s), ' + ok + '/' +
          DICO_FEUILLES.length + ' feuille(s)' +
          (ignorees ? ', ' + ignorees + ' cellule(s) de code non reconnue(s) et ignorée(s)' : '') +
          (soucis.length ? ' — ' + soucis.join(' · ') : ''));
      return dico;
    });
  }

  /**
   * Dit OU EN EST le dictionnaire, sous la liste des controles.
   * ⭐ Un controle coche qui ne rend rien doit pouvoir s'expliquer : sans cette
   * ligne, un echec reseau se lirait « aucun defaut de redaction ».
   */
  function majEtatDico(force) {
    let n;
    try { n = document.getElementById('agn-r-dico'); } catch (e) { return; }
    if (!n) return;
    const etat = force || dico.etat;
    if (!options.controles.redactionDico) {
      n.innerHTML = crnPresent()
        ? '🏷️ Dictionnaire de rédaction : <b>inactif</b> — WME Check Road Name est installé ' +
          'et dit déjà la même chose. Cocher la case ci-dessus pour l\'activer quand même.'
        : '🏷️ Dictionnaire de rédaction : inactif.';
      return;
    }
    if (etat === 'chargement' || etat === 'attente') {
      n.textContent = '🏷️ Dictionnaire de rédaction : chargement…'; return;
    }
    if (etat === 'echec') {
      n.innerHTML = '⚠️ Dictionnaire de rédaction <b>non chargé</b> — le contrôle est coché ' +
        'mais ne peut rien signaler' + (dico.detail ? ' (' + esc(dico.detail) + ')' : '') + '.';
      return;
    }
    n.innerHTML = '🏷️ ' + dico.regles.length + ' règle(s) de rédaction chargée(s)' +
      (etat === 'partiel' ? ' — <b>une seule feuille sur deux</b>' +
        (dico.detail ? ' (' + esc(dico.detail) + ')' : '') : '') +
      '. Source : dictionnaire communautaire FR de <b>WME Check Road Name</b> (buchet37).';
  }

  /**
   * WME Check Road Name est-il installe dans cet onglet ?
   * ⭐ ON NE DOUBLONNE PAS UN VOISIN QUI FAIT DEJA LE TRAVAIL : CRN pose la
   * meme correction de redaction, a partir du meme dictionnaire. Deux scripts
   * qui disent la meme chose au meme moment, c'est du bruit, pas de l'aide.
   * ⚠️ CRN peut demarrer APRES nous : ne pas figer ce verdict au demarrage,
   * l'interroger au moment ou l'on s'en sert.
   */
  function crnPresent() {
    try {
      if (hote && typeof hote.WME_CRN_onload !== 'undefined') return true;
      return !!document.querySelector('#WME_CRN_DialogBox, #WME_CRN_Dictionary');
    } catch (e) { return false; }
  }

  const SOURCES = {
    fichier: { libelle: 'Fichier GeoJSON local' },
    gouv: {
      libelle: 'API Découpage administratif (geo.api.gouv.fr)',
      // Contours Admin Express (IGN) + Code Officiel Geographique (INSEE).
      // ⚠️ `mairie` est demandee depuis la v2.23 : c'est le repere du BOURG
      // PRINCIPAL — celui qui porte le nom de la commune. Il sert a presenter
      // les secteurs d'entrees dans le bon ordre sur les communes a hameaux.
      // ⚠️ Les contours deja en base ne l'ont pas : tout ce qui s'en sert doit
      // savoir s'en passer (repli sur le centre du contour).
      url: dep => 'https://geo.api.gouv.fr/departements/' + encodeURIComponent(dep) +
        '/communes?fields=nom,code,contour,mairie&format=geojson&geometry=contour',
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
  /**
   * ⚠️⚠️ LE SONDAGE DOIT POUVOIR DESCENDRE D'UN CRAN — MESURE DU 27/07.
   *
   * Signale par l'auteur sur **Saint-Geniès-de-Comolas** : « le bouton des
   * panneaux est actif alors que la source n'en propose aucun ». Verifie sur la
   * source, et il avait raison sur le fond : la commune n'a **AUCUN** panneau
   * (releve complet : 148 EB dans la bbox, **0 dans le contour**). Mais le
   * sondage tenait en UNE cellule, et cette cellule **sature a 500 items** — les
   * B14 (limitations de vitesse) remplissent le quota bien avant les EB10 dans
   * la vallee du Rhone. Il repondait donc « incertain » par prudence, et
   * laissait le bouton actif. Ce n'etait pas une panne : c'etait un sondage qui
   * n'avait pas les moyens de conclure.
   *
   * ⚡ MESURE SUR 8 COMMUNES — descendre d'UN SEUL niveau suffit :
   *   Saint-Geniès · Saint-Laurent · Lirac : « incertain » (1 req) → **« aucun »**
   *   (5 req), bouton enfin grise. Gruissan reste a 1 requete (cellule non
   *   pleine). Les communes qui ONT des panneaux repondent « des » comme avant.
   * ⚠️ Le zoom 15 ne change AUCUN verdict et coute plus cher (Lattes 13 requetes,
   *   Ploemeur 9) : on s'arrete a 14, et un budget borne le pire cas.
   */
  const SONDAGE_ZOOM_MAX = 14, SONDAGE_BUDGET = 12;

  /**
   * @param {object|null} limites `{zoomMax, budget}` en mode SONDAGE : on
   *   subdivise, mais pas jusqu'au bout et pas indefiniment. `null` = releve
   *   complet, qui descend jusqu'a `ZOOM_PANNEAUX_MAX` sans plafond de cellules.
   */
  async function chargerPanneauxAgglo(bbox, prog, limites) {
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
      // ⚠️ Budget du SONDAGE : il part tout seul a chaque changement de commune,
      // il n'a pas le droit de partir en balayage. Budget epuise ⇒ on ne conclut
      // PAS (« incertain »), on ne pretend pas avoir tout vu.
      if (limites && cellules >= limites.budget) { tronque = true; break; }
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
      // ⚠️ En mode SONDAGE, on descend — mais pas jusqu'au bout : au-dela de son
      // zoom maximal, le doute est assume et l'appelant en tirera « incertain »
      // plutot que « aucun panneau ». Ne PAS descendre du tout laissait le
      // bouton actif sur des communes qui n'ont aucun panneau (cas
      // Saint-Geniès-de-Comolas, mesure en tete de fonction).
      const zMax = limites ? limites.zoomMax : ZOOM_PANNEAUX_MAX;
      if (zoom >= zMax) { tronque = true; continue; }
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

  /**
   * Ce nom de ville designe-t-il une AUTRE COMMUNE INSEE ? Rend la commune, ou null.
   *
   * ⚠️⚠️ NE PAS CONFONDRE avec un village rattache. « Les Ayguades (Gruissan) »
   * est une agglomeration SECONDAIRE de la commune traitee : elle s'ecrit avec
   * une parenthese, et c'est `villeAgglo` qui la gere. Une commune voisine, elle,
   * s'ecrit toute seule — et n'a rien a faire sur un segment d'ici.
   *
   * ⚠️ Comparaison SANS ACCENT ni casse : WME et l'INSEE ne s'accordent pas
   * toujours sur les diacritiques (« Saint-Geniès » / « Saint-Genies »), et un
   * accent manquant ferait passer une commune voisine pour un hameau inconnu —
   * donc pour un polygone a tracer, exactement l'alerte dont l'auteur ne veut pas.
   *
   * PURE : elle ne lit aucune variable d'etat, tout entre par ses parametres.
   */
  function communeVoisineDeNom(nom, liste, codeActif) {
    const brut = String(nom || '').trim();
    if (!brut || brut.includes('(')) return null;   // « Village (Commune) » : pas une voisine
    const n = normSansAccent(brut);
    return (liste || []).find(c => c && c.code !== codeActif && normSansAccent(c.nom) === n) || null;
  }

  /**
   * Les communes VOISINES citees par les noms d'un segment (principal et
   * alternatifs), sans doublon. Un segment hors agglomeration porte sa commune
   * dans le CARTOUCHE, pas dans le principal : ne regarder que le principal
   * raterait la moitie des cas.
   */
  /**
   * Un segment A CHEVAL sur la limite communale a-t-il quelque chose a couper ?
   *
   * ⚠️⚠️ Signale par Glenan56 (27/07) : « il propose de couper des segments sans
   * nom (et sans ville) pour coller aux limites communales, ce qui est, de mon
   * point de vue, sans interet. Surtout qu'ici c'est un chemin pieton. »
   *
   * ⭐ Il a raison, et la raison est simple : on coupe pour que CHAQUE MOITIE
   * porte le nommage de sa commune. Un segment qui ne porte NI nom NI ville —
   * ni en principal, ni en alternatif — donnerait deux moities strictement
   * identiques a l'originale. La coupe ne corrige rien, elle ajoute juste un
   * noeud. ⚠️ Le TYPE de voie n'entre pas dans le critere (arbitrage de
   * l'auteur) : un sentier NOMME se coupe comme une rue.
   *
   * PURE : tout entre par les parametres.
   */
  function coupeCommunaleUtile(nam) {
    if (!nam || !nam.primary) return false;
    const porte = e => !!(e && ((e.name || '').trim() || (e.cityName || '').trim()));
    return porte(nam.primary) || (nam.alts || []).some(porte);
  }

  /**
   * Ce qu'on peut affirmer du NOMMAGE d'un segment a cheval sur la limite,
   * SANS savoir ou la coupe tombera.
   *
   * ⚠️⚠️ Signale par Glenan56 : « le script ne detecte pas les segments hors
   * ville sans nom mais qui ont la ville en principal. Il ne propose donc pas
   * la correction en supprimant le nom de ville. » Sa capture le prouve :
   * « limite communale : 67 % dans Caraman » — 67 %, c'est la ZONE GRISE, et le
   * script y faisait `continue` AVANT d'auditer le nom.
   *
   * ⭐ LE `continue` N'ETAIT PAS UN OUBLI : « il faut couper avant de nommer, le
   * bon nommage depend de l'endroit de la coupe ». C'est vrai — mais PAS DE
   * TOUT. Hors agglomeration, le nom principal ne porte JAMAIS de ville : la
   * portion qui nous concerne est fautive quoi qu'il arrive a l'autre bout.
   * On ne dit donc QUE ca, et rien qui depende de la coupe.
   *
   * ⚠️ Restriction indispensable : seulement si la ville portee est celle de la
   * COMMUNE ACTIVE. Une ville VOISINE peut etre legitime — la moitie de
   * la-bas est peut-etre dans SON agglomeration, et nous n'avons pas ses
   * polygones. Ce cas-la est deja traite par le bandeau des communes voisines.
   *
   * PURE : tout entre par les parametres.
   */
  function ecartsCertainsEnZoneGrise(nam, enAgglo, nomCommune) {
    if (enAgglo || !nam || !nam.primary) return [];
    const ville = (nam.primary.cityName || '').trim();
    if (!ville) return [];
    if (normSansAccent(ville) !== normSansAccent(String(nomCommune || '').trim())) return [];
    return [{ champ: 'ville en trop (hors agglomération)',
              avant: (nam.primary.name || '‹sans nom›') + ' / ' + ville,
              apres: (nam.primary.name || '‹sans nom›') + ' / ‹sans ville›' }];
  }

  /**
   * Les communes voisines annoncees par ce segment, EN OBJETS (code + nom).
   * ⚠️ Il faut le CODE, pas seulement le nom : c'est par lui qu'on retrouve le
   * zonage d'agglomeration de la voisine (`agglos` est indexe par INSEE).
   * PURE.
   */
  function communesVoisinesDuSegment(nam, liste, codeActif) {
    const vues = new Map();
    const ajoute = v => {
      const c = communeVoisineDeNom(v, liste, codeActif);
      if (c) vues.set(c.code, c);
    };
    if (nam && nam.primary) ajoute(nam.primary.cityName);
    if (nam && nam.alts) nam.alts.forEach(a => ajoute(a && a.cityName));
    return [...vues.values()];
  }

  function communesEtrangeresDuSegment(nam, liste, codeActif) {
    return communesVoisinesDuSegment(nam, liste, codeActif).map(c => c.nom);
  }

  /**
   * ⭐ DECIDE DU NOM PRINCIPAL D'UNE VOIE QUI LONGE LA LIMITE COMMUNALE.
   *
   * ⚠️⚠️ REGLE DE L'AUTEUR (27/07, Rue de la Republique) : « c'est a Montfaucon
   * en agglo (et avec des habitations) donc on privilegie Montfaucon en
   * principal ; et hors agglo a Saint Genies, donc Saint Genies en Alt ». Et
   * quand c'est hors agglo des deux cotes : « pas de ville en main, les villes
   * en Alt ».
   *
   * ⭐ C'est la regle FR appliquee a une voie qui appartient aux DEUX communes :
   * le principal porte la ville LA OU L'ON EST EN AGGLOMERATION. Le script ne
   * raisonnait jusqu'ici que sur la commune active — il ne pouvait donc pas voir
   * que l'agglomeration etait en face.
   *
   * ⚠️⚠️ ET SURTOUT : « tant qu'on sait pas, on fait comme si on savait pas »
   * (l'auteur). Le zonage d'une commune voisine n'est connu que si l'editeur l'a
   * trace, ou l'a declaree sans agglomeration. Sans ca, le script N'AFFIRME
   * RIEN sur le principal — il ne le corrige pas, et il DIT pourquoi. Proposer
   * « ville → ‹sans ville› » reviendrait a parier sur un zonage qu'on n'a pas
   * regarde, et a effacer une adresse peut-etre juste.
   *
   * PURE. Rend 'voisine' (la voisine prend le principal) | 'ici' (hors agglo des
   * deux cotes : pas de ville) | 'inconnu' (on s'abstient).
   */
  function decisionPrincipalMitoyen(zonages) {
    if (!zonages || !zonages.length) return 'ici';
    if (zonages.some(z => z === 'agglo')) return 'voisine';
    if (zonages.some(z => z === 'inconnu')) return 'inconnu';
    return 'ici';
  }

  /**
   * La commune reellement SOUS LE CENTRE de la carte, ou null.
   *
   * ⚠️⚠️ NE PAS CONFONDRE avec `communeActive` : le script GARDE la commune en
   * cours tant qu'elle reste quelque part dans la vue (voir
   * `rafraichirCommunesDeLaVue`), ce qui est voulu — on ne perd pas son travail
   * parce qu'on a fait glisser la carte de deux centimetres. Mais les deux
   * peuvent alors DIVERGER, et c'est ce qui a coute une session entiere de
   * diagnostic le 27/07 (voir `guidageDecale`).
   */
  function communeSousLeCentre() {
    if (!communes.length) return null;
    let ctr; try { ctr = sdk.Map.getMapCenter(); } catch (e) { return null; }
    if (!ctr || ctr.lon == null || ctr.lat == null) return null;
    return communeDuPoint(ctr.lon, ctr.lat) || null;
  }

  /**
   * DIT si le guidage s'apprete a parler d'une autre commune que celle qu'on
   * regarde. Rend la commune sous le centre quand il y a decalage, sinon null.
   *
   * ⚠️⚠️ NE PAS SUPPRIMER — CECI VIENT D'UN CAS REEL (auteur, 27/07,
   * Saint-Genies-de-Comolas). Le script suivait Saint-Laurent-des-Arbres, restee
   * dans la vue (3,7 km), dont le zonage EST fait ; le bandeau affichait donc
   * « Le zonage est fait » pendant que l'editeur cadrait une commune vierge.
   * ⚡ Le bandeau ne mentait pas : IL NE DISAIT PAS DE QUI IL PARLAIT. Quatre
   * hypotheses (polygone fantome, bandeau perime, deux instances, autre onglet)
   * sont tombees devant la mesure avant qu'on trouve ca — et 8 640 combinaisons
   * d'etat ont prouve qu'aucune ne rend « zonage fait » sans polygone.
   *
   * ⚠️ Fonction PURE en dehors de ses deux entrees : elle ne decide rien, elle
   * compare. Le silence (null) est la reponse normale.
   */
  function guidageDecale(active, sousLeCentre) {
    if (!active || !sousLeCentre) return null;      // rien a comparer : on se tait
    return sousLeCentre.code === active.code ? null : sousLeCentre;
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
    else if (communeActive) {
      // ⚠️⚠️ LA CARTE A QUITTE LA COMMUNE. On la lachait deja, mais en silence :
      // le volet restait ouvert sur « Agglomeration », dont les boutons venaient
      // de se griser, et rien ne disait pourquoi (auteur, 27/07). On RAMENE donc
      // l'editeur a l'etape 1, et le guidage nomme la commune perdue.
      ui.communePerdue = communeActive.nom;
      communeActive = null; oublierPanneaux(); redrawCommune();
      replierSection('commune', true);      // l'etape a refaire s'ouvre
      replierSection('agglo', false);       // celle qui n'a plus d'objet se ferme
    }
    // ⚠️ Sondage des panneaux dès qu'une commune est en cours : c'est lui qui
    // décide si « 🪧 Panneaux » et « ✏️ Proposer un tracé » ont un sens. Il ne
    // part qu'UNE FOIS par commune (cache), et son retour rafraîchit les boutons.
    if (communeActive && !sondages.has(communeActive.code)) {
      const cible = communeActive.code;
      sonderPanneaux(communeActive).then(() => {
        if (communeActive && communeActive.code === cible) renderAgglos();
      });
    }
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
    // ⚠️⚠️ On coupe A LA SOURCE, pas a l'affichage : sans ce test, le script
    // continuerait a convertir la position de la souris et a mesurer la distance
    // a chaque report, plusieurs fois par seconde, pour finalement ne rien
    // montrer. Une option qui masque sans arreter le calcul n'est pas une option.
    if (!options.bulleSurvol) return null;
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
   *
   * ⚠️⚠️ ON NE RECOPIE QUE CE QU'ON MASQUE (auteur, 28/07 : « lorsque WME
   * genere une erreur a l'enregistrement, sans que le script soit implique, ca
   * ouvre systematiquement l'overlay — c'est tres chiant »). Le raisonnement
   * ci-dessus se retournait contre lui-meme : la recopie ne se justifie QUE
   * parce que notre fenetre cache la popover. Fenetre fermee, elle ne cache
   * rien — la popover de WME est parfaitement lisible, et on n'a aucune raison
   * de s'inviter. La rouvrir de force, c'est en plus RAMENER l'editeur sur un
   * outil qu'il avait range, pour une erreur qui ne nous concerne pas.
   * ⇒ Meme regle que la 2.25.01 et la 2.27.11 : on n'agit pas sur son interface
   *   a sa place. Le bandeau s'affiche s'il est VISIBLE, jamais en se rendant
   *   visible.
   */
  let derniereErreurSave = '';
  const RE_ERREUR_SAVE = /erreur|invalide|impossible|error|invalid/i;

  /**
   * Le bandeau a-t-il une place pour se voir ? On ne l'ecrit QUE dans une
   * fenetre deja ouverte et depliee — puisque la rendre visible est justement
   * le geste qu'on s'interdit desormais. Repliee, `ui.corps` est en
   * `display:none` : le bandeau y serait ecrit sans jamais s'afficher.
   *
   * ⚠️⚠️ ON NE FILTRE PAS SUR LA GEOMETRIE, ET C'EST UNE MESURE QUI L'A DIT.
   * J'avais d'abord conditionne le bandeau a un recouvrement reel entre notre
   * fenetre et la popover — plus fin sur le papier (« on ne recopie que ce
   * qu'on masque »). MESURE EN LIVE le 28/07 dans WME : le conteneur
   * `.save-popover-container` est en `position:absolute; top:911px; left:0`,
   * soit en BAS A GAUCHE, alors que la fenetre du script se pose en haut a
   * droite. Le recouvrement aurait donc TOUJOURS ete nul et le bandeau ne se
   * serait plus JAMAIS affiche : un raffinement qui tuait la fonction.
   * ⇒ Le commentaire de tete (« ancree en haut a DROITE », 21/07) decrit la
   *   popover VISIBLE, pas ce conteneur ; sa vraie place ne se mesure qu'en
   *   provoquant un vrai refus serveur, ce qu'on ne fait pas pour un confort.
   *   **Tant qu'on ne sait pas, on ne parie pas** : le bandeau ne coute rien
   *   dans une fenetre deja ouverte, l'ouvrir coutait cher.
   */
  function fenetreOuvertePourBandeau() {
    const o = ui.overlay;
    if (!o) return false;
    if (o.style.display === 'none') return false;
    return !o.classList.contains('agn-replie');
  }

  // Reevalue a la demande : l'editeur peut rouvrir ou deplier la fenetre
  // PENDANT que l'erreur de WME est affichee — c'est a ce moment-la qu'il se
  // met a la masquer, donc a ce moment-la que la recopie devient utile.
  let releverErreurSave = () => {};
  function surveillerErreursEnregistrement() {
    releverErreurSave = () => {
      const pop = document.querySelector('.save-popover-container');
      const txt = pop ? (pop.textContent || '').replace(/\s+/g, ' ').trim() : '';
      const propre = txt && RE_ERREUR_SAVE.test(txt)
        ? txt.replace(/\s*Fermer\s*$/i, '').trim() : '';
      if (propre && fenetreOuvertePourBandeau()) {
        if (propre !== derniereErreurSave) { derniereErreurSave = propre; afficherBandeauErreur(propre); }
      } else if (derniereErreurSave) {
        derniereErreurSave = ''; cacherBandeauErreur();
      }
    };
    try {
      new MutationObserver(() => releverErreurSave()).observe(document.body,
        { childList: true, subtree: true, characterData: true });
    } catch (e) { log('surveillance des erreurs d\'enregistrement impossible', e); }
  }

  /**
   * Recopier le message de WME ne suffit pas : « le lieu a un numéro de rue
   * invalide » ne dit ni ce qui se passe, ni quoi faire — et il se lit
   * naturellement comme « ce numéro existe déjà », ce qui est FAUX et envoie
   * l'éditeur chercher un doublon qui n'existe pas.
   *
   * ⚠️⚠️ CE QU'ON SAIT, MESURE EN LIVE le 21/07 (« 721 Chemin de la Bégude »,
   * Saint-Laurent-des-Arbres) — voir [[wme-sdk-pieges]] :
   *  - le refus est HTTP 406 sur `POST app/Features`, sur UN numéro précis ;
   *  - ce n'est PAS une règle d'unicité : `addHouseNumber` du MEME numéro passe,
   *    seuls les POI sont refusés ;
   *  - il SURVIT à la suppression enregistrée du numéro homonyme (testé dans les
   *    deux ordres, et lot par lot) ;
   *  - c'est donc une donnée résiduelle côté serveur Waze, INVISIBLE dans
   *    l'éditeur : rien à corriger sur la carte ;
   *  - le staff sait la purger (fait le 25/07, sujet 408679 — l'adresse est
   *    redevenue enregistrable pour tout le monde).
   *
   * ⇒ On NOMME le cas et on donne la sortie : signaler l'adresse exacte.
   * ⚠️ Le message de WME est traduit : on reconnaît le FR et l'EN.
   */
  const RE_REFUS_HN = /num[ée]ro de rue invalide|invalid house ?number|house ?number is invalid/i;

  function expliquerRefus(texte) {
    if (!RE_REFUS_HN.test(texte || '')) return '';
    return '<div class="agn-err-expl">🔎 <b>Ce n\'est pas un doublon d\'adresse.</b> ' +
      'Waze garde une trace résiduelle de ce numéro précis, côté serveur, invisible dans ' +
      'l\'éditeur : le POI est refusé même après avoir supprimé et enregistré le numéro ' +
      'de rue du même nom. Le numéro de rue, lui, reste acceptable — seul le lieu est bloqué.' +
      '<br><b>Rien à corriger sur la carte</b> : annule (Ctrl+Z), et signale l\'adresse exacte ' +
      'au staff sur le forum Waze — ils savent purger le résidu, et l\'adresse redevient ' +
      'enregistrable pour tout le monde.</div>';
  }

  function afficherBandeauErreur(texte) {
    if (!ui.corps) return;
    let b = document.querySelector('#agn-err-save');
    if (!b) {
      b = el('<div id="agn-err-save"></div>');
      ui.corps.insertBefore(b, ui.corps.firstChild);
    }
    b.innerHTML = '<b>⛔ WME a refusé l\'enregistrement</b><div class="agn-err-msg">' +
      esc(texte) + '</div>' + expliquerRefus(texte) +
      '<span class="agn-err-note">Message repris de WME (sa propre alerte est ' +
      'cachée derrière cette fenêtre). Il disparaîtra quand l\'alerte de WME se fermera.</span>';
    // ⚠️⚠️ NE RIEN OUVRIR, NE RIEN DEPLIER. On n'arrive ici que si la fenetre
    // est deja ouverte ET pose sur la popover : le bandeau est donc visible
    // tel quel. Rouvrir une fenetre rangee sur une erreur qui ne nous regarde
    // pas etait le defaut signale le 28/07.
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
      // ⚠️ `featuresDeGeom` et pas un objet direct : les POI surfaciques passent
      // ici, et certains sont des MultiPolygon que le SDK refuse. Comme il
      // valide le tableau ENTIER, un seul suffisait a faire disparaitre TOUT le
      // surlignage de la commune (defaut trouve le 27/07 avec le contour).
      const lignes = vivants.filter(f => !f.adresse).flatMap(f =>
        featuresDeGeom('ec-' + f.segId, f.geom, {
          couleur: options.couleurs[familleDe(f)] || '#888888',
          epaisseur: f === actif ? 22 : 14
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
          // ⚠️⚠️ LA COULEUR SE PREND PAR LA FAMILLE, pas en dur. Ecrire
          // `couleurs.adresse` peignait TOUS les points en cyan — y compris la
          // MESURE « numéro sur une voie Dxxx » (v2.26), qui se serait lue comme
          // un ecart a corriger. C'est la faute meme que la palette denonce plus
          // haut : deux natures opposees sous la meme couleur, cote a cote sur la
          // carte. Les lignes, elles, passaient deja par `familleDe`.
          const teinte = options.couleurs[familleDe(f)] || options.couleurs.adresse || '#00e5ff';
          points.push({ id: 'ad-' + cle, type: 'Feature', geometry: f.geom,
            properties: { couleur: teinte, contour: teinte,
                          rayon: estActif ? 11 : 7, remplissage: 0.55, trait: 2,
                          label: (f.hns && f.hns.length === 1) ? String(f.hns[0].number) : '' } });
        }
      });
      if (points.length) sdk.Map.addFeaturesToLayer({ layerName: LAYER_ADRESSES, features: points });
    } catch (e) { log('surlignage des adresses impossible', e); }
  }

  /**
   * Decoupe une geometrie en features que le SDK accepte.
   *
   * ⚠️⚠️ LE SDK REFUSE LES GEOMETRIES « MULTI » (mesure le 27/07 : un
   * MultiPolygon seul, sur un calque neuf, leve « geometry must match the
   * configured type »). Or **une commune sur deux est un MultiPolygon** des
   * qu'elle possede un ilot, un rocher ou une enclave : Saint-Tropez en a 4,
   * Sainte-Maxime 2, Hyeres **46**. Leur contour ne se dessinait donc PAS, sans
   * le moindre message — l'exception etait avalee par le `catch` du dessin.
   *
   * ⚠️ Le probleme depassait le contour communal : le calque des ecarts recoit
   * aussi les POI SURFACIQUES, dont certains sont des MultiPolygon. Et comme
   * `addFeaturesToLayer` valide le tableau ENTIER, un seul POI de ce type
   * faisait echouer **tout le surlignage** de la commune.
   *
   * ⚡ Verifie : plusieurs Polygon SEPARES passent sans probleme, et melanger
   * lignes et polygones sur un meme calque aussi. C'est donc bien l'eclatement
   * qu'il faut, pas un calque par type.
   *
   * ⚠️ L'analyse, elle, n'a jamais eu ce defaut : `pointInGeom` gere les
   * MultiPolygon depuis toujours. Ces communes etaient donc analysables — seul
   * leur contour restait invisible, ce qui est bien pire qu'une erreur franche.
   */
  function featuresDeGeom(id, geom, props) {
    if (!geom || !geom.coordinates) return [];
    const p = props || {};
    const morceaux = geom.type === 'MultiPolygon'
      ? geom.coordinates.map(c => ({ type: 'Polygon', coordinates: c }))
      : geom.type === 'MultiLineString'
        ? geom.coordinates.map(c => ({ type: 'LineString', coordinates: c }))
        : geom.type === 'MultiPoint'
          ? geom.coordinates.map(c => ({ type: 'Point', coordinates: c }))
          : [geom];
    // ⚠️ Un identifiant par morceau : deux features de meme id se recouvrent et
    // le SDK n'en garde qu'une.
    return morceaux.map((g, i) => ({
      id: morceaux.length > 1 ? id + '-' + i : id,
      type: 'Feature', geometry: g, properties: p
    }));
  }

  function redrawCommune() {
    ensureLayers();
    try { sdk.Map.removeAllFeaturesFromLayer({ layerName: LAYER_COMMUNE }); } catch (e) { /* */ }
    if (!communeActive) return;
    try {
      const features = featuresDeGeom('commune-' + communeActive.code,
        communeActive.geom, { label: communeActive.nom });
      if (features.length) sdk.Map.addFeaturesToLayer({ layerName: LAYER_COMMUNE, features });
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

  /** Distance approximative entre deux points, en metres. */
  const distanceM = (a, b) => Math.hypot(
    (a[0] - b[0]) * 111320 * Math.cos((a[1] + b[1]) * Math.PI / 360),
    (a[1] - b[1]) * 110540);

  /**
   * Distance approximative d'un point a une POLYLIGNE, en metres.
   *
   * ⚠️ Sert a deux choses qui n'ont rien a voir : l'anneau d'un polygone
   * d'agglomeration (panneaux) et le TRACE d'une voie (v2.19, « le POI est-il
   * le long de la rue qu'il declare ? »). Ce sont les memes mathematiques : en
   * garder deux copies, c'est la faute exacte des giratoires de la v2.11.
   */
  function distanceAuTrace(lon, lat, points) {
    if (!points || !points.length) return Infinity;
    if (points.length < 2) return distanceM([lon, lat], points[0]);
    const kLon = 111320 * Math.cos(lat * Math.PI / 180), kLat = 110540;
    const p = [lon * kLon, lat * kLat];
    let best = Infinity;
    for (let i = 1; i < points.length; i++) {
      const a = [points[i - 1][0] * kLon, points[i - 1][1] * kLat];
      const b = [points[i][0] * kLon, points[i][1] * kLat];
      best = Math.min(best, distPointSegment(p, a, b));
    }
    return best;
  }
  /** Cas particulier : l'anneau d'un polygone est une polyligne fermee. */
  const distanceAuRing = distanceAuTrace;

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
   * Largeur moyenne (aire / longueur) sous laquelle un groupe de portes n'est
   * PAS une agglomeration mais un alignement de panneaux le long d'une voie.
   *
   * ⚠️⚠️ CALE SUR MESURE, PAS CHOISI (27/07, quatre communes) :
   *   Lattes 29 m ❌ · Coursan 874 m · Laudun-l'Ardoise 1 212 m · Ploemeur 1 922 m.
   * L'ecart entre le cas fautif et les bons est d'un facteur 30 : a 150 m on ne
   * refuse que ce qui est manifestement une ligne, sans risquer un vrai hameau
   * (un hameau de 3 ha fait deja ~170 m de cote).
   */
  const LARGEUR_MIN_AGGLO_M = 150;
  /**
   * Au-dela de cette part de la commune, un polygone reunit tres probablement
   * PLUSIEURS agglomerations que le chainage a soudees. On le propose quand meme
   * — il peut etre juste sur une commune tres urbanisee — mais on AVERTIT.
   * ⚡ Mesure : Coursan 7,8 % · Laudun 12,8 % · Ploemeur 24,7 % (bourg + hameaux
   * cotiers chaines en un seul bloc de 5,1 km).
   */
  const PART_COMMUNE_SUSPECTE = 0.20;
  /**
   * Part de la commune couverte par une proposition, de 0 a 1.
   * ⚠️ Rend 0 si l'aire de la commune est inconnue : dans le doute, on
   * n'avertit pas — un faux avertissement userait la confiance dans les vrais.
   */
  function partDeLaCommune(prop) {
    if (!prop || !prop.aire || !communeActive) return 0;
    const ha = aireGeomHa(communeActive.geom);
    return ha > 0 ? (prop.aire / 10000) / ha : 0;
  }

  /** Aire approchee d'une geometrie, en hectares (projection locale). */
  function aireGeomHa(geom) {
    if (!geom || !geom.coordinates) return 0;
    const anneaux = geom.type === 'Polygon' ? [geom.coordinates[0]]
      : geom.type === 'MultiPolygon' ? geom.coordinates.map(p => p[0]) : [];
    let total = 0;
    for (const r of anneaux) {
      if (!r || r.length < 3) continue;
      const kx = 111320 * Math.cos(r[0][1] * Math.PI / 180), ky = 110540;
      let s = 0;
      for (let i = 0, k = r.length - 1; i < r.length; k = i++) {
        s += (r[k][0] * kx) * (r[i][1] * ky) - (r[i][0] * kx) * (r[k][1] * ky);
      }
      total += Math.abs(s / 2);
    }
    return total / 10000;
  }

  /**
   * Nom lisible porte par un panneau du groupe, s'il y en a un.
   *
   * ⚡ Suggestion de Glenan56 (rang 6, 27/07) : « ton systeme prend les EB10
   * sans les LIRE ». Il a raison — le panneau porte le nom de l'agglomeration.
   * ⚠️ Mais la source est avare : mesure du 27/07, **19 panneaux sur 116 en
   * portent un a Ploemeur, 1 sur 62 a Lattes, 0 sur 53 a Coursan**. On s'en sert
   * quand il est la, jamais on ne compte dessus.
   * ⚠️ « AGGLO » est une valeur GENERIQUE, pas un nom de lieu : elle n'apprend
   * rien et ne doit pas devenir une etiquette.
   */
  function nomDuGroupe(groupe) {
    // Chaine reelle : groupe → portes → points → fiche → panneau brut.
    for (const porte of (groupe.membres || [])) {
      for (const pt of (porte.membres || [])) {
        const v = pt && pt.f && pt.f.p && pt.f.p.panneau_value;
        const t = v == null ? '' : String(v).trim();
        if (t && !/^agglo$/i.test(t)) return t;
      }
    }
    return '';
  }

  /**
   * Presente les secteurs d'entrees quand aucun contour n'est deductible, avec
   * un cadrage sur chacun. Le BOURG PRINCIPAL vient en tete.
   *
   * ⚠️ « Principal » = le secteur le plus proche de la MAIRIE (donnee INSEE) :
   * c'est lui qui porte le nom de la commune. A defaut de mairie — contours
   * charges avant la v2.23 — on retombe sur le nombre d'entrees, qui est un
   * indice raisonnable mais pas une preuve : on ne l'annonce alors pas comme
   * « principal ».
   */
  /**
   * Les secteurs, dans l'ordre ou on doit les traiter : le plus proche de la
   * MAIRIE d'abord (c'est le bourg qui porte le nom de la commune), puis les
   * autres, du mieux fourni au moins fourni.
   * ⚠️ Sans mairie — contours charges avant la v2.23 — on trie par nombre
   * d'entrees, et l'appelant n'annonce alors PAS de « bourg principal » : c'est
   * un indice, pas une preuve.
   */
  function trierSecteurs(groupes) {
    const mairie = communeActive && communeActive.mairie;
    const avec = (groupes || []).map((g, i) => ({
      g, i, nom: nomDuGroupe(g),
      d: mairie && g.centre ? distanceM([g.centre.lon, g.centre.lat], mairie) : Infinity
    }));
    avec.sort((a, b) => (a.d - b.d) || (b.g.portes - a.g.portes));
    return avec;
  }

  /** Le secteur est-il deja couvert par un polygone trace ? */
  function secteurCouvert(g) {
    if (!g || !g.centre || !communeActive) return false;
    return (agglos[communeActive.code] || [])
      .some(z => z.ring && pointInRing(g.centre.lon, g.centre.lat, z.ring));
  }

  function listerSecteurs(groupes) {
    if (!ui.bilanPanneaux || !groupes || !groupes.length || !communeActive) return;
    const mairie = communeActive.mairie;
    const avec = trierSecteurs(groupes);
    const principal = mairie && isFinite(avec[0].d) ? avec[0] : null;
    const bloc = el('<div class="agn-secteurs"></div>');
    bloc.innerHTML = '<div class="agn-secteurs-t">' + avec.length +
      ' secteur(s) d\'entrées repéré(s) — <b>trace-les un par un</b>' +
      (principal ? ', en commençant par le bourg' : '') + ' :</div>';
    avec.forEach((x, rang) => {
      const b = el('<button class="agn-secteur"></button>');
      b.innerHTML = '<b>' + (rang + 1) + '.</b> ' +
        (x.nom ? '<b>' + esc(x.nom) + '</b> · ' : '') +
        x.g.portes + ' entrée(s)' +
        (x === principal ? ' <span class="agn-secteur-p">bourg principal</span>' : '');
      b.title = 'Cadrer la carte sur ce secteur pour le tracer';
      b.onclick = () => {
        if (!x.g.centre) return;
        // Zoom 15 : on voit le bourg entier et ses entrees, de quoi tracer.
        try { centrerSurZoneVisible(x.g.centre, 15); }
        catch (e) { try { sdk.Map.setMapCenter({ lonLat: x.g.centre, zoomLevel: 15 }); } catch (e2) { /* */ } }
      };
      bloc.appendChild(b);
    });
    ui.bilanPanneaux.appendChild(bloc);
  }

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
      let mesure = null;
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
          // Longueur = la plus grande distance entre deux sommets ; la LARGEUR
          // MOYENNE s'en deduit (aire / longueur). C'est elle qui distingue une
          // agglomeration d'un alignement de panneaux le long d'une route.
          let diam = 0;
          for (let a = 0; a < h.length; a++) for (let b = a + 1; b < h.length; b++) {
            diam = Math.max(diam, Math.hypot(h[a][0] - h[b][0], h[a][1] - h[b][1]));
          }
          const largeur = diam > 0 ? aire / diam : 0;
          mesure = { aire, longueur: diam, largeur };
          // ⚠️⚠️ DEUX GARDE-FOUS, PAS UN. Le test d'aire relative (v1.98) laissait
          // passer les RUBANS : une boite deja etroite donne un bon ratio. Cas
          // vecu a LATTES (signale par l'auteur, 27/07) — 5 panneaux pour
          // 3 224 ha, et le « polygone » proposé faisait **1 ha, 29 m de large**,
          // soit l'alignement des panneaux le long d'une voie rapide.
          // ⚡ Mesures du 27/07 : Lattes 29 m · Coursan 874 m · Laudun 1 212 m ·
          // Ploemeur 1 922 m. L'ecart est tel qu'un seuil a 150 m ne refuse que
          // ce qui est manifestement une ligne.
          if (aire >= 0.15 * Math.max(1, lx * ly) && largeur >= LARGEUR_MIN_AGGLO_M) {
            ring = bomberCotes(h, BOMBAGE_PART, BOMBAGE_MAX_M);
          }
        }
      }
      const info = { idx: i, portes: g.length,
                     panneaux: g.reduce((s, x) => s + x.membres.length, 0),
                     // Les portes suivent la proposition : c'est par elles qu'on
                     // retrouve le NOM porte par un panneau (quand il y en a un).
                     membres: g,
                     // Les mesures suivent la proposition : l'editeur doit pouvoir
                     // juger sur des chiffres, pas sur une forme a l'ecran.
                     aire: mesure ? mesure.aire : 0,
                     longueur: mesure ? mesure.longueur : 0,
                     largeur: mesure ? mesure.largeur : 0,
                     // Trop plat pour etre une agglomeration : dit a part, parce
                     // que « pas de surface » et « une ligne » ne se corrigent
                     // pas de la meme facon.
                     ruban: !!(mesure && mesure.largeur < LARGEUR_MIN_AGGLO_M) };
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
    // ⚠️⚠️ CE QUI DERIVE DES PANNEAUX DOIT PARTIR AVEC EUX. Sans ca, les
    // secteurs de la commune PRECEDENTE survivaient au changement de commune :
    // le guidage reclamait de couvrir des hameaux qui n'existent pas ici, et
    // l'avertissement d'exhaustivite les nommait.
    bilanPreTrace = null; secteursCourants = []; releveFait = false;
    if (ui.btnPreTrace) ui.btnPreTrace.disabled = true;
    redrawPanneaux(); renderBilanPanneaux();
  }

  /** Va chercher les panneaux de la commune active, puis les confronte. */
  // ===========================================================================
  // SONDAGE DES PANNEAUX — savoir AVANT de cliquer si ca vaut le coup
  //
  // Demande de l'auteur (27/07) : « pour la commune choisie, checker la
  // disponibilite des panneaux. Si pas de panneau […] on grise le bouton, on
  // explique la raison au survol, et ne reste dispo que Tracer l'agglomeration ».
  //
  // ⚠️ Le sondage est VOLONTAIREMENT LEGER : la grille de depart, SANS
  // subdivision. Le releve complet peut demander une dizaine de requetes (13 sur
  // Lattes) — hors de question de le lancer a chaque changement de commune.
  // ⚠️⚠️ Et une cellule PLEINE ne permet pas de conclure « aucun panneau » : la
  // subdivision existe justement pour ces cas-la. On repond alors « incertain »
  // et on laisse le bouton actif — un faux « aucun » priverait l'editeur d'un
  // relevé qui aurait marche.
  // ===========================================================================

  /** code INSEE → { etat: 'aucun'|'des'|'incertain', nb } */
  const sondages = new Map();

  /**
   * Ce que donnerait le pré-tracé avec les panneaux actuellement relevés, sans
   * rien tracer : { tracables, rubans, isoles }. Recalculé après chaque relevé.
   */
  let bilanPreTrace = null;

  /** Secteurs du dernier relevé, triés — sert aussi de point de départ au tracé. */
  let secteursCourants = [];

  /**
   * Le relevé de panneaux a-t-il ETE FAIT sur la commune en cours ?
   *
   * ⚠️⚠️ A ne pas confondre avec « il y a des panneaux ». Cas vecu a LIRAC
   * (980 ha, signale par l'auteur) : le releve tourne et ne rend RIEN. En
   * testant `panneaux.length`, le guidage renvoyait indefiniment vers le bouton
   * « Panneaux » qu'on venait de cliquer. Un relevé infructueux est un relevé
   * fait : on passe a la suite.
   */
  let releveFait = false;

  function majBilanPreTrace() {
    if (!panneaux.length) { bilanPreTrace = null; secteursCourants = []; return; }
    try {
      // ⚠️ EXACTEMENT les fiches qu'utilisera `preTracerDepuisPanneaux` : les
      // calculer autrement ici, c'est risquer d'annoncer un tracé possible que
      // le bouton ne produira pas — ou l'inverse.
      const cl = classerPanneaux();
      const fiches = cl ? [...cl.dedans, ...cl.dehors] : [];
      if (!fiches.length) { bilanPreTrace = { tracables: 0, rubans: 0, isoles: 0 }; return; }
      const props = proposerPolygones(fiches);
      bilanPreTrace = {
        tracables: props.filter(p => p.ring).length,
        rubans: props.filter(p => p.ruban).length,
        isoles: props.filter(p => !p.ring && !p.ruban).length
      };
      // Gardes pour le tracé manuel : c'est par le bourg qu'on commence.
      secteursCourants = trierSecteurs(props);
    } catch (e) { bilanPreTrace = null; secteursCourants = []; }   // dans le doute, on ne ferme rien
  }

  async function sonderPanneaux(commune) {
    if (!commune) return null;
    if (sondages.has(commune.code)) return sondages.get(commune.code);
    sondages.set(commune.code, { etat: 'encours', nb: 0 });
    let res;
    try {
      const r = await chargerPanneauxAgglo(commune.bbox, null,
        { zoomMax: SONDAGE_ZOOM_MAX, budget: SONDAGE_BUDGET });
      const dedans = r.panneaux.filter(p => pointInGeom(p.longitude, p.latitude, commune.geom));
      res = dedans.length ? { etat: 'des', nb: dedans.length }
        : r.tronque ? { etat: 'incertain', nb: 0 }
        : { etat: 'aucun', nb: 0 };
    } catch (e) {
      // Reseau muet : on ne conclut RIEN. Griser sur une panne reseau ferait
      // croire a une commune sans panneaux.
      res = { etat: 'incertain', nb: 0 };
    }
    sondages.set(commune.code, res);
    return res;
  }

  /** Ce que le sondage sait de la commune en cours (jamais d'appel reseau ici). */
  const sondageCourant = () =>
    (communeActive && sondages.get(communeActive.code)) || null;

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
      // ⚠️ On sait DES MAINTENANT si un tracé est possible : le calcul ne coûte
      // rien (aucun réseau) et évite de proposer un bouton qui ne donnera rien.
      // C'est ce qui ferme « Proposer un tracé » avec sa raison, à Lattes par
      // exemple, plutôt que de laisser l'éditeur cliquer pour rien.
      majBilanPreTrace();
      redrawPanneaux();
      renderBilanPanneaux();
      // ⚠️⚠️ INDISPENSABLE : c'est `renderAgglos` qui recalcule l'etat ET LES
      // INFOBULLES des boutons. Sans lui, « ✏️ Proposer un tracé » continuait
      // d'afficher « relève d'abord les panneaux » alors qu'ils venaient d'etre
      // releves (signale par l'auteur, 27/07). Un bouton qui ment sur son etat
      // est pire qu'un bouton muet.
      renderAgglos();
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
      // ⚠️ Le relevé a EU LIEU, qu'il ait rendu des panneaux ou non : c'est ce
      // qui fait avancer le guidage. Sans ca, une commune sans panneau (Lirac)
      // renvoyait indefiniment vers le bouton qu'on venait de cliquer.
      releveFait = true;
      renderAgglos();
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
              (${prop.panneaux} panneau(x))${prop.aire
                ? ` : <b>${Math.round(prop.aire / 10000)} ha</b>, ${Math.round(prop.longueur)} m
                    de long sur ${Math.round(prop.largeur)} m de large en moyenne` : ''}.
              <div class="agn-modale-geo">
                <div class="agn-d">⚠️ <b>Trace grossier</b> : les panneaux ne sont
                  poses que sur les routes. Entre deux entrées, la ligne est
                  calculée, pas relevée — <b>à corriger aux poignées</b> ensuite.</div>
                ${partDeLaCommune(prop) >= PART_COMMUNE_SUSPECTE ? `<div class="agn-d agn-alerte">
                  ⚠️ Ce polygone couvre <b>${Math.round(partDeLaCommune(prop) * 100)} %</b>
                  de la commune. Il réunit <b>probablement plusieurs agglomérations</b>
                  que la chaîne des entrées a soudées : vérifie sur la carte, et si c'est
                  le cas, passe-le pour les tracer séparément.</div>` : ''}
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
    const rubans = nonTracables.filter(p => p.ruban);
    // ⚠️⚠️ UNE SEULE PHRASE (auteur, 27/07 : « y'a trop de blabla, on n'a pas
    // envie de lire pour comprendre ce qu'il se passe »). Le constat tenait
    // auparavant en TROIS messages qui disaient la meme chose. Ici : le chiffre,
    // la raison en trois mots, l'action. Le detail est dans l'aide.
    const raisonCourte = rubans.length
      ? 'alignés le long d\'une route'
      : nManuels ? 'trop isolés' : '';

    if (!props.length) {
      // Rien a proposer : c'est le cas Narbonne. On le dit clairement plutot
      // que de sortir des ronds arbitraires.
      const ha = communeActive ? Math.round(aireGeomHa(communeActive.geom)) : 0;
      ui.bilanPanneaux.innerHTML = '<b>' + fiches.length + ' panneau(x)</b>' +
        (ha ? ' sur ' + ha + ' ha' : '') +
        (raisonCourte ? ', ' + raisonCourte : '') +
        ' : <b>aucun tracé possible</b>. Trace à la main — les panneaux restent affichés.';
      // ⚠️ Sur une commune a hameaux (La Hague : 19 communes deleguees, 32
      // panneaux, 6 secteurs, AUCUN tracable), s'arreter la laisse l'editeur
      // devant une carte muette. On ne DEVINE pas la surface — doctrine v1.98 —
      // mais on donne l'ORDRE DE MARCHE : voici les secteurs d'entrees, va les
      // tracer un par un, en commencant par le bourg principal.
      listerSecteurs(tous);
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
        // ⚠️ `aAffiner` : ce tracé vient des panneaux, il est GROSSIER par
        // construction. Le drapeau sert au guidage (il pointe vers ✎) et tombe
        // dès la première édition — on ne réclame pas deux fois la même chose.
        liste.push({ id: 'a' + Date.now() + '-' + i, label: rep.label,
                     rattache: rep.rattache, ring: p.ring, aAffiner: true });
        crees++;
        saveAgglos(); redrawAgglos(); renderAgglos();
      }
    } finally {
      redrawAgglos(); renderAgglos();
      try { sdk.Map.setMapCenter({ lonLat: vueAvant.centre, zoomLevel: vueAvant.zoom }); } catch (e) { /* */ }
      // Meme regle qu'au-dessus : une phrase. Ce qui reste a faire d'abord,
      // le reliquat ensuite, et rien de plus.
      const reste = nManuels
        ? ' · <b>' + nManuels + '</b> entrée(s) non tracée(s) (' +
          (raisonCourte || 'trop isolées') + ')'
        : '';
      ui.bilanPanneaux.innerHTML = crees
        ? '<b>' + crees + ' polygone(s) créé(s)</b> — <b>ajuste-les aux poignées (✎)</b>, ' +
          'les panneaux ne marquent que les routes' + reste + '.'
        : '<b>Aucun polygone créé</b>' + reste + '.';
      // Les secteurs qu'aucun tracé ne couvre restent a faire a la main : on
      // les liste avec leur cadrage, plutot que de les reduire a un compteur.
      if (nonTracables.length) listerSecteurs(nonTracables);
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
  /**
   * Ou poser la carte avant un trace a la main.
   *
   * ⚠️⚠️ Sans ca, cliquer « ＋ Tracer » repliait toute l'interface et laissait
   * l'editeur devant la vue courante, sans savoir par ou commencer — vecu par
   * l'auteur sur LA HAGUE (19 communes deleguees, 14 963 ha) : « la vue ne zoome
   * sur rien, je ne vois ni le bourg ni la mairie, je suis perdu ».
   *
   * Trois repli successifs, du plus precis au plus grossier :
   *   1. le premier secteur d'entrees PAS ENCORE couvert par un polygone —
   *      c'est le bourg principal tant qu'il n'est pas trace ;
   *   2. la MAIRIE (donnee INSEE) : par definition le bourg qui porte le nom ;
   *   3. le centre du contour, faute de mieux.
   */
  function departDuTrace() {
    if (!communeActive) return null;
    const libre = secteursCourants.find(x => x.g && x.g.centre && !secteurCouvert(x.g));
    if (libre) {
      return { centre: libre.g.centre, zoom: 15,
               quoi: libre.nom || (isFinite(libre.d) ? 'le bourg' : 'un secteur d\'entrées'),
               entrees: libre.g.portes };
    }
    if (communeActive.mairie) {
      return { centre: { lon: communeActive.mairie[0], lat: communeActive.mairie[1] },
               zoom: 15, quoi: 'le bourg (mairie)' };
    }
    const em = empriseDeGeom(communeActive.geom);
    return em ? { centre: em.centre, zoom: zoomPour(2 * em.rx, 2 * em.ry, em.centre.lat),
                  quoi: communeActive.nom } : null;
  }

  /**
   * Rappel affiche PENDANT le trace. Indispensable : l'interface est repliee a
   * ce moment-la, donc le bouton qui disait « double-clic pour fermer » n'est
   * plus visible — c'etait la seule consigne, et elle disparaissait.
   */
  function bandeauTrace(texte) {
    let n = document.getElementById('agn-trace-aide');
    if (!texte) { if (n) n.remove(); return; }
    if (!n) { n = el('<div id="agn-trace-aide"></div>'); document.body.appendChild(n); }
    n.innerHTML = texte;
  }

  async function tracerAgglo() {
    if (!communeActive) return;
    ui.btnTracer.disabled = true;
    ui.btnTracer.textContent = 'Tracé en cours… (double-clic pour fermer)';
    const etaitReplie = ui.overlay.classList.contains('agn-replie');
    const voletEtaitOuvert = ui.volet && ui.volet.classList.contains('agn-volet-ouvert');
    // ⚠️ CADRER AVANT DE REPLIER : une fois l'interface fermee, l'editeur n'a
    // plus aucun repere pour se placer lui-meme.
    const depart = departDuTrace();
    if (depart) {
      try { centrerSurZoneVisible(depart.centre, depart.zoom); }
      catch (e) { try { sdk.Map.setMapCenter({ lonLat: depart.centre, zoomLevel: depart.zoom }); }
                  catch (e2) { /* on trace quand meme */ } }
    }
    bandeauTrace('✏️ <b>Trace le contour de ' + esc(depart ? depart.quoi : communeActive.nom) + '</b>' +
      (depart && depart.entrees ? ' <span>· ' + depart.entrees + ' entrée(s) relevée(s) ici</span>' : '') +
      '<span> · clique les sommets, <b>double-clic pour fermer</b> · Échap pour renoncer</span>');
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
      bandeauTrace('');                       // le rappel ne survit pas au tracé
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
    // ⚠️ Échap annule l'edition et rend le trace d'avant. Le raccourci est
    // ANNONCE dans l'infobulle du bouton d'enregistrement : une sortie de
    // secours qu'on ne connait pas n'en est pas une.
    const echap = e => { if (e.key === 'Escape' && edition) { e.stopPropagation(); sortirEdition(false); } };
    document.addEventListener('keydown', echap, true);
    edition = {
      agglo: a, zone, echap,
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
      // Le tracé a été repris à la main : il n'est plus « à affiner », et le
      // guidage passe à la suite.
      delete edition.agglo.aAffiner;
    } else {
      edition.agglo.ring = edition.ringAvant;
    }
    edition.zone.remove();
    if (edition.echap) document.removeEventListener('keydown', edition.echap, true);
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
    // ⚠️⚠️ H9 PORTE DESORMAIS LES DEUX ALTERNATIFS (v2.27.02).
    //
    // Signale par Glenan56 (27/07) : « quand on a une Dxxx hors ville avec nom
    // de rue en alt, il ne m'a pas propose de corriger en rajoutant le Dxxx +
    // Ville en alt. Un nom de rue en alt semble donc le perturber. »
    //
    // Il avait raison, et c'etait une incoherence INTERNE au logigramme : H6
    // (numero seul) reclame « Dxxx + commune » en alternatif, H8 (voie
    // communale) reclame les DEUX — seul H9 laissait tomber le numero des qu'un
    // nom de rue apparaissait. Le principal hors agglomeration ne porte jamais
    // de ville : le numero n'etait donc rattache a aucune commune.
    //
    // ⭐ ARBITRAGE DE L'AUTEUR (CC FR, 27/07) : aligner H9 sur H8. La regle de
    // nommage n'est pas la mienne — je ne fais que la rendre coherente avec
    // elle-meme.
    //
    // ⚠️ EFFET DE VOLUME : tout segment hors agglo portant un numero de route ET
    // un nom de rue gagne un ecart « alt manquant ». Les communes deja auditees
    // en montreront donc de nouveaux, sans que rien n'ait change sur la carte.
    return fin({ cas: 'H9', primary: P(route.name, ''),
      alts: [P(route.name, vAlt), P(nomRue.name, vAlt)], doute });
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

      // ⭐⭐ ARBITRAGE DE L'AUTEUR (03/08) — « OPTION B ». Le dictionnaire est
      // consulte EN PREMIER, avant les trois controles de redaction ci-dessous,
      // parce que sa proposition peut les rendre MUETS.
      //
      // Origine : son test live sur « Av. du Chateau ». Le controle
      // « abreviation » ne sait qu'expliquer la faute (« ecrire le type de voie
      // en toutes lettres »), le dictionnaire sait donner le nom juste
      // (« Avenue du Château »). Deux lignes pour le meme nom dont une SANS nom
      // propose, c'est du bruit — et le risque reel est qu'il applique la
      // moins bonne. ⇒ Un segment, un report (regle posee en 2.27.04).
      //
      // ⚠️ L'ecart du dictionnaire reste pousse EN DERNIER (voir plus bas) :
      // seul son CALCUL remonte ici, pas son affichage.
      const e2 = (c.redactionDico && dico.regles.length)
        ? ecartDeRedaction(nom, dico.regles) : null;

      // ⚠️⚠️ LE GARDE-FOU, ET IL EST MESURE, PAS SUPPOSE : on ne se tait QUE si
      // la faute a REELLEMENT disparu du nom propose. Le dictionnaire peut tres
      // bien redresser l'accent SANS developper l'abreviation (« Av. du
      // Chateau » -> « Av. du Château ») : se taire dans ce cas ferait PERDRE
      // l'information, et l'editeur appliquerait un nom encore fautif en
      // croyant avoir tout corrige. On REJOUE donc le controle sur la
      // proposition. Un nom sans proposition (`sansProposition`, cas des
      // CAPITALES) ne fait jamais taire personne.
      const propose = (e2 && !e2.sansProposition && e2.apres) ? e2.apres : null;
      const dicoLeCorrige = test => propose != null && !test(propose);

      const faute = {
        abrev: s => RE_ABREV.test(s) || RE_ABREV_SANS_POINT.test(s),
        contraction: s => RE_SAINT.test(s) || initialeIsolee(s),
        minuscule: s => /^[a-zà-ÿ]/.test(s)
      };
      if (c.abreviations && faute.abrev(nom) && !dicoLeCorrige(faute.abrev)) {
        ecarts.push({ champ: 'abreviation' + ou, avant: nom,
          apres: 'écrire le type de voie en toutes lettres' });
      }
      if (c.contractions && faute.contraction(nom) && !dicoLeCorrige(faute.contraction)) {
        ecarts.push({ champ: 'contraction' + ou, avant: nom,
          apres: 'écrire le nom complet (contractions interdites)' });
      }
      if (c.majuscule && faute.minuscule(nom) && !dicoLeCorrige(faute.minuscule)) {
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
      // ⭐ Le dictionnaire communautaire, pousse EN DERNIER (il est CALCULE plus
      // haut, voir « option B ») : les controles ci-dessus sont plus precis sur
      // ce qu'ils couvrent — ils nomment la faute — le dictionnaire ratisse le
      // reste et donne le nom juste. Depuis l'option B, ils ne se doublonnent
      // plus : celui qui n'a rien de plus a dire se tait.
      if (e2) ecarts.push({ champ: e2.champ + ou, avant: e2.avant, apres: e2.apres,
                            sansProposition: e2.sansProposition });
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

  /**
   * Conserve, EN ALTERNATIF, les adresses de communes VOISINES que la cible
   * ferait autrement disparaitre.
   *
   * ⚠️⚠️ SIGNALE PAR L'AUTEUR (27/07, Rue de la Republique — 7 segments entre
   * Saint-Geniès-de-Comolas et Montfaucon) : « Ce segment est a cheval sur les
   * 2 communes, donc dans un cas comme celui-ci il faudrait proposer de mettre
   * l'adresse pour Saint Genies en Alt EN PLUS de l'adresse deja renseignee
   * pour Montfaucon. »
   *
   * ⭐ CE QUI CLOCHAIT N'ETAIT PAS LE CALCUL, MAIS LA PERTE. La cible hors
   * agglomeration vide la ville du PRINCIPAL — et « Montfaucon » n'etait remis
   * nulle part. Or LE SCRIPT NE SAIT PAS RETIRER UN ALTERNATIF : une adresse
   * deplacee en alternatif reste rattrapable a la main, une adresse ecrasee sur
   * le principal est PERDUE. Le script detruisait donc une donnee qu'il aurait
   * ete incapable de reconstruire.
   *
   * ⚠️ N'EST APPELEE QUE SI LA VOIE LONGE LA LIMITE (mesure, pas suppose) : un
   * segment au MILIEU de la commune qui annonce la voisine est une adresse
   * FAUSSE — celle-la doit bien disparaitre, c'est le cas signale le 27/07 sur
   * ces memes 7 segments. Deux situations opposees, un seul symptome : c'est la
   * geometrie qui tranche, pas le nom.
   *
   * PURE : tout entre par les parametres.
   */
  function conserverAdressesVoisines(nam, exp, voisines) {
    if (!nam || !exp || !voisines || !voisines.length) return exp;
    const cibles = new Set(voisines.map(v => normSansAccent(String(v).trim())));
    const vues = new Set((exp.alts || []).map(key));
    vues.add(key(exp.primary));
    const ajouts = [];
    for (const e of [nam.primary].concat(nam.alts || [])) {
      if (!e || !e.cityName || !e.cityName.trim()) continue;
      if (!cibles.has(normSansAccent(e.cityName.trim()))) continue;
      const garde = { name: e.name || '', cityName: e.cityName };
      const k = key(garde);
      if (vues.has(k)) continue;
      vues.add(k);
      ajouts.push(garde);
    }
    return ajouts.length ? Object.assign({}, exp, { alts: (exp.alts || []).concat(ajouts) }) : exp;
  }

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
        // ⭐ Le dictionnaire communautaire FR (voir la section DICTIONNAIRE plus
        // haut). Il couvre ce que les cinq controles ci-dessus ne voient pas :
        // « Che », « Pl », « Imp », « Sq », « Dr », « Gal », « Cdt », « Mal »,
        // les accents manquants, les espaces doubles, « St-Jean ».
        // ⚠️ DECOCHE PAR DEFAUT SI WME Check Road Name EST INSTALLE : il dit
        // deja la meme chose, a partir des memes regles. Voir `crnPresent`.
        { cle: 'redactionDico', portee: 'forme',
          defaut: () => !crnPresent(),
          libelle: 'Rédaction : dictionnaire communautaire FR (WME Check Road Name)' },
        { cle: 'hnHorsAgglo', portee: 'adresse',
          libelle: 'Numéros de rue (HN) hors agglomération' },
        // ⚠️⚠️ CECI EST UNE MESURE, PAS UNE REGLE — et le libelle doit le dire.
        // Origine : Glenan56 (rang 6, 27/07) propose qu'en ville les numeros ne
        // soient poses que sur les segments dont le PRINCIPAL est l'adresse
        // postale, pour ne pas fabriquer d'adresses non postales sur une Dxxx.
        // ⚠️ Il demande LUI-MEME que la norme passe par les LC et le wiki AVANT
        // d'etre codee — et c'est la doctrine du projet : le script APPLIQUE la
        // norme, il ne la CREE pas. Ce controle ne juge donc rien : il COMPTE,
        // pour que la discussion parte de chiffres et non d'impressions.
        // ⇒ DECOCHE PAR DEFAUT (meme parti que `poiNumero`), aucun bouton de
        // correction, et le report dit explicitement que ce n'est pas un ecart.
        { cle: 'hnSurRoute', portee: 'adresse', defaut: false,
          libelle: 'Mesure : numéros posés sur une voie nommée « D/N/C… » (pas une règle)' },
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
    // 1. Preuve geometrique : nos propres contours INSEE, sous le centre.
    try {
      const ctr = sdk.Map.getMapCenter();
      if (ctr && communes.length && communeDuPoint(ctr.lon, ctr.lat)) {
        return { nom: 'France', code: 'FR' };
      }
    } catch (e) { /* on essaie la suite */ }
    // 1 bis. ⚠️⚠️ UNE COMMUNE INSEE CHOISIE EST FRANCAISE, POINT — arbitrage de
    // l'auteur (27/07) : « Gruissan est en France. Point barre. On se fiche de
    // ce qu'on voit à cause du dézoom, ou d'avoir plus d'espace hors pays à
    // cause de la mer. »
    //
    // Cas vecu qui l'a impose : apres le cadrage sur Gruissan, le CENTRE
    // GEOMETRIQUE du canvas tombait EN PLEINE MER — hors contour, donc preuve 1
    // muette — et le cadrage d'une commune etendue s'arrete vers le zoom 13, ou
    // WME ne charge AUCUN segment, donc preuve 2 muette aussi. Le script se
    // declarait « territoire indetermine » devant une commune francaise
    // selectionnee, et refusait de l'analyser.
    //
    // ⚠️ Ce n'est pas un relachement du garde-fou de la v2.03 : l'analyse porte
    // sur le CONTOUR de la commune active, pas sur l'ecran. Tant qu'une commune
    // INSEE est choisie, tout ce que le script ecrira concernera cette commune —
    // francaise par construction. Le blocage garde tout son sens quand aucune ne
    // l'est (c'est alors la vue qui decide, preuves 1 et 2).
    if (communeActive) return { nom: 'France', code: 'FR' };
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

  /**
   * Ce nom de ville designe-t-il la commune traitee ?
   *
   * ⚠️ Vrai pour « Caraman » comme pour « Le Village (Caraman) » : le format des
   * villages rattaches designe bien cette commune-la. C'est le « a verifier
   * aussi avec les villes de… » de Glenan56 — sans ce cas, tous les segments
   * d'un village rattache seraient comptes « hors ville », a l'envers.
   * ⚠️ Comparaison sans accent ni casse : WME et l'INSEE ne s'accordent pas sur
   * les diacritiques.
   *
   * PURE.
   */
  function villeDeCetteCommune(ville, nomCommune) {
    const v = String(ville || '').trim();
    const c = normSansAccent(String(nomCommune || '').trim());
    if (!v || !c) return false;
    if (normSansAccent(v) === c) return true;
    const m = v.match(/\(([^)]+)\)\s*$/);       // « Village (Commune) »
    return !!m && normSansAccent(m[1].trim()) === c;
  }

  /**
   * Comment un segment SE DECLARE-t-il, d'apres son seul NOM PRINCIPAL ?
   *
   * ⭐ C'est la regle FR lue a l'envers : en agglomeration la ville est portee
   * par le principal, hors agglomeration il n'en porte pas. Le principal est
   * donc une DECLARATION de zone — et la comparer au terrain (le polygone
   * d'agglo) est exactement ce que Glenan56 fait a la main avec Road Selector :
   * « je vois de suite les segments hors ville mais edites comme etant en ville,
   * et les segments en ville qui ne sont pas selectionnes, donc possiblement
   * oublies ».
   *
   * ⚠️ On ne regarde QUE le principal : un alternatif portant une ville est
   * normal hors agglomeration (c'est meme la cible), il ne declare rien.
   *
   * PURE. Rend 'ville' | 'horsVille' | 'autreVille'.
   */
  function declarationDeZone(nam, nomCommune) {
    if (!nam || !nam.primary) return null;
    const v = (nam.primary.cityName || '').trim();
    if (!v) return 'horsVille';
    return villeDeCetteCommune(v, nomCommune) ? 'ville' : 'autreVille';
  }

  /** La commune analysee est-elle portee par le nom principal ou un alternatif ? */
  function communePortee(nam, nomCommune) {
    const cible = normSansAccent(String(nomCommune || '').trim());
    if (!cible) return false;
    return [nam.primary, ...nam.alts]
      .some(e => e && e.cityName && normSansAccent(e.cityName.trim()) === cible);
  }

  /**
   * Le zonage d'une commune VOISINE, vu depuis un segment.
   *
   * Rend 'agglo' (le segment touche une de ses agglomerations), 'hors' (son
   * zonage est CONNU et le segment n'y est pas) ou 'inconnu' — elle n'a jamais
   * ete zonee : ni polygone trace, ni declaration « sans agglomeration ».
   *
   * ⚠️⚠️ CE QUI N'A PAS PU ETRE CALIBRE : le critere de la branche 'agglo' est
   * « au moins un point du segment tombe dans un polygone de la voisine ». Il
   * est volontairement PERMISSIF — une voie qui longe la limite n'a par
   * construction qu'une faible part de son trace du cote d'en face. Mais AUCUNE
   * commune voisine n'etait zonee au moment ou ceci a ete ecrit (verifie avec
   * l'auteur, 27/07) : ce seuil n'a donc jamais ete mesure sur un cas reel,
   * contrairement a tous les autres seuils du projet. A eprouver le jour ou une
   * voisine sera tracee — c'est la seule branche du script dans ce cas.
   */
  function zonageChezLaVoisine(coords, code) {
    const liste = agglos[code] || [];
    if (!liste.length) return sansAgglo[code] ? 'hors' : 'inconnu';
    const r = partDedans(coords, (x, y) => liste.some(a => pointInRings(x, y, [a.ring])));
    return (r.total && r.dans > 0) ? 'agglo' : 'hors';
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

  // ===========================================================================
  // RPP EN AGGLOMERATION — legitime, ou numero a repasser sur le segment ?
  //
  // Doctrine de la v1.86, rappelee par l'auteur : en agglomeration le numero va
  // sur le SEGMENT, mais un POI residentiel y reste souvent LEGITIME, parce que
  // l'entree — la boite aux lettres — donne sur une AUTRE voie que l'adresse
  // postale. Un numero porte par un segment ne sait exprimer qu'une adresse sur
  // SA voie : le RPP est alors le seul moyen de dire la verite du terrain.
  //
  // ⚠️⚠️ D'ou le report « a trancher » de la v1.86, et non « a corriger ».
  // Les NUANCES demandees par l'auteur (26/07) servent a separer, dans ce tas,
  // les cas ou l'argument NE TIENT PAS — la, c'est un ecart franc :
  //   1. un numero identique est DEJA pose sur la meme rue, tout pres : le RPP
  //      fait doublon, quelle que soit la raison de sa presence ;
  //   2. le POINT D'ACCES du POI donne sur la voie meme de son adresse : il n'y
  //      a aucun decalage a exprimer. Et s'il donne sur une AUTRE voie, c'est au
  //      contraire la preuve que le POI est a sa place — il n'est plus signale ;
  //   3. faute de point d'acces, la POSITION : si la voie la plus proche du POI
  //      est celle de son adresse, un numero sur le segment dirait la meme
  //      chose. Sinon on ne conclut pas — la position n'est pas l'entree.
  //
  // ⚠️ La PHOTO n'innocente pas (arbitrage de l'auteur, 26/07) : un RPP
  // photographie a bien ete pose par quelqu'un venu sur place, donc on le DIT et
  // on le range en fin de liste, mais on ne masque rien. Mesure du 26/07 :
  // 26 RPP sur 28 sont photographies a Coursan et seulement 7 sur 35 a
  // Saint-Laurent-des-Arbres — masquer sur ce critere aurait vide l'audit d'une
  // commune et pas de l'autre. (Toutes les photos relevees portent
  // `scanned:true` : aucune autre espece n'existe dans les donnees.)
  // ===========================================================================

  /**
   * Ecart minimal, en metres, entre les deux voies candidates pour que « la plus
   * proche » veuille dire quelque chose. Sous cette marge, le POI est a
   * equidistance : le trace de Waze et la position du POI sont l'un comme
   * l'autre au metre pres, on ne tranche pas sur du bruit.
   *
   * ⚠️⚠️ CALEE SUR MESURE, PAS CHOISIE (Coursan, 26/07, 22 RPP situes le long de
   * leur propre rue) : les ecarts entre les deux voies candidates s'echelonnent
   * de 2 m a 57 m, et les POI sont a 0-24 m de leur rue. Sensibilite mesuree —
   * combien des 22 sont tranches : 5 m → 20 · 8 m → 19 · **10 m → 17** ·
   * 12 m → 15 · 15 m → 11 · 20 m → 7. En ville les rues sont a 20-30 m l'une de
   * l'autre : au-dela de 15 m on ne tranche presque plus rien. 10 m garde les
   * cas nets, laisse « a trancher » les POI d'angle de rue (18 m contre 27 m),
   * et c'est l'ordre de grandeur deja retenu en v2.18 pour le bruit de trace
   * (`SEUIL_DEBORD_M`).
   */
  const RPP_MARGE_VOIE_M = 10;
  /**
   * Au-dela de cette distance, la voie la plus proche ne dit plus rien du POI
   * (fond de lotissement, propriete profonde) : on s'abstient.
   */
  const RPP_PORTEE_VOIE_M = 120;
  /**
   * Rayon dans lequel un numero identique sur la MEME rue est le meme point
   * d'adresse. Au-dela, une longue rue peut porter deux fois le meme numero
   * (hameaux, bis/ter mal saisis) sans que ce soit un doublon.
   * ⚠️ Mesure du 26/07 a Coursan : le seul doublon trouve est a 95 m — le RPP
   * se pose a l'entree de la propriete, le numero au bord de la voie.
   */
  const RPP_DOUBLON_M = 150;

  /** Tous les noms de voie portes par un segment (principal + alternatifs). */
  function nomsDeVoie(nam) {
    if (!nam) return [];
    return [nam.primary, ...(nam.alts || [])]
      .map(e => (e && e.name || '').trim()).filter(Boolean);
  }

  /** Deux jeux de noms designent-ils la meme voie ? (un nom commun suffit) */
  const memeVoie = (a, b) => (a || []).some(x => (b || []).includes(x));

  /**
   * Cle d'un point d'adresse : « rue|numero », insensible a la casse, aux
   * espaces et aux accents — la saisie reelle est irreguliere (« 4 BIS », « 4bis »).
   * ⚠️ NE PAS l'appeler `cleAdresse` : ce nom est deja pris par la cle d'un
   * REPORT (persistance des « traites »), et une seconde declaration dans la
   * meme portee empeche le script entier de se charger.
   */
  const cleNumeroRue = (rue, num) =>
    normSansAccent(String(rue || '').trim()) + '|' +
    String(num == null ? '' : num).trim().toLowerCase().replace(/\s+/g, '');

  /**
   * Un numero identique est-il DEJA pose sur la meme rue, a portee du POI ?
   * Rend `{ numero, dist }`, ou null. `index` est la table « rue|numero » des
   * numeros lus (voir `analyserAdresses`).
   */
  function doublonDeNumero(rue, numero, point, index) {
    if (!index || !rue || numero == null || String(numero).trim() === '' || !point) return null;
    const liste = index.get(cleNumeroRue(rue, numero));
    if (!liste || !liste.length) return null;
    let best = null;
    for (const h of liste) {
      const d = distanceM(point, h.p);
      if (d <= RPP_DOUBLON_M && (!best || d < best.dist)) best = { numero: h.numero, dist: d };
    }
    return best;
  }

  /**
   * La voie la plus proche d'un point, parmi les segments lus.
   *
   * Rend `{ noms, dist, distAutreVoie }` : `distAutreVoie` est la distance a la
   * voie la plus proche portant un nom DIFFERENT — c'est elle qui dit si le
   * verdict est net ou si deux rues se disputent le POI.
   * ⚠️ Les segments SANS NOM comptent : une allee privee anonyme explique tres
   * bien qu'un POI soit loin de la rue qu'il declare, et l'ignorer ferait
   * conclure a tort que le POI longe l'adresse qu'il porte.
   */
  function voieLaPlusProche(lon, lat, segs) {
    // Boite de rejet, large : mesurer chaque trace de la commune pour chaque POI
    // couterait cher sans rien changer au resultat.
    const marge = RPP_PORTEE_VOIE_M * 3;
    const dLat = marge / 110540;
    const dLon = marge / (111320 * Math.max(0.1, Math.cos(lat * Math.PI / 180)));
    const candidats = [];
    for (const s of segs || []) {
      const co = s && s.geometry && s.geometry.coordinates;
      if (!co || !co.length) continue;
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (const p of co) {
        if (p[0] < x1) x1 = p[0]; if (p[0] > x2) x2 = p[0];
        if (p[1] < y1) y1 = p[1]; if (p[1] > y2) y2 = p[1];
      }
      if (lon < x1 - dLon || lon > x2 + dLon || lat < y1 - dLat || lat > y2 + dLat) continue;
      const d = distanceAuTrace(lon, lat, co);
      if (d > RPP_PORTEE_VOIE_M) continue;
      let nam = null; try { nam = readNaming(s); } catch (e) { /* segment hors modele */ }
      candidats.push({ d, noms: nomsDeVoie(nam) });
    }
    if (!candidats.length) return { noms: [], dist: Infinity, distAutreVoie: Infinity };
    candidats.sort((a, b) => a.d - b.d);
    const best = candidats[0];
    const autre = candidats.find(c => !memeVoie(best.noms, c.noms));
    return { noms: best.noms, dist: best.d, distAutreVoie: autre ? autre.d : Infinity };
  }

  /**
   * Verdict sur un RPP situe en agglomeration.
   *
   * Entrees deja mesurees par l'appelant (la fonction est PURE, donc eprouvable
   * sans carte) :
   *   - `rue`      : nom de la rue de l'adresse du POI ;
   *   - `voieAcces`: `voieLaPlusProche` autour du POINT D'ACCES, ou null ;
   *   - `voiePos`  : `voieLaPlusProche` autour de la position du POI ;
   *   - `doublon`  : `{ numero, dist }` si un numero identique est deja pose sur
   *                  la meme rue a portee, sinon null ;
   *   - `photo`    : le POI porte-t-il au moins une photo ?
   *
   * Rend `{ verdict, raison, source, photo }` avec `verdict` valant :
   *   'ecart'    — l'argument du decalage ne tient pas, le numero doit passer
   *                sur le segment (la conversion reste MANUELLE) ;
   *   'conforme' — le point d'acces PROUVE le decalage : on ne signale rien,
   *                mais on compte le cas pour le dire ;
   *   'trancher' — rien de mesurable ne permet de conclure : c'est le report
   *                historique, celui ou les deux reponses sont bonnes.
   */
  function verdictRppAgglo({ rue, voieAcces, voiePos, doublon, photo }) {
    const fin = (verdict, raison, source) => ({ verdict, raison, source, photo: !!photo });
    // 1. Le doublon ne se discute pas : la meme adresse existe deja deux fois.
    if (doublon) {
      return fin('ecart', 'le n° ' + doublon.numero + ' est déjà posé sur « ' + rue +
        ' » à ' + Math.round(doublon.dist) + ' m : ce POI fait doublon', 'numéro existant');
    }
    if (!rue) return fin('trancher', null, null);
    // 2. Le point d'acces, quand il existe, DIT ou se trouve l'entree.
    const base = voieAcces || voiePos;
    const source = voieAcces ? 'point d\'accès' : 'position du POI';
    if (!base || !isFinite(base.dist) || base.dist > RPP_PORTEE_VOIE_M) {
      return fin('trancher', null, null);
    }
    if (memeVoie(base.noms, [rue])) {
      // Une autre voie aussi proche ⇒ le constat ne vaut rien.
      if (isFinite(base.distAutreVoie) && base.distAutreVoie - base.dist < RPP_MARGE_VOIE_M) {
        return fin('trancher', null, null);
      }
      return fin('ecart', voieAcces
        ? 'le point d\'accès donne sur « ' + rue + ' », c\'est-à-dire sur la voie de ' +
          'l\'adresse elle-même : rien ne justifie un POI'
        : 'le POI est le long de « ' + rue + ' » (' + Math.round(base.dist) + ' m), ' +
          'la voie de son adresse : un numéro sur le segment dirait la même chose',
        source);
    }
    // 3. L'acces donne sur une AUTRE voie : c'est exactement le cas legitime.
    // ⚠️ La POSITION seule ne suffit pas a conclure ca — elle ne dit pas ou est
    // l'entree —, donc sans point d'acces on en reste a « a trancher ».
    if (voieAcces && base.noms.length &&
        (!isFinite(base.distAutreVoie) || base.distAutreVoie - base.dist >= RPP_MARGE_VOIE_M)) {
      return fin('conforme', 'le point d\'accès donne sur « ' + base.noms[0] +
        ' », pas sur « ' + rue + ' » : le POI dit un décalage qu\'un numéro ne saurait exprimer',
        'point d\'accès');
    }
    return fin('trancher', null, null);
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

  // ===========================================================================
  // PROPOSER UNE ADRESSE A UN POI QUI N'EN A PAS (v2.19)
  //
  // Demande de l'auteur (26/07) : « proposer adresse et numero, base sur le
  // point d'entree et le segment le plus proche. Si pas de point d'entree,
  // proposer le nom du segment le plus proche ; pour le numero, le numero HN ou
  // RPP le plus proche. Si on voit qu'il n'y a pas de match pertinent, on laisse
  // l'utilisateur prendre ses responsabilites. »
  //
  // ⚠️⚠️ C'est ce dernier point qui commande tout le reste : une proposition
  // fausse est PIRE que pas de proposition, parce qu'elle sera appliquee d'un
  // clic. On ne propose donc que ce qui est NET, et on affiche les distances qui
  // ont servi a conclure — l'editeur doit pouvoir refaire le raisonnement.
  //
  // ⚡ MESURE (Saint-Laurent-des-Arbres, 26/07, 10 POI a adresse incomplete) :
  //   - une voie NOMMEE existe a moins de 150 m pour les 10, mais a des
  //     distances de 2 a 115 m — proposer sans seuil aurait donne des adresses
  //     absurdes (la « ZAC de Tesan-Nord » a 115 m de la premiere rue nommee) ;
  //   - le segment le plus proche est SOUVENT ANONYME (parking, allee de
  //     desserte) : il ne fournit aucune adresse, il faut la voie NOMMEE ;
  //   - un seul POI sur dix a un numero plausible a moins de 30 m.
  // ===========================================================================

  /**
   * Distance maximale a la voie proposee. Au-dela, le lien entre le lieu et la
   * rue n'est plus une evidence (mesure : 55 m pour un chateau au bout de son
   * chemin — encore credible ; 115 m pour une ZAC — plus du tout).
   */
  const POI_PORTEE_VOIE_M = 60;
  /**
   * Meme notion que `RPP_MARGE_VOIE_M`, et volontairement LA MEME VALEUR : deux
   * voies trop proches l'une de l'autre pour qu'on puisse trancher. ⚠️ On la
   * derive au lieu de la recopier — deux valeurs jumelles finissent toujours par
   * diverger, et le sens colle exactement (contrairement au piege de la v2.10,
   * ou j'avais branche un seuil qui n'avait rien a voir).
   */
  const POI_MARGE_VOIE_M = RPP_MARGE_VOIE_M;
  /**
   * Distance maximale d'un numero repris comme proposition. ⚠️ Volontairement
   * courte : a 30 m, un numero peut deja etre celui du VOISIN. C'est pourquoi il
   * est propose SANS jamais etre applique automatiquement.
   */
  const POI_PORTEE_NUM_M = 30;

  /**
   * L'adresse la plus probable pour un POI qui n'en a pas.
   *
   * `point` est la position retenue (point d'acces principal si le POI en a un,
   * sinon sa geometrie — c'est `positionPoi` qui l'a choisie, et sa PROVENANCE
   * est affichee a l'editeur). `numeros` est la liste des numeros lus, chacun
   * avec sa position et sa rue.
   *
   * Rend `{ rue, ville, dist, autre, segId, numero, fiable }` ou `null`.
   * `fiable` distingue « je propose » de « regarde toi-meme » : c'est lui qui
   * commande l'apparition du bouton.
   */
  function proposerAdressePoi(point, segs, numeros) {
    if (!point) return null;
    // ⚠️⚠️ TOUS LES NOMS DU SEGMENT, principal ET ALTERNATIFS — comme `rueDuPoi`.
    // Le cas qui l'a impose (camp militaire de Saint-Laurent, releve du 26/07) :
    // le segment a 15 m porte « D121 » en PRINCIPAL et « Route de Laudun » en
    // ALTERNATIF. C'est le nommage hors agglomeration canonique du projet — ne
    // lire que le principal, c'est ne jamais voir le vrai nom de rue.
    const parNom = new Map();
    for (const s of segs || []) {
      const co = s && s.geometry && s.geometry.coordinates;
      if (!co || !co.length) continue;
      let nam = null; try { nam = readNaming(s); } catch (e) { /* hors modele */ }
      if (!nam) continue;
      const d = distanceAuTrace(point[0], point[1], co);
      if (d > POI_PORTEE_VOIE_M) continue;
      for (const e of [nam.primary, ...(nam.alts || [])]) {
        // ⚠️ Une voie SANS NOM ne fournit pas d'adresse : le POI est tres souvent
        // colle a une allee de desserte anonyme, qui n'apprend rien.
        const nom = (e && e.name || '').trim();
        if (!nom) continue;
        const vu = parNom.get(nom);
        if (!vu || d < vu.d) {
          parNom.set(nom, { d, nom, ville: (e.cityName || '').trim(), segId: s.id,
                            // ⚠️ « D121 » N'EST PAS UNE ADRESSE (doctrine de
                            // `rueDuPoi`) : le numero de route reste PROPOSABLE
                            // — l'editeur peut avoir ses raisons — mais jamais
                            // en tete, et jamais applique sans qu'il l'ait dit.
                            estRoute: RE_ROUTE.test(nom) });
        }
      }
    }
    if (!parNom.size) return null;
    // Les vrais noms de rue d'abord, du plus proche au plus loin ; les numeros
    // de route ensuite, en dernier recours.
    const candidats = [...parNom.values()].sort((a, b) =>
      (a.estRoute ? 1 : 0) - (b.estRoute ? 1 : 0) || a.d - b.d);
    const vrais = candidats.filter(c => !c.estRoute);
    const best = vrais[0] || null;
    // « L'autre voie » qui compte pour l'indecision est un autre VRAI nom de rue :
    // un numero de route porte par le meme segment ne dispute rien a personne.
    const autre = best ? vrais.find(c => c.nom !== best.nom) : null;
    const dAutre = autre ? autre.d : Infinity;
    return { rue: best ? best.nom : null, ville: best ? best.ville : '',
             dist: best ? best.d : Infinity, autre: dAutre,
             segId: best ? best.segId : candidats[0].segId,
             numero: best ? numeroLePlusProche(point, best.nom, numeros) : null,
             candidats,
             // Net = un vrai nom de rue, proche, et aucun autre ne se le dispute.
             fiable: !!best && dAutre - best.d >= POI_MARGE_VOIE_M };
  }

  /**
   * Le numero deja pose le plus proche, SUR LA VOIE DONNEE.
   *
   * ⚠️ Un numero d'une autre rue ne dit rien de ce lieu, meme s'il est plus
   * pres : c'est une adresse sur une autre voie. Et meme sur la bonne voie, ce
   * n'est qu'une PISTE — a 30 m ce peut deja etre le voisin —, ce qui est
   * pourquoi il n'est jamais applique automatiquement.
   *
   * ⚡ Seuil cale sur mesure (Saint-Laurent-des-Arbres, 26/07) : pour les 30 POI
   * sans numero dont la voie est identifiable, le numero le plus proche est a
   * 5 m … 527 m, mediane 24 m. Sous 30 m on en propose 19 sur 30 ; a 50 m on
   * monterait a 25, mais un numero a 45 m de distance n'a plus de rapport avec
   * le lieu qu'on regarde.
   */
  function numeroLePlusProche(point, rue, numeros) {
    if (!point || !rue) return null;
    let best = null;
    for (const n of numeros || []) {
      if (!n || !n.p || !n.num || n.rue !== rue) continue;
      const d = distanceM(point, n.p);
      if (d <= POI_PORTEE_NUM_M && (!best || d < best.dist)) {
        best = { num: String(n.num), dist: d, source: n.src || 'numéro' };
      }
    }
    return best;
  }

  /**
   * Audite les adresses des VRAIS POI d'une commune.
   *
   * `venues` vient de l'API (`app/Features`), avec les dictionnaires `streets` et
   * `cities` de la meme reponse : les noms se resolvent sans appel de plus.
   * ⚠️ Les objets de l'API ne sont PAS dans le data model (cf. [[wme-sdk-pieges]]) :
   * on ne cherche donc rien par identifiant, on fait circuler ce qu'on a lu.
   */
  function auditerPoi(venues, dicoRues, dicoVilles, commune, stats, segs, numeros) {
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
      // Proposition d'adresse (v2.19) : calculee UNE fois, servie aux deux
      // controles ci-dessous. La ville proposee est toujours la commune INSEE —
      // doctrine du projet — et jamais celle lue sur le segment, qui peut etre
      // fausse (meme piege que l'etiquette de polygone, v1.10).
      // ⚠️ « Deja bonne » = un vrai nom de voie. Un NUMERO DE ROUTE n'en est pas
      // un (doctrine de `rueDuPoi`) : le camp militaire porte « D121 », et c'est
      // precisement ce qu'il faut remplacer par « Route de Laudun ».
      const rueDejaBonne = !!nomRue && !RE_ROUTE.test(nomRue);
      const propose = (c.poiAdresse && (v.streetID == null || !nomRue || !ville))
        ? proposerAdressePoi(situation.point, segs, numeros) : null;
      const commePhrase = p => p.rue + ' / ' + commune.nom +
        (p.numero ? ' — n° ' + p.numero.num + ' ?' : '') +
        ' (voie à ' + Math.round(p.dist) + ' m' +
        (isFinite(p.autre) ? ', la suivante à ' + Math.round(p.autre) + ' m' : '') +
        (p.numero ? ', numéro à ' + Math.round(p.numero.dist) + ' m' : '') + ')';
      const autresQue = p => p.candidats.filter(c => c.nom !== p.rue)
        .map(c => c.nom + ' (' + Math.round(c.d) + ' m)').join(', ');
      // ── 1. Adresse incomplete ────────────────────────────────────────────
      if (c.poiAdresse) {
        // ⚠️ On ne propose QUE si c'est net (`fiable`). Sinon on montre quand
        // meme la piste, en disant qu'elle n'en est qu'une : « pas de match
        // pertinent ⇒ l'editeur prend ses responsabilites » (auteur, 26/07).
        // Trois situations, trois messages — et le ⚡ existe dans les trois,
        // parce qu'il y a matiere a proposer dans les trois.
        const suite = !propose
          ? null
          : !propose.rue
            // Que des numeros de route a proximite : ce ne sont pas des
            // adresses, mais l'editeur doit pouvoir les choisir quand meme.
            ? 'aucun nom de rue à proximité — seulement ' + autresQue(propose) +
              ' : ⚡ pour choisir ou saisir l\'adresse'
            : propose.fiable && propose.candidats.length === 1
              ? 'proposition : ' + commePhrase(propose)
              : 'proposition : ' + commePhrase(propose) + ' — autres possibilités : ' +
                autresQue(propose) + ' (⚡ pour choisir)';
        if (v.streetID == null) {
          ecarts.push({ champ: 'adresse absente', avant: '—',
            apres: suite || 'renseigner la rue et la commune (' + commune.nom + ')' });
        } else {
          if (!nomRue) ecarts.push({ champ: 'rue absente', avant: '—',
            apres: suite || 'renseigner le nom de la voie' });
          // ⚠️ La rue du POI est un NUMERO DE ROUTE : ce n'est pas une adresse
          // postale, et c'est le cas qui a servi d'exemple a l'auteur (« D121 »
          // au camp militaire). On le DIT, avec ce que le script propose a la
          // place — sinon la ligne se lit « il manque la commune », alors que
          // c'est l'adresse entiere qui est a revoir.
          if (nomRue && !rueDejaBonne) ecarts.push({ champ: 'rue = numéro de route', avant: nomRue,
            apres: suite || 'un numéro de route n\'est pas une adresse : renseigner le nom de la voie' });
          if (!ville) ecarts.push({ champ: 'commune absente', avant: '—',
            apres: 'renseigner ' + commune.nom +
              (rueDejaBonne && propose ? ' (la rue « ' + nomRue +' » est conservée)' : '') });
        }
      }
      // ── 2. Numero : controle A PART, decoche par defaut ──────────────────
      if (c.poiNumero && v.streetID != null && !numero) {
        // ⚠️ Le numero se cherche sur la rue que le POI porte DEJA — pas sur une
        // voie proposee : ici l'adresse existe, il n'y manque que le numero.
        // ⚡ C'est le cas ou la proposition sert le plus (43 POI a
        // Saint-Laurent-des-Arbres, contre 10 pour l'adresse incomplete).
        const n = nomRue ? numeroLePlusProche(situation.point, nomRue, numeros) : null;
        ecarts.push({ champ: 'numéro absent', avant: '—',
          apres: n
            ? 'n° ' + n.num + ' ? — c\'est le point d\'adresse le plus proche sur « ' + nomRue +
              ' » (' + Math.round(n.dist) + ' m, ' + n.source + '), à vérifier avant de saisir'
            : 'renseigner le numéro de rue' });
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
        // ⚠️ PAS d'`esc()` ici : le rendu echappe deja `e.apres` (liste ET
        // infobulle). Echapper deux fois affichait « L&#39;Isle-sur-la-Sorgue »
        // au lieu de « L'Isle-sur-la-Sorgue » — visible sur toute commune a
        // apostrophe (defaut trouve au passage, v2.19).
        ecarts.push({ champ: 'commune à vérifier', avant: ville,
          apres: pres
            ? commune.nom + ' ? — à ' + Math.round(d) + ' m de la limite communale, ' +
              'l\'adresse de la commune voisine peut être la bonne'
            : commune.nom + ' — le lieu est dans le contour de ' + commune.nom +
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
        // ⚠️⚠️ `nb` ET `verrouilles` SONT OBLIGATOIRES, meme sur un objet unique :
        // les reports POI ne passent PAS par `regrouperFindings` (ils sont
        // concatenes tels quels), donc personne ne les pose pour eux. Le rendu du
        // bouton ⚡ teste `f.verrouilles !== f.nb` — avec deux `undefined` la
        // comparaison est FAUSSE et le bouton n'est jamais dessine. C'est ce qui
        // a fait dire a l'auteur « aucune evolution visible » sur la v2.19 : tout
        // le calcul etait juste, seul le bouton manquait. ⚠️ Un POI n'a pas de
        // verrou de segment : rien ne bloque son adresse.
        nb: 1, verrouilles: 0,
        // ⚡ LE BOUTON APPARAIT DES QU'IL Y A QUELQUE CHOSE DE CONCRET A PROPOSER
        // (l'auteur, 26/07) — pas seulement quand c'est net. Quand plusieurs
        // noms sont possibles, ou qu'aucun ne se detache, le clic n'applique
        // rien : il OUVRE LA BOITE DE CHOIX, le meilleur en tete. C'est l'editeur
        // qui tranche, ce qui reste fidele a « pas de match pertinent ⇒ il prend
        // ses responsabilites » : on ne lui impose rien, on lui epargne la
        // recherche.
        propositionAdresse: (propose && propose.candidats.length) ? {
          // ⚠️⚠️ NE JAMAIS ECRASER UNE RUE DEJA JUSTE. Quand seule la commune
          // manque, le POI porte souvent un nom de voie parfaitement valable :
          // appliquer la proposition a sa place remplacerait une bonne adresse
          // par une deduction. Le cas se voit sur le camp militaire, qui porte
          // « D121 » — un numero de route, donc PAS une adresse (doctrine de
          // `rueDuPoi`) : celui-la, on le remplace.
          rue: rueDejaBonne ? nomRue : propose.rue, ville: commune.nom, segId: propose.segId,
          candidats: propose.candidats.map(c => ({
            nom: c.nom, ville: commune.nom, dist: c.dist != null ? c.dist : c.d,
            d: c.d, estRoute: c.estRoute, segId: c.segId })),
          // Rien a choisir ⇒ pas de boite : soit la rue est deja bonne et seule
          // la commune manque, soit un unique nom de rue se detache.
          direct: rueDejaBonne || (!!propose.fiable && propose.candidats.length === 1),
          // Le numero n'est JAMAIS applique (arbitrage de l'auteur, 26/07) : a
          // 30 m ce peut etre celui du voisin, et une adresse fausse posee d'un
          // clic est pire que l'adresse manquante qu'on corrige.
          numeroPropose: propose.numero ? propose.numero.num : null
        } : null,
        aideTitre: propose ? 'D\'où vient cette proposition' : null,
        aide: propose ? [
          (propose.rue
            ? 'Voie nommée la plus proche du ' +
              (situation.source === 'accès principal' || situation.source === 'point d\'accès'
                ? 'point d\'accès' : 'lieu') + ' : « ' + propose.rue + ' », à ' +
              Math.round(propose.dist) + ' m' +
              (isFinite(propose.autre)
                ? ', la voie suivante étant à ' + Math.round(propose.autre) + ' m.'
                : ', et aucune autre voie nommée à moins de ' + POI_PORTEE_VOIE_M + ' m.')
            : 'Les seules voies à moins de ' + POI_PORTEE_VOIE_M + ' m portent un numéro de route : ' +
              'ce n\'est pas une adresse postale, le script ne le propose donc pas d\'office.') +
            ' Le nom est cherché sur le principal ET les alternatifs : hors agglomération, ' +
            'c\'est justement l\'alternatif qui porte le nom de rue.',
          propose.numero
            ? '⚠️ Numéro n° ' + propose.numero.num + ' relevé à ' + Math.round(propose.numero.dist) +
              ' m sur cette voie : c\'est le point d\'adresse le plus proche, PAS une certitude — ' +
              'à cette distance ce peut être celui du voisin. Le script ne l\'applique jamais.'
            : 'Aucun numéro à moins de ' + POI_PORTEE_NUM_M + ' m sur cette voie : à saisir à la main.',
          (propose.fiable && propose.candidats.length === 1)
            ? 'La commune appliquée est celle du contour INSEE (' + commune.nom + '), pas celle du segment.'
            : '⚡ ouvre la liste des noms relevés autour du lieu — le plus probable en tête, ' +
              'les numéros de route ensuite, et une saisie libre. La commune appliquée sera ' +
              'celle du contour INSEE (' + commune.nom + ').'
        ] : null,
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
    // ⚠️ La MESURE des numeros poses sur une voie « Dxxx » est INDEPENDANTE du
    // controle « numeros hors agglomeration » : elle porte sur les numeros EN
    // agglomeration, que celui-ci ecarte precisement. Elle doit donc pouvoir
    // tourner seule — sinon on ne mesurerait que chez ceux qui ont deja coche
    // autre chose, et le chiffre ne vaudrait rien.
    const faireHnRoute = (!phases || phases.hn) && c.hnSurRoute;
    if (!faireHn && !fairePoi && !faireHnRoute) return;
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

    // --- 0. Lecture des numeros de rue — PARTAGEE par les deux controles -----
    //
    // ⚠️ v2.19 : les numeros ne servent plus seulement au controle « numeros
    // hors agglomeration ». La detection des RPP en doublon (phase 2) a besoin
    // de savoir quels numeros sont DEJA poses sur la voie — y compris EN
    // agglomeration, que la phase 1 ecarte justement. Une seule lecture nourrit
    // les deux, et le controle POI la declenche meme seul.
    let tousHn = [];
    if (faireHn || fairePoi || faireHnRoute) {
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
        // ⚡ `hasHNs` (donne par l'API) dit quels segments portent des numeros :
        // quand l'information est la, on n'interroge QUE ceux-la. ⚠️ Verifie sur
        // Saint-Laurent-des-Arbres avant d'y toucher : 335 porteurs sur 927
        // segments rendent **1371 numeros, exactement comme la lecture complete
        // — 0 manquant** — en deux fois moins de temps (580 ms contre 1156 ms).
        // En balayage la propriete n'existe pas : on retombe sur tout.
        const porteurs = segs.filter(s => s.hasHNs);
        const tousIds = (porteurs.length ? porteurs : segs).map(s => s.id);
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
        tousHn = hns;
      } catch (e) {
        if (e && e.annulation) throw e;      // une interruption n'est pas une panne
        log('lecture des numéros de rue impossible', e);
        stats.hnErreur = e.message || String(e);
      }
    }

    // Index « rue|numero » → positions des numeros deja poses : c'est lui qui
    // dit qu'un RPP fait doublon. ⚠️ Accumule dans `stats` : en balayage la
    // commune arrive par cellules, un index local ne verrait que la derniere.
    // ⚠️ La LISTE `stats.numeros` sert a un tout autre usage : proposer une
    // adresse aux VRAIS POI qui n'en ont pas (`proposerAdressePoi`). Elle est
    // remplie meme quand le controle des RPP est decoche, parce que l'audit des
    // POI est un onglet a part, avec ses propres cases.
    if (!stats.numeros) stats.numeros = [];
    if (!stats.hnIndexVus) stats.hnIndexVus = new Set();
    if (fairePoi && !stats.hnIndex) stats.hnIndex = new Map();
    for (const hn of tousHn) {
      if (stats.hnIndexVus.has(hn.id)) continue;      // cellules qui se recouvrent
      stats.hnIndexVus.add(hn.id);
      const p = hn.geometry && hn.geometry.coordinates;
      if (!p) continue;
      const seg = segmentDe(hn.segmentId);
      let nam = null; try { nam = seg ? readNaming(seg) : null; } catch (e) { /* hors modele */ }
      // Un numero appartient a son segment : il est donc « sur » n'importe
      // lequel des noms que ce segment porte, principal comme alternatif.
      for (const nom of nomsDeVoie(nam)) {
        stats.numeros.push({ p, num: hn.number, rue: nom, src: 'numéro de rue' });
        if (!stats.hnIndex) continue;
        const cle = cleNumeroRue(nom, hn.number);
        if (!stats.hnIndex.has(cle)) stats.hnIndex.set(cle, []);
        stats.hnIndex.get(cle).push({ p, numero: hn.number });
      }
    }

    // --- 1. Numeros de rue hors agglomeration -------------------------------
    if (faireHn) {
      const parSegment = new Map();
      for (const hn of tousHn) {
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

    // --- 1 bis. MESURE : numeros poses sur une voie nommee « Dxxx » ----------
    //
    // ⚠️⚠️ CE BLOC NE JUGE RIEN. Il repond a une question posee par Glenan56 le
    // 27/07 : en ville, combien de numeros sont poses sur un segment dont le nom
    // PRINCIPAL est un numero de route, et pas une adresse postale ? Sa norme
    // proposee voudrait les interdire ; elle n'est ni validee par les LC ni au
    // wiki, donc le script se contente de COMPTER (voir le commentaire du
    // controle `hnSurRoute`).
    //
    // ⚠️ Le critere est le PRINCIPAL SEUL, volontairement. La regle de nommage
    // hors agglomeration du projet met justement le numero de route en principal
    // et le nom de rue en ALTERNATIF (cas du camp militaire, v2.19 : « D121 » en
    // principal, « Route de Laudun » en alternatif). Glenan56 tolere d'ailleurs
    // l'alternatif pour les variantes d'ecriture et les langues regionales. Un
    // segment qui porte un vrai nom de rue en principal n'entre donc pas dans la
    // mesure, meme s'il a un numero de route en alternatif.
    if (faireHnRoute) {
      // ⚠️ Son PROPRE jeu de « deja vus » : `stats.hnVus` appartient au controle
      // hors agglomeration. Partager les deux ferait qu'un numero vu par l'un
      // deviendrait invisible pour l'autre — selon l'ordre des cellules, donc de
      // maniere imprevisible.
      if (!stats.hnRouteVus) stats.hnRouteVus = new Set();
      const parSegment = new Map();
      for (const hn of tousHn) {
        if (stats.hnRouteVus.has(hn.id)) continue;
        stats.hnRouteVus.add(hn.id);
        const p = hn.geometry && hn.geometry.coordinates;
        if (!p) continue;
        if (!dansCommune(p[0], p[1])) continue;
        // Hors agglomeration, un numero sur une Dxxx est deja traite par le
        // controle 1 (il doit devenir un POI residentiel) : le compter ici
        // ferait un doublon de report sur le meme numero.
        if (!dansAgglo(p[0], p[1])) continue;
        if (!parSegment.has(hn.segmentId)) parSegment.set(hn.segmentId, []);
        parSegment.get(hn.segmentId).push(hn);
      }
      for (const [segId, liste] of parSegment) {
        const seg = segmentDe(segId);
        let nam = null; try { nam = seg ? readNaming(seg) : null; } catch (e) { /* hors modele */ }
        if (!nam || !estNumero(nam.primary)) continue;
        const nomPrincipal = fmt(nam.primary);
        // Le nom de rue existe-t-il malgre tout, en alternatif ? C'est ce qui
        // distingue « adresse recuperable » de « aucune adresse postale ici » —
        // et c'est le chiffre qui rendra la discussion utile.
        const alt = (nam.alts || []).find(a => a && a.name && !RE_ROUTE.test(a.name.trim()));
        stats.hnSurRoute = (stats.hnSurRoute || 0) + liste.length;
        if (alt) stats.hnSurRouteAvecAlt = (stats.hnSurRouteAvecAlt || 0) + liste.length;
        for (const h of liste) {
          findings.push({
            adresse: true, sousType: 'hn', cas: 'HN-RTE', segId,
            // ⚠️⚠️ LE DRAPEAU QUI FERME TOUT : pas de bouton ⚡ (`planDeCorrection`
            // sort dessus) et pas le message « la conversion ne peut pas etre
            // proposee », qui serait faux — il n'y a AUCUNE conversion prevue.
            mesure: true,
            hnId: h.id,
            libelle: nomPrincipal + ' — n° ' + h.number,
            roadType: seg ? seg.roadType : null,
            nbPoints: 1,
            hns: [{ id: h.id, number: h.number, geometry: h.geometry }],
            geom: h.geometry,
            centre: (p => ({ lon: p[0], lat: p[1] }))(centreGeom(h.geometry)),
            ecarts: [{ champ: 'mesure (pas un écart)',
                       avant: 'n° ' + h.number + ' sur « ' + nomPrincipal +
                              ' » — le nom principal est un numéro de route',
                       apres: alt
                         ? 'nom de rue présent en alternatif : « ' + alt.name.trim() + ' »'
                         : 'aucun nom de rue sur ce segment, même en alternatif' }],
            doute: 'Relevé à la demande d\'un éditeur, pour mesurer l\'ampleur du cas. ' +
                   'Ce n\'est pas un écart : aucune règle française ne l\'interdit à ce jour. ' +
                   'Ne corrige rien sur cette seule base.'
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
      // ⚠️ Les reports sont mis de cote avant d'etre pousses : la PHOTO ne
      // masque rien, mais elle range le cas EN FIN de liste (arbitrage de
      // l'auteur, 26/07). Trier a la fin est le seul moment ou on les a tous.
      const reportsRpp = [];
      for (const v of venues) {
        if (stats.poiVus && stats.poiVus.has(v.id)) continue;   // cellules qui se recouvrent
        if (stats.poiVus) stats.poiVus.add(v.id);
        const p = centreGeom(v.geometry);
        if (!p) continue;
        let num = '', rueNom = '';
        if (v._adr) {
          num = v._adr.houseNumber || '';
          rueNom = (v._adr.street && v._adr.street.name) || '';
        } else {
          try { const a = sdk.DataModel.Venues.getAddress({ venueId: String(v.id) });
                num = (a && a.houseNumber) || '';
                rueNom = (a && a.street && a.street.name) || ''; } catch (e) { /* */ }
        }
        // ⚠️ Recense AVANT les filtres de zone : un RPP hors agglomeration porte
        // un numero tout aussi utile pour proposer l'adresse d'un POI voisin
        // (l'auteur, 26/07 : « le numero HN ou RPP le plus proche »).
        if (num && rueNom && stats.numeros) {
          stats.numeros.push({ p, num, rue: rueNom, src: 'POI résidentiel' });
        }
        if (!dansCommune(p[0], p[1])) continue;
        if (!dansAgglo(p[0], p[1])) continue;                  // a sa place
        stats.poiAgglo++;

        // ── Les nuances de la v2.19 : ce RPP a-t-il une raison d'etre ? ──────
        // ⚠️ Le point d'acces prime sur la position : il DIT ou est l'entree,
        // quand la position ne fait que la suggerer. `positionPoi` connait
        // deja l'ordre de preference (accès principal → entrée → geometrie).
        const acces = positionPoi(v);
        const aUnAcces = acces.point && (acces.source === 'accès principal' || acces.source === 'point d\'accès');
        const verdict = verdictRppAgglo({
          rue: rueNom,
          voieAcces: aUnAcces ? voieLaPlusProche(acces.point[0], acces.point[1], segs) : null,
          voiePos: voieLaPlusProche(p[0], p[1], segs),
          doublon: doublonDeNumero(rueNom, num, p, stats.hnIndex),
          photo: (v.images || []).length > 0
        });
        // Le point d'acces PROUVE le decalage : le POI est a sa place. On ne le
        // signale plus — mais on le COMPTE, pour ne pas laisser croire que
        // l'audit n'a rien vu (leçon des giratoires : toujours dire ou sont
        // passes les cas manquants).
        if (verdict.verdict === 'conforme') { stats.poiAggloConforme++; continue; }
        // ⚠️ Compte APRES les conformes : le bilan annonce « restent signales,
        // en fin de liste », ce qui serait faux pour un cas qu'on ne signale pas.
        if (verdict.photo) stats.poiAggloPhoto++;
        const ecart = verdict.verdict === 'ecart';
        if (ecart) stats.poiAggloEcart++;

        reportsRpp.push({
          adresse: true, sousType: 'poi', cas: 'POI-C', segId: 'v' + v.id,
          libelle: (v.name || 'POI résidentiel') + (num ? ' — n° ' + num : ''),
          roadType: null, nbPoints: 1,
          geom: { type: 'Point', coordinates: p },
          centre: { lon: p[0], lat: p[1] }, venueId: String(v.id),
          // Sert au tri : les cas photographies passent apres les autres.
          rppPhoto: verdict.photo,
          // ⚠️⚠️ DEUX REPORTS DIFFERENTS SOUS LE MEME CAS.
          // Par defaut c'est une QUESTION, pas un defaut : en agglomeration le
          // numero va sur le segment, sauf si l'entree donne sur une autre voie
          // — les deux reponses sont bonnes, et ecrire « a passer sur le
          // segment » ferait corriger a tort les POI qui ont raison (v1.86).
          // Mais quand une des nuances de la v2.19 a tranche, on l'AFFIRME avec
          // sa raison : la question ne se pose plus.
          ecarts: [{ champ: ecart ? 'POI résidentiel injustifié' : 'POI résidentiel en agglo',
                     avant: num ? 'n° ' + num + ' porté par un POI résidentiel' : 'POI résidentiel sans numéro',
                     apres: ecart
                       ? 'le numéro doit passer sur le segment (à faire à la main)'
                       : 'à trancher : numéro sur le segment, ou entrée sur une autre voie' }],
          // ⚠️ Le sens POI → numero n'est pas automatise, et ce n'est pas une
          // limite du SDK (`addHouseNumber` et `deleteVenue` existent) : le
          // script ne sait dire ni sur QUEL segment ni a QUEL endroit poser le
          // numero, et supprimer le POI emporterait son nom, son point d'entree
          // et ses photos. On guide donc l'editeur au lieu de decider pour lui.
          aideTitre: ecart
            ? 'Pourquoi ce POI n\'a pas lieu d\'être'
            : 'Deux issues possibles — c\'est le terrain qui tranche',
          aide: ecart
            ? [ (verdict.raison || '') + (verdict.source ? ' (constaté sur : ' + verdict.source + ')' : '') + '.',
                'Sélectionne la voie, ouvre « Ajouter des numéros de rue », pose' +
                  (num ? ' le n° ' + num : ' le numéro') + ' du bon côté, vérifie qu\'il tombe ' +
                  'devant l\'entrée, puis supprime ce POI.',
                '⚠️ Vérifie quand même sur place : le script mesure des distances, ' +
                  'il ne voit pas la boite aux lettres.' ]
            : [ 'Si l\'entrée (la boite aux lettres) donne bien sur ' +
                  (rueNom ? '« ' + rueNom + ' »' : 'la rue de l\'adresse') +
                  ' : le numéro doit passer sur le segment. Sélectionne la voie, ouvre ' +
                  '« Ajouter des numéros de rue », pose' + (num ? ' le n° ' + num : ' le numéro') +
                  ' du bon côté, vérifie qu\'il tombe devant l\'entrée, puis supprime ce POI.',
                'Si l\'entrée donne sur une AUTRE voie que l\'adresse postale : laisse le POI en place. ' +
                  'C\'est précisément ce qu\'il sert à dire, et un numéro sur segment ne saurait pas ' +
                  'l\'exprimer. Marque la ligne comme traitée (✓) pour ne pas la revoir.' ],
          // ⚠️ La photo ne disculpe pas, elle TEMPERE : quelqu'un est venu sur
          // place. On le dit, on ne le cache pas (arbitrage de l'auteur, 26/07).
          doute: verdict.photo
            ? 'ce POI porte une photo : il a été posé par un contributeur venu sur place — ' +
              'regarde-le de près avant de le supprimer'
            : null
        });
      }
      // Les cas photographies en dernier ; a photo egale, l'ordre de lecture est
      // conserve (tri stable).
      reportsRpp.sort((a, b) => (a.rppPhoto ? 1 : 0) - (b.rppPhoto ? 1 : 0));
      findings.push(...reportsRpp);
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
      // ⚠️ v2.19 : une PHOTO dit que quelqu'un est venu sur place poser ce POI
      // (arbitrage de l'auteur, 26/07 — elle tempere le report sans l'annuler).
      // Releve le 26/07 : `images: [{id, date, location, street, approved,
      // scanned}]`, et TOUTES les photos rencontrees portent `scanned:true`.
      // ⚠️ Le SDK les donne AUSSI, mais sous une autre forme (`{id, url,
      // isApproved, creationDate}`) : seule leur PRESENCE nous interesse, donc
      // les deux sources se valent et le balayage n'est pas penalise.
      images: v.images || [],
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
    const zones = { agglo: 0, hors: 0, cheval: 0, limCom: 0, limComRien: 0, limitrophe: 0, cartouche: 0, special: 0, giratoire: 0,
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
      // ⚠️ `villeActuelle` : la ville portee AUJOURD'HUI par le principal. Elle
      // sert au ⚡ de la correction de redaction — `updateAddress` ecrit nom ET
      // ville d'un coup, l'omettre EFFACERAIT la ville du segment.
      const base = { segId: seg.id, roadType: seg.roadType, libelle: fmt(nam.primary),
                     villeActuelle: (nam.primary && nam.primary.cityName) || '',
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
        } else if (!coupeCommunaleUtile(nam)) {
          // ⚠️ NI nom NI ville : couper donnerait deux moities identiques a
          // l'originale (voir `coupeCommunaleUtile`). On ne propose rien — et on
          // n'audite pas non plus son nommage : a cheval, on ne sait pas de
          // quelle commune relevera chaque moitie. ⭐ Mais on le COMPTE : un
          // segment ecarte en silence est un segment qu'on croit avoir vu.
          zones.limComRien++;
          continue;
        } else {
          zones.limCom++;
          // ⭐ Le report porte AUSSI ce qu'on peut affirmer du nommage sans
          // savoir ou la coupe tombera (voir `ecartsCertainsEnZoneGrise`) :
          // c'est l'ecart que Glenan56 ne voyait jamais sortir. Un segment, un
          // report — les deux gestes tiennent sur la meme ligne.
          const ecartsLim = [{
            champ: 'limite communale',
            avant: pourcent(loc.partCommune) + ' dans ' + communeActive.nom +
                   (partLimite > bas ? ' · longe la limite sur ' + pourcent(partLimite) : ''),
            // La coupe se justifie la ou la superposition CESSE, pas n'importe ou.
            apres: partLimite > bas
              ? 'à couper là où la voie quitte la limite communale'
              : 'à couper sur la limite communale'
          }].concat(ecartsCertainsEnZoneGrise(nam, enAgglo, communeActive.nom));
          findings.push(Object.assign({}, base, { cas: 'LIM', doute: null, ecarts: ecartsLim }));
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

      // ⚠️⚠️ Calcule ICI, et plus bas avec les notes : la cible en a besoin.
      const voisines = communesVoisinesDuSegment(nam, communes, communeActive.code);
      const etrangeres = voisines.map(cv => cv.nom);
      // ⭐ UNE VOIE QUI LONGE LA LIMITE DESSERT LES DEUX COMMUNES : son adresse
      // « d'en face » est LEGITIME, et la cible ne doit pas la jeter.
      const longeLaLimite = voisines.length > 0 &&
                            partLeLongDeLaLimite(coords, communeActive) > 0;
      let exp = REF.etatCible(nam, enAgglo ? loc.agglo : null, communeActive.nom);
      // ⭐ Qui porte le principal ? Voir `decisionPrincipalMitoyen`.
      let mitoyenIndecis = null;
      if (longeLaLimite) {
        const decision = decisionPrincipalMitoyen(
          voisines.map(cv => zonageChezLaVoisine(coords, cv.code)));
        if (decision === 'inconnu') mitoyenIndecis = etrangeres.join(' », « ');
        exp = conserverAdressesVoisines(nam, exp, etrangeres);
      }
      let ecartsNom = c.nommageZone ? diffNaming(nam, exp) : [];
      // ⚠️⚠️ « Tant qu'on sait pas, on fait comme si on savait pas » (l'auteur,
      // 27/07). Le zonage de la voisine n'a jamais ete trace : on ne peut donc
      // pas savoir si c'est ELLE qui doit porter le principal. On retire l'ecart
      // plutot que de proposer d'effacer une adresse peut-etre juste — les
      // ALTERNATIFS, eux, restent proposes : ceux-la sont surs.
      if (mitoyenIndecis) ecartsNom = ecartsNom.filter(e => e.champ !== 'principal');
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
      // ⚠️⚠️ ADRESSE A UNE COMMUNE VOISINE (auteur, 27/07, Saint-Geniès : « Montfaucon »
      // sur 7 segments). Le segment est DANS le contour d'ici, mais ses noms
      // annoncent la commune d'a cote. Ce n'est PAS un polygone manquant — c'est
      // une adresse fausse, et la cible la corrige deja (hors agglo le cartouche
      // porte `nomCommune`, en agglo le principal aussi). On le DIT sur le report :
      // sans ca, ces segments se perdaient dans « Hors agglomération » pendant
      // qu'un bandeau reclamait de tracer le polygone de la commune voisine.
      // ⚡ La note entre dans la cle de regroupement : ces segments forment donc
      // leurs PROPRES reports, reperables, au lieu d'etre fondus avec les autres.
      if (etrangeres.length) {
        // ⚠️⚠️ DEUX SITUATIONS OPPOSEES, ET LE MEME SYMPTOME. Un segment au
        // MILIEU de la commune qui annonce la voisine est une adresse fausse
        // (auteur, 27/07). Mais une voie qui LONGE la limite dessert les deux
        // communes : son adresse d'en face est juste, et le dire « alors que ce
        // segment est dans X » etait un contresens — signale par l'auteur sur la
        // Rue de la Republique (Montfaucon / Saint-Geniès), 7 segments.
        notes.push(mitoyenIndecis
          ? 'longe la limite avec « ' + mitoyenIndecis + '  » : si cette voie est en ' +
            'agglomération de ce côté-là, c\'est cette commune qui doit porter le nom ' +
            'principal. Le script ne connaît pas son zonage — trace son agglomération ' +
            'pour qu\'il puisse conclure. En attendant, il ne touche pas au principal.'
          : longeLaLimite
          ? 'longe la limite avec « ' + etrangeres.join(' », « ') + ' » : cette voie ' +
            'dessert les deux communes, son adresse est conservée en alternatif'
          : 'adressé à « ' + etrangeres.join(' », « ') + ' » — ' +
            (etrangeres.length > 1 ? 'communes voisines' : 'commune voisine') +
            ', alors que ce segment est dans ' + communeActive.nom);
      }
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
                       poiAgglo: 0, hnErreur: null, calquesActives: [], hnVus: new Set(), poiVus: new Set(),
                       // v2.19 — le detail des RPP en agglomeration : combien
                       // sont tranches comme injustifies, combien sont au
                       // contraire PROUVES a leur place par leur point d'acces
                       // (ceux-la ne sont plus signales : il faut le DIRE), et
                       // combien portent une photo.
                       poiAggloEcart: 0, poiAggloConforme: 0, poiAggloPhoto: 0,
                       // v2.26 — la MESURE demandee par Glenan56 : numeros en
                       // agglomeration dont le segment porte un numero de route
                       // en principal, et parmi eux ceux qui gardent malgre tout
                       // un nom de rue en alternatif. Un compteur qui n'apparait
                       // nulle part ne mesure rien : les deux sont dits au bilan.
                       hnSurRoute: 0, hnSurRouteAvecAlt: 0, hnRouteVus: new Set() };
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
        // ⚠️⚠️ LES SEGMENTS SONT INDISPENSABLES ICI DEPUIS LA v2.19 : la phase POI
        // ne se contentait plus de regarder les POI, elle mesure QUELLE VOIE ils
        // longent et quels numeros sont deja poses. Cet appel passait `[]` — les
        // POI n'ayant pas besoin des segments jusque-la — et le verdict serait
        // retombe sur « a trancher » pour TOUT LE MONDE, sans que rien ne le
        // signale. Aucun test unitaire ne pouvait le voir : la faute etait dans
        // le raccordement, pas dans les fonctions.
        await analyserAdresses(donneesApi.segments, listeAgglos, statsAdr,
                               { hn: false, poi: true }, donneesApi.venues, prog);
      } catch (e) { if (e && e.annulation) throw e; log('analyse des POI impossible', e); }
      // --- Les VRAIS POI (pas les RPP) : audit de leur adresse (v2.15) -------
      // ⚠️ Ne marche QU'EN VOIE RAPIDE : le point d'acces (`entryExitPoints`) et
      // les categories viennent de l'API. Le balayage par la carte ne les livre
      // pas, et on le DIT plutot que de rendre un onglet vide sans explication.
      if (c.poiAdresse || c.poiVilleCommune || c.poiNumero) {
        try {
          prog.etape('Audit des POI', 0);
          await prog.respirer(true);
          // ⚠️ Les segments ET les numeros deja lus sont passes : c'est avec eux
          // que se calcule la proposition d'adresse (v2.19). Sans segments, la
          // proposition serait toujours vide — et rien ne le dirait.
          poiFindings = auditerPoi(donneesApi.venues, donneesApi.rues, donneesApi.villes,
                                   communeActive, statsPoi,
                                   donneesApi.segments, statsAdr.numeros || []);
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
  /**
   * Le cartouche a REPRENDRE pour un nom alternatif qu'on vient de poser.
   *
   * ⚠️⚠️ Signale par Glenan56 (27/07) : « en validant la correction, il met bien
   * le Dxxx en alt mais oublie le cartouche ». La cause est en aval —
   * `resoudreStreet` CREE une Street quand le couple (numero, ville) n'existe
   * pas encore, et une Street neuve n'a pas d'ecusson. Le numero atterrissait
   * donc en alternatif tout nu, pendant que le principal du meme segment
   * portait le sien.
   *
   * ⭐ ON NE L'INVENTE PAS, ON LE RECOPIE. Le `signType` est un code interne de
   * Waze : le deduire du prefixe (« D » ⇒ departementale) reviendrait a poser un
   * ecusson devine, donc potentiellement FAUX, sur une voie entiere — la Street
   * est partagee. On cherche donc, sur ces memes segments, un nom qui porte DEJA
   * ce numero AVEC son cartouche. Sans source, on ne fait rien : l'ecart
   * « cartouche » reste signale et l'editeur tranche.
   *
   * PURE : ne recoit que des nommages deja lus.
   */
  function cartoucheAReprendre(nomAlt, nams) {
    const cible = String(nomAlt || '').trim();
    if (!cible || !RE_ROUTE.test(cible)) return null;
    for (const nam of nams) {
      if (!nam || !nam.primary) continue;
      for (const e of [nam.primary].concat(nam.alts || [])) {
        if (!e || !e.name || e.name.trim() !== cible) continue;
        if (e.signText && String(e.signText).trim() && e.signType != null) {
          return { signText: e.signText, signType: e.signType };
        }
      }
    }
    return null;
  }

  /** Le cartouche deja porte par une Street, lu dans la couche interne. */
  function cartoucheDeStreet(streetId) {
    try {
      const st = hote.W.model.streets.getObjectById(streetId);
      if (!st) return null;
      const t = st.signText || (st.attributes && st.attributes.signText);
      return (t && String(t).trim()) ? { signText: t } : null;
    } catch (e) { return null; }
  }

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
    // --- POI : appliquer l'adresse PROPOSEE (v2.19) --------------------------
    // ⚠️⚠️ Seul cas ou l'onglet POI ecrit quelque chose. La doctrine de la v2.15
    // (« c'est un audit, aucune correction automatique ») tenait a ce qu'on
    // n'avait rien de sur a proposer ; depuis qu'on sait mesurer la voie la plus
    // proche, on propose — mais UNIQUEMENT quand aucune autre voie ne se la
    // dispute, et JAMAIS le numero (il peut etre celui du voisin).
    if (f.poi) {
      const p = f.propositionAdresse;
      // ⚡ « Il faut le ⚡ quand on a quelque chose de concret a proposer »
      // (l'auteur, 26/07) : un candidat releve autour du lieu suffit, meme si
      // c'est un numero de route — le clic ouvrira la liste au lieu d'ecrire.
      if (!p || !p.candidats || !p.candidats.length) return null;
      return [{ type: 'poiAdresse', venueId: f.venueId,
                rue: p.rue, ville: p.ville, segId: p.segId,
                candidats: p.candidats, direct: p.direct,
                numeroPropose: p.numeroPropose }];
    }
    // --- Adressage : convertir des numeros en POI residentiels --------------
    // Regle TOUT OU RIEN : creer le POI sans retirer le numero laisserait
    // l'adresse en double, donc pire qu'avant. Si l'un des deux ne peut pas se
    // faire, le bouton n'apparait pas et la ligne dit pourquoi.
    if (f.adresse) {
      // ⚠️⚠️ UNE MESURE NE SE CORRIGE PAS. Le report `HN-RTE` ne constate pas un
      // ecart : il compte un cas soumis a discussion. Lui donner un bouton
      // reviendrait a faire appliquer par le script une norme que personne n'a
      // encore validee — l'inverse exact de la doctrine du projet.
      if (f.mesure) return null;
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
    // --- ⚡ Redaction : appliquer le nom propose par le dictionnaire ----------
    // Demande de l'auteur (03/08) : « ce qui serait top, c'est que la
    // modification puisse etre automatique en cliquant sur l'eclair ».
    //
    // ✅ CE QUI REND CETTE ECRITURE SURE, ET IL FALLAIT LE VERIFIER : l'op
    // `principal` passe par `updateAddress({ streetName, cityName })`, qui ecrit
    // sur LE SEGMENT. Elle ne renomme PAS l'objet Street, qui est PARTAGE : les
    // autres segments de la voie ne bougent pas. (C'est la difference avec le
    // cartouche, qui lui se pose sur la Street — voir `cartoucheAReprendre`.)
    //
    // ⚠️⚠️ TROIS REFUS DELIBERES :
    //  1. LE PRINCIPAL SEULEMENT. Sur un alternatif, le SDK ne sait pas RETIRER
    //     l'ancien (pas de `removeAlternateStreet`, voir [[wme-sdk-pieges]]) :
    //     on ajouterait le nom corrige A COTE du fautif, laissant un doublon —
    //     pire qu'avant. L'ecart (alt) reste signale, sans bouton.
    //  2. RIEN SI LE LOGIGRAMME A DEJA UNE OPINION SUR LE PRINCIPAL. Il vise
    //     peut-etre un tout autre nom (« D62 » hors agglomeration) : y coller le
    //     nom redresse ecraserait sa decision par une correction de forme. La
    //     redaction restera a faire a la main, et `resteAlaMain` le dira.
    //  3. JAMAIS DE `sansProposition` — c'est le cas des CAPITALES, ou le
    //     dictionnaire produit « RUE DES ÉcolES ». Il n'y a pas de nom a ecrire.
    //
    // ⚠️ La VILLE est reprise telle quelle (`f.villeActuelle`) : `updateAddress`
    // ecrit les deux champs d'un coup, et omettre la ville l'EFFACERAIT. Une
    // correction de redaction ne doit toucher qu'au nom.
    const red = cur.find(e => e.champ === 'rédaction (dictionnaire FR)');
    if (red && red.apres && !red.sansProposition &&
        !ops.some(o => o.type === 'principal')) {
      ops.push({ type: 'principal', nom: red.apres, ville: f.villeActuelle || '' });
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
    // Points d'entree effectivement repris du numero sur le POI (v2.19) : le
    // dire permet de verifier que ca a marche, au lieu de l'esperer.
    let reprises = 0;
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
      // ── 2 bis. Point d'entree : on reprend celui du numero ────────────────
      //
      // ⚠️ Demande de l'auteur (26/07) : « si le HN possede un point d'entree,
      // que le RPP nouvellement cree possede le meme ». Un numero de rue porte
      // un `fractionPoint` — le bout de la fleche, pose sur la chaussee — qui
      // dit PAR OU l'on entre. Le POI cree a sa place le perdrait, et Waze
      // guiderait alors vers la voie la plus proche de son centre, qui n'est pas
      // toujours celle de l'adresse. `Venues.replaceNavigationPoints` existe
      // pour ca (releve le 26/07 : `{venueId, navigationPoints:[{point, entry,
      // exit}]}`).
      // ⚠️ ON LE REPREND MEME QUAND IL N'EST PAS « FORCE » (mesure du 26/07 :
      // 0 numero force sur les 73 lus a Coursan — un point calcule reste le seul
      // qui designe la bonne voie ; ne rien poser serait pire).
      // ⚠️ ECHEC NON BLOQUANT : le POI est valide sans point d'entree, et on ne
      // va pas renoncer a la conversion pour ca. Mais on le DIT, sinon
      // l'editeur croirait le point repris.
      const fp = hn.fractionPoint && hn.fractionPoint.coordinates;
      if (fp) {
        try {
          DM.Venues.replaceNavigationPoints({ venueId, navigationPoints: [
            { point: { type: 'Point', coordinates: fp }, entry: true, exit: true }
          ] });
          reprises++;
        } catch (e) {
          echecs.push(hn.number + ' : point d\'entrée non repris (' + (e.message || e) +
            ') — à poser à la main sur le POI');
        }
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
    return { faits, reprises, echecs, critiques, laisses, villes: [...villesUtilisees] };
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
    return choisirUnNom({
      titre: 'Plusieurs noms possibles',
      intro: 'Ce segment porte <b>' + op.candidats.length + '</b> noms. Lequel doit devenir le ' +
             '<b>nom principal</b> ?',
      libelle: f.libelle,
      note: f.nb > 1
        ? 'Le choix s\'applique aux <b>' + f.nb + '</b> segments de ce report.'
        : 'Les autres noms restent en alternatif.',
      candidats: op.candidats,
      villeParDefaut: op.ville
    });
  }

  /**
   * Quelle adresse donner a un POI qui n'en a pas (v2.19).
   *
   * ⚠️⚠️ Le cas qui a impose cette boite (le camp militaire, signale par
   * l'auteur le 26/07) : la voie a 15 m porte « D121 » en principal et « Route
   * de Laudun » en alternatif. Le bon choix est evident pour un humain, pas
   * pour un automate — donc on PROPOSE, en mettant le nom de rue en tete et le
   * numero de route en second, et c'est l'editeur qui tranche.
   */
  function demanderAdressePoi(f, op) {
    const cands = op.candidats || [];
    const routes = cands.filter(c => c.estRoute).length;
    return choisirUnNom({
      titre: 'Quelle adresse pour ce POI ?',
      intro: cands.length > 1
        ? 'Voici les noms relevés autour du lieu, du plus probable au moins probable.' +
          (routes ? ' Les numéros de route sont en dernier : ce ne sont pas des adresses postales.' : '')
        : 'Un seul nom a été relevé autour du lieu.',
      libelle: f.libelle,
      note: 'La commune appliquée sera <b>' + esc(op.ville) + '</b> (contour INSEE)' +
            (op.numeroPropose
              ? ', et le n° ' + esc(op.numeroPropose) + ' reste à saisir à la main après vérification.'
              : '.'),
      // La distance est DITE sur chaque bouton : c'est elle qui a servi a
      // classer, l'editeur doit pouvoir refaire le raisonnement.
      candidats: cands.map(c => ({ nom: c.nom, ville: op.ville, segId: c.segId,
        suffixe: Math.round(c.d) + ' m' + (c.estRoute ? ' · numéro de route' : '') })),
      villeParDefaut: op.ville
    });
  }

  /**
   * Boite de choix d'un nom : des propositions (la premiere mise en avant) et
   * une saisie libre. Rend l'option choisie, `{nom, ville}` saisi, ou null.
   *
   * ⚠️ MUTUALISEE (v2.19) entre le choix du nom PRINCIPAL d'un segment et celui
   * de l'adresse d'un POI. Deux boites identiques a la virgule pres auraient
   * fini par diverger sur un detail qui ne se voit pas — le clavier qui repart
   * dans les raccourcis de WME, le bornage a l'ecran, le glissement. C'est
   * exactement la faute des giratoires de la v2.11.
   */
  function choisirUnNom(o) {
    return new Promise(resolve => {
      const cands = o.candidats;
      const boite = el(`
        <div id="agn-modale">
          <div class="agn-modale-in">
            <div class="agn-modale-t">${esc(o.titre)}</div>
            <div class="agn-modale-c">
              ${o.intro}
              <div class="agn-modale-geo">
                <div class="agn-d"><b>${esc(o.libelle)}</b></div>
                <div class="agn-d" style="opacity:.8">${o.note}</div>
              </div>
            </div>
            ${cands.map((c, i) => `<button class="agn-btn${i === 0 ? ' primary' : ''}" data-i="${i}">${
              esc(c.nom)}${c.ville ? ' / ' + esc(c.ville) : ''}${
              c.suffixe ? ' <span style="opacity:.7">— ' + esc(c.suffixe) + '</span>' : ''}</button>`).join('')}
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
        resolve({ nom, ville: o.villeParDefaut });
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
    // --- POI : ecrire l'adresse proposee (v2.19) -----------------------------
    if (f.poi) {
      const op = plan[0];
      // ⚠️ Le POI et son segment doivent etre dans le modele : les objets lus
      // par l'API n'y sont pas (cf. [[wme-sdk-pieges]]). On cadre donc d'abord,
      // exactement comme pour les numeros, puis on laisse WME charger.
      cadrerSur(f, true);
      await new Promise(r => setTimeout(r, 900));
      // ⚠️⚠️ ON DEMANDE DES QU'IL Y A UN CHOIX (l'auteur, 26/07). Le clic sur ⚡
      // n'applique tout seul QUE le cas ou un unique nom de rue se detache ;
      // partout ailleurs il ouvre la liste, le plus probable en tete. La
      // question se pose AVANT toute ecriture — jamais au milieu.
      if (!op.direct) {
        const choix = await demanderAdressePoi(f, op);
        if (!choix) return { ok: false, motif: 'choix de l\'adresse annulé' };
        op.rue = choix.nom;
        if (choix.ville) op.ville = choix.ville;
        // Le contexte administratif se lit sur le segment du nom RETENU.
        if (choix.segId != null) op.segId = choix.segId;
      }
      let ctx = {};
      try { ctx = contexteAdresse(op.segId); }
      catch (e) {
        return { ok: false, motif: 'la voie « ' + op.rue + ' » n\'est pas chargée dans WME : ' +
          'l\'État et le pays de l\'adresse ne peuvent pas être lus — réessaie, la carte vient d\'être cadrée' };
      }
      // ⚠️⚠️ `updateAddress` REFUSE une adresse brute sans `stateId` (erreur
      // documentee en v2.09) : si le contexte est vide, on s'arrete AVANT
      // d'ecrire, plutot que d'echouer a moitie.
      if (!ctx || ctx.stateId == null) {
        return { ok: false, motif: 'contexte administratif introuvable (État/pays) : ' +
          'zoome sur la zone puis réessaie' };
      }
      try {
        sdk.DataModel.Venues.updateAddress({ venueId: String(op.venueId),
          addressData: Object.assign({ streetName: op.rue, cityName: op.ville }, ctx) });
      } catch (e) {
        return { ok: false, motif: 'adresse refusée par WME (' + (e.message || e) + ')' };
      }
      return { ok: true, nb: 1, ops: 1, bloques: 0,
               // Le numero n'est jamais ecrit : on le RAPPELLE, sinon l'editeur
               // croira l'adresse complete.
               partiel: !!(f.propositionAdresse && f.propositionAdresse.numeroPropose),
               avertissement: (f.propositionAdresse && f.propositionAdresse.numeroPropose)
                 ? 'le n° ' + f.propositionAdresse.numeroPropose + ' est une piste, pas une certitude : ' +
                   'saisis-le à la main après vérification'
                 : '' };
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
                 reprises: r.reprises,
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
          // Le cartouche ne suit pas tout seul : voir `cartoucheAReprendre`.
          // On ne touche a rien si la rue en porte deja un — elle est PARTAGEE,
          // et l'ecraser deborderait sur tous les segments qui l'utilisent.
          if (!cartoucheDeStreet(rue.id)) {
            const src = cartoucheAReprendre(op.nom, ids.map(id => {
              try { return readNaming({ id: id }); } catch (e) { return null; }
            }));
            if (src) ecrireCartouche(rue.id, src.signText, src.signType);
          }
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
  /* ⚠️⚠️ SANS CETTE REGLE, LE BOUTON BLEU DEVENAIT ILLISIBLE AU SURVOL (signale
     par l'auteur, 27/07) : la regle de survol compte TROIS selecteurs
     (classe + hover + not) contre DEUX pour le bouton bleu (classe + classe) —
     elle l'emporte donc, et posait un fond gris clair sous un texte reste
     BLANC. Le bouton bleu s'assombrit desormais au lieu de perdre sa couleur.
     ⚠️ PAS DE BACKTICK DANS CE BLOC : le CSS est un template literal. */
  .agn-btn.primary:hover:not(:disabled){background:var(--agn-bleu-fonce, #1565c0);
    border-color:var(--agn-bleu-fonce, #1565c0);color:#fff}
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
  /* Selection rapide par zone declaree (v2.27.05) */
  #agn-zone-sel{margin:6px 0 2px}
  .agn-zone-btns{display:flex;gap:6px}
  .agn-zone-btns .agn-btn{flex:1;margin:0}
  .agn-zone-info{font-size:11px;color:var(--agn-gris, #546e7a);margin-top:4px;line-height:1.35}
  .agn-zone-info b{color:var(--agn-bleu-fonce, #1565c0)}
  /* « Il en manque probablement » : un CONSTAT qui doit se voir, pas se lire
     entre les lignes — c'est ce qui evite de croire qu'on a fait le tour. */
  .agn-zone-manque{color:var(--agn-orange, #e65100);font-weight:600}
  .agn-traites{color:var(--agn-vert, #2e7d32);font-weight:600}
  /* Selection partielle : orange, parce qu'il y a un geste a faire (dezoomer). */
  .agn-selinfo{color:var(--agn-orange, #e65100);font-weight:600;cursor:help}
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
  /* ── Aide : accordeon de sections, sur le modele de WCT ────────────────── */
  .agn-aide-s{border:1px solid #e0e0e0;border-radius:4px;margin:5px 0;overflow:hidden}
  .agn-aide-h{display:flex;align-items:center;gap:6px;padding:6px 8px;cursor:pointer;user-select:none;
    background:var(--agn-fond-survol, #f5f7f9);font-size:12px;font-weight:600}
  .agn-aide-h:hover{background:var(--agn-fond-doux, #eceff1)}
  .agn-aide-h.on{color:var(--agn-bleu-fonce, #1565c0);background:#e3f2fd}
  .agn-aide-h .agn-chev{color:var(--agn-gris-clair, #78909c);width:9px;flex:0 0 auto}
  .agn-aide-c{padding:8px 10px;font-size:12px;line-height:1.5;color:var(--agn-texte, #1f2933)}
  .agn-aide-c p{margin:0 0 6px}
  .agn-aide-c ol,.agn-aide-c ul{margin:0 0 6px;padding-left:18px}
  .agn-aide-c li{margin-bottom:4px}
  .agn-aide-c b{font-weight:600}
  .agn-aide-t{width:100%;border-collapse:collapse;margin:2px 0 6px}
  .agn-aide-t td{padding:3px 5px;vertical-align:top;border-bottom:1px solid #eceff1}
  .agn-aide-t td:first-child{width:132px;color:var(--agn-gris, #546e7a);white-space:normal}
  .agn-aide-note{background:#fff8e1;border-left:3px solid var(--agn-orange, #e65100);
    padding:5px 8px;margin:6px 0;border-radius:0 3px 3px 0}
  .agn-aide-pied{margin-top:10px;padding-top:8px;border-top:1px solid #e0e0e0;
    font-size:11px;color:var(--agn-gris, #546e7a);text-align:center}
  .agn-aide-pied a{color:var(--agn-bleu, #1e88e5)}
  .agn-aide-c a{color:var(--agn-bleu, #1e88e5);text-decoration:underline}
  .agn-aide-src{background:#e3f2fd;border-left:3px solid var(--agn-bleu, #1e88e5);
    padding:6px 8px;margin:2px 0 8px;border-radius:0 3px 3px 0}
  .agn-aide-ex{font-family:monospace;background:#f5f5f5;padding:0 3px;border-radius:2px}
  /* ── Guidage pas a pas : mettre en avant LE geste suivant ───────────────── */
  /* ⚠️ Le halo doit se REMARQUER : un liseré fin passait inaperçu au milieu de
     boutons deja bordes (l'auteur est revenu deux fois dessus). Trait epais,
     fond teinte, et une pulsation plus large. */
  /* ⚠️⚠️ LE HALO NE TOUCHE PAS AU FOND — trait et pulsation seulement.
     Une couleur de fond imposee ici repeignait le bouton bleu « Analyser la
     commune » en bleu tres clair SANS toucher a son texte, reste blanc : bouton
     illisible (auteur, 27/07). C'est la MEME faute que le survol corrige la
     veille — et je l'ai refaite en voulant rendre le halo plus visible.
     ⚠️ PAS DE BACKTICK DANS CE BLOC : le CSS est un template literal.
     ⇒ Regle : ne jamais forcer une couleur de FOND sur un element dont on ne
     maitrise pas la couleur de TEXTE. */
  .agn-guide{position:relative;z-index:1;animation:agn-pulse 1.6s ease-in-out infinite;
    border-radius:5px;outline:3px solid var(--agn-bleu, #1e88e5);outline-offset:2px}
  @keyframes agn-pulse{
    0%,100%{box-shadow:0 0 0 0 rgba(30,136,229,.65)}
    50%{box-shadow:0 0 0 9px rgba(30,136,229,0)}
  }
  /* Le fond teinte est reserve aux boutons PALES, dont le texte est sombre :
     il les fait ressortir sans jamais toucher a un bouton deja colore. */
  .agn-btn.agn-guide:not(.primary){background-color:#e3f2fd}
  .agn-sb-b.agn-guide{background-color:#e3f2fd}
  /* Le bandeau qui DIT quoi faire : le halo seul ne dit pas pourquoi. */
  #agn-guide{display:none;margin:0 0 6px;padding:7px 9px;border-radius:4px;
    background:#e3f2fd;border-left:3px solid var(--agn-bleu, #1e88e5);font-size:12px;line-height:1.45}
  #agn-guide.on{display:block}
  #agn-guide b{color:var(--agn-bleu-fonce, #1565c0)}
  .agn-guide-n{display:inline-block;min-width:17px;height:17px;line-height:17px;text-align:center;
    border-radius:50%;background:var(--agn-bleu, #1e88e5);color:#fff;font-size:11px;font-weight:700;
    margin-right:5px}
  .agn-guide-suite{margin-top:4px;font-size:11px;opacity:.85}
  /* ⚠️ Une animation qui ne s'arrete jamais fatigue : le guidage disparait des
     que l'etape est franchie, et se coupe entierement par une case a cocher. */
  /* L'onglet Aide ne compte pas de reports : pas de pastille, et il reste
     accessible meme quand l'analyse est fermee (territoire indetermine…). */
  #agn-aide-btn{flex:0 0 auto;padding:7px 9px;border:none;border-bottom:2px solid transparent;
    background:none;cursor:pointer;font-size:12px;color:var(--agn-gris, #546e7a)}
  #agn-aide-btn:hover{background:#e3eaf0}
  #agn-aide-btn.agn-tab-on{background:#fff;color:var(--agn-bleu-fonce, #1565c0);
    border-bottom-color:var(--agn-bleu, #1e88e5)}
  /* Thematique entierement traitee : elle se replie et s'efface, sans
     disparaitre — on doit pouvoir la rouvrir. */
  .agn-grp.agn-fini .agn-grp-t{opacity:.55}
  .agn-grp.agn-fini .agn-grp-n{background:var(--agn-vert, #2e7d32)}
  .agn-grp-c{padding:4px 6px 6px}
  .agn-lien{border:none;background:none;color:var(--agn-bleu, #1e88e5);cursor:pointer;font-size:11px;
    text-decoration:underline;padding:2px;margin-left:auto}
  .agn-empty{opacity:.6;font-style:italic;padding:8px 0;font-size:11px}
  /* ⚠️⚠️ EN FLEX, CHAQUE MORCEAU DE TEXTE DEVIENT UNE CELLULE. Le libelle
     contient un <b> : sans le <span> qui enveloppe la phrase, elle se decoupait
     en quatre colonnes cote a cote — « organise en cellules, illisible »
     (auteur, 27/07). La regle vaut pour TOUT label en flex qui melange du texte
     et des balises. */
  .agn-sansagglo{display:flex;align-items:flex-start;gap:6px;margin-top:6px;
    font-style:normal;opacity:1;cursor:pointer;color:var(--agn-brun, #a34a00)}
  .agn-sansagglo span{flex:1;min-width:0}
  .agn-sansagglo input{flex:0 0 auto;margin-top:2px}
  /* Secteurs d'entrees : la ou aucun contour ne se deduit, on donne au moins
     l'ordre de marche — un bouton par secteur, qui cadre la carte dessus. */
  .agn-secteurs{margin-top:8px}
  .agn-secteurs-t{font-size:11px;color:var(--agn-gris, #546e7a);margin-bottom:4px;font-style:normal}
  .agn-secteur{display:block;width:100%;text-align:left;margin:3px 0;padding:5px 8px;
    border:1px solid #cfd8dc;border-radius:4px;background:#fff;cursor:pointer;
    font-size:11px;font-style:normal;color:var(--agn-texte, #1f2933)}
  .agn-secteur:hover{background:#e3f2fd;border-color:var(--agn-bleu, #1e88e5)}
  .agn-secteur-p{background:var(--agn-bleu, #1e88e5);color:#fff;border-radius:8px;
    padding:1px 6px;font-size:10px;margin-left:4px}
  /* Rappel pendant le trace : l'interface est repliee, c'est le SEUL repere a
     l'ecran. En haut, centre, au-dessus de la carte et sous les modales. */
  #agn-trace-aide{position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:9500;
    background:rgba(21,101,192,.95);color:#fff;padding:8px 14px;border-radius:6px;
    font:13px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    box-shadow:0 4px 16px rgba(0,0,0,.35);pointer-events:none;max-width:90vw;text-align:center}
  #agn-trace-aide span{opacity:.85;font-size:12px}
  /* Ce qu'il reste a couvrir : une agglomeration oubliee fausse toute l'analyse,
     l'avertissement se lit donc AVANT le bouton « Terminer ». */
  .agn-avert-exh{margin-top:8px;padding:7px 9px;border-radius:4px;font-size:11px;line-height:1.45;
    background:#fff3e0;border-left:3px solid var(--agn-orange, #e65100);color:var(--agn-texte, #1f2933)}
  .agn-avert-doux{background:#f1f8e9;border-left-color:var(--agn-vert, #2e7d32)}
  #agn-tracer-encore{margin-top:8px}
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
  /* L'explication du refus 406 : fond clair pour se detacher du message brut de
     WME juste au-dessus, sans quitter le bandeau rouge. ⚠️ On force le FOND et
     la COULEUR ensemble — poser l'un sans l'autre a rendu deux boutons
     illisibles en deux jours (v2.20.01 et v2.24.03). */
  #agn-err-save .agn-err-expl{background:#fff6f5;border-radius:4px;padding:6px 8px;
    margin:6px 0;font-weight:400;line-height:1.45;color:#8a1c14}
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
  /* ⚠️ Un CONSTAT n'est pas une ALERTE. L'orange reclame un geste ; ce bloc-ci
     dit « rien a tracer, c'est deja dans ta liste » et prend donc le bleu neutre
     de l'information (auteur, 27/07 : l'alerte orange « embrouille plus
     qu'autre chose » quand elle parle d'une commune voisine). */
  .agn-info-bloc{background:#e3f2fd;border-color:#90caf9;color:#0d3c61}
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
      // ⚠️ `defaut` peut etre une FONCTION quand l'etat de depart depend de
      // l'environnement — le dictionnaire de redaction se tait si WME Check
      // Road Name est deja la. Elle n'est evaluee qu'ICI, au tout premier
      // demarrage : ensuite c'est le choix de l'editeur qui fait foi, et une
      // installation ou desinstallation de CRN ne le bousculera pas.
      if (options.controles[ct.cle] === undefined) {
        const d = (typeof ct.defaut === 'function') ? ct.defaut() : ct.defaut;
        options.controles[ct.cle] = d !== undefined ? d : true;
      }
    });

    const o = el(`
      <div id="agn-overlay">
        <div id="agn-main">
        <div id="agn-tete">
          <b>🏷️ Naming Auditor</b><span class="agn-v">v${VERSION}</span><span class="agn-sp"></span>
          <button id="agn-reduire" title="Réduire">–</button>
          <button id="agn-fermer" title="Fermer">✕</button>
        </div>
        <div id="agn-onglets">
          <button id="agn-donnees" title="Contours, commune, agglomération">☰</button>
          <button class="agn-tab" data-vue="segments" title="Les écarts de nommage des segments (agglomération, cartouches, rédaction)">Segments <span class="agn-tab-n"></span></button>
          <button class="agn-tab" data-vue="adresses" title="Les écarts de numérotation : numéros de rue et POI résidentiels">Numérotation <span class="agn-tab-n"></span></button>
          <button class="agn-tab" data-vue="poi" title="Les écarts d'adresse sur les vrais POI (hors POI résidentiels)">POI <span class="agn-tab-n"></span></button>
          <button id="agn-aide-btn" title="Mode d'emploi : à quoi sert chaque bouton, ce que chaque contrôle vérifie, et les limites connues">❓</button>
        </div>
        <div id="agn-corps">
          <!-- Garde-fou territorial (v2.03) : en tete du corps, AVANT le bouton
               d'analyse — c'est la raison pour laquelle il est grise. -->
          <div id="agn-pays"></div>
          <!-- Guidage pas a pas : ce qu'il faut faire MAINTENANT. Se vide tout
               seul quand il n'y a plus rien a guider. -->
          <div id="agn-guide"></div>
          <button class="agn-btn primary" id="agn-scan" disabled title="Analyse le nommage et l'adressage de toute la commune choisie. Rien n'est enregistré : tu reliras chaque correction dans WME.">Analyser la commune</button>
          <!-- Selection rapide (idee de Glenan56) : NE PASSE PAS par l'analyse.
               C'est une loupe sur ce qui est a l'ecran, pour comparer d'un coup
               d'oeil ce que les segments DECLARENT et ou ils sont vraiment. -->
          <div id="agn-zone-sel">
            <div class="agn-zone-btns">
              <button class="agn-btn" id="agn-sel-ville" disabled
                title="${esc(TITRE_SEL.ville)}">🏘 En ville</button>
              <button class="agn-btn" id="agn-sel-hors" disabled
                title="${esc(TITRE_SEL.horsVille)}">🌾 Hors ville</button>
            </div>
            <div id="agn-zone-info" class="agn-zone-info"></div>
          </div>
          <!-- Conteneur PROPRE a la progression : agn-stats est reecrit par
               renderResults(), une barre qui y vivrait serait effacee. -->
          <div id="agn-prog"></div>
          <div id="agn-stats"></div>
          <div id="agn-fix"></div>
          <div id="agn-results"></div>
          <!-- L'aide occupe le corps entier quand elle est ouverte : le reste
               est masque puis RESTAURE dans son etat d'avant (voir
               basculerAide) — plusieurs de ces blocs ont leur propre logique
               d'affichage, les remettre a « visible » d'office les ferait
               apparaitre a tort.
               ⚠️ PAS DE BACKTICK ICI : ce HTML est un template literal (piege
               vecu 5 fois dans ce projet, dont a l'instant). -->
          <div id="agn-aide" style="display:none"></div>
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
            <div class="agn-sect-t"><span class="agn-chev">▾</span><b>1. Commune à traiter</b>
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
            <div class="agn-sect-t"><span class="agn-chev">▾</span><b>2. Agglomération</b>
              <span class="agn-sect-r"></span></div>
            <div class="agn-sect-c">
              <!-- ⚠️ ORDRE = PROGRESSION (auteur, 27/07) : on relève les
                   panneaux, on en tire un tracé, et le tracé manuel ferme la
                   marche — c'est le recours quand les deux premiers ne donnent
                   rien. -->
              <div class="agn-sb-n" id="agn-voies">Relève les panneaux, tires-en un tracé,
                ou dessine à la main.</div>
              <button class="agn-btn" id="agn-panneaux" disabled title="Récupère les panneaux EB10 / EB20 (entrée et sortie d'agglomération) et les confronte aux polygones traces.">🪧 Panneaux d'agglomération</button>
              <button class="agn-btn" id="agn-pretrace" disabled title="Fabrique un polygone par groupe d'entrées d'agglomération. Tracé grossier, à ajuster aux poignées.">✏️ Proposer un tracé</button>
              <button class="agn-btn" id="agn-tracer" disabled title="Dessine à la main, sur la carte, le polygone de l'agglomération (double-clic pour fermer le tracé)">＋ Tracer l'agglomération</button>
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
    ui.btnSelVille = o.querySelector('#agn-sel-ville');
    ui.btnSelHors = o.querySelector('#agn-sel-hors');
    ui.zoneInfo = o.querySelector('#agn-zone-info');
    // La selection est instantanee : elle ne lit que le modele deja charge, ne
    // touche NI au zoom NI au centre de la carte (arbitrage de l'auteur).
    const lancerSel = (btn, zone) => {
      if (!btn || btn.disabled) return;
      try { selectionnerParZone(zone); }
      catch (e) {
        log('sélection par zone impossible', e);
        if (ui.zoneInfo) ui.zoneInfo.textContent = 'Sélection impossible : ' + (e.message || e);
      }
    };
    if (ui.btnSelVille) ui.btnSelVille.onclick = () => lancerSel(ui.btnSelVille, 'ville');
    if (ui.btnSelHors) ui.btnSelHors.onclick = () => lancerSel(ui.btnSelHors, 'horsVille');
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
    // L'aide reste accessible MEME quand l'analyse est fermee (territoire
    // indetermine, aucun contour charge) : c'est justement la qu'on la cherche.
    const bAide = o.querySelector('#agn-aide-btn');
    if (bAide) bAide.onclick = () => basculerAide();
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
      // Le rappel « la carte a quitté X » a fait son office : il ne doit pas
      // survivre au choix suivant.
      if (communeActive) delete ui.communePerdue;
      // ⚠️ Un releve de panneaux appartient a UNE commune : le garder en
      // changeant de commune afficherait un bilan qui ne parle plus de rien.
      oublierPanneaux();
      redrawCommune(); redrawAgglos(); renderAgglos();
      if (communeActive) {
        replierSection('commune', false);   // choix fait
        // ⚠️ ET ON ROUVRE L'AGGLOMERATION : c'est l'etape suivante. Sans ca,
        // apres un retour force a l'etape 1 (la carte avait quitte la commune),
        // le volet restait plie sur la suite du parcours — signale par l'auteur
        // le 27/07. Replier une etape, c'est s'engager a rouvrir la suivante.
        replierSection('agglo', true);
      }
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
    // ⚠️ Une section peut avoir ete DEPLACEE ou retiree (le chargement manuel
    // des contours l'est depuis la v2.21). On ne suppose plus que ses morceaux
    // sont encore la : une reference perimee ne doit pas casser le demarrage.
    const corps = sec.querySelector('.agn-sect-c');
    const chevron = sec.querySelector('.agn-chev');
    if (!corps || !chevron) return;
    sec.classList.toggle('agn-ferme', !ouvrir);
    corps.style.display = ouvrir ? '' : 'none';
    chevron.textContent = ouvrir ? '▾' : '▸';
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
    // ⚠️⚠️ LE VOLET REVIENT AVEC LA FENETRE. Replier fermait le volet, et le
    // deployer ne le rouvrait pas : l'editeur qui reduit l'overlay « pour y voir
    // plus clair » pendant qu'il tire les poignees le retrouvait disparu, sans
    // rien pour le rappeler (auteur, 27/07). On memorise donc son etat, et une
    // EDITION EN COURS le rouvre dans tous les cas — c'est precisement la qu'on
    // en a besoin.
    if (veut) {
      ui.voletAvantRepli = !!(ui.volet && ui.volet.classList.contains('agn-volet-ouvert'));
      basculerVolet(false);
    } else {
      placerVolet();
      if (ui.voletAvantRepli || edition) basculerVolet(true);
    }
    if (!veut) saveUI();
    // Replier ou deplier change ce qu'on cache de la popover d'erreur de WME
    // (repliee, la fenetre n'est plus qu'un en-tete) : on redecide.
    releverErreurSave();
  }

  function basculerVolet(force) {
    const ouvrir = force !== undefined ? force : !ui.volet.classList.contains('agn-volet-ouvert');
    ui.volet.classList.toggle('agn-volet-ouvert', ouvrir);
    ui.btnDonnees.classList.toggle('agn-on', ouvrir);
    if (ouvrir) { placerVolet(); majResumeSections(); }
    // Le volet s'ouvre ou se ferme : la cible du guidage change (l'element
    // lui-meme, ou le bouton ☰ qui y mene).
    majGuidage();
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
  // ===========================================================================
  // AIDE — le mode d'emploi, dans la fenetre
  //
  // Demande de l'auteur (26/07, confirmee le 27/07 : « on va d'abord se faire une
  // aide digne de ce nom, inspire-toi de WCT pour la facon »). Meme forme que
  // [[wct-closures-toolkit]] : un onglet a part, des sections repliables, la
  // premiere ouverte, et des tableaux « terme → ce que ca fait ».
  //
  // ⚠️⚠️ UNE AIDE FAUSSE EST PIRE QUE PAS D'AIDE : les libelles cites ici sont
  // ceux de l'interface, au caractere pres. Si un bouton est renomme, cette
  // section doit suivre — sinon l'editeur cherche un bouton qui n'existe plus.
  // ⚠️ Le premier retour utilisateur (Glenan56, rang 6, 27/07) tracait ses
  // polygones a la main sur une commune a hameaux multiples, sans avoir vu le
  // pre-trace par panneaux : le probleme n'etait pas la fonction, c'etait sa
  // DECOUVRABILITE. D'ou l'ordre des sections — ce qu'on cherche en premier
  // vient en premier.
  // ===========================================================================

  let aideOuverte = false;

  // ===========================================================================
  // GUIDAGE PAS A PAS — montrer LE geste suivant
  //
  // Demande de l'auteur (27/07) : « un novice peut être perdu […] tant que
  // l'action n'est pas faite, il faudrait que la liste déroulante soit mise en
  // avant […] et dès que choisi, on l'amène sur l'action suivante ».
  //
  // ⚠️ Trois regles, apprises du premier retour utilisateur :
  //  1. le halo seul ne suffit pas — il montre OU cliquer, pas POURQUOI : un
  //     bandeau dit l'action en une phrase ;
  //  2. l'etape franchie eteint son guidage IMMEDIATEMENT, sinon l'animation
  //     devient un bruit de fond qu'on n'ecoute plus ;
  //  3. quand le geste attendu est dans le volet et que le volet est FERME,
  //     c'est le bouton ☰ qu'on met en avant : guider vers un element invisible
  //     ne guide personne.
  // ===========================================================================

  /**
   * Sort le chargement MANUEL des contours du parcours principal et le range
   * dans les reglages (panneau lateral WME).
   *
   * ⚠️ Constat de l'auteur (27/07) : « ce premier bloc est presque toujours
   * inutile puisque le script charge ce dont il a besoin automatiquement ».
   * C'est exact — `autoChargerDepartement` telecharge le departement de la vue
   * des que la carte bouge, option cochee par defaut. Le selecteur de
   * departements, le fichier GeoJSON et la source alternative ne servent qu'en
   * SECOURS : ils encombraient l'etape 1 d'un parcours ou il n'y a, justement,
   * rien a faire.
   *
   * ⚠️ On DEPLACE le noeud, on ne le reconstruit pas : tous les gestionnaires
   * poses par `buildOverlay` restent attaches. Refaire le HTML ailleurs aurait
   * demande de rebrancher chaque bouton — et d'en oublier un.
   */
  function rangerChargementContours() {
    const bloc = ui.volet && ui.volet.querySelector('.agn-sect[data-s="contours"]');
    const hote = document.getElementById('agn-contours-manuel');
    if (!bloc || !hote) return;                 // rien a faire : on n'invente pas
    const corps = bloc.querySelector('.agn-sect-c');
    if (!corps) return;
    hote.appendChild(corps);                    // le CORPS seul : plus de section repliable
    bloc.remove();                              // l'etape 1 disparait du parcours
    // ⚠️⚠️ INDISPENSABLE — la panne du 27/07, signalee par l'auteur (« je suis
    // alle sur Saint-Tropez, il ne charge rien »). `ui.sections` gardait une
    // reference vers la section supprimee ; `replierSection('contours')` y
    // cherchait `.agn-sect-c` — parti avec le deplacement — et faisait
    // `null.style`. L'exception tombait dans `rafraichirCommunesDeLaVue`, JUSTE
    // avant `renderAgglos`, ce qui interrompait `init()` : plus d'abonnement au
    // deplacement de la carte, donc plus AUCUN chargement automatique de
    // departement. Un simple deplacement de noeud, et tout le demarrage tombe.
    if (ui.sections) delete ui.sections.contours;
  }

  /**
   * Ou en est l'editeur ? Rend l'identifiant de l'etape a franchir, ou null
   * quand il n'y a plus rien a guider.
   */
  function etapeCourante() {
    if (!options.guidage) return null;
    // Le garde-fou territorial parle deja, et plus fort : on ne le double pas.
    if (pays.etat !== 'fr') return null;
    if (!communes.length) return 'contours';
    if (!communeActive) return 'commune';
    // ⚠️ Une edition ouverte passe AVANT tout : tant qu'elle n'est pas fermee,
    // le polygone n'est pas enregistre et rien d'autre n'a de sens.
    if (edition) return 'terminer';
    const zones = agglos[communeActive.code] || [];
    const declaree = !!sansAgglo[communeActive.code];
    // L'analyse a tourne : le parcours est fait, le guidage se tait. Sans ce
    // garde, la regle « les panneaux d'abord » le ferait repartir en boucle.
    if (lastScan) return null;
    // ⚠️⚠️ AVANT TOUTE AFFIRMATION SUR LE ZONAGE : la carte regarde-t-elle bien
    // la commune dont on s'apprete a parler ? Sinon le guidage decrit fidelement
    // un etat que l'editeur ne voit pas (cas vecu du 27/07, voir `guidageDecale`).
    // ⚠️ Place APRES `lastScan` a dessein : une fois l'analyse faite, l'editeur
    // navigue d'un ecart a l'autre et sort forcement de la commune — l'y ramener
    // serait du bruit, et la regle n°1 dit que le guidage se tait quand c'est fait.
    if (guidageDecale(communeActive, communeSousLeCentre())) return 'commune-decalee';
    const s = sondageCourant();
    const sourceMuette = !!(s && s.etat === 'aucun');
    // ⚠️ TANT QUE LE SONDAGE N'A PAS REPONDU, ON NE DESIGNE AUCUN BOUTON. Sans ce
    // garde, le halo se posait sur « Panneaux », puis sautait sur « Tracer » une
    // seconde plus tard quand la source repondait « aucun » — un guidage qui se
    // dedit. Et l'editeur assez rapide lancait un releve complet pour rien.
    if (!zones.length && !releveFait && !declaree && s && s.etat === 'encours') return 'agglo-sondage';
    // ⚠️⚠️ LES PANNEAUX D'ABORD — MAIS SEULEMENT QUAND RIEN N'EST TRACE (auteur,
    // 27/07, apres essai de la 2.25.00 sur une commune deja zonee : « on s'en
    // fout, y'a deja une agglo tracee »). Le releve est le point de depart du
    // TRACE : sans polygone il ouvre le parcours, avec un polygone il fait
    // refaire un geste dont l'editeur n'a plus besoin — et le bandeau « c'est le
    // point de depart du trace » devient faux sous ses yeux.
    // ⚠️ Le garde-fou d'exhaustivite de la 2.24.01 ne DISPARAIT pas, il change de
    // place : c'est le panneau de vigilance de fin de zonage
    // (`avertissementExhaustivite`) qui le porte, halo compris, au moment de
    // refermer le volet. On avertit la ou l'editeur decide, pas en le renvoyant
    // en arriere.
    // ⚠️ Et pas non plus si la source est muette sur cette commune : inutile
    // d'envoyer vers un bouton qu'on vient de griser.
    if (!zones.length && !releveFait && !sourceMuette && !declaree) return 'agglo-panneaux';
    if (!zones.length && !declaree) {
      // Le parcours de l'agglomeration, dans l'ordre ou il se deroule.
      // ⚠️ Un relevé infructueux (Lirac : 0 panneau) mene au tracé manuel, pas
      // au bouton qu'on vient de cliquer.
      if (sourceMuette || !panneaux.length) return 'agglo-tracer';
      if (bilanPreTrace && !bilanPreTrace.tracables) return 'agglo-tracer';
      return 'agglo-proposer';
    }
    // Des polygones existent : ceux qui viennent du pre-trace sont GROSSIERS et
    // demandent un passage aux poignees — on le dit une fois, pas a chaque fois.
    if (zones.some(z => z.aAffiner)) return 'affiner';
    // ⚠️ Et surtout : reste-t-il des secteurs d'entrees DECOUVERTS ? Une
    // agglomeration oubliee passe en hors agglomeration et fausse tous ses
    // ecarts — c'est la faute la plus couteuse du parcours.
    if (secteursCourants.some(x => x.g && x.g.centre && !secteurCouvert(x.g))) return 'agglo-encore';
    // ⚠️ Le zonage est fait : deux gestes restent, dans cet ordre. Refermer le
    // volet (il masque la fenetre de travail et le bouton d'analyse), puis
    // analyser. Guider directement vers « Analyser » alors que le volet le
    // recouvre ne guide personne (auteur, 27/07).
    if (ui.volet && ui.volet.classList.contains('agn-volet-ouvert')) return 'volet-terminer';
    return 'analyse';
  }

  /**
   * Le nom de la commune suivie, pour les etapes qui AFFIRMENT quelque chose.
   *
   * ⚠️ Regle du 27/07 : on ne fait pas une affirmation sans dire sur quoi elle
   * porte. « Le zonage est fait » a ete lu comme parlant de la commune que
   * l'editeur cadrait, alors qu'il parlait de sa voisine.
   */
  function nomSuivi() { return communeActive ? communeActive.nom : ''; }

  /** Ce qu'on dit, et ce qu'on montre, pour chaque etape. */
  const GUIDAGE = {
    contours: { n: 1, cible: null,
      texte: 'Amène la carte sur la commune à traiter : les contours du département ' +
             'se chargent tout seuls.',
      suite: 'Rien à faire d\'autre — patiente quelques secondes.' },
    commune: { n: 1, cible: '#agn-commune', dansVolet: true,
      texte: 'Choisis ta commune dans la liste.',
      suite: 'Celle qui est sous le centre de la carte est remontée en tête.' },
    // Pas de cible : on ne montre pas un geste qu'on s'apprete peut-etre a fermer.
    'agglo-sondage': { n: 2, cible: null,
      texte: 'Vérification des panneaux disponibles sur cette commune…',
      suite: 'Une seconde — la source est très inégale, et c\'est elle qui décide ' +
             'par où commencer.' },
    'agglo-panneaux': { n: 2, cible: '#agn-panneaux', dansVolet: true,
      texte: 'Relève les panneaux d\'agglomération.',
      suite: 'Ils marquent les entrées et sorties : c\'est le point de départ du tracé.' },
    'agglo-proposer': { n: 2, cible: '#agn-pretrace', dansVolet: true,
      texte: 'Tire un tracé de ces panneaux.',
      suite: 'Un polygone par agglomération — bourg et hameaux séparément.' },
    'agglo-tracer': { n: 2, cible: '#agn-tracer', dansVolet: true,
      texte: () => 'Trace l\'agglomération de ' + nomSuivi() + ' à la main.',
      suite: 'Les panneaux ne suffisent pas ici. Double-clic pour fermer le tracé — ' +
             'ou coche « sans agglomération » si la commune n\'en a pas.' },
    // ⚠️⚠️ LA CARTE ET LE SCRIPT NE REGARDENT PAS LA MEME COMMUNE. Cas vecu le
    // 27/07 : le script gardait Saint-Laurent-des-Arbres (zonee, restee dans la
    // vue a 3,7 km) pendant que l'editeur cadrait Saint-Genies-de-Comolas
    // (vierge) — et lisait « Le zonage est fait » comme parlant de celle-ci.
    // On NOMME les deux, et on montre le seul geste qui remet les deux d'accord.
    'commune-decalee': { n: 1, cible: '#agn-commune', dansVolet: true,
      texte: () => 'Le script travaille sur ' + nomSuivi() + ' — pas sur la commune ' +
                   'que tu regardes.',
      suite: () => {
        const c = guidageDecale(communeActive, communeSousLeCentre());
        return 'La carte est centrée sur ' + (c ? c.nom : 'une autre commune') +
               '. Choisis-la dans la liste pour travailler dessus — ou recadre sur ' +
               nomSuivi() + ' pour reprendre où tu en étais.';
      } },
    'agglo-encore': { n: 2, cible: '#agn-tracer-encore', dansVolet: true,
      texte: 'Il reste des agglomérations à tracer.',
      suite: 'Des secteurs d\'entrées ne sont couverts par aucun polygone. ' +
             'Une agglomération oubliée passe en hors agglomération — et tous ses écarts seront faux.' },
    // ⚠️ On vise le crayon DU polygone concerné, pas le premier venu : avec
    // plusieurs agglomérations, le halo se serait posé n'importe où.
    affiner: { n: 2, cible: '.agn-a-affiner .agn-edit', dansVolet: true,
      texte: 'Ajuste le tracé proposé (✎).',
      suite: 'Les panneaux ne marquent que les routes : entre deux entrées, la ligne ' +
             'est calculée. Tire les poignées pour la coller au terrain.' },
    terminer: { n: 2, cible: '.agn-edit-barre .agn-btn', dansVolet: true,
      texte: 'Termine l\'édition pour enregistrer le tracé.',
      suite: 'Glisse un point plein, clique un point creux pour en ajouter, ' +
             'clic droit pour supprimer.' },
    // Le bilan de couverture ET le bouton : on veut qu'il soit LU avant d'etre
    // clique — c'est le dernier moment ou une agglomeration oubliee se rattrape.
    'volet-terminer': { n: 3, cible: '#agn-volet-ok, .agn-avert-exh', dansVolet: true,
      // ⚠️ « CE volet » ne designe rien : le bandeau de guidage vit dans la
      // FENETRE de travail, pas dans le volet. On le nomme par sa place (auteur,
      // 27/07). Les infobulles du bouton, elles, sont bien DANS le volet et
      // gardent « ce volet ».
      // ⚠️ On NOMME la commune : l'affirmation « c'est fait » ne vaut que si on
      // sait de quoi elle parle (27/07).
      texte: () => 'Le zonage de ' + nomSuivi() + ' est fait — referme le volet de gauche.',
      suite: '⚠️ Assure-toi d\'abord que TOUTES les agglomérations sont tracées : ' +
             'une agglomération oubliée passe en hors agglomération, et tous ses écarts seront faux.' },
    analyse: { n: 3, cible: '#agn-scan',
      texte: () => 'Tout est prêt : lance l\'analyse de ' + nomSuivi() + '.',
      suite: 'Rien ne sera enregistré — tu reliras chaque correction dans WME.' }
  };

  /** Applique (ou retire) la mise en avant et le bandeau. */
  function majGuidage() {
    if (!ui.overlay) return;
    document.querySelectorAll('.agn-guide').forEach(n => n.classList.remove('agn-guide'));
    const bandeau = document.getElementById('agn-guide');
    const etape = etapeCourante();
    if (!bandeau) return;
    if (!etape || aideOuverte) { bandeau.className = ''; bandeau.innerHTML = ''; return; }
    const g = GUIDAGE[etape];
    // ⚠️ Un libelle peut etre une FONCTION : depuis le 27/07, les etapes qui
    // affirment un etat nomment leur commune, et le nom n'est connu qu'au rendu.
    const mot = v => (typeof v === 'function' ? v() : v);
    // La carte vient de quitter la commune en cours : on le DIT, en la nommant.
    // Sans ca, « Choisis ta commune » ressemble a un retour en arriere inexplique.
    const perdue = etape === 'commune' && ui.communePerdue;
    const suite = mot(g.suite);
    bandeau.className = 'on';
    bandeau.innerHTML = '<span class="agn-guide-n">' + g.n + '</span><b>' +
      (perdue ? 'La carte a quitté ' + esc(ui.communePerdue) + ' — choisis la commune à traiter.'
              : esc(mot(g.texte))) + '</b>' +
      (suite ? '<div class="agn-guide-suite">' + esc(suite) + '</div>' : '');
    // ⚠️ Le volet est ferme : on montre le chemin (☰) plutot qu'un element que
    // personne ne voit.
    const voletOuvert = ui.volet && ui.volet.classList.contains('agn-volet-ouvert');
    // ⚠️ `querySelectorAll` : une etape peut designer PLUSIEURS elements — a la
    // fin du zonage, le bouton « Terminer » ET le bilan de couverture, parce
    // qu'il faut lire le second avant de cliquer le premier.
    if (g.dansVolet && !voletOuvert) {
      const chemin = document.getElementById('agn-donnees');
      if (chemin) chemin.classList.add('agn-guide');
    } else if (g.cible) {
      document.querySelectorAll(g.cible).forEach(n => n.classList.add('agn-guide'));
    }
  }

  function sectionsAide() {
    return [
      { id: 'demarrage', titre: '🚀 Démarrage rapide', ouvert: true, corps: `
        <ol>
          <li><b>Charge les contours</b> de ton département : bouton <b>☰</b> puis
            <b>Contours communaux</b> → <b>Télécharger et charger</b>. Une fois pour toutes.</li>
          <li><b>Choisis la commune</b> dans la liste. Celles qui sont sous tes yeux
            remontent en tête (<b>📍 Sous les yeux</b>).</li>
          <li><b>Délimite l'agglomération</b> : <b>🪧 Panneaux d'agglomération</b> puis
            <b>✏️ Proposer un tracé</b> — le script place les polygones d'après les
            panneaux d'entrée. À défaut, <b>＋ Tracer l'agglomération</b> à la main.</li>
          <li><b>Analyser la commune</b>. Rien n'est enregistré : le script lit, compare,
            et propose.</li>
          <li><b>Traite les écarts</b> onglet par onglet. <b>⚡</b> applique une correction
            dans WME (sans enregistrer), <b>✓</b> marque une ligne comme traitée.
            <b>C'est toi qui relis et qui enregistres.</b></li>
        </ol>
        <div class="agn-aide-note">Le script <b>ne modifie ni n'enregistre jamais rien tout seul</b>.
          Chaque ⚡ dépose une modification dans WME, exactement comme si tu l'avais faite à la main :
          tu la relis, tu la gardes ou tu l'annules (Ctrl+Z), et c'est toi qui cliques Enregistrer.</div>` },

      { id: 'contours', titre: '🗺️ Les contours communaux', corps: `
        <p>Le script compare le nommage à la <b>vraie limite communale</b>, pas à ce que
          Waze en dit. Ces contours viennent de l'<b>IGN (Admin Express)</b> via
          <b>geo.api.gouv.fr</b>, sous Licence Ouverte.</p>
        <table class="agn-aide-t">
          <tr><td><b>Télécharger et charger</b></td><td>Choisis un ou plusieurs départements, le script les récupère et les garde. <b>Les contours se cumulent</b> : charger le 30 n'efface pas le 11.</td></tr>
          <tr><td><b>Choisir un fichier GeoJSON</b></td><td>Pour charger des contours depuis un fichier local. ⚠️ Celui-là <b>remplace</b> ce qui est en place.</td></tr>
          <tr><td><b>Champ de filtre</b></td><td>Cherche par <b>nom</b> ou par <b>code INSEE</b>, sans se soucier des accents ni de la casse.</td></tr>
          <tr><td><b>📍 Sous les yeux</b></td><td>Quand il y a beaucoup de communes, celles qui occupent la vue passent en tête de liste.</td></tr>
          <tr><td><b>tout vider</b></td><td>Oublie les contours chargés. Tes polygones d'agglomération, eux, sont conservés.</td></tr>
        </table>
        <p>Les contours sont volumineux : ils sont rangés dans le navigateur (IndexedDB) et
          <b>ne partent jamais</b> dans les exports de partage.</p>` },

      { id: 'agglo', titre: '✏️ Délimiter l\'agglomération', corps: `
        <p>C'est <b>la</b> donnée que le script ne peut pas deviner : où commence et où finit
          l'agglomération, au sens des panneaux. Trois façons de la poser.</p>
        <table class="agn-aide-t">
          <tr><td><b>🪧 Panneaux d'agglomération</b></td><td><b>À essayer en premier.</b> Relève les panneaux <b>EB10</b> (entrée) et <b>EB20</b> (sortie) de la commune, d'après le jeu officiel de signalisation. Ils s'affichent sur la carte.</td></tr>
          <tr><td><b>✏️ Proposer un tracé</b></td><td>Transforme ces panneaux en polygones — <b>un par agglomération</b> : le bourg et chaque hameau séparément. Le script te les présente <b>un par un</b> : <b>Créer ce polygone</b>, <b>Passer celui-ci</b>, <b>Tout arrêter</b>.</td></tr>
          <tr><td><b>＋ Tracer l'agglomération</b></td><td>Tracé à la main, point par point, quand les panneaux manquent ou ne suffisent pas.</td></tr>
          <tr><td><b>sans agglomération</b></td><td>À cocher pour une commune qui n'en a pas. ⚠️ <b>Toute la commune passera alors en hors agglomération</b> : aucune voie ne doit plus porter de ville.</td></tr>
        </table>
        <p><b>Village rattaché.</b> Quand une agglomération porte un nom différent de la commune,
          coche <b>village rattaché</b> et choisis la ville <b>dans la liste de WME</b> : le script
          attendra alors le format <b>« Village (Commune) »</b> sur ces voies.</p>
        <div class="agn-aide-note">⚠️ Une ville que Waze porte sur des segments <b>sans aucun polygone</b>
          en face déclenche une alerte : il manque presque toujours un polygone, et sans lui le script
          réclamerait le <b>retrait</b> de cette ville — une correction à l'envers.</div>
        <p><b>Quand le pré-tracé ne propose rien — ou pas grand-chose.</b> Le relevé de panneaux
          est <b>très inégal selon les communes</b> : mesuré sur cinq communes, deux n'ont
          <b>aucun</b> panneau dans la source et une n'en a que cinq pour 3 200 ha. Le script
          annonce alors le nombre relevé plutôt que de bricoler une forme.</p>
        <table class="agn-aide-t">
          <tr><td><b>« s'aligne le long d'une voie »</b></td><td>Les panneaux forment une ligne, pas une surface (moins de ${LARGEUR_MIN_AGGLO_M} m de large) : c'est une route. Rien n'est tracé — sinon le polygone couvrirait la voie et pas le village.</td></tr>
          <tr><td><b>« couvre N % de la commune »</b></td><td>Le polygone proposé est probablement <b>plusieurs agglomérations soudées</b> : les entrées se sont enchaînées de proche en proche. Vérifie, et passe-le pour les tracer séparément.</td></tr>
          <tr><td><b>« trop isolées »</b></td><td>Moins de trois entrées, ou éparpillées : aucune surface déductible. Elles restent affichées en repère pour un tracé à la main.</td></tr>
        </table>` },

      { id: 'analyse', titre: '🔍 Lancer l\'analyse', corps: `
        <p><b>Analyser la commune</b> lit tout le territoire communal — pas seulement ce que
          l'écran montre.</p>
        <table class="agn-aide-t">
          <tr><td><b>Voie rapide</b></td><td>Toute la commune en un appel, sans bouger ta carte. C'est le mode normal.</td></tr>
          <tr><td><b>Balayage</b></td><td>Repli automatique si la voie rapide échoue : la carte est parcourue en damier au zoom 16. Plus lent, et <b>le bandeau te le dit</b> — l'audit des vrais POI n'y est pas disponible.</td></tr>
          <tr><td><b>⏹ Stop</b></td><td>Interrompt l'analyse. Ce qui a été vu reste affiché, et le script <b>signale que le constat est partiel</b> plutôt que de conclure sur un échantillon.</td></tr>
        </table>
        <p>Ce qui est écarté est <b>compté et dit</b> dans le bilan : hors commune, voies sans
          adressage, voies à règle propre. Un compteur qui baisse doit toujours s'expliquer.</p>` },

      { id: 'selzone', titre: '🏘 Sélection rapide : en ville / hors ville', corps: `
        <p>Deux boutons, sous <b>Analyser la commune</b>, qui <b>ne lancent aucune analyse</b> :
          ils sélectionnent dans WME, d'un clic, les segments selon ce que leur
          <b>nom principal déclare</b>.</p>
        <table class="agn-aide-t">
          <tr><td><b>🏘 En ville</b></td><td>Les segments dont le nom principal porte la ville — donc ceux qui <b>se déclarent en agglomération</b>. Le format <b>Village (Commune)</b> compte aussi.</td></tr>
          <tr><td><b>🌾 Hors ville</b></td><td>Les segments dont le nom principal ne porte <b>aucune</b> ville — donc ceux qui se déclarent hors agglomération.</td></tr>
        </table>
        <p>À quoi ça sert : <b>comparer d'un coup d'œil ce que les segments déclarent et où ils
          sont réellement</b>. Un segment sélectionné par 🏘 mais posé hors de ton polygone
          d'agglomération porte une ville de trop ; un segment resté non sélectionné à l'intérieur
          du polygone en a probablement une qui manque.</p>
        <div class="agn-aide-note">⚠️⚠️ <b>Ces boutons ne voient que ce qui est affiché</b>, et
          c'est une limite de WME, pas du script : la carte ne descend les segments que
          <b>par vue</b>, et <b>lâche ceux qui en sortent</b> — on ne peut donc même pas cumuler
          les sélections en déplaçant la carte. <b>Sélectionner toute une commune d'un coup est
          impossible</b> (Road Selector a exactement la même limite). Le compte rendu te prévient
          à chaque fois qu'<b>il en manque probablement</b>.<br>
          <b>Ces boutons ne touchent jamais à ta carte</b> — ni au zoom, ni au centrage. À toi
          de cadrer : un zoom plus large en prend davantage, jusqu'au <b>zoom 16</b>, dernier
          niveau où WME charge encore <b>toutes</b> les rues (il y couvre ~2,4 km, contre ~0,6 km
          au zoom 18). En dessous de 16, WME cesse de descendre les petites rues : tu verrais
          plus grand en sélectionnant moins. Au-delà, <b>déplace la carte et reclique</b> :
          secteur par secteur.
          Les segments des communes voisines sont écartés, et comptés à part.
          Une ville portée par un nom <b>alternatif</b> ne compte pas : hors agglomération,
          c'est justement le nommage attendu.</div>` },

      { id: 'resultats', titre: '📋 Lire et traiter les résultats', corps: `
        <p>Trois onglets, trois sujets : <b>Segments</b> (le nommage), <b>Numérotation</b>
          (numéros de rue et POI résidentiels), <b>POI</b> (l'adresse des vrais lieux).
          Le chiffre sur l'onglet est son nombre de reports.</p>
        <table class="agn-aide-t">
          <tr><td><b>Les groupes</b></td><td>Les écarts sont réunis par <b>famille</b> — la pastille de couleur est celle du surlignage sur la carte. Une thématique <b>entièrement traitée se replie d'elle-même</b>, compteur au vert.</td></tr>
          <tr><td><b>Clic sur une ligne</b></td><td>Cadre la carte sur l'écart et le sélectionne dans WME.</td></tr>
          <tr><td><b>⚡</b></td><td>Applique la correction proposée <b>dans WME, sans enregistrer</b>. Sur un groupe, le ⚡ de l'en-tête traite d'un coup tout ce qui est automatisable.</td></tr>
          <tr><td><b>✓</b></td><td>Marque la ligne comme traitée : elle se barre, sort de la carte, et <b>revient cochée à la prochaine analyse</b>. Ces coches sont personnelles, elles ne partent jamais dans un partage.</td></tr>
          <tr><td><b>🔒</b></td><td>Segment verrouillé au-dessus de ton niveau : la correction est refusée, le script ne propose pas de bouton.</td></tr>
          <tr><td><b>‹ Précédent / Suivant ›</b></td><td>Passe d'un écart au suivant en cadrant la carte à chaque fois.</td></tr>
          <tr><td><b>Le cas (C3, H5, EB10…)</b></td><td>Le code de la situation, repris du logigramme de nommage. Survole une ligne sur la carte pour le revoir.</td></tr>
        </table>` },

      // ⭐ SECTION AJOUTEE LE 03/08 A LA DEMANDE DE L'AUTEUR : « il faut integrer
      // dans l'appli, comme l'aide, les regles que ce script surveille, et
      // mettre le lien vers les regles officielles vers Discuss ».
      //
      // ⚠️⚠️ ELLE PRECEDE « Ce que chaque controle verifie », ET C'EST L'ORDRE
      // QUI COMPTE : d'abord LA REGLE (qui ne nous appartient pas, et dont on
      // donne la source), ensuite ce que le script en surveille. L'inverse
      // laisserait croire que les controles SONT la norme.
      //
      // ⚠️⚠️ LE BLOC « CE QUE WNA NE VERIFIE PAS » N'EST PAS UNE COQUETTERIE.
      // Les angles morts et les deux faux positifs qui y figurent ont ete
      // MESURES le 03/08 en rejouant les 48 exemples du guide contre le code
      // (scratchpad/mesure-wiki-nommage.js). Un editeur qui lit « bretelles :
      // jamais de ville » peut croire que le FORMAT du nom est verifie — il ne
      // l'est pas. Et surtout : WNA signale a tort « A86 - Intérieure », qui est
      // le format EXIGE par le guide. Taire ca ferait casser des noms justes.
      // ⇒ Tenir ce bloc a jour a chaque evolution : le jour ou les faux
      //   positifs sont corriges, ils sortent d'ici.
      //
      // ⚠️ `target="_blank"` est OBLIGATOIRE : un lien qui remplace l'onglet
      // ferait quitter WME a l'editeur, avec ses modifications non enregistrees.
      { id: 'regles', titre: '📖 Les règles officielles françaises', corps: `
        <div class="agn-aide-src">📖 <b>La source, et elle fait foi :</b>
          <a href="https://www.waze.com/discuss/t/nommage-des-segments-des-rues-des-routes/375658"
             target="_blank" rel="noopener">Nommage des segments, des rues, des routes</a>
          — le guide France sur Waze Discuss.<br>
          ⚠️ <b>Les règles ci-dessous n'appartiennent pas à WNA</b> : il ne fait que les
          appliquer. En cas de désaccord entre cette aide et le guide, <b>c'est le guide qui
          a raison</b> — et un message serait bienvenu pour qu'on corrige le script.</div>

        <p><b>Le cœur de la règle française :</b> la zone décide de tout.</p>
        <table class="agn-aide-t">
          <tr><td><b>En agglomération</b></td><td>Le nom <b>principal</b> porte le nom de rue <b>et la ville</b>. Le numéro de route (Dxxx…) passe en <b>alternatif</b>.</td></tr>
          <tr><td><b>Hors agglomération</b></td><td>Le nom <b>principal</b> porte le numéro de route, <b>sans ville</b>. Le nom de rue et la ville vivent en <b>alternatif</b>.</td></tr>
          <tr><td><b>Limites</b></td><td>Panneaux d'entrée (EB10) et de sortie (EB20) d'agglomération. Une commune peut contenir plusieurs agglomérations.</td></tr>
          <tr><td><b>Village rattaché</b></td><td>Format <span class="agn-aide-ex">Village (Commune)</span>. ⚠️ Village rattaché ou hameau : cela se tranche avec le <b>State</b> ou <b>Regional Manager</b>.</td></tr>
        </table>

        <p><b>Écrire le nom :</b></p>
        <table class="agn-aide-t">
          <tr><td><b>Source</b></td><td>Le nom <b>officiel et complet</b>. En cas de désaccord entre sources, <b>le panneau de signalisation prime</b> sur le cadastre et les plans ; les autres noms officiels peuvent aller en alternatif.</td></tr>
          <tr><td><b>Majuscules, accents</b></td><td><span class="agn-aide-ex">Rue de la République</span>, jamais <span class="agn-aide-ex">rue de la republique</span>.</td></tr>
          <tr><td><b>Abréviations</b></td><td><b>Interdites</b> (« Av. », « Bd »…), <b>sauf</b> un sigle officiel porté par la plaque : alors en majuscules <b>avec un point après chaque lettre</b> — <span class="agn-aide-ex">Rue du T.I.V.</span>, <span class="agn-aide-ex">Rue de la Deuxième D.B.</span>, le nom complet allant en alternatif.</td></tr>
          <tr><td><b>Contractions</b></td><td>Interdites : ni <span class="agn-aide-ex">Rue R. Poincaré</span>, ni <span class="agn-aide-ex">Route de St-Fargeau</span>.</td></tr>
          <tr><td><b>Nombres</b></td><td>En chiffres ou en lettres <b>selon le panneau</b> : <span class="agn-aide-ex">Rue du 11 Novembre</span> comme <span class="agn-aide-ex">Rue du Onze Novembre</span>.</td></tr>
          <tr><td><b>Jamais dans un nom</b></td><td>La <b>fonction</b> du segment (« Voie de bus », « Parking »), la <b>nature</b> d'un lieu, et la <b>direction</b> — sauf sur les bretelles, où elle est la règle.</td></tr>
        </table>

        <p><b>Voies à règle propre :</b></p>
        <table class="agn-aide-t">
          <tr><td><b>Rocades, périphériques</b></td><td><b>Hors agglomération par nature</b> : jamais de ville, ni en principal ni en alternatif. Nommage comme les autoroutes, avec un suffixe <b>uniquement si la voie s'appelle ainsi</b> — intérieure/extérieure ou orientation — séparé par <b>espace tiret espace</b> : <span class="agn-aide-ex">A86 - Intérieure</span>, <span class="agn-aide-ex">N136 - Rocade Ouest</span>. Seule exception : le périphérique parisien (<span class="agn-aide-ex">Périphérique Intérieur</span>).</td></tr>
          <tr><td><b>Bretelles</b></td><td><b>Jamais de ville.</b> Entrée d'autoroute : <span class="agn-aide-ex">A4: Reims</span> — deux-points <b>collé au numéro, espacé de la direction</b>, et <b>une seule</b> direction, la première du panneau. Entrée de rocade : le nom de route seul (<span class="agn-aide-ex">Périphérique Ouest</span>). Sortie numérotée : <span class="agn-aide-ex">Sortie 18: Valensole</span>, ou <span class="agn-aide-ex">Sortie 47</span> seule ; <b>le nom de l'échangeur s'ignore</b>. Sortie sans numéro de route : <span class="agn-aide-ex">&gt; Orsay</span>. Une <b>seconde direction</b> ne s'ajoute qu'en cas d'ambiguïté sur le panneau : <span class="agn-aide-ex">D118: Chartres / Villejust</span>.<br>⚠️ Une bretelle <b>sans nom</b> est <b>correcte</b> : elle hérite du segment suivant.</td></tr>
          <tr><td><b>Voies communales</b></td><td>La <b>forme abrégée du panneau</b> : <span class="agn-aide-ex">C6</span>, <span class="agn-aide-ex">VC6</span>, <span class="agn-aide-ex">CR12</span>… et <b>pas</b> « Voie Communale n°6 », qui serait tronqué en guidage.</td></tr>
          <tr><td><b>Voie sur deux communes</b></td><td>Le <b>même nom de rue</b> en alternatif, avec la seconde ville.</td></tr>
          <tr><td><b>Voies ferrées</b></td><td>Ni nom de rue, ni ville.</td></tr>
          <tr><td><b>Pistes d'aéroport</b></td><td>Jamais de ville. Le <b>code OACI</b> de l'aéroport <b>peut</b> être mis en nom de rue.</td></tr>
          <tr><td><b>Giratoires</b></td><td>Sans nom ; la ville suit la zone.</td></tr>
        </table>

        <div class="agn-aide-note">⚠️⚠️ <b>Ce que WNA ne vérifie PAS — mesuré, pas supposé.</b>
          Un contrôle absent est invisible : autant le dire.<br>
          • <b>Le format du nom des bretelles n'est pas contrôlé du tout.</b> WNA vérifie
          seulement qu'elles ne portent pas de ville. <span class="agn-aide-ex">Sortie 18 : Valensole</span>
          (espace en trop), un nom d'échangeur conservé ou une seconde direction injustifiée
          <b>passent sans un mot</b>.<br>
          • <b>La forme abrégée des voies communales</b> n'est pas vérifiée :
          « Voie Communale n°6 » ne déclenche rien.<br>
          • WNA <b>ne voit pas les panneaux</b>. Il ne peut donc jamais dire si une seconde
          direction est justifiée, ni si un mot est le nom d'un échangeur.<br>
          🔴 <b>Et deux défauts connus, à ne pas suivre aveuglément :</b> WNA signale
          <span class="agn-aide-ex">A86 - Intérieure</span> et <span class="agn-aide-ex">N136 - Rocade Ouest</span>
          comme « numéro collé au nom », alors que <b>c'est le format exigé</b> par le guide ;
          et il réclame le retrait du <b>code OACI</b> sur une piste d'aéroport, que le guide
          autorise. <b>Dans ces deux cas, le guide a raison, pas le script.</b></div>` },

      { id: 'controles', titre: '🏷️ Ce que chaque contrôle vérifie', corps: `
        <p>Tout se décoche, dans <b>☰ → Contrôles</b>. Un contrôle décoché ne signale rien
          et le bilan le rappelle.</p>
        <table class="agn-aide-t">
          <tr><td><b>Nommage agglo / hors agglo</b></td><td>Le cœur : en agglomération une voie porte la ville, hors agglomération elle ne la porte pas — et le numéro de route passe au principal.</td></tr>
          <tr><td><b>Cartouches</b></td><td>Un numéro de route (Dxxx, Nxxx, Cxxx) doit porter son écusson. ⚠️ En agglomération, <b>aucun cartouche sur un nom de rue en principal</b>.</td></tr>
          <tr><td><b>Bretelles · Rocades</b></td><td>Ne portent <b>jamais</b> de ville.</td></tr>
          <tr><td><b>Voies ferrées, pistes, ferries</b></td><td>Ni ville, ni nom.</td></tr>
          <tr><td><b>Giratoires</b></td><td>Sans nom ; la ville suit la zone (et le format « Village (Commune) » s'il y a lieu).</td></tr>
          <tr><td><b>Abréviations</b></td><td>« Av. », « Bd », « Rte »… à écrire en toutes lettres.</td></tr>
          <tr><td><b>Contractions</b></td><td>« St- » pour Saint-, « R. Poincaré »…</td></tr>
          <tr><td><b>Minuscule initiale</b></td><td>Un nom de voie commence par une majuscule.</td></tr>
          <tr><td><b>Numéro collé au nom</b></td><td>« D980 - Route de… » est <b>interdit</b> : le numéro va au principal hors agglo, ou en alternatif en agglo, jamais collé au nom.</td></tr>
          <tr><td><b>Fonction ou direction</b></td><td>« vers X », « accès Y » n'appartiennent pas au nom.</td></tr>
          <tr><td><b>Rédaction : dictionnaire FR</b></td><td>Confronte le nom au <b>dictionnaire communautaire français</b> (~1 430 règles) et propose le nom corrigé : abréviations que les contrôles ci-dessus ne voient pas (« Che », « Pl », « Imp », « Sq »), titres (« Dr », « Gal », « Cdt », « Mal »), <b>accents manquants</b>, espaces en trop, « St-Jean ».</td></tr>
        </table>
        <div class="agn-aide-note">🏷️ <b>D'où viennent ces règles.</b> Elles ne sont pas de nous :
          c'est le dictionnaire de <b>WME Check Road Name</b> (buchet37), maintenu par la
          communauté française depuis 2015 dans deux classeurs partagés, et employé ici
          <b>avec l'accord de son auteur</b>. WNA les <b>lit</b>, il n'en garde pas de copie —
          une correction apportée par la communauté vaut donc pour WNA dès le rechargement de
          la page.<br>
          ⚠️ <b>Les deux classeurs n'ont pas le même statut</b>, et son auteur y tient : le
          dictionnaire <b>principal</b> est <b>figé</b>, tandis que le dictionnaire
          <b>public</b> vit au gré des éditeurs, <b>sans validation préalable</b>. Une
          proposition venue d'ici n'est donc pas une règle arbitrée : <b>relis-la avant
          d'appliquer</b>, comme tu le ferais d'une suggestion d'un collègue.<br>
          ✍️ <b>Une règle te manque ou te paraît fausse ?</b> Elle ne se corrige pas dans WNA,
          qui ne fait que lire : passe par <b>WME Check Road Name</b>, c'est lui qui donne
          accès aux dictionnaires.<br>
          ⚠️ <b>Si tu as déjà WME Check Road Name</b>, ce contrôle est <b>décoché d'office</b> :
          il te dirait exactement la même chose. Tu peux le cocher quand même.<br>
          ⚠️⚠️ <b>Une limite mesurée, et le script s'y tient.</b> Ce dictionnaire suppose une
          casse déjà à peu près correcte : il ne sait <b>pas</b> redresser un nom écrit
          entièrement en majuscules (« RUE DES ECOLES » lui fait produire « RUE DES ÉcolES »).
          Dans ce cas précis, WNA <b>signale la capitale sans proposer de nom</b> — mieux vaut
          te laisser écrire le bon que t'en suggérer un faux.</div>` },

      { id: 'numerotation', titre: '🔢 Numérotation : numéros et POI résidentiels', corps: `
        <p>Règle française : <b>en agglomération le numéro est porté par le segment</b> (HN),
          <b>hors agglomération par un POI résidentiel</b> (RPP). Le script cherche donc les
          deux situations inverses.</p>
        <table class="agn-aide-t">
          <tr><td><b>Numéro hors agglo</b></td><td>Proposé à la conversion en POI résidentiel. Le ⚡ crée le POI à la position du numéro, lui donne l'adresse, <b>reprend son point d'entrée</b>, puis retire le numéro — et si l'une des étapes échoue, il revient en arrière plutôt que de laisser une adresse en double.</td></tr>
          <tr><td><b>RPP en agglo</b></td><td>Souvent <b>légitime</b> : l'entrée donne sur une autre voie que l'adresse postale, ce qu'un numéro sur segment ne sait pas exprimer. Le script ne tranche donc pas… sauf quand il peut le prouver.</td></tr>
          <tr><td><b>… doublon</b></td><td>Le même numéro est déjà posé sur la même rue, tout près : le POI fait double emploi.</td></tr>
          <tr><td><b>… accès sur sa propre voie</b></td><td>Le point d'accès du POI donne sur la voie de son adresse : il n'exprime aucun décalage.</td></tr>
          <tr><td><b>… le long de sa rue</b></td><td>Faute de point d'accès, le POI longe la rue qu'il déclare — un numéro dirait la même chose.</td></tr>
          <tr><td><b>… accès sur une AUTRE voie</b></td><td>La preuve inverse : le POI est à sa place, il n'est <b>plus signalé du tout</b> — mais il reste compté dans le bilan.</td></tr>
          <tr><td><b>📷 photo</b></td><td>Un RPP photographié a été posé par quelqu'un venu sur place. Il reste signalé, <b>en fin de liste</b>, avec la mention : regarde-le de près avant de le supprimer.</td></tr>
        </table>
        <p><b>📏 Une mesure, et pas une règle.</b> Un contrôle <b>décoché par défaut</b> compte les
          numéros posés, <b>en agglomération</b>, sur un segment dont le <b>nom principal est un
          numéro de route</b> (« D121 ») plutôt qu'une adresse postale. Il donne aussi combien
          d'entre eux gardent un vrai nom de rue <b>en alternatif</b>.</p>
        <div class="agn-aide-note">⚠️ Ces cas <b>ne sont pas des écarts</b> et n'ont <b>aucun bouton
          de correction</b> : à ce jour aucune règle française ne les interdit. Le relevé existe
          parce qu'un éditeur a proposé d'en faire une norme ; il faudra qu'elle soit validée par les
          <b>Local Champs</b> et écrite au <b>wiki</b> avant que le script en tire quoi que ce soit.
          <b>Le script applique les règles, il n'en crée pas.</b></div>
        <div class="agn-aide-note">La conversion <b>POI → numéro</b> n'est pas automatisée, volontairement :
          le script ne sait dire ni sur quel segment ni à quel endroit poser le numéro, et supprimer le POI
          emporterait son nom, son point d'entrée et ses photos. Il te guide, tu fais le geste.</div>` },

      { id: 'poi', titre: '📍 POI : l\'adresse des vrais lieux', corps: `
        <p>Cet onglet ne parle <b>pas</b> des POI résidentiels, mais des commerces, services,
          bâtiments nommés — et de leur adresse.</p>
        <table class="agn-aide-t">
          <tr><td><b>Adresse incomplète</b></td><td>Rue ou commune manquante. Le script <b>propose une adresse</b> : la voie nommée la plus proche du point d'accès, et la commune du contour INSEE.</td></tr>
          <tr><td><b>⚡ sur un POI</b></td><td>Applique rue + commune. Si plusieurs noms sont possibles, le clic <b>ouvre une liste</b> : le plus probable en tête, les numéros de route ensuite, et une saisie libre.</td></tr>
          <tr><td><b>Le numéro</b></td><td>Proposé, <b>jamais appliqué</b> : à quelques dizaines de mètres, ce peut être celui du voisin. À saisir à la main après vérification.</td></tr>
          <tr><td><b>Commune différente</b></td><td>Présenté comme <b>à vérifier</b>, avec la distance à la limite communale : près d'une frontière, l'adresse de la voisine peut être la bonne.</td></tr>
          <tr><td><b>Numéro manquant</b></td><td>Contrôle <b>décoché par défaut</b> : il concerne environ la moitié des POI et noierait le reste.</td></tr>
        </table>
        <p><b>Ce qui est écarté volontairement</b> : les éléments du paysage (rivière, forêt, plage…),
          qui n'ont pas d'adresse ; et le <b>bâti sans nom</b> — une zone anonyme sert à dessiner un
          bâtiment, les commerces qu'elle abrite sont des POI à part, eux-mêmes audités. Le bilan les compte.</p>
        <div class="agn-aide-note">⚠️ Cet onglet demande la <b>voie rapide</b> : le point d'accès et les
          catégories n'existent pas en mode balayage. Le script le dit au lieu de paraître vide.</div>` },

      { id: 'partage', titre: '💾 Sauvegarde et partage', corps: `
        <p>Trois choses sont mémorisées : tes <b>polygones d'agglomération</b>, tes communes
          déclarées <b>sans agglomération</b>, et tes <b>coches ✓ traité</b>.</p>
        <table class="agn-aide-t">
          <tr><td><b>Où</b></td><td>Dans le <b>gestionnaire de scripts</b> (Tampermonkey), pas dans le site : ça survit à un « effacer les données de navigation » et ça entre dans ses sauvegardes.</td></tr>
          <tr><td><b>⬇️ Exporter</b></td><td>Un fichier avec les polygones et les communes sans agglo. ⚠️ <b>Tes coches « traité » n'y sont jamais</b> : elles sont personnelles.</td></tr>
          <tr><td><b>⬆️ Importer un fichier</b></td><td>Ajoute ce qui manque et <b>ne remplace jamais</b> ce que tu as déjà. Un fichier venu d'un autre script est refusé.</td></tr>
          <tr><td><b>🌐 Importer depuis l'URL</b></td><td>Même chose depuis une adresse (https uniquement).</td></tr>
        </table>
        <p><b>Transférer ton travail d'un PC à l'autre</b> — tout se passe dans
          <b>☰</b> → <b>Sauvegarde &amp; partage</b> :</p>
        <ol>
          <li>Sur le PC de départ, clique <b>⬇️ Exporter (polygones + communes)</b>.
            Tu obtiens un fichier <b>.json</b> : transfère-le comme tu veux (clé USB,
            courriel, cloud).</li>
          <li>Sur le PC d'arrivée, clique <b>⬆️ Importer un fichier</b> et choisis ce
            .json.</li>
        </ol>
        <div class="agn-aide-note">⚠️ <b>L'import n'écrase jamais rien</b> : il ajoute
          seulement les communes qui te manquent. Si une commune existe des deux côtés,
          c'est <b>la version du PC d'arrivée</b> qui est gardée — exporte donc depuis le
          poste le plus à jour. Et tes <b>coches ✓ traité ne voyagent pas</b> : elles sont
          personnelles, seuls les polygones et les communes « sans agglomération » sont
          dans le fichier.<br>
          Tu peux aussi déposer ce fichier quelque part (GitHub…) et le récupérer avec
          <b>🌐 Importer depuis l'URL</b>, pratique pour le reprendre régulièrement sans
          repasser par une clé.</div>` },

      { id: 'limites', titre: '⚠️ Limites et messages fréquents', corps: `
        <table class="agn-aide-t">
          <tr><td><b>Territoire indéterminé</b></td><td>Le script attend d'être sûr d'être en France avant d'appliquer des règles françaises. <b>Choisis une commune</b> : cela suffit. Sinon, zoome à 14 ou plus.</td></tr>
          <tr><td><b>Numéros non chargés</b></td><td>WME ne descend les numéros de rue qu'<b>à partir du zoom 18</b>. La conversion cadre elle-même la carte pour les faire venir.</td></tr>
          <tr><td><b>POI résidentiels absents</b></td><td>Ils ne sont servis qu'à partir du <b>zoom 17</b> — d'où la voie rapide, qui ne dépend pas du zoom.</td></tr>
          <tr><td><b>« a un numéro de rue invalide »</b></td><td><b>Ce n'est pas un doublon d'adresse</b>, malgré ce que le message laisse croire. Refus de WME sur <b>un numéro précis</b>, qui persiste <b>même après avoir supprimé et enregistré</b> le numéro de rue du même nom — et le numéro de rue, lui, reste acceptable : seul le lieu est bloqué. C'est un <b>résidu côté serveur Waze</b>, invisible dans l'éditeur. Rien à corriger sur la carte : annule, et signale l'adresse exacte au staff, qui sait la purger. Le script <b>recopie ce message et l'explique</b> dans un bandeau, car l'alerte de WME s'affiche derrière sa fenêtre.</td></tr>
          <tr><td><b>Deux infobulles superposées</b></td><td>D'autres scripts posent aussi leur bulle au survol de la carte, et les deux se recouvrent — le script <b>ne peut pas arbitrer chez le voisin</b>. Décoche <b>Infobulle au survol</b> dans <b>☰ → Surlignage sur la carte</b> : le reste de l'affichage (surlignage, couleurs) est conservé. Pour savoir quel script pose l'autre bulle : clic droit dessus → <b>Inspecter</b>, son identifiant nomme presque toujours le script.</td></tr>
          <tr><td><b>Analyse interrompue</b></td><td>Les constats qui supposent d'avoir tout vu (villes sans polygone, cartouches d'une voie entière) sont alors présentés comme <b>non fiables</b>, pas cachés.</td></tr>
          <tr><td><b>Rien n'est enregistré</b></td><td>Le compteur de la fenêtre rappelle combien de modifications attendent dans WME. <b>C'est toi qui enregistres.</b></td></tr>
        </table>` },

      { id: 'france', titre: '🇫🇷 Pourquoi la France uniquement', corps: `
        <p>Les règles appliquées ici sont <b>françaises</b> : agglomération d'après les panneaux,
          numéro de route au principal hors agglo, format « Village (Commune) », cartouches.
          Les appliquer ailleurs abîmerait la carte.</p>
        <p>Le script <b>se ferme donc hors de France</b> — métropole, Corse et outre-mer sont
          acceptés. L'architecture est prête à accueillir d'autres pays, mais aucun référentiel
          de nommage n'est disponible à ce jour.</p>` }
    ];
  }

  /** Rend l'aide : sections repliables + pied de page avec les liens. */
  function construireAide() {
    return sectionsAide().map(s => `
      <div class="agn-aide-s">
        <div class="agn-aide-h${s.ouvert ? ' on' : ''}" data-aide="${s.id}">
          <span class="agn-chev">${s.ouvert ? '▾' : '▸'}</span>${s.titre}
        </div>
        <div class="agn-aide-c" id="agn-aide-${s.id}"${s.ouvert ? '' : ' style="display:none"'}>${s.corps}</div>
      </div>`).join('') +
      // ⚠️ `rel="noopener"` sur TOUS les liens : sans lui, la page ouverte garde
      // une poignee sur l'onglet WME (`window.opener`) et peut le renavigater.
      // ⚠️ Le guide FR est mis EN TETE du pied : c'est la seule source de norme,
      // les deux autres liens ne sont que le code.
      `<div class="agn-aide-pied">
        📖 <a href="https://www.waze.com/discuss/t/nommage-des-segments-des-rues-des-routes/375658"
              target="_blank" rel="noopener">Règles de nommage FR</a>
        &nbsp;·&nbsp;
        🔗 <a href="https://greasyfork.org/fr/scripts/588554-wme-naming-auditor"
              target="_blank" rel="noopener">GreasyFork</a>
        &nbsp;·&nbsp;
        <a href="https://github.com/DrSlump34/WME-Naming-Auditor"
           target="_blank" rel="noopener">GitHub</a>
        &nbsp;·&nbsp; v${VERSION}
      </div>`;
  }

  /**
   * Ouvre ou ferme l'aide. Elle prend tout le corps de la fenetre.
   *
   * ⚠️ On MEMORISE l'affichage de chaque bloc avant de le masquer : plusieurs
   * d'entre eux (bandeau territorial, progression, bandeau de correction) sont
   * caches ou montres par leur propre logique. Les remettre a « visible »
   * d'office ferait reapparaitre un bandeau qui n'avait rien a dire.
   */
  function basculerAide(on) {
    const corps = document.getElementById('agn-corps');
    const aide = document.getElementById('agn-aide');
    if (!corps || !aide) return;
    aideOuverte = on === undefined ? !aideOuverte : !!on;
    if (aideOuverte && !aide.innerHTML) {
      aide.innerHTML = construireAide();
      aide.querySelectorAll('.agn-aide-h').forEach(h => {
        h.onclick = () => {
          const c = document.getElementById('agn-aide-' + h.dataset.aide);
          if (!c) return;
          const ouvert = c.style.display !== 'none';
          c.style.display = ouvert ? 'none' : '';
          h.classList.toggle('on', !ouvert);
          h.querySelector('.agn-chev').textContent = ouvert ? '▸' : '▾';
        };
      });
    }
    for (const n of corps.children) {
      if (n === aide) { n.style.display = aideOuverte ? '' : 'none'; continue; }
      if (aideOuverte) {
        if (n.dataset.agnAvant === undefined) n.dataset.agnAvant = n.style.display;
        n.style.display = 'none';
      } else if (n.dataset.agnAvant !== undefined) {
        n.style.display = n.dataset.agnAvant;
        delete n.dataset.agnAvant;
      }
    }
    const btn = document.getElementById('agn-aide-btn');
    if (btn) btn.classList.toggle('agn-tab-on', aideOuverte);
    if (ui.onglets) ui.onglets.forEach(t => { if (aideOuverte) t.classList.remove('agn-tab-on'); });
    if (!aideOuverte) choisirVue(vueCourante);
  }

  const VUES = ['segments', 'adresses', 'poi'];
  const CASE_TABLE = { segments: 'segTable', adresses: 'adrTable', poi: 'poiTable' };
  const CASE_CARTE = { segments: 'segCarte', adresses: 'adrCarte', poi: 'poiCarte' };
  const vueDe = f => f.poi ? 'poi' : (f.adresse ? 'adresses' : 'segments');

  let vueCourante = 'segments';
  function choisirVue(vue) {
    vueCourante = VUES.includes(vue) ? vue : 'segments';
    // ⚠️ Cliquer un onglet de resultats REFERME l'aide : sans ca, l'onglet se
    // marquait actif mais la fenetre continuait d'afficher le mode d'emploi.
    if (aideOuverte) basculerAide(false);
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
      // Meme prudence que `replierSection` : la section peut avoir ete deplacee.
      const r = sec.querySelector('.agn-sect-r'); if (!r) return;
      r.textContent = txt || '';
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
            <div class="agn-note" id="agn-r-dico"></div>
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
            <label class="agn-sb-c"><input type="checkbox" id="agn-r-bulle" title="Affiche le détail de l'écart dans une infobulle quand la souris passe sur un segment ou un point signalé. À décocher si un autre script pose déjà sa propre infobulle au survol : les deux se recouvrent.">
              Infobulle au survol</label>
            <div class="agn-sb-n">À décocher si <b>un autre script</b> affiche déjà
              une infobulle au survol : les deux se superposent.</div>
            <div id="agn-r-couleurs"></div>
            <button class="agn-sb-b" id="agn-r-reset" title="Remet les couleurs d'origine">Couleurs par défaut</button>`)}
          ${sect('navigation', 'Navigation', `
            <label class="agn-sb-c"><input type="checkbox" id="agn-r-guidage" title="Met en avant le geste suivant tant qu'il reste quelque chose à faire : choisir la commune, délimiter l'agglomération, lancer l'analyse. À décocher quand l'outil est dans les doigts.">
              Guidage pas à pas</label>
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
            <div class="agn-sb-n">Les contours se cumulent : charger un département n'efface pas les autres.</div>
            <!-- ⚠️ Le chargement MANUEL vient se loger ici au demarrage (voir
                 rangerChargementContours) : il ne sert qu'en secours, il n'avait
                 rien a faire en tete du parcours (auteur, 27/07). -->
            <div id="agn-contours-manuel"></div>`)}
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
      inp.onchange = () => {
        options.controles[cle] = inp.checked; saveUI();
        // ⚠️ Cocher le dictionnaire APRES le demarrage doit le telecharger :
        // sans ca, le controle resterait muet et l'editeur croirait sa carte
        // impeccable (« zero est un resultat », lecon de la v2.26).
        if (cle === 'redactionDico') {
          if (inp.checked && !dico.regles.length) {
            majEtatDico('chargement');
            chargerDictionnaireFr().then(() => { majEtatDico(); prevenir(); });
          } else { majEtatDico(); }
        }
        prevenir();
      };
      zoneCtrl.appendChild(l);
    });
    majEtatDico();
    coche('#agn-r-zoom', 'zoomClic');
    coche('#agn-r-surligner', 'surligner', () => redrawEcarts(null));
    // ⚠️ Decocher doit faire disparaitre la bulle DEJA affichee : sans ce
    // rappel, elle restait a l'ecran jusqu'au prochain mouvement de souris —
    // un reglage qui ne prend effet qu'apres coup se lit comme une panne.
    coche('#agn-r-bulle', 'bulleSurvol', () => { survole = null; cacherBulle(); });

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
    // Le guidage s'allume ou s'eteint tout de suite : une case qui ne fait rien
    // avant le prochain clic passe pour cassee.
    coche('#agn-r-guidage', 'guidage', majGuidage);

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
    // C'est maintenant qu'on peut masquer une erreur de WME deja affichee.
    releverErreurSave();
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
    // ⚠️ L'icone dit ce que fait le script : NOMMER. L'ancien 🏙️ (paysage
    // urbain) ne se lisait pas a 40 px — « on ne sait pas ce que c'est »
    // (l'auteur, 27/07). Une ETIQUETTE, c'est le geste meme de l'outil.
    const wrap = el(`<div id="agn-fab-wrap"><button id="agn-fab-btn" type="button"
        title="${esc(SCRIPT_NAME)}">🏷️</button></div>`);
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
    // ⚠️ Le tracé à la main reste TOUJOURS ouvert : c'est le recours quand la
    // source de panneaux est muette, et elle l'est souvent (2 communes sur 5
    // mesurées ne rendent aucun panneau).
    ui.btnTracer.disabled = !communeActive || horsFrance;
    // Les deux boutons qui dependent des panneaux disent POURQUOI ils sont
    // fermes : un bouton grise sans raison se lit comme une panne.
    const s = sondageCourant();
    const sansPanneaux = s && s.etat === 'aucun';
    // ⚠️ Ferme AUSSI pendant le sondage : cliquer a cet instant lance le releve
    // complet (une dizaine de requetes) alors que la reponse legere arrive dans
    // la seconde — et peut dire qu'il n'y a rien a relever.
    const sondageEnCours = s && s.etat === 'encours';
    ui.btnPanneaux.disabled = !communeActive || horsFrance || !!sansPanneaux || !!sondageEnCours;
    ui.btnPanneaux.title = sansPanneaux
      ? 'Aucun panneau d\'entrée d\'agglomération relevé sur cette commune dans le jeu ' +
        'officiel de signalisation. Ce n\'est pas un défaut du script : la source est ' +
        'très inégale. Trace l\'agglomération à la main.'
      : (s && s.etat === 'encours')
        ? 'Vérification de la disponibilité des panneaux…'
        : 'Récupère les panneaux EB10 / EB20 (entrée et sortie d\'agglomération) et les ' +
          'confronte aux polygones tracés.' +
          (s && s.nb ? ' ' + s.nb + ' panneau(x) repéré(s) sur cette commune.' : '');
    if (ui.btnPreTrace) {
      // Trois raisons de le fermer, trois messages : rien à proposer tant que
      // les panneaux ne sont pas relevés, et rien de traçable s'ils forment une
      // ligne ou sont trop isolés.
      const relevesMaisSteriles = panneaux.length && bilanPreTrace && !bilanPreTrace.tracables;
      ui.btnPreTrace.disabled = !communeActive || horsFrance || !panneaux.length || !!relevesMaisSteriles;
      ui.btnPreTrace.title = sansPanneaux
        ? 'Aucun panneau sur cette commune : rien à proposer.'
        : !panneaux.length
          ? 'Relève d\'abord les panneaux (bouton au-dessus).'
          : relevesMaisSteriles
            ? 'Les ' + panneaux.length + ' panneaux relevés ne forment aucune surface exploitable' +
              (bilanPreTrace.rubans ? ' : ils s\'alignent le long d\'une voie' : ' : ils sont trop isolés') +
              '. Trace à la main.'
            : 'Fabrique un polygone par groupe d\'entrées d\'agglomération. Tracé grossier, ' +
              'à ajuster aux poignées.';
    }
    // ⚠️⚠️ `renderAgglos` sort par PLUSIEURS chemins : mettre le guidage a la
    // seule fin de la fonction le rendait muet dans les deux cas ou il sert le
    // plus — pas de commune choisie, ou territoire hors de France. Chaque sortie
    // le rafraichit donc explicitement.
    if (horsFrance) {
      ui.btnScan.disabled = true;
      ui.listeAgglos.innerHTML = '<div class="agn-empty">' + messagePays() + '</div>';
      majBandeauPays();
      majBoutonsZone();
      majGuidage();
      return;
    }
    if (!communeActive) {
      ui.btnScan.disabled = true;
      ui.listeAgglos.innerHTML = '<div class="agn-empty">Choisis une commune.</div>';
      majResumeSections();     // sinon l'en-tete annonce encore la commune perdue
      majBandeauPays();        // et le bandeau n'a plus de raison d'etre
      majBoutonsZone();
      majGuidage();
      return;
    }
    const liste = agglos[communeActive.code] || [];
    // ⚠️ Le bouton d'analyse reste FERME tant qu'on n'a ni polygone ni
    // declaration explicite : sans zonage, tous les ecarts seraient faux.
    const declaree = !!sansAgglo[communeActive.code];
    // Et le garde-fou territorial : l'analyse exige une France DEMONTREE. Le
    // bandeau juste au-dessus du bouton dit pourquoi il est ferme — un bouton
    // grise sans explication ne vaut pas mieux qu'une promesse vide.
    // ⚠️⚠️ UNE EDITION EN COURS FERME TOUT LE RESTE (auteur, 27/07) : tant que
    // le tracé n'est ni enregistré ni annulé, il n'existe pas vraiment. Analyser
    // dessus donnerait des écarts calculés sur un polygone fantôme, et refermer
    // le volet ferait perdre le seul bouton qui permet d'en sortir.
    ui.btnScan.disabled = (!liste.length && !declaree) || !enFrance() || !!edition;
    if (edition) ui.btnScan.title = 'Termine d\'abord l\'édition du tracé en cours ' +
      '(💾 pour enregistrer, Échap pour annuler).';
    const btnFin = ui.volet && ui.volet.querySelector('#agn-volet-ok');
    if (btnFin) {
      btnFin.disabled = !!edition;
      btnFin.title = edition
        ? 'Édition en cours : enregistre (💾) ou annule (Échap) avant de replier.'
        : 'Referme ce volet et rend la place à la fenêtre de travail';
    }
    if (!liste.length) {
      ui.listeAgglos.innerHTML = '';
      const bloc = el(`<div class="agn-empty">
          Aucune agglomération tracée pour <b>${esc(communeActive.nom)}</b>.<br>
          <label class="agn-sansagglo" title="À cocher seulement si la commune n'a RÉELLEMENT aucun panneau d'agglomération : toute la commune sera alors analysée comme hors agglomération."><input type="checkbox" ${declaree ? 'checked' : ''}><span>cette
            commune n'a <b>aucune agglomération</b> (tout est hors agglo)</span></label>
        </div>`);
      bloc.querySelector('input').onchange = e => {
        // ⚠️ `false` et non `delete` : la case DECOCHEE est un choix, et la fusion
        // multi-onglets doit pouvoir le distinguer d'une commune jamais vue —
        // sinon un autre onglet la recocherait (v2.26.04).
        if (e.target.checked) sansAgglo[communeActive.code] = true;
        else sansAgglo[communeActive.code] = false;
        saveSansAgglo(); renderAgglos(); majResumeSections();
      };
      ui.listeAgglos.appendChild(bloc);
      majResumeSections();
      majBandeauPays();
      majBoutonsZone();
      return;
    }
    majResumeSections();
    majBandeauPays();
    majBoutonsZone();
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
            <button class="agn-mini agn-edit${edition && edition.agglo === a ? ' agn-edit-on' : ''}" title="${
              edition && edition.agglo === a
                ? 'Enregistrer le tracé modifié · Échap pour annuler'
                : 'Éditer les sommets'}">${edition && edition.agglo === a ? '💾' : '✎'}</button>
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
        // ⚠️⚠️ ON GARDE LA CLE, MEME VIDE (v2.26.04). La supprimer effacait la
        // TRACE du geste : a la fusion multi-onglets, « cette commune n'a plus de
        // polygone » devenait indistinguable de « je n'ai jamais vu cette
        // commune », et le polygone supprime revenait a la sauvegarde suivante.
        if (!liste.length) agglos[communeActive.code] = [];
        saveAgglos(); redrawAgglos(); renderAgglos();
      };
      node.querySelector('.agn-zoom').onclick = () => {
        // ⚠️ Pas `centerMapOnGeometry` : il centre sur le canevas ENTIER, donc le
        // polygone finit a moitie derriere la fenetre. On calcule l'emprise et on
        // cadre sur la zone reellement visible (v2.12).
        const em = emprise(a.ring);
        centrerSurZoneVisible(em.centre, zoomPour(2 * em.rx, 2 * em.ry, em.centre.lat));
      };
      // Le crayon devient le bouton d'ENREGISTREMENT pendant l'edition : c'est
      // le meme endroit, donc le geste de retour est la ou on l'a laisse.
      node.querySelector('.agn-edit').onclick = () =>
        (edition && edition.agglo === a) ? sortirEdition(true) : entrerEdition(a);
      // Marque le polygone que le guidage doit designer : celui qui sort du
      // pre-trace et n'a pas encore ete repris a la main.
      if (a.aAffiner) node.classList.add('agn-a-affiner');
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
    // ⚠️⚠️ UNE COMMUNE A SOUVENT PLUSIEURS AGGLOMERATIONS (bourg + hameaux +
    // villages rattaches). Apres le premier polygone, rien ne le disait : le
    // geste suivant visible etait « Terminer et replier », ce qui invite a
    // s'arreter — et **une agglomeration oubliee fausse toute l'analyse**, tous
    // ses segments etant alors juges hors agglomeration. D'ou ce bouton, juste
    // sous la liste, et l'avertissement ci-dessous (auteur, 27/07).
    const suite = el('<button class="agn-btn" id="agn-tracer-encore">' +
      '＋ Ajouter une autre agglomération</button>');
    suite.title = 'Bourg, hameau, village rattaché : chaque agglomération de la commune ' +
      'a son propre polygone. La carte se cadrera sur le prochain secteur d\'entrées à couvrir.';
    suite.onclick = tracerAgglo;
    ui.listeAgglos.appendChild(suite);
    ui.listeAgglos.appendChild(avertissementExhaustivite());
    // ⚠️ Point d'accroche du guidage : `renderAgglos` est rappelee a CHAQUE
    // changement d'etat (contours charges, commune choisie, polygone ajoute ou
    // retire). Le brancher ici evite d'oublier un chemin.
    majGuidage();
  }

  /**
   * Dit ce qu'il reste a couvrir AVANT de laisser refermer le volet.
   *
   * ⚠️ On ne se contente pas d'un conseil general : quand les panneaux ont ete
   * releves, on SAIT quels secteurs d'entrees ne sont dans aucun polygone. Un
   * chiffre precis vaut mieux qu'une recommandation.
   */
  function avertissementExhaustivite() {
    const restants = secteursCourants.filter(x => x.g && x.g.centre && !secteurCouvert(x.g));
    if (restants.length) {
      const n = el('<div class="agn-avert-exh"></div>');
      n.innerHTML = '⚠️ <b>' + restants.length + ' secteur(s) d\'entrées</b> ne sont couverts par ' +
        'aucun polygone : ' +
        restants.slice(0, 4).map(x => esc(x.nom || (x.g.portes + ' entrée(s)'))).join(', ') +
        (restants.length > 4 ? '…' : '') +
        '<br>Trace-les avant de terminer — <b>une agglomération oubliée passe en hors ' +
        'agglomération</b>, et tous ses écarts seront faux.';
      return n;
    }
    const n = el('<div class="agn-avert-exh agn-avert-doux"></div>');
    // ⚠️ Une commune DECLAREE sans agglomeration n'a rien a tracer : lui reclamer
    // « toutes les agglomerations » est un contresens. On rappelle le choix fait.
    if (communeActive && sansAgglo[communeActive.code]) {
      n.innerHTML = '✔ <b>' + esc(communeActive.nom) + '</b> est déclarée <b>sans agglomération</b> : ' +
        'tous ses segments seront jugés hors agglomération. Décoche la case si ce n\'est plus vrai.';
      return n;
    }
    // ⚠️⚠️ LA SOURCE EST-ELLE MUETTE ICI ? Sans ce test, on PROPOSAIT le relevé
    // des panneaux alors que le bouton venait d'etre grisé faute de données —
    // exactement la faute corrigée ailleurs en 2.25.01 (ne jamais envoyer vers un
    // geste impossible). Mesuré sur Saint-Geniès-de-Comolas : 0 panneau.
    const sond = sondageCourant();
    const muette = !!(sond && sond.etat === 'aucun');
    n.innerHTML = secteursCourants.length
      ? '✔ Tous les secteurs d\'entrées relevés sont couverts. Vérifie tout de même les ' +
        'hameaux sans panneau avant de terminer.'
      : '⚠️ Assure-toi d\'avoir tracé <b>toutes</b> les agglomérations de la commune ' +
        '(bourg, hameaux, villages rattachés) : une agglomération oubliée passe en hors ' +
        'agglomération, et tous ses écarts seront faux.' +
        // ⚠️ Depuis la 2.25.01 le guidage ne renvoie plus vers les panneaux quand un
        // polygone existe deja. Le moyen de VERIFIER reste utile — mais il se
        // PROPOSE ici, il ne s'impose plus comme une etape a franchir.
        (muette ? '<br>Aucun panneau d\'agglomération n\'est disponible ici : ' +
                  '<b>le script ne peut pas vérifier à ta place</b>.'
                : releveFait ? ''
                             : '<br>Au besoin, <b>🪧 Panneaux d\'agglomération</b> les recense pour toi.');
    return n;
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
      // ⚠️ La cle reste, meme vide : elle dit « ici, plus rien n'est traite »,
      // que la fusion multi-onglets doit respecter (v2.26.04).
      if (!Object.keys(t).length) traites[insee] = {};
      saveTraites();
    }
    redrawEcarts(null);
    majCompteurTraites();
    majBoutonsGroupes();
    replierThematiquesFinies();
  }

  /**
   * Une thematique entierement traitee se replie toute seule (demande de
   * l'auteur, 26/07 : « quand une thematique d'ecarts est traitee, on replie la
   * section pour alleger l'affichage »). Vaut pour les trois onglets — segments,
   * adresses et POI —, puisque toutes leurs listes sont faites des memes groupes.
   *
   * ⚠️ On ne replie qu'au MOMENT ou la thematique se termine, pas a chaque
   * passage : sinon l'editeur ne pourrait plus la rouvrir (elle se refermerait
   * sous ses doigts). Le drapeau `dataset.fini` retient qu'on l'a deja fait.
   * ⚠️ Et un groupe VIDE n'est pas un groupe fini : `every` sur une liste vide
   * repond `true`, ce qui replierait une section qui n'a jamais rien eu.
   */
  function replierThematiquesFinies() {
    if (!ui.results) return;
    ui.results.querySelectorAll('.agn-grp').forEach(grp => {
      const membres = [...grp.querySelectorAll('.agn-item')]
        .map(n => findings[parseInt(n.dataset.idx, 10)]).filter(Boolean);
      const fini = membres.length > 0 && membres.every(f => f.traite);
      const n = grp.querySelector('.agn-grp-n');
      if (n) {
        n.textContent = fini ? '✓ ' + membres.length : String(membres.length);
        n.title = fini ? 'Thématique entièrement traitée' : '';
      }
      grp.classList.toggle('agn-fini', fini);
      if (fini && grp.dataset.fini !== '1') {
        grp.dataset.fini = '1';
        if (grp.classList.contains('agn-ouvert')) ouvrirGroupe(grp, false);
      } else if (!fini) {
        delete grp.dataset.fini;                 // decoche : la thematique reprend
      }
    });
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
    let ok = 0, segments = 0, bloques = 0, reprises = 0;
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
          reprises += (res.reprises || 0);
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
    majBandeauCorrection(ok, segments, echecs, bloques, unite, interrompu, critiques, reprises);
    // Demande de l'auteur : apres une conversion, c'est le POI qui doit etre
    // selectionne, pas le segment d'origine — on enchaine en general sur son
    // point d'entree.
    if (crees.length) {
      try { sdk.Editing.setSelection({ selection: { ids: crees.slice(), objectType: 'venue' } }); }
      catch (e) { log('sélection des POI créées impossible', e); }
      crees = [];
    }
  }

  function majBandeauCorrection(ok, segments, echecs, bloques, unite, interrompu, critiques, reprises) {
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
        ${reprises ? '<b>' + reprises + '</b> point(s) d\'entrée repris du numéro sur le POI. ' : ''}
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

  /**
   * SELECTION RAPIDE PAR DECLARATION DE ZONE (idee de Glenan56, 27/07).
   *
   * « Ça pourrait etre une idee pour completer Naming Auditor avec deux boutons
   * rapides : Selection en ville / Selection hors ville, et qui feraient
   * automatiquement le filtrage que fait Road Selector mais sans avoir a saisir
   * le nom de la ville qu'il connaitrait. »
   *
   * ⚠️⚠️ CE N'EST PAS L'ANALYSE, ET IL FAUT QUE CA SE VOIE. L'analyse lit TOUTE
   * la commune par l'API ; ici on ne peut selectionner que ce que WME a CHARGE,
   * c'est-a-dire LA VUE (lecon de la 2.27.00 : selectionner l'inexistant est
   * impossible, et le taire coute du travail). Le compte rendu dit donc
   * toujours sur quoi il a porte.
   *
   * ⚠️ `getAll()` rend encore les segments de l'ANCIENNE vue juste apres un saut
   * de carte : le filtre par emprise n'est pas cosmetique (meme piege que le
   * garde-fou territorial, v2.03).
   */
  const TITRE_SEL = {
    ville: 'Sélectionne, parmi les segments affichés, ceux qui portent la ville ' +
           'en nom principal — donc ceux qui se déclarent EN agglomération. ' +
           'Ne porte que sur ce qui est chargé à l\'écran.',
    horsVille: 'Sélectionne, parmi les segments affichés, ceux dont le nom principal ' +
           'ne porte AUCUNE ville — donc ceux qui se déclarent HORS agglomération. ' +
           'Ne porte que sur ce qui est chargé à l\'écran.'
  };

  /**
   * Les deux boutons n'ont besoin QUE d'une commune : ni polygone, ni analyse
   * prealable. C'est tout leur interet — cette loupe sert AVANT le zonage, pour
   * voir d'un coup d'oeil ce que les segments declarent.
   * ⚠️ Un bouton ferme DIT pourquoi (regle d'ergonomie du 27/07) : sinon il se
   * lit comme une panne.
   */
  function majBoutonsZone() {
    const boutons = [[ui.btnSelVille, 'ville'], [ui.btnSelHors, 'horsVille']];
    const enFr = (() => { try { return enFrance(); } catch (e) { return true; } })();
    const dispo = !!communeActive && enFr && !edition;
    boutons.forEach(([b, zone]) => {
      if (!b) return;
      b.disabled = !dispo;
      b.title = !communeActive
        ? 'Choisis d\'abord une commune : le script a besoin de son nom et de son contour.'
        : !enFr ? 'Hors de France : les règles de ce script ne s\'y appliquent pas.'
        : edition ? 'Édition d\'un tracé en cours (💾 pour enregistrer, Échap pour annuler).'
        : TITRE_SEL[zone];
    });
    if (ui.zoneInfo && !dispo) ui.zoneInfo.innerHTML = '';
  }

  /**
   * ⚠️⚠️ CE BOUTON NE TOUCHE JAMAIS A LA CARTE — arbitrage de l'auteur (27/07).
   *
   * Une version precedente reculait la vue au zoom 16 avant de selectionner,
   * pour en prendre seize fois plus. Essayee, puis RETIREE : « Reviens en
   * arriere. Je regrette. On touche plus au zoom en cliquant sur les boutons.
   * Juste on informe qu'il peut manquer des segments. »
   *
   * ⭐ La lecon vaut au-dela de ce bouton : une aide qui deplace le travail de
   * l'editeur sans qu'il l'ait demande n'est pas une aide. On l'INFORME, il
   * decide. C'est la meme regle que « on avertit la ou l'editeur DECIDE, pas en
   * le renvoyant en arriere » (v2.25.01).
   */
  function selectionnerParZone(zone) {
    if (!communeActive) return;
    let ext; try { ext = sdk.Map.getMapExtent(); } catch (e) { ext = null; }
    // ⚠️ Liste d'agglos VIDE a dessein : ici on ne juge pas la zone reelle, on
    // ne fait que verifier l'appartenance a la COMMUNE. Passer les polygones
    // ferait calculer un `partAgglo` dont personne ne se sert, sur chaque
    // segment de la vue.
    const retenus = [], horsCommune = [];
    let vus = 0;
    for (const s of sdk.DataModel.Segments.getAll()) {
      const co = s.geometry && s.geometry.coordinates;
      if (!co || !co.length) continue;
      if (ext && ext.length === 4) {
        const p = co[Math.floor(co.length / 2)];
        if (p[0] < ext[0] || p[0] > ext[2] || p[1] < ext[1] || p[1] > ext[3]) continue;
      }
      vus++;
      let nam; try { nam = readNaming(s); } catch (e) { nam = null; }
      if (!nam) continue;
      if (declarationDeZone(nam, communeActive.nom) !== zone) continue;
      // La commune d'a cote n'est pas notre chantier : un segment « hors ville »
      // de la voisine n'apprend rien sur celle qu'on traite.
      const loc = localiser(co, []);
      if (loc.partCommune < 1 - options.seuil) { horsCommune.push(s.id); continue; }
      retenus.push(s.id);
    }
    try {
      if (retenus.length) sdk.Editing.setSelection({ selection: { ids: retenus, objectType: 'segment' } });
      else sdk.Editing.setSelection({ selection: null });
    } catch (e) { log('sélection par zone impossible', e); }
    direSelectionZone(zone, retenus.length, vus, horsCommune.length);
  }

  /**
   * ⭐ ZERO EST UN RESULTAT, et « seulement ce qui est a l'ecran » aussi.
   * Sans ce compte rendu, une selection vide se lit « le bouton est casse », et
   * une selection partielle se lit « voila toute la commune » — ce qui serait
   * faux, et couterait exactement le genre de travail que la 2.27.00 a rendu.
   */
  function direSelectionZone(zone, n, vus, horsCommune) {
    if (!ui.zoneInfo) return;
    const quoi = zone === 'ville' ? 'avec la ville en principal'
                                  : 'sans ville en principal';
    let t;
    if (!vus) t = '⚠ aucun segment chargé : déplace ou dézoome la carte.';
    else if (!n) t = 'Aucun segment ' + quoi + ' dans ' + communeActive.nom +
                     ', sur les ' + vus + ' de la vue.';
    else t = '<b>' + n + '</b> segment(s) ' + quoi + ', sur les ' + vus + ' de la vue' +
             (horsCommune ? ' · ' + horsCommune + ' écarté(s), hors de la commune' : '') + '.';
    // ⭐ « Juste on informe qu'il peut manquer des segments » (l'auteur). On ne
    // touche pas a la carte : on dit ce qu'on n'a PAS pu voir, et l'editeur
    // decide. ⚠️ Ce n'est pas une note en fin de phrase : c'est l'avertissement
    // qui evite de croire qu'on a fait le tour de la commune.
    ui.zoneInfo.innerHTML = t +
      ' <span class="agn-zone-manque">⚠️ Il en manque probablement.</span> ' +
      '<span class="agn-note">WME ne descend les segments que par vue, et lâche ceux ' +
      'qui en sortent : la sélection ne peut porter que sur ce qui est affiché. Un zoom ' +
      'plus large (jusqu\'à ' + ZOOM_BALAYAGE + ', où WME charge encore tout) en prend ' +
      'davantage ; au-delà, déplace la carte et reclique — secteur par secteur.</span>';
  }

  /** Jeton de generation : voir `allerA`. */
  let selGen = 0;

  /**
   * ⭐ « PAS TOUT » EST UN RESULTAT, AU MEME TITRE QUE ZERO.
   *
   * ⚠️⚠️ Signale par Glenan56 (27/07) : le script affichait le bon nombre de
   * segments (il vient de l'analyse) puis en selectionnait une PARTIE, sans
   * rien dire. L'editeur corrigeait donc la moitie d'une Dxxx en croyant
   * l'avoir traitee en entier — le silence coutait du travail, pas du confort.
   *
   * Le constat ne s'affiche QUE s'il manque quelque chose : afficher « 8 / 8 »
   * a chaque clic ferait un bruit de fond dont on ne verrait plus l'exception.
   */
  function direSelection(n, total) {
    if (!ui.selinfo) return;
    if (!total || n >= total) { ui.selinfo.textContent = ''; ui.selinfo.title = ''; return; }
    ui.selinfo.textContent = '⚠ ' + n + ' / ' + total + ' sélectionné' + (n > 1 ? 's' : '');
    ui.selinfo.title = 'WME ne descend que les segments présents dans la vue : ceux restés ' +
      'dehors ne peuvent pas être sélectionnés. Dézoome d\'un cran, puis reclique sur cette ligne.';
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
    // ⚠️ Tout changement de report annule les tentatives du precedent : sans ce
    // jeton, un `setInterval` encore en vol REPOSAIT la selection de l'ancien
    // report par-dessus le nouveau, plusieurs secondes apres le clic.
    const gen = ++selGen;
    if (f.poi || (f.adresse && f.sousType === 'poi')) {
      direSelection(0, 0);
      try { sdk.Editing.setSelection({ selection: { ids: [f.venueId], objectType: 'venue' } }); }
      catch (e) { log('sélection du POI impossible', e); }
      redrawEcarts(idx);
      return;
    }
    // On ne peut selectionner que ce qui est CHARGE dans le modele : apres un
    // deplacement, les troncons eloignes n'arrivent qu'au chargement suivant.
    // D'ou plusieurs tentatives, sur les seuls segments reellement presents.
    const attendus = (f.segIds || []).length;
    const selectionner = () => {
      const dispo = (f.segIds || []).filter(id => {
        try { return !!sdk.DataModel.Segments.getById({ segmentId: id }); } catch (e) { return false; }
      });
      direSelection(dispo.length, attendus);
      if (!dispo.length) return false;
      try { sdk.Editing.setSelection({ selection: { ids: dispo, objectType: 'segment' } }); }
      catch (e) { log('sélection impossible', e); }
      return dispo.length === attendus;
    };
    if (!selectionner()) {
      let n = 0;
      const t = setInterval(() => {
        if (gen !== selGen) { clearInterval(t); return; }
        if (selectionner() || ++n > 9) clearInterval(t);
      }, 600);
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
  /**
   * OU poser la carte pour qu'un report soit ENTIEREMENT selectionnable.
   *
   * ⚠️⚠️ RETOUR TERRAIN Glenan56 (27/07) : « le script, la premiere fois, zappe
   * pratiquement toujours la selection de l'ensemble des segments » d'une Dxxx
   * hors ville ; « en deplaçant la carte manuellement pour le verifier, la
   * deuxieme fois il selectionne bien toute la Dxxx ». Il avait mis le doigt
   * sur la cause exacte : « le zoom etait un peu trop fort suite a la demande
   * de selection ».
   *
   * ⭐ ON NE PEUT SELECTIONNER QUE CE QUE WME A CHARGE, ET WME NE CHARGE QUE LA
   * VUE. Or le cadrage se posait sur le TRONÇON LE PLUS LONG des qu'un report
   * etait eparpille (> 1 km) : les autres tronçons restaient hors ecran, donc
   * jamais charges — et les six tentatives de selection qui suivaient ne
   * pouvaient rien y faire, elles reguettaient un modele qui n'allait pas se
   * remplir. Le COMPTE, lui, etait juste : il vient de l'analyse, pas du
   * modele. D'ou le symptome exact qu'il decrit — bon compte, mauvaise
   * selection.
   *
   * ⇒ On cadre desormais l'emprise TOTALE, quitte a etre large : une selection
   * complete vaut mieux qu'un gros plan sur un tiers du report. Le repli sur le
   * tronçon le plus long ne sert plus qu'au cas ou l'emprise ne tient meme pas
   * au zoom de chargement — la, AUCUN cadrage ne peut tout rendre selectionnable,
   * et `tout: false` le dit au lieu de le taire.
   *
   * PURE : ne lit ni le SDK ni le DOM. `vue` = { largeur, hauteur, zoomNiveau }.
   */
  function cadrageDeReport(f, vue) {
    const geoms = (f.geoms || [f.geom]).filter(g => g && g.coordinates && g.coordinates.length);
    // Un report d'ADRESSE se regarde de pres : sous le zoom 18, WME n'affiche
    // meme pas les numeros dont on parle (et ne les charge pas non plus).
    const zFinal = z => (f.adresse ? Math.max(z, ZOOM_NUMEROS) : z);
    if (!geoms.length) return f.centre ? { centre: f.centre, zoom: null, tout: true } : null;
    const tous = [];
    geoms.forEach(g => { tous.push.apply(tous, sommetsDe(g)); });
    if (!tous.length) return f.centre ? { centre: f.centre, zoom: null, tout: true } : null;

    // Plusieurs segments a selectionner ⇒ on serre le zoom vers le bas.
    const plusieurs = ((f.segIds && f.segIds.length) || 1) > 1 || geoms.length > 1;
    const v = { largeur: vue.largeur, hauteur: vue.hauteur,
                zoomNiveau: vue.zoomNiveau, serrer: plusieurs };
    const e = emprise(tous);
    const zTotal = zoomPour(2 * e.rx, 2 * e.ry, e.centre.lat, v);
    if (zTotal >= ZOOM_CHARGEMENT) return { centre: e.centre, zoom: zFinal(zTotal), tout: true };

    // Au-dela, WME ne descendrait plus rien : on remonte au zoom de chargement
    // et on assume de ne pas tout voir d'un coup.
    if (geoms.length < 2) return { centre: e.centre, zoom: zFinal(ZOOM_CHARGEMENT), tout: false };
    let meilleur = geoms[0], long = -1;
    geoms.forEach(g => {
      let d = 0;
      for (let i = 1; i < g.coordinates.length; i++) d += longueur(g.coordinates[i - 1], g.coordinates[i]);
      if (d > long) { long = d; meilleur = g; }
    });
    const em = emprise(sommetsDe(meilleur));
    const zm = Math.max(ZOOM_CHARGEMENT, zoomPour(2 * em.rx, 2 * em.ry, em.centre.lat, v));
    return { centre: em.centre, zoom: zFinal(zm), tout: false };
  }

  /**
   * La place dont on dispose reellement, en pixels, plus le plafond de zoom.
   * ⚠️ NE PAS appeler ça `vueCourante` : ce nom porte deja l'onglet affiche
   * (segments / adresses / poi), et l'ecraser tuait tout le rendu.
   */
  function placeDisponible() {
    const zv = zoneVisible();
    return { largeur: Math.max(80, zv.droite - zv.gauche),
             hauteur: Math.max(80, zv.bas - zv.haut),
             zoomNiveau: options.zoomNiveau };
  }

  function cadrerSur(f, forcerZoom) {
    const plan = cadrageDeReport(f, placeDisponible());
    if (!plan) return;
    // ⚠️ Le zoom est passe a `centrerSurZoneVisible` plutot qu'applique apres :
    // le decalage depend de l'echelle d'ARRIVEE, et zoomer ensuite le rendrait
    // faux (l'objet reviendrait sous une fenetre).
    centrerSurZoneVisible(plan.centre, (options.zoomClic || forcerZoom) ? plan.zoom : null);
  }

  /**
   * ⚠️⚠️ ZOOM DE CHARGEMENT. Mesure deja au dossier du projet : WME ne descend
   * AUCUN segment sous le zoom 14 (complet a 16). Cadrer plus large que ca, ce
   * n'est pas « voir de plus loin », c'est regarder une carte VIDE — et une
   * carte vide ne se selectionne pas.
   */
  const ZOOM_CHARGEMENT = 14;
  const ZOOM_PLANCHER = 12;

  /**
   * Zoom adapte a l'emprise a montrer, plutot qu'une valeur fixe : un tronçon
   * de dix metres et une departementale de trois kilometres n'appellent pas le
   * meme cadrage. `vue.zoomNiveau` sert de plafond, ZOOM_PLANCHER de limite
   * basse. Marge volontairement faible.
   *
   * ⚠️⚠️ `vue.largeur` / `vue.hauteur` portent la ZONE VISIBLE, pas la fenetre
   * du navigateur. Le centrage decale ensuite la carte pour sortir la cible de
   * sous nos fenetres (v2.12) : calculer le zoom sur `window.innerWidth`
   * revenait a promettre une place qu'on reprend juste apres, et une part du
   * report finissait DERRIERE le volet — donc hors de la vue, donc jamais
   * chargee par WME, donc impossible a selectionner.
   *
   * ⚠️ L'arrondi n'est pas le meme selon l'enjeu. Au PLUS PROCHE pour un
   * segment seul : arrondir vers le bas coutait un niveau entier, soit un
   * facteur deux de trop. Vers le BAS (`vue.serrer`) des qu'il y a plusieurs
   * segments a selectionner — un demi-niveau de trop suffit a laisser un
   * tronçon dehors, et un tronçon dehors est un tronçon perdu.
   */
  function zoomPour(dLon, dLat, lat, vue) {
    // ⚠️ `vue` est omis par les cadrages qui ne selectionnent rien (contour de
    // commune, secteur d'entrees, polygone d'agglo) : ils gardent l'arrondi au
    // plus proche. On leur donne quand meme la ZONE VISIBLE plutot que la
    // fenetre entiere — eux aussi finissaient a moitie sous le volet.
    if (!vue) vue = placeDisponible();
    const marge = 1.12;
    const cos = Math.max(0.15, Math.cos(lat * Math.PI / 180));
    const zLon = Math.log2(vue.largeur * 360 / (256 * Math.max(dLon, 1e-6) * marge));
    const zLat = Math.log2(vue.hauteur * 360 * cos / (256 * Math.max(dLat, 1e-6) * marge));
    const brut = Math.min(zLon, zLat);
    return Math.max(ZOOM_PLANCHER,
      Math.min(vue.zoomNiveau, vue.serrer ? Math.floor(brut) : Math.round(brut)));
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

  /**
   * ⚠️⚠️ UNE COMMUNE VOISINE N'EST PAS UN POLYGONE MANQUANT (auteur, 27/07).
   * Vecu sur Saint-Geniès-de-Comolas : « Montfaucon » (7 segments) et
   * « Saint-Laurent-des-Arbres » (1) declenchaient « Il manque au moins un
   * polygone » — donc « trace le polygone de la commune d'a cote », ce qui n'a
   * aucun sens quand on audite Saint-Geniès. Pire, l'alerte affirmait que « les
   * ecarts les concernant sont faux » alors que la correction proposee est JUSTE
   * (elle retablit la commune d'ici). ⇒ On separe les deux populations : le
   * garde-fou ne parle plus que des villes INCONNUES au repertoire INSEE
   * (hameaux, villages rattaches), qui sont les seules a pouvoir reclamer un
   * polygone.
   */
  function villesSansPolygone() {
    if (!lastScan || !lastScan.zones || !lastScan.zones.villes) return [];
    const bas = PART_MIN_EN_POLYGONE;
    const codeActif = communeActive && communeActive.code;
    return [...lastScan.zones.villes.entries()]
      .map(([nom, v]) => ({ nom, total: v.total, dans: v.dansPolygone,
                            voisine: !!communeVoisineDeNom(nom, communes, codeActif),
                            degre: v.dansPolygone === 0 ? 'aucun'
                              : (v.dansPolygone / v.total < bas ? 'presque' : null) }))
      .filter(v => v.degre)
      .sort((a, b) => b.total - a.total);
  }

  /** Celles qui reclament VRAIMENT un polygone : les villes qui ne sont pas des communes. */
  function villesPolygoneManquant() { return villesSansPolygone().filter(v => !v.voisine); }

  /** Celles qui sont des communes voisines : une adresse a corriger, pas un zonage. */
  function villesCommuneVoisine() { return villesSansPolygone().filter(v => v.voisine); }

  /**
   * Des segments d'ici portent le nom d'une commune voisine. Ton NEUTRE : c'est
   * un constat qui renvoie a la liste des ecarts, pas une alerte qui reclame un
   * geste de zonage. « Je suis sur Saint-Geniès, j'ai pas envie de tracer les
   * polygones des autres communes » (auteur, 27/07).
   */
  function bandeauCommunesVoisines() {
    const voisines = villesCommuneVoisine();
    if (!voisines.length) return '';
    const total = voisines.reduce((n, v) => n + v.total, 0);
    const liste = voisines.map(v => '<b>' + esc(v.nom) + '</b> (' + v.total + ')').join(', ');
    return '<div class="agn-alerte-bloc agn-info-bloc">ℹ️ <b>' + total + ' segment(s) portent le nom ' +
      'd\'une commune voisine</b> : ' + liste + '.<br>' +
      'Ils sont pourtant dans ' + esc(communeActive ? communeActive.nom : 'cette commune') +
      ' : c\'est leur <b>adresse</b> qui est fausse, pas le zonage. ' +
      '<b>Rien à tracer</b> — les corrections proposées rétablissent déjà ' +
      esc(communeActive ? communeActive.nom : 'la commune') +
      ', et ces segments forment leurs propres reports dans la liste.</div>';
  }

  function bandeauVillesSansPolygone() {
    // ⚠️ Les communes voisines sont SORTIES d'ici : elles ont leur propre bandeau,
    // qui ne reclame aucun trace (auteur, 27/07).
    const manquantes = villesPolygoneManquant();
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
          z.limComRien ? ' · <span title="À cheval sur la limite communale, mais sans aucun nom ni ville — ni en principal, ni en alternatif. Les couper donnerait deux moitiés identiques à l\'originale : il n\'y a rien à corriger.">' +
            z.limComRien + ' à cheval sans rien à couper</span>' : ''}${
          z.limitrophe ? ' · ' + z.limitrophe + ' débordent légèrement' : ''}${
          z.cartouche ? ' · ' + z.cartouche + ' cartouche(s) a poser' : ''}${
          z.special ? ' · ' + z.special + ' voie(s) a règle propre' : ''}${
          z.giratoire ? ' · ' + z.giratoire + ' giratoire(s)' : ''}.<br>
        Ignores : ${s.skipped.horsCommune} hors commune, ${s.skipped.sansAdresse} sans adressage, ${s.skipped.horsRegle} règles propres.
      </div>${bandeauVillesSansPolygone()}${bandeauCommunesVoisines()}${bandeauInterrompu()}${bandeauSource()}`
        : `<div class="agn-stat">
        ${s.adr ? '<b>' + s.adr.hnLus + '</b> numéro(s) lu(s) a ' + esc(communeActive.nom) +
            (options.controles.hnHorsAgglo
              ? ', dont <b>' + s.adr.hnHorsAgglo + '</b> hors agglomération.'
              : '<span title="Ils ont été lus pour repérer les POI résidentiels qui font doublon avec un numéro déjà posé.">' +
                ' (contrôle « numéros hors agglomération » décoché).</span>') +
            // ⚠️ Le resultat de la MESURE se lit ici, et il est nomme comme tel.
            // On donne les DEUX chiffres : le total ne dit rien tout seul, c'est
            // la part qui garde un nom de rue en alternatif qui rend la
            // discussion possible (adresse recuperable ou non).
            // ⚠️⚠️ UNE MESURE DIT SON RESULTAT MEME QUAND IL EST NUL. Un « 0 »
            // noyé dans une phrase se lit comme « le contrôle n'a pas tourné » —
            // l'auteur l'a vécu le 27/07 (« je coche, je relance, rien ne
            // change »). Zéro est un RESULTAT : on l'annonce comme tel.
            (options.controles.hnSurRoute
              ? '<br><span title="Mesure demandée par un éditeur, sans valeur normative : aucune règle française n\'interdit ce cas à ce jour.">📏 Mesure' +
                (s.adr.hnSurRoute
                  ? ' : <b>' + s.adr.hnSurRoute + '</b> numéro(s) en agglomération sur une voie ' +
                    'dont le nom principal est un numéro de route, dont <b>' +
                    s.adr.hnSurRouteAvecAlt + '</b> avec un nom de rue en alternatif.'
                  : ' : <b>aucun</b> numéro en agglomération sur une voie nommée « Dxxx » ' +
                    'ici — le contrôle a bien tourné, cette commune n\'a pas le cas.') +
                '</span>'
              : '') + '<br><b>' +
            s.adr.poiLus + '</b> POI résidentiel(s), dont <b>' + s.adr.poiAgglo + '</b> en agglomération' +
            // v2.19 — DIRE ce que les nuances ont tranché, et surtout ce
            // qu'elles ont ÉCARTÉ : un compte qui baisse sans explication se
            // lit comme un audit qui ne voit plus rien.
            (s.adr.poiAggloEcart
              ? ' · <b>' + s.adr.poiAggloEcart + '</b> <span title="Le numéro est déjà posé sur la voie, ou l\'entrée donne sur la voie de l\'adresse elle-même : le POI n\'exprime aucun décalage.">sans justification</span>'
              : '') +
            (s.adr.poiAggloConforme
              ? ' · <span title="Leur point d\'accès donne sur une AUTRE voie que leur adresse : c\'est exactement ce qu\'un POI résidentiel sert à dire. Ils ne sont pas signalés.">' +
                s.adr.poiAggloConforme + ' à leur place (accès sur une autre voie)</span>'
              : '') +
            (s.adr.poiAggloPhoto
              ? ' · <span title="Ces POI portent une photo : quelqu\'un est venu sur place les poser. Ils restent signalés, mais en fin de liste.">' +
                s.adr.poiAggloPhoto + ' avec photo</span>'
              : '') + '.' +
            (s.adr.hnErreur ? '<br><span class="agn-alerte">Lecture des numéros : ' + esc(s.adr.hnErreur) + '</span>' : '') +
            (s.adr.hnHorsAgglo
              ? '<br><span style="opacity:.8">La conversion cadre elle-même sur les numéros : ' +
                'WME ne les charge qu\'à partir du zoom ' + ZOOM_NUMEROS + '.</span>' : '')
          : 'Analyse non lancee.'}
      </div>${bandeauVillesSansPolygone()}${bandeauCommunesVoisines()}${bandeauInterrompu()}${bandeauSource()}`;
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
        <span id="agn-selinfo" class="agn-selinfo"></span>
        <span id="agn-traites" class="agn-traites"></span>
        <button class="agn-lien" id="agn-tout" title="Déplie ou replie tous les groupes de résultats">tout déplier</button></div>`);
    ui.results.appendChild(nav);
    ui.compteur = nav.querySelector('#agn-compteur');
    ui.selinfo = nav.querySelector('#agn-selinfo');
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
    // ⚠️ `poiAdresse` en est exclue pour la meme raison depuis la v2.19 : une
    // adresse PROPOSEE se regarde une par une, sur la carte. Appliquer vingt
    // propositions d'un clic, c'est se priver du seul controle qui reste.
    // Convertir un numero en POI residentiel deplace la carte, cree un objet et
    // s'enchaine en general sur son point d'entree — ca se fait un par un, en
    // regardant. Le nommage des segments, lui, garde son bouton de groupe.
    //
    // Regroupement par thematique : une famille = une couleur sur la carte,
    // donc la liste et la carte se lisent avec la meme cle. Replie par defaut :
    // sur plusieurs centaines d'ecarts, la liste a plat est illisible.
    const parFamille = new Map();
    liste.slice()
      // ⚠️ Le tri d'AFFICHAGE a le dernier mot : trier les reports a la
      // construction ne servirait a rien s'il les reclassait ensuite. Les RPP
      // photographies passent donc en fin de leur thematique ici aussi (v2.19).
      .sort((a, b) => a.cas.localeCompare(b.cas) ||
        (a.rppPhoto ? 1 : 0) - (b.rppPhoto ? 1 : 0) ||
        a.libelle.localeCompare(b.libelle))
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
            ${_ft() && _fv() && cle !== 'adresse' && cle !== 'rpp' && cle !== 'poiAdresse' &&
              membres.some(planDeCorrection)
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
            ${f.adresse && f.sousType === 'hn' && !f.rueCible && !f.mesure
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
      // ⚠️ L'onglet POI s'ouvre DEPLIE (demande de l'auteur, 26/07). Les autres
      // restent replies : ils comptent des centaines d'ecarts, et une liste a
      // plat y est illisible — l'audit des POI, lui, en aligne une poignee.
      if (vueCourante === 'poi') ouvrirGroupe(grp, true);
    }
    // Les coches restaurees d'une session precedente comptent : une thematique
    // deja finie doit s'afficher comme telle des le rendu.
    replierThematiquesFinies();
    // Une analyse a tourne : plus rien a guider (ou l'etape suivante s'affiche).
    majGuidage();
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
    // ⚠️ APRES `buildOverlay` : le rafraichissement declenche par un autre onglet
    // touche a l'interface, qui doit donc exister.
    ecouterAutresOnglets();
    installerFab();
    ensureLayers();
    installerInfobulle();
    surveillerErreursEnregistrement();

    // Le panneau lateral porte les REGLAGES ; l'overlay porte le travail.
    const { tabLabel, tabPane } = await sdk.Sidebar.registerScriptTab();
    tabLabel.textContent = '🏷️';
    tabLabel.title = SCRIPT_NAME;
    tabLabel.style.fontSize = '15px';
    buildReglages(tabPane);
    // ⚠️ APRES `buildReglages` (la destination doit exister) et APRES
    // `buildOverlay` (les boutons sont deja branches) : on ne fait que DEPLACER
    // le noeud, les gestionnaires d'evenements le suivent.
    rangerChargementContours();

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
      } });
    } catch (e) { log('abonnement au déplacement impossible', e); }

    // ⚠️ LES POIGNEES ONT LEUR PROPRE ABONNEMENT, SUR LES DEUX EVENEMENTS.
    // Elles etaient posees dans le gestionnaire ci-dessus, donc replacees
    // seulement a l'ARRET de la carte : pendant un glissement elles restaient
    // figees, puis sautaient. Correctif repris de WCT (v1.00.05), ou le meme
    // defaut a ete traite.
    // ⚠️ Ne pas en conclure que `wme-map-move-end` ne serait pas emis : c'est
    // FAUX, il l'est bien (mesure en live le 01/08, 2 fois sur 2). La cause
    // exacte du figement n'a PAS ete etablie — c'est l'ajout de `wme-map-move`
    // qui regle le symptome. Si le sujet revient, reprendre le diagnostic a zero.
    // ⚠️ Surtout PAS dans le gestionnaire debounce : celui-ci differe de 700 ms
    // et emporterait un rechargement de departement a chaque frame de glissement.
    // `dessinerPoignees` sort en un test quand aucune edition n'est en cours :
    // l'abonnement ne coute rien le reste du temps.
    ['wme-map-move', 'wme-map-move-end'].forEach(ev => {
      try { sdk.Events.on({ eventName: ev, eventHandler: () => dessinerPoignees() }); }
      catch (e) { log('abonnement ' + ev + ' impossible', e); }
    });

    // Au demarrage aussi : l'editeur arrive souvent deja pose sur sa zone.
    autoChargerDepartement().then(rafraichirCommunesDeLaVue);

    // Dictionnaire de redaction : chargement en tache de fond, sans bloquer.
    // ⚠️ On ne le telecharge QUE si le controle est coche — deux appels reseau
    // pour une fonction que l'editeur a decochee seraient du gaspillage, et
    // c'est exactement le cas de celui qui a deja WME Check Road Name.
    if (options.controles.redactionDico) {
      chargerDictionnaireFr().then(majEtatDico);
    } else {
      dico.etat = 'inactif';
      majEtatDico();
    }

    log('v' + VERSION + ' pret — fenêtre flottante — ' +
      (communes.length ? communes.length + ' commune(s)' : 'aucun contour'));
  }

  init().catch(e => console.error('[' + SCRIPT_NAME + '] echec du demarrage :', e));
})();
