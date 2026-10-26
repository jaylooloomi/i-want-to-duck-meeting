import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {consoleGuard} from './harness.js';

test('QA-01 production content matches the audit baseline plus explicitly authorized fixes',()=>{
  const baseline=JSON.parse(fs.readFileSync('docs/qa/production-baseline.json','utf8'));
  const fixes=JSON.parse(fs.readFileSync('docs/qa/authorized-fixes.json','utf8'));
  assert.deepEqual(Object.keys(fixes).sort(),["codex/skills/openmeeting/SKILL.md", "plugin/skills/meet/SKILL.md.tmpl", "scripts/install.js", "src/cli.js", "src/config.js", "src/live-server.js", "src/live/app.js", "src/live/microphone.js", "src/meet/account.js", "src/meet/failure-guidance.js", "src/meet/join.js", "src/meet/login.js", "src/session.js", "src/transcript/alignment.js", "src/transcript/crosscheck.js", "src/transcript/minutes.js", "src/meeting-panel.js", "src/page/meeting-panel.js", "src/panel-finish.js", "src/teams-browser.js", "src/teams-recording.js", "src/stt.js"].sort());
  for(const [file,hash] of Object.entries({...baseline,...fixes}))assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'),hash,file);
});
test('QA-01 authored browser tests contain no hard sleeps CSS-class or XPath locator calls',()=>{
  for(const file of ['harness.js','frontend.test.js','e2e.test.js','meet-login.test.js','meet-account.test.js','meeting-panel.test.js']) {
    const source=fs.readFileSync(path.join('test/qa',file),'utf8');
    assert.doesNotMatch(source,/\bwaitForTimeout\s*\(|\bsleep\s*\(|\bsetTimeout\s*\(/,file);
    assert.doesNotMatch(source,/\.locator\s*\(|xpath=|querySelector\s*\(/,file);
  }
});
test('QA-01 shared guard fails on both console errors and uncaught page exceptions',()=>{
  for(const type of ['pageerror','console']) {
    const page=new EventEmitter(),guard=consoleGuard(page);guard.assertClean();
    page.emit(type,type==='pageerror'?new Error('uncaught QA probe'):{type:()=> 'error',text:()=> 'framework error',location:()=>({})});
    assert.throws(()=>guard.assertClean(),/Zero console/);assert.equal(guard.errors.length,1);
  }
});
