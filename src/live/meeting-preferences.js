/* New-meeting defaults shared with CLI. Does not change an active meeting. */
(()=>{
 const $=id=>document.getElementById(id),t=(key,values)=>window.DuckI18n.t(key,values);
 const controls=[$('default-spoken'),$('default-original'),$('default-translation')],done=$('save-meeting-preferences'),dialog=$('settings-dialog');
 let revision=null,ready=false,busy=false,dirty=false,epoch=0,loading=null;
 // Translation targets exactly mirror the existing supported reading selector.
 controls[2].replaceChildren(...[...$('secondary-lang').options].map(option=>option.cloneNode(true)));
 function values(){return {schemaVersion:1,spokenLanguage:controls[0].value,originalDisplay:controls[1].value,translationLanguage:controls[2].value};}
 function render(){for(const option of controls[2].options){const source=[...$('secondary-lang').options].find(item=>item.value===option.value);if(source)option.textContent=source.textContent;}for(const control of controls)control.disabled=!ready||busy;done.disabled=busy;
  const selected=control=>control.selectedOptions[0]?.textContent||control.value,original=controls[1].value==='follow-meeting'?selected(controls[0]):selected(controls[1]);
  $('agent-language-preview').textContent=t('Agent 將讀取的開會預設')+'：'+selected(controls[0])+' → '+original+' → '+selected(controls[2]);
 }
 async function load(){const version=++epoch;ready=false;dirty=false;$('reload-meeting-preferences').hidden=true;$('meeting-preferences-feedback').textContent=t('正在讀取本機語言預設…');render();
  try{const response=await fetch('/api/meeting-preferences',{signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error();const data=await response.json();if(version!==epoch)return;revision=data.revision;controls[0].value=data.preferences.spokenLanguage;controls[1].value=data.preferences.originalDisplay;controls[2].value=data.preferences.translationLanguage;ready=true;$('meeting-preferences-feedback').textContent=data.warning?t('語言設定檔無法讀取，已顯示內建預設；儲存前請核對。'):t('按完成儲存；外觀設定仍保存在此瀏覽器。');}
  catch{if(version===epoch)$('meeting-preferences-feedback').textContent=t('無法讀取語言預設，尚未變更；請稍後重試。');}finally{if(version===epoch)render();}
 }
 $('open-settings').addEventListener('click',()=>{if(dirty&&ready){$('meeting-preferences-feedback').textContent=t('語言設定尚未儲存，按完成套用到下一場會議。');render();}else loading=load();});
 for(const control of controls)control.addEventListener('change',()=>{dirty=true;render();});
 done.addEventListener('click',async()=>{if(busy)return;if(loading)await loading;if(busy)return;if(!dirty){dialog.close();return;}if(!ready)return;
  busy=true;render();$('meeting-preferences-feedback').textContent=t('正在儲存本機語言預設…');
  try{const response=await fetch('/api/meeting-preferences',{method:'PUT',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json'},body:JSON.stringify({...values(),expectedRevision:revision})});const data=await response.json();if(!response.ok||!data.preferences){$('reload-meeting-preferences').hidden=response.status!==409;$('meeting-preferences-feedback').textContent=t(response.status===409?'設定已在其他視窗更新，請重新讀取後再核對。':'儲存失敗，選擇已保留，請重試。');return;}revision=data.revision;dirty=false;dialog.close();}
  catch{$('meeting-preferences-feedback').textContent=t('儲存失敗，選擇已保留，請重試。');}finally{busy=false;render();}
 });
 $('reload-meeting-preferences').onclick=()=>{loading=load();};
 document.addEventListener('ui-language-change',render);
 render();
})();
