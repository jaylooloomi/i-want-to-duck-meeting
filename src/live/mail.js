/* Local mail content only. No mailbox, send, model or clipboard-read permissions. */
(() => {
 const uiText=(source,values)=>window.DuckI18n.t(source,values);
 const $=id=>document.getElementById(id),fields=['to','cc','bcc','subject','body'];
 let current=null,loadedId='',loadedRevision,baseSource=null,dirty=false,busy=false,warning='';
 const unsaved=new Map();
 let selectedIds=new Set(),selectionSignature='',preview=null,undoBody=null;
 const split=value=>value.split(/[,;\n]/).map(text=>text.trim()).filter(Boolean);
 const snapshot=()=>({to:split($('mail-to').value),cc:split($('mail-cc').value),bcc:split($('mail-bcc').value),subject:$('mail-subject').value.trim(),body:$('mail-body').value,selectedItemIds:[...selectedIds]});
 const text=draft=>[(draft.to.length?'To: '+draft.to.join(', '):'To: (not specified)'),...(draft.cc.length?['Cc: '+draft.cc.join(', ')]:[]),...(draft.bcc.length?['Bcc: '+draft.bcc.join(', ')]:[]),'Subject: '+draft.subject,'',draft.body].join('\n');
 function valid(draft){if(!draft.subject||/[\r\n\0]/.test(draft.subject)||!draft.body.trim())return false;return [...draft.to,...draft.cc,...draft.bcc].every(address=>(/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/).test(address));}
 function render(){
  const info=current?.mailDraft||{},hasText=valid(snapshot());
  renderSelection();
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
   const draft=saved?.values||info.draft||{};selectedIds=new Set(draft.selectedItemIds||[]);selectionSignature='';preview=null;undoBody=null;for(const name of fields)$('mail-'+name).value=Array.isArray(draft[name])?draft[name].join(', '):draft[name]||'';
  }
  current=data;render();
 }
 function renderSelection(){
  const items=current?.noteItems?.items||[],available=!!current?.mailDraft?.available;
  const signature=JSON.stringify([current?.id,current?.noteItems?.revision,items.map(item=>[item.id,item.details]),[...selectedIds],available,busy,window.DuckI18n.language]);
  if(signature!==selectionSignature){selectionSignature=signature;const list=$('mail-items');list.replaceChildren();
   if(!items.length){const p=document.createElement('p');p.textContent=uiText('尚無可選擇的決議或待辦');list.append(p);}
   for(const item of items){const label=document.createElement('label');label.className='mail-item-choice';const input=document.createElement('input');input.type='checkbox';input.checked=selectedIds.has(item.id);input.disabled=!available||busy;input.dataset.itemId=item.id;
    const text=document.createElement('span');text.textContent=(item.kind==='decision'?uiText('決議'):uiText('待辦'))+' · '+item.details;label.append(input,text);list.append(label);
    input.addEventListener('change',()=>{selectedIds=new Set([...selectedIds].filter(id=>items.some(item=>item.id===id)));if(input.checked)selectedIds.add(item.id);else selectedIds.delete(item.id);dirty=true;preview=null;warning='';render();});
   }
  }
  const invalid=[...selectedIds].some(id=>!items.some(item=>item.id===id));
  const previewValid=preview&&preview.id===current?.id&&preview.source===current?.mailDraft?.sourceRevision&&preview.ids===JSON.stringify([...selectedIds]);
  $('mail-preview-button').disabled=busy||!available||!selectedIds.size||invalid;
  $('mail-apply').disabled=busy||!available||!previewValid;
  $('mail-undo').disabled=busy||undoBody===null||!available;
  $('mail-selection-preview').textContent=previewValid?preview.body:'';
  $('mail-selection-state').textContent=invalid?uiText('會議紀錄已變更，先前勾選項目已失效，請重新勾選。'):preview&&!previewValid?uiText('預覽已失效，請重新預覽。'):'';
 }
 $('mail-preview-button').addEventListener('click',()=>{
  if($('mail-preview-button').disabled)return;const items=current.noteItems.items.filter(item=>selectedIds.has(item.id));
  const sections=[];for(const [kind,title] of [['decision','決議'],['action','待辦']]){const group=items.filter(item=>item.kind===kind);if(group.length)sections.push(uiText(title)+'\n'+group.map(item=>'- '+item.details).join('\n'));}
  preview={id:current.id,source:current.mailDraft.sourceRevision,ids:JSON.stringify([...selectedIds]),body:sections.join('\n\n')};render();
 });
 $('mail-apply').addEventListener('click',()=>{
  if($('mail-apply').disabled)return;undoBody=$('mail-body').value;$('mail-body').value=preview.body;
  if(!$('mail-subject').value.trim())$('mail-subject').value=(current.workspace?.title||current.id)+' · '+uiText('會議紀錄');baseSource=current.mailDraft.sourceRevision;dirty=true;warning='';render();
 });
 $('mail-undo').addEventListener('click',()=>{if($('mail-undo').disabled)return;const previous=$('mail-body').value;$('mail-body').value=undoBody;undoBody=previous;dirty=true;render();});
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
 window.addEventListener('beforeunload',event=>{if(dirty||unsaved.size){event.preventDefault();event.returnValue='';}});
 document.addEventListener('mail-meeting',event=>receive(event.detail));
 document.addEventListener('ui-language-change',render);
 document.querySelector('[data-notes-tab=mail]').addEventListener('click',render);
})();
