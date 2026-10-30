import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {readStatus} from './status.js';
const hash=value=>createHash('sha256').update(value).digest('hex');
function readSafe(dir,name){const file=path.join(dir,name);try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>600000)throw new Error('mail_unsafe_file');return fs.readFileSync(file,'utf8');}catch(error){if(error.code==='ENOENT')return null;throw error;}}
function addresses(value){if(!Array.isArray(value)||value.length>50)throw new Error('mail_invalid_recipients');return value.map(address=>{if(typeof address!=='string'||address.length>254||!(/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/).test(address))throw new Error('mail_invalid_recipients');return address;});}
export function validateMailFields(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('mail_invalid_input');
 const allowed=['to','cc','bcc','subject','body','expectedRevision','sourceRevision'];if(Object.keys(input).some(key=>!allowed.includes(key)))throw new Error('mail_invalid_input');
 if(typeof input.subject!=='string'||!input.subject.trim()||input.subject.length>300||/[\r\n\0]/.test(input.subject))throw new Error('mail_invalid_subject');
 if(typeof input.body!=='string'||!input.body.trim()||input.body.length>100000||input.body.includes('\0'))throw new Error('mail_invalid_body');
 return {to:addresses(input.to??[]),cc:addresses(input.cc??[]),bcc:addresses(input.bcc??[]),subject:input.subject.trim(),body:input.body};
}
export function mailText(draft){return [(draft.to.length?'To: '+draft.to.join(', '):'To: (not specified)'),...(draft.cc.length?['Cc: '+draft.cc.join(', ')]:[]),...(draft.bcc.length?['Bcc: '+draft.bcc.join(', ')]:[]),'Subject: '+draft.subject,'',draft.body].join('\n');}
export function readMailDraft(dir){
 const observedAt=new Date().toISOString();
 const status=readStatus(dir)||{},summary=readSafe(dir,'summary.md');
 const available=['done','failed','archived'].includes(status.state)&&!!summary?.trim()&&!['waiting_agent','generating','failed'].includes(status.summaryJob?.state);
 const sourceRevision=summary?.trim()?hash(summary):null,raw=readSafe(dir,'mail-draft.json');
 if(raw===null)return {observedAt,available,sourceRevision,revision:null,draft:null,stale:false};
 let draft;try{draft=JSON.parse(raw);}catch{throw new Error('mail_corrupt');}
 if(Object.keys(draft).some(key=>!['schemaVersion','meetingId','sourceRevision','to','cc','bcc','subject','body','updatedAt','updatedBy'].includes(key)))throw new Error('mail_corrupt');
 if(draft.schemaVersion!==1||draft.meetingId!==status.id||typeof draft.sourceRevision!=='string'||typeof draft.updatedAt!=='string'||!['agent','user'].includes(draft.updatedBy))throw new Error('mail_corrupt');
 try{validateMailFields({to:draft.to,cc:draft.cc,bcc:draft.bcc,subject:draft.subject,body:draft.body});}catch{throw new Error('mail_corrupt');}
 return {observedAt,available,sourceRevision,revision:hash(raw),draft,stale:draft.sourceRevision!==sourceRevision};
}
function saveUnlocked(dir,input,{actor='user'}={}){
 const fields=validateMailFields(input),current=readMailDraft(dir);if(!current.available)throw new Error('mail_notes_not_ready');
 if(!Object.hasOwn(input,'expectedRevision')||input.expectedRevision!==current.revision)throw new Error('mail_conflict');
 if(input.sourceRevision!==current.sourceRevision)throw new Error('mail_source_changed');
 if(!['user','agent'].includes(actor))throw new Error('mail_invalid_input');
 // Never follow a pre-existing Markdown symlink when updating the readable companion.
 readSafe(dir,'mail-draft.md');
 const draft={schemaVersion:1,meetingId:readStatus(dir).id,sourceRevision:current.sourceRevision,...fields,updatedAt:new Date().toISOString(),updatedBy:actor};
 const raw=JSON.stringify(draft,null,2)+'\n',tmp=path.join(dir,'mail-draft.'+randomUUID()+'.tmp');
 try{fs.writeFileSync(tmp,raw,{encoding:'utf8',flag:'wx'});fs.renameSync(tmp,path.join(dir,'mail-draft.json'));}finally{try{fs.unlinkSync(tmp);}catch{}}
 // JSON is canonical; Markdown is a readable export, not a provider draft or delivery receipt.
 let companionSaved=true;try{fs.writeFileSync(path.join(dir,'mail-draft.md'),mailText(draft)+'\n','utf8');}catch{companionSaved=false;}
 return {...readMailDraft(dir),companionSaved};
}

export function saveMailDraft(dir,input,options={}){
 const file=path.join(dir,'.mail-draft.lock');let fd;try{fd=fs.openSync(file,'wx');}catch(error){if(error.code==='EEXIST')throw new Error('mail_busy');throw error;}
 try{return saveUnlocked(dir,input,options);}finally{fs.closeSync(fd);fs.unlinkSync(file);}
}
