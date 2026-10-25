import fs from 'node:fs';
import path from 'node:path';

const output=path.resolve(process.argv[2] || JSON.parse(fs.readFileSync('test/.tmp/qa/latest.json','utf8')).output);
const files=new Map();
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
for(const file of walk(output).filter(x=>path.basename(x)==='coverage.json')) {
  for(const entry of JSON.parse(fs.readFileSync(file,'utf8'))) {
    let name;try{name=new URL(entry.url).pathname;}catch{continue;}
    if(!['/app.js','/microphone.js'].includes(name) || !entry.source)continue;
    const previous=files.get(name) || {source:entry.source,hit:new Uint8Array(entry.source.length)};
    const ranges=entry.functions.flatMap(x=>x.ranges);
    const points=[...new Set(ranges.flatMap(x=>[x.startOffset,x.endOffset]))].sort((a,b)=>a-b);
    for(let i=0;i<points.length-1;i++) {
      const start=points[i],end=points[i+1];
      const range=ranges.filter(r=>r.startOffset<=start && r.endOffset>=end).sort((a,b)=>(a.endOffset-a.startOffset)-(b.endOffset-b.startOffset))[0];
      if(range?.count>0)previous.hit.fill(1,start,end);
    }
    files.set(name,previous);
  }
}
const browser=[...files].map(([file,{source,hit}])=>{
  let offset=0,nonblank=0,covered=0;
  for(const line of source.split('\n')){
    if(line.trim()){
      nonblank++;let executed=false;
      for(let index=0;index<line.length;index++)if(line[index].trim() && hit[offset+index])executed=true;
      if(executed)covered++;
    }
    offset+=line.length+1;
  }
  return {file:'src/live'+file,kind:'Chrome precise JS, nonblank lines with any executed character',covered,lines:nonblank,percent:Number((100*covered/nonblank).toFixed(2))};
});
const table=['# 執行覆蓋率審計','',...browser.map(x=>`- ${x.file}: ${x.covered}/${x.lines} 非空行，${x.percent}%（${x.kind}）`),
  '', '瀏覽器資料包含真正執行的原生前端腳本；不把HTML/CSS或AudioWorklet獨立執行緒納入這個JS分母。行內任一字元命中不表示該行所有分支都覆蓋。Node後端line/branch/function依各回歸log的原生V8表；Python依python-coverage.json，分母包含未測腳本。'];
fs.writeFileSync(path.join(output,'browser-coverage.json'),JSON.stringify(browser,null,2)+'\n');
fs.writeFileSync(path.join(output,'coverage.md'),table.join('\n')+'\n');
console.log(table.join('\n'));
