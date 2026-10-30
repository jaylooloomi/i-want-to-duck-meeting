"""Read-only screenshot scoring. No screenshot pixels are changed or masked."""
import sys,json,struct,zlib,hashlib
from pathlib import Path
import numpy as np

def read_png(file):
 data=Path(file).read_bytes();cache=Path('test/.tmp/visual-rgb-cache')/(hashlib.sha256(data).hexdigest()+'.npy')
 if cache.exists():return np.load(cache)
 assert data[:8]==b'\x89PNG\r\n\x1a\n'
 pos=8;compressed=b''
 while pos<len(data):
  n=struct.unpack('>I',data[pos:pos+4])[0];kind=data[pos+4:pos+8];chunk=data[pos+8:pos+8+n];pos+=12+n
  if kind==b'IHDR':w,h,depth,color,_,_,interlace=struct.unpack('>IIBBBBB',chunk)
  if kind==b'IDAT':compressed+=chunk
 assert depth==8 and color in (2,6) and interlace==0,(depth,color,interlace)
 channels=3 if color==2 else 4;stride=w*channels;raw=zlib.decompress(compressed);out=bytearray(h*stride);prev=bytearray(stride);p=0
 for y in range(h):
  kind=raw[p];p+=1;row=bytearray(raw[p:p+stride]);p+=stride
  for x in range(stride):
   left=row[x-channels] if x>=channels else 0;up=prev[x];ul=prev[x-channels] if x>=channels else 0
   if kind==1:v=left
   elif kind==2:v=up
   elif kind==3:v=(left+up)//2
   elif kind==4:
    guess=left+up-ul;a=abs(guess-left);b=abs(guess-up);c=abs(guess-ul);v=left if a<=b and a<=c else up if b<=c else ul
   elif kind==0:v=0
   else:raise ValueError('Unsupported PNG filter')
   row[x]=(row[x]+v)&255
  out[y*stride:(y+1)*stride]=row;prev=row
 image=np.frombuffer(out,dtype=np.uint8).reshape(h,w,channels).astype(np.float64)
 if channels==4:image=image[:,:,:3]*image[:,:,3:4]/255+255*(1-image[:,:,3:4]/255)
 result=image[:,:,:3];cache.parent.mkdir(parents=True,exist_ok=True);np.save(cache,result);return result

def reduce(image,factor):
 if factor==1:return image
 h,w=image.shape;h-=h%factor;w-=w%factor
 return image[:h,:w].reshape(h//factor,factor,w//factor,factor).mean(axis=(1,3))

def mean_window(image,n=11):
 integral=np.pad(image,((1,0),(1,0))).cumsum(0).cumsum(1)
 return (integral[n:,n:]-integral[:-n,n:]-integral[n:,:-n]+integral[:-n,:-n])/(n*n)

def ssim(a,b):
 n=min(11,a.shape[0],a.shape[1]);ma=mean_window(a,n);mb=mean_window(b,n)
 va=np.maximum(0,mean_window(a*a,n)-ma*ma);vb=np.maximum(0,mean_window(b*b,n)-mb*mb);cov=mean_window(a*b,n)-ma*mb
 return float(np.mean(((2*ma*mb+6.5025)*(2*cov+58.5225))/((ma*ma+mb*mb+6.5025)*(va+vb+58.5225))))

def iou(a,b):
 ax,ay,aw,ah=a;bx,by,bw,bh=b;area=max(0,min(ax+aw,bx+bw)-max(ax,bx))*max(0,min(ay+ah,by+bh)-max(ay,by));return area/(aw*ah+bw*bh-area)

def main():
 protocol=json.loads(Path('docs/design/visual-audit/protocol.json').read_text());folder=Path(sys.argv[1]);ref=Path(protocol['reference']);ref=ref if ref.exists() else Path('docs/design/workspace-reference-target-20261030.png');assert hashlib.sha256(ref.read_bytes()).hexdigest()==protocol['referenceSha256']
 a=read_png(ref);b=read_png(folder/'actual.png');assert a.shape==b.shape==(protocol['viewport'][1],protocol['viewport'][0],3)
 ga=a@np.array([.2126,.7152,.0722]);gb=b@np.array([.2126,.7152,.0722]);regions=[]
 for region in protocol['regions']:
  x0,y0,x1,y1=region['box'];scales=[ssim(reduce(ga[y0:y1,x0:x1],f),reduce(gb[y0:y1,x0:x1],f)) for f in (1,2,4)]
  structure=sum(w*v for w,v in zip((.2,.3,.5),scales));color=1-float(np.abs(a[y0:y1,x0:x1]-b[y0:y1,x0:x1]).mean())/255
  regions.append({**region,'structure':structure*100,'color':color*100,'scales':scales})
 structure=sum(r['structure']*r['weight'] for r in regions);color=sum(r['color']*r['weight'] for r in regions)
 actual=json.loads((folder/'geometry.json').read_text());boxes={key:iou(box,actual[key])*100 for key,box in protocol['geometry'].items()};geometry=sum(boxes.values())/len(boxes)
 console_file=folder/'console.json';console_errors=json.loads(console_file.read_text(encoding='utf-8')) if console_file.exists() else ['Console evidence missing'];capture_clean=not console_errors
 score=.7*structure+.2*geometry+.1*color;passed=capture_clean and score>=protocol['threshold'] and all(r['structure']>=protocol['minimumRegionStructure'] for r in regions)
 result={'score':score,'structure':structure,'geometry':geometry,'color':color,'regions':regions,'componentIoU':boxes,'passed':passed,'protocolSha256':hashlib.sha256(Path('docs/design/visual-audit/protocol.json').read_bytes()).hexdigest(),'actualSha256':hashlib.sha256((folder/'actual.png').read_bytes()).hexdigest(),'captureClean':capture_clean,'consoleErrors':console_errors}
 (folder/'score.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8');print(json.dumps({k:result[k] for k in ['score','structure','geometry','color','passed']}));print([(r['name'],round(r['structure'],2)) for r in regions])
 if not passed:sys.exit(1)
if __name__=='__main__':main()
