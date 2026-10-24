import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sttPython } from './stt.js';

const file = (home) => path.join(home, 'audio-settings.json');
export async function audioDevices(config) {
  const result = await promisify(execFile)(sttPython(config), [path.join(config.repoRoot, 'stt/windows_audio.py'), '--list'],
    { windowsHide:true, timeout:15000, encoding:'utf8', env:{...process.env, PYTHONIOENCODING:'utf-8'} });
  return JSON.parse(result.stdout);
}
export function selectDevices(devices, saved = {}, overrides = {}) {
  const match = (entries, value) => {
    const matches=entries.filter((d) => d.name === value?.name && d.channels === value?.channels && d.sampleRate === value?.sampleRate);
    return matches.length === 1 ? matches[0] : undefined;
  };
  const input = overrides.input !== undefined ? devices.inputs.find((d) => d.id === overrides.input && !d.virtual)
    : match(devices.inputs.filter((d) => !d.virtual), saved.input) || devices.inputs.find((d) => d.id === devices.defaultInput && !d.virtual);
  const output = overrides.output !== undefined ? devices.outputs.find((d) => d.id === overrides.output)
    : match(devices.outputs, saved.output) || devices.outputs.find((d) => d.id === devices.defaultOutput);
  if (!input || !output || input.id === output.id) throw new Error('audio_device_required: 找不到可用的實體麥克風／播放端，請連接裝置或指定 --input 與 --output');
  return { input, output, selection:'saved-or-windows-default', teamsDeviceDetected:false };
}
export function readAudioSettings(home) {
  try {
    const value = JSON.parse(fs.readFileSync(file(home), 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}
export function saveAudioSettings(home, input, output) {
  fs.mkdirSync(home, {recursive:true});
  const target=file(home), temporary=`${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({input,output,confirmedAt:new Date().toISOString()},null,2)+'\n');
  fs.renameSync(temporary,target);
}
export function audioHealth(stats, seconds = 15) {
  const tracks=stats?.tracks || {};
  return Object.fromEntries(['mic','system'].map((lane)=>[lane,
    (tracks[lane]?.audioSeconds || 0) < seconds ? 'checking' : (tracks[lane]?.audioPeak || 0) === 0 ? 'no_signal' : 'signal_only']));
}

export function parseTeamsUrl(input) {
  let url; try { url=new URL(input); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  if (!((url.hostname==='teams.live.com' && /^\/meet\/\d+\/?$/.test(url.pathname))
    || (['teams.microsoft.com','teams.cloud.microsoft'].includes(url.hostname) && /^\/l\/meetup-join\//.test(url.pathname)))) return null;
  url.hash=''; return url.href;
}
