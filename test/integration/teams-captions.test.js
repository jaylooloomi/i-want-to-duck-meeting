import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {launchChrome,connectChrome} from '../../src/chrome.js';
import {installTeamsCaptionTap} from '../../src/teams-captions.js';
import {configureTeamsPage} from '../../src/teams-browser.js';

test('real Chrome receives local/remote channel captions and V2 events without breaking originals', {timeout:60000},async t=>{
  const root=path.resolve('test/.tmp/teams-native-'+randomUUID());
  const chrome=await launchChrome({profileDir:root,headless:true});
  let browser;
  t.after(async()=>{await browser?.close().catch(()=>{});await chrome.close();fs.rmSync(root,{recursive:true,force:true});});
  const connected=await connectChrome(chrome.cdpUrl);browser=connected.browser;
  const {context,page}=connected;const received=[];
  await context.exposeBinding('__omTeamsCaption',(_,e)=>received.push(e));
  await context.addInitScript(installTeamsCaptionTap);
  // Fulfill a Teams URL locally. No request is sent to Microsoft or a meeting.
  await context.route('https://teams.live.com/**',route=>route.fulfill({contentType:'text/html',body:'<body>local mock</body>'}));
  await page.goto('https://teams.live.com/light-meetings/mock');
  const originalResult=await page.evaluate(()=>{
    const pc=new RTCPeerConnection();window.testPC=pc;
    const ch=pc.createDataChannel('main-channel');
    const encode=r=>new TextEncoder().encode('prefix'+JSON.stringify({recognitionResults:[r]})).buffer;
    const r={id:'u/1',userId:'phone',timestampAudioSent:123,text:'手機端 Microsoft Teams 1357'};
    ch.dispatchEvent(new MessageEvent('message',{data:encode(r)}));
    const remote=pc.createDataChannel('main-channel');pc.dispatchEvent(new RTCDataChannelEvent('datachannel',{channel:remote}));
    remote.dispatchEvent(new MessageEvent('message',{data:encode({...r,id:'u/2',text:'完整手機端 Microsoft Teams 1357'})}));
    ch.dispatchEvent(new MessageEvent('message',{data:new Uint8Array([1,2,3]).buffer}));
    function remoteUserEventsReceived() {}
    remoteUserEventsReceived.handler=function(){window.originalCalls=(window.originalCalls||0)+1;return 'original-result';};
    const call={dataChannel:{subscriptions:[{eventHandler:{on:remoteUserEventsReceived}}]},
      startClosedCaption(){window.captionStarted=true;},closedCaptionsHaveBeenStarted(){return !!window.captionStarted;}};
    window.testCall=call;window.msteamscalling={deref:()=>({callingService:{getActiveCall:()=>call}})};
    return pc instanceof RTCPeerConnection;
  });
  assert.equal(originalResult,true);
  await page.waitForFunction(()=>window.captionStarted);
  const result=await page.evaluate(()=>window.testCall.dataChannel.subscriptions[0].eventHandler.on.handler('3',JSON.stringify({recognitionResults:[{id:'second/1',userId:'computer',timestampAudioSent:456,text:'電腦端 2468'}]})));
  assert.equal(result,'original-result');
  await page.waitForFunction(()=>window.originalCalls===1);
  assert.equal(received.length,3);assert.equal(received[1].revision,2);assert.match(received[1].text,/1357/);
  await page.evaluate(()=>{clearInterval(window.__omTeamsTap.timer);window.testPC.close();});
});

test('real Chrome configures joining, mute, captions and language on controlled Teams UI', {timeout:60000},async t=>{
  const root=path.resolve('test/.tmp/teams-ui-'+randomUUID());
  const chrome=await launchChrome({profileDir:root,headless:true});let browser;
  t.after(async()=>{await browser?.close().catch(()=>{});await chrome.close();fs.rmSync(root,{recursive:true,force:true});});
  const connected=await connectChrome(chrome.cdpUrl);browser=connected.browser;
  const {context,page}=connected;
  await context.route('https://teams.live.com/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<body>
    <input aria-label="Your name"><input type="checkbox" role="switch" aria-label="Microphone" checked>
    <input type="checkbox" role="switch" aria-label="Camera" checked>
    <button onclick="window.joined=true;document.querySelector('#call').hidden=false;this.remove()">Join now</button>
    <div id="call" hidden><button>Leave</button>
    <button id="closed-captions-button" onclick="window.captions=true">Show live captions</button>
    <button data-tid="closed-captions-settings-menu-trigger-button" onclick="document.querySelector('#settings').hidden=false">Caption settings</button>
    <div id="settings" hidden><div role="menuitem">Language settings</div>
    <select aria-label="Meeting spoken language"><option>English</option><option>中文（台灣）</option></select>
    <button onclick="window.updated=document.querySelector('select').value">Update</button></div></div></body>`}));
  await page.goto('https://teams.live.com/light-meetings/mock');
  assert.equal(await configureTeamsPage(page,{displayName:'測試旁聽'}),'joining');
  assert.equal(await page.getByRole('textbox').inputValue(),'測試旁聽');
  assert.equal(await page.getByRole('switch',{name:'Microphone'}).isChecked(),false);
  assert.equal(await page.getByRole('switch',{name:'Camera'}).isChecked(),false);
  assert.equal(await configureTeamsPage(page),'in_call');
  assert.deepEqual(await page.evaluate(()=>({captions:window.captions,language:window.updated})),{captions:true,language:'中文（台灣）'});
});
