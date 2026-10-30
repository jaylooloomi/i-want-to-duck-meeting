import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fixture,browserCase,record} from './harness.js';
import {createWavHeader} from '../../src/audio/wav-writer.js';

function seed(app){const dir=app.seed('emerald',{state:'done',source:'meet',title:'產品設計週會',joinedAt:'2026-10-30T01:00:00Z'},[record('Review the recording flow.','Emma','2026-10-30T01:00:02Z')]);
 fs.writeFileSync(path.join(dir,'summary.md'),'# 產品設計週會\n\n## 會議摘要\n\n保留原文。\n\n## 重要決議\n\n1. 簡化流程\n\n## 行動事項\n\n| 事項 | 負責人 | 期限 |\n| --- | --- | --- |\n| 驗證新版 | Emma | 未指定 |\n');
 const pcm=Buffer.alloc(32000*10);for(let i=0;i<pcm.length;i+=2)pcm.writeInt16LE(Math.round(3000*Math.sin(i*.17)),i);
 fs.writeFileSync(path.join(dir,'audio.wav'),Buffer.concat([createWavHeader({dataBytes:pcm.length}),pcm]));return dir;}

test('EMERALD-API exact task scope, same-origin writes, boolean state and stale revision',async t=>{
 const app=await fixture();t.after(()=>app.close());const dir=seed(app);
 const data=await (await fetch(app.url+'/api/transcript?id=emerald')).json(),task=data.workspace.actions.items[0];assert.equal(task.text,'驗證新版');
 const body={id:'emerald',key:task.key,revision:data.workspace.actions.revision,completed:true};
 const post=(input,origin=app.url)=>fetch(app.url+'/api/action-items',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(input)});
 assert.equal((await post(body,'https://invalid.example')).status,403);assert.equal((await post({...body,id:'latest'})).status,400);assert.equal((await post({...body,key:'forged'})).status,400);
 assert.equal((await post({...body,key:'a'.repeat(64)})).status,409);assert.equal((await post({...body,completed:'true'})).status,400);assert.equal((await post(body)).status,200);assert.equal((await (await fetch(app.url+'/api/transcript?id=emerald')).json()).workspace.actions.items[0].completed,true);
 fs.appendFileSync(path.join(dir,'summary.md'),'\n更新內容');assert.equal((await post(body)).status,409);
 const storage=await (await fetch(app.url+'/api/storage')).json();assert.ok(storage.usedBytes>320000);assert.ok(storage.availableBytes>=0);
});

for(const theme of ["light","dark"])for(const width of [1586,1280,390])test(`EMERALD-UI functional task/source/paragraph/player ${width} ${theme}`,{timeout:30000},t=>browserCase(t,async({page,context,app,dir})=>{
 const location=seed(app);await page.addInitScript(theme=>localStorage.setItem('duck-meeting:theme',theme),theme);await context.grantPermissions(['clipboard-read','clipboard-write']);
 await page.goto(app.url+'/?id=emerald&secondary=none');
 const task=page.getByRole('checkbox',{name:'完成待辦：驗證新版',exact:true});await task.waitFor();await task.check();await page.getByText('已完成待辦；原始會議紀錄保持不變',{exact:true}).waitFor();
 await page.reload();await task.waitFor();assert.equal(await task.isChecked(),true);assert.match(fs.readFileSync(path.join(location,'summary.md'),'utf8'),/\| 驗證新版 \| Emma \| 未指定 \|/);
 await task.uncheck();await page.getByText('已恢復為未完成',{exact:true}).waitFor();
 await page.getByRole('button',{name:'檢視逐字稿來源',exact:true}).click();const source=page.getByRole('dialog',{name:'逐字稿來源檔案'});await source.getByText(/Review the recording flow/).waitFor();
 const download=page.waitForEvent('download');await source.getByRole('button',{name:'下載逐字稿 TXT'}).click();assert.equal((await download).suggestedFilename(),'emerald-transcript.txt');await source.getByRole('button',{name:'關閉',exact:true}).click();
 await page.getByRole('button',{name:'段落操作：Review the recording flow.',exact:true}).click();const row=page.getByRole('dialog',{name:'段落操作'});await row.getByRole('button',{name:'複製原文'}).click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'Review the recording flow.');
 await row.getByRole('button',{name:'回聽這段錄音',exact:true}).click();const audio=page.getByLabel('錄音播放引擎');await audio.evaluate(el=>el.readyState>=1?Promise.resolve():new Promise(resolve=>el.addEventListener('loadedmetadata',resolve,{once:true})));assert.ok(Math.abs(await audio.evaluate(el=>el.currentTime)-2)<.2);
 await page.getByRole('button',{name:'回聽來源錄音',exact:true}).click();assert.ok(Math.abs(await audio.evaluate(el=>el.currentTime))<.2);
 await page.getByRole('button',{name:'段落操作：Review the recording flow.',exact:true}).click();await row.getByRole('button',{name:'標記重點',exact:true}).click();await page.getByRole('button',{name:'取消整段重點：Review the recording flow.',exact:true}).waitFor();
 await page.getByRole('button',{name:'放大錄音播放器'}).click();await page.getByRole('button',{name:'還原錄音播放器'}).waitFor();await page.getByRole('button',{name:'還原錄音播放器'}).click();await page.getByRole('button',{name:'放大錄音播放器'}).click();await page.keyboard.press('Escape');await page.getByRole('button',{name:'放大錄音播放器'}).waitFor();
 await page.keyboard.press('Control+k');assert.equal(await page.getByRole('searchbox',{name:'搜尋會議'}).evaluate(el=>el===document.activeElement),true);
 await page.getByRole('heading',{name:'產品設計週會',exact:true,level:1}).click();await page.keyboard.press('Control+f');assert.equal(await page.getByRole('searchbox',{name:'搜尋逐字稿',exact:true}).evaluate(el=>el===document.activeElement),true);
 assert.match(await page.getByText(/可用 .*B/).textContent(),/可用/);const size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(size.scroll<=size.width+1,JSON.stringify(size));
 await page.screenshot({path:path.join(dir,'emerald.png'),fullPage:true});
},{viewport:{width,height:width===390?844:992}}));
