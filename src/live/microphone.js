(() => {
  const byId = (id) => document.getElementById(id);
  const start = byId('mic-start'), stop = byId('mic-stop'), device = byId('mic-device');
  const mode = byId('audio-mode');
  const message = (text) => { byId('mic-status').textContent = text; };
  let stream, context, node, source, analyser, session, upload = Promise.resolve(), queued = 0, sequence = 0, stopping = false, meterFrame, flushResolve, heartbeatTimer;
  let deviceGeneration = 0, teamsReady = false, starting = false;
  function updateStart() { start.disabled = starting || !!session || stopping || (mode.value === 'teams' && !teamsReady); }
  async function post(url, body) {
    const response = await fetch(url, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(body) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || '操作失敗'); return data;
  }
  async function devices() {
    const generation = ++deviceGeneration, captureMode = mode.value;
    const current = () => generation === deviceGeneration && mode.value === captureMode;
    if (captureMode === 'teams') { teamsReady = false; updateStart(); }
    else if (!starting && !session) message('尚未收音；按開始後會要求麥克風權限。');
    try {
      if (mode.value === 'teams') {
        message('正在讀取 Windows 播放裝置與麥克風…');
        const response = await fetch('/api/audio-devices'); const data = await response.json();
        if (!current()) return;
        if (!response.ok) throw new Error(data.error || '無法列出 Windows 裝置');
        if (!Array.isArray(data.inputs) || !Array.isArray(data.outputs)) throw new Error('Windows 裝置資料格式錯誤');
        for (const [id, entries, defaultId] of [['teams-input', data.inputs, data.defaultInput], ['teams-output', data.outputs, data.defaultOutput]]) {
          const select = byId(id), previous = select.value;
          select.replaceChildren(...entries.map((d) => new Option(d.name, String(d.id))));
          select.value = entries.some((d) => String(d.id) === previous) ? previous : String(defaultId);
        }
        teamsReady = !!byId('teams-input').value && !!byId('teams-output').value;
        if (!teamsReady) { message('找不到可用的 Windows 播放裝置與麥克風，請連接裝置後重新整理。'); return; }
        message('Windows 雙路收音已就緒；請選擇與 Teams 相同的裝置。'); return;
      }
      const selected = device.value;
      const inputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
      if (!current()) return;
      device.replaceChildren(new Option('系統預設麥克風', ''), ...inputs.filter((d) => d.deviceId && d.deviceId !== 'default').map((d, i) => new Option(d.label || `麥克風 ${i + 1}`, d.deviceId)));
      if ([...device.options].some((o) => o.value === selected)) device.value = selected;
    } catch (error) { if (current()) message('無法列出麥克風：' + error.message); }
    finally { if (current()) updateStart(); }
  }
  function meter() {
    if (!analyser) return;
    const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples);
    const rms = Math.sqrt(samples.reduce((sum, s) => sum + s * s, 0) / samples.length);
    byId('mic-level').value = Math.min(1, rms * 5);
    if(session) document.dispatchEvent(new CustomEvent('record-level',{detail:{id:session.id,value:Math.min(1,rms*5)}}));
    meterFrame = requestAnimationFrame(meter);
  }
  async function release() {
    cancelAnimationFrame(meterFrame); analyser = null;
    source?.disconnect(); node?.disconnect(); stream?.getTracks().forEach((t) => t.stop());
    if (context && context.state !== 'closed') await context.close();
    source = node = context = stream = null; byId('mic-level').value = 0;
  }
  function enqueue(pcm) {
    if (!session) return;
    queued++;
    if (queued > 40) { finish('傳輸跟不上收音速度，正在停止並保留已收到的錄音。'); return; }
    const current = session, index = sequence++;
    upload = upload.then(async () => {
      const response = await fetch('/api/microphone/audio', { method:'POST', headers:{ 'Content-Type':'application/octet-stream', 'X-Session-Token':current.token, 'X-Audio-Sequence':String(index) }, body:pcm });
      if (!response.ok) { const data = await response.json(); throw new Error(data.error || '音訊傳送失敗'); }
    }).finally(() => queued--);
    upload.catch((error) => { finish('收音已停止：' + error.message); });
  }
  async function finish(reason) {
    if (stopping) return;
    const finishedId = session?.id;
    let finishError = '';
    stopping = true; stop.disabled = true;
    clearInterval(heartbeatTimer);
    message(reason || '停止收音，正在保存最後一段並完成辨識…');
    try {
      source?.disconnect();
      if (node) await Promise.race([new Promise((resolve) => { flushResolve = resolve; node.port.postMessage('flush'); }), new Promise((resolve) => setTimeout(resolve, 1000))]);
      await release(); await upload.catch(() => {});
      if (session) await post('/api/microphone/stop', { token:session.token });
      if (!reason) message('已停止收音，剩餘辨識在本機完成；可查看下方會議狀態。');
    } catch (error) { finishError='收音已停止；收尾失敗：' + error.message; message(finishError); }
    finally { session = null; starting = false; device.disabled = false; mode.disabled = false; byId('teams-input').disabled = false; byId('teams-output').disabled = false; byId('teams-mic-level').value = 0; byId('teams-system-level').value = 0; stopping = false; updateStart(); document.dispatchEvent(new CustomEvent('record-finished',{detail:{id:finishedId,error:finishError}})); }
  }
  start.addEventListener('click', async () => {
    if (start.disabled || starting || session || stopping) return;
    starting = true; start.disabled = true; device.disabled = true; mode.disabled = true; byId('teams-input').disabled = true; byId('teams-output').disabled = true; stopping = false; sequence = 0; queued = 0; upload = Promise.resolve();
    try {
      if (mode.value === 'teams') {
        if (!byId('teams-input').value || !byId('teams-output').value) throw new Error('尚未選擇 Windows 播放裝置與麥克風');
        message('正在載入本機模型並開啟 Windows 雙路收音…');
        session = await post('/api/microphone/start', { mode:'teams', input:Number(byId('teams-input').value), output:Number(byId('teams-output').value) });
        document.dispatchEvent(new CustomEvent('microphone-started', { detail:{ id:session.id } }));
        heartbeatTimer = setInterval(() => { if (session) post('/api/microphone/heartbeat', { token:session.token }).catch((error) => finish(error.message)); }, 2000);
        stop.disabled = false; message('● Teams 雙路收音中 · 自己：講者 A · 遠端：講者 B 起 · 全部留在本機'); return;
      }
      message('正在開啟麥克風…');
      stream = await navigator.mediaDevices.getUserMedia({ audio:{ deviceId:device.value ? { exact:device.value } : undefined, channelCount:1, echoCancellation:false, noiseSuppression:true }, video:false });
      await devices();
      context = new AudioContext({ sampleRate:16000 });
      await context.resume(); await context.audioWorklet.addModule('/pcm-worklet.js');
      source = context.createMediaStreamSource(stream);
      analyser = context.createAnalyser(); analyser.fftSize = 1024; source.connect(analyser); meter();
      message('正在載入本機辨識模型，載入完成後開始記錄…');
      session = await post('/api/microphone/start', {});
      node = new AudioWorkletNode(context, 'pcm-capture');
      node.port.onmessage = ({ data }) => { if (data.flushed) flushResolve?.(); else if (data.pcm) enqueue(data.pcm); };
      source.connect(node); const mute = context.createGain(); mute.gain.value = 0; node.connect(mute); mute.connect(context.destination);
      document.dispatchEvent(new CustomEvent('microphone-started', { detail:{ id:session.id } }));
      stop.disabled = false; message('● 正在本機收音 · 依聲音區分講者 A、B · 請告知與會者正在記錄');
      stream.getTracks().forEach((track) => track.addEventListener('ended', () => finish('麥克風已中斷，正在收尾。')));
    } catch (error) {
      message('無法開始收音：' + error.message);
      if (session) await finish('無法開始收音：' + error.message); else { await release(); device.disabled = false; mode.disabled = false; byId('teams-input').disabled = false; byId('teams-output').disabled = false; }
    } finally { starting = false; updateStart(); }
  });
  stop.addEventListener('click', () => finish());
  document.addEventListener('record-stop',({detail})=>{if(session?.id === detail.id) void finish();});
  document.addEventListener('meeting-status', ({ detail }) => {
    if (session?.id === detail.id && detail.status?.source === 'teams') {
      byId('teams-mic-level').value = Math.min(1, (detail.status.stats?.levels?.mic || 0) / 12000);
      byId('teams-system-level').value = Math.min(1, (detail.status.stats?.levels?.system || 0) / 12000);
    }
    if (session?.id === detail.id && ['done', 'failed'].includes(detail.status?.state)) {
      finish(detail.status?.error?.message || '本機辨識已結束。');
    }
  });
  byId('mic-refresh').addEventListener('click', devices);
  mode.addEventListener('change', () => {
    byId('teams-devices').hidden = mode.value !== 'teams';
    device.closest('label').hidden = mode.value === 'teams';
    byId('capture-description').textContent = mode.value === 'teams' ? '錄製電腦播放的所有聲音與自己的麥克風，建議使用耳機。' : '錄製這台電腦麥克風收到的聲音。';
    devices();
  });
  addEventListener('pagehide', () => {
    stream?.getTracks().forEach((track) => track.stop());
    if (session) navigator.sendBeacon('/api/microphone/stop', new Blob([JSON.stringify({ token:session.token })], { type:'application/json' }));
  });
  if (new URLSearchParams(location.search).get('source') === 'teams') {
    mode.value = 'teams'; mode.dispatchEvent(new Event('change'));
  } else devices();
})();
