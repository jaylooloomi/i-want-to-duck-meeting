import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';
const suites=JSON.parse(fs.readFileSync(new URL('./ui-suites.json',import.meta.url),'utf8')),suite=process.argv.includes('--recent')?'test:ui:recent':'test:ui',files=suites[suite];
for(const file of files)if(!fs.existsSync(file))throw Error('Missing UI suite: '+file);
const startedAt=new Date().toISOString(),root=path.resolve(process.env.QA_OUTPUT||'test/.tmp/qa/ui-'+startedAt.replace(/[:.]/g,'-'));fs.mkdirSync(root,{recursive:true});
const output=path.join(root,'run.log');console.log('UI evidence: '+root);let log='';
const child=spawn(process.execPath,['--test','--test-reporter=spec','--test-concurrency='+ (process.argv.includes('--serial')?'1':'2'),...files],{env:{...process.env,QA_OUTPUT:root},windowsHide:true,stdio:['ignore','pipe','pipe']});
for(const [stream,dest] of [[child.stdout,process.stdout],[child.stderr,process.stderr]])stream.on('data',chunk=>{log+=chunk;fs.appendFileSync(output,chunk);dest.write(chunk)});
child.on('error',error=>{console.error(error);process.exitCode=1});
child.on('exit',code=>{const count=key=>Number(log.match(new RegExp('(?:ℹ|#) '+key+' (\\d+)'))?.[1]||0);fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({suite,files,startedAt,finishedAt:new Date().toISOString(),exitCode:code,tests:count('tests'),passed:count('pass'),failed:count('fail'),skipped:count('skipped')},null,2));process.exitCode=code??1});
