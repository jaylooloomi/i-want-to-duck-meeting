from pathlib import Path
import xml.etree.ElementTree as E,json,base64,re
NS='http://www.w3.org/2000/svg';E.register_namespace('',NS);T=lambda s:'{'+NS+'}'+s
ROOT=Path('docs/design/tutorial-visual-v2');FILE=ROOT/'animation/duck-meeting-tutorial.svg'
def anim(el,attr,pts,discrete=False):
 d={0:pts[0][1],153:pts[-1][1]};d.update(dict(pts));return E.SubElement(el,T('animate'),{'attributeName':attr,'dur':'153s','repeatCount':'indefinite','calcMode':'discrete' if discrete else 'linear','keyTimes':';'.join(str(t/153) for t in sorted(d)),'values':';'.join(str(d[t]) for t in sorted(d))})
def rect(parent,x,y,w,h,fill,rx=8,stroke=None):return E.SubElement(parent,T('rect'),{'x':str(x),'y':str(y),'width':str(w),'height':str(h),'rx':str(rx),'fill':fill,**({'stroke':stroke} if stroke else {})})
def text(parent,x,y,s,size=24,color='#dce8f6',weight='400'):
 e=E.SubElement(parent,T('text'),{'x':str(x),'y':str(y),'font-family':'Segoe UI,Microsoft JhengHei,sans-serif','font-size':str(size),'fill':color,'font-weight':weight});e.text=s;return e
def image(parent,name):return E.SubElement(parent,T('image'),{'x':'0','y':'80','width':'1920','height':'1000','preserveAspectRatio':'xMidYMid meet','href':'data:image/png;base64,'+base64.b64encode((ROOT/'assets'/f'{name}.png').read_bytes()).decode()})
def fresh(root,n):
 g=root.find(f".//{T('g')}[@id='scene-{n:02}']");v=g.find(T('animate'));g.clear();g.set('id',f'scene-{n:02}');g.set('opacity','0');g.append(v);return g
r=E.parse(FILE).getroot()
# Align the click moment with the actual send-button arrival and message emission.
for n,start in [(1,0),(9,81),(15,135)]:
 g=r.find(f".//{T('g')}[@id='scene-{n:02}']")
 for circle in g.findall(T('circle')):
  if circle.get('stroke')!='#4de0bd':continue
  for a in list(circle):circle.remove(a)
  anim(circle,'r',[(0,6),(start+5.9,6),(start+6.25,32)])
  anim(circle,'opacity',[(0,0),(start+5.89,0),(start+5.9,1),(start+6.25,0)])
