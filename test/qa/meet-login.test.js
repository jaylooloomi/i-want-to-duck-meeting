import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {accountHint, waitForGoogleLogin} from '../../src/meet/login.js';
import {joinMeeting} from '../../src/meet/join.js';
import {consoleGuard} from './harness.js';

const target='https://meet.google.com/abc-defg-hij?hl=en';
async function fixture(t) {
  const browser=await chromium.launch({channel:'chrome',headless:true});
  t.after(()=>browser.close());
  const context=await browser.newContext();const page=await context.newPage();page.setDefaultTimeout(5000);const guard=consoleGuard(page);
  t.after(()=>guard.assertClean());
  await context.route('**/*',route=>route.fulfill({status:204,body:''}));
  await context.route('https://accounts.google.com/**',route=>route.fulfill({contentType:'text/html',body:
    new URL(route.request().url()).searchParams.has('continue') ? `<button onclick="location.href='${target}'">Complete test login</button>` : '<h1>Sign in</h1>'}));
  return {page,context};
}

test('LOGIN-01 signed-out Meet resumes same URL after manual login, once only',{timeout:15000},async t=>{
  const {page,context}=await fixture(t);let visits=0,logins=0;const states=[];
  await context.route('https://meet.google.com/**',route=>{
    visits++;
    return visits===1?route.fulfill({contentType:'text/html',body:'<script>location.replace("https://accounts.google.com/ServiceLogin")</script>'}):
      route.fulfill({contentType:'text/html',body:'<button aria-label="Leave call">Leave call</button><button aria-label="Turn on captions">Turn on captions</button>'});
  });
  const joined=joinMeeting(page,{url:target,displayName:'QA recorder',pollMs:1,inCallPolls:1,
    onState:state=>states.push(state),onSignin:async()=>{logins++;await waitForGoogleLogin(page,{url:target,timeoutMs:5000});}});
  await page.getByRole('button',{name:'Complete test login'}).click();await joined;
  assert.equal(page.url(),target);assert.equal(logins,1);assert.equal(visits,2);
  assert.deepEqual(states,['waiting_login','joining']);
});

test('LOGIN-02 returning to another login wall fails without a second login loop',async t=>{
  const {page}=await fixture(t);let count=0;
  await assert.rejects(joinMeeting(page,{url:'https://accounts.google.com/ServiceLogin',displayName:'QA',pollMs:1,
    onSignin:async()=>{count++;}}),error=>error.code==='signin_required');
  assert.equal(count,1);
});

test('LOGIN-03 login timeout is explicit and bounded',async t=>{
  const {page}=await fixture(t);
  await assert.rejects(waitForGoogleLogin(page,{url:target,timeoutMs:80}),error=>error.code==='signin_required'&&/timed out/.test(error.message));
});

test('LOGIN-04 closing the login window stops with an actionable error',async t=>{
  const {page}=await fixture(t);const pending=assert.rejects(waitForGoogleLogin(page,{url:target,timeoutMs:5000}),
    error=>error.code==='signin_required'&&/closed/.test(error.message));
  await page.getByRole('button',{name:'Complete test login'}).waitFor();await page.close();await pending;
});

test('LOGIN-05 stop request cancels waiting with the original stop reason',async t=>{
  const {page}=await fixture(t);let stopped=false;
  const pending=assert.rejects(waitForGoogleLogin(page,{url:target,timeoutMs:5000,shouldStop:()=>stopped?'user_stop':null}),
    error=>error.code==='aborted'&&error.reason==='user_stop');
  await page.getByRole('button',{name:'Complete test login'}).waitFor();stopped=true;await pending;
});

test('LOGIN-06 untrusted continuation host never opens a login page',async t=>{
  const {page}=await fixture(t);
  await assert.rejects(waitForGoogleLogin(page,{url:'https://example.com/'}),error=>error.code==='signin_required');
  assert.equal(page.url(),'about:blank');
});

test('LOGIN-07 profile identity is labeled metadata and missing/corrupt profiles are safe',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'openmeeting-login-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  assert.deepEqual(accountHint(root),[]);fs.mkdirSync(path.join(root,'Default'));
  const file=path.join(root,'Default','Preferences');fs.writeFileSync(file,'invalid');assert.deepEqual(accountHint(root),[]);
  fs.writeFileSync(file,JSON.stringify({account_info:[{full_name:'QA recorder',email:'qa@example.invalid'}]}));
  assert.deepEqual(accountHint(root),[{name:'QA recorder',email:'qa@example.invalid'}]);
});
