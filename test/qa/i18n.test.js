import {test} from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {createWavHeader} from '../../src/audio/wav-writer.js';
import assert from 'node:assert/strict';
import {browserCase,record} from './harness.js';
const copy={
 'zh-TW':{html:'zh-Hant',language:'介面語言',create:'＋ 新增記錄',search:'搜尋會議',settings:'設定',dialog:'工作台設定',done:'完成',theme:'深色模式',archive:'已封存',active:'進行與完成',status:'記錄中'},
 en:{html:'en',language:'Interface language',create:'＋ New recording',search:'Search meetings',settings:'Settings',dialog:'Workspace settings',done:'Done',theme:'Dark mode',archive:'Archived',active:'Active and completed',status:'Recording'},
 ja:{html:'ja',language:'表示言語',create:'＋ 新規録音',search:'会議を検索',settings:'設定',dialog:'ワークスペース設定',done:'完了',theme:'ダークモード',archive:'アーカイブ',active:'進行中・完了',status:'記録中'},
 ko:{html:'ko',language:'인터페이스 언어',create:'＋ 새 녹음',search:'회의 검색',settings:'설정',dialog:'작업 공간 설정',done:'완료',theme:'다크 모드',archive:'보관함',active:'진행 중 및 완료',status:'기록 중'}
};
for(const language of Object.keys(copy))for(const width of [1280,390])test(`I18N UI content privacy theme navigation persistence ${language} ${width}`,{timeout:30000},t=>browserCase(t,async({page,app,dir})=>{
 const text='會議紀錄 設定 已封存 <script>alert(1357)</script> 日本語 한국어';
 app.seed('language-main',{title:'設定',state:'in_call',startedAt:'2026-10-30T01:00:00Z'},[record(text,'摘要')]);app.seed('language-archive',{title:'歷史假資料',state:'archived'});
 await page.goto(app.url+'/?id=language-main&primary=all&secondary=none');await page.getByText(text,{exact:true}).waitFor();
 const before=await page.getByRole('combobox',{name:'原文顯示',exact:true}).inputValue();
 await page.getByRole('combobox',{name:'介面語言',exact:true}).selectOption(language);
 const c=copy[language];await page.getByRole('button',{name:c.create,exact:true}).waitFor();
 assert.equal(await page.getByRole('document').getAttribute('lang'),c.html);
 const expectedDate=new Date('2026-10-30T01:00:00Z').toLocaleDateString(language,{year:'numeric',month:'2-digit',day:'2-digit'});await page.getByRole('button',{name:/設定/}).filter({has:page.getByText(expectedDate,{exact:true})}).waitFor();
 await page.getByRole('region',{name:language==='en'?'Current meeting':language==='ja'?'現在の会議':language==='ko'?'현재 회의':'目前會議',exact:true}).getByText(c.status,{exact:true}).waitFor();
 await page.getByRole('heading',{name:'設定',exact:true,level:1}).waitFor();await page.getByText(text,{exact:true}).waitFor();
 assert.equal(await page.getByRole('combobox',{name:c.language,exact:true}).inputValue(),language);
 assert.equal(await page.getByRole('combobox',{name:language==='en'?'Original text':language==='ja'?'原文表示':language==='ko'?'원문 표시':'原文顯示',exact:true}).inputValue(),before);
 await page.getByRole('button',{name:c.settings,exact:true}).click();await page.getByRole('dialog',{name:c.dialog,exact:true}).waitFor();await page.getByRole('button',{name:c.done,exact:true}).click();
 const archive=page.getByRole('button',{name:new RegExp('^'+c.archive)});for(const button of [archive,page.getByRole('button',{name:c.active,exact:true})]){const size=await button.evaluate(el=>({width:el.clientWidth,content:el.scrollWidth}));assert.ok(size.content<=size.width+1,JSON.stringify({language,width,...size}));}
 await archive.focus();await page.keyboard.press('Enter');await page.getByRole('button',{name:/歷史假資料/}).waitFor();
 await page.getByRole('button',{name:c.active,exact:true}).click();
 for(const mode of ['light','dark']){
  if(mode==='dark')await page.getByRole('button',{name:c.theme,exact:true}).click();
  const box=await page.getByRole('button',{name:c.create,exact:true}).boundingBox();assert.ok(box.width>80);
  await page.screenshot({path:dir+'/'+mode+'.png',fullPage:true});
 }
 await page.reload();await page.getByRole('button',{name:c.create,exact:true}).waitFor();assert.equal(await page.getByRole('combobox',{name:c.language,exact:true}).inputValue(),language);await page.getByText(text,{exact:true}).waitFor();
 assert.equal(app.calls.stop.length,0);assert.equal(app.calls.start.length,0);
},{viewport:{width,height:900}}));

test('I18N changes synchronize across tabs and invalid stored language falls back safely',{timeout:20000},t=>browserCase(t,async({page,context,app,guard})=>{
 await page.goto(app.url);const second=await context.newPage();const {consoleGuard}=await import('./harness.js');const secondGuard=consoleGuard(second);await second.goto(app.url);
 await page.getByRole('combobox',{name:'介面語言',exact:true}).selectOption('ko');await second.getByRole('button',{name:'＋ 새 녹음',exact:true}).waitFor();
 await page.evaluate(()=>localStorage.setItem('duck-meeting:ui-language','<script>invalid</script>'));await page.reload();await page.getByRole('button',{name:'＋ 新增記錄',exact:true}).waitFor();assert.equal(await page.getByRole('document').getAttribute('lang'),'zh-Hant');secondGuard.assertClean();await second.close();
}));

