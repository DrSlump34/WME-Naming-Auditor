/**
 * REGENERE la table `COMUNI_DOUBLE_NOM` du userscript, et CONTROLE la source
 * de contours contre la liste ISTAT qui fait foi.
 *
 * ⚡ POURQUOI CE SCRIPT EXISTE. openpolis nomme 124 comuni dans les DEUX
 * langues (« Bolzano/Bozen »), WME n'en porte qu'UNE (« Bolzano »). Le nom du
 * contour etant la ville que WNA PROPOSE, il faut le ramener au nom italien.
 * 116 se reconnaissent a leur barre oblique ; les 8 autres emploient un TIRET,
 * que 60 comuni portent legitimement (« Pont-Saint-Martin ») — elles doivent
 * donc etre nommees. C'est cette liste de huit que ce script recalcule.
 *
 * ⚠️ NE RIEN RECOPIER A LA MAIN : « Savogna d'Isonzo-Sovodnje ob Soči » ne se
 * retape pas sans faute. La table du userscript se remplace par la sortie de
 * ce script, telle quelle.
 *
 * ⏳ A RELANCER quand le CC italien annonce une liste ISTAT plus recente, ou
 * quand openpolis renomme quelque chose. Il dit alors DEUX choses :
 *   1. les huit noms composes au tiret (la table a coller) ;
 *   2. l'ecart entre les deux sources — c'est le controle qui compte, celui qui
 *      a montre le 09/09 qu'openpolis avait DEUX FUSIONS de retard.
 *
 * Usage : node tools/comuni-double-nom.js [--csv <chemin>] [--cache <dossier>]
 *
 *   --csv    liste ISTAT au format CSV (defaut : telechargee depuis le Sheets
 *            partage par Silvio le 09/09, colonnes Regione / Unita / Sigla /
 *            Denominazione in italiano / Denominazione altra lingua)
 *   --cache  dossier ou garder les 110 GeoJSON de province (~30 Mo) pour ne
 *            pas les retelecharger a chaque passage
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SHEETS_CSV = 'https://docs.google.com/spreadsheets/d/' +
  '1Lf7gwU6Tpw_H_iQOSOBb7NSwdKg7g7ADGP2F46oBpWc/export?format=csv&gid=0';
const OPENPOLIS = 'https://raw.githubusercontent.com/openpolis/geojson-italy/master/geojson/';

const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const CACHE = opt('--cache') || path.join(require('os').tmpdir(), 'wna-openpolis');

async function texte(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ' -> HTTP ' + r.status);
  return r.text();
}

/** Un CSV a guillemets — la liste ISTAT en contient (« Savogna d'Isonzo »). */
function ligneCsv(l) {
  const o = []; let c = '', q = false;
  for (const ch of l) {
    if (ch === '"') { q = !q; continue; }
    if (ch === ',' && !q) { o.push(c); c = ''; } else c += ch;
  }
  o.push(c); return o;
}

/**
 * Les codes de province, releves dans le userscript lui-meme : c'est LA liste
 * que le script propose a l'editeur, et donc exactement ce qu'il telechargera.
 * La relever ailleurs mesurerait autre chose que ce que WNA fait.
 */
function provincesDuScript() {
  const src = fs.readFileSync('WME-Naming-Auditor.user.js', 'utf8');
  const bloc = src.split('const PROVINCES_IT = [')[1].split('];')[0];
  return [...bloc.matchAll(/\{"code":"(\d+)"/g)].map(m => m[1]);
}

async function province(code) {
  const f = path.join(CACHE, code + '.geojson');
  if (!fs.existsSync(f)) {
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(f, await texte(OPENPOLIS + 'limits_P_' + code + '_municipalities.geojson'));
  }
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

(async () => {
  const csv = opt('--csv') ? fs.readFileSync(opt('--csv'), 'utf8') : await texte(SHEETS_CSV);
  const istat = csv.split(/\r?\n/).slice(1).filter(l => l.trim()).map(ligneCsv);

  const codes = provincesDuScript();
  const servis = [];
  for (const c of codes) {
    const g = await province(c);
    if (!g.features) throw new Error('province ' + c + ' : aucun feature (fichier vide ?)');
    g.features.forEach(f => servis.push(f.properties.name));
  }
  const setServis = new Set(servis);

  // ── La table : un comune bilingue dont openpolis compose le nom au TIRET ────
  const tiret = istat.filter(r => r[4] && setServis.has(r[3] + '-' + r[4]));
  console.log('  const COMUNI_DOUBLE_NOM = {');
  tiret.forEach((r, i) => console.log('    ' + JSON.stringify(r[3] + '-' + r[4]) + ': ' +
    JSON.stringify(r[3]) + (i < tiret.length - 1 ? ',' : '')));
  console.log('  };');

  // ── Le controle : les deux sources decrivent-elles la meme Italie ? ─────────
  const norme = s => s.normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const idxServis = new Map();
  servis.forEach(n => {
    idxServis.set(norme(n), n);
    if (n.includes('/')) n.split('/').forEach(p => idxServis.set(norme(p), n));
  });
  tiret.forEach(r => idxServis.set(norme(r[3]), r[3] + '-' + r[4]));
  const idxIstat = new Map();
  istat.forEach(r => { idxIstat.set(norme(r[3]), r); if (r[4]) idxIstat.set(norme(r[4]), r); });
  tiret.forEach(r => idxIstat.set(norme(r[3] + '-' + r[4]), r));

  const absents = istat.filter(r => !idxServis.has(norme(r[3])));
  const enTrop = servis.filter(n => !idxIstat.has(norme(n)) &&
    !(n.includes('/') && n.split('/').some(p => idxIstat.has(norme(p)))));

  console.log('\n── controle ' + new Date().toISOString().slice(0, 10) + ' ──');
  console.log('comuni ISTAT          : ' + istat.length);
  console.log('comuni openpolis      : ' + servis.length);
  console.log('a double nom (ISTAT)  : ' + istat.filter(r => r[4]).length +
              '  dont ' + tiret.length + ' composes au tiret');
  console.log('\ndans ISTAT, absents des contours : ' + absents.length);
  absents.forEach(r => console.log('   ' + r[2] + '  ' + r[3]));
  console.log('dans les contours, absents d ISTAT : ' + enTrop.length);
  enTrop.forEach(n => console.log('   ' + n));
  if (absents.length || enTrop.length) {
    console.log('\n⚠️ Un ecart n\'est pas forcement une panne : openpolis suit les fusions de');
    console.log('   comuni avec du retard. Le dire dans ANALYSE-ITALIE.md, et n\'ajouter a la');
    console.log('   table que ce qui est un DOUBLE NOM.');
  }
})().catch(e => { console.error(e.message); process.exit(1); });
