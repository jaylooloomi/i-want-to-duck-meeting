import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {readMeetingPreferences,saveMeetingPreferences,resolveMeetingLanguage,DEFAULT_PREFERENCES} from '../../src/meeting-preferences.js';
import {getConfig} from '../../src/config.js';
import {main} from '../../src/cli.js';
import {readStatus,writeStatus} from '../../src/status.js';

function home(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'duck-language-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
test('PREF schema atomic revision, conflicts and corrupted data remain explicit',t=>{
 const root=home(t);assert.deepEqual(readMeetingPreferences(root).preferences,DEFAULT_PREFERENCES);
 const saved=saveMeetingPreferences(root,{...DEFAULT_PREFERENCES,spokenLanguage:'de',translationLanguage:'zh-TW',expectedRevision:null});assert.equal(saved.preferences.spokenLanguage,'de');assert.equal(saved.source,'saved');
 assert.throws(()=>saveMeetingPreferences(root,{...DEFAULT_PREFERENCES,expectedRevision:null}),/conflict/);
 for(const patch of [{spokenLanguage:'<script>'},{originalDisplay:'fr'},{arbitrary:true},{schemaVersion:2}])assert.throws(()=>saveMeetingPreferences(root,{...DEFAULT_PREFERENCES,...patch,expectedRevision:saved.revision}),/invalid/);
 assert.equal(readMeetingPreferences(root).revision,saved.revision);assert.equal(fs.existsSync(path.join(root,'meeting-preferences.lock')),false);
 fs.writeFileSync(path.join(root,'meeting-preferences.json'),'{broken');const broken=readMeetingPreferences(root);assert.ok(broken.warning);assert.equal(broken.preferences.spokenLanguage,'zh-TW');
 assert.equal(saveMeetingPreferences(root,{...DEFAULT_PREFERENCES,expectedRevision:broken.revision}).source,'saved');
});
test('PREF shared config precedence and immutable CLI join snapshot in a fresh invocation',async t=>{
 const root=home(t);saveMeetingPreferences(root,{...DEFAULT_PREFERENCES,spokenLanguage:'de',translationLanguage:'zh-TW',expectedRevision:null});
 const env={OPENMEETING_HOME:root,OPENMEETING_NO_BROWSER:'1',OPENMEETING_LAUNCHER:'spawn'};assert.equal(getConfig(env).captionLang,'de-DE');assert.equal(getConfig({...env,OPENMEETING_CAPTION_LANG:'ja-JP'}).captionLang,'ja-JP');
 assert.equal(resolveMeetingLanguage(getConfig(env),'en-US').originalDisplay,'en');
 let launch;const lines=[];const code=await main(['join','https://meet.google.com/abc-defg-hij'],{env,out:line=>lines.push(line),err:line=>lines.push(line),spawnWorker:async o=>{launch=o;return {pid:process.pid};}});assert.equal(code,0,lines.join('\n'));assert.equal(launch.captionLang,'de-DE');const snapshot=readStatus(launch.dir).languagePreferences;assert.equal(snapshot.originalDisplay,'de');assert.equal(snapshot.translationLanguage,'zh-TW');assert.ok(lines.some(line=>line.startsWith('LIVE_URL=')&&line.includes('primary=de&secondary=zh-TW')));
 const current=readMeetingPreferences(root);saveMeetingPreferences(root,{...DEFAULT_PREFERENCES,expectedRevision:current.revision});assert.deepEqual(readStatus(launch.dir).languagePreferences,snapshot);
 writeStatus(launch.dir,{state:'done'});const output=[];assert.equal(await main(['preferences','get'],{env,out:s=>output.push(s),err:()=>{}}),0);assert.equal(JSON.parse(output.join('')).effective.captionLanguage,'cmn-Hant-TW');
});
