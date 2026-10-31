import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {fixture,browserCase,record,defer} from './harness.js';import {readMailDraft,saveMailDraft} from '../../src/mail-draft.js';
function seed(app,id='mail'){const dir=app.seed(id,{state:'done',title:'郵件測試'},[record('原始會議內容')]);fs.writeFileSync(path.join(dir,'summary.md'),'# 郵件測試\n\n## 會議摘要\n\n原文不可更動。\n');return dir;}
test('MAIL-API source/revision validation, exact scope and same-origin boundary',async t=>{const app=await fixture();t.after(()=>app.close());const dir=seed(app);const get=()=>readMailDraft(dir);const post=(body,origin=app.url)=>fetch(app.url+'/api/mail-draft',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});const input={id:'mail',subject:'Subject',body:'Original notes only.',to:[],cc:[],bcc:[],sourceRevision:get().sourceRevision,expectedRevision:null};assert.equal((await post(input,'https://evil.example')).status,403);assert.equal((await post({...input,id:'latest'})).status,400);assert.equal((await post({...input,id:'../outside'})).status,404);assert.equal((await post({...input,to:['bad']})).status,400);assert.equal((await post(input)).status,200);const conflict=await post(input);assert.equal(conflict.status,200);assert.deepEqual(await conflict.json(),{ok:false,error:'mail_conflict'});assert.equal(get().draft.subject,'Subject');});
for(const width of [1280,390])for(const theme of ['light','dark'])test(`MAIL-UI edit save copy download and source privacy ${width} ${theme}`,{timeout:25000},t=>browserCase(t,async({page,context,app,dir})=>{
 const folder=seed(app);const original=fs.readFileSync(path.join(folder,'summary.md'),'utf8');await context.grantPermissions(['clipboard-read','clipboard-write']);await page.addInitScript(theme=>localStorage.setItem('duck-meeting:theme',theme),theme);await page.goto(app.url+'/?id=mail&primary=all&secondary=none');await page.getByText('原文不可更動。',{exact:true}).waitFor();
 const controls=()=>page.evaluate(()=>[...document.querySelectorAll('[data-notes-tab],#notes-copy,#notes-download')].map(b=>{const r=b.getBoundingClientRect();return [r.x+scrollX,r.y+scrollY,r.width,r.height];}));const baseline=await controls();
 for(const name of ['決議','待辦','郵件','摘要','郵件']){await page.getByRole('button',{name,exact:true}).click();assert.deepEqual(await controls(),baseline,'Notes controls must not move on tab switch');}

 const panel=page.getByRole('region',{name:'郵件草稿',exact:true});await panel.waitFor();
 for(const name of ['儲存草稿','複製郵件','下載草稿']){const metrics=await panel.getByRole('button',{name,exact:true}).evaluate(button=>{const box=button.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(button);const text=range.getBoundingClientRect();return {height:box.height,offset:Math.abs((text.top+text.bottom-box.top-box.bottom)/2),align:getComputedStyle(button).alignItems};});assert.equal(metrics.align,'center');assert.ok(metrics.height>=36);assert.ok(metrics.offset<=3,JSON.stringify(metrics));}
assert.equal(await page.getByRole('button',{name:'建立信件草稿',exact:true}).count(),0);
 await panel.getByRole('textbox',{name:'主旨',exact:true}).fill('會議紀錄 1357');await panel.getByRole('textbox',{name:'收件人',exact:true}).fill('recipient@example.com');await panel.getByRole('textbox',{name:'郵件內文',exact:true}).fill('各位好，原文 <script>alert(1)</script> 保留。');await panel.getByRole('button',{name:'儲存草稿',exact:true}).click();await panel.getByText('草稿已儲存，尚未建立或寄送信件。',{exact:true}).waitFor();
 await panel.getByRole('button',{name:'複製郵件',exact:true}).click();assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/Subject: 會議紀錄 1357/);await page.getByRole('button',{name:'複製',exact:true}).click();assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/Subject: 會議紀錄 1357/);const downloading=page.waitForEvent('download');await panel.getByRole('button',{name:'下載草稿',exact:true}).click();assert.equal((await downloading).suggestedFilename(),'mail-mail-draft.txt');
 await page.reload();await page.getByRole('button',{name:'郵件',exact:true}).click();assert.equal(await panel.getByRole('textbox',{name:'主旨',exact:true}).inputValue(),'會議紀錄 1357');
 await panel.getByRole('textbox',{name:'郵件內文',exact:true}).fill('User edit must survive polling.');const current=readMailDraft(folder);saveMailDraft(folder,{subject:'Agent revision',body:'Agent content',to:[],cc:[],bcc:[],sourceRevision:current.sourceRevision,expectedRevision:current.revision},{actor:'agent'});
 await panel.getByRole('button',{name:'儲存草稿',exact:true}).click();await panel.getByText('草稿或來源已更新；編輯已保留，請先複製內容再重新核對。',{exact:true}).waitFor();assert.equal(await panel.getByRole('textbox',{name:'郵件內文',exact:true}).inputValue(),'User edit must survive polling.');
 assert.equal(fs.readFileSync(path.join(folder,'summary.md'),'utf8'),original);
 await panel.getByRole('textbox',{name:'郵件內文',exact:true}).fill('長篇會議郵件內容\n'.repeat(80));
 await page.waitForFunction(()=>{const body=document.getElementById('mail-body');return body.clientHeight<body.scrollHeight&&body.clientHeight<=220;});
 const action=panel.getByRole('button',{name:'下載草稿',exact:true});await action.scrollIntoViewIfNeeded();const bounds=await action.boundingBox();assert.ok(bounds.y>=0&&bounds.y+bounds.height<=900);
 const scroll=await panel.evaluate(panel=>({height:panel.clientHeight,content:panel.scrollHeight,overflow:getComputedStyle(panel).overflowY}));assert.equal(scroll.overflow,'scroll');assert.ok(scroll.content>scroll.height,JSON.stringify(scroll));
 await page.screenshot({path:dir+'/mail.png',fullPage:true});
},{viewport:{width,height:900}}));


