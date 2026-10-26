import fs from 'node:fs';
import path from 'node:path';
import {alignParagraphs, importantDifferences} from './alignment.js';

const normalize = text => text.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\p{Z}\s]/gu, '');
const numbers = text => [...new Set(text.normalize('NFKC').match(/\d+(?:[.,]\d+)*/g) || [])];

/** Wording comparison only: neither ASR is ground truth; reception times are not alignment. */
export function compareTranscripts(captions, segments, {terms = []} = {}) {
  if (!Array.isArray(terms) || terms.some(x => typeof x !== 'string' || !x.trim())) throw new Error('invalid_terms');
  if (!Array.isArray(captions) || !Array.isArray(segments)) throw new Error('invalid_transcript');
  if (captions.some(x => typeof x?.text !== 'string') || segments.some(x => typeof x?.text !== 'string'
    || !Number.isFinite(x.start) || !Number.isFinite(x.end) || x.start < 0 || x.end < x.start)) throw new Error('invalid_transcript');
  if (segments.some((x, i) => i > 0 && x.start < segments[i - 1].start)) throw new Error('invalid_transcript: recording order');
  const cc = captions.filter(x => !x.source || ['captions','teams-native'].includes(x.source));
  const ccText = cc.map(x => x.text).join('\n');
  // Preserve record boundaries: separate utterances must not fabricate an agreeing phrase.
  const ccNormalized = cc.map(x => normalize(x.text));
  const audioText = segments.map(x => x.text).join('\n');
  const ccNumbers = numbers(ccText), audioNumbers = numbers(audioText);
  const alignment = alignParagraphs(cc, segments).map(row => ({...row, importantDifferences: importantDifferences(row, terms)}));
  return {
    version: 2, kind: 'wording-review-not-verified-transcript',
    timingAligned: false, speakerAttributionVerified: false,
    alignmentMethod: 'monotonic-text-1:1-2:1-1:2-3:1-1:3', alignment,
    importantReviewCount: alignment.filter(row => row.importantDifferences.length).length,
    captions: cc, recordingSegments: segments,
    availability: {captions: !!normalize(ccText), recording: !!normalize(audioText)},
    sharedNumbers: ccNumbers.filter(x => audioNumbers.includes(x)),
    captionOnlyNumbers: ccNumbers.filter(x => !audioNumbers.includes(x)),
    recordingOnlyNumbers: audioNumbers.filter(x => !ccNumbers.includes(x)),
    review: segments.filter(x => normalize(x.text)).map(x => ({start: x.start, end: x.end, text: x.text,
      status: ccNormalized.some(c => c.includes(normalize(x.text))) ? 'wording-present-in-captions' : 'needs-review'})),
  };
}

export function renderCrosscheck(report) {
  const out = ['# 字幕與錄音交叉核對', '',
    '此為核對材料，不是已校正定稿。以文字順序做段落對齊；相似度不是正確率。未做聲學時間對齊、聲紋或發言者歸屬。',
    '保留原始檔。不同文字需由整理者依上下文及必要時回聽錄音核對，不自動採信任一來源。', '',
    `兩來源均出現的數字：${report.sharedNumbers.join('、') || '無'}`,
    `僅字幕數字：${report.captionOnlyNumbers.join('、') || '無'}`,
    `僅錄音轉錄數字：${report.recordingOnlyNumbers.join('、') || '無'}`, '',
    '## 錄音轉錄候選（秒數相對錄音起點）', ''];
  for (const row of report.review) out.push(`### ${row.start}–${row.end} 秒：${row.status === 'needs-review' ? '待核對／可能漏字或不同辨識' : '字幕也有此文字（未驗真）'}`, '', row.text, '');
  if (!report.availability.recording) out.push('沒有可核對的錄音轉錄。', '');
  out.push('## 段落對齊與重要差異', '', '數字總表僅表示整場出現，不能證明同一段相符。下方以配對段落檢查差異；錄音秒數仍為原始 ASR 段落範圍，非細句精確時間。', '');
  for (const row of report.alignment) {
    out.push(`### 對齊 ${row.id}：${row.status}（文字相似度 ${row.textSimilarity}）`, '',
      `CC：${row.captionText || '無對應段'}`, '', `錄音：${row.recordingText || '無對應段'}`, '',
      `原始錄音段：${row.recording.map(x => `${x.start}–${x.end}s / record ${x.recordId}`).join('、') || '無'}`, '',
      `需核對：${row.importantDifferences.map(x => x.type).join('、') || (row.status === 'different' ? '一般措辭差異' : '無重要規則命中（不代表無錯字）')}`, '');
  }
  out.push('## 原生字幕（接收時間，不與錄音秒數直接等同）', '');
  for (const row of report.captions) out.push(`${row.t0 || '時間未指定'} ${row.speaker || '未知發言者'}：${row.text}`, '');
  if (!report.availability.captions) out.push('沒有可核對的原生字幕。', '');
  return out.join('\n');
}

export function writeCrosscheck(dir, {allowMissingRecording=false}={}) {
  const ccFile = path.join(dir, 'transcript.jsonl');
  const audioFile = path.join(dir, 'transcript-whisper.json');
  if (!fs.existsSync(audioFile) && !allowMissingRecording) throw new Error('recording_transcript_missing: run transcribe first');
  const captions = fs.existsSync(ccFile) ? fs.readFileSync(ccFile, 'utf8').split(/\r?\n/).filter(x => x.trim()).map(x => JSON.parse(x)) : [];
  const recording = fs.existsSync(audioFile) ? JSON.parse(fs.readFileSync(audioFile, 'utf8')) : {segments:[]};
  const termsFile = path.join(dir, 'meeting-terms.json');
  const terms = fs.existsSync(termsFile) ? JSON.parse(fs.readFileSync(termsFile, 'utf8')) : [];
  const report = compareTranscripts(captions, recording.segments, {terms});
  const jsonPath = path.join(dir, 'transcript-crosscheck.json'), mdPath = path.join(dir, 'transcript-crosscheck.md');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(mdPath, renderCrosscheck(report));
  return {report, jsonPath, mdPath};
}
