import {test} from 'node:test';
import assert from 'node:assert/strict';
import {browserCase,record} from './harness.js';
for(const width of [1920,390])for(const theme of ['light','dark'])test(`TRANSCRIPT long content remains scrollable ${width} ${theme}`,{timeout:20000},t=>browserCase(t,async({page,app})=>{
 app.seed('long-scroll',{state:'done'},Array.from({length:60},(_,i)=>record(`第 ${i+1} 段完整逐字稿，必須能捲到最後。`,'甲',new Date(Date.UTC(2026,9,31,0,0,i)).toISOString())));
 await page.addInitScript(theme=>localStorage.setItem('duck-meeting:theme',theme),theme);
 await page.goto(app.url+'/?id=long-scroll&primary=all&secondary=none');
 const panel=page.getByRole('region',{name:'會議逐字稿',exact:true});await panel.getByText('第 60 段完整逐字稿，必須能捲到最後。',{exact:true}).waitFor();
 const geometry=await panel.evaluate(el=>({height:el.clientHeight,total:el.scrollHeight,overflow:getComputedStyle(el).overflowY}));
 assert.equal(geometry.overflow,'scroll');assert.ok(geometry.total>geometry.height&&geometry.height>50);
 await panel.evaluate(el=>el.scrollTop=0);await panel.hover();await page.mouse.wheel(0,400);
 await page.waitForFunction(()=>document.getElementById('transcript').scrollTop>0);
 await panel.getByText('第 60 段完整逐字稿，必須能捲到最後。',{exact:true}).scrollIntoViewIfNeeded();
 assert.ok(await panel.evaluate(el=>el.scrollTop+el.clientHeight>=el.scrollHeight-5));
 const search=page.getByRole('searchbox',{name:'搜尋逐字稿',exact:true});assert.ok(await search.isVisible());
 const box=await panel.boundingBox();const last=await panel.getByText('第 60 段完整逐字稿，必須能捲到最後。',{exact:true}).boundingBox();assert.ok(last.y>=box.y&&last.y+last.height<=box.y+box.height+2);
},{viewport:{width,height:900}}));
import fs from 'node:fs';
import path from 'node:path';
for(const theme of ['light','dark'])test(`NOTES long summary scrolls with visible rail ${theme}`,{timeout:20000},t=>browserCase(t,async({page,app})=>{
 const folder=app.seed('long-notes',{state:'done'},[record('來源內容')]);fs.writeFileSync(path.join(folder,'summary.md'),'# 測試\n\n## 會議摘要\n\n'+Array.from({length:60},(_,i)=>`第 ${i+1} 條會議摘要內容。`).join('\n\n'));
 await page.addInitScript(theme=>localStorage.setItem('duck-meeting:theme',theme),theme);await page.goto(app.url+'/?id=long-notes&secondary=none');
 const panel=page.getByRole('region',{name:'會議記錄整理',exact:true});const last=panel.getByText('第 60 條會議摘要內容。',{exact:true});await last.waitFor();
 const values=await panel.evaluate(el=>{const body=document.getElementById('summary-body');return {height:body.clientHeight,total:body.scrollHeight,overflow:getComputedStyle(body).overflowY,color:getComputedStyle(body).scrollbarColor};});assert.equal(values.overflow,'scroll');assert.ok(values.total>values.height);assert.notEqual(values.color,'auto');
 await panel.evaluate(()=>document.getElementById('summary-body').scrollTop=0);await panel.getByText('第 1 條會議摘要內容。',{exact:true}).hover();await page.mouse.wheel(0,400);await page.waitForFunction(()=>document.getElementById('summary-body').scrollTop>0);
 await last.scrollIntoViewIfNeeded();assert.ok(await panel.evaluate(()=>{const b=document.getElementById('summary-body');return b.scrollTop+b.clientHeight>=b.scrollHeight-5;}));assert.ok(await page.getByRole('button',{name:'摘要',exact:true}).isVisible());
},{viewport:{width:1920,height:930}}));
