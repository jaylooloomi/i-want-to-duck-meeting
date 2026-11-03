import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {browserCase} from './harness.js';

for(const width of [1920,390])test(`BRAND version matches running package and aligns at name bottom on the right ${width}`,{timeout:15000},t=>browserCase(t,async({page,app,dir})=>{
 const expected='v'+JSON.parse(fs.readFileSync('package.json','utf8')).version;
 await page.goto(app.url);const version=page.getByText(expected,{exact:true});await version.waitFor();
 const positions=[];
 for(const theme of ['light','dark']){
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  const name=await page.getByText('Duck Meeting',{exact:true}).boundingBox(),label=await version.boundingBox();
  assert.ok(label.x>=name.x+name.width&&Math.abs(name.y+name.height-label.y-label.height)<=1&&label.x+label.width<=width);
  positions.push({name,label});await page.screenshot({path:path.join(dir,`product-version-${theme}.png`),fullPage:true});
 }
 assert.deepEqual(positions[0],positions[1]);
 assert.ok(!(await page.content()).includes('__OPENMEETING_VERSION__'));
},{viewport:{width,height:930}}));