# Search: focus actual field, type inside it, then show actual filtered UI.
g=fresh(r,8);rect(g,0,0,1920,1080,'#081420',0);text(g,32,48,'08  搜尋逐字稿',31);text(g,1110,46,'使用者操作：輸入關鍵字 → 顯示命中',21,'#efb85a');text(g,1625,46,'實際 UI · 虛構資料',18,'#93afc6')
before=image(g,'highlight');anim(before,'opacity',[(0,1),(74.6,0)],True)
after=image(g,'search');anim(after,'opacity',[(0,0),(74.6,1)],True)
b=json.loads((ROOT/'assets/search-target.json').read_text(encoding='utf-8'))['box'];sc=1000/1080;x=71.111111+b['x']*sc;y=80+b['y']*sc;w=b['width']*sc;h=b['height']*sc
inputgroup=E.SubElement(g,T('g'));anim(inputgroup,'opacity',[(0,0),(73.1,1),(74.6,0)],True);rect(inputgroup,x+2,y+2,w-4,h-4,'#0b1a29',3);defs=E.SubElement(inputgroup,T('defs'));clip=E.SubElement(defs,T('clipPath'),{'id':'review-search-clip'});wipe=rect(clip,x+10,y+3,0,h-4,'white',0);anim(wipe,'width',[(0,0),(73.5,0),(73.9,13),(74.25,26)],True);label=text(inputgroup,x+10,y+h*.67,'左側',13,'#dce8f6');label.set('clip-path','url(#review-search-clip)');caret=rect(inputgroup,x+10,y+8,1.5,h-16,'#c8fff0',0);anim(caret,'x',[(0,x+10),(73.5,x+10),(73.9,x+23),(74.25,x+36)],True)
focus=rect(g,x-4,y-4,w+8,h+8,'none',7,'#efb85a');anim(focus,'opacity',[(0,0),(72.7,1),(75.1,0)],True)
cx=x+40;cy=y+h/2;mouse=E.SubElement(g,T('g'));E.SubElement(mouse,T('animateTransform'),{'attributeName':'transform','type':'translate','dur':'153s','repeatCount':'indefinite','keyTimes':';'.join(str(t/153) for t in [0,72,73,74.6,153]),'values':f'1780 950;1780 950;{cx} {cy};{cx} {cy};{cx} {cy}'});E.SubElement(mouse,T('path'),{'d':'M0 0v38l10 -11 16 1Z','fill':'#efb85a','stroke':'#174055','stroke-width':'2'});anim(mouse,'opacity',[(0,1),(73.4,0)],True)
ring=E.SubElement(g,T('circle'),{'cx':str(cx),'cy':str(cy),'r':'5','fill':'none','stroke':'#efb85a','stroke-width':'3'});anim(ring,'r',[(0,5),(73.1,5),(73.4,25)]);anim(ring,'opacity',[(0,0),(73.09,0),(73.1,1),(73.4,0)])
# End with a clearly fictional, conditional delivery example rather than engineering placeholders.
g=fresh(r,16);rect(g,0,0,1920,1080,'#081420',0);text(g,32,48,'16  確認交付結果',31);text(g,1180,46,'Agent 執行 · 郵件工具結果示意',22,'#76caff');rect(g,160,135,1600,820,'#0e1e2f',18,'#2e4b61');text(g,205,198,'產品設計週會',32,weight='650');text(g,205,244,'明確授權後，由已連線郵件工具執行',23,'#9bb8cf')
rect(g,205,298,795,340,'#132c40',14,'#35566e');text(g,240,350,'核對寄送內容',28,'#c4e8f6');text(g,240,409,'收件人　team@example.com',24);text(g,240,463,'主旨　[會議紀錄] 產品設計週會',24);text(g,240,515,'正文　使用者已確認的最新草稿',24)
for i,line in enumerate(['✓ 收件人已指定','✓ 最新草稿已核對','✓ 使用者已授權寄送']):
 e=text(g,1060,352+i*70,line,25,'#86dfc3');anim(e,'opacity',[(0,0),(144.3+i*.65,0),(144.6+i*.65,1)])
progress=rect(g,240,569,0,5,'#59d6b5',2);anim(progress,'width',[(0,0),(146.2,0),(149.1,715)])
waiting=text(g,240,610,'交由郵件工具處理…',21,'#8db5d1');anim(waiting,'opacity',[(0,0),(146.2,1),(149.3,0)],True)
result=E.SubElement(g,T('g'));anim(result,'opacity',[(0,0),(149.3,0),(149.7,1)]);rect(result,205,683,1510,137,'#133b32',14,'#4bb493');text(result,242,739,'✓ 示意結果：郵件寄送成功',30,'#c7ffeb','650');text(result,242,787,'實際寄送以郵件工具回傳結果為準',22,'#9fd6c5')
text(g,205,878,'本片為虛構教學情境，未寄送真實郵件；站台只保存本機草稿。',22,'#98b2c9')
svg=E.tostring(r,encoding='unicode');FILE.write_text(svg,encoding='utf-8')
for filename in ['preview.html','preview-v14.html']:
 p=ROOT/'animation'/filename;s=p.read_text(encoding='utf-8');s=re.sub(r'(<div id="film">).*?(</div></main>)',lambda m:m.group(1)+svg+m.group(2),s,count=1,flags=re.S);p.write_text(s,encoding='utf-8')