test('MAIL stale poll responses cannot replace a just-saved draft',{timeout:20000},t=>browserCase(t,async({page,app})=>{
 seed(app);await page.goto(app.url+'/?id=mail&secondary=none');await page.getByRole('button',{name:'郵件',exact:true}).click();const panel=page.getByRole('region',{name:'郵件草稿',exact:true});
 const old=await (await fetch(app.url+'/api/transcript?id=mail')).json(),gate=defer();let blocked=false;
 await page.route('**/api/transcript?*',async route=>{if(!blocked){blocked=true;await gate.promise;await route.fulfill({json:old});}else await route.continue();});
 const pending=page.waitForRequest(request=>request.url().includes('/api/transcript?'));await pending;
 await panel.getByRole('textbox',{name:'主旨',exact:true}).fill('Fresh saved version');await panel.getByRole('textbox',{name:'郵件內文',exact:true}).fill('Preserve new body.');await panel.getByRole('button',{name:'儲存草稿',exact:true}).click();await panel.getByText('草稿已儲存，尚未建立或寄送信件。',{exact:true}).waitFor();
 await page.evaluate(()=>{window.mailPollArrived=false;document.addEventListener('mail-meeting',()=>{window.mailPollArrived=true;},{once:true});});gate.resolve();await page.waitForFunction(()=>window.mailPollArrived===true);
 assert.equal(await panel.getByRole('textbox',{name:'主旨',exact:true}).inputValue(),'Fresh saved version');
}));

