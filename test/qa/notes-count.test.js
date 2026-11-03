import {test} from 'node:test';
import assert from 'node:assert/strict';
import {browserCase,record} from './harness.js';

test('NOTES counts hide unfinished/stale data and restore only for ready finished notes',{timeout:20000},t=>browserCase(t,async({page,app})=>{
 app.seed('count-state',{state:'done'},[record('測試資料')]);
 let state='done',summaryState='ready',count=12;
 await page.route('**/api/transcript?*',async route=>{
  const response=await route.fetch(),data=await response.json();
  data.status.state=state;data.summary={state:summaryState,markdown:summaryState==='ready'?'## 重要決議\n\n1. 確認流程。\n\n## 行動項目\n\n| 事項 | 負責人 | 期限 |\n| --- | --- | --- |\n| 核對 | 未指定 | 未指定 |':null};
  data.workspace.actions={revision:'fixture',items:Array.from({length:count},(_,i)=>({text:'task '+i}))};
  await route.fulfill({json:data});
 });
 await page.goto(app.url+'/?id=count-state&secondary=none');
 const actions=page.getByRole('button',{name:'待辦',exact:true}),decisions=page.getByRole('button',{name:'決議',exact:true});
 await page.waitForFunction(()=>[...document.getElementsByTagName('button')].some(el=>el.getAttribute('aria-label')==='待辦'&&el.textContent==='待辦 (12)'));
 for(const [nextState,nextSummary] of [['in_call','idle'],['done','waiting_agent'],['done','generating'],['done','failed'],['in_call','ready']]){
  state=nextState;summaryState=nextSummary;
  await page.waitForFunction(({state,summary})=>currentRecord?.status?.state===state&&currentRecord?.summary?.state===summary,{state,summary:summaryState});
  assert.equal(await actions.textContent(),'待辦');assert.equal(await decisions.textContent(),'決議');
 }
 state='done';summaryState='ready';count=2;
 await page.waitForFunction(()=>[...document.getElementsByTagName('button')].some(el=>el.getAttribute('aria-label')==='待辦'&&el.textContent==='待辦 (2)'));
 assert.equal(await decisions.textContent(),'決議 (1)');
}));
