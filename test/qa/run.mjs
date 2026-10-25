#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');process.chdir(root);
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const output=path.resolve('test/.tmp/qa','regression-'+stamp);fs.mkdirSync(output,{recursive:true});
const repetitions=process.argv.includes('--once')?1:2;
const reproduce=process.argv.includes('--reproduce-bugs');
const supplement=process.argv.includes('--supplement');
const report={started:new Date().toISOString(),output,repetitions,reproduce,supplement,groups:[]};
const python=process.env.QA_PYTHON || path.join(root,'.venv-stt',process.platform==='win32'?'Scripts/python.exe':'bin/python');
const env={...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',HF_HUB_OFFLINE:'1',HF_HUB_DISABLE_TELEMETRY:'1'};
// Real-device/private fixture tests are opt-in and must not inherit a user's old audio paths.
for(const key of ['OPENMEETING_MIC_BROWSER_WAV','OPENMEETING_MIC_TEST_PCM','OPENMEETING_TEAMS_BROWSER_WAV','OPENMEETING_TEAMS_AUTO_TEST','OPENMEETING_TEAMS_NATIVE_TEST','OPENMEETING_REPLAY_WAV'])delete env[key];
for(const key of Object.keys(env))if(key.startsWith('OPENMEETING_REPLAY_') || key==='OPENMEETING_SPEAKER_TEST_EMBEDDINGS')delete env[key];
if(reproduce)env.QA_REPRODUCE_BUGS='1';else delete env.QA_REPRODUCE_BUGS;
function execute(command,args,{name,cwd=root,extra={}}) {
  return new Promise(resolve=>{
    const file=path.join(output,name+'.log');const log=fs.createWriteStream(file);let text='';
    const child=spawn(command,args,{cwd,env:{...env,...extra},windowsHide:true,stdio:['ignore','pipe','pipe']});
    const collect=chunk=>{log.write(chunk);text+=chunk.toString();};child.stdout.on('data',collect);child.stderr.on('data',collect);
    child.on('error',error=>collect(Buffer.from(error.stack)));
    child.on('close',code=>{log.end();const count=key=>Number(text.match(new RegExp('(?:#|ℹ) '+key+' (\\d+)'))?.[1] || 0);
      const row={name,code,log:file,tests:count('tests'),pass:count('pass'),fail:count('fail'),skipped:count('skipped')};
      report.groups.push(row);console.log(JSON.stringify(row));resolve(row);});
  });
}
for(let round=1;round<=repetitions;round++) {
  const base=['--test','--test-concurrency=1','--experimental-test-coverage','--test-coverage-include=src/**/*.js'];
  if(!supplement)await execute(process.execPath,[...base,'test/unit/**/*.test.js'],{name:`round-${round}-legacy-unit`});
  // These controlled integrations never join external conferences or use device/model fixtures.
  const integration=supplement?['chrome-launch','launcher','microphone-browser','microphone','mock-meet.smoke','stt','teams-auto','teams-browser']
    .map(name=>`test/integration/${name}.test.js`):['test/integration/**/*.test.js'];
  await execute(process.execPath,[...base,'--test-skip-pattern=make-tts-wav.ps1 \\+ runTranscribe',...integration],
    {name:`round-${round}-${supplement?'additional':'controlled'}-integration`});
  if(!supplement)await execute(process.execPath,[...base,'test/qa/*.test.js'],{name:`round-${round}-strict-qa`,extra:{QA_OUTPUT:path.join(output,'round-'+round)}});
  if(!supplement)await execute(python,[path.join(root,'test/qa/python-coverage.py'),'--out',path.join(output,`round-${round}-python-coverage.json`)],
    {name:`round-${round}-python`,cwd:path.join(root,'stt')});
}
for(const group of report.groups)if(group.name.endsWith('-python')) {
  const log=fs.readFileSync(group.log,'utf8');group.tests=Number(log.match(/Ran (\d+) tests?/)?.[1] || 0);
  group.skipped=Number(log.match(/skipped=(\d+)/)?.[1] || 0);group.pass=group.code===0?group.tests-group.skipped:0;
}
if(!supplement)await execute(process.execPath,[path.join(root,'test/qa/coverage.mjs'),output],{name:'browser-coverage-audit'});
report.finished=new Date().toISOString();report.success=report.groups.every(x=>x.code===0);
fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2)+'\n');
fs.writeFileSync('test/.tmp/qa/latest.json',JSON.stringify({output,results:path.join(output,'results.json')},null,2)+'\n');
console.log(`QA_RESULTS=${path.join(output,'results.json')}`);process.exitCode=report.success?0:1;
