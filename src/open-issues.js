export const OPEN_ISSUES_HEADING=/未確認|待確認|未決|風險|open questions|unresolved|risks?/i;
export function openIssues(markdown=''){
 const lines=String(markdown).split(/\r?\n/),out=[];let capture=false,level=0;
 for(const line of lines){const heading=/^(#{1,6})\s+(.+)$/.exec(line);if(heading){if(capture&&heading[1].length<=level)capture=false;if(OPEN_ISSUES_HEADING.test(heading[2])){capture=true;level=heading[1].length;}}if(capture)out.push(line);}
 const bullets=out.filter(line=>/^\s*(?:[-*•]|\d+[.)])\s+\S/.test(line)&&!/^\s*(?:[-*•]|\d+[.)])\s+(?:未提及|無|none)\s*[。.]?$/i.test(line));
 return {markdown:out.join('\n').trim(),count:bullets.length};
}
