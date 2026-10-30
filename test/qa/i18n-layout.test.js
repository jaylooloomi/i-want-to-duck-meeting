import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {browserCase,record} from './harness.js';
import {createWavHeader} from '../../src/audio/wav-writer.js';
for(const language of ['en','ko'])for(const width of [1440,1280,390])for(const theme of ['light','dark'])test(`I18N-LAYOUT ${language} ${width} ${theme}`,{timeout:20000},t=>browserCase(t,async({page,app,dir})=>{
 const base='2026-10-30T01:00:00Z',folder=app.seed('layout',{title:'展示會議',state:'done',startedAt:base,summaryJob:{state:'ready',provider:'agent'}},[record('Original transcript remains unchanged.','Emma',base)]);
 fs.writeFileSync(path.join(folder,'summary.md'),'# 展示會議\n\n## 會議摘要\n\n這是測試資料。\n');fs.writeFileSync(path.join(folder,'audio.wav'),Buffer.concat([createWavHeader({dataBytes:32000}),Buffer.alloc(32000)]));
 await page.addInitScript(({language,theme})=>{localStorage.setItem('duck-meeting:ui-language',language);localStorage.setItem('duck-meeting:theme',theme);},{language,theme});
 await page.route('**/api/translate',route=>route.fulfill({json:{translations:route.request().postDataJSON().texts.map(()=> 'Synthetic translation')}}));
 await page.goto(app.url+'/?id=layout&secondary=zh-TW');await page.getByText('Synthetic translation',{exact:true}).waitFor();
 const names=language==='en'?['Original text','Translation','Interface language']:['원문 표시','번역 언어','인터페이스 언어'];
 const controls=names.map(name=>page.getByRole('combobox',{name,exact:true}));
 for(const select of controls){
  const metric=await select.evaluate(el=>{const context=document.createElement('canvas').getContext('2d'),style=getComputedStyle(el);context.font=style.font;return {width:el.clientWidth,text:context.measureText(el.selectedOptions[0].textContent).width,padding:parseFloat(style.paddingLeft)+parseFloat(style.paddingRight)};});assert.ok(metric.width>=metric.text+metric.padding-2,JSON.stringify({language,width,metric}));
 }
 const boxes=await Promise.all(controls.map(select=>select.boundingBox()));assert.ok(boxes[0].x+boxes[0].width<=boxes[1].x+1);
 const search=page.getByRole('searchbox',{name:language==='en'?'Search transcript':'대화록 검색',exact:true}),searchBox=await search.boundingBox();assert.ok(searchBox.y+searchBox.height<=boxes[0].y+1);
 const files=page.getByRole('region',{name:language==='en'?'Sources & review':'소스 및 검토'});
 const labels=language==='en'?['Meeting audio','Transcript']:['회의 오디오','대화록'];
 for(const label of labels){const span=files.getByText(label,{exact:true});await span.waitFor();const size=await span.evaluate(el=>({height:el.getBoundingClientRect().height,line:parseFloat(getComputedStyle(el).lineHeight)}));assert.ok(size.height<=size.line*1.2,JSON.stringify({label,size}));}
 const pageSize=await page.evaluate(()=>({content:document.documentElement.scrollWidth,width:innerWidth}));assert.ok(pageSize.content<=pageSize.width+1,JSON.stringify(pageSize));
 await page.screenshot({path:dir+'/layout.png',fullPage:true});
},{viewport:{width,height:900}}));
