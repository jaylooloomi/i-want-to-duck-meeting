import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {fixture,browserCase,record,defer} from './harness.js';import {readMailDraft,saveMailDraft} from '../../src/mail-draft.js';
function seed(app,id='mail'){const dir=app.seed(id,{state:'done',title:'郵件測試'},[record('原始會議內容')]);fs.writeFileSync(path.join(dir,'summary.md'),'# 郵件測試\n\n## 會議摘要\n\n原文不可更動。\n');return dir;}
test('MAIL-API source/revision validation, exact scope and same-origin boundary',async t=>{const app=await fixture();t.after(()=>app.close());const dir=seed(app);const get=()=>readMailDraft(dir);const post=(body,origin=app.url)=>fetch(app.url+'/api/mail-draft',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});const input={id:'mail',subject:'Subject',body:'Original notes only.',to:[],cc:[],bcc:[],sourceRevision:get().sourceRevision,expectedRevision:null};assert.equal((await post(input,'https://evil.example')).status,403);assert.equal((await post({...input,id:'latest'})).status,400);assert.equal((await post({...input,id:'../outside'})).status,404);assert.equal((await post({...input,to:['bad']})).status,400);assert.equal((await post(input)).status,200);const conflict=await post(input);assert.equal(conflict.status,200);assert.deepEqual(await conflict.json(),{ok:false,error:'mail_conflict'});assert.equal(get().draft.subject,'Subject');});
for(const width of [1280,390])for(const theme of ['light','dark'])test(`MAIL-UI edit save copy download and source privacy ${width} ${theme}`,{timeout:25000},t=>browserCase(t,async({page,context,app,dir})=>{
 const folder=seed(app);const original=fs.readFileSync(path.join(folder,'summary.md'),'utf8');await context.grantPermissions(['clipboard-read','clipboard-write']);await page.addInitScript(theme=>localStorage.setItem('duck-meeting:theme',theme),theme);await page.goto(app.url+'/?id=mail&primary=all&secondary=none');await page.getByText('原文不可更動。',{exact:true}).waitFor();
 const controls=()=>page.evaluate(()=>[...document.querySelectorAll('[data-notes-tab],#notes-copy,#notes-download')].map(b=>{const r=b.getBoundingClientRect();return [r.x,r.y,r.width,r.height];}));const baseline=await controls();
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
 await page.waitForFunction(()=>{const body=document.getElementById('mail-body');return body.clientHeight>=body.scrollHeight;});
 const scroll=await panel.evaluate(panel=>({height:panel.clientHeight,content:panel.scrollHeight,overflow:getComputedStyle(panel).overflowY}));assert.equal(scroll.overflow,'visible');assert.ok(scroll.content<=scroll.height+2,JSON.stringify(scroll));
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
