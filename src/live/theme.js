/* Apply the saved palette before CSS paints, then keep both controls in sync. */
(() => {
  const key='duck-meeting:theme';
  const valid=value=>value==='dark'?'dark':'light';
  let theme='light';
  try{theme=valid(localStorage.getItem(key));}catch{}
  document.documentElement.dataset.theme=theme;
  function apply(value,persist=false){
    const text=source=>window.DuckI18n?.t(source)||source;
    theme=valid(value);document.documentElement.dataset.theme=theme;
    const toggle=document.getElementById('theme-toggle'),select=document.getElementById('theme-setting');
    if(toggle){toggle.textContent=theme==='dark'?text('☀ 淺色'):text('☾ 深色');toggle.setAttribute('aria-pressed',String(theme==='dark'));toggle.title=theme==='dark'?text('切換為白色風格'):text('切換為暗色風格');}
    if(select)select.value=theme;
    if(persist){try{localStorage.setItem(key,theme);}catch{const message=document.getElementById('workspace-message');if(message)message.textContent=text('已切換外觀；瀏覽器未允許保存偏好。');}}
  }
  document.addEventListener('DOMContentLoaded',()=>{
    apply(theme);
    document.getElementById('theme-toggle')?.addEventListener('click',()=>apply(theme==='dark'?'light':'dark',true));
    document.getElementById('theme-setting')?.addEventListener('change',event=>apply(event.target.value,true));
  });
  document.addEventListener('ui-language-change',()=>apply(theme));
  window.addEventListener('storage',event=>{if(event.key===key||event.key===null)apply(event.key===null?'light':event.newValue);});
})();
