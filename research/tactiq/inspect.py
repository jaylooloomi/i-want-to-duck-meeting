import urllib.request,pathlib,re,json,hashlib
root=pathlib.Path('research/tactiq'); ext=pathlib.Path(r'C:\Users\User\AppData\Local\Google\Chrome\User Data\Profile 3\Extensions\fggkaccpbmombhnjkjokndojfgagejfb\3.1.7320_0')
urls={'google-meet':'https://help.tactiq.io/en/articles/9535734-how-to-use-tactiq-with-google-meet-meetings','teams':'https://help.tactiq.io/en/articles/9560779-how-to-use-tactiq-with-microsoft-teams-meetings','mcp':'https://help.tactiq.io/en/articles/14883619-connecting-tactiq-mcp-server'}
for name,url in urls.items():
 data=urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'})).read(); (root/'official'/f'{name}.html').write_bytes(data)
 s=data.decode(); links=sorted(set(re.findall(r'https?[^\s<>"\\]+',s))); media=[x for x in links if any(t in x.lower() for t in ['youtube','youtu.be','vimeo','wistia','loom','mp4','intercom-video'])];print(name,'media',json.dumps(media)[:7000])
for name in ['rtcinjector.js','googlemeet.inline.js','msteams.inline.js']:
 s=(ext/name).read_text(encoding='utf8'); print('\nFILE',name)
 for term in ['RTCPeerConnection','createDataChannel','onmessage','caption','transcript','MutationObserver','WebSocket','protobuf','speech','TextDecoder']:
  hits=list(re.finditer(re.escape(term),s,re.I)); print(term,len(hits))
  for m in hits[:3]: print(s[max(0,m.start()-180):m.end()+300])
(root/'analysis'/'extension-inventory.json').write_text(json.dumps({'version':'3.1.7320','files':[{'name':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in ext.glob('*.js')]},indent=2))

