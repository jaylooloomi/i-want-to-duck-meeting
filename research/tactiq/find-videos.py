import urllib.request,re,pathlib,json
u='https://www.youtube.com/@Tactiq-vlog/videos'
try:
 s=urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0'}),timeout=30).read().decode();pathlib.Path('research/tactiq/videos/official-channel.html').write_text(s,encoding='utf8')
 matches=re.findall(r'"videoId":"([^" ]+)".*?"title":\{"runs":\[\{"text":"([^"\n]+)',s); print(json.dumps(matches[:25],ensure_ascii=False))
except Exception as e:print(e)
