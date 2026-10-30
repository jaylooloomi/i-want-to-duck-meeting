import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const digest=value=>createHash('sha256').update(value).digest('hex');
const cells=line=>line.trim().slice(1,-1).split(/(?<!\\)\|/).map(value=>value.trim().replace(/\\\|/g,'|'));

function savedActions(dir){try{const value=JSON.parse(fs.readFileSync(path.join(dir,'action-items.json'),'utf8'));return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}catch{return {};}}

/** Completion is a separate local overlay; the Agent's source Markdown is immutable. */
export function actionItems(dir,markdown='') {
  let saved=savedActions(dir);
  const items=[];let section=false,actionLevel=0,headers=null,table=0,row=0;
  for(const raw of String(markdown).split(/\r?\n/)){
    const line=raw.trim(),heading=/^(#{1,6})\s+(.+)$/.exec(line);
    if(heading){if(/行動|待辦|action items|next steps/i.test(heading[2])){section=true;actionLevel=heading[1].length;}else if(heading[1].length<=actionLevel)section=false;headers=null;continue;}
    if(!section||!line.startsWith('|')||!line.endsWith('|')){headers=null;continue;}
    const values=cells(line);
    if(values.every(v=>/^:?-{2,}:?$/.test(v)))continue;
    if(!headers){headers=values;table++;row=0;continue;}
    const column=headers.findIndex(v=>/事項|待辦|行動|任務|task|action/i.test(v));
    if(column<0||!values[column])continue;
    const key=digest(JSON.stringify([table,row++,values]));
    items.push({key,cells:values,column,text:values[column],completed:saved[key]?.completed===true,updatedAt:saved[key]?.updatedAt||null});
  }
  return {revision:digest(String(markdown)),items};
}

export function setActionItem(dir,markdown,input){
  if(typeof input.completed!=='boolean')throw new Error('完成狀態必須是布林值');
  const current=actionItems(dir,markdown);
  if(input.revision!==current.revision)throw new Error('會議紀錄已更新，請重新讀取後再勾選');
  if(!current.items.some(item=>item.key===input.key))throw new Error('找不到這筆待辦');
  let saved=savedActions(dir);
  saved=Object.fromEntries(current.items.filter(item=>saved[item.key]).map(item=>[item.key,saved[item.key]]));
  saved[input.key]={completed:input.completed,updatedAt:new Date().toISOString()};
  const target=path.join(dir,'action-items.json'),temporary=target+'.'+randomUUID()+'.tmp';
  try{fs.writeFileSync(temporary,JSON.stringify(saved,null,2)+'\n');fs.renameSync(temporary,target);}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
  return actionItems(dir,markdown);
}

const storageCache=new Map();
export function storageInfo(root){
  const resolved=path.resolve(root),cached=storageCache.get(resolved);
  if(cached&&Date.now()-cached.at<5000)return cached.value;
  let usedBytes=0,files=0,visited=0,partial=false;const pending=[resolved];
  while(pending.length&&visited<20000){
    let entries;try{entries=fs.readdirSync(pending.pop(),{withFileTypes:true});}catch{partial=true;continue;}
    for(const entry of entries){
      if(++visited>20000){partial=true;break;}
      if(entry.isSymbolicLink())continue;
      const file=path.join(entry.parentPath||entry.path,entry.name);
      if(entry.isDirectory())pending.push(file);
      else if(entry.isFile()){try{usedBytes+=fs.statSync(file).size;files++;}catch{partial=true;}}
    }
  }
  if(pending.length)partial=true;
  let availableBytes=null,totalBytes=null;
  try{const disk=fs.statfsSync(resolved);availableBytes=Number(disk.bavail)*Number(disk.bsize);totalBytes=Number(disk.blocks)*Number(disk.bsize);}catch{}
  const value={usedBytes,files,availableBytes,totalBytes,partial};
  if(storageCache.size>8)storageCache.clear();storageCache.set(resolved,{at:Date.now(),value});return value;
}
