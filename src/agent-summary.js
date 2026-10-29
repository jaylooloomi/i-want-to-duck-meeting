import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readStatus,writeStatus,listMeetings} from './status.js';

const digest = file => {try {return createHash('sha256').update(fs.readFileSync(file)).digest('hex');}catch{return null;}};
export function requestAgentSummary(dir,{force=false}={}) {
  const status=readStatus(dir);
  if(!status || !['done','failed'].includes(status.state))throw new Error('meeting_not_finished');
  if(status.summaryJob?.provider==='agent' && ['waiting_agent','generating'].includes(status.summaryJob.state))return status.summaryJob;
  const summaryPath=path.join(dir,'summary.md');
  if(!force && fs.existsSync(summaryPath) && fs.readFileSync(summaryPath,'utf8').trim())return {state:'ready'};
  if(force && fs.existsSync(summaryPath) && !fs.existsSync(path.join(dir,'summary.pre-agent.md')))fs.copyFileSync(summaryPath,path.join(dir,'summary.pre-agent.md'));
  const job={state:'waiting_agent',provider:'agent',progress:0,stage:'等待此對話的 AI Agent 接手整理（不使用 Ollama）',requestedAt:new Date().toISOString(),previousSummaryHash:digest(summaryPath)};
  writeStatus(dir,{summaryJob:job});return job;
}

export function followAgentMeeting(dir,threadId) {
  if(typeof threadId!=='string' || !threadId.trim())throw new Error('agent_thread_missing');
  const status=writeStatus(dir,{summaryAgentThread:threadId});
  if(['done','failed'].includes(status.state))requestAgentSummary(dir,{force:true});
}

export function enqueueFinishedAgentMeeting(dir) {
  const status=readStatus(dir);
  if(status?.summaryAgentThread && ['done','failed'].includes(status.state))return requestAgentSummary(dir);
  return null;
}

export function pendingAgentMeetings(meetingsDir,threadId) {
  if(!threadId)return [];
  return listMeetings(meetingsDir).filter(({status})=>status?.summaryAgentThread===threadId && status.summaryJob?.provider==='agent' && status.summaryJob.state==='waiting_agent')
    .map(({id,dir,status})=>({id,dir,state:status.state,requestedAt:status.summaryJob.requestedAt}));
}

export function completeAgentSummary(dir) {
  const s=readStatus(dir),file=path.join(dir,'summary.md');
  if(!fs.existsSync(file) || !fs.readFileSync(file,'utf8').trim())throw new Error('summary_missing');
  const hash=digest(file);
  if(s?.summaryJob?.previousSummaryHash===hash)throw new Error('summary_not_updated');
  writeStatus(dir,{summaryJob:{state:'ready',provider:'agent',progress:100,stage:'AI Agent 已完成會議紀錄',updatedAt:new Date().toISOString(),summaryHash:hash}});
}
