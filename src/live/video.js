/* Optional window video; never starts without an explicit source choice. */
(()=>{
 const t=s=>window.DuckI18n.t(s),$=id=>document.getElementById(id);
 const entry=document.createElement('button');entry.id='open-video';entry.type='button';entry.textContent=t('會議影片／錄影');document.querySelector('.meeting-menu-items').append(entry);
 const dialog=document.createElement('dialog');dialog.id='video-dialog';dialog.setAttribute('aria-labelledby','video-title');
 dialog.innerHTML='<h2 id="video-title">會議影片／錄影</h2><p id="video-description">選擇會議視窗才開始錄影。請告知與會者；第一版不支援暫停，也不保證最小化或遮擋後仍有有效畫面。</p><button id="video-install" type="button" hidden>安裝錄影元件</button><div id="video-actions" class="video-actions"><button id="video-windows" type="button">選擇錄影視窗</button><label>錄影視窗<select id="video-target"><option value="">請先讀取視窗清單</option></select></label><button id="video-start" type="button" disabled>開始錄影</button><button id="video-stop" type="button" disabled>停止錄影</button></div><p id="video-status" role="status"></p><video id="meeting-video" controls preload="metadata" aria-label="會議影片播放器" hidden></video><label id="video-sync-label" hidden><input id="video-sync" type="checkbox" checked>點逐字稿時間時定位影片</label><a id="video-download" hidden download>下載影片</a><details id="video-recovery" hidden><summary>下載原始片段</summary><div id="video-parts"></div></details><p id="video-message" role="status"></p><div class="dialog-actions"><button id="video-close" type="button">關閉</button></div>';
 document.body.append(dialog);
 const indicator=document.createElement('a');indicator.id='video-indicator';indicator.hidden=true;indicator.setAttribute('aria-live','polite');document.querySelector('.meeting-meta-line').append(indicator);
 let current=null,state=null,busy=false,loaded='',feedback='',polling=false,sync=false,pendingSeek=null,epoch=0,recordingId=null;
 const player=$('meeting-video');
 const authored=[];const walker=document.createTreeWalker(dialog,NodeFilter.SHOW_TEXT);while(walker.nextNode()){const node=walker.currentNode;if(node.nodeValue.trim())authored.push({node,key:node.nodeValue});}
 const active=s=>['starting','recording','stopping','finalizing'].includes(s?.state);
 function render(){
  if(state?.activeId)recordingId=state.activeId;else if(state&&Object.hasOwn(state,'activeId'))recordingId=null;
  indicator.hidden=!recordingId;indicator.textContent='● '+t('錄影中');if(recordingId)indicator.href='/?id='+encodeURIComponent(recordingId);

  for(const item of authored)if(item.node.isConnected)item.node.nodeValue=t(item.key);
  player.setAttribute('aria-label',t('會議影片播放器'));
  $('video-title').textContent=t('會議影片／錄影');entry.textContent=t('會議影片／錄影');
  const canConfigure=state?.state==='idle'&&current?.status?.state==='in_call';$('video-actions').hidden=!canConfigure&&!active(state);
  $('video-install').hidden=!canConfigure||state?.runtimeReady!==false;$('video-install').disabled=busy;
  $('video-start').disabled=busy||current?.status?.state!=='in_call'||!$('video-target').value||state?.state!=='idle'||!state?.runtimeReady||!state?.workerReady;
  $('video-stop').disabled=busy||!['starting','recording'].includes(state?.state)||state?.activeId!==current?.id;
  $('video-windows').disabled=busy||active(state);$('video-target').disabled=busy||active(state);
  const labels={idle:'尚未錄影',starting:'錄影啟動中',recording:'錄影中',stopping:'正在停止錄影',finalizing:'正在封裝影片',ready:'影片已保存',failed:'錄影失敗，原始片段已保留'};
  $('video-status').textContent=t(labels[state?.state]||'尚未錄影')+(canConfigure&&state?.runtimeReady===false?' · '+t('尚未安裝錄影元件'):canConfigure&&state?.workerReady===false?' · '+t('本機 Python 執行環境尚未備妥'):'')+(state?.error?' · '+state.error:'');
  const parts=state?.segments||[];$('video-recovery').hidden=!parts.length;const links=$('video-parts');links.replaceChildren();for(const [index,part] of parts.entries()){const link=document.createElement('a');link.textContent=t('片段')+' '+(index+1);link.href='/api/video-file?id='+encodeURIComponent(current.id)+'&file='+encodeURIComponent(part.file);link.download=current.id+'-'+part.file;links.append(link);}
  const file=state?.file||state?.segments?.[0]?.file;
  $('video-sync-label').hidden=!file;player.hidden=!file;$('video-download').hidden=!file;
  if(file&&current){const src='/api/video-file?id='+encodeURIComponent(current.id)+'&file='+encodeURIComponent(file);if(loaded!==src){player.pause();loaded=src;player.src=src;}$('video-download').href=src;$('video-download').download=current.id+'-'+file;}
  else if(loaded){player.pause();player.removeAttribute('src');player.load();loaded='';}
  $('video-message').textContent=(feedback?t(feedback):'')|| (state?.audioState==='embedded'?t('影片已合併本場錄音；聲音是否完整仍須核對。影片請個別下載，整場 ZIP 不含影片。'):file?t('目前影片無內嵌聲音；會議結束且有有效混音檔後自動合併。'):'');
 }
 async function request(url,options){const response=await fetch(url,{...options,signal:AbortSignal.timeout(url==='/api/video/install'?610000:120000)});const value=await response.json();if(!response.ok||value.error&&value.state===undefined)throw new Error(value.error||'錄影操作失敗');return value;}
 async function poll(){if(!current||polling)return;polling=true;const id=current.id,version=epoch;try{const next=await request('/api/video?id='+encodeURIComponent(id));if(current?.id===id&&epoch===version){state=next;render();}}catch(error){if(current?.id===id)feedback=error.message;}finally{polling=false;}}
 entry.onclick=()=>{document.getElementById('meeting-menu').open=false;dialog.showModal();void poll();};
 $('video-close').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{player.pause();});
 $('video-windows').onclick=async()=>{if(busy)return;feedback='';busy=true;const id=current?.id;render();try{const data=await request('/api/video/windows');if(id!==current?.id)return;const select=$('video-target');select.replaceChildren();const empty=document.createElement('option');empty.value='';empty.textContent=t('請選擇會議視窗');select.append(empty);for(const win of data.windows||[]){const option=document.createElement('option');option.value=win.id;option.textContent=win.title+' · '+win.width+'×'+win.height;select.append(option);}if(!data.windows?.length)$('video-message').textContent=t('找不到可用視窗；請先開啟會議視窗。');state={...state,...data};}catch(error){feedback=error.message;}finally{busy=false;render();}};
 $('video-target').onchange=render;
 $('video-install').onclick=async()=>{if(busy)return;busy=true;feedback='正在下載並驗證 FFmpeg 元件…';render();try{state={...state,...await request('/api/video/install',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})};feedback='';}catch(error){feedback=error.message;}finally{busy=false;render();}};
 async function action(action){if(busy||!current)return;feedback='';busy=true;epoch++;const id=current.id;render();try{const next=await request('/api/video',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,action,...(action==='start'?{windowId:$('video-target').value}:{})})});if(current?.id===id)state={...state,...next};}catch(error){feedback=error.message;}finally{busy=false;render();void poll();}}
 $('video-start').onclick=()=>void action('start');$('video-stop').onclick=()=>void action('stop');
 player.addEventListener('play',()=>{$('meeting-audio')?.pause();});
 player.addEventListener('error',()=>{if(loaded)$('video-message').textContent=t('影片無法播放，請下載檢查；錄音與字幕不受影響。');});
 player.addEventListener('loadedmetadata',()=>{if(pendingSeek!==null){player.currentTime=pendingSeek;pendingSeek=null;}});
 document.addEventListener('seek-recording',({detail})=>{
  if(!sync||!$('video-sync').checked||!current||!state?.segments?.length)return;
  const base=Date.parse(current.status?.joinedAt||current.status?.startedAt),seconds=(Date.parse(detail.time)-base)/1000;
  const part=state.segments.find(s=>seconds>=s.meetingStartSeconds&&seconds<s.meetingEndSeconds);
  if(!part){$('video-message').textContent=t('這個時間尚未錄影，無法定位影片。');dialog.showModal();return;}
  const file=state.file||part.file,src='/api/video-file?id='+encodeURIComponent(current.id)+'&file='+encodeURIComponent(file),target=state.file?seconds-state.offsetSeconds:seconds-part.meetingStartSeconds;
  if(loaded!==src){loaded=src;pendingSeek=Math.max(0,target);player.src=src;}else if(player.readyState>=1)player.currentTime=Math.max(0,target);else pendingSeek=Math.max(0,target);
  $('meeting-audio')?.pause();dialog.showModal();
 });
 entry.addEventListener('click',()=>{sync=true;});
 document.addEventListener('workspace-rendered',({detail})=>{if(current?.id!==detail?.id){epoch++;player.pause();dialog.close();sync=false;feedback='';state=detail?.video||{state:'idle'};$('video-target').replaceChildren();}current=detail;if(dialog.open)void poll();});
 document.addEventListener('ui-language-change',render);
 setInterval(()=>{if(dialog.open||active(state)||recordingId)void poll();},2000);
})();