test('I18N storage denial still allows in-place changes',{timeout:15000},t=>browserCase(t,async({page,app})=>{
 await page.addInitScript(()=>{Storage.prototype.getItem=()=>{throw new DOMException('Denied','SecurityError');};Storage.prototype.setItem=()=>{throw new DOMException('Denied','SecurityError');};});await page.goto(app.url);
 await page.getByRole('combobox',{name:'介面語言',exact:true}).selectOption('ja');await page.getByRole('button',{name:'＋ 新規録音',exact:true}).waitFor();await page.getByText('設定を保存できませんが、このセッションでは有効です。',{exact:true}).waitFor();
}));


test('I18N switching during microphone capture preserves the session and audio upload',{timeout:20000},t=>browserCase(t,async({page,app,ui})=>{
 await ui.open(app);await ui.capture();await ui.start.click();await page.getByRole('button',{name:'結束記錄',exact:true}).waitFor();
 const uploaded=page.waitForResponse(response=>response.url().endsWith('/api/microphone/audio')&&response.status()===200);
 await page.getByRole('combobox',{name:'介面語言',exact:true}).selectOption('en');await uploaded;await page.getByText('● Local recording · Speakers A/B · Inform participants you are recording',{exact:true}).waitFor();
 assert.equal(app.calls.start.length,1);assert.equal(app.calls.stop.length,0);assert.ok(app.calls.audio.length>0);
 const stopped=page.waitForResponse(response=>response.url().endsWith('/api/microphone/stop')&&response.status()===200);await page.getByRole('button',{name:'Stop recording',exact:true}).click();await stopped;await page.getByRole('region',{name:'Current meeting',exact:true}).getByText('Completed',{exact:true}).waitFor();assert.equal(app.calls.stop.length,1);
}));

test('I18N complete authored markup catalog',{timeout:20000},t=>browserCase(t,async({page,app})=>{
 await page.route('**/app.js',route=>route.fulfill({body:''}));await page.route('**/workspace.js',route=>route.fulfill({body:''}));await page.route('**/microphone.js',route=>route.fulfill({body:''}));await page.goto(app.url);
 await page.getByRole('combobox',{name:'介面語言',exact:true}).selectOption('en');
 const unlocalized=await page.evaluate(()=>{const out=[],walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);while(walker.nextNode()){const n=walker.currentNode;if(!n.parentElement.closest('script,style,[data-locale-native],[data-meeting-content]')&&/[\u3400-\u9fff]/.test(n.nodeValue))out.push(n.nodeValue.trim());}return out;});assert.deepEqual(unlocalized,[]);
 const complete=await page.evaluate(()=>Object.entries(window.DuckLocaleCatalog).every(([key,values])=>key&&values.length===3&&values.every(value=>typeof value==='string'&&value.trim())));assert.equal(complete,true);
}));


test('I18N switching preserves playback and user titles matching UI labels',{timeout:20000},t=>browserCase(t,async({page,app})=>{
 const dir=app.seed('private-content',{state:'done',title:'會議工作台'},[record('設定 已封存 摘要','設定')]);const markdown='# 會議工作台\n\n## 會議摘要\n\n設定 已封存 摘要 原文保留。\n';fs.writeFileSync(path.join(dir,'summary.md'),markdown);
 const pcm=Buffer.alloc(16000*2*20);fs.writeFileSync(path.join(dir,'audio.wav'),Buffer.concat([createWavHeader({dataBytes:pcm.length}),pcm]));
 let navigations=0;page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations++;});await page.goto(app.url+'/?id=private-content&secondary=none');await page.getByText('設定 已封存 摘要 原文保留。',{exact:true}).waitFor();
 const audio=page.getByLabel(/^(錄音播放引擎|Recording playback engine|録音再生エンジン|녹음 재생 엔진)$/);await audio.evaluate(el=>el.readyState>=1?Promise.resolve():new Promise(resolve=>el.addEventListener('loadedmetadata',resolve,{once:true})));
 await page.getByRole('button',{name:/播放錄音/}).click();await page.getByRole('button',{name:/暫停錄音/}).waitFor();const initial=await audio.evaluate(el=>el.currentTime),count=navigations;
 for(const language of ['en','ja','ko']){
  const selector=page.getByRole('combobox',{name:/^(介面語言|Interface language|表示言語|인터페이스 언어)$/});await selector.selectOption(language);
  await page.getByRole('button',{name:copy[language].create,exact:true}).waitFor();await page.getByRole('heading',{name:'會議工作台',level:1,exact:true}).waitFor();await page.getByText('設定 已封存 摘要 原文保留。',{exact:true}).waitFor();assert.equal(await page.getByText('設定 已封存 摘要 原文保留。',{exact:true}).evaluate(el=>el.parentElement.tagName),'SECTION');
  assert.equal(await audio.evaluate(el=>el.paused),false);assert.ok(await audio.evaluate(el=>el.currentTime)>=initial);assert.equal(navigations,count);
 }
 assert.equal(fs.readFileSync(path.join(dir,'summary.md'),'utf8'),markdown);await page.getByRole('button',{name:/녹음 일시 정지/}).click();
}));
