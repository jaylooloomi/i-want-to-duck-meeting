import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { sttPython, setupStt } from './stt.js';

export function runSetupCommand(cmd,args,{env=process.env,log=console.log}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(cmd,args,{windowsHide:true,env,stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',d=>log(d.toString())); child.stderr.on('data',d=>log(d.toString()));
    child.on('error',reject); child.on('close',code=>code===0?resolve():reject(new Error(`audio_setup_failed: ${path.basename(cmd)} exited ${code}`)));
  });
}
export async function audioReady(config,{run=runSetupCommand}={}) {
  try {
    await run(sttPython(config),[path.join(config.repoRoot,'stt/setup_live.py'),'--model-dir',path.join(config.home,'models'),'--check'],
      {log:()=>{},env:{...process.env,HF_HUB_OFFLINE:'1',PYTHONIOENCODING:'utf-8'}});
    return true;
  } catch {return false;}
}
export async function setupAudio(config,{run=runSetupCommand,log=console.log,fetcher=fetch,setup=setupStt}={}) {
  const candidates=[path.join(config.home,'tools','uv.exe'),path.join(os.homedir(),'.local','bin','uv.exe'),path.join(os.homedir(),'.cargo','bin','uv.exe'),'uv'];
  let uv;
  for (const candidate of candidates) {try{await run(candidate,['--version'],{log:()=>{}});uv=candidate;break;}catch{}}
  if (!uv) {
    const tools=path.join(config.home,'tools'); fs.mkdirSync(tools,{recursive:true});
    const response=await fetcher('https://astral.sh/uv/install.ps1',{signal:AbortSignal.timeout(60000)});
    if(!response.ok) throw new Error(`uv_download_failed: HTTP ${response.status}`);
    const installer=path.join(tools,'install-uv.ps1'); fs.writeFileSync(installer,await response.text());
    const powershell=path.join(process.env.SystemRoot || 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    await run(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',installer],
      {log,env:{...process.env,UV_INSTALL_DIR:tools,UV_NO_MODIFY_PATH:'1',
        PSModulePath:[path.join(process.env.SystemRoot || 'C:\\Windows','System32','WindowsPowerShell','v1.0','Modules'),
          path.join(process.env.ProgramFiles || 'C:\\Program Files','WindowsPowerShell','Modules')].join(path.delimiter)}});
    uv=path.join(tools,'uv.exe');
  }
  await setup(config,{uv,log});
  await run(uv,['pip','install','--python',sttPython(config),'-r',path.join(config.repoRoot,'stt/requirements-live.txt')],{log});
  await run(sttPython(config),[path.join(config.repoRoot,'stt/setup_live.py'),'--model-dir',path.join(config.home,'models')],{log});
  log('AUDIO_SETUP=ready');
}
