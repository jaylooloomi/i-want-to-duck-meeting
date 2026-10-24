import pathlib,re,json,urllib.request,hashlib,html
root=pathlib.Path('research/tactiq'); ext=pathlib.Path(r'C:\Users\User\AppData\Local\Google\Chrome\User Data\Profile 3\Extensions\fggkaccpbmombhnjkjokndojfgagejfb\3.1.7320_0'); evidence=[]
terms={'background.js':['tactiq-rtc-meet-main','world:"MAIN"'],'googlemeet.inline.js':['captions_v2','messageVersion','RTCDataChannel.prototype.send','BTranscriptMessage','notePacket','channelReopened'],'msteams.inline.js':['main-channel','recognitionResults','msteamscalling.deref','startClosedCaption()','remoteUserEventsReceived','lightproxy.teams.microsoft.com','timestampAudioSent','closed-captions-button']}
for name,items in terms.items():
 s=(ext/name).read_text(encoding='utf8')
 for term in items:evidence.append({'file':name,'needle':term,'characterOffsets':[m.start() for m in re.finditer(re.escape(term),s)]})
(root/'analysis'/'evidence-index.json').write_text(json.dumps(evidence,indent=2),encoding='utf8')
assets=root/'official'/'assets';assets.mkdir(exist_ok=True);found=set();out=[]
for p in (root/'official').glob('*.html'):
 s=p.read_text(encoding='utf8')
 for url in re.findall(r'https://[^\s"<>\\]+',s):
  url=html.unescape(url)
  if ('intercom-attachments' in url or 'downloads.intercomcdn' in url) and re.search(r'\.(png|jpe?g|gif|webp|mp4)(?:\?|$)',url,re.I):found.add(url)
for url in sorted(found):
 try:
  data=urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'}),timeout=20).read(); suffix=re.search(r'\.(png|jpe?g|gif|webp|mp4)(?:\?|$)',url,re.I)[1];p=assets/(hashlib.sha256(url.encode()).hexdigest()[:16]+'.'+suffix);p.write_bytes(data);out.append({'url':url,'file':str(p),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
 except Exception as e:out.append({'url':url,'error':str(e)})
(root/'official'/'asset-manifest.json').write_text(json.dumps(out,indent=2),encoding='utf8');print('Assets:',len(out),'bytes:',sum(x.get('bytes',0) for x in out))
