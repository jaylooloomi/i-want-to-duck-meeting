import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {newer} from './update.js';
import {runClaude} from '../scripts/install-plugin.js';

export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const dataRoot=path.join(process.env.LOCALAPPDATA||os.homedir(),'DuckMeeting','data');
const marker=path.join(root,'installation.json');
const receipt=path.join(root,'integration-receipt.json');
export function ownedSkill(dir,installRoot){try{return path.resolve(JSON.parse(fs.readFileSync(path.join(dir,'runtime.json'),'utf8')).repoRoot)===path.resolve(installRoot);}catch{return false;}}
export function assertIdle(home){
 const meetings=path.join(home,'meetings');if(!fs.existsSync(meetings))return;
 for(const entry of fs.readdirSync(meetings,{withFileTypes:true})){if(!entry.isDirectory())continue;let status;try{status=JSON.parse(fs.readFileSync(path.join(meetings,entry.name,'status.json'),'utf8'));}catch{continue;}
  if(['done','failed','archived'].includes(status.state))continue;
  for(const pid of [status.pid,status.workerPid])if(Number.isSafeInteger(pid)&&pid>0){try{process.kill(pid,0);throw new Error('Meeting still active: '+entry.name);}catch(error){if(error.code!=='ESRCH')throw error;}}
 }
}
function run(file,args){const result=spawnSync(file,args,{encoding:'utf8',windowsHide:true,env:{...process.env,PATH:[path.dirname(process.execPath),process.env.PATH].join(path.delimiter)}});fs.mkdirSync(dataRoot,{recursive:true});fs.appendFileSync(path.join(dataRoot,'installer.log'),(result.stdout||'')+(result.stderr||''));if(result.error||result.status!==0)throw new Error('Command failed: '+file+' ('+(result.error?.message||result.status)+'). See '+path.join(dataRoot,'installer.log'));}
export function main(args){
 process.env.PATH=[path.dirname(process.execPath),process.env.PATH].join(path.delimiter);
 const command=args[0],target=args[1]||'none';assertIdle(dataRoot);
 if(command==='check'){if(args[1]&&newer(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version,args[1]))throw new Error('Downgrade refused; install the current or a newer version.');if(fs.existsSync(marker))run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'installer/stop-desktop.ps1'),'-AppRoot',root,'-DataRoot',dataRoot]);return;}
 if(command==='install'){
  if(!['none','codex','claude','both'].includes(target))throw new Error('Invalid integration target');
  fs.mkdirSync(dataRoot,{recursive:true});fs.writeFileSync(marker,JSON.stringify({schemaVersion:1,dataRoot,port:8792},null,2));
  const previous=fs.existsSync(receipt)?JSON.parse(fs.readFileSync(receipt,'utf8')):{targets:[]};
  if(target!=='none')run(process.execPath,[path.join(root,'scripts/install.js'),'--target',target,'--skip-audio']);
  const targets=new Set(previous.targets);if(['codex','both'].includes(target))targets.add('codex');if(['claude','both'].includes(target))targets.add('claude');
  fs.writeFileSync(receipt,JSON.stringify({root,targets:[...targets]},null,2));return;
 }
 if(command==='uninstall'){
  const installed=fs.existsSync(receipt)?JSON.parse(fs.readFileSync(receipt,'utf8')):{targets:[]};
  if(installed.targets.includes('codex')){
   const dir=path.join(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),'skills','openmeeting');
   // Remove only our known files; preserve additions and another checkout's skill.
   if(ownedSkill(dir,root)){for(const name of ['SKILL.md','runtime.json','agents/openai.yaml','scripts/openmeeting.ps1']){const file=path.join(dir,name);if(fs.existsSync(file)&&!fs.lstatSync(file).isSymbolicLink())fs.unlinkSync(file);}for(const name of ['agents','scripts',''])try{fs.rmdirSync(path.join(dir,name));}catch{}}
  }
  if(installed.targets.includes('claude')){
   // A later checkout may have taken ownership. Verify the marketplace path first.
   const config=process.env.CLAUDE_CONFIG_DIR||path.join(os.homedir(),'.claude');let known;
   try{known=JSON.parse(fs.readFileSync(path.join(config,'plugins','known_marketplaces.json'),'utf8'))['openmeeting-local'];}catch{}
   if(known?.installLocation&&path.resolve(known.installLocation)===root){for(const args of [['plugin','uninstall','openmeeting@openmeeting-local'],['plugin','marketplace','remove','openmeeting-local']]){const result=runClaude(args);if(result.error||result.status!==0)throw new Error('Claude cleanup failed: '+result.stderr);}}
  }
  return;
 }
 throw new Error('Unknown installer command');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{main(process.argv.slice(2));}catch(error){console.error(error.message);process.exitCode=1;}}
