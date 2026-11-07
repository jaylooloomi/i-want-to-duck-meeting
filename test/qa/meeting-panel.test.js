import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {browserCase,record} from './harness.js';
import {attachMeetingPanel,requestPanelStop} from '../../src/meeting-panel.js';
import {writeStatus} from '../../src/status.js';

for(const viewport of [{width:1920,height:1080},{width:390,height:844}])test(`PANEL-01 controls, safe live text and collapse ${viewport.width}`,{timeout:25000},t=>browserCase(t,async({page,app})=>{
  const dir=app.seed('panel',{state:'in_call',recordingControl:{enabled:false},stats:{audioSeconds:4,audioPeak:0,captionsOn:true}},[record('<script>window.pwned=true</script>')]);
  await attachMeetingPanel(page,{dir,origins:[app.url],canPause:true,onAction:async action=>{
    if(action==='stop')requestPanelStop(dir);else writeStatus(dir,{recordingControl:{enabled:action==='start'}});
  }});
  await page.goto(app.url);
  const start=page.getByRole('button',{name:'開始記錄',exact:true}), pause=page.getByRole('button',{name:'暫停記錄',exact:true});
  await start.waitFor({state:'visible'}); await start.click();
  await pause.waitFor({state:'visible'}); assert.equal(await start.isDisabled(),true);assert.equal(await pause.isEnabled(),true);
  await page.getByRole('log',{name:'即時逐字稿'}).getByText(/<script>/).waitFor();
  assert.equal(await page.evaluate(()=>window.pwned),undefined);
  await pause.click();assert.equal(await start.isEnabled(),true);
  await page.getByRole('button',{name:'收合 meeting AI 面板',exact:true}).click();
  assert.equal(await start.isVisible(),false);
  await page.getByRole('button',{name:'展開 meeting AI 面板',exact:true}).click();
  await page.getByRole('navigation',{name:'會議記錄控制'}).getByRole('button',{name:'結束記錄',exact:true}).click();
  assert.ok(fs.existsSync(path.join(dir,'STOP')));
  assert.equal(await page.getByRole('navigation',{name:'會議記錄控制'}).getByRole('button',{name:'結束記錄',exact:true}).isDisabled(),true);
},{viewport}));

test('PANEL-02 reload restores one panel and pending captions without changing native page controls',{timeout:25000},t=>browserCase(t,async({page,app})=>{
  const dir=app.seed('panel',{state:'in_call',stats:{audioPeak:120,audioSeconds:5,captionsOn:true}});
  fs.writeFileSync(path.join(dir,'live.json'),JSON.stringify({pending:[{speaker:'A',text:'即時測試1357'}]}));
  await attachMeetingPanel(page,{dir,origins:[app.url]});await page.goto(app.url);
  await page.getByRole('log',{name:'即時逐字稿'}).getByText(/即時測試1357/).waitFor();
  await page.reload();await page.getByRole('heading',{name:'meeting AI',exact:true}).waitFor();
  assert.equal(await page.getByRole('heading',{name:'meeting AI',exact:true}).count(),1);
  await page.getByRole('button',{name:/新增記錄/}).waitFor();
}));

test('PANEL-03 rejected actions show feedback and always release busy controls',{timeout:25000},t=>browserCase(t,async({page,app})=>{
  const dir=app.seed('panel',{state:'in_call',recordingControl:{enabled:false}});
  let release;const pending=new Promise(resolve=>{release=resolve;});let calls=0;
  await attachMeetingPanel(page,{dir,origins:[app.url],canPause:true,onAction:async()=>{calls++;await pending;throw new Error('測試拒絕');}});
  await page.goto(app.url);const start=page.getByRole('button',{name:'開始記錄',exact:true});await start.click();
  assert.equal(await start.isDisabled(),true);assert.equal(calls,1);release();
  await page.getByRole('alert').filter({hasText:'測試拒絕'}).waitFor();assert.equal(await start.isEnabled(),true);
}));

test('PANEL-04 non-meeting origins never receive a control panel',{timeout:20000},t=>browserCase(t,async({page,app})=>{
  const dir=app.seed('panel',{state:'in_call'});
  await attachMeetingPanel(page,{dir,origins:['https://meet.google.com']});await page.goto(app.url);
  await page.getByRole('button',{name:/新增記錄/}).waitFor();
  assert.equal(await page.getByRole('heading',{name:'meeting AI',exact:true}).count(),0);
}));

test('PANEL-05 host page and iframe cannot access the local recorder binding',{timeout:25000},t=>browserCase(t,async({page,app})=>{
  const dir=app.seed('panel',{state:'in_call'});let actions=0;
  await attachMeetingPanel(page,{dir,origins:[app.url],onAction:async()=>{actions++;}});await page.goto(app.url);
  await page.getByRole('heading',{name:'meeting AI',exact:true}).waitFor();
  const exposed=()=>Object.getOwnPropertyNames(window).filter(key=>key.startsWith('__omPanel')||key==='__omMeetingPanel');
  assert.deepEqual(await page.evaluate(exposed), []);
  const attached=page.waitForEvent('frameattached');
  await page.evaluate(()=>{const frame=document.createElement('iframe');frame.srcdoc='<p>local iframe</p>';document.body.append(frame);});
  const frame=await attached;await frame.waitForLoadState('domcontentloaded');
  assert.deepEqual(await frame.evaluate(exposed), []);
  assert.equal(actions,0);
  assert.equal(await frame.getByRole('heading',{name:'meeting AI',exact:true}).count(),0);
}));

test('PANEL-06 Meet origin uses closed shadow and exposes the accessible panel',{timeout:35000},t=>browserCase(t,async({page,app})=>{
  const dir=app.seed('panel',{state:'in_call'},[record('QA confidential caption')]);
  const origin='https://meet.google.com', url=origin+'/abc-defg-hij';
  await page.route(url, route=>route.fulfill({contentType:'text/html',body:'<main>Mock Meet</main>'}));
  await attachMeetingPanel(page,{dir,origins:[origin]});
  await page.goto(url);
  const cdp=await page.context().newCDPSession(page);
  try {
    // Playwright intentionally cannot pierce closed shadow. Verify the visible
    // content through Chrome's accessibility tree instead of weakening isolation.
    await page.getByText('Mock Meet',{exact:true}).waitFor();
    const signals=await cdp.send('Runtime.evaluate',{
      expression:`new Promise(resolve => {
        const until = performance.now() + 5000;
        function poll() {
          const host = document.getElementsByTagName('aside')[0];
          if (host || performance.now() >= until) resolve(!!host && host.shadowRoot === null);
          else requestAnimationFrame(poll);
        }
        poll();
      })`, awaitPromise:true,returnByValue:true,
    });
    assert.equal(signals.result.value,true);
    const tree=await cdp.send('Accessibility.getFullAXTree');
    assert.ok(tree.nodes.some(node=>node.name?.value==='meeting AI'));
    assert.equal(await page.getByText(/QA confidential caption/).count(),0);
  } finally {await cdp.detach();}
}));
