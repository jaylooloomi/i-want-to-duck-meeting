import { MicrophoneService } from './microphone.js';
import { audioDevices, selectDevices, readAudioSettings } from './audio-settings.js';
import { readStatus, writeStatus } from './status.js';

// A detached worker owns capture. No browser tab or assistant heartbeat is needed.
export async function runTeamsRecording({config,dir,id,url,status},deps={}) {
  const list=deps.list || audioDevices;
  const selected=selectDevices(await list(config),readAudioSettings(config.home),status.audioOverrides || {});
  writeStatus(dir,{deviceSelection:selected,recordingUrl:url,connection:'join-in-your-Teams-client'});
  const service=deps.service || new MicrophoneService({meetingsDir:config.meetingsDir,home:config.home,repoRoot:config.repoRoot});
  const {token}=await service.start({mode:'teams',input:selected.input.id,output:selected.output.id,meetingId:id,meetingDir:dir,managed:true});
  const session=service.current;
  if (!session) return readStatus(dir); // stopped during model startup
  const stop=()=>{if(service.current && !session.stopping)service.stop(token,'signal');};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  const timeout=setTimeout(()=>{if(service.current && !session.stopping)service.stop(token,'max_duration');},config.maxDurationMs);
  try {await session.finished;return readStatus(dir);}
  finally {clearTimeout(timeout);process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
