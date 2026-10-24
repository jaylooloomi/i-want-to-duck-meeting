const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\p{Z}\s]/gu,'');

/** Content matches do not authenticate a speaker or prove provenance labels. */
export function evaluateMeetingEvidence(evidence) {
  const markers=Array.isArray(evidence.markers)?evidence.markers:[];
  const validMarkers=markers.length>0 && markers.every(x=>typeof x==='string' && normalize(x));
  const match=text=>!!validMarkers && markers.every(marker=>{
    const value=normalize(marker),haystack=normalize(text);
    return /^\d+$/.test(value)?new RegExp(`(?<!\\d)${value}(?!\\d)`).test(haystack):haystack.includes(value);
  });
  const captionsMatch=match(evidence.captionText);
  const recordingMatch=match(evidence.recordingText);
  const signal=evidence.audioSeconds>0 && evidence.audioPeak>0;
  const contentMatched=captionsMatch && recordingMatch && signal;
  let level='incomplete';
  if(contentMatched) {
    if(evidence.environment==='mock') level='mock-content-matched';
    else if(evidence.captureRoute==='local-injected') level='local-content-matched';
    else if(evidence.environment==='google-live' && evidence.captureRoute==='remote-received' && evidence.joined===true)
      level='remote-content-matched';
    else level='content-matched-provenance-unconfirmed';
  }
  return {level,captionsMatch,recordingMatch,signal,
    remoteContentMatched:level==='remote-content-matched',
    humanSpeakerVerified:false,
    provenance:'environment, capture route and input type are declarations; verify them separately',
    inputType:['synthetic','human'].includes(evidence.inputType)?evidence.inputType:'unknown'};
}
