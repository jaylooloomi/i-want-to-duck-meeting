import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const hash=value=>createHash('sha256').update(value).digest('hex');
const cells=line=>line.slice(1,-1).split(/(?<!\\)\|/).map(value=>value.trim().replace(/\\\|/g,'|'));
function readEvidence(dir){
  try{const file=path.join(dir,'summary-evidence.json'),stat=fs.lstatSync(file);if(stat.isSymbolicLink()||!stat.isFile()||stat.size>2000000)throw new Error('evidence_unsafe');const data=JSON.parse(fs.readFileSync(file,'utf8'));if(data.schemaVersion!==1||!data.links||typeof data.links!=='object'||Array.isArray(data.links))throw new Error('evidence_corrupt');return data;}
  catch(error){if(error.code==='ENOENT')return {schemaVersion:1,links:{}};throw error;}
}
export function summaryItems(dir,markdown='',records=[]){
  markdown=String(markdown).trim();
  const saved=readEvidence(dir),items=[];let kind=null,level=0,headers=null;
  String(markdown).split(/\r?\n/).forEach((raw,lineIndex)=>{
    const line=raw.trim(),heading=/^(#{1,6})\s+(.+)$/.exec(line);
    if(heading){const next=/行動|待辦|action items|next steps/i.test(heading[2])?'action':/決議|決策|決定|decisions?/i.test(heading[2])?'decision':null;if(next){kind=next;level=heading[1].length;}else if(heading[1].length<=level)kind=null;headers=null;return;}
    const inlineDecision=/(?:最終)?(?:決議|決定)(?:\*\*)?\s*[：:]/.test(line);
    if((!kind&&!inlineDecision)||!line)return;
    const itemKind=kind||(inlineDecision?'decision':null);
    let text,values,declared=null;
    if(line.startsWith('|')&&line.endsWith('|')){values=cells(line);if(values.every(v=>/^:?-{2,}:?$/.test(v)))return;if(!headers){headers=values;return;}const column=headers.findIndex(v=>/事項|待辦|行動|任務|決議|決策|task|action|decision/i.test(v));if(column<0||!values[column])return;text=values[column];
      const quote=values[headers.findIndex(v=>/來源原文|source quote/i.test(v))],time=values[headers.findIndex(v=>/來源時間|source time/i.test(v))];
      if(quote&&time){declared={text:quote,time:Number.isFinite(Date.parse(time))?time:null};}
    }
    else{headers=null;text=line.replace(/^(?:[-*•]|\d+[.)])\s+/,'');}
    const id=hash(JSON.stringify([itemKind,lineIndex,line]));let link=saved.links[id];
    if(!link&&declared){const matches=records.filter(record=>record.text===declared.text&&(record.t0??null)===declared.time);link={...declared,speaker:matches.length===1?matches[0].speaker??null:null};}
    const matches=link&&!link.unlinked?records.filter(record=>record.text===link.text&&(record.t0??null)===link.time&&(record.speaker??null)===link.speaker):[];
    const source=matches.length===1?{text:link.text,time:link.time,speaker:link.speaker,linked:true}:{linked:false,reason:link&&!link.unlinked?'source_changed':'unlinked',previous:link&&!link.unlinked?link:null};
    items.push({id,kind:itemKind,lineIndex,text,details:values?headers.filter(header=>!/來源原文|來源時間|source quote|source time/i.test(header)).map(header=>header+': '+(values[headers.indexOf(header)]||'')).join(' · '):text,source});
  });
  return {revision:hash(String(markdown)),evidenceRevision:hash(JSON.stringify(saved)),items};
}
export function setSummarySource(dir,markdown,records,input){
  const lock=path.join(dir,'.summary-evidence.lock');let fd;try{fd=fs.openSync(lock,'wx');}catch(error){if(error.code==='EEXIST')throw new Error('evidence_busy');throw error;}
  try{
    const current=summaryItems(dir,markdown,records);
    if(input.revision!==current.revision||input.evidenceRevision!==current.evidenceRevision)throw new Error('evidence_conflict');
    if(!current.items.some(item=>item.id===input.itemId))throw new Error('evidence_item_missing');
    const saved=readEvidence(dir);saved.links=Object.fromEntries(current.items.filter(item=>saved.links[item.id]).map(item=>[item.id,saved.links[item.id]]));
    if(input.recordIndex===null)saved.links[input.itemId]={unlinked:true};
    else{if(!Number.isInteger(input.recordIndex)||input.recordIndex<0||input.recordIndex>=records.length)throw new Error('evidence_record_missing');const record=records[input.recordIndex];if(input.recordText!==record.text||input.recordTime!==(record.t0??null)||input.recordSpeaker!==(record.speaker??null))throw new Error('evidence_source_changed');saved.links[input.itemId]={text:record.text,time:record.t0??null,speaker:record.speaker??null};}
    const target=path.join(dir,'summary-evidence.json'),tmp=target+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(tmp,JSON.stringify(saved,null,2)+'\n',{flag:'wx'});fs.renameSync(tmp,target);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
    return summaryItems(dir,markdown,records);
  }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
