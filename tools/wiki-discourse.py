import json,sys,re,html
p=sys.argv[1]
d=json.load(open(p,encoding='utf-8'))
print('### TOPIC %s - %s'%(d['id'],d['title']))
for post in d['post_stream']['posts']:
    c=post['cooked']
    # ⚠️ CAPITAL : marquer explicitement le BARRE = regle ABROGEE.
    c=re.sub(r'<(s|del|strike)>','\n[[[ABROGE>>> ',c)
    c=re.sub(r'</(s|del|strike)>',' <<<ABROGE]]]\n',c)
    c=re.sub(r'<br\s*/?>','\n',c)
    c=re.sub(r'</(p|div|li|tr|h[1-6])>','\n',c)
    c=re.sub(r'</t[dh]>',' | ',c)
    c=re.sub(r'<[^>]+>','',c)
    c=html.unescape(c)
    c=re.sub(r'\n{3,}','\n\n',c)
    print('=== POST #%s par %s (%s) ==='%(post['post_number'],post['username'],post.get('updated_at','')[:10]))
    print(c.strip())
