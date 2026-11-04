from pathlib import Path
import json,xml.etree.ElementTree as E
ns='http://www.w3.org/2000/svg';E.register_namespace('',ns);T=lambda s:'{'+ns+'}'+s
root=Path('docs/design/tutorial-visual-v2');p=root/'animation/duck-meeting-tutorial.svg';r=E.parse(p).getroot();evidence=[]
for n,name in [(7,'highlight'),(8,'search'),(13,'playback'),(14,'mail')]:
 data=json.loads((root/'assets'/f'{name}-target.json').read_text(encoding='utf-8'));b=data['box'];g=r.find(f".//{T('g')}[@id='scene-{n:02}']")
 image=g.find(T('image'));iw=float(image.get('width'));ih=float(image.get('height'));v=data['viewport'];scale=min(iw/v['width'],ih/v['height']);offsetX=float(image.get('x'))+(iw-v['width']*scale)/2;offsetY=float(image.get('y'))+(ih-v['height']*scale)/2
 bx=offsetX+b['x']*scale;by=offsetY+b['y']*scale;bw=b['width']*scale;bh=b['height']*scale
 x=bx+bw/2;y=by+bh/2
 if name=='search':x=bx+min(100,bw/2)
 if name=='mail':x=bx+min(130,bw/2);y=by+min(30,bh/2)
 a=g.find('.//'+T('animateTransform'));vals=a.get('values').split(';');vals[-3:]=[f'{x} {y}']*3;a.set('values',';'.join(vals))
 for el in list(g):
  if el.tag==T('circle') and el.get('stroke')=='#4de0bd':el.set('cx',str(x));el.set('cy',str(y))
  if el.tag==T('rect') and el.get('stroke')=='#40d8b4':
   el.set('x',str(bx-7));el.set('y',str(by-7));el.set('width',str(bw+14));el.set('height',str(bh+14));el.set('rx','8')
 evidence.append({'scene':n,'element':data['label'] or name,'sourceBox':b,'svgBox':{'x':bx,'y':by,'width':bw,'height':bh},'cursor':{'x':x,'y':y},'scale':scale})
p.write_text(E.tostring(r,encoding='unicode'),encoding='utf-8');(root/'animation/qa/dom-targets.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2),encoding='utf-8')
p=root/'animation/preview.html';s=p.read_text(encoding='utf-8').replace('v=live-translation-8','v=dom-targets-9');p.write_text(s,encoding='utf-8')
print('Synced five interactive scenes from real DOM geometry')

