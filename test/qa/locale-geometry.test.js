import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
import {browserCase,record} from './harness.js';
for(const width of [390,900,1280,1920])for(const theme of ['light','dark'])test(`LOCALE-GEOMETRY Chinese baseline ${width} ${theme}`,{timeout:30000},t=>browserCase(t,async({page,app,dir})=>{
 const folder=app.seed('geometry',{title:'跨語系測試會議',state:'done',summaryJob:{state:'ready',provider:'agent'}},[record('Original source stays unchanged.','Arthur')]);fs.writeFileSync(path.join(folder,'summary.md'),'# 測試資料\n\n## 會議摘要\n\n固定來源內容。\n');
 await page.addInitScript(theme=>localStorage.setItem('duck-meeting:theme',theme),theme);
 await page.goto(app.url+'/?id=geometry&primary=all&secondary=none');await page.getByText('固定來源內容。',{exact:true}).waitFor();await page.evaluate(()=>document.fonts.ready);
 const measure=()=>page.evaluate(()=>Object.fromEntries(['.sidebar','.workspace-grid','.pane-transcript','.summary-header','.pane-transcript>.pane-header','.notes-tabs','.source-status','#primary-lang','#secondary-lang','#new-record','#ui-language','.sidebar-footer','.sidebar-filter'].map(selector=>{const el=selector.startsWith('#')?document.getElementById(selector.slice(1)):selector==='.pane-transcript>.pane-header'?document.getElementsByClassName('pane-transcript')[0].getElementsByClassName('pane-header')[0]:document.getElementsByClassName(selector.slice(1))[0],box=el.getBoundingClientRect();return [selector,{width:box.width,height:box.height}];})));
 const storage=()=>page.evaluate(()=>{const root=document.getElementsByClassName('local-storage')[0],elements=[root,root.getElementsByClassName('storage-icon')[0],root.getElementsByTagName('strong')[0],document.getElementById('storage-detail'),document.getElementById('storage-meter')];return elements.map(el=>{const r=el.getBoundingClientRect();return [r.x+scrollX,r.y+scrollY,r.width,r.height];});});
 const storageBaseline=await storage();const baseline=await measure();
 for(const locale of ['en','ja','ko','zh-TW']){
  await page.getByRole('combobox',{name:/介面語言|Interface language|表示言語|인터페이스 언어/}).selectOption(locale);
  assert.deepEqual(await storage(),storageBaseline,'Storage icon/title/detail/meter must not move when changing locale');const actual=await measure();for(const [key,rect] of Object.entries(baseline)){assert.ok(Math.abs(actual[key].width-rect.width)<1,JSON.stringify({locale,key,baseline:rect,actual:actual[key]}));if(!['.pane-transcript','.workspace-grid'].includes(key))assert.ok(Math.abs(actual[key].height-rect.height)<1,JSON.stringify({locale,key,baseline:rect,actual:actual[key]}));}
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:dir+'/'+locale+'.png',fullPage:true});
 }
},{viewport:{width,height:1000}}));
