import {test} from 'node:test';
import assert from 'node:assert/strict';
import {browserCase,record} from './harness.js';
for(const width of [390,1280])for(const theme of ['light','dark'])test(`Highlight toolbar fixed across locales ${width} ${theme}`,{timeout:30000},t=>browserCase(t,async({page,app,dir})=>{
 app.seed('toolbar',{state:'done'},[record('工具列語言切換測試','Arthur')]);
 const data=await(await fetch(app.url+'/api/transcript?id=toolbar')).json();
 await fetch(app.url+'/api/highlights',{method:'POST',headers:{Origin:app.url,'Content-Type':'application/json'},body:JSON.stringify({id:'toolbar',action:'mark',key:data.records[0].highlightKey})});
 await page.addInitScript(theme=>localStorage.setItem('duck-meeting:theme',theme),theme);
 await page.goto(app.url+'/?id=toolbar&primary=all&secondary=none');await page.getByRole('region',{name:'會議逐字稿',exact:true}).getByText('工具列語言切換測試',{exact:true}).waitFor();
 const measure=()=>page.evaluate(()=>{const el=document.getElementById('highlight-tools'),r=el.getBoundingClientRect(),list=document.getElementById('transcript');return {height:r.height,top:r.top,bottom:r.bottom,wrap:getComputedStyle(el).flexWrap,overflow:getComputedStyle(el).overflowX,documentOverflow:document.documentElement.scrollWidth>innerWidth+1};});
 const baseline=await measure();assert.equal(baseline.height,width===390?64:54);
 for(const locale of ['en','ja','ko','zh-TW']){
  await page.getByRole('combobox',{name:/介面語言|Interface language|表示言語|인터페이스 언어/}).selectOption(locale);
  const actual=await measure();assert.equal(actual.height,baseline.height);assert.equal(actual.wrap,'nowrap');assert.equal(actual.overflow,'auto');assert.equal(actual.documentOverflow,false);
   // Native labels are translated; verify the actual checkbox remains usable in every locale.
  await page.screenshot({path:dir+'/'+locale+'.png',fullPage:true});
 }
 const only=page.getByRole('checkbox',{name:'只看重點',exact:true});await only.scrollIntoViewIfNeeded();await only.check();assert.equal(await only.isChecked(),true);assert.equal((await measure()).height,baseline.height);
},{viewport:{width,height:1000}}));
