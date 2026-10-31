import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {browserCase,record} from './harness.js';
for(const kind of ['decision','action'])for(const width of [1920,390])test(`SOURCE ${kind} direct text locates and highlights exact source ${width}`,{timeout:20000},t=>browserCase(t,async({page,app})=>{
 const records=Array.from({length:60},(_,i)=>record(`原文第 ${i+1} 段，保持完整內容。`,'甲',new Date(Date.UTC(2026,9,31,0,0,i)).toISOString()));
 const dir=app.seed('decision-link',{state:'done'},records);fs.writeFileSync(path.join(dir,'summary.md'),kind==='decision'?'# 紀錄\n\n## 重要決議\n\n1. 桌面與手機各驗證一次。\n2. 來源尚未確認。\n':'# 紀錄\n\n## 行動項目\n\n| 事項 | 負責人 | 期限 |\n| --- | --- | --- |\n| 桌面與手機各驗證一次。 | 未指定 | 未指定 |\n| 來源尚未確認。 | 未指定 | 未指定 |\n');
 const data=await(await fetch(app.url+'/api/transcript?id=decision-link')).json(),entry=data.noteItems.items[0],source=records[39];
 const response=await fetch(app.url+'/api/summary-source',{method:'POST',headers:{Origin:app.url,'Content-Type':'application/json'},body:JSON.stringify({id:'decision-link',itemId:entry.id,revision:data.noteItems.revision,evidenceRevision:data.noteItems.evidenceRevision,recordIndex:39,recordText:source.text,recordTime:source.t0,recordSpeaker:source.speaker})});assert.equal(response.status,200);
 await page.goto(app.url+'/?id=decision-link&primary=all&secondary=none');
 const jump=page.getByRole('button',{name:'定位逐字稿：桌面與手機各驗證一次。',exact:true});await jump.waitFor();
 assert.equal(await page.getByRole('button',{name:'定位逐字稿：來源尚未確認。',exact:true}).count(),0);
 if(kind==='action'){const unlinked=page.getByRole('checkbox',{name:'完成待辦：來源尚未確認。',exact:true});assert.equal(await unlinked.isChecked(),false);await page.getByRole('region',{name:'會議記錄整理',exact:true}).getByText('來源尚未確認。',{exact:true}).click();assert.equal(await unlinked.isChecked(),false);await unlinked.check();assert.equal(await unlinked.isChecked(),true);await unlinked.uncheck();}
 await page.getByRole('searchbox',{name:'搜尋逐字稿',exact:true}).fill('不存在的搜尋');
 await jump.click();if(kind==='action')assert.equal(await page.getByRole('checkbox',{name:'完成待辦：桌面與手機各驗證一次。',exact:true}).isChecked(),false);const target=page.getByRole('region',{name:'會議逐字稿',exact:true}).getByText(source.text,{exact:true});await target.waitFor();
 await page.waitForFunction(text=>[...document.getElementsByClassName('source-located')].some(el=>el.textContent.includes(text)),source.text);
 const state=await target.evaluate(el=>{const root=document.getElementById('transcript'),a=el.getBoundingClientRect(),b=root.getBoundingClientRect();return {scroll:root.scrollTop,inView:a.top>=b.top&&a.bottom<=b.bottom,highlight:el.closest('article').classList.contains('source-located')};});assert.ok(state.scroll>0&&state.inView&&state.highlight,JSON.stringify(state));
 const widthCheck=await target.evaluate(el=>{const row=el.closest('article'),root=document.getElementById('transcript'),a=row.getBoundingClientRect(),b=root.getBoundingClientRect();return {left:a.left-b.left,right:a.right-(b.left+root.clientWidth),overflow:root.scrollWidth-root.clientWidth};});assert.ok(Math.abs(widthCheck.left)<=1&&Math.abs(widthCheck.right)<=1&&widthCheck.overflow<=1,JSON.stringify(widthCheck));
 const clipping=await page.getByRole('region',{name:'逐字稿工作區',exact:true}).evaluate(el=>({cardTop:el.getBoundingClientRect().top,clipTop:document.getElementById('workspace-grid').parentElement.getBoundingClientRect().top,outerScroll:document.getElementById('workspace-grid').parentElement.scrollTop}));assert.ok(clipping.cardTop>=clipping.clipTop-1&&clipping.outerScroll===0,JSON.stringify(clipping));
 assert.equal(await page.getByRole('dialog',{name:'決議／待辦來源',exact:true}).isVisible(),false);
 await jump.focus();await page.keyboard.press('Enter');await target.waitFor();if(kind==='action'){const check=page.getByRole('checkbox',{name:'完成待辦：桌面與手機各驗證一次。',exact:true});assert.equal(await check.isChecked(),false);await check.check();assert.equal(await check.isChecked(),true);}
},{viewport:{width,height:930}}));
