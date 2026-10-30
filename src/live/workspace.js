(() => {
  const $=id=>document.getElementById(id), audio=$('meeting-audio');
  let rowSelection=null,storageSignature='',taskBusy=false,sourceFilesSignature='',storageUpdatedAt=0,storagePending=false;
  document.addEventListener('ui-language-change',()=>{notesSignature='';sourceFilesSignature='';highlightsSignature='';storageUpdatedAt=0;const select=$('audio-track');if(select)delete select.dataset.signature;$('audio-play').textContent=uiText(audio.paused?'▶ 播放錄音':'Ⅱ 暫停錄音');});
  let current=null, tab='overview', notesSignature='', audioKey='', duration=0, pendingSeek=null,renameMeetingId='',marking=false,highlightsSignature='';
  const terminal=state=>['done','failed','archived'].includes(state);
  const message=text=>{$('workspace-message').textContent=text;};
  const readPref=(key,fallback)=>{try{return localStorage.getItem('duck-meeting:'+key)||fallback;}catch{return fallback;}};
  const savePref=(key,value)=>{try{localStorage.setItem('duck-meeting:'+key,value);}catch{message(uiText('瀏覽器未允許保存偏好，本次設定仍可使用。'));}};
  function time(value){const seconds=Math.max(0,Math.floor(Number(value)||0));return `${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;}
  function date(value){const d=new Date(value);return Number.isNaN(+d)?uiText('時間未記錄'):d.toLocaleString(window.DuckI18n.language,{hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});}
  function saveFile(text,name,type='text/markdown'){ const url=URL.createObjectURL(new Blob([text],{type:type+';charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);}
  function partition(markdown,kind){
    if(kind==='overview')return markdown;
    const wanted=kind==='actions'?/行動|待辦|action items|next steps/i:/決議|決策|決定|decisions?/i;
    const lines=String(markdown).split(/\r?\n/),out=[];let capture=false,level=0;
    for(let i=0;i<lines.length;i++){
      const line=lines[i];
      const heading=/^(#{1,6})\s+(.+)$/.exec(line);
      if(heading){if(capture && heading[1].length<=level)capture=false;if(wanted.test(heading[2])){capture=true;level=heading[1].length;}}
      if(capture)out.push(line);
      else if(kind==='decisions' && /(?:最終)?決議(?:\*\*)?\s*[：:]/.test(line)){
        out.push(line);
        while(i+1<lines.length && (/^\s{2,}\S/.test(lines[i+1]) || !lines[i+1].trim()))out.push(lines[++i]);
      }
    }
    return out.join('\n').trim();
  }
  function renderNotes(data){
    const sum=data?.summary||{},ready=sum.state==='ready'&&!!sum.markdown;
    $('notes-copy').disabled=$('notes-download').disabled=!ready;
    const key=JSON.stringify([data?.id,sum.state,sum.markdown,sum.updatedAt,tab,data?.workspace?.actions]);
    if(key===notesSignature)return;notesSignature=key;
    if(!ready)return;
    const markdown=partition(sum.markdown,tab);
    const fragment=renderMarkdownDom(markdown || (tab==='actions'?uiText('這份紀錄未列出待辦段落，請查看摘要全文。'):uiText('這份紀錄未列出獨立決議段落，請查看摘要全文。')));
    const cards=document.createDocumentFragment();let card=null;
    for(const node of [...fragment.childNodes]){if(!card||node.classList?.contains('summary-h')){card=document.createElement('section');card.className='note-card';cards.append(card);}card.append(node);}
    $('summary-body').replaceChildren(cards);
    for(const button of document.querySelectorAll('[data-notes-tab]')){const kind=button.dataset.notesTab,label=kind==='actions'?uiText('待辦'):kind==='decisions'?uiText('決議'):uiText('摘要');button.setAttribute('aria-label',label);const count=kind==='actions'?data.workspace?.actions?.items.length:kind==='decisions'?(partition(sum.markdown,'decisions').match(/^\s*(?:[-*]|\d+\.)\s+\S/gm)||[]).length:null;button.textContent=label+(count?' ('+count+')':'');}
  }

  function transcriptText(data){return (data?.records||[]).map(record=>(record.speaker||uiText('未知發言者'))+' '+date(record.t0)+'\n'+record.text).join('\n\n');}
  function renderSourceFiles(data){
    const signature=JSON.stringify([data?.id,data?.workspace?.audio?.map(item=>[item.name,item.seconds]),data?.records?.length]);if(signature===sourceFilesSignature)return;sourceFilesSignature=signature;const files=$('source-files');files.replaceChildren();
    const audio=data?.workspace?.audio||[];
    const definitions=[];
    if(audio.length)definitions.push({icon:'≋',label:uiText('會議音檔'),name:audio[0].name,detail:time(audio[0].seconds),action:uiText('回聽來源錄音'),click:()=>{seek(0,true);$('meeting-audio').scrollIntoView({block:'nearest'});$('audio-play').focus();}});
    if(data?.records?.length)definitions.push({icon:'▤',label:uiText('逐字稿'),name:'transcript.jsonl',detail:data.records.length+uiText(' 段'),action:uiText('檢視逐字稿來源'),click:()=>{$('source-transcript-text').textContent=transcriptText(current);$('source-transcript-dialog').showModal();}});
    for(const entry of definitions){const row=document.createElement('div');row.className='source-file';const icon=document.createElement('span');icon.className='source-file-icon';icon.setAttribute('aria-hidden','true');icon.textContent=entry.icon;const label=document.createElement('span');label.textContent=entry.label;const name=document.createElement('span');name.className='source-file-name';name.textContent=entry.name;name.title=entry.name;const detail=document.createElement('small');detail.textContent=entry.detail;const button=document.createElement('button');button.type='button';button.textContent='↗';button.setAttribute('aria-label',entry.action);button.addEventListener('click',entry.click);row.append(icon,label,name,detail,button);files.append(row);}
  }
  async function loadStorage(){
    if(storagePending)return;storagePending=true;
    try{const response=await fetch('/api/storage');if(!response.ok)throw new Error('storage');const info=await response.json();const bytes=n=>n>=1073741824?(n/1073741824).toFixed(1)+' GB':n>=1048576?(n/1048576).toFixed(1)+' MB':Math.ceil(n/1024)+' KB';$('storage-detail').textContent=(info.partial?uiText('至少 '):'')+bytes(info.usedBytes)+' · '+(info.availableBytes===null?uiText('磁碟資訊未提供'):uiText('可用 ')+bytes(info.availableBytes));const meter=$('storage-meter');meter.hidden=!(info.totalBytes>0&&info.availableBytes!==null);if(!meter.hidden)meter.value=Math.max(0,Math.min(1,1-info.availableBytes/info.totalBytes));}
    catch{$('storage-detail').textContent=uiText('容量暫時無法讀取；資料保存在此電腦');$('storage-meter').hidden=true;}finally{storagePending=false;storageUpdatedAt=Date.now();}
  }
  document.addEventListener('action-item-change',async({detail})=>{
    if(taskBusy||current?.id!==detail.id){detail.control.checked=!detail.completed;return;}
    taskBusy=true;detail.control.disabled=true;message(uiText('正在保存待辦狀態…'));
    try{const response=await fetch('/api/action-items',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:detail.id,key:detail.key,revision:detail.revision,completed:detail.completed})});const result=await response.json();if(!response.ok)throw new Error(result.error||uiText('保存失敗'));if(current?.id===detail.id){await pollNow();message(detail.completed?uiText('已完成待辦；原始會議紀錄保持不變'):uiText('已恢復為未完成'));}}
    catch(error){detail.control.checked=!detail.completed;if(current?.id===detail.id)message(uiText('待辦未保存：')+error.message);}
    finally{taskBusy=false;detail.control.disabled=false;}
  });
  document.addEventListener('utterance-menu',({detail})=>{if(current?.id!==detail.meetingId)return;rowSelection=detail;$('utterance-quote').textContent=detail.record.text;$('utterance-mark').textContent=detail.record.highlighted?uiText('取消重點'):uiText('標記重點');$('utterance-jump').disabled=!audioKey;$('utterance-dialog').showModal();});
  $('utterance-copy').addEventListener('click',async()=>{if(!rowSelection)return;try{await navigator.clipboard.writeText(rowSelection.record.text);message(uiText('已複製段落原文'));}catch{message(uiText('無法存取剪貼簿，請從逐字稿來源下載。'));}});
  $('utterance-jump').addEventListener('click',()=>{if(!rowSelection)return;document.dispatchEvent(new CustomEvent('seek-recording',{detail:{time:rowSelection.record.t0}}));$('utterance-dialog').close();});
  $('utterance-mark').addEventListener('click',()=>{if(!rowSelection)return;const selection=rowSelection;$('utterance-dialog').close();void saveHighlight({meetingId:selection.meetingId,key:selection.record.highlightKey,kind:'utterance',action:selection.record.highlighted?'unmark':'mark'});});
  $('source-transcript-download').addEventListener('click',()=>{if(current?.id)saveFile(transcriptText(current),current.id+'-transcript.txt','text/plain');});
  $('audio-expand').addEventListener('click',()=>{const pane=$('workspace-grid').firstElementChild,expanded=pane.classList.toggle('audio-expanded');$('audio-expand').setAttribute('aria-label',expanded?uiText('還原錄音播放器'):uiText('放大錄音播放器'));$('audio-expand').setAttribute('aria-pressed',String(expanded));});
  document.addEventListener('keydown',event=>{const editing=['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName);if(event.key==='Escape'){const pane=$('workspace-grid').firstElementChild;if(pane.classList.contains('audio-expanded')){pane.classList.remove('audio-expanded');$('audio-expand').setAttribute('aria-label',uiText('放大錄音播放器'));$('audio-expand').setAttribute('aria-pressed','false');}}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();$('meeting-search').focus();}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='f'&&!editing){event.preventDefault();$('transcript-search').focus();}});

  function drawWaveform(values){
    const svg=$('audio-waveform');svg.replaceChildren();
    values.forEach((v,i)=>{const rect=document.createElementNS('http://www.w3.org/2000/svg','rect');const h=Math.max(1,Math.min(44,v*44));rect.setAttribute('x',String(i*8));rect.setAttribute('y',String((48-h)/2));rect.setAttribute('width','3');rect.setAttribute('height',String(h));rect.setAttribute('rx','1.5');svg.append(rect);});
  }
  function updateTime(){const total=Number.isFinite(audio.duration)?audio.duration:duration;const now=Number.isFinite(audio.currentTime)?audio.currentTime:0;$('audio-time').textContent=`${time(now)} / ${time(total)}`;$('audio-seek').max=String(total||1);$('audio-seek').value=String(now);Array.from($('audio-waveform').children).forEach((bar,i)=>bar.classList.toggle('played',total>0&&i/64<=now/total));}
  function loadTrack(name){
    const info=current?.workspace?.audio?.find(item=>item.name===name);
    if(!info)return;
    const key=current.id+':'+name;
    if(key===audioKey)return;
    audioKey=key;audio.pause();duration=info.seconds;pendingSeek=null;$('audio-message').textContent='';
    audio.src='/api/audio?id='+encodeURIComponent(current.id)+'&file='+encodeURIComponent(name);
    audio.playbackRate=Number($('audio-speed').value);audio.volume=Number($('audio-volume').value);
    $('audio-play').disabled=false;drawWaveform(info.waveform);updateTime();
  }
  function renderAudio(data){
    const tracks=terminal(data?.status?.state)?data?.workspace?.audio||[]:[];
    const select=$('audio-track'),signature=JSON.stringify([data?.id,tracks.map(x=>x.name)]);
    if(select.dataset.signature!==signature){const previous=select.value;select.dataset.signature=signature;select.replaceChildren(...tracks.map(t=>new Option(t.name==='audio.wav'?uiText('混合錄音'):t.name==='audio-system.wav'?uiText('電腦／遠端聲音'):uiText('麥克風'),t.name)));if(tracks.some(t=>t.name===previous))select.value=previous;}
    select.disabled=!tracks.length;select.parentElement.hidden=tracks.length<=1;$('audio-controls').hidden=!tracks.length;$('audio-empty').hidden=!!tracks.length;
    if(!tracks.length){if(audioKey){audio.pause();audio.removeAttribute('src');audio.load();audioKey='';}return;}
    loadTrack(select.value||tracks[0].name);
  }
  function renderSources(data){
    const st=data?.status||{},workspace=data?.workspace||{},hasAudio=!!workspace.audio?.length;
    $('audio-saved-status').textContent=hasAudio&&terminal(st.state)?uiText('✓ 錄音已保存'):st.state==='in_call'?uiText('◉ 記錄進行中'):uiText('○ 尚無錄音檔案');
    $('transcript-saved-status').textContent=data?.records?.length?uiText('✓ 逐字稿已同步'):uiText('○ 尚無逐字稿');
    $('notes-saved-status').textContent=data?.summary?.state==='ready'?uiText('✓ 紀錄已整理'):data?.summary?.state==='waiting_agent'?uiText('○ 等待 Agent 整理'):uiText('○ 尚未整理');
    for(const [id,ready] of [['audio-saved-status',hasAudio&&terminal(st.state)],['transcript-saved-status',!!data?.records?.length],['notes-saved-status',data?.summary?.state==='ready']]){const el=$(id);el.classList.toggle('complete',ready);el.textContent=el.textContent.replace(/^[✓○◉]\s*/,'');}
    const comparison=workspace.comparison;
    const sourceText=$('comparison-sources');sourceText.replaceChildren();
    if(comparison?.state==='compared'){
      const platform=st.source==='meet'?'Google Meet':st.source==='teams'?'Teams':uiText('平台');
      const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 32 28');icon.setAttribute('class','source-camera');icon.setAttribute('aria-hidden','true');
      for(const [d,fill] of (st.source==='meet'?[['M2 7h20v18H2Z','#17aa79'],['M2 7 10 0h12v8H2Z','#f9c343'],['M2 8h7v17H2Z','#4285f4'],['m22 9 8-6v22l-8-6Z','#27ad65']]:[['M2 7h20v18H2Z','#647aac'],['m22 9 8-6v22l-8-6Z','#647aac']])){const shape=document.createElementNS('http://www.w3.org/2000/svg','path');shape.setAttribute('d',d);shape.setAttribute('fill',fill);icon.append(shape);}
      const label=document.createElement('span');label.className='source-label';label.textContent=platform+uiText(' 字幕 + 錄音轉錄');sourceText.append(icon,label);
    }else sourceText.textContent=uiText(comparison?.reason||'')||uiText('尚無可核對來源');
    $('comparison-count').textContent=comparison?.state==='compared'?(comparison.pairs.length?uiText('{count} 處文字差異待確認',{count:comparison.pairs.length}):uiText('已對齊片段文字一致')):uiText('尚未完成核對');
    $('open-comparison').disabled=!comparison||!['compared','unaligned'].includes(comparison.state);
    $('comparison-count').className='sr-only';
    $('open-comparison').textContent=comparison?.state==='compared'?(comparison.pairs.length?uiText('發現 ')+comparison.pairs.length+uiText(' 處差異 ›'):uiText('已核對 · 檢視來源')):uiText('檢視來源');
    $('audio-source-detail').textContent=hasAudio?time(workspace.audio[0].seconds)+' · WAV':st.state==='in_call'?uiText('會議進行中，正在擷取'):uiText('尚無已完成音檔');
    $('transcript-source-detail').textContent=data?.records?.length?(workspace.speakerCount||0)+uiText(' 位發言者 · ')+data.records.length+uiText(' 段發言'):uiText('尚無定稿逐字稿');
    $('notes-source-detail').textContent=data?.summary?.state==='ready'?uiText('摘要 · 決議 · 待辦事項'):data?.summary?.state==='waiting_agent'?uiText('等待目前 Agent 接手'):uiText('依實際整理進度更新');
    renderSourceFiles(data);
  }
  function render(data){
    if(current?.id && current.id!==data?.id){$('meeting-menu').open=false;for(const id of ['rename-dialog','comparison-dialog','highlights-dialog','utterance-dialog','source-transcript-dialog'])if($(id).open)$(id).close();}
    if(current?.id!==data?.id)rowSelection=null;current=data;const st=data?.status||{},workspace=data?.workspace||{};
    $('breadcrumb-title').textContent=workspace.title||uiText('會議工作台');
    $('workspace-export').disabled=$('rename-meeting').disabled=!data?.id;
    $('archive-current').disabled=!data?.id||!terminal(st.state)||['waiting_agent','generating'].includes(st.summaryJob?.state);
    $('archive-current').textContent=st.state==='archived'?uiText('取消封存'):uiText('封存會議');
    const platform=st.source==='microphone'?uiText('現場錄音'):st.source==='teams'?uiText('Teams／電腦收音'):'Google Meet';
    $('meeting-metadata').textContent=data?.id?`${platform} · ${date(st.joinedAt||st.startedAt)}${st.endedAt?' – '+new Date(st.endedAt).toLocaleTimeString(window.DuckI18n.language,{hour:'2-digit',minute:'2-digit',hour12:false}):''} · ${uiText('{count} 位發言者',{count:workspace.speakerCount||0})}`:'';
    const seconds=workspace.audio?.[0]?.seconds||st.stats?.audioSeconds||(st.startedAt?Math.max(0,((st.endedAt?Date.parse(st.endedAt):Date.now())-Date.parse(st.joinedAt||st.startedAt))/1000):0);
    $('meeting-duration').textContent=seconds?time(seconds):'—';
    renderAudio(data);renderSources(data);renderNotes(data);renderHighlights(data);const storageKey=JSON.stringify([data?.id,st.state]);if(storageKey!==storageSignature||Date.now()-storageUpdatedAt>60000){storageSignature=storageKey;void loadStorage();}
  }
  document.addEventListener('workspace-rendered',event=>render(event.detail));
  document.addEventListener('workspace-empty',()=>{current=null;render({records:[],workspace:{}});});
  document.querySelectorAll('[data-notes-tab]').forEach(button=>button.addEventListener('click',()=>{tab=button.dataset.notesTab;document.querySelectorAll('[data-notes-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));renderNotes(current);}));
  $('notes-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(current.summary.markdown);message(uiText('已複製會議紀錄'));}catch{message(uiText('無法存取剪貼簿，請使用下載會議紀錄。'));}});
  $('notes-download').addEventListener('click',()=>{if(current?.summary?.markdown)saveFile(current.summary.markdown,current.id+'-summary.md');});
  $('workspace-export').addEventListener('click',()=>{if(current?.id)exportMeeting(current.id);});
  $('archive-current').addEventListener('click',()=>{$('meeting-menu').open=false;if(current?.id)void performMeetingAction(current.id,current.status.state==='archived'?'unarchive':'archive');});
  $('rename-meeting').addEventListener('click',()=>{if(!current)return;$('meeting-menu').open=false;renameMeetingId=current.id;$('rename-input').value=current.workspace.title;$('rename-error').textContent='';$('rename-dialog').showModal();$('rename-input').focus();});
  $('rename-form').addEventListener('submit',async event=>{event.preventDefault();const id=renameMeetingId,title=$('rename-input').value.trim();if(!id||!title){$('rename-error').textContent=uiText('請輸入會議名稱');return;}$('rename-save').disabled=true;try{const r=await fetch('/api/meetings/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,action:'rename',title})});const data=await r.json();if(!r.ok)throw new Error(data.error||uiText('儲存失敗'));$('rename-dialog').close();await pollNow();message(uiText('會議名稱已更新'));}catch(error){$('rename-error').textContent=error.message;}finally{$('rename-save').disabled=false;}});
  document.querySelectorAll('[data-close-dialog]').forEach(button=>button.addEventListener('click',()=>$(button.dataset.closeDialog).close()));
  document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>{if(button.dataset.view==='summary')audio.pause();if($('settings-dialog').open)$('settings-dialog').close();}));
  $('toggle-transcript-search').addEventListener('click',()=>{$('transcript-search').focus();});
  $('open-settings').addEventListener('click',()=>$('settings-dialog').showModal());
  $('open-help').addEventListener('click',()=>$('help-dialog').showModal());
  $('help-report').addEventListener('click',()=>{$('help-dialog').close();openIssueModal();});
  const density=readPref('density','comfortable');$('density-setting').value=['comfortable','compact'].includes(density)?density:'comfortable';document.documentElement.dataset.density=$('density-setting').value;
  $('density-setting').addEventListener('change',()=>{document.documentElement.dataset.density=$('density-setting').value;savePref('density',$('density-setting').value);});
  const speed=readPref('speed','1');if([...$('audio-speed').options].some(o=>o.value===speed))$('audio-speed').value=speed;
  $('audio-track').addEventListener('change',()=>loadTrack($('audio-track').value));
  $('audio-play').addEventListener('click',async()=>{if(!audio.paused){audio.pause();return;}try{await audio.play();}catch{ $('audio-message').textContent=uiText('無法播放這份錄音，請切換音軌或下載後檢查。'); }});
  audio.addEventListener('play',()=>{$('audio-play').textContent=uiText('Ⅱ 暫停錄音');$('audio-play').dataset.playing='true';});audio.addEventListener('pause',()=>{$('audio-play').textContent=uiText('▶ 播放錄音');$('audio-play').dataset.playing='false';});
  audio.addEventListener('timeupdate',updateTime);audio.addEventListener('loadedmetadata',()=>{if(pendingSeek!==null){audio.currentTime=pendingSeek;pendingSeek=null;}updateTime();});
  audio.addEventListener('error',()=>{if(audioKey){$('audio-message').textContent=uiText('錄音檔案無法讀取或格式不支援，請匯出檔案檢查。');$('audio-play').disabled=true;}});
  $('audio-seek').addEventListener('input',()=>seek(Number($('audio-seek').value)));
  $('audio-speed').addEventListener('change',()=>{audio.playbackRate=Number($('audio-speed').value);savePref('speed',$('audio-speed').value);});
  $('audio-volume').addEventListener('input',()=>{audio.volume=Number($('audio-volume').value);});
  function seek(seconds,preferMixed=false){if(preferMixed && current?.workspace?.audio?.some(track=>track.name==='audio.wav')){$('audio-track').value='audio.wav';loadTrack('audio.wav');}if(!audioKey){message(uiText('這場尚無可播放錄音，無法跳轉。'));return;}const target=Math.max(0,Math.min(duration,seconds));if(audio.readyState>=1)audio.currentTime=target;else pendingSeek=target;updateTime();}
  document.addEventListener('seek-recording',({detail})=>{const base=Date.parse(current?.status?.joinedAt||current?.status?.startedAt);if(Number.isFinite(base))seek((Date.parse(detail.time)-base)/1000,true);});
  function renderHighlights(data){
    const markers=data?.highlights||[],live=data?.status?.state==='in_call';
    $('highlight-tools').hidden=!live&&!markers.length;
    $('mark-moment').hidden=!live;$('mark-moment').disabled=marking;
    $('open-highlights').textContent=uiText('查看重點（{count}）',{count:markers.length});$('open-highlights').disabled=!markers.length;
    $('highlights-only-label').hidden=!markers.length;
    if(!markers.length)$('highlights-only').checked=false;
    const key=JSON.stringify([data?.id,markers,audioKey]);if(key===highlightsSignature)return;highlightsSignature=key;
    const list=$('highlights-list');list.replaceChildren();
    for(const marker of markers){
      const article=document.createElement('article');article.className='highlight-entry';
      const heading=document.createElement('h3');heading.textContent=(marker.offsetSeconds===null?uiText('時間未知'):time(marker.offsetSeconds))+' · '+(marker.kind==='moment'?uiText('此刻重點'):uiText('整段重點'));
      const meta=document.createElement('p');meta.className='highlight-meta';meta.textContent=(marker.speaker||uiText('尚未確認發言者'))+(marker.pending?uiText(' · 當時字幕尚未定稿'):'');
      const quote=document.createElement('p');quote.textContent=marker.text||uiText('當時尚無近期字幕；已保存時間，可在會後回聽錄音。');
      const jump=document.createElement('button');jump.type='button';jump.textContent=uiText('跳至錄音 ')+(marker.offsetSeconds===null?'':time(marker.offsetSeconds));jump.disabled=!audioKey||marker.offsetSeconds===null;jump.addEventListener('click',()=>{seek(marker.offsetSeconds,true);$('highlights-dialog').close();});
      const remove=document.createElement('button');remove.type='button';remove.textContent=uiText('取消此標記');remove.setAttribute('aria-label',uiText('取消此標記 ')+heading.textContent);remove.addEventListener('click',()=>void saveHighlight({meetingId:data.id,action:'unmark',key:marker.key}));
      article.append(heading,meta,quote,jump,remove);list.append(article);
    }
    if(!markers.length){const empty=document.createElement('p');empty.textContent=uiText('目前沒有重點標記');list.append(empty);}
  }
  async function saveHighlight(input){
    if(marking||!input.meetingId||current?.id!==input.meetingId)return;
    const meetingId=input.meetingId;marking=true;$('mark-moment').disabled=true;$('highlight-feedback').textContent=uiText('正在保存重點…');
    try{
      const response=await fetch('/api/highlights',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:meetingId,action:input.action,kind:input.kind,key:input.key})});
      const result=await response.json();if(!response.ok)throw new Error(result.error||uiText('無法保存標記'));
      if(current?.id!==meetingId)return;
      $('highlight-feedback').textContent=input.action==='unmark'?uiText('已取消標記'):uiText('已保存重點，會後整理將參考這些標記');
      await pollNow();
    }catch(error){if(current?.id===meetingId)$('highlight-feedback').textContent=uiText('標記失敗：')+error.message;}
    finally{marking=false;if(current)renderHighlights(current);}
  }
  $('mark-moment').addEventListener('click',()=>void saveHighlight({meetingId:current?.id,action:'mark',kind:'moment'}));
  document.addEventListener('highlight-utterance',({detail})=>void saveHighlight(detail));
  $('open-highlights').addEventListener('click',()=>{renderHighlights(current);$('highlights-dialog').showModal();});
  $('open-comparison').addEventListener('click',()=>{
    const comparison=current?.workspace?.comparison;if(!comparison)return;
    $('comparison-explanation').textContent=uiText(comparison.reason)+uiText(' 未對齊錄音片段：{count}。文字一致也不等於已驗證說話者身分。',{count:comparison.unmatched||0});
    const body=$('comparison-body');body.replaceChildren();
    for(const pair of comparison.pairs){const article=document.createElement('article');const heading=document.createElement('h3');heading.textContent=uiText(pair.kind)+' · '+time(pair.start);const cc=document.createElement('p');cc.textContent=uiText('平台字幕：')+pair.caption;const stt=document.createElement('p');stt.textContent=uiText('錄音轉錄：')+pair.recording;const button=document.createElement('button');button.type='button';button.textContent=uiText('跳至錄音 ')+time(pair.start);button.disabled=!audioKey;button.addEventListener('click',()=>{seek(pair.start,true);$('comparison-dialog').close();});article.append(heading,cc,stt,button);body.append(article);}
    if(!comparison.pairs.length){const p=document.createElement('p');p.textContent=comparison.state==='compared'?uiText('已對齊片段沒有文字差異；未對齊片段仍須確認。'):uiText('未找到可對齊段落，無法判定一致或差異。');body.append(p);}
    $('comparison-dialog').showModal();
  });
})();
