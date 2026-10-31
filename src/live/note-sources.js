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
 function open(detail){
  if(current?.id!==detail.id)return;opened=detail.itemId;if(!item())return;
  base={id:current.id,revision:current.noteItems.revision,evidenceRevision:current.noteItems.evidenceRevision,records:current.records};
  const select=$('note-source-record');select.replaceChildren(new Option(t('請選擇原文，不推測時間'),''));
  current.records.forEach((record,index)=>select.append(new Option((record.t0||t('時間未知'))+' · '+(record.speaker||t('未知發言者'))+' · '+record.text,index)));
  $('note-source-feedback').textContent='';render();$('note-source-dialog').showModal();
 }
 document.addEventListener('mail-meeting',({detail})=>{
  if(current?.id!==detail.id){$('note-source-dialog').close();opened=null;}current=detail;
  if($('note-source-dialog').open){if(!item()){$('note-source-dialog').close();opened=null;}else render();}
 });
 document.addEventListener('ui-language-change',render);
 document.addEventListener('note-source-open',({detail})=>open(detail));
 $('note-source-record').addEventListener('change',render);
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
