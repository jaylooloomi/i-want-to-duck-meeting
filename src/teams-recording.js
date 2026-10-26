import { MicrophoneService } from './microphone.js';
import { audioDevices, selectDevices, readAudioSettings } from './audio-settings.js';
import { readStatus, writeStatus } from './status.js';
import { startTeamsBrowser } from './teams-browser.js';
import {finishPanelRecording} from './panel-finish.js';

// The worker owns audio plus a dedicated native-caption browser; no assistant heartbeat.
export async function runTeamsRecording({config,dir,id,url,status},deps={}) {
  const list=deps.list || audioDevices;
  const selected=selectDevices(await list(config),readAudioSettings(config.home),status.audioOverrides || {});
  writeStatus(dir,{deviceSelection:selected,recordingUrl:url,
    connection:status.teamsBrowserEnabled===false?'audio-only':'dedicated-teams-browser',
    teamsBrowser:{state:status.teamsBrowserEnabled===false?'disabled':'starting'},
    nativeCaptions:{state:'waiting',messages:0,revisions:0}});
  const service=deps.service || new MicrophoneService({meetingsDir:config.meetingsDir,home:config.home,repoRoot:config.repoRoot});
  const {token}=await service.start({mode:'teams',input:selected.input.id,output:selected.output.id,meetingId:id,meetingDir:dir,managed:true,nativeCaptions:true});
  const session=service.current;
  if (!session) return readStatus(dir); // stopped during model startup
  let browser;
  const controller=new AbortController();
  // Audio is independent: failure/login in the browser must not discard recordings.
  const browserTask=status.teamsBrowserEnabled===false ? Promise.resolve() : (deps.startBrowser || startTeamsBrowser)({config,url,dir,signal:controller.signal,
    onCaption:event=>session.platformCaption?.(event),
    onState:state=>{if(service.current===session && !session.stopping)writeStatus(dir,{teamsBrowser:state});},
  }).then(result=>{browser=result;}).catch(error=>{
    if(service.current===session && !session.stopping)writeStatus(dir,{teamsBrowser:{state:'unavailable',error:error.message}});
  });
  const stop=()=>{if(service.current && !session.stopping)service.stop(token,'signal');};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  const timeout=setTimeout(()=>{if(service.current && !session.stopping)service.stop(token,'max_duration');},config.maxDurationMs);
  try {await session.finished;return readStatus(dir);}
  finally {clearTimeout(timeout);process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);controller.abort();await browserTask;await browser?.close();if(readStatus(dir)?.panelFinishRequested)await finishPanelRecording({config,dir});}
}
