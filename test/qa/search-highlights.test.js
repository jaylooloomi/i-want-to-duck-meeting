import {test} from 'node:test';
import assert from 'node:assert/strict';
import {browserCase,record} from './harness.js';
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
