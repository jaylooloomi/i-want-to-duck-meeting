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

test('panel controls the real session: manual start, pause, resume, live captions and normal finish',{timeout:90000},async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'panel-session-')), mock=await startMockMeet();
  const config=getConfig({OPENMEETING_HOME:home,OPENMEETING_HEADLESS:'1',OPENMEETING_ALLOW_ANY_HOST:'1',OPENMEETING_MANUAL_START:'1',OPENMEETING_POLL_MS:'100'});
  const dir=path.join(config.meetingsDir,'synthetic-panel');let guard;
  const sample = value => {
    const pcm=Buffer.alloc(512);
    for(let offset=0;offset<pcm.length;offset+=2) pcm.writeInt16LE(value,offset);
    return pcm;
  };
  const injectAudio = (page,value) => page.evaluate(pcm=>window.__omAudio(pcm),sample(value).toString('base64'));
  try {
    const result=await runSession({config,dir,id:'synthetic-panel',code:'abc-defg-hij',url:mock.urlFor('abc-defg-hij',{scenario:'happy',lobbyMs:100,captionLeadMs:60000,endAfterMs:999999}),hooks:{
      onPage:async page=>{guard=consoleGuard(page);},
      afterReady:async page=>{
        assert.equal(readStatus(dir).stats.audioPeak,0);
        await injectAudio(page, 19751);
        await page.getByRole('button',{name:'開始記錄',exact:true}).click();
        await page.evaluate(()=>window.__omCaptions({ts:Date.now(),blocks:[{id:'a',speaker:'測試',text:'開始後1357'}]}));
        await page.getByRole('log',{name:'即時逐字稿'}).getByText(/開始後1357/).waitFor({timeout:5000});
        await injectAudio(page, 19752);
        await page.getByRole('button',{name:'暫停記錄',exact:true}).click();
        await page.getByRole('status').filter({hasText:'已暫停'}).waitFor();
        await injectAudio(page, 19753);
        await page.evaluate(()=>window.__omCaptions({ts:Date.now()+1,blocks:[{id:'b',speaker:'測試',text:'暫停不應保存'}]}));
        await page.getByRole('button',{name:'開始記錄',exact:true}).click();
        await page.evaluate(()=>window.__omCaptions({ts:Date.now()+2,blocks:[{id:'b',speaker:'測試',text:'暫停不應保存，仍在畫面'},{id:'c',speaker:'測試',text:'恢復後2468'}]}));
        await page.getByRole('log',{name:'即時逐字稿'}).getByText(/恢復後2468/).waitFor({timeout:5000});
        await injectAudio(page, 19754);
        await page.getByRole('button',{name:'結束記錄',exact:true}).click();
      },
    }});
    guard.assertClean(); assert.equal(result.state,'done');assert.equal(result.endReason,'user_stop');
    const text=fs.readFileSync(path.join(dir,'transcript.md'),'utf8');
    assert.match(text,/開始後1357/);assert.match(text,/恢復後2468/);assert.doesNotMatch(text,/暫停不應保存/);
    const wav=fs.readFileSync(path.join(dir,'audio.wav'));
    assert.equal(wav.includes(sample(19751)), false, 'before manual start');
    assert.equal(wav.includes(sample(19752)), true, 'while recording');
    assert.equal(wav.includes(sample(19753)), false, 'while paused');
    assert.equal(wav.includes(sample(19754)), true, 'after resuming');
    assert.equal(readStatus(dir).panelReview.state,'draft_ready');
    const draft=JSON.parse(fs.readFileSync(path.join(dir,'meeting-report.auto.json'),'utf8'));
    assert.ok(draft.summary.some(item=>item.text.includes('開始後1357')));
    assert.deepEqual(draft.decisions, []);
    assert.deepEqual(draft.actionItems, []);
    assert.equal(fs.existsSync(path.join(dir,'summary.md')), false);
    assert.equal(readStatus(dir).recordingControl.intervals.length,4);
  }finally{await mock.close();fs.rmSync(home,{recursive:true,force:true});}
});
