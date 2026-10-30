import fs from 'node:fs';import path from 'node:path';import {spawn,spawnSync} from 'node:child_process';import {root} from './manage.js';
const config=JSON.parse(fs.readFileSync(path.join(root,'installation.json'),'utf8'));
const url='http://127.0.0.1:'+config.port;
const env={...process.env,OPENMEETING_HOME:config.dataRoot,PATH:[path.dirname(process.execPath),process.env.PATH].join(path.delimiter)};
const ready=async()=>{try{const response=await fetch(url+'/api/meetings',{signal:AbortSignal.timeout(1500)});return response.ok;}catch{return false;}};
if(!await ready()){
 fs.mkdirSync(config.dataRoot,{recursive:true});const log=fs.openSync(path.join(config.dataRoot,'desktop.log'),'a');
 const child=spawn(process.execPath,[path.join(root,'bin/openmeeting.js'),'live','latest','--port',String(config.port),'--no-open'],{cwd:root,env,detached:true,windowsHide:true,stdio:['ignore',log,log]});fs.writeFileSync(path.join(config.dataRoot,'desktop.pid'),String(child.pid));child.unref();fs.closeSync(log);
 const end=Date.now()+20000;while(!await ready()){if(Date.now()>end)throw new Error('Workspace startup timed out. See desktop.log.');await new Promise(resolve=>setTimeout(resolve,250));}
}
spawnSync('rundll32.exe',['url.dll,FileProtocolHandler',url],{windowsHide:true});