test('MAIL unsaved changes survive switching meetings',{timeout:20000},t=>browserCase(t,async({page,app})=>{
 seed(app,'mail-a');const b=seed(app,'mail-b');fs.writeFileSync(path.join(b,'status.json'),JSON.stringify({id:'mail-b',title:'另一場會議',state:'done'}));
 await page.goto(app.url+'/?id=mail-a&secondary=none');await page.getByRole('button',{name:'郵件',exact:true}).click();const panel=page.getByRole('region',{name:'郵件草稿',exact:true});await panel.getByRole('textbox',{name:'主旨',exact:true}).fill('Unsaved A');await panel.getByRole('textbox',{name:'郵件內文',exact:true}).fill('Private draft A');
 await page.getByRole('complementary',{name:'歷史會議清單'}).getByRole('button',{name:/另一場會議/}).getByRole('img').click();await page.getByRole('heading',{name:'另一場會議',level:1,exact:true}).waitFor();assert.equal(await panel.getByRole('textbox',{name:'主旨',exact:true}).inputValue(),'');
 await page.getByRole('complementary',{name:'歷史會議清單'}).getByRole('button',{name:/郵件測試/}).getByRole('img').click();await page.getByRole('heading',{name:'郵件測試',level:1,exact:true}).waitFor();assert.equal(await panel.getByRole('textbox',{name:'主旨',exact:true}).inputValue(),'Unsaved A');
}));

for(const [language,tab,label,subject,body] of [['en','Mail','Mail draft','Subject','Email body'],['ja','メール','メール原稿','件名','メール本文'],['ko','메일','메일 초안','제목','메일 본문']])test(`MAIL localized tab preserves source content ${language}`,{timeout:15000},t=>browserCase(t,async({page,app})=>{
 const folder=seed(app),read=readMailDraft(folder);saveMailDraft(folder,{to:[],cc:[],bcc:[],subject:'郵件',body:'原文內容不得翻譯。',expectedRevision:null,sourceRevision:read.sourceRevision},{actor:'agent'});
 await page.addInitScript(language=>localStorage.setItem('duck-meeting:ui-language',language),language);await page.goto(app.url+'/?id=mail&secondary=none');await page.getByRole('button',{name:tab,exact:true}).click();const panel=page.getByRole('region',{name:label,exact:true});await panel.waitFor();assert.equal(await panel.getByRole('textbox',{name:subject,exact:true}).inputValue(),'郵件');assert.equal(await panel.getByRole('textbox',{name:body,exact:true}).inputValue(),'原文內容不得翻譯。');
}));


test('MAIL tab retains decision and action counts through switching and polling',{timeout:20000},t=>browserCase(t,async({page,app})=>{
 const folder=seed(app);fs.writeFileSync(path.join(folder,'summary.md'),'# 計數測試\n\n## 重要決議\n\n1. 保留原文。\n2. 核對來源。\n\n## 行動項目\n\n| 事項 | 負責人 | 期限 |\n| --- | --- | --- |\n| 檢查頁面 | Alice | 未指定 |\n| 檢查匯出 | Bob | 未指定 |\n');
 await page.goto(app.url+'/?id=mail&secondary=none');const decisions=page.getByRole('button',{name:'決議',exact:true}),actions=page.getByRole('button',{name:'待辦',exact:true});await decisions.getByText('決議 (2)',{exact:true}).waitFor();await actions.getByText('待辦 (2)',{exact:true}).waitFor();
 for(const tab of ['郵件','決議','待辦','摘要','郵件']){await page.getByRole('button',{name:tab,exact:true}).click();assert.equal(await decisions.textContent(),'決議 (2)');assert.equal(await actions.textContent(),'待辦 (2)');}
 const response=await fetch(app.url+'/api/transcript?id=mail');const data=await response.json();await page.evaluate(data=>document.dispatchEvent(new CustomEvent('workspace-rendered',{detail:data})),data);assert.equal(await decisions.textContent(),'決議 (2)');assert.equal(await actions.textContent(),'待辦 (2)');
}));

