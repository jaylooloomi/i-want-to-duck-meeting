/* Explicit links to verbatim transcript records; no inferred timestamps. */
(() => {
 const $=id=>document.getElementById(id),t=source=>window.DuckI18n.t(source);
 let current=null,opened=null,base=null,busy=false;
 const item=()=>current?.noteItems?.items.find(item=>item.id===opened);
 const validTime=source=>typeof source?.time==='string'&&Number.isFinite(Date.parse(source.time));
 function render(){
  const entry=item(),source=entry?.source;if(!entry)return;
  $('note-source-item').textContent=entry.text;
  $('note-source-quote').textContent=source.linked?source.text:source.previous?.text||t('來源未連結');
  $('note-source-time').textContent=source.linked?(validTime(source)?source.time:t('時間未知')):t(source.reason==='source_changed'?'來源已變更，請重新連結；上方保留舊原文。':'來源未知，未連結逐字稿。');
  $('note-source-locate').disabled=busy||!source.linked;
  const start=Date.parse(current?.status?.joinedAt||current?.status?.startedAt);
  $('note-source-play').disabled=busy||!source.linked||!validTime(source)||!Number.isFinite(start)||Date.parse(source.time)<start||!current?.workspace?.audio?.length||!['done','failed','archived'].includes(current?.status?.state);
  $('note-source-unlink').disabled=busy||!source.linked&&!source.previous;
  $('note-source-save').disabled=busy||$('note-source-record').value==='';
 }
 function renderCandidates(){
  const box=$('note-source-options'),query=$('note-source-search').value.trim().toLocaleLowerCase();box.replaceChildren();
  base.records.forEach((record,index)=>{
   if(query&&![record.text,record.speaker].join(' ').toLocaleLowerCase().includes(query))return;
   const option=document.createElement('button');option.type='button';option.setAttribute('role','option');option.setAttribute('aria-selected',String($('note-source-record').value===String(index)));
   const meta=document.createElement('small');meta.textContent=(record.t0||t('時間未知'))+' · '+(record.speaker||t('未知發言者'));
   const quote=document.createElement('span');quote.textContent=record.text;option.append(meta,quote);
   option.addEventListener('click',()=>{$('note-source-record').value=String(index);$('note-source-selected').textContent=meta.textContent+'\n'+record.text;for(const child of box.children)child.setAttribute('aria-selected',String(child===option));render();});box.append(option);
  });
  if(!box.children.length){const empty=document.createElement('p');empty.textContent=t('沒有符合的原文');box.append(empty);}
 }
 function open(detail){
  if(current?.id!==detail.id)return;opened=detail.itemId;if(!item())return;
  base={id:current.id,revision:current.noteItems.revision,evidenceRevision:current.noteItems.evidenceRevision,records:current.records};
  $('note-source-record').value='';$('note-source-search').value='';$('note-source-selected').textContent=t('尚未選擇原文');renderCandidates();
  $('note-source-feedback').textContent='';render();$('note-source-dialog').showModal();
 }
 document.addEventListener('mail-meeting',({detail})=>{
  if(current?.id!==detail.id){$('note-source-dialog').close();opened=null;}current=detail;
  if($('note-source-dialog').open){if(!item()){$('note-source-dialog').close();opened=null;}else render();}
 });
 document.addEventListener('ui-language-change',render);
 document.addEventListener('note-source-open',({detail})=>open(detail));
 $('note-source-search').addEventListener('input',renderCandidates);
 $('note-source-options').addEventListener('keydown',event=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;const options=[...$('note-source-options').children].filter(el=>el.getAttribute('role')==='option');if(!options.length)return;event.preventDefault();let index=options.indexOf(document.activeElement);index=event.key==='Home'?0:event.key==='End'?options.length-1:Math.max(0,Math.min(options.length-1,index+(event.key==='ArrowDown'?1:-1)));options[index].focus();});
 async function save(unlink=false){
  if(busy||!base||!item())return;const recordIndex=unlink?null:Number($('note-source-record').value);if(!unlink&&$('note-source-record').value==='')return;
  const record=recordIndex===null?null:base.records[recordIndex],id=base.id;
  busy=true;render();
  try{const response=await fetch('/api/summary-source',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,itemId:opened,revision:base.revision,evidenceRevision:base.evidenceRevision,recordIndex,recordText:record?.text,recordTime:record?.t0??null,recordSpeaker:record?.speaker??null})});const result=await response.json();if(current?.id!==id)return;if(!response.ok||!result.ok)throw new Error(result.error);current={...current,noteItems:result.noteItems};base.evidenceRevision=result.noteItems.evidenceRevision;$('note-source-feedback').textContent=t('來源連結已儲存');document.dispatchEvent(new CustomEvent('note-source-updated'));}
  catch{$('note-source-feedback').textContent=t('來源已變更或無法儲存，請關閉後重新開啟核對。');}finally{busy=false;render();}
 }
 $('note-source-save').addEventListener('click',()=>save());$('note-source-unlink').addEventListener('click',()=>save(true));
 $('note-source-locate').addEventListener('click',()=>{const source=item()?.source;if(!source?.linked)return;$('note-source-dialog').close();document.dispatchEvent(new CustomEvent('locate-note-source',{detail:{id:current.id,source}}));});
 $('note-source-play').addEventListener('click',()=>{const source=item()?.source;if($('note-source-play').disabled||!source?.linked)return;$('note-source-dialog').close();document.dispatchEvent(new CustomEvent('seek-recording',{detail:{time:source.time}}));const audio=$('meeting-audio');const play=()=>audio.play().catch(()=>{});if(audio.readyState>=1)play();else audio.addEventListener('loadedmetadata',play,{once:true});});
})();
