const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\p{Z}\s]/gu,'');

/** Content matches do not authenticate a speaker or prove provenance labels. */
export function evaluateMeetingEvidence(evidence) {
  const markers=Array.isArray(evidence.markers)?evidence.markers:[];
  const validMarkers=markers.length>0 && markers.every(x=>typeof x==='string' && normalize(x));
  const match=(marker,text)=>{
    const value=normalize(marker),haystack=normalize(text);
    const pattern=value.split(/(\d+)/).map(part=>/^\d+$/.test(part)
      ? `(?<!\\d)${part}(?!\\d)` : part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('');
    return new RegExp(pattern,'u').test(haystack);
  };
  const markerResults=validMarkers?markers.map(marker=>({marker,
    captionsMatch:match(marker,evidence.captionText),recordingMatch:match(marker,evidence.recordingText)})):[];
  const captionsMatch=!!validMarkers && markerResults.every(x=>x.captionsMatch);
  const recordingMatch=!!validMarkers && markerResults.every(x=>x.recordingMatch);
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
  return {level,captionsMatch,recordingMatch,signal,markerResults,
    observedText:{captions:String(evidence.captionText || ''),recording:String(evidence.recordingText || '')},
    remoteContentMatched:level==='remote-content-matched',
    humanSpeakerVerified:false,
    provenance:'environment, capture route and input type are declarations; verify them separately',
    inputType:['synthetic','human'].includes(evidence.inputType)?evidence.inputType:'unknown'};
}
