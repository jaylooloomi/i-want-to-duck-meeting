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
 function mergeSelectionBody(body,groups,items){
  if(!body.trim())return groups.map(g=>`【${g.title}】\n\n`+g.lines.join('\n')).join('\n\n')+'\n';
  const newline=body.includes('\r\n')?'\r\n':'\n',lines=body.split(/\r?\n/);
  const heading=line=>{const raw=line.trim();const enclosed=/^【[^】]+】$/.test(raw)||/^#{1,6}\s+/.test(raw);const title=raw.replace(/^【|】$/g,'').replace(/^#{1,6}\s+/,'').replace(/[:：]$/,'').trim().toLowerCase();const kind=/^(?:已確認決議|重要決議|決議|已确认决议|重要决议|决议|decisions?|決定事項|決定|決議事項|결정|결정 사항)$/.test(title)?'decision':/^(?:後續待辦|後续待办|行動項目|行动项目|待辦事項|待办事项|待辦|待办|action items?|actions?|tasks?|to-?dos?|タスク|アクション|アクション項目|対応事項|할 일|작업|실행 항목)$/.test(title)?'action':null;return {kind,boundary:enclosed||!!kind};};
  const closing=line=>/^(?:謝謝|谢谢|感謝|感谢|敬祝|此致|以上(?:供|敬請|敬请)|thanks\b|thank you\b|best regards\b|kind regards\b|regards\b|如有.*(?:修正|補充|补充)|[（(]此為|[（(]此为|よろしく|감사)/i.test(line.trim());
  const headers=lines.map((line,index)=>({...heading(line),index})).filter(h=>h.boundary),handled=new Set(),edits=[];
  const generated=new Set(items.map(item=>'- '+item.details));
  for(const kind of ['decision','action']){
   const candidates=headers.filter(h=>h.kind===kind).map(header=>{
    const start=header.index,next=headers.find(h=>h.index>start);let end=next?.index??lines.length;
    const signature=lines.findIndex((line,index)=>index>start&&index<end&&closing(line));if(signature>=0)end=signature;
    const content=lines.slice(start+1,end),nonempty=content.filter(line=>line.trim());
    const generatedOnly=nonempty.every(line=>generated.has(line.trim())||/^\s*-\s+(?:事項|事项|task|action)\s*[:：]/i.test(line));
    const safe=!!next||signature>=0||nonempty.every(line=>/^\s*(?:[-*•]|\d+[.)])\s+/.test(line));
    return {start,end,generatedOnly,safe};
   });
   const primary=candidates.find(c=>c.safe);if(!primary)continue;
   const group=groups.find(g=>g.kind===kind);
   edits.push({start:primary.start,end:primary.end,replacement:group?[lines[primary.start],'',...group.lines,'']:[]});handled.add(kind);
   // Remove only redundant machine-shaped blocks; retain unfamiliar/manual duplicate sections.
   for(const candidate of candidates)if(candidate!==primary&&candidate.generatedOnly)edits.push({...candidate,replacement:[]});
  }
  for(const edit of edits.sort((a,b)=>b.start-a.start))lines.splice(edit.start,edit.end-edit.start,...edit.replacement);
  const remaining=groups.filter(g=>!handled.has(g.kind));
  if(remaining.length){const insert=lines.findIndex(closing),block=['',...remaining.flatMap(g=>[`【${g.title}】`,'',...g.lines,''])];if(insert>=0)lines.splice(insert,0,...block);else lines.push(...block);}
  return lines.join(newline);
 }
 $('mail-preview-button').addEventListener('click',()=>{
  if($('mail-preview-button').disabled)return;const items=current.noteItems.items.filter(item=>selectedIds.has(item.id));
  const groups=[],sections=[];for(const [kind,title] of [['decision','決議'],['action','待辦']]){const group=items.filter(item=>item.kind===kind);if(group.length){const lines=group.map(item=>'- '+item.details);groups.push({kind,title:uiText(title),lines});sections.push(uiText(title)+'\n'+lines.join('\n'));}}
  preview={id:current.id,source:current.mailDraft.sourceRevision,ids:JSON.stringify([...selectedIds]),body:sections.join('\n\n'),groups};render();
 });
 $('mail-apply').addEventListener('click',()=>{
  if($('mail-apply').disabled)return;undoBody=$('mail-body').value;$('mail-body').value=mergeSelectionBody(undoBody,preview.groups,current.noteItems.items);
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
