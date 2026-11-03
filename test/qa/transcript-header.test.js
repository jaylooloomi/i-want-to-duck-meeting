import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {browserCase,record} from './harness.js';

for(const width of [1920,1280,390])for(const theme of ['light','dark'])test(`TRANSCRIPT header reference layout ${width} ${theme}`,{timeout:20000},t=>browserCase(t,async({page,app,dir})=>{
 app.seed('header-layout',{state:'done'},[record('排列測試')]);
 await page.addInitScript(theme=>localStorage.setItem('duck-meeting:theme',theme),theme);
 await page.goto(app.url+'/?id=header-layout&primary=all&secondary=none');await page.getByText('排列測試',{exact:true}).waitFor();
 const boxes=await Promise.all([
  page.getByRole('heading',{name:'逐字稿',exact:true}),page.getByRole('searchbox',{name:'搜尋逐字稿',exact:true}),page.getByRole('group',{name:'語言快捷設定',exact:true}),page.getByRole('combobox',{name:'原文顯示',exact:true}),page.getByRole('combobox',{name:'翻譯語言',exact:true})
 ].map(locator=>locator.boundingBox()));
 const [title,search,preset,original,translation]=boxes;
 assert.ok(title.y+title.height<=search.y);
 if(width===1920){
  for(const box of [preset,original,translation])assert.ok(Math.abs(box.y+box.height-search.y-search.height)<=1,JSON.stringify(boxes));
  assert.ok(search.x+search.width<=preset.x&&preset.x+preset.width<=original.x&&original.x+original.width<=translation.x);
 }else {assert.ok(Math.abs(original.width-translation.width)<=1);assert.ok(original.y>=search.y+search.height);}
 for(const box of boxes)assert.ok(box.x>=0&&box.x+box.width<=width+1);
 await page.getByRole('searchbox',{name:'搜尋逐字稿',exact:true}).fill('排列');await page.getByText('排列測試',{exact:true}).waitFor();
 await page.screenshot({path:path.join(dir,'transcript-header.png'),fullPage:true});
},{viewport:{width,height:930}}));
