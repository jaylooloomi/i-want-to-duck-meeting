/** Serialized into the dedicated meeting page. No extension, external assets or HTML injection. */
export function installMeetingPanel({binding, origins}) {
  if (window.top !== window || !origins.includes(location.origin) || window.__omMeetingPanel) return;
  const boot = () => {
    if (!document.body || window.__omMeetingPanel) return;
    const host = document.createElement('aside');
    host.setAttribute('aria-label','meeting AI 控制面板');
    host.style.cssText='all:initial!important;position:fixed!important;right:12px!important;bottom:110px!important;width:min(360px,calc(100vw - 24px))!important;z-index:2147483000!important;display:block!important;';
    const root = host.attachShadow({mode:'open'});
    const style = document.createElement('style');
    style.textContent=':host{color-scheme:dark}*{box-sizing:border-box}section{font:14px/1.5 system-ui,sans-serif;color:#edf5ff;background:#142136;border:1px solid #526681;border-radius:14px;padding:14px;box-shadow:0 8px 28px #0008}header{display:flex;align-items:center;justify-content:space-between}h2{font-size:17px;margin:0}button{font:inherit;border:1px solid #657b97;border-radius:8px;padding:8px;color:#fff;background:#253d59;cursor:pointer}button:focus-visible{outline:3px solid #86d4ff;outline-offset:2px}button:disabled{opacity:.5;cursor:default}nav{display:flex;gap:6px;flex-wrap:wrap}p{margin:8px 0;overflow-wrap:anywhere}small{display:block;color:#bbcada}div[role=log]{max-height:min(300px,35vh);overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;background:#0c1524;padding:8px;border-radius:6px;margin-top:10px}div[role=alert]{color:#ffc7b4} [hidden]{display:none!important}';
    const sheet=new CSSStyleSheet();sheet.replaceSync(style.textContent);root.adoptedStyleSheets=[sheet];
    const section=document.createElement('section'), header=document.createElement('header');
    const title=document.createElement('h2'); title.textContent='meeting AI';
    const toggle=document.createElement('button');toggle.textContent='收合';toggle.setAttribute('aria-expanded','true');toggle.setAttribute('aria-label','收合 meeting AI 面板');
    const content=document.createElement('div'), status=document.createElement('p'); status.setAttribute('role','status');status.textContent='正在連接本機記錄程序…';
    const health=document.createElement('small'), nav=document.createElement('nav');nav.setAttribute('aria-label','會議記錄控制');
    const makeButton=label=>{const b=document.createElement('button');b.textContent=label;b.disabled=true;nav.append(b);return b;};
    const start=makeButton('開始記錄'), pause=makeButton('暫停記錄'), end=makeButton('結束並整理');
    const log=document.createElement('div');log.setAttribute('role','log');log.setAttribute('aria-label','即時逐字稿');log.setAttribute('aria-live','polite');log.textContent='尚未收到字幕；錄音與字幕狀態會分別顯示。';
    const error=document.createElement('div');error.setAttribute('role','alert');
    const note=document.createElement('small');note.textContent='僅控制這場記錄；不會開啟麥克風。整理會產生核對草稿，決議仍需 AI 審閱。';
    header.append(title,toggle);content.append(status,health,nav,error,log,note);section.append(header,content);root.append(section);document.body.append(host);
    let busy=false, stopped=false, signature='', model, actionError='';
    const render=m=>{
      model=m;
      const labels={starting:'準備中',selecting_account:'請在 Google 原生頁選帳號',waiting_login:'等待登入',needs_login:'等待登入',joining:'正在加入',waiting_admission:'等待主持人放行',in_call:'已入會',leaving:'正在結束',transcribing:'正在轉錄',done:'已結束',failed:'記錄失敗'};
      status.textContent=`${labels[m.state] || '準備中'}｜${m.recording ? '記錄中' : '未記錄／已暫停'}`;
      health.textContent=`錄音 ${Number(m.audioSeconds || 0).toFixed(1)} 秒｜${m.audioPeak > 0 ? '曾收到音訊訊號（未驗內容）' : '尚未收到非零音訊'}｜${m.captionsOn ? '字幕已開啟' : '字幕未確認'}`;
      start.disabled=busy || m.state!=='in_call' || m.recording || m.ending;
      pause.hidden=!m.canPause; pause.disabled=busy || !m.recording || m.state!=='in_call' || m.ending;
      end.disabled=busy || m.ending || ['done','failed','leaving','transcribing'].includes(m.state);
      const rows=Array.isArray(m.rows)?m.rows:[], next=JSON.stringify(rows);
      if(next!==signature){const nearBottom=log.scrollHeight-log.scrollTop-log.clientHeight<50;log.textContent=rows.map(r=>`${r.speaker || '未知發言者'}${r.pending?'（即時）':''}：${String(r.text || '').slice(0,10000)}`).join('\n\n') || '尚未收到字幕；沉默不代表擷取失敗。';signature=next;if(nearBottom)log.scrollTop=log.scrollHeight;}
      error.textContent=m.error || actionError;
    };
    const call=async action=>{
      if(busy)return;busy=true;actionError='';if(model)render(model);error.textContent='';
      try {render(await window[binding]({action}));}catch(e){actionError='操作失敗：'+String(e.message || e);error.textContent=actionError;}
      finally{busy=false;if(model){const message=error.textContent;render(model);if(message)error.textContent=message;}}
    };
    for(const [button,action] of [[start,'start'],[pause,'pause'],[end,'stop']])button.addEventListener('click',event=>{if(event.isTrusted)void call(action);});
    toggle.addEventListener('click',()=>{content.hidden=!content.hidden;toggle.textContent=content.hidden?'展開':'收合';toggle.setAttribute('aria-expanded',String(!content.hidden));toggle.setAttribute('aria-label',`${content.hidden?'展開':'收合'} meeting AI 面板`);});
    const tick=async()=>{
      if(stopped)return;
      if(!busy)try {render(await window[binding]({action:'state'}));}catch{error.textContent='本機記錄連線中斷，請檢查程序狀態。';start.disabled=pause.disabled=end.disabled=true;}
      if(!stopped)setTimeout(tick,1000);
    };
    window.__omMeetingPanel={host,destroy:()=>{stopped=true;host.remove();delete window.__omMeetingPanel;}};
    window.addEventListener('pagehide',()=>{stopped=true;},{once:true});void tick();
  };
  if(document.body)boot();else document.addEventListener('DOMContentLoaded',boot,{once:true});
}