for(const width of [1280,390])test(`MAIL expanded item selector keeps lower fields reachable ${width}`,{timeout:20000},t=>browserCase(t,async({page,app})=>{
 const folder=seed(app);fs.writeFileSync(path.join(folder,'summary.md'),'# 測試\n\n## 重要決議\n\n'+Array.from({length:20},(_,i)=>`${i+1}. 需要核對的決議 ${i+1}。`).join('\n'));
 await page.goto(app.url+'/?id=mail&secondary=none');await page.getByRole('button',{name:'郵件',exact:true}).click();
 await page.getByText('選擇郵件內容',{exact:true}).click();
 const panel=page.getByRole('region',{name:'郵件草稿',exact:true});
 assert.ok(await panel.evaluate(el=>el.scrollHeight>el.clientHeight));
 await panel.getByRole('textbox',{name:'主旨',exact:true}).fill('捲動測試');await panel.getByRole('textbox',{name:'郵件內文',exact:true}).fill('底部內文仍可編輯');const save=panel.getByRole('button',{name:'儲存草稿',exact:true});await save.scrollIntoViewIfNeeded();await save.click({trial:true});
 const bounds=await save.boundingBox(),viewport=page.viewportSize();assert.ok(bounds.y>=0&&bounds.y+bounds.height<=viewport.height);
 assert.ok(await panel.evaluate(el=>el.scrollTop>0));
 await panel.getByRole('textbox',{name:'郵件內文',exact:true}).fill('底部內文仍可編輯');
},{viewport:{width,height:900}}));

for(const width of [1280,390])for(const [mode,original,remove] of [
 ['template','各位好，\n\n【會議重點】\n摘要保留。\n\n【已確認決議】\n原有決議內容。\n\n【後續待辦】\n原有待辦內容。\n\n謝謝，\nArthur',['原有決議內容。','原有待辦內容。']],
 ['markdown','Hello everyone,\n\n## Summary\n摘要保留。\n\n## Decisions\n- 原有決議內容。\n\n## Actions\n- 原有待辦內容。\n\nBest regards,\nArthur',['原有決議內容。','原有待辦內容。']],
 ['freeform','各位好，\n這是自訂說明，不能被刪除。\n摘要保留。\n\n謝謝，\nArthur',[]]
])test(`MAIL apply preserves surrounding body ${mode} ${width}`,{timeout:25000},t=>browserCase(t,async({page,app})=>{
 const folder=seed(app);fs.writeFileSync(path.join(folder,'summary.md'),'## 重要決議\n\n1. 新增決議。\n2. 不選的決議。\n\n## 行動項目\n\n| 事項 | 負責人 | 期限 |\n| --- | --- | --- |\n| 新增待辦。 | Alice | 未指定 |\n| 不選的待辦。 | Bob | 未指定 |');
 await page.goto(app.url+'/?id=mail&secondary=none');await page.getByRole('button',{name:'郵件',exact:true}).click();const panel=page.getByRole('region',{name:'郵件草稿',exact:true}),body=panel.getByRole('textbox',{name:'郵件內文',exact:true});
 await panel.getByRole('textbox',{name:'主旨',exact:true}).fill('保留原信');await body.fill(original);await page.getByText('選擇郵件內容',{exact:true}).click();const choices=panel.getByRole('checkbox');await choices.nth(0).check();await choices.nth(2).check();await page.getByRole('button',{name:'預覽勾選內容',exact:true}).click();assert.equal(await body.inputValue(),original);
 const apply=page.getByRole('button',{name:'套用到正文',exact:true});await apply.click();const merged=await body.inputValue();assert.match(merged,/摘要保留。/);assert.match(merged,/Arthur/);assert.match(merged,/新增決議。/);assert.match(merged,/新增待辦。/);assert.ok(!merged.includes('不選的決議。')&&!merged.includes('不選的待辦。'));for(const text of remove)assert.ok(!merged.includes(text));
 if(mode==='freeform')assert.ok(merged.includes('這是自訂說明，不能被刪除。'));assert.ok(merged.endsWith('Arthur'));
 await page.getByRole('button',{name:'復原套用前正文',exact:true}).click();assert.equal(await body.inputValue(),original);await apply.click();await apply.click();assert.equal(await body.inputValue(),merged);
 await panel.getByRole('button',{name:'儲存草稿',exact:true}).click();await panel.getByText('草稿已儲存，尚未建立或寄送信件。',{exact:true}).waitFor();await page.reload();await page.getByRole('button',{name:'郵件',exact:true}).click();await page.waitForFunction(expected=>document.getElementById('mail-body').value===expected,merged);assert.equal(await body.inputValue(),merged);
},{viewport:{width,height:930}}));

