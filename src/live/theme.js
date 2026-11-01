/* Apply the saved palette before CSS paints, then keep both controls in sync. */
(() => {
  const key='duck-meeting:theme';
  const valid=value=>value==='dark'?'dark':'light';
  let theme='light';
  try{theme=valid(localStorage.getItem(key));}catch{}
  document.documentElement.dataset.theme=theme;
  const bannerKey='duck-meeting:banner',validBanner=value=>['wave','orbit','ripple'].includes(value)?value:'wave';
  let banner='wave';try{banner=validBanner(localStorage.getItem(bannerKey));}catch{}
  function applyBanner(value,persist=false){
    banner=validBanner(value);document.documentElement.dataset.banner=banner;
    const header=document.querySelector('.meeting-heading.meeting-banner'),select=document.getElementById('banner-setting');
    if(header)header.dataset.banner=banner;if(select)select.value=banner;
    if(persist)try{localStorage.setItem(bannerKey,banner);}catch{const status=document.getElementById('workspace-message');if(status)status.textContent=window.DuckI18n?.t('瀏覽器未允許保存偏好，本次設定仍可使用。')||'瀏覽器未允許保存偏好，本次設定仍可使用。';}
  }
  document.documentElement.dataset.banner=banner;
  function apply(value,persist=false){
    const text=source=>window.DuckI18n?.t(source)||source;
    theme=valid(value);document.documentElement.dataset.theme=theme;
    const toggle=document.getElementById('theme-toggle'),select=document.getElementById('theme-setting');
    if(toggle){toggle.textContent=theme==='dark'?text('☀ 淺色'):text('☾ 深色');toggle.setAttribute('aria-pressed',String(theme==='dark'));toggle.title=theme==='dark'?text('切換為白色風格'):text('切換為暗色風格');}
    if(select)select.value=theme;
    if(persist){try{localStorage.setItem(key,theme);}catch{const message=document.getElementById('workspace-message');if(message)message.textContent=text('已切換外觀；瀏覽器未允許保存偏好。');}}
  }
  document.addEventListener('DOMContentLoaded',()=>{
    apply(theme);applyBanner(banner);
    document.getElementById('theme-toggle')?.addEventListener('click',()=>apply(theme==='dark'?'light':'dark',true));
    document.getElementById('banner-setting')?.addEventListener('change',event=>applyBanner(event.target.value,true));
    document.getElementById('theme-setting')?.addEventListener('change',event=>apply(event.target.value,true));
  });
  document.addEventListener('ui-language-change',()=>apply(theme));
  window.addEventListener('storage',event=>{if(event.key===bannerKey||event.key===null)applyBanner(event.key===null?'wave':event.newValue);if(event.key===key||event.key===null)apply(event.key===null?'light':event.newValue);});
})();
