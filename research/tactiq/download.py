import urllib.request,pathlib,re,json,html,hashlib,datetime
from html.parser import HTMLParser
root=pathlib.Path('research/tactiq'); ua={'User-Agent':'Mozilla/5.0'}
class Text(HTMLParser):
 def __init__(self):super().__init__();self.out=[];self.skip=0
 def handle_starttag(self,t,a):
  if t in ('script','style'):self.skip+=1
 def handle_endtag(self,t):
  if t in ('script','style'):self.skip=max(0,self.skip-1)
  if t in ('p','h1','h2','h3','li'):self.out.append('\n')
 def handle_data(self,s):
  if not self.skip:self.out.append(s)
urls=set()
for p in (root/'official').glob('*.html'):
 urls.update(re.findall(r'https://help.tactiq.io/en/articles/[\w-]+',p.read_text(encoding='utf8')))
# Only linked operational guides; not the entire unrelated help center.
urls={u for u in urls if any(k in u for k in ['google-meet','microsoft-teams','install-the-tactiq-extension','transcription-language','google-drive-integration','download-your-tactiq','connecting-tactiq'])}
urls.update(['https://tactiq.io/howitworks','https://tactiq.io/'])
manifest=[];videos=[]
for u in sorted(urls):
 try:
  data=urllib.request.urlopen(urllib.request.Request(u,headers=ua),timeout=30).read();name=u.rstrip('/').split('/')[-1] or 'homepage';p=root/'official'/(name+'.html');p.write_bytes(data);s=data.decode('utf8');parser=Text();parser.feed(s);p.with_suffix('.txt').write_text('SOURCE: '+u+'\n\n'+''.join(parser.out),encoding='utf8')
  media=sorted(set(html.unescape(x) for x in re.findall(r'(?:src|href)=["\']([^"\']+)',s) if re.search(r'\.(?:mp4|webm|gif)(?:[?]|$)|youtube\.com/embed|player\.vimeo|loom\.com/embed|wistia',x,re.I)))
  videos.extend({'page':u,'url':m} for m in media);manifest.append({'url':u,'file':str(p),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'media':media});print(name,len(data),media)
 except Exception as e:manifest.append({'url':u,'error':str(e)});print(u,str(e))
(root/'official'/'manifest.json').write_text(json.dumps({'retrievedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'pages':manifest},indent=2),encoding='utf8')
(root/'videos'/'discovered.json').write_text(json.dumps(videos,indent=2),encoding='utf8')
