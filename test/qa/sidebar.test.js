import {test} from 'node:test';
import assert from 'node:assert/strict';
import {browserCase} from './harness.js';

for (const viewport of [{width:1920,height:1080},{width:390,height:844}]) {
  test(`SIDEBAR-01 41 meetings retain readable cards and scroll ${viewport.width}`,{timeout:20000},t=>browserCase(t,async({page,app,dir})=>{
    for(let i=0;i<41;i++)app.seed(`history-${String(i).padStart(2,'0')}`,{state:'done',code:`meeting-${i}`});
    await page.goto(app.url);
    const sidebar=page.getByRole('complementary',{name:'歷史會議清單'});
    const buttons=sidebar.getByRole('button',{name:/meeting-/});
    await buttons.last().waitFor({state:'attached'});
    assert.equal(await buttons.count(),41);
    const first=buttons.first();
    const card=await first.evaluate(el=>({height:el.parentElement.getBoundingClientRect().height,content:el.parentElement.scrollHeight}));
    assert.ok(card.height>=card.content-2,`card clipped: ${JSON.stringify(card)}`);
    await buttons.last().scrollIntoViewIfNeeded();
    await buttons.last().click();
    await page.screenshot({path:dir+'/sidebar.png'});
  },{viewport}));
}
