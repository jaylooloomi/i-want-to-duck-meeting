import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {browserCase,record} from './harness.js';

for(const width of [1920,390]) test(`FLOW-01 sidebar selection and new capture ${width}`,{timeout:25000},t=>browserCase(t,async({page,app,dir})=>{
  app.seed('old',{state:'done',code:'old-test'},[record('歷史內容')]);
  await page.goto(app.url+'/?id=old&primary=all&secondary=none');
  await page.getByText('歷史內容',{exact:true}).waitFor();
  assert.equal(await page.getByRole('combobox',{name:'會議',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'結束記錄',exact:true}).isVisible(),false);
  await page.getByRole('button',{name:'＋ 新增記錄',exact:true}).click();
  const setup=page.getByRole('region',{name:'新增記錄設定'});
  await setup.waitFor();
  const size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
  assert.ok(size.scroll<=size.width+1,JSON.stringify(size));
  await page.screenshot({path:path.join(dir,'new-record.png'),fullPage:true});
  const pcm=page.waitForRequest(r=>r.url().endsWith('/api/microphone/audio'));
  await page.getByRole('button',{name:'開始收音',exact:true}).click();await pcm;
  await page.getByText('QA adapter transcript',{exact:true}).waitFor();
  assert.equal(await setup.isVisible(),false);
  await page.getByText(/請保持此錄音分頁開啟/).waitFor();
  const side=page.getByRole('complementary',{name:'歷史會議清單'});
  await side.getByRole('button',{name:/old-test/}).click();
  await page.getByText('歷史內容',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'結束記錄',exact:true}).isVisible(),false);
  await page.getByRole('button',{name:'返回進行中的記錄',exact:true}).click();
  await page.getByText('QA adapter transcript',{exact:true}).waitFor();
  await page.getByRole('button',{name:'結束記錄',exact:true}).click();
  await page.getByText('記錄已保存',{exact:true}).waitFor();
  assert.equal(app.calls.stop.length,1);
  await page.screenshot({path:path.join(dir,'layout.png'),fullPage:true});
},{viewport:{width,height:width===390?844:1080}}));

test('FLOW-02 Meet context stop targets exact meeting and blocks duplicate capture',{timeout:20000},t=>browserCase(t,async({page,app})=>{
  const active=app.seed('running',{state:'in_call',pid:process.pid,code:'active-call'});
  const old=app.seed('old',{state:'done',code:'old-call'});
  await page.goto(app.url+'/?id=old&primary=all&secondary=none');await page.getByRole('heading',{name:'Google Meet · old-call',exact:true}).waitFor();
  await page.getByRole('button',{name:'＋ 新增記錄',exact:true}).click();
  await page.getByRole('heading',{name:'Google Meet · active-call',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'開始收音',exact:true}).isVisible(),false);
  const result=await fetch(app.url+'/api/microphone/start',{method:'POST',headers:{'Content-Type':'application/json',Origin:app.url},body:'{}'});
  assert.equal(result.status,409);assert.equal(app.calls.start.length,0);
  await page.getByRole('button',{name:'結束記錄',exact:true}).click();
  await page.waitForResponse(r=>r.url().includes('/api/transcript'));
  assert.equal(fs.existsSync(path.join(active,'STOP')),true);
  assert.equal(fs.existsSync(path.join(old,'STOP')),false);
}));

test('FLOW-03 failed stop is visible and retry remains available',{timeout:20000},t=>browserCase(t,async({page,app})=>{
  app.seed('running',{state:'in_call',code:'failed-stop'});
  await page.goto(app.url+'/?primary=all&secondary=none');await page.getByRole('heading',{name:'Google Meet · failed-stop',exact:true}).waitFor();
  await page.evaluate(()=>{const original=window.fetch;window.fetch=(url,...args)=>url==='/api/meetings/action'?Promise.reject(new Error('連線失敗')):original(url,...args);});
  await page.getByRole('button',{name:'結束記錄',exact:true}).click();
  await page.getByText('停止失敗：連線失敗',{exact:true}).waitFor();
  await page.getByRole('button',{name:'結束記錄',exact:true}).click({trial:true});
  assert.equal(await page.getByRole('button',{name:'結束記錄',exact:true}).isEnabled(),true);
}));

test('FLOW-04 follow latest switches only when enabled',{timeout:20000},t=>browserCase(t,async({page,app})=>{
  app.seed('a',{state:'done',code:'older'},[record('較早內容')]);
  await page.goto(app.url+'/?id=a&primary=all&secondary=none');await page.getByText('較早內容',{exact:true}).waitFor();
  app.seed('z',{state:'done',code:'newer'},[record('最新內容')]);
  await page.getByRole('complementary').getByRole('button',{name:/newer/}).waitFor();
  assert.equal(await page.getByText('較早內容',{exact:true}).isVisible(),true);
  await page.getByRole('button',{name:'設定',exact:false}).click();
  await page.getByRole('checkbox',{name:'自動跟隨最新會議',exact:true}).check();
  await page.getByRole('dialog',{name:'工作台設定'}).getByRole('button',{name:'完成',exact:true}).click();
  await page.getByText('最新內容',{exact:true}).waitFor();
  await page.getByRole('complementary').getByRole('button',{name:/older/}).click();
  await page.getByText('較早內容',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('自動跟隨最新會議',{exact:true}).isChecked(),false);
}));
