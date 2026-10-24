import fs from 'node:fs';
import path from 'node:path';

// Platform events have no documented wall-clock mapping. Never infer that a
// nearby native caption proves a different ASR sentence was captured.
export class TeamsCaptionRouter {
  constructor({dir, store, changed = () => {}}) {
    Object.assign(this, {dir, store, changed});
    this.native = new Map(); this.fallback = []; this.received = 0;
  }
  platform(event) {
    if (!event || typeof event.text !== 'string' || !event.text.trim()
      || typeof event.messageId !== 'string' || !event.messageId
      || !Number.isSafeInteger(event.revision) || event.revision<0 || event.text.length > 50000
      || event.messageId.length>1024 || (event.speaker!=null && typeof event.speaker!=='string')
      || (event.speakerId!=null && typeof event.speakerId!=='string')
      || (event.sessionId!=null && typeof event.sessionId!=='string')) return false;
    const key = `${event.sessionId || 'call'}/${event.speakerId || ''}/${event.messageId}`;
    const previous = this.native.get(key);
    if (previous && event.revision <= previous.revision) return false;
    const now = new Date().toISOString();
    const record = {t0:previous?.record.t0 || now, t1:now,
      speaker:event.speaker || event.speakerId || '（平台未提供姓名）',
      text:event.text.trim(), source:'teams-native'};
    this.native.set(key, {revision:event.revision, record}); this.received++;
    fs.appendFileSync(path.join(this.dir, 'transcript-native.jsonl'), JSON.stringify({...event, receivedAt:now})+'\n');
    this.publish(); return true;
  }
  asr(record) {
    this.fallback.push(record);
    fs.appendFileSync(path.join(this.dir, 'transcript-paraformer.jsonl'), JSON.stringify(record)+'\n');
    this.publish();
  }
  publish() {
    const native = [...this.native.values()].map(x=>x.record);
    const normalize = s => String(s).normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\p{S}]/gu,'');
    // Only replace an ASR record when equivalent text occurs near it. Unmatched
    // ASR remains as fallback: a native channel can contain only one participant.
    const fallback = this.fallback.filter(r=>!native.some(n=>{
      const a=normalize(r.text), b=normalize(n.text);
      const start=Date.parse(r.t0), end=Date.parse(r.t1), stamp=Date.parse(n.t1);
      return a && a===b && stamp>=start-5000 && stamp<=end+15000;
    }));
    this.store.replaceAll([...native,...fallback].sort((a,b)=>Date.parse(a.t0)-Date.parse(b.t0)));
    this.store.renderMarkdown({captionLang:'zh-TW', extraNote:'Teams 平台原生字幕優先；未有等值字幕的 Paraformer 段落保留為備援。平台字幕時間為接收時間，備援講者為估計。'});
    this.changed({nativeCaptions:{state:native.length?'receiving':'waiting', messages:native.length, revisions:this.received}, transcriptPolicy:'native-preferred-with-unmatched-asr'});
  }
}

// Self-contained MAIN-world init script. Independently written; does not load
// vendor code, intercept credentials, or call private session/header endpoints.
export function installTeamsCaptionTap() {
  if (window.__omTeamsTap) return;
  const state = window.__omTeamsTap = {packets:0, parsed:0, errors:0};
  const emit = e => { try { window.__omTeamsCaption?.(e)?.catch?.(()=>{}); } catch {} };
  const sessionId = `${Date.now()}-${Math.random()}`;
  const participants = new Map();
  const accept = (value, call) => {
    if (!value || !Array.isArray(value.recognitionResults)) return;
    for (const r of value.recognitionResults) {
      if (!r || typeof r.text !== 'string' || !r.text.trim() || !r.userId || !r.id) continue;
      const revision = Number(String(r.id).split('/').at(-1));
      if (!Number.isFinite(revision)) continue;
      const speakerId = String(r.userId);
      let speaker = participants.get(speakerId);
      try {
        const p = call?.getParticipants?.();
        const list = Array.isArray(p)?p:Object.values(p || {});
        const match = list.find(p=>p?.id===speakerId || p?.identifier?.microsoftTeamsUserId===speakerId);
        speaker ||= match?.displayName || match?.identity?.displayName;
      } catch {}
      state.parsed++;
      emit({sessionId, speakerId, speaker, messageId:`${r.timestampAudioSent ?? String(r.id).split('/')[0]}/${speakerId}`,
        revision, text:r.text, language:r.spokenLanguage || r.trackLanguage});
    }
  };
  const consume = async data => {
    state.packets++;
    try {
      const text = typeof data==='string'?data:new TextDecoder().decode(data instanceof Blob?await data.arrayBuffer():data);
      const start = text.indexOf('{');
      if(start>=0) accept(JSON.parse(text.slice(start)));
    } catch {state.errors++;}
  };
  const channels = new WeakSet();
  const watch = channel => {
    if (!channel || channels.has(channel) || channel.label!=='main-channel') return;
    channels.add(channel); channel.addEventListener('message', e=>void consume(e.data));
  };
  const Original = window.RTCPeerConnection;
  if (Original) {
    const create = Original.prototype.createDataChannel;
    Original.prototype.createDataChannel = function(...args) {const ch=create.apply(this,args);watch(ch);return ch;};
    window.RTCPeerConnection = new Proxy(Original, {construct(target,args,newTarget) {
      const pc=Reflect.construct(target,args,newTarget);pc.addEventListener('datachannel',e=>watch(e.channel));return pc;
    }});
  }
  const hooked = new WeakSet();
  state.timer = setInterval(()=>{
    try {
      const service=window.msteamscalling?.deref?.();
      const call=service?.callingService?.getActiveCall?.() || service?.call;
      if (!call) return;
      const handler=call.dataChannel?.subscriptions?.find(s=>s.eventHandler?.on?.name==='remoteUserEventsReceived')?.eventHandler?.on;
      if(handler && !hooked.has(handler) && typeof handler.handler==='function') {
        hooked.add(handler);const original=handler.handler;
        handler.handler=function(type,body,...rest) {
          try {if(String(type)==='3') accept(typeof body==='string'?JSON.parse(body):body,call);}catch{state.errors++;}
          return original.call(this,type,body,...rest);
        };
      }
      if(call.startClosedCaption && !call.closedCaptionsHaveBeenStarted?.()) {
        if(!state.lastStart || Date.now()-state.lastStart>15000) {
          state.lastStart=Date.now();Promise.resolve(call.startClosedCaption()).catch(()=>{});
        }
      }
    } catch {state.errors++;}
  },1000);
}
