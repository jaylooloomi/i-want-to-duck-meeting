import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {browserCase,record,defer} from './harness.js';
for(const theme of ['light','dark'])test(`SEARCH keyword marks preserve literal text ${theme}`,{timeout:20000},t=>browserCase(t,async({page,app})=>{
 app.seed('search-marks',{state:'done'},[record('標籤需要標籤。Teams TEAMS [a+b] <script>安全</script>','標籤講者'),record('另一段內容','乙')]);
 await page.addInitScript(theme=>localStorage.setItem('duck-meeting:theme',theme),theme);
 await page.goto(app.url+'/?id=search-marks&primary=all&secondary=none');
 const search=page.getByRole('searchbox',{name:'搜尋逐字稿',exact:true});
 const transcript=page.getByRole('region',{name:'會議逐字稿',exact:true});
 for(const [query,count,expected] of [['標籤',3,'標籤'],['teams',2,'Teams'],['[a+b]',1,'[a+b]'],['<script>',1,'<script>']]){
  await search.fill(query);
  await page.waitForFunction(({count,expected})=>{const root=document.getElementById('transcript');const marks=root?.getElementsByTagName('mark');return marks?.length===count&&marks[0].textContent===expected;},{count,expected});
  assert.equal(await transcript.evaluate(el=>el.getElementsByTagName('script').length),0);
 }
 await search.fill('');await page.waitForFunction(()=>document.getElementById('transcript')?.getElementsByTagName('mark').length===0);
 await transcript.getByText('另一段內容',{exact:true}).waitFor();
}));

for(const pending of [false,true])test(`SEARCH translated text arrives while search is active pending=${pending}`,{timeout:25000},t=>browserCase(t,async({page,app})=>{
 const rows=[record('需要核對中文原文','甲'),record('不相關段落','乙')];
 const folder=app.seed('translated-search',{state:pending?'in_call':'done'},pending?[]:rows);
 if(pending)fs.writeFileSync(path.join(folder,'live.json'),JSON.stringify({pending:rows}));
 const gate=defer(),requested=defer();
 await page.route('**/api/translate',async route=>{requested.resolve();await gate.promise;await route.fulfill({json:{translations:route.request().postDataJSON().texts.map(text=>text===rows[0].text?'Verify SPEAKER [a+b] <script> safely.':'Unrelated sentence.')}});});
 await page.goto(app.url+'/?id=translated-search&primary=all&secondary=en');await requested.promise;
 const search=page.getByRole('searchbox',{name:'搜尋逐字稿',exact:true}),transcript=page.getByRole('region',{name:'會議逐字稿',exact:true});
 await search.fill('speaker');await page.getByText('找不到符合的逐字稿',{exact:true}).waitFor();gate.resolve();
 for(const [query,expected] of [['speaker','SPEAKER'],['[a+b]','[a+b]'],['<script>','<script>']]){
  await search.fill(query);await page.waitForFunction(expected=>{const root=document.getElementById('transcript');return [...root.getElementsByTagName('mark')].some(mark=>mark.textContent===expected);},expected);
  await transcript.getByText(rows[0].text,{exact:true}).waitFor();assert.equal(await transcript.getByText(rows[1].text,{exact:true}).count(),0);assert.equal(await transcript.evaluate(el=>el.getElementsByTagName('script').length),0);
 }
 await page.getByRole('combobox',{name:'翻譯語言',exact:true}).selectOption('none');await page.getByText('找不到符合的逐字稿',{exact:true}).waitFor();
 await search.fill('');await transcript.getByText(rows[1].text,{exact:true}).waitFor();
}));
