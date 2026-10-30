import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createWavHeader} from '../../src/audio/wav-writer.js';
import {browserCase,record,consoleGuard} from './harness.js';

const sentence='Theme switching keeps this transcript intact.';
function seed(app){const dir=app.seed('palette',{state:'done',title:'外觀測試'},[record(sentence,'Emma')]);fs.writeFileSync(path.join(dir,'summary.md'),'# 外觀測試\n\n## 會議摘要\n\n切換風格保留內容。\n');return dir;}
function luminance(color){const values=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return values[0]*.2126+values[1]*.7152+values[2]*.0722;}

for(const width of [1280,390])test(`THEME switching persists and synchronizes both controls ${width}`,{timeout:20000},t=>browserCase(t,async({page,app,dir})=>{
 seed(app);await page.goto(app.url+'/?id=palette&secondary=none');await page.getByText(sentence,{exact:true}).waitFor();
 const toggle=page.getByRole('button',{name:'深色模式',exact:true});assert.equal(await toggle.getAttribute('aria-pressed'),'false');
 await toggle.click();assert.equal(await toggle.getAttribute('aria-pressed'),'true');assert.equal(await page.evaluate(()=>localStorage.getItem('duck-meeting:theme')),'dark');
 const colors=await page.getByText(sentence,{exact:true}).evaluate(el=>({text:getComputedStyle(el).color,background:getComputedStyle(document.getElementById('transcript').parentElement).backgroundImage}));
 const backgrounds=colors.background.match(/rgb\([^)]+\)/g);assert.ok(backgrounds?.length>=2,colors.background);
 for(const background of backgrounds){const a=luminance(colors.text),b=luminance(background);assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,JSON.stringify(colors));}
 const header=await page.getByRole('heading',{name:'外觀測試',exact:true,level:1}).evaluate(el=>({text:getComputedStyle(el).color,background:getComputedStyle(document.getElementsByTagName('main')[0]).backgroundImage}));
 const headerBackgrounds=header.background.match(/rgb\([^)]+\)/g);assert.ok(headerBackgrounds?.length>=2,JSON.stringify(header));for(const background of headerBackgrounds){const a=luminance(header.text),b=luminance(background);assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,JSON.stringify(header));}

 const statusColor=await page.getByText('記錄已停止',{exact:true}).evaluate(el=>getComputedStyle(el).color);for(const background of headerBackgrounds){const a=luminance(statusColor),b=luminance(background);assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,statusColor);}
 await page.getByRole('button',{name:'設定',exact:false}).click();const settings=page.getByRole('dialog',{name:'工作台設定'});const select=settings.getByRole('combobox',{name:'外觀風格',exact:true});assert.equal(await select.inputValue(),'dark');const selectedColors=await settings.getByRole('button',{name:'並排檢視',exact:true}).evaluate(el=>({fg:getComputedStyle(el).color,bg:getComputedStyle(el).backgroundColor}));assert.ok((luminance(selectedColors.fg)+.05)/(luminance(selectedColors.bg)+.05)>=4.5,JSON.stringify(selectedColors));
 await select.selectOption('light');assert.equal(await toggle.getAttribute('aria-pressed'),'false');await select.selectOption('dark');await settings.getByRole('button',{name:'完成',exact:true}).click();
 await page.reload();await page.getByText(sentence,{exact:true}).waitFor();assert.equal(await toggle.getAttribute('aria-pressed'),'true');
 assert.equal(new URL(page.url()).searchParams.get('id'),'palette');
 const size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(size.scroll<=size.width+1,JSON.stringify(size));await page.screenshot({path:path.join(dir,'dark.png'),fullPage:true});
 await toggle.click();await page.screenshot({path:path.join(dir,'light.png'),fullPage:true});
},{viewport:{width,height:width===390?844:800}}));

test('THEME another tab updates preference and invalid values safely use light',{timeout:15000},t=>browserCase(t,async({page,context,app})=>{
 seed(app);await page.goto(app.url+'/?id=palette&secondary=none');await page.getByText(sentence,{exact:true}).waitFor();await page.getByRole('button',{name:'深色模式'}).click();
 const second=await context.newPage(),guard=consoleGuard(second);try{
  await second.goto(app.url+'/?id=palette&secondary=none');await second.getByText(sentence,{exact:true}).waitFor();assert.equal(await second.getByRole('button',{name:'深色模式'}).getAttribute('aria-pressed'),'true');
  await second.getByRole('button',{name:'深色模式'}).click();await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
  await second.evaluate(()=>localStorage.setItem('duck-meeting:theme','invalid'));await page.reload();await page.getByText(sentence,{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'深色模式'}).getAttribute('aria-pressed'),'false');guard.assertClean();
 }finally{await second.close();}
}));

test('THEME blocked storage still switches without runtime errors',{timeout:15000},t=>browserCase(t,async({page,app})=>{
 seed(app);await page.addInitScript(()=>{Object.defineProperty(window,'localStorage',{get(){throw new DOMException('blocked','SecurityError');}});});await page.goto(app.url+'/?id=palette&secondary=none');await page.getByText(sentence,{exact:true}).waitFor();
 await page.getByRole('button',{name:'深色模式'}).click();await page.getByText('已切換外觀；瀏覽器未允許保存偏好。',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark');
}));

test('THEME changing appearance preserves active playback and selected meeting',{timeout:15000},t=>browserCase(t,async({page,app})=>{
 const dir=seed(app),pcm=Buffer.alloc(320000);for(let i=0;i<pcm.length;i+=2)pcm.writeInt16LE(Math.round(3000*Math.sin(i*.17)),i);fs.writeFileSync(path.join(dir,'audio.wav'),Buffer.concat([createWavHeader({dataBytes:pcm.length}),pcm]));
 let navigations=0;page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations++;});
 await page.goto(app.url+'/?id=palette&secondary=none');await page.getByText(sentence,{exact:true}).waitFor();
 const audio=page.getByLabel('錄音播放引擎');await audio.evaluate(el=>el.readyState>=1?Promise.resolve():new Promise(resolve=>el.addEventListener('loadedmetadata',resolve,{once:true})));
 await page.getByRole('button',{name:'播放錄音',exact:false}).click();await page.getByRole('button',{name:'暫停錄音',exact:false}).waitFor();const initial=await audio.evaluate(el=>el.currentTime),count=navigations;
 await page.getByRole('button',{name:'深色模式',exact:true}).click();await page.getByRole('button',{name:'深色模式',exact:true}).click();
 assert.equal(await audio.evaluate(el=>el.paused),false);assert.ok(await audio.evaluate(el=>el.currentTime)>=initial);assert.equal(navigations,count);assert.equal(new URL(page.url()).searchParams.get('id'),'palette');await page.getByRole('button',{name:'暫停錄音',exact:false}).click();
}));
