import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spec} from './harness.js';
import {selectMeetingAccount,bindAccountUrl,verifyMeetingAccount,nativeAccountChooserUrl} from '../../src/meet/account.js';
import {joinMeeting} from '../../src/meet/join.js';
const url='https://meet.google.com/abc-defg-hij?hl=en',chosen='b@example.invalid';
const bridge='https://meet.google.com/landing?authuser=1';
const avatar=value=>`<a role="button" aria-label="Google Account: Selected B (${value})">Account</a>`;
const prejoin=(labels)=>`<script>globalThis.joinClicks=0;function join(){joinClicks++;document.getElementById('identity')?.remove();document.getElementById('join').remove();document.body.insertAdjacentHTML('beforeend','<button aria-label="Leave call">Leave call</button><button aria-label="Turn on captions">Turn on captions</button>');}</script><div id="identity">${labels.map(label=>`<div><div title="Selected account">${label}</div><a href="https://accounts.google.com/AccountChooser">Switch account</a></div>`).join('')}</div><button id="join" onclick="join()">Join now</button>`;
async function nativeFixture(page,{actual=chosen,auto=false,signedOut=false,prejoinEmails=[chosen]}={}) {
  await page.route('https://accounts.google.com/**',route=>{
    const signin=new URL(route.request().url()).pathname.includes('/signin/');
    const body=signedOut&&!signin?'<script>location.replace("https://accounts.google.com/v3/signin/identifier")</script>':auto?`<script>location.replace('${bridge}')</script>`:signin?
      `<h1>Google sign in</h1><label>Email or phone<input type="email" onkeydown="if(event.key==='Enter')location.href='${bridge}'"></label><button onclick="location.href='${bridge}'">Next</button>`:
      `<h1>Choose an account</h1><div role="link" tabindex="0" onclick="location.href='${bridge}'"><span>Default A</span><div data-email="a@example.invalid">a@example.invalid</div></div><div role="link" tabindex="0" onclick="location.href='${bridge}'"><span>Selected B</span><div data-email="${chosen}">${chosen}</div></div><a href="https://accounts.google.com/v3/signin/identifier">Use another account</a>`;
    return route.fulfill({contentType:'text/html',body});
  });
  await page.route('https://meet.google.com/**',route=>route.fulfill({contentType:'text/html',body:
    ['/landing','/home'].includes(new URL(route.request().url()).pathname)?avatar(actual):prejoin(prejoinEmails)}));
}
async function start(page,options={}) {
  const pending=selectMeetingAccount(page,{url,timeoutMs:5000,...options});
  await page.getByRole('heading',{name:'Choose an account'}).waitFor();return {pending};
}
spec(test,'NATIVE-01 always opens Google native chooser without a local account page',async({page,context})=>{
  await nativeFixture(page);const requests=[];context.on('request',r=>requests.push(r.url()));
  const {pending}=await start(page);
  assert.equal(new URL(page.url()).origin,'https://accounts.google.com');
  assert.equal(requests.some(u=>u.startsWith('http://127.0.0.1')),false);
  assert.equal(requests.some(u=>u.includes('/abc-defg-hij')),false);
  await page.getByText('Selected B',{exact:true}).click();assert.equal(await pending,chosen);
});
spec(test,'NATIVE-02 native second account choice binds and verifies actual Meet prejoin header',async({page})=>{
  await nativeFixture(page);const {pending}=await start(page);await page.getByText('Selected B',{exact:true}).click();const selected=await pending;
  let checks=0;await joinMeeting(page,{url:bindAccountUrl(url,selected),displayName:'QA',pollMs:1,inCallPolls:1,beforeJoin:async()=>{
    const identity=await verifyMeetingAccount(page,selected);assert.equal(identity.identityVerified,true);checks++;
  }});
  assert.equal(new URL(page.url()).searchParams.get('authuser'),chosen);assert.equal(checks,1);
  assert.equal(await page.evaluate(()=>globalThis.joinClicks),1);
});
for(const [kind,labels] of [['wrong',['a@example.invalid']],['missing',[]],['ambiguous',['a@example.invalid',chosen]]])spec(test,`NATIVE-03 ${kind} Meet identity prevents join`,async({page})=>{
  await nativeFixture(page,{prejoinEmails:labels});
  await assert.rejects(joinMeeting(page,{url:bindAccountUrl(url,chosen),displayName:'QA',pollMs:1,
    beforeJoin:()=>verifyMeetingAccount(page,chosen,{timeoutMs:100})}),e=>e.code==='signin_required');
  assert.equal(await page.evaluate(()=>globalThis.joinClicks),0);
});
spec(test,'NATIVE-04 Google returning a different authenticated account rejects the choice',async({page})=>{
  await nativeFixture(page,{actual:'a@example.invalid'});
  const pending=assert.rejects(selectMeetingAccount(page,{url,timeoutMs:5000}),e=>e.code==='signin_required'&&/did not match/.test(e.message));
  await page.getByText('Selected B',{exact:true}).click();await pending;
});
spec(test,'NATIVE-05 automatic default-account redirect without user selection is rejected',async({page})=>{
  await nativeFixture(page,{auto:true});
  await assert.rejects(selectMeetingAccount(page,{url,timeoutMs:5000}),e=>e.code==='signin_required'&&/without an explicit/.test(e.message));
});
spec(test,'NATIVE-06 use another account continues through native login without reading credentials',async({page})=>{
  await nativeFixture(page);const {pending}=await start(page);
  await page.getByRole('link',{name:'Use another account'}).click();
  await page.getByRole('textbox',{name:'Email or phone'}).fill(chosen);
  await page.getByRole('button',{name:'Next',exact:true}).click();assert.equal(await pending,chosen);
});
spec(test,'NATIVE-07 native chooser timeout never joins',async({page})=>{
  await nativeFixture(page);
  await assert.rejects(selectMeetingAccount(page,{url,timeoutMs:100}),e=>e.code==='signin_required'&&/timed out/.test(e.message));
});
spec(test,'NATIVE-08 closing chooser cancels without joining',async({page})=>{
  await nativeFixture(page);const pending=assert.rejects(selectMeetingAccount(page,{url,timeoutMs:5000}),e=>e.code==='signin_required'&&/closed/.test(e.message));
  await page.getByRole('heading',{name:'Choose an account'}).waitFor();await page.close();await pending;
});
spec(test,'NATIVE-09 stop during chooser preserves cancellation reason',async({page})=>{
  await nativeFixture(page);let stopped=false;
  const pending=assert.rejects(selectMeetingAccount(page,{url,timeoutMs:5000,shouldStop:()=>stopped?'user_stop':null}),e=>e.code==='aborted'&&e.reason==='user_stop');
  await page.getByRole('heading',{name:'Choose an account'}).waitFor();stopped=true;await pending;
});
spec(test,'NATIVE-10 arbitrary page emails cannot substitute for native account identity',async({page})=>{
  await page.route('https://meet.google.com/**',route=>route.fulfill({contentType:'text/html',body:`<p>${chosen}</p><div>Someone says Google Account: ${chosen}</div>`}));
  await page.goto(bindAccountUrl(url,chosen));
  await assert.rejects(verifyMeetingAccount(page,chosen,{timeoutMs:100}),e=>e.code==='signin_required');
});
test('NATIVE-11 native chooser never includes meeting admission path or unsafe host',()=>{
  const chooser=new URL(nativeAccountChooserUrl(url));assert.equal(chooser.origin,'https://accounts.google.com');
  assert.equal(chooser.searchParams.get('continue'),'https://meet.google.com/landing');
  assert.throws(()=>nativeAccountChooserUrl('https://evil.invalid/'));assert.throws(()=>bindAccountUrl(url,'1'));
});

spec(test,'NATIVE-12 signed-out native keyboard login continues without reading input values',async({page})=>{
  await nativeFixture(page,{signedOut:true});const pending=selectMeetingAccount(page,{url,timeoutMs:5000});
  await page.getByRole('textbox',{name:'Email or phone'}).fill(chosen);
  await page.getByRole('textbox',{name:'Email or phone'}).press('Enter');assert.equal(await pending,chosen);
});
