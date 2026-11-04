import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {browserCase,record} from './harness.js';

for(const width of [1920,390])for(const theme of ['light','dark'])test(`SOURCE picker wraps long records and saves the exact filtered source ${width} ${theme}`,{timeout:20000},t=>browserCase(t,async({page,app,dir})=>{
 const records=Array.from({length:200},(_,i)=>record(`原文 ${i}：`+(i===42?'目標來源 <script>安全文字</script> '+ 'LongUnbrokenWord'.repeat(120):'討論的完整原文。'.repeat(30)),'講者 '+i,new Date(Date.UTC(2026,0,1,0,0,i)).toISOString()));
 const folder=app.seed('source-picker',{state:'done'},records);fs.writeFileSync(path.join(folder,'summary.md'),'## 重要決議\n\n1. 核對這項決議。');
 await page.addInitScript(theme=>localStorage.setItem('duck-meeting:theme',theme),theme);
 await page.goto(app.url+'/?id=source-picker&primary=all&secondary=none');
 await page.getByRole('button',{name:'連結來源：核對這項決議。',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'決議／待辦來源',exact:true}),list=dialog.getByRole('listbox',{name:'可選原文段落',exact:true});
 assert.equal(await list.getByRole('option').count(),200);assert.equal(await dialog.getByRole('button',{name:'儲存來源連結',exact:true}).isDisabled(),true);
 await dialog.getByRole('searchbox',{name:'搜尋原文或發言者',exact:true}).fill('目標來源');assert.equal(await list.getByRole('option').count(),1);
 await list.getByRole('option').click();assert.equal(await list.getByRole('option').getAttribute('aria-selected'),'true');
 const bounds=await dialog.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1&&bounds.y>=0&&bounds.y+bounds.height<=930);
 assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1));assert.ok(await list.evaluate(el=>el.clientHeight<=240));
 assert.equal(await dialog.evaluate(el=>el.getElementsByTagName('script').length),0);
 await dialog.getByRole('button',{name:'儲存來源連結',exact:true}).click();await dialog.getByText('來源連結已儲存',{exact:true}).waitFor();
 const saved=await(await page.request.get(app.url+'/api/transcript?id=source-picker')).json();assert.equal(saved.noteItems.items[0].source.text,records[42].text);assert.equal(saved.noteItems.items[0].source.time,records[42].t0);
 await dialog.getByRole('searchbox',{name:'搜尋原文或發言者',exact:true}).fill('沒有此句');await dialog.getByText('沒有符合的原文',{exact:true}).waitFor();
 await page.screenshot({path:path.join(dir,'source-picker.png'),fullPage:true});
 await dialog.getByRole('button',{name:'關閉',exact:true}).click();
 await page.getByRole('button',{name:'查看原文：核對這項決議。',exact:true}).click();assert.equal(await dialog.getByRole('searchbox',{name:'搜尋原文或發言者',exact:true}).inputValue(),'');
} ,{viewport:{width,height:930}}));
