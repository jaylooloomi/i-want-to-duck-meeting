import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {readStatus,writeStatus} from './status.js';
import {runTranscribe,sttAvailable} from './stt.js';
import {writeMinutes} from './transcript/minutes.js';
import {createMinutesDraft,renderMinutes} from './transcript/minutes.js';
import {writeCrosscheck} from './transcript/crosscheck.js';
import {findChrome} from './chrome.js';

const escape = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function writePanelResults(dir) {
  const status=readStatus(dir) || {};
  const files=['meeting-report.md','meeting-report.auto.md','meeting-report.draft.md','transcript-crosscheck.md','transcript-whisper.md','transcript.md','audio.wav'];
  const links=files.filter(file=>fs.existsSync(path.join(dir,file))).map(file=>`<li><a href="${escape(pathToFileURL(path.join(dir,file)).href)}">${escape(file)}</a></li>`).join('');
  const text=file=>{try{return fs.readFileSync(path.join(dir,file),'utf8').slice(0,500000);}catch{return '尚未產生';}};
  const report=fs.existsSync(path.join(dir,'meeting-report.md'))?'meeting-report.md':fs.existsSync(path.join(dir,'meeting-report.auto.md'))?'meeting-report.auto.md':'meeting-report.draft.md';
  const refresh=status.panelReport?.state==='processing'?'<meta http-equiv="refresh" content="2">':'';
  const audio=fs.existsSync(path.join(dir,'audio.wav'))?`<audio controls preload="none" src="${escape(pathToFileURL(path.join(dir,'audio.wav')).href)}"></audio>`:'';
  const html=`<!doctype html><html lang="zh-Hant"><meta charset="utf-8">${refresh}<meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; media-src file:"><title>meeting AI 記錄結果</title><style>body{font:16px/1.6 system-ui;background:#101c2e;color:#edf5ff;margin:24px auto;padding:16px;max-width:1000px}a{color:#8edbff}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#1a2c45;padding:20px;border-radius:12px}audio{max-width:100%}</style><h1>meeting AI 記錄結果</h1><p>會議已停止。以下為核對草稿／來源材料，沒有自動驗真決議。完整摘要仍需 AI 審閱。</p><p>${escape(status.panelReport?.message || '')}</p><ul>${links}</ul>${audio}<h2>會議紀錄</h2><pre>${escape(text(report))}</pre><h2>原生／即時逐字稿</h2><pre>${escape(text('transcript.md'))}</pre></html>`;
  const file=path.join(dir,'meeting-results.html');fs.writeFileSync(file,html);return file;
}

export async function finishPanelRecording({config,dir,log},{transcribe=runTranscribe,available=sttAvailable,openResults=true}={}) {
  let message='';
  writeStatus(dir,{panelReport:{state:'processing',message:'正在整理本機來源…'}});
  const file=writePanelResults(dir);
  if(openResults && !config.headless) {
    try {
      const child=spawn(config.chromePath || findChrome(),['--no-first-run','--no-default-browser-check',`--user-data-dir=${path.join(config.meetingsDir,'.results-profile')}`,`--app=${pathToFileURL(file).href}`],{detached:true,stdio:'ignore',windowsHide:false});
      await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
    } catch(error) {message=`結果視窗未能開啟：${error.message}。`;}
  }
  try {
    const s=readStatus(dir),wav=path.join(dir,'audio.wav');
    if(!fs.existsSync(path.join(dir,'transcript-whisper.json')) && fs.existsSync(wav) && s.stats?.audioPeak>0 && available(config)) {
      await transcribe({config,wavPath:wav,outDir:dir,offline:true,log});
    }
    const missing=!fs.existsSync(path.join(dir,'transcript-whisper.json'));
    const {mdPath}=writeMinutes(dir,undefined,{allowMissingRecording:true});
    const {report}=writeCrosscheck(dir,{allowMissingRecording:true}), content=createMinutesDraft(s);
    content.title='會議紀錄（本機自動摘錄，待 AI 審閱）';
    const source=report.recordingSegments.length?'recording':'captions';
    const records=source==='recording'?report.recordingSegments:report.captions;
    const selected=records.map((row,i)=>({text:row.text.trim(),evidence:[{source,recordId:i+1,quote:row.text}]})).filter(row=>row.text);
    content.summary=selected.slice(0,3);content.topics=selected.slice(3,11);
    // Extractive notes only: no semantic inference of decisions, owners or deadlines.
    const auto=renderMinutes(content,s,report,false).replace('空欄位代表尚未整理，不能當作沒有討論','本機僅摘錄原話，未呼叫 LLM；空欄位代表未確認，不能當作沒有討論');
    fs.writeFileSync(path.join(dir,'meeting-report.auto.json'),JSON.stringify(content,null,2)+'\n');
    fs.writeFileSync(path.join(dir,'meeting-report.auto.md'),auto);
    message=missing?'草稿已產生；缺錄音轉錄，未完成雙來源核對。需檢查音訊或準備本機模型。':'段落核對及固定格式草稿已產生；重要差異、決議與待辦仍需 AI 審閱。';
    writeStatus(dir,{panelReport:{state:missing?'partial':'draft_ready',message,path:mdPath}});
  } catch(error) {
    message=`整理失敗：${error.message}。原始錄音與字幕保留。`;
    writeStatus(dir,{panelReport:{state:'failed',message}});
  }
  writePanelResults(dir);
  return {file,status:readStatus(dir)?.panelReport};
}
