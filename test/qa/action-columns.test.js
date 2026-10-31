import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {browserCase,record} from './harness.js';
for(const width of [1920,1280,390])for(const theme of ['light','dark'])test(`ACTION columns remain stable across contents ${width} ${theme}`,{timeout:20000},t=>browserCase(t,async({page,app})=>{
 const seed=(id,long)=>{const folder=app.seed(id,{state:'done',title:id},[record('測試原文')]);fs.writeFileSync(path.join(folder,'summary.md'),'## 行動項目\n\n| 事項 | 負責人 | 期限 |\n| --- | --- | --- |\n| '+(long?'檢查桌面手機與多語系的完整流程，這是一段很長的事項內容。':'檢查介面')+' | '+(long?'非常長的負責人名稱測試':'王小明')+' | '+(long?'未指定':'2026/11/03')+' |\n| 另一項工作 | 林先生 | 2026/11/04 |');};seed('short-table',false);seed('long-table',true);
 await page.addInitScript(theme=>localStorage.setItem('duck-meeting:theme',theme),theme);
 const widths=[];
 for(const id of ['short-table','long-table']){await page.goto(app.url+'/?id='+id+'&secondary=none');const table=page.getByRole('table').filter({has:page.getByRole('columnheader',{name:'事項',exact:true})});await table.waitFor();const columns=await table.getByRole('columnheader').evaluateAll(elements=>elements.map(e=>({x:e.getBoundingClientRect().x,width:e.getBoundingClientRect().width})));assert.equal(columns.length,4);assert.ok(await table.getByRole('cell').evaluateAll(cells=>cells.every(cell=>getComputedStyle(cell).verticalAlign==='middle')),'all fields vertically centered');widths.push(columns);assert.ok(columns[0].width>columns[1].width);const overflow=await table.evaluate(el=>el.scrollWidth-el.clientWidth);assert.ok(overflow<=2,`overflow ${overflow}`);await page.getByRole('button',{name:'待辦',exact:true}).click();const tabColumns=await table.getByRole('columnheader').evaluateAll(elements=>elements.map(e=>e.getBoundingClientRect().width));assert.ok(columns.every((col,i)=>Math.abs(col.width-tabColumns[i])<1));}
 assert.ok(widths[0].every((col,i)=>Math.abs(col.width-widths[1][i].width)<1&&Math.abs(col.x-widths[1][i].x)<1),JSON.stringify(widths));
},{viewport:{width,height:930}}));

for(const format of ['list','table'])for(const width of [1920,390])test(`DECISION table aligns source column with actions ${format} ${width}`,{timeout:20000},t=>browserCase(t,async({page,app})=>{
 const folder=app.seed('decision-table',{state:'done'},[record('原始發言')]);fs.writeFileSync(path.join(folder,'summary.md'),(format==='list'?'## 重要決議\n\n1. 保留左側清單。\n2. 核對手機版與桌面版。\n\n':'## 重要決議\n\n| 決議 | 來源原文 | 來源時間 |\n| --- | --- | --- |\n| 保留左側清單。 | 未連結 | 時間未知 |\n| 核對手機版與桌面版。 | 未連結 | 時間未知 |\n\n')+'## 行動項目\n\n| 事項 | 負責人 | 期限 |\n| --- | --- | --- |\n| 檢查介面 | 王小明 | 未指定 |');
 await page.goto(app.url+'/?id=decision-table&secondary=none');const tables=page.getByRole('region',{name:'會議記錄整理',exact:true}).getByRole('table');await tables.first().waitFor();assert.equal(await tables.count(),2);
 const decision=tables.nth(0),action=tables.nth(1);assert.deepEqual(await decision.getByRole('columnheader').allTextContents(),['事項','來源']);assert.equal(await decision.getByRole('row').count(),3);assert.ok(await decision.getByRole('cell').evaluateAll(cells=>cells.every(cell=>getComputedStyle(cell).verticalAlign==='middle')),'decision fields vertically centered');assert.equal(await decision.getByRole('button',{name:/^連結來源：/}).count(),2);
 const sourceRow=decision.getByRole('row').nth(1),button=await sourceRow.getByRole('button',{name:/^連結來源：/}).boundingBox(),cells=await sourceRow.getByRole('cell').evaluateAll(elements=>elements.map(el=>el.getBoundingClientRect().toJSON()));assert.ok(button.x>=cells[0].right-1&&button.x+button.width<=cells[1].right+1,JSON.stringify({button,cells}));
 const a=await decision.getByRole('columnheader',{name:'來源',exact:true}).boundingBox(),b=await action.getByRole('columnheader',{name:'來源',exact:true}).boundingBox();assert.ok(Math.abs(a.x-b.x)<=1&&Math.abs(a.width-b.width)<=1,JSON.stringify({a,b}));
 await page.getByRole('button',{name:'決議',exact:true}).click();const only=page.getByRole('region',{name:'會議記錄整理',exact:true}).getByRole('table');assert.equal(await only.count(),1);assert.deepEqual(await only.getByRole('columnheader').allTextContents(),['事項','來源']);
},{viewport:{width,height:930}}));

