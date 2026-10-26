// Textual, monotonic paragraph alignment. CC timestamps describe reception, not speech.
export const normalizeText = text => text.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\p{Z}\s]/gu, '');

export function splitUnits(records, source) {
  return records.flatMap((record, recordIndex) => {
    const parts = record.text.match(/[^。！？!?\n]+[。！？!?]?/gu) || [];
    return parts.flatMap(part => {
      const chars = [...part.trim()], chunks = [];
      // Bound similarity work on long unpunctuated speech without discarding text.
      for (let i = 0; i < chars.length; i += 300) chunks.push(chars.slice(i, i + 300).join(''));
      return chunks.filter(text => normalizeText(text)).map(text => ({source, recordId: recordIndex + 1, text,
        ...(source === 'recording' ? {start: record.start, end: record.end} : {receivedAt: record.t0 || null})}));
    });
  });
}

function grams(text) {
  const chars = [...normalizeText(text)], result = new Map();
  if (chars.length === 1) result.set(chars[0], 1);
  for (let i = 1; i < chars.length; i++) {const g = chars[i - 1] + chars[i]; result.set(g, (result.get(g) || 0) + 1);}
  return result;
}
export function similarity(a, b) {
  if (normalizeText(a) === normalizeText(b)) return normalizeText(a) ? 1 : 0;
  const x = grams(a), y = grams(b); let common = 0, total = 0;
  for (const [g, n] of x) {common += Math.min(n, y.get(g) || 0); total += n;}
  for (const n of y.values()) total += n;
  return total ? 2 * common / total : 0;
}

export function alignParagraphs(captions, segments) {
  const cc = splitUnits(captions, 'captions'), audio = splitUnits(segments, 'recording');
  const width = audio.length + 1, cells = (cc.length + 1) * width;
  if (cells > 1_000_000) throw new Error('alignment_limit_exceeded: split this meeting into smaller inputs');
  const costs = new Float64Array(cells).fill(Infinity), back = new Uint8Array(cells);
  const steps = [[1,1],[2,1],[1,2],[3,1],[1,3]];
  costs[0] = 0;
  const text = (list, end, count) => list.slice(end - count, end).map(x => x.text).join(' ');
  for (let i = 0; i <= cc.length; i++) for (let j = 0; j <= audio.length; j++) {
    if (!i && !j) continue;
    const at = i * width + j;
    const offer = (cost, kind) => {if (cost < costs[at]) {costs[at] = cost; back[at] = kind;}};
    if (i) offer(costs[at - width] + 0.65, 1);
    if (j) offer(costs[at - 1] + 0.65, 2);
    for (const [step, [a, b]] of steps.entries()) if (i >= a && j >= b) {
      const score = similarity(text(cc, i, a), text(audio, j, b));
      if (score >= 0.45) offer(costs[(i - a) * width + j - b] + (1 - score) * 1.2 * Math.max(a,b) + (a + b - 2) * 0.12, step + 3);
    }
  }
  const rows = []; let i = cc.length, j = audio.length;
  while (i || j) {
    const kind = back[i * width + j], [a, b] = kind === 1 ? [1, 0] : kind === 2 ? [0, 1] : steps[kind - 3];
    const c = cc.slice(i - a, i), r = audio.slice(j - b, j);
    const captionText = c.map(x => x.text).join(' '), recordingText = r.map(x => x.text).join(' ');
    rows.push({captions: c, recording: r, captionText, recordingText,
      status: !a ? 'recording-only' : !b ? 'captions-only' : normalizeText(captionText) === normalizeText(recordingText) ? 'wording-agrees' : 'different',
      textSimilarity: a && b ? Math.round(similarity(captionText, recordingText) * 1000) / 1000 : 0});
    i -= a; j -= b;
  }
  return rows.reverse().map((row, index) => ({id: index + 1, ...row}));
}

const tokens = (text, regex) => [...new Set(text.normalize('NFKC').match(regex) || [])].sort();
export function importantDifferences(row, terms = []) {
  if (row.status === 'wording-agrees') return [];
  const flags = [], a = row.captionText, b = row.recordingText;
  const check = (type, regex) => {
    const cc = tokens(a, regex), audio = tokens(b, regex);
    if (JSON.stringify(cc) !== JSON.stringify(audio)) flags.push({type, captions: cc, recording: audio});
  };
  check('numbers', /\d+(?:[.,]\d+)*/g);
  check('negation', /不|沒|未|無|勿|別|取消|拒絕|同意/g);
  check('date-deadline', /(?:\d{1,4}[年/月日號:]|(?:週|星期)[一二三四五六日天]|今天|明天|後天|下週|下周|月底|截止)/g);
  check('name-or-term', /[A-Za-z][A-Za-z0-9_-]*/g);
  for (const term of terms) if (a.includes(term) !== b.includes(term)) flags.push({type: 'glossary', term});
  if (/負責|完成|交付|決定|通過|同意|承諾|上線/.test(a + b)) flags.push({type:'decision-or-owner', note:'措辭不同，需核對決議／責任；不自動抽取姓名'});
  if (!a || !b) flags.push({type:'source-missing'});
  return flags;
}
