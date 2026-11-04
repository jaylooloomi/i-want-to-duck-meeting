import fs from 'node:fs';import path from 'node:path';
import {listMeetings} from './status.js';import {actionItems} from './workspace-actions.js';import {summaryItems} from './summary-items.js';import {meetingTitle} from './workspace-data.js';
const bounded=(dir,name,limit)=>{const file=path.join(dir,name),stat=fs.lstatSync(file);if(stat.isSymbolicLink()||!stat.isFile()||stat.size>limit)throw Error('task_source_unsafe');return fs.readFileSync(file,'utf8');};
export function taskBoard(root){const tasks=[],warnings=[];
 for(const {id,dir,status} of listMeetings(root)){
  if(!['done','failed','archived'].includes(status?.state)||['waiting_agent','generating','failed'].includes(status?.summaryJob?.state))continue;
  try{const markdown=bounded(dir,'summary.md',4000000).trim();if(!markdown)continue;const actions=actionItems(dir,markdown);if(!actions.items.length)continue;
   let records=[];try{records=bounded(dir,'transcript.jsonl',32000000).split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));}catch(error){if(error.code!=='ENOENT')warnings.push({id,error:'source_unavailable'});}
   let notes;try{notes=summaryItems(dir,markdown,records);}catch{warnings.push({id,error:'evidence_unavailable'});}
   for(const item of actions.items){const note=notes?.items.find(note=>note.kind==='action'&&note.lineIndex===item.lineIndex);tasks.push({...item,id,revision:actions.revision,title:meetingTitle(dir,status),archived:status.state==='archived',noteItemId:note?.id||null,source:note?.source?.linked?note.source:{linked:false}});}
  }catch(error){if(error.code!=='ENOENT')warnings.push({id,error:'tasks_unavailable'});}
 }
 return {tasks,warnings};
}