for(const width of [1920,1280,390])test(`SOURCE status and action align consistently ${width}`,{timeout:15000},t=>browserCase(t,async({page,app})=>{
 const folder=app.seed('source-layout',{state:'done'},[record('原文')]);fs.writeFileSync(path.join(folder,'summary.md'),'## 重要決議\n\n1. 確認流程。\n\n## 行動項目\n\n| 事項 | 負責人 | 期限 |\n| --- | --- | --- |\n| 短項目 | 小王 | 未指定 |\n| 較長的另一個待辦項目 | 小林 | 2026/11/04 |');
 await page.goto(app.url+'/?id=source-layout&secondary=none');const tables=page.getByRole('region',{name:'會議記錄整理',exact:true}).getByRole('table');await tables.first().waitFor();
 for(const table of await tables.all())for(const row of (await table.getByRole('row').all()).slice(1)){
  const cell=row.getByRole('cell').last();assert.equal(await cell.evaluate(el=>getComputedStyle(el).verticalAlign),'middle');assert.ok(await cell.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'source cell overflow');const button=await cell.getByRole('button',{name:/^連結來源：/}).boundingBox(),status=await cell.getByText('來源未連結',{exact:true}).boundingBox();assert.ok(button.x>=status.x+status.width+5&&Math.abs((status.y+status.height/2)-(button.y+button.height/2))<=1,JSON.stringify({status,button}));
 }
},{viewport:{width,height:930}}));

for(const width of [1920,1280,390])test(`SOURCE geometry remains identical across all three tabs ${width}`,{timeout:20000},t=>browserCase(t,async({page,app})=>{
 const time='2026-11-01T00:00:01Z',folder=app.seed('three-tabs',{state:'done',startedAt:'2026-11-01T00:00:00Z'},[record('確認原文','甲',time)]);fs.writeFileSync(path.join(folder,'summary.md'),'## 會議摘要\n\n摘要。\n\n## 重要決議\n\n| 決議 | 來源原文 | 來源時間 |\n| --- | --- | --- |\n| 已確認決議 | 確認原文 | '+time+' |\n| 尚待核對 | 未連結 | 時間未知 |\n\n## 行動項目\n\n| 事項 | 負責人 | 期限 | 來源原文 | 來源時間 |\n| --- | --- | --- | --- | --- |\n| 已確認工作 | 小王 | 未指定 | 確認原文 | '+time+' |\n| 另一工作 | 小林 | 2026/11/04 | 未連結 | 時間未知 |');
 await page.goto(app.url+'/?id=three-tabs&secondary=none');const all=[];
 for(const tab of ['摘要','決議','待辦']){await page.getByRole('button',{name:tab,exact:true}).click();const tables=page.getByRole('region',{name:'會議記錄整理',exact:true}).getByRole('table');for(const table of await tables.all()){
  const header=await table.getByRole('columnheader',{name:'來源',exact:true}).boundingBox();for(const row of (await table.getByRole('row').all()).slice(1)){
   const cell=row.getByRole('cell').last(),button=await cell.getByRole('button',{name:/^(查看原文|連結來源)：/}).boundingBox(),status=await cell.getByText(/^來源(?:未連結| \d)/).boundingBox();all.push({x:header.x,width:header.width,statusX:status.x,buttonX:button.x,gap:button.x-status.x-status.width,centerDelta:button.y+button.height/2-status.y-status.height/2});
  }
 }}
 assert.equal(all.length,8);for(const item of all){assert.ok(Math.abs(item.x-all[0].x)<=1&&Math.abs(item.width-all[0].width)<=1&&Math.abs(item.statusX-all[0].statusX)<=1&&Math.abs(item.buttonX-all[0].buttonX)<=1&&item.gap>=5&&Math.abs(item.centerDelta)<=1,JSON.stringify(all));}
},{viewport:{width,height:930}}));
