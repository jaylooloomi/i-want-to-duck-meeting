import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fixture,browserCase,record} from './harness.js';

test('VISUAL-ASSETS locally served variable fonts are complete and licensed',async t=>{
 const app=await fixture();t.after(()=>app.close());
 const arrow=await fetch(app.url+'/assets/chevron.svg');assert.equal(arrow.status,200);assert.match(arrow.headers.get('content-type'),/image\/svg\+xml/);assert.match(await arrow.text(),/<svg/);
 for(const name of ['inter','roboto']){
  const response=await fetch(app.url+'/fonts/'+name+'-variable.ttf');
  assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/font\/ttf/);
  const actual=Buffer.from(await response.arrayBuffer());
  assert.deepEqual(actual,fs.readFileSync('src/live/fonts/'+name+'-variable.ttf'));
  assert.equal(actual.readUInt32BE(0),0x00010000);
  const license=fs.readFileSync('src/live/fonts/'+(name==='inter'?'Inter':'Roboto')+'-OFL.txt','utf8');
  assert.match(license,/SIL OPEN FONT LICENSE/);
 }
});

test('VISUAL-NOTES tabular decisions, truthful source and owner identity hints',{timeout:20000},t=>browserCase(t,async({page,app})=>{
 const at='2026-10-30T01:00:00Z';
 const dir=app.seed('visual-notes',{state:'done',source:'teams',title:'驗收會議',joinedAt:at,summaryJob:{state:'ready',provider:'agent'}},[record('同意第一個決議','Emma Chen',at),record('補充說明','Leon Weber',at)]);
 fs.writeFileSync(path.join(dir,'summary.md'),'# 驗收會議\n\n## 會議摘要\n\n測試摘要。\n\n## 重要決議\n\n1. 第一個決議\n2. 第二個決議\n\n## 行動項目\n\n| 事項 | 負責人 | 期限 |\n| --- | --- | --- |\n| 驗證排版 | Emma | 未指定 |\n| 驗證播放 | Leon | 11/03 |\n');
 fs.writeFileSync(path.join(dir,'transcript-whisper.json'),JSON.stringify({segments:[{start:0,end:1,text:'同意第一個決議'}]}));
 await page.goto(app.url+'/?id=visual-notes&secondary=none');
 const notes=page.getByRole('region',{name:'會議記錄整理'});
 await notes.getByText('由 Agent 整理',{exact:true}).waitFor();
 const decisions=notes.getByRole('table').filter({has:page.getByText('第一個決議',{exact:true})});assert.deepEqual(await decisions.getByRole('columnheader').allTextContents(),['事項','來源']);assert.deepEqual(await decisions.getByRole('row').evaluateAll(rows=>rows.slice(1).map(row=>row.cells[0].textContent)),['第一個決議','第二個決議']);
 assert.equal(await notes.getByRole('cell',{name:'Emma',exact:true}).textContent(),'ECEmma');
 assert.equal(await notes.getByRole('cell',{name:'Leon',exact:true}).textContent(),'LWLeon');
 await notes.getByText('Teams 字幕 + 錄音轉錄',{exact:true}).waitFor();
 await page.getByText('2 段對話',{exact:true}).waitFor();
 assert.match(await page.getByRole('region',{name:'目前會議'}).textContent(),/2 位發言者/);
 assert.equal(await page.getByRole('combobox',{name:'音軌',exact:true}).isVisible(),false);
}));
