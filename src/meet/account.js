import {randomUUID} from 'node:crypto';
import {JoinError} from './join.js';

const normalize = value => typeof value === 'string' ? value.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,'').trim().toLowerCase() : '';
const email = value => /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(normalize(value)) ? normalize(value) : null;
export function bindAccountUrl(url, account) {
  const target=new URL(url),selected=email(account);
  if(target.protocol!=='https:'||target.hostname!=='meet.google.com'||!selected)throw new JoinError('signin_required','Invalid Google Meet account selection');
  target.searchParams.set('authuser',selected);return target.href;
}
export function nativeAccountChooserUrl(url) {
  bindAccountUrl(url,'validation@example.invalid');
  const chooser=new URL('https://accounts.google.com/AccountChooser');
  // A non-meeting landing page allows verification without requesting admission.
  chooser.searchParams.set('continue','https://meet.google.com/landing');
  return chooser.href;
}

// Runs only on Google's own sign-in origin. Never reads input values/passwords.
export function observeNativeAccountChoice({binding}) {
  if(location.origin!=='https://accounts.google.com')return;
  const send=payload=>{void window[binding](payload).catch(()=>{});};
  document.addEventListener('click',event=>{
    if(!event.isTrusted || !(event.target instanceof Element))return;
    const target=event.target;
    const row=target.closest('[data-identifier],[data-email]') || target.closest('[role="link"],[role="button"],li');
    const identity=row?.matches('[data-identifier],[data-email]')?row:row?.querySelector('[data-identifier],[data-email]');
    const chosen=identity?.getAttribute('data-identifier')||identity?.getAttribute('data-email');
    if(chosen){send({kind:'choice',email:chosen});return;}
    const action=target.closest('button,[role="button"],[role="link"],a,li');
    const text=(action?.textContent||'').trim();
    if(/^(Use another account|Add account|使用其他帳戶|使用其他帳號|使用其他帐号|使用另一个帐号|新增帳戶)$/i.test(text))send({kind:'other'});
    else if(/\/signin\//i.test(location.pathname)&&/^(Next|Continue|Sign in|下一步|繼續|登入)$/i.test(text))send({kind:'login'});
  },true);
  document.addEventListener('keydown',event=>{
    if(event.isTrusted&&event.key==='Enter'&&event.target instanceof HTMLInputElement&&/\/signin\//i.test(location.pathname))send({kind:'login'});
  },true);
  document.addEventListener('submit',event=>{
    if(event.isTrusted&&/\/signin\//i.test(location.pathname))send({kind:'login'});
  },true);
}

function checkWaiting(page,shouldStop) {
  const reason=shouldStop();
  if(reason){const error=new JoinError('aborted','Account selection cancelled');error.reason=reason;throw error;}
  if(page.isClosed())throw new JoinError('signin_required','Account selection window closed; no join request sent');
}

export async function selectMeetingAccount(page,{url,timeoutMs=600000,shouldStop=()=>null,onWaiting=()=>{}}={}) {
  const chooser=nativeAccountChooserUrl(url),binding='__omAccount_'+randomUUID().replaceAll('-','');
  let chosen=null,intent=false,active=true;
  await page.exposeBinding(binding,(source,payload)=>{
    if(!active||source.page!==page||source.frame!==page.mainFrame()||new URL(source.frame.url()).origin!=='https://accounts.google.com')return;
    if(payload?.kind==='choice'&&email(payload.email)){chosen=email(payload.email);intent=true;}
    else if(payload?.kind==='other'){chosen=null;intent=true;}
    else if(payload?.kind==='login')intent=true;
  });
  await page.addInitScript(observeNativeAccountChoice,{binding});
  const deadline=Date.now()+timeoutMs;
  try {
    checkWaiting(page,shouldStop);onWaiting();await page.bringToFront();
    try {await page.goto(chooser,{waitUntil:'domcontentloaded',timeout:30000});}
    catch(error){checkWaiting(page,shouldStop);if(error.name!=='TimeoutError')throw error;}
    for(;;){
      checkWaiting(page,shouldStop);
      const remaining=deadline-Date.now();
      if(remaining<=0)throw new JoinError('signin_required','Native Google account selection timed out; no join request sent');
      try {
        await page.waitForURL(u=>u.origin==='https://meet.google.com'&&['/landing','/home'].includes(u.pathname),{waitUntil:'domcontentloaded',timeout:Math.min(500,remaining)});
        break;
      }catch(error){checkWaiting(page,shouldStop);if(error.name!=='TimeoutError')throw error;}
    }
    if(!intent)throw new JoinError('signin_required','Google returned without an explicit account choice or login; no join request sent');
    const actual=await readIdentity(page,{timeoutMs:Math.min(5000,Math.max(1,deadline-Date.now())),shouldStop});
    if(!actual||chosen&&actual!==chosen)throw new JoinError('signin_required','Google account selection did not match the authenticated identity; no join request sent');
    return chosen||actual;
  }finally{active=false;}
}

// Google's avatar label, or Meet's prejoin email next to its native switch-account
// link. Never infer identity from participant names, chat, profile order or URL.
export function visibleGoogleAccount() {
  const values=new Set();
  const clean=value=>value.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,'').trim().toLowerCase();
  const valid=value=>/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value);
  const visible=el=>!!el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';
  for(const el of document.querySelectorAll('a[aria-label],button[aria-label],[role="button"][aria-label]')){
    const label=clean(el.getAttribute('aria-label')||'');
    if(!/google\s*(account|帳戶|帳號|账户|アカウント|konto)/i.test(label)||!visible(el))continue;
    for(const value of label.match(/[^\s()<>]+@[^\s()<>]+\.[^\s()<>]+/g)||[])if(valid(value))values.add(value);
  }
  for(const link of document.querySelectorAll('a[href]')){
    let url;try{url=new URL(link.href);}catch{continue;}
    if(url.origin!=='https://accounts.google.com'||!/accountchooser/i.test(url.pathname)||!/switch account|change account|切換帳戶|切換帳號|切换帐号|切换账户/i.test(link.textContent||''))continue;
    let region=link.parentElement;
    for(let level=0;region&&level<2;level++,region=region.parentElement){
      if(region===document.body||region.childElementCount>12)break;
      for(const el of region.querySelectorAll('div,span')){
        const value=clean(el.textContent||'');
        if(el.children.length===0&&visible(el)&&valid(value))values.add(value);
      }
    }
  }
  return values.size===1?[...values][0]:null;
}
async function readIdentity(page,{timeoutMs=5000,shouldStop=()=>null}={}) {
  const location=new URL(page.url());
  if(location.origin!=='https://meet.google.com')throw new JoinError('signin_required','Account verification requires the Google Meet page');
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<=deadline){
    checkWaiting(page,shouldStop);
    try {
      const handle=await page.waitForFunction(visibleGoogleAccount,undefined,{timeout:Math.max(1,Math.min(500,deadline-Date.now()))});
      const actual=await handle.jsonValue();await handle.dispose();return actual;
    }catch(error){if(error.name!=='TimeoutError')throw error;}
  }
  return null;
}
export async function verifyMeetingAccount(page,expected,options={}) {
  const selected=email(expected);if(!selected)throw new JoinError('signin_required','No account was explicitly selected');
  const actual=await readIdentity(page,options);
  if(actual!==selected)throw new JoinError('signin_required',actual?`Google Meet account mismatch: selected ${selected}, actual ${actual}; no join request sent`:'Cannot verify Google Meet account identity; no join request sent');
  return {email:actual,source:'visible_google_account_identity',identityVerified:true};
}
