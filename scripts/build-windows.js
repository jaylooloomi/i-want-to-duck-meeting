import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';
const root=process.cwd(),version=JSON.parse(fs.readFileSync('package.json','utf8')).version;
const dist=path.join(root,'dist'),payload=path.join(dist,'payload'),cache=path.join(root,'test','.tmp','installer-tools');
const nodeVersion='24.13.0',zipName=`node-v${nodeVersion}-win-x64.zip`;
fs.mkdirSync(cache,{recursive:true});fs.mkdirSync(dist,{recursive:true});
// Packaging only permits known runtime trees, never the checkout/data root recursively.
// This exact build-output directory is owned by this script; do not reuse stale payloads.
if(path.dirname(payload)!==dist||path.basename(payload)!=='payload')throw new Error('Unsafe payload path');
fs.rmSync(payload,{recursive:true,force:true});fs.mkdirSync(payload,{recursive:true});
const trees=['bin','src','scripts','stt','plugin','codex','.claude-plugin','installer'];
for(const tree of trees)fs.cpSync(tree,path.join(payload,tree),{recursive:true,filter:source=>!source.includes('__pycache__')&&!source.endsWith('.pyc')&&!source.endsWith(path.join('meet','SKILL.md'))});
for(const file of ['package.json','package-lock.json','LICENSE','README.md','README.zh-TW.md'])fs.copyFileSync(file,path.join(payload,file));
fs.mkdirSync(path.join(payload,'node_modules'),{recursive:true});fs.cpSync('node_modules/playwright-core',path.join(payload,'node_modules/playwright-core'),{recursive:true});
async function download(url,file){const response=await fetch(url,{signal:AbortSignal.timeout(180000)});if(!response.ok)throw new Error(url+': '+response.status);fs.writeFileSync(file,Buffer.from(await response.arrayBuffer()));}
const zip=path.join(cache,zipName);if(!fs.existsSync(zip))await download(`https://nodejs.org/dist/v${nodeVersion}/${zipName}`,zip);
const response=await fetch(`https://nodejs.org/dist/v${nodeVersion}/SHASUMS256.txt`,{signal:AbortSignal.timeout(60000)});if(!response.ok)throw new Error('Node checksums unavailable');const sums=await response.text();const expected=sums.split(/\r?\n/).find(line=>line.endsWith('  '+zipName))?.slice(0,64);
if(!expected||createHash('sha256').update(fs.readFileSync(zip)).digest('hex')!==expected)throw new Error('Node runtime checksum mismatch');
const extract=path.join(cache,'node-extracted');if(!fs.existsSync(extract)){const script=`Expand-Archive -LiteralPath '${zip.replace(/'/g,"''")}' -DestinationPath '${extract.replace(/'/g,"''")}' -Force`;const result=spawnSync('powershell.exe',['-NoProfile','-Command',script],{stdio:'inherit',windowsHide:true});if(result.status!==0)throw new Error('Node extraction failed');}
fs.mkdirSync(path.join(payload,'runtime'),{recursive:true});for(const file of ['node.exe','LICENSE'])fs.copyFileSync(path.join(extract,`node-v${nodeVersion}-win-x64`,file),path.join(payload,'runtime',file));
const compiler=process.env.ISCC_PATH;if(!compiler||!fs.existsSync(compiler))throw new Error('Set ISCC_PATH to the official Inno Setup compiler');
const result=spawnSync(compiler,[`/DAppVersion=${version}`,`/DPayloadDir=${payload}`,`/DOutputDir=${dist}`,'installer/windows.iss'],{stdio:'inherit',windowsHide:true});if(result.error||result.status!==0)throw new Error('Installer compilation failed');
const name=`DuckMeeting-${version}-Setup-x64.exe`,hash=createHash('sha256').update(fs.readFileSync(path.join(dist,name))).digest('hex');fs.writeFileSync(path.join(dist,'SHA256SUMS.txt'),hash+'  '+name+'\n');console.log('INSTALLER='+path.join(dist,name));
