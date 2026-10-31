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
  assert.deepEqual(Object.keys(fixes).sort(),["codex/skills/openmeeting/SKILL.md","package.json","package-lock.json","plugin/.claude-plugin/plugin.json","plugin/skills/meet/SKILL.md.tmpl","scripts/install.js","src/audio-settings.js","src/cli.js","src/config.js","src/live-server.js","src/live/app.js","src/live/index.html","src/live/microphone.js","src/live/style.css","src/meet/account.js","src/meet/failure-guidance.js","src/meet/join.js","src/meet/login.js","src/session.js","src/teams-recording.js","src/worker.js","src/agent-summary.js","src/live/workspace.js","src/workspace-data.js","src/highlights.js","src/workspace-actions.js","src/live/emerald.css","src/live/theme.js","src/live/i18n.js","src/live/locales.js","src/mail-draft.js","src/live/mail.js","installer/manage.js","installer/desktop.js","installer/update.js","installer/launch.vbs","installer/audio.ps1","installer/update.ps1","installer/stop-desktop.ps1","installer/windows.iss","scripts/build-windows.js","scripts/test-windows-installer.js","scripts/install-plugin.js","src/summary-items.js","src/live/note-sources.js"].sort());
  for(const [file,hash] of Object.entries({...baseline,...fixes}))assert.equal(createHash('sha256').update(fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n'),'utf8').digest('hex'),hash,file);
});
test('QA-01 authored browser tests contain no hard sleeps CSS-class or XPath locator calls',()=>{
  for(const file of ['harness.js','frontend.test.js','e2e.test.js','meet-login.test.js','meet-account.test.js','agent-summary.test.js','sidebar.test.js','record-flow.test.js','language-presets.test.js','workspace.test.js','live-translation.test.js','highlights.test.js','visual-audit.test.js','capture-reference.mjs','capture-emerald.mjs','emerald.test.js','theme.test.js','i18n.test.js','i18n-layout.test.js','mail-draft.test.js','locale-geometry.test.js','search-highlights.test.js','transcript-scroll.test.js']) {
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
