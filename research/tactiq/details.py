import pathlib,re
ext=pathlib.Path(r'C:\Users\User\AppData\Local\Google\Chrome\User Data\Profile 3\Extensions\fggkaccpbmombhnjkjokndojfgagejfb\3.1.7320_0')
for name,terms in {'msteams.inline.js':['msteamscalling','recognitionResults','function E(','closedCaptions','addEventListener("message"','function q('],'googlemeet.inline.js':['BTranscriptMessage.decode','captions_v2','function qi(','function Ia(','Hi='],'background.js':['msteams.inline','registerContentScripts','teams.live.com']}.items():
 s=(ext/name).read_text(encoding='utf8');print('\n',name)
 for term in terms:
  print('\nTERM',term)
  for m in list(re.finditer(re.escape(term),s))[:2]: print(s[max(0,m.start()-250):m.end()+1800])
for p in pathlib.Path('research/tactiq/official').glob('*.html'):
 s=p.read_text(encoding="utf8");print(p.name, 'iframes',re.findall(r'<iframe[^>]*',s), 'video',re.findall(r'<video[^>]*',s))

