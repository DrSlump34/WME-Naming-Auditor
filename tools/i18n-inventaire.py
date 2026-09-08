"""Inventaire des chaines VISIBLES du userscript, en vue de l'internationalisation.

⭐ REUTILISE le tri deja eprouve par les outils d'accentuation (v2.05) plutot
que d'en refaire un : `RE_TECHNIQUE` sait deja ecarter les identifiants nus,
les URL, les selecteurs CSS et les cles `agn-*`. Les regressions que ce tri a
appris a eviter sont listees dans tools/README.md — les reintroduire ici serait
refaire les memes degats.

Ne compte QUE ce qui a un sens pour un lecteur : une chaine doit contenir au
moins deux mots de trois lettres, ou un mot accentue.

Usage : python tools/i18n-inventaire.py [--detail]
"""
import re, sys, collections

SRC = 'WME-Naming-Auditor.user.js'

# Copie conforme du tri des outils d'accentuation (accentuer.py, l.164).
RE_TECHNIQUE = re.compile(
    r'^-'
    r'|^(#|\.|\w+-)?agn[-\w]*$|^wmeAgglo|^wmeprefs|^wme-|^https?://'
    r'|^[\w.-]+/[\w./-]*$'
    r'|^[A-Za-z_$][\w$]*$'
    r'|^[a-z-]+:[^\s]*$'
)

RE_MOT = re.compile(r'[A-Za-zÀ-ÿ]{3,}')
RE_ACCENT = re.compile(r'[À-ÿ]')

# Les chaines litterales : simples, doubles, et templates (multi-lignes).
RE_CHAINES = re.compile(r"'((?:[^'\\\n]|\\.)*)'"
                        r'|"((?:[^"\\\n]|\\.)*)"'
                        r'|`((?:[^`\\]|\\.)*)`', re.S)


def visible(t):
    """Cette chaine s'adresse-t-elle a un humain ?"""
    t = t.strip()
    if not t or RE_TECHNIQUE.match(t):
        return False
    mots = RE_MOT.findall(t)
    return len(mots) >= 2 or bool(RE_ACCENT.search(t))


def sections(src):
    """
    Les titres de section du fichier, avec leur position de depart.

    ⚠️ On prend les DEUX niveaux de separateur : « // ==== » (section) et
    « // ---- » (sous-section). Avec les seules sections, chacune absorbait
    tout ce qui la suit jusqu'a la prochaine — le guidage se retrouvait
    credite de 276 chaines dont la plupart ne sont pas a lui. La ventilation
    reste indicative : c'est le TOTAL qui fait foi.
    """
    out = []
    for m in re.finditer(r'^[ \t]*// [=-]{10,}\n[ \t]*// ([^\n]{3,70})$', src, re.M):
        titre = m.group(1).strip().rstrip('-= ')
        if titre and not titre.startswith(('=', '-')):
            out.append((m.start(), titre))
    return out


def section_de(index, pos):
    """Le dernier titre rencontre avant cette position."""
    trouve = '(hors section)'
    for debut, titre in index:
        if debut > pos:
            break
        trouve = titre
    return trouve


def main():
    src = open(SRC, encoding='utf-8').read()
    # On ne compte pas les commentaires : ils ne s'affichent pas.
    # ⚠️ On les BLANCHIT au lieu de les supprimer : effacer les lignes decale
    #    toutes les positions, et le titre de section — qui EST un commentaire —
    #    se cherche ensuite dans le meme texte. Premiere version : 1032 chaines
    #    toutes rangees en « (hors section) », faute de ce detail.
    sans_comm = re.sub(r'^([ \t]*)((?://|\*|/\*).*)$',
                       lambda m: m.group(1) + ' ' * len(m.group(2)),
                       src, flags=re.M)

    index = sections(src)
    par_section = collections.Counter()
    par_taille = collections.Counter()
    trouvees = []
    for m in RE_CHAINES.finditer(sans_comm):
        t = m.group(1) or m.group(2) or m.group(3) or ''
        if not visible(t):
            continue
        sect = section_de(index, m.start())
        par_section[sect] += 1
        n = len(t)
        par_taille['court (< 40)' if n < 40 else
                   'moyen (40-150)' if n < 150 else 'long (>= 150)'] += 1
        trouvees.append((sect, t))

    print('CHAINES VISIBLES : %d' % len(trouvees))
    print('\nPar taille')
    for k in ('court (< 40)', 'moyen (40-150)', 'long (>= 150)'):
        print('  %-16s %4d' % (k, par_taille[k]))
    print('\nPar section (les 15 premieres)')
    for s, n in par_section.most_common(15):
        print('  %4d  %s' % (n, s[:66]))

    if '--detail' in sys.argv:
        print('\n' + '=' * 70)
        for sect, t in trouvees:
            print('%-28s | %s' % (sect[:28], t.replace('\n', ' ')[:100]))


if __name__ == '__main__':
    main()
