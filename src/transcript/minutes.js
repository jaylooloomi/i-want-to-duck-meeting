import fs from 'node:fs';
import path from 'node:path';
import {writeCrosscheck} from './crosscheck.js';

const fields = ['version','meetingId','title','participants','summary','topics','decisions','proposals','actionItems','risks','openQuestions','nextFollowUp'];
const fail = message => {throw new Error(`invalid_minutes: ${message}`);};
const exactKeys = (o, keys) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).sort().join('|') === [...keys].sort().join('|');
const text = value => typeof value === 'string' && !!value.trim();

export function createMinutesDraft(status) {
  return {version:1,meetingId:status.id,title:'會議紀錄（待審閱）',participants:[],
    summary:[],topics:[],decisions:[],proposals:[],actionItems:[],risks:[],openQuestions:[],nextFollowUp:[]};
}

/** Validates provenance/shape, not whether a quotation logically entails a conclusion. */
export function validateMinutes(doc, crosscheck, meetingId) {
  if (!exactKeys(doc, fields) || doc.version !== 1 || !text(doc.meetingId) || doc.meetingId !== meetingId || !text(doc.title)) fail('header');
  const evidence = refs => {
    if (!Array.isArray(refs) || !refs.length) fail('evidence required');
    for (const ref of refs) {
      if (!exactKeys(ref, ['source','recordId','quote']) || !['captions','recording'].includes(ref.source)
        || !Number.isInteger(ref.recordId) || ref.recordId < 1 || !text(ref.quote)) fail('evidence shape');
      const records = ref.source === 'captions' ? crosscheck.captions : crosscheck.recordingSegments;
      if (!records[ref.recordId - 1]?.text.includes(ref.quote)) fail('quote not in source record');
    }
  };
  if (!Array.isArray(doc.participants)) fail('participants');
  for (const person of doc.participants) {
    if (!exactKeys(person,['name','role','evidence']) || !text(person.name) || !(person.role === null || text(person.role))) fail('participant shape');
    evidence(person.evidence);
    // Recording ASR has no identity information. Caption metadata can establish displayed names.
    if (!person.evidence.some(ref => ref.source === 'captions' && crosscheck.captions[ref.recordId - 1]?.speaker === person.name)) fail('participant identity unsupported');
  }
  for (const key of ['summary','topics','decisions','proposals','risks','openQuestions','nextFollowUp']) {
    if (!Array.isArray(doc[key])) fail(key);
    for (const claim of doc[key]) {
      if (!exactKeys(claim,['text','evidence']) || !text(claim.text)) fail(`${key} claim`);
      evidence(claim.evidence);
    }
  }
  if (!Array.isArray(doc.actionItems)) fail('actionItems');
  for (const task of doc.actionItems) {
    if (!exactKeys(task,['task','owner','deadline','completionCriteria','evidence']) || !text(task.task)
      || !['owner','deadline','completionCriteria'].every(key => task[key] === null || text(task[key]))) fail('task shape');
    evidence(task.evidence);
  }
  return doc;
}

export function renderMinutes(doc, status, crosscheck, reviewed) {
  const refs = evidence => evidence.map(ref => {
    const row = (ref.source === 'captions' ? crosscheck.captions : crosscheck.recordingSegments)[ref.recordId - 1];
    const time = ref.source === 'recording' ? `${row.start}–${row.end}s` : `${row.t0 || '未指定'}（接收時間）`;
    return `${ref.source} #${ref.recordId} ${time}「${ref.quote}」`;
  }).join('；');
  const out = [`# ${doc.title}`, '', `狀態：${reviewed ? '審閱輸入已通過結構與引文驗證；未保證語意正確或逐字聽辨' : '待審閱草稿；空欄位代表尚未整理，不能當作沒有討論'}`, '',
    '## 會議基本資料', '', `- ID：${doc.meetingId}`, '- 時間以 ISO 8601 保存（Z 為 UTC）；不採執行主機的隱含時區。',
    `- 入會：${status.joinedAt || '未指定'}`, `- 結束：${status.endedAt || '未指定'}`, `- 錄音秒數：${status.stats?.audioSeconds ?? '未指定'}`, '',
    '## 參與者', ''];
  for (const person of doc.participants) out.push(`- ${person.name}；角色：${person.role || '未指定'}。${refs(person.evidence)}`);
  if (!doc.participants.length) out.push(reviewed ? '未確認' : '待審閱');
  for (const [key, label] of [['summary','重點摘要'],['topics','各議題討論'],['decisions','已確認決議'],['proposals','提案與未決事項']]) {
    out.push('',`## ${label}`,'');
    if (!doc[key].length) out.push(reviewed ? '無已記錄項目' : '待審閱');
    for (const claim of doc[key]) out.push(`- ${claim.text}\n  - 來源：${refs(claim.evidence)}`);
  }
  out.push('', '## 待辦事項', '');
  for (const task of doc.actionItems) out.push(`- ${task.task}\n  - 負責人：${task.owner || '未指定'}；期限：${task.deadline || '未指定'}；完成條件：${task.completionCriteria || '未指定'}\n  - 來源：${refs(task.evidence)}`);
  if (!doc.actionItems.length) out.push(reviewed ? '無已確認待辦' : '待審閱');
  for (const [key,label] of [['risks','風險與阻礙'],['openQuestions','待確認問題'],['nextFollowUp','下次追蹤']]) {
    out.push('',`## ${label}`,'');
    if (!doc[key].length) out.push(reviewed ? '無已記錄項目' : '待審閱');
    for (const claim of doc[key]) out.push(`- ${claim.text}\n  - 來源：${refs(claim.evidence)}`);
  }
  out.push('', '## 記錄品質與附件', '',
    `- 原生字幕：${crosscheck.captions.length} 段；錄音轉錄：${crosscheck.recordingSegments.length} 段。`,
    `- 重要差異規則命中：${crosscheck.importantReviewCount} 個對齊區塊，未因產生本報告自動解除。`,
    '- 段落依文字順序估計配對，非聲學時間對齊；相似度不是正確率，不證明說話者身分。',
    '- 即使引文存在，也需審閱者確認是否真的支持決議、負責人及期限；沒有欄位時不猜。',
    '- [原生字幕](transcript.md) · [錄音轉錄](transcript-whisper.md) · [差異核對](transcript-crosscheck.md) · [錄音](audio.wav)', '');
  return out.join('\n');
}

export function writeMinutes(dir, reviewedInput, {allowMissingRecording=false}={}) {
  const status = JSON.parse(fs.readFileSync(path.join(dir,'status.json'),'utf8'));
  if (!['done','failed'].includes(status.state)) throw new Error('meeting_not_finished');
  const {report} = writeCrosscheck(dir,{allowMissingRecording});
  const doc = reviewedInput ? validateMinutes(reviewedInput,report,status.id) : createMinutesDraft(status);
  const base = reviewedInput ? 'meeting-report' : 'meeting-report.draft';
  const jsonPath = path.join(dir, base + '.json'), mdPath = path.join(dir,base + '.md');
  fs.writeFileSync(jsonPath,JSON.stringify(doc,null,2)+'\n');
  fs.writeFileSync(mdPath,renderMinutes(doc,status,report,!!reviewedInput));
  return {jsonPath,mdPath,doc};
}
