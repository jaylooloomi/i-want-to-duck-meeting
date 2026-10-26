import path from 'node:path';
import {launchChrome, connectChrome} from './chrome.js';
import {installTeamsCaptionTap} from './teams-captions.js';
import {attachMeetingPanel,requestPanelStop} from './meeting-panel.js';

async function clickVisible(locator) {
  const first=locator.first();
  if(await first.isVisible().catch(()=>false)) {await first.click({timeout:1500});return true;}
  return false;
}

async function muteLocalDevices(page, camera=false) {
  await clickVisible(page.getByRole('button',{name:/^(Mute(?:\s|\()|將麥克風靜音|關閉麥克風)/i}));
  for(const role of ['switch','checkbox']) {
    const mic=page.getByRole(role,{name:/^(Microphone|Mic|麥克風)$/i}).first();
    if(await mic.isVisible().catch(()=>false)) await mic.setChecked(false,{timeout:1500});
    if(camera) {
      const cam=page.getByRole(role,{name:/^(Camera|攝影機|相機)$/i}).first();
      if(await cam.isVisible().catch(()=>false)) await cam.setChecked(false,{timeout:1500});
    }
  }
  if(camera) await clickVisible(page.getByRole('button',{name:/^(Turn camera off|關閉攝影機|關閉相機)/i}));
}

// Limit automation to the requested meeting surface. Never fill sign-in fields.
export async function configureTeamsPage(page, {displayName, language='中文（台灣）'}={}) {
  const host=new URL(page.url()).hostname;
  if (host==='login.live.com' || host==='login.microsoftonline.com') return 'needs_login';
  if (!['teams.live.com','teams.microsoft.com','teams.cloud.microsoft'].includes(host)) return 'waiting_page';
  const leave=page.getByRole('button',{name:/^(Leave|離開|掛斷)(\b|$)/i});
  if(await leave.first().isVisible().catch(()=>false)) {
    // Never click a toggle that would turn the microphone on.
    await muteLocalDevices(page,true);
    if(!await page.locator('[data-tid="closed-caption-text"], [data-tid="closed-captions-renderer"]').count()) {
      if(!await clickVisible(page.locator('#closed-captions-button'))) {
        await clickVisible(page.getByRole('button',{name:/^(More|More actions|更多|其他)(\b|$)/i}));
        await clickVisible(page.getByRole('menuitem',{name:/Language and speech|語言和語音|語言與語音/i}));
        await clickVisible(page.getByRole('menuitem',{name:/Turn on live captions|Show live captions|開啟即時字幕|顯示即時字幕/i}));
      }
    }
    // Language settings, when available. No private session endpoints are used.
    if(await clickVisible(page.locator('[data-tid="closed-captions-settings-menu-trigger-button"]'))) {
      await clickVisible(page.getByRole('menuitem',{name:/Language settings|語言設定/i}));
      const combo=page.getByRole('combobox',{name:/Meeting spoken language|會議口說語言|會議使用語言|口語/i}).first();
      if(await combo.isVisible().catch(()=>false)) {
        let selected=false;
        if(await combo.evaluate(el=>el.tagName==='SELECT')) selected=await combo.selectOption({label:language},{timeout:2000}).then(()=>true).catch(()=>false);
        else {await combo.click();selected=await clickVisible(page.getByRole('option',{name:/Chinese.*Taiwan|中文.*台灣|中文.*臺灣/i}));}
        if(selected && await clickVisible(page.getByRole('button',{name:/^(Update|更新)$/i}))) page.__omCaptionLanguage='zh-TW';
      }
    }
    return 'in_call';
  }
  await clickVisible(page.getByRole('button',{name:/Continue on this browser|Continue in this browser|在此瀏覽器繼續|繼續使用此瀏覽器/i}));
  const join=page.getByRole('button',{name:/^(Join now|Join meeting|立即加入|加入會議)$/i}).first();
  if(await join.isVisible().catch(()=>false)) {
    const name=page.getByRole('textbox',{name:/name|姓名|名稱/i}).first();
    if(await name.isVisible().catch(()=>false) && displayName) await name.fill(displayName);
    await muteLocalDevices(page,true);
    await join.click();return 'joining';
  }
  const text=await page.locator('body').innerText({timeout:1500}).catch(()=>'');
  if(/waiting.*(admit|join)|等候.*(允許|加入)|等待.*(允許|加入)/i.test(text)) return 'waiting_admission';
  if(/sign in|登入/i.test(text)) return 'needs_login';
  return 'waiting_page';
}

export async function startTeamsBrowser({config,url,onCaption,onState,signal,dir}) {
  let chrome, browser, timer, stopped=false, running=false;
  const close=async()=>{stopped=true;clearInterval(timer);await browser?.close().catch(()=>{});await chrome?.close().catch(()=>{});};
  signal?.addEventListener('abort',()=>void close(),{once:true});
  try {
    chrome=await launchChrome({profileDir:path.join(config.profileDir,'teams-notetaker'),chromePath:config.chromePath,
      headless:config.headless,muteAudio:false});
    if(signal?.aborted){await close();throw new Error('Teams browser cancelled');}
    const connected=await connectChrome(chrome.cdpUrl);browser=connected.browser;
    if(signal?.aborted){await close();throw new Error('Teams browser cancelled');}
    const {context,page}=connected;
    if(dir)await attachMeetingPanel(page,{dir,origins:['https://teams.live.com','https://teams.microsoft.com','https://teams.cloud.microsoft'],onAction:async action=>{
      if(action==='stop')requestPanelStop(dir);
      else throw new Error('Teams 使用自動雙路記錄，開始／暫停不適用');
    }});
    await context.exposeBinding('__omTeamsCaption',(source,event)=>{
      const host=new URL(source.frame.url()).hostname;
      if(['teams.live.com','teams.microsoft.com','teams.cloud.microsoft'].includes(host)) onCaption(event);
    });
    await context.addInitScript(installTeamsCaptionTap);
    const tick=async()=>{
      if(stopped || running)return;running=true;
      try {onState({state:await configureTeamsPage(page,{displayName:config.displayName}), url:page.url(),captionLanguage:page.__omCaptionLanguage || 'unverified'});}
      catch(error){onState({state:'setup_retry',error:error.message});}
      finally{running=false;}
    };
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
    timer=setInterval(()=>void tick(),5000);await tick();
    return {close};
  } catch(error){await close();throw error;}
}
