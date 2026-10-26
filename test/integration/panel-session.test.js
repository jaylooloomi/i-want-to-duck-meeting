import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {startMockMeet} from '../mock-meet/server.js';
import {runSession} from '../../src/session.js';
import {getConfig} from '../../src/config.js';
import {readStatus} from '../../src/status.js';
import {consoleGuard} from '../qa/harness.js';

test('panel controls the real session: manual start, pause, resume, live captions and finish draft',{timeout:90000},async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'panel-session-')), mock=await startMockMeet();
  const config=getConfig({OPENMEETING_HOME:home,OPENMEETING_HEADLESS:'1',OPENMEETING_ALLOW_ANY_HOST:'1',OPENMEETING_MANUAL_START:'1',OPENMEETING_POLL_MS:'100'});
  const dir=path.join(config.meetingsDir,'synthetic-panel');let guard;
  try {
    const result=await runSession({config,dir,id:'synthetic-panel',code:'abc-defg-hij',url:mock.urlFor('abc-defg-hij',{scenario:'happy',lobbyMs:100,captionLeadMs:60000,endAfterMs:999999}),hooks:{
      onPage:async page=>{guard=consoleGuard(page);},
      afterReady:async page=>{
        assert.equal(readStatus(dir).stats.audioPeak,0);
        await page.getByRole('button',{name:'開始記錄',exact:true}).click();
        await page.evaluate(()=>window.__omCaptions({ts:Date.now(),blocks:[{id:'a',speaker:'測試',text:'開始後1357'}]}));
        await page.getByRole('log',{name:'即時逐字稿'}).getByText(/開始後1357/).waitFor({timeout:5000});
        await page.getByRole('button',{name:'暫停記錄',exact:true}).click();
        await page.evaluate(()=>window.__omCaptions({ts:Date.now()+1,blocks:[{id:'b',speaker:'測試',text:'暫停不應保存'}]}));
        await page.getByRole('button',{name:'開始記錄',exact:true}).click();
        await page.evaluate(()=>window.__omCaptions({ts:Date.now()+2,blocks:[{id:'c',speaker:'測試',text:'恢復後2468'}]}));
        await page.getByRole('log',{name:'即時逐字稿'}).getByText(/恢復後2468/).waitFor({timeout:5000});
        await page.getByRole('button',{name:'結束並整理',exact:true}).click();
      },
    }});
    guard.assertClean(); assert.equal(result.state,'done');assert.equal(result.endReason,'user_stop');
    const text=fs.readFileSync(path.join(dir,'transcript.md'),'utf8');
    assert.match(text,/開始後1357/);assert.match(text,/恢復後2468/);assert.doesNotMatch(text,/暫停不應保存/);
    assert.ok(fs.existsSync(path.join(dir,'meeting-results.html')));assert.equal(readStatus(dir).panelReport.state,'partial');
    assert.equal(readStatus(dir).recordingControl.intervals.length,4);
  }finally{await mock.close();fs.rmSync(home,{recursive:true,force:true});}
});
