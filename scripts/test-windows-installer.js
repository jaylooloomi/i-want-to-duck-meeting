// Actual per-user Setup / repair / upgrade / uninstall in an isolated data and skill root.
import fs from 'node:fs';import path from 'node:path';import {spawn,spawnSync} from 'node:child_process';import assert from 'node:assert/strict';
const version=JSON.parse(fs.readFileSync('package.json','utf8')).version,exe=path.resolve(`dist/DuckMeeting-${version}-Setup-x64.exe`);
const testRoot=path.resolve('test/.tmp/windows-installer-smoke'),app=path.join(testRoot,'app'),local=path.join(testRoot,'local'),codex=path.join(testRoot,'codex');fs.mkdirSync(testRoot,{recursive:true});
const withClaude=process.env.DUCK_TEST_CLAUDE==='1';
const env={...process.env,LOCALAPPDATA:local,CODEX_HOME:codex,CLAUDE_CONFIG_DIR:path.join(testRoot,'claude'),PATH:[process.env.SystemRoot+'/System32',process.env.SystemRoot+'/System32/WindowsPowerShell/v1.0',...(withClaude?[process.env.CLAUDE_CLI_DIR]:[])].join(';')};
const run=(file,args)=>{const result=spawnSync(file,args,{env,encoding:'utf8',windowsHide:true,timeout:180000});assert.ifError(result.error);assert.equal(result.status,0,result.stderr||result.stdout);return result.stdout;};
const setup=(installer=exe)=>run(installer,['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-',withClaude?'/TASKS=codex,claude':'/TASKS=codex','/DIR='+app,'/LOG='+path.join(testRoot,'setup.log')]);
// Never redirect an existing user's registered installation into this test root.
const reg=spawnSync('reg.exe',['query','HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{47E58D5A-13C9-41D9-B74B-52D4DD83FEE4}_is1','/v','InstallLocation'],{encoding:'utf8',windowsHide:true});if(reg.status===0&&!reg.stdout.includes(app))throw new Error('An existing Duck Meeting install is registered; run smoke tests in a separate Windows account.');
setup(process.env.DUCK_BASELINE_INSTALLER||exe);const node=path.join(app,'runtime/node.exe'),cli=path.join(app,'bin/openmeeting.js');const config=JSON.parse(fs.readFileSync(path.join(app,'installation.json'),'utf8'));assert.equal(config.dataRoot,path.join(local,'DuckMeeting/data'));const skill=path.join(codex,'skills/openmeeting/runtime.json');assert.equal(JSON.parse(fs.readFileSync(skill,'utf8')).nodePath,node);assert.match(fs.readFileSync(path.join(codex,'skills/openmeeting/SKILL.md'),'utf8'),/127\.0\.0\.1:8792/);
assert.match(run(node,[cli,'--help']),/openmeeting/);const sentinel=path.join(config.dataRoot,'preserve.txt');fs.writeFileSync(sentinel,'keep my data');
fs.mkdirSync(path.join(config.dataRoot,'meetings','smoke'),{recursive:true});fs.writeFileSync(path.join(config.dataRoot,'meetings/smoke/status.json'),JSON.stringify({id:'smoke',state:'done',title:'Synthetic installer test'}));
const server=spawn(node,[cli,'live','latest','--port','18792'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
await new Promise((resolve,reject)=>{let out='';server.stdout.on('data',chunk=>{out+=chunk;if(out.includes('LIVE_URL='))resolve();});server.once('exit',code=>reject(new Error('Installed server exited: '+code)));server.once('error',reject);});
try{const data=await (await fetch('http://127.0.0.1:18792/api/meetings')).json();assert.ok(data.some(m=>m.id==='smoke'));assert.equal((await fetch('http://127.0.0.1:18792/')).status,200);}finally{server.kill();await new Promise(resolve=>server.once('exit',resolve));}
setup();assert.equal(fs.readFileSync(sentinel,'utf8'),'keep my data');assert.ok(fs.existsSync(skill));
assert.equal(JSON.parse(fs.readFileSync(path.join(app,'package.json'),'utf8')).version,version);
assert.notEqual(spawnSync(node,[path.join(app,'installer/manage.js'),'check','0.1.0'],{env,windowsHide:true}).status,0,'downgrade must be refused');
run(path.join(app,'unins000.exe'),['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/LOG='+path.join(testRoot,'uninstall.log')]);assert.equal(fs.readFileSync(sentinel,'utf8'),'keep my data');assert.equal(fs.existsSync(skill),false);assert.equal(fs.existsSync(node),false);
console.log('INSTALLER_SMOKE=ok (bundled runtime, isolated Codex install, HTTP workspace, repair/upgrade, uninstall, data preservation)');
