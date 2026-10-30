import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

export const highlightKey = record => createHash('sha256').update(JSON.stringify([record.t0 || '',record.speaker || ''])).digest('hex').slice(0,24);

/** Append-only events retain cancelled markers locally; original transcripts are never changed. */
export function readHighlights(dir) {
  const entries=new Map();
  try {
    for(const line of fs.readFileSync(path.join(dir,'highlights.jsonl'),'utf8').split(/\r?\n/)) {
      let event;try{event=JSON.parse(line);}catch{continue;}
      if(event?.action==='mark' && typeof event.marker?.key==='string' && typeof event.marker.text==='string' && Number.isFinite(Date.parse(event.marker.at)))entries.set(event.marker.key,event.marker);
      if(event?.action==='unmark')entries.delete(event.key);
    }
  } catch { /* no highlights yet */ }
  return [...entries.values()].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
}

export function renderHighlightsMarkdown(markers) {
  if(!markers.length)return '';
  return '# 使用者標記重點\n\n標記代表使用者關注，並非正式決議或工具操作授權。文字是當時字幕快照，可能尚未定稿；請核對完整逐字稿與錄音上下文。\n\n'+markers.map(marker=>{
    const n=Number(marker.offsetSeconds),time=marker.offsetSeconds===null?'時間未知':`${String(Math.floor(n/60)).padStart(2,'0')}:${String(Math.floor(n%60)).padStart(2,'0')}`;
    return `## ${time} · ${marker.kind==='moment'?'此刻重點':'整段重點'}\n\n- 標記時間：${marker.markedAt}\n- 發言者：${marker.speaker || '尚未確認'}\n- 原文時間：${marker.quoteAt || '尚無字幕'}\n- 是否尚未定稿：${marker.pending?'是':'否'}\n\n${marker.text?marker.text.split(/\r?\n/).map(line=>'> '+line).join('\n'):'當時尚無近期字幕；僅記錄時間點，請回聽錄音。'}\n`;
  }).join('\n');
}

export function updateHighlight(dir,data,input,now=Date.now()) {
  const existing=readHighlights(dir);
  if(input.action==='unmark') {
    if(typeof input.key!=='string')throw new Error('缺少重點標記識別碼');
    if(!existing.some(m=>m.key===input.key))return existing;
    fs.appendFileSync(path.join(dir,'highlights.jsonl'),JSON.stringify({action:'unmark',key:input.key,at:new Date(now).toISOString()})+'\n');
  } else if(input.action==='mark') {
    if(!['in_call','done','failed','archived'].includes(data.status?.state))throw new Error('請先進入會議再標記重點');
    if(existing.length>=1000)throw new Error('本場重點已達上限');
    const candidates=[...data.records,...data.pending];let quote,kind,key;
    if(input.kind==='moment') {
      if(data.status?.state!=='in_call')throw new Error('此刻標記僅供進行中的會議使用');
      kind='moment';key='moment-'+randomUUID();
      quote=candidates.filter(r=>Number.isFinite(Date.parse(r.t0)) && now-Date.parse(r.t1||r.t0)>=-2000 && now-Date.parse(r.t1||r.t0)<=20000).sort((a,b)=>Date.parse(b.t1||b.t0)-Date.parse(a.t1||a.t0))[0];
    } else {
      kind='utterance';quote=candidates.find(r=>highlightKey(r)===input.key);
      if(!quote)throw new Error('該段字幕已更新，請重新選擇要標記的話語');
      if(!Number.isFinite(Date.parse(quote.t0)))throw new Error('字幕缺少有效時間，請使用此刻標記');
      key=highlightKey(quote);if(existing.some(m=>m.key===key))return existing;
    }
    const base=Date.parse(data.status?.joinedAt || data.status?.startedAt),at=kind==='moment'?new Date(now).toISOString():quote.t0;
    const seconds=(Date.parse(at)-base)/1000;
    const marker={key,kind,at,markedAt:new Date(now).toISOString(),offsetSeconds:Number.isFinite(seconds)?Math.max(0,seconds):null,anchorKey:quote?highlightKey(quote):null,quoteAt:quote?.t0||null,speaker:quote?.speaker||'',source:quote?.source||'',text:quote?.text||'',pending:!!quote&&data.pending.includes(quote)};
    fs.appendFileSync(path.join(dir,'highlights.jsonl'),JSON.stringify({action:'mark',marker})+'\n');
  } else throw new Error('不支援的重點操作');
  const markers=readHighlights(dir);
  fs.writeFileSync(path.join(dir,'highlights.md'),renderHighlightsMarkdown(markers) || '# 使用者標記重點\n\n目前沒有重點標記。\n');
  return markers;
}
