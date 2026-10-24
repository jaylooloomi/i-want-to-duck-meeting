import pathlib,re,html,hashlib,json,urllib.request
from PIL import Image,ImageOps,ImageDraw
root=pathlib.Path('research/tactiq');s=(root/'official/9535734-how-to-use-tactiq-with-google-meet-meetings.html').read_text(encoding='utf8');out=[];tiles=[]
for i,u in enumerate(re.findall(r'<img[^>]+src="([^"]+\.gif[^\"]*)"',s),1):
 u=html.unescape(u);p=root/'official/assets'/(hashlib.sha256(u.encode()).hexdigest()[:16]+'.gif')
 if not p.exists():p.write_bytes(urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0'}),timeout=30).read())
 im=Image.open(p);frames=im.n_frames;duration=0
 for f in range(frames):im.seek(f);duration+=im.info.get('duration',0)
 out.append({'page':'google-meet','source':u,'file':str(p),'frames':frames,'durationMs':duration})
 for f in [0,frames//2,frames-1]:
  im.seek(f);tile=ImageOps.contain(im.convert('RGB'),(600,340));canvas=Image.new('RGB',(610,370),'white');canvas.paste(tile,(5,25));ImageDraw.Draw(canvas).text((5,5),f'GIF {i} frame {f}/{frames}',fill='black');tiles.append(canvas)
canvas=Image.new('RGB',(1830,370*((len(tiles)+2)//3)),'white')
for j,t in enumerate(tiles):canvas.paste(t,((j%3)*610,(j//3)*370))
canvas.save(root/'official/meet-demo-contact-sheet.jpg');(root/'videos/meet-animations.json').write_text(json.dumps(out,indent=2),encoding='utf8');print(json.dumps(out,indent=2))

