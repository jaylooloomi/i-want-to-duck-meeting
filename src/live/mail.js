/* Local mail content only. No mailbox, send, model or clipboard-read permissions. */
(() => {
 const uiText=(source,values)=>window.DuckI18n.t(source,values);
 const $=id=>document.getElementById(id),fields=['to','cc','bcc','subject','body'];
 let current=null,loadedId='',loadedRevision,baseSource=null,dirty=false,busy=false,warning='';
 const unsaved=new Map();
 const split=value=>value.split(/[,;\n]/).map(text=>text.trim()).filter(Boolean);
 const snapshot=()=>({to:split($('mail-to').value),cc:split($('mail-cc').value),bcc:split($('mail-bcc').value),subject:$('mail-subject').value.trim(),body:$('mail-body').value});
 const text=draft=>[(draft.to.length?'To: '+draft.to.join(', '):'To: (not specified)'),...(draft.cc.length?['Cc: '+draft.cc.join(', ')]:[]),...(draft.bcc.length?['Bcc: '+draft.bcc.join(', ')]:[]),'Subject: '+draft.subject,'',draft.body].join('\n');
 function valid(draft){if(!draft.subject||/[\r\n\0]/.test(draft.subject)||!draft.body.trim())return false;return [...draft.to,...draft.cc,...draft.bcc].every(address=>(/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/).test(address));}
 function fitBody(){const field=$('mail-body');if(!field.getClientRects().length)return;field.style.height='auto';field.style.height=(field.scrollHeight+2)+'px';}
 function render(){
  const info=current?.mailDraft||{},hasText=valid(snapshot());requestAnimationFrame(fitBody);
  $('mail-empty').hidden=!!info.draft;
  $('mail-state').textContent=uiText(busy?'正在儲存…':dirty?'尚未儲存':info.draft?'已儲存於本機':'尚未產生');
  $('mail-stale').hidden=!(info.stale||(dirty&&baseSource!==info.sourceRevision));
  $('mail-save').disabled=busy||!dirty||!info.available||!hasText;
  $('mail-copy').disabled=$('mail-download').disabled=busy||!hasText;
  if(document.querySelector('[data-notes-tab=mail]').getAttribute('aria-pressed')==='true')$('notes-copy').disabled=$('notes-download').disabled=busy||!hasText;
  for(const name of fields)$('mail-'+name).disabled=busy||!info.available;
  $('mail-feedback').textContent=warning?uiText(warning):!info.available?uiText(info.error?'無法讀取郵件草稿，請保留檔案並檢查。':'請先完成會議紀錄整理，再撰寫郵件草稿。'):'';
 }
 function receive(data){
  const id=data?.id||'',info=data?.mailDraft||{};
  if(id===loadedId&&info.observedAt&&current?.mailDraft?.observedAt&&info.observedAt<current.mailDraft.observedAt)return;
  if(id!==loadedId&&dirty&&loadedId)unsaved.set(loadedId,{values:snapshot(),revision:loadedRevision,source:baseSource});
  if(id!==loadedId||(!dirty&&!busy&&info.revision!==loadedRevision)){
   loadedId=id;loadedRevision=info.revision??null;baseSource=info.sourceRevision??null;dirty=false;warning='';
   const saved=unsaved.get(id);if(saved){loadedRevision=saved.revision;baseSource=saved.source;dirty=true;}
   const draft=saved?.values||info.draft||{};for(const name of fields)$('mail-'+name).value=Array.isArray(draft[name])?draft[name].join(', '):draft[name]||'';
  }
  current=data;render();
 }
 for(const name of fields)$('mail-'+name).addEventListener('input',()=>{dirty=true;warning='';render();});
 $('mail-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!current?.id||!valid(snapshot()))return;
  const id=current.id,payload={...snapshot(),id,expectedRevision:loadedRevision??null,sourceRevision:baseSource};busy=true;warning='';render();
  try{const response=await fetch('/api/mail-draft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const result=await response.json();if(!response.ok||result.ok===false){if(current?.id!==id)return;warning=['mail_conflict','mail_source_changed'].includes(result.error)?'草稿或來源已更新；編輯已保留，請先複製內容再重新核對。':'草稿儲存失敗，編輯已保留。';return;}
   if(current?.id===id){unsaved.delete(id);dirty=false;loadedRevision=result.revision;baseSource=result.sourceRevision;current={...current,mailDraft:result};warning=result.companionSaved===false?'草稿已儲存，文字匯出檔暫時無法更新。':'草稿已儲存，尚未建立或寄送信件。';}
  }catch{if(current?.id===id)warning='草稿儲存失敗，編輯已保留。';}finally{busy=false;render();}
 });
 $('mail-copy').addEventListener('click',async()=>{if(!valid(snapshot()))return;try{await navigator.clipboard.writeText(text(snapshot()));warning='已複製郵件內容。';}catch{warning='無法存取剪貼簿，請下載草稿。';}render();});
 $('mail-download').addEventListener('click',()=>{if(!valid(snapshot()))return;const url=URL.createObjectURL(new Blob([text(snapshot())],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=(current?.id||'meeting')+'-mail-draft.txt';a.click();URL.revokeObjectURL(url);warning='已下載郵件草稿。';render();});
 window.addEventListener('resize',fitBody);
 window.addEventListener('beforeunload',event=>{if(dirty||unsaved.size){event.preventDefault();event.returnValue='';}});
 document.addEventListener('mail-meeting',event=>receive(event.detail));
 document.addEventListener('ui-language-change',render);
 document.querySelector('[data-notes-tab=mail]').addEventListener('click',render);
})();
