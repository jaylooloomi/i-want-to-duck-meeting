import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {browserCase,record} from './harness.js';

for(const width of [1440,390])test(`BANNER assets decode and themes retain geometry ${width}`,{timeout:25000},t=>browserCase(t,async({page,app,dir})=>{
 const response=await page.request.get(app.url+'/assets/banners/manifest.json');assert.equal(response.status(),200);
 const manifest=await response.json();assert.equal(manifest.variants.length,3);
 await page.goto(app.url+'/assets/banners/preview-light.html');
 const geometry=[];
 for(const theme of ['light','dark']){
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  for(const variant of manifest.variants){
   const asset=variant[theme],imageResponse=await page.request.get(app.url+asset.url);assert.equal(imageResponse.status(),200);assert.match(imageResponse.headers()['content-type'],/^image\/png/);
   const dimensions=await page.evaluate(async url=>{const img=new Image();img.src=url;await img.decode();return [img.naturalWidth,img.naturalHeight];},app.url+asset.url);assert.deepEqual(dimensions,[asset.width,asset.height]);
   const banner=page.getByRole('region',{name:variant.id,exact:true});
   assert.ok((await banner.evaluate(el=>getComputedStyle(el).getPropertyValue('--banner-image'))).includes(variant.id+'-'+theme+'.png'));
  }
  geometry.push(await page.getByRole('region').evaluateAll(elements=>elements.map(el=>({width:el.clientWidth,height:el.clientHeight,overflow:el.scrollWidth>el.clientWidth}))));
  await page.screenshot({path:path.join(dir,`banners-${theme}-${width}.png`),fullPage:true});
 }
 assert.deepEqual(geometry[0],geometry[1]);assert.ok(geometry[0].every(box=>!box.overflow&&box.height>=110));
},{viewport:{width,height:700}}));

for(const width of [1920,1280,390])test(`BANNER actual workspace preserves themes and reachable controls ${width}`,{timeout:25000},t=>browserCase(t,async({page,app,dir})=>{
 const title='產品設計週會與跨平台多語系功能驗收討論';
 app.seed('banner-workspace',{state:'done',title},[record('測試逐字稿內容。')]);
 await page.goto(app.url+'/?id=banner-workspace&secondary=none');
 const heading=page.getByRole('heading',{name:title,exact:true});await heading.waitFor();
 const geometry=[];
 for(const theme of ['light','dark']){
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  await page.evaluate(async()=>{const image=new Image();image.src='/assets/banners/wave-'+document.documentElement.dataset.theme+'.png';await image.decode();});
  assert.equal(await page.getByRole('heading',{name:title,exact:true}).evaluate(el=>getComputedStyle(el.closest('.meeting-banner'),'::before').right),width>1050?'190px':'0px','reserve a separate action zone');
  geometry.push(await page.evaluate(()=>['current-meeting-title','workspace-export','source-status','transcript','summary-panel'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})));
  assert.ok(await page.getByRole('region',{name:'目前會議',exact:true}).evaluate(el=>el.scrollWidth<=el.clientWidth+1));
  await page.getByRole('button',{name:'匯出整場資料',exact:true}).click({trial:true});
  await page.getByRole('searchbox',{name:'搜尋逐字稿',exact:true}).click({trial:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:path.join(dir,`workspace-banner-${theme}-${width}.png`),fullPage:true});
 }
 assert.deepEqual(geometry[0],geometry[1]);
},{viewport:{width,height:930}}));

for(const width of [1280,390])test(`BANNER settings switch and persist all variants ${width}`,{timeout:25000},t=>browserCase(t,async({page,app})=>{
 app.seed('banner-choice',{state:'done',title:'Banner 設定'},[record('保留原逐字稿。')]);
 await page.goto(app.url+'/?id=banner-choice&secondary=none');
 await page.getByRole('button',{name:'設定',exact:true}).click();
 const settings=page.getByRole('dialog',{name:'工作台設定'}),select=settings.getByRole('combobox',{name:'Banner 樣式',exact:true});
 for(const variant of ['orbit','ripple','wave','ripple']){
  await select.selectOption(variant);
  assert.equal(await page.getByRole('heading',{name:'Banner 設定',exact:true}).evaluate(el=>el.closest('.meeting-banner').dataset.banner),variant);
  assert.equal(await page.evaluate(()=>localStorage.getItem('duck-meeting:banner')),variant);
  await settings.getByRole('combobox',{name:'外觀風格',exact:true}).selectOption('dark');
  assert.ok((await page.getByRole('heading',{name:'Banner 設定',exact:true}).evaluate(el=>getComputedStyle(el.closest('.meeting-banner')).getPropertyValue('--banner-image'))).includes(variant+'-dark.png'));
 }
 await page.reload();await page.getByText('保留原逐字稿。',{exact:true}).waitFor();
 assert.equal(await page.getByRole('heading',{name:'Banner 設定',exact:true}).evaluate(el=>el.closest('.meeting-banner').dataset.banner),'ripple');
 await page.getByRole('button',{name:'設定',exact:true}).click();assert.equal(await select.inputValue(),'ripple');
 await settings.getByRole('combobox',{name:'外觀風格',exact:true}).selectOption('light');
 assert.ok((await page.getByRole('heading',{name:'Banner 設定',exact:true}).evaluate(el=>getComputedStyle(el.closest('.meeting-banner')).getPropertyValue('--banner-image'))).includes('ripple-light.png'));
},{viewport:{width,height:930}}));