for(const width of [1280,390])test(`MAIL repairs supplied repeated action blocks and selection changes ${width}`,{timeout:25000},t=>browserCase(t,async({page,app})=>{
 const original=fs.readFileSync('test/fixtures/mail/duplicate-selection.txt','utf8').replace(/\r\n/g,'\n'),folder=seed(app);fs.writeFileSync(path.join(folder,'summary.md'),'## 重要決議\n\n1. 決議先整理操作流程與驗收清單，再安排下一輪測試。\n\n## 行動項目\n\n| 事項 | 負責人 | 期限 |\n| --- | --- | --- |\n| 整理操作流程初稿 | 周子晴 | 2026/11/03 |\n| 檢查手機版操作區域 | 劉明哲 | 2026/11/04 |');
 await page.goto(app.url+'/?id=mail&secondary=none');await page.getByRole('button',{name:'郵件',exact:true}).click();const panel=page.getByRole('region',{name:'郵件草稿',exact:true}),body=panel.getByRole('textbox',{name:'郵件內文',exact:true});await panel.getByRole('textbox',{name:'主旨',exact:true}).fill('版本規劃討論');await body.fill(original);await page.getByText('選擇郵件內容',{exact:true}).click();const choices=panel.getByRole('checkbox');await choices.nth(0).check();await choices.nth(1).check();
 const apply=async()=>{await panel.getByRole('button',{name:'預覽勾選內容',exact:true}).click();await panel.getByRole('button',{name:'套用到正文',exact:true}).click();return body.inputValue();};
 const check=value=>{assert.match(value,/各位好，/);assert.match(value,/本次確認下一版核心操作流程/);assert.ok(value.includes('如有需修正之處，請再補充，謝謝。'));assert.ok(value.trim().endsWith('（此為虛構會議的展示草稿，未建立或寄送任何信件。）'));assert.equal((value.match(/【(?:後續待辦|待辦)】/g)||[]).length,1);};
 let value=await apply();check(value);assert.equal((value.match(/周子晴/g)||[]).length,1);assert.equal((value.match(/劉明哲/g)||[]).length,0);await panel.getByRole('button',{name:'復原套用前正文',exact:true}).click();assert.equal(await body.inputValue(),original);assert.equal(await apply(),value);assert.equal(await apply(),value);
 await panel.getByRole('button',{name:'儲存草稿',exact:true}).click();await panel.getByText('草稿已儲存，尚未建立或寄送信件。',{exact:true}).waitFor();await page.reload();await page.getByRole('button',{name:'郵件',exact:true}).click();await page.waitForFunction(expected=>document.getElementById('mail-body').value===expected,value);await page.getByText('選擇郵件內容',{exact:true}).click();assert.equal(await apply(),value);
 await choices.nth(2).check();value=await apply();check(value);assert.equal((value.match(/周子晴/g)||[]).length,1);assert.equal((value.match(/劉明哲/g)||[]).length,1);assert.equal(await apply(),value);
 await choices.nth(1).uncheck();value=await apply();check(value);assert.equal((value.match(/周子晴/g)||[]).length,0);assert.equal((value.match(/劉明哲/g)||[]).length,1);
 await choices.nth(2).uncheck();const decisionOnly=await apply();assert.equal((decisionOnly.match(/【(?:後續待辦|待辦)】/g)||[]).length,0);assert.ok(!decisionOnly.includes('周子晴')&&!decisionOnly.includes('劉明哲'));assert.equal(await apply(),decisionOnly);
 await panel.getByRole('textbox',{name:'郵件內文',exact:true}).fill(original+'\n\n【待辦】\n手動補充：這段不要刪除。');await choices.nth(1).check();const manual=await apply();assert.ok(manual.includes('手動補充：這段不要刪除。'));assert.equal(await apply(),manual);
},{viewport:{width,height:930}}));
