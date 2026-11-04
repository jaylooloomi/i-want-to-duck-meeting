import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {browserCase,fixture,record,defer} from './harness.js';
import {readMeetingPreferences,DEFAULT_PREFERENCES,saveMeetingPreferences} from '../../src/meeting-preferences.js';

test('PREF API shares data home and rejects CSRF, invalid schema and stale revision',async t=>{
 const app=await fixture();t.after(()=>app.close());const get=()=>fetch(app.url+'/api/meeting-preferences');const put=(input,origin=app.url)=>fetch(app.url+'/api/meeting-preferences',{method:'PUT',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(input)});
 assert.deepEqual((await(await get()).json()).preferences,DEFAULT_PREFERENCES);
 const input={...DEFAULT_PREFERENCES,spokenLanguage:'de',translationLanguage:'zh-TW',expectedRevision:null};
 assert.equal((await put(input,'https://evil.example')).status,403);assert.equal((await put({...input,path:'../outside'})).status,400);assert.equal((await put(input)).status,200);assert.equal((await put(input)).status,409);
 assert.equal(readMeetingPreferences(app.home).preferences.spokenLanguage,'de');assert.equal(fs.existsSync(path.join(app.root,'meeting-preferences.json')),false);
});
for(const width of [390,1280])for(const theme of ['light','dark'])test(`PREF settings default German persists without changing current meeting ${width} ${theme}`,{timeout:25000},t=>browserCase(t,async({page,app,dir})=>{
 const snapshot={spokenLanguage:'en',captionLanguage:'en-US',originalDisplay:'en',translationLanguage:'none'};const folder=app.seed('preferences',{state:'in_call',languagePreferences:snapshot},[record('Original meeting source')]);
 await page.addInitScript(theme=>localStorage.setItem('duck-meeting:theme',theme),theme);await page.goto(app.url+'/?id=preferences&primary=en&secondary=none');await page.getByText('Original meeting source',{exact:true}).waitFor();
 await page.getByRole('button',{name:'設定',exact:true}).click();const dialog=page.getByRole('dialog',{name:'工作台設定',exact:true}),spoken=dialog.getByRole('combobox',{name:'會議辨識語言',exact:true}),original=dialog.getByRole('combobox',{name:'原文顯示',exact:true}),target=dialog.getByRole('combobox',{name:'翻譯語言',exact:true});
 await spoken.selectOption('de');await original.selectOption('follow-meeting');await target.selectOption('zh-TW');await dialog.getByText('Agent 將讀取的開會預設：德文 → 德文 → 繁體中文',{exact:true}).waitFor();
 const gate=defer();let writes=0;await page.route('**/api/meeting-preferences',async route=>{if(route.request().method()==='PUT'){writes++;await gate.promise;}await route.continue();});
 const done=dialog.getByRole('button',{name:'完成',exact:true});await done.click();assert.equal(await done.isEnabled(),false);assert.equal(await dialog.isVisible(),true);gate.resolve();await dialog.waitFor({state:'hidden'});assert.equal(writes,1);
 assert.equal(readMeetingPreferences(app.home).preferences.spokenLanguage,'de');assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder,'status.json'),'utf8')).languagePreferences,snapshot);
 assert.equal(await page.getByRole('combobox',{name:'原文顯示',exact:true}).inputValue(),'en');
 await page.reload();await page.getByRole('button',{name:'設定',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('default-spoken').disabled);assert.equal(await spoken.inputValue(),'de');assert.equal(await target.inputValue(),'zh-TW');
 const bounds=await dialog.boundingBox();assert.ok(bounds.width<=width&&bounds.x>=0);assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);await page.screenshot({path:dir+'/settings.png',fullPage:true});
} ,{viewport:{width,height:1000}}));

test('PREF save failure preserves choices and a later retry succeeds',{timeout:20000},t=>browserCase(t,async({page,app})=>{
 app.seed('prefs-retry',{state:'done'},[record('Fixture source')]);await page.goto(app.url+'/?id=prefs-retry&secondary=none');await page.getByRole('button',{name:'設定',exact:true}).click();const dialog=page.getByRole('dialog',{name:'工作台設定',exact:true}),spoken=dialog.getByRole('combobox',{name:'會議辨識語言',exact:true});await spoken.selectOption('ja');
 let fail=true;await page.route('**/api/meeting-preferences',async route=>{if(fail&&route.request().method()==='PUT'){fail=false;await route.fulfill({json:{error:'fixture_save_failed'}});}else await route.continue();});
 await dialog.getByRole('button',{name:'完成',exact:true}).click();await dialog.getByText('儲存失敗，選擇已保留，請重試。',{exact:true}).waitFor();assert.equal(await spoken.inputValue(),'ja');assert.equal(readMeetingPreferences(app.home).revision,null);
 await dialog.getByRole('button',{name:'完成',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.equal(readMeetingPreferences(app.home).preferences.spokenLanguage,'ja');
}));


test('PREF meeting snapshot initializes reading languages and explicit URL overrides it',{timeout:25000},t=>browserCase(t,async({page,app})=>{
 app.seed('prefs-snapshot',{state:'done',languagePreferences:{spokenLanguage:'de',captionLanguage:'de-DE',originalDisplay:'de',translationLanguage:'none'}},[{...record('Guten Tag'),language:'de'}]);
 await page.goto(app.url+'/?id=prefs-snapshot');await page.getByText('Guten Tag',{exact:true}).waitFor();
 assert.equal(await page.getByRole('combobox',{name:'原文顯示',exact:true}).inputValue(),'de');assert.equal(await page.getByRole('combobox',{name:'翻譯語言',exact:true}).inputValue(),'none');
 await page.goto(app.url+'/?id=prefs-snapshot&primary=all&secondary=none');await page.getByText('Guten Tag',{exact:true}).waitFor();assert.equal(await page.getByRole('combobox',{name:'原文顯示',exact:true}).inputValue(),'all');
}));
