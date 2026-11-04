import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
export const SUMMARY_TEMPLATES={
 standard:{label:'通用紀錄',focus:'整理會議目的、討論重點、已確認決議與後續待辦。'},
 project:{label:'專案週會',focus:'強調本週進度、阻礙、決議與下一步；只使用本場來源，不推測前次進度。'},
 interview:{label:'客戶訪談',focus:'整理客戶需求、痛點、現有做法與回饋；客戶願望、建議與團隊承諾分開，未承諾的功能不得列為決議。'},
 technical:{label:'技術討論',focus:'整理問題、候選方案、取捨、驗證結果與採用方案；清楚區分實驗、建議及已定案內容。'}
};
const digest=value=>createHash('sha256').update(value).digest('hex');
export function readSummaryPlan(dir){
 let template='standard';try{const file=path.join(dir,'summary-plan.json'),st=fs.lstatSync(file);if(st.isSymbolicLink()||!st.isFile()||st.size>4096)throw Error('summary_plan_unsafe');const data=JSON.parse(fs.readFileSync(file,'utf8'));if(data.schemaVersion!==1||!Object.hasOwn(SUMMARY_TEMPLATES,data.template))throw Error('summary_plan_invalid');template=data.template;}catch(error){if(error.code!=='ENOENT')throw error;}
 return {template,label:SUMMARY_TEMPLATES[template].label,revision:digest(template),instructions:summaryInstructions(template)};
}
export function summaryInstructions(template){
 if(!Object.hasOwn(SUMMARY_TEMPLATES,template))throw Error('summary_plan_invalid');
 return `整理模板：${SUMMARY_TEMPLATES[template].label}。${SUMMARY_TEMPLATES[template].focus}
固定輸出：基本資訊、會議摘要、討論內容、已確認決議、後續待辦、未確認事項與風險。沒有來源的內容寫「未提及」，不可編造。
待辦必須使用Markdown表格：事項｜負責人｜期限｜來源時間｜來源原文。未指定人員或日期明寫「未指定」；日期不明確保留原話，不能猜測。每筆決議及待辦都要附逐字稿中完全一致的來源原文與ISO時間；找不到唯一來源明確留空，不製造時間。
「未確認事項與風險」列出尚未決定的問題、待驗證假設、明確提及的風險及缺少負責人／期限的待辦。區分已提及風險與資料缺漏，不把建議當決議，不把未提及當沒有風險。`;
}
export function saveSummaryPlan(dir,input,status){
 if(!input||Object.keys(input).some(key=>!['id','template','revision'].includes(key))||typeof input.template!=='string'||!Object.hasOwn(SUMMARY_TEMPLATES,input.template))throw Error('summary_plan_invalid');
 if(status?.summaryJob?.state==='generating')throw Error('summary_plan_busy');
 const lock=path.join(dir,'.summary-plan.lock');let fd;try{fd=fs.openSync(lock,'wx');}catch{throw Error('summary_plan_busy');}
 try{const current=readSummaryPlan(dir);if(input.revision!==current.revision)throw Error('summary_plan_conflict');const file=path.join(dir,'summary-plan.json'),tmp=file+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(tmp,JSON.stringify({schemaVersion:1,template:input.template})+'\n',{flag:'wx'});fs.renameSync(tmp,file);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}return readSummaryPlan(dir);}finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
