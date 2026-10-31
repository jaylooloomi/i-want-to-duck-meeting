import {test} from 'node:test';
import assert from 'node:assert/strict';
import {browserCase,record} from './harness.js';
for(const width of [1920,390])test(`LANG-01 bilingual presets apply filters translation and persist ${width}`,{timeout:20000},t=>browserCase(t,async({page,app})=>{
 app.seed('languages',{state:'done'},[{...record('Hello everyone'),source:'teams-native'},{...record('中文測試 Microsoft Teams'),source:'teams-native'}]);
 await page.route('**/api/translate',r=>{const data=r.request().postDataJSON();return r.fulfill({json:{translations:data.texts.map(()=>data.target==='zh-TW'?'中文翻譯結果':'English translation result')}});});
 await page.goto(app.url+'/?id=languages');
 const transcript=page.getByRole('region',{name:'會議逐字稿'});
 await transcript.getByText('中文測試 Microsoft Teams',{exact:true}).waitFor();
 assert.equal(await page.getByRole('combobox',{name:'原文顯示',exact:true}).inputValue(),'zh-TW');assert.equal(await page.getByRole('combobox',{name:'翻譯語言',exact:true}).inputValue(),'en');assert.equal(await page.getByRole('button',{name:'中英',exact:true}).getAttribute('aria-pressed'),'true');
 const shortcuts=page.getByRole('group',{name:'語言快捷設定'});assert.equal(await shortcuts.getByRole('button').first().textContent(),'中英');
 await page.getByRole('button',{name:'英中',exact:true}).click();
 await transcript.getByText('中文翻譯結果',{exact:true}).waitFor();
 assert.equal(await transcript.getByText('中文測試 Microsoft Teams',{exact:true}).count(),0);
 assert.equal(await page.getByRole('combobox',{name:'原文顯示',exact:true}).inputValue(),'en');
 assert.equal(await page.getByRole('combobox',{name:'翻譯語言',exact:true}).inputValue(),'zh-TW');
 assert.equal(await page.getByRole('button',{name:'英中',exact:true}).getAttribute('aria-pressed'),'true');
 await page.getByRole('button',{name:'中英',exact:true}).click();
 await transcript.getByText('English translation result',{exact:true}).waitFor();
 assert.equal(await transcript.getByText('Hello everyone',{exact:true}).count(),0);
 await page.reload();await transcript.getByText('English translation result',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'中英',exact:true}).getAttribute('aria-pressed'),'true');
 await page.getByRole('combobox',{name:'翻譯語言',exact:true}).selectOption('none');
 assert.equal(await page.getByRole('button',{name:'中英',exact:true}).getAttribute('aria-pressed'),'false');
 await page.reload();assert.equal(await page.getByRole('combobox',{name:'翻譯語言',exact:true}).inputValue(),'none');
 const size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(size.scroll<=size.width+1);
},{viewport:{width,height:width===390?844:1080}}));

test('LANG-02 explicit language URL overrides the Chinese-English default',{timeout:15000},t=>browserCase(t,async({page,app})=>{
 app.seed('explicit',{state:'done'},[record('English source')]);await page.goto(app.url+'/?id=explicit&primary=all&secondary=none');await page.getByText('English source',{exact:true}).waitFor();assert.equal(await page.getByRole('combobox',{name:'原文顯示',exact:true}).inputValue(),'all');assert.equal(await page.getByRole('combobox',{name:'翻譯語言',exact:true}).inputValue(),'none');assert.equal(await page.getByRole('button',{name:'中英',exact:true}).getAttribute('aria-pressed'),'false');await page.getByRole('combobox',{name:'原文顯示',exact:true}).selectOption('all');await page.reload();await page.getByText('English source',{exact:true}).waitFor();assert.equal(await page.getByRole('combobox',{name:'翻譯語言',exact:true}).inputValue(),'none');
}));

for(const language of ['de','ja','ko'])test(`LANG-03 ${language} view respects language metadata and retains unknown originals`,{timeout:15000},t=>browserCase(t,async({page,app})=>{
 const texts={de:'Das ist ein deutscher Testsatz.',ja:'これは日本語のテストです。',ko:'한국어 테스트 문장입니다.'};
 app.seed('multilingual',{state:'done'},[...Object.entries(texts).map(([lang,text])=>({...record(text),language:lang+'-'+({de:'DE',ja:'JP',ko:'KR'})[lang]})),record('Unlabeled legacy original 1357'),record('未標註的舊原文')]);
 await page.goto(app.url+'/?id=multilingual&primary=all&secondary=none');await page.getByText(texts[language],{exact:true}).waitFor();await page.getByRole('combobox',{name:'原文顯示',exact:true}).selectOption(language);
 const transcript=page.getByRole('region',{name:'會議逐字稿'});await transcript.getByText(texts[language],{exact:true}).waitFor();
 for(const [lang,text] of Object.entries(texts))if(lang!==language)await transcript.getByText(text,{exact:true}).waitFor({state:'detached'});
 await transcript.getByText('Unlabeled legacy original 1357',{exact:true}).waitFor();await transcript.getByText('未標註的舊原文',{exact:true}).waitFor();await page.getByText('依已標註語言篩選；未標註段落保留顯示。此設定不會切換平台字幕辨識語言。',{exact:true}).waitFor();
 await page.reload();await transcript.getByText(texts[language],{exact:true}).waitFor();assert.equal(await page.getByRole('combobox',{name:'原文顯示',exact:true}).inputValue(),language);
}));

for(const width of [1920,390])for(const language of ['zh-TW','en','ja','ko'])test(`LANG-WIDTH equal original and translation columns ${width} ${language}`,{timeout:15000},t=>browserCase(t,async({page,app})=>{
 app.seed('equal-language',{state:'done'},[record('尺寸測試')]);
 await page.addInitScript(language=>{localStorage.setItem('duck-meeting:ui-language',language);localStorage.setItem('duck-meeting:theme','dark');},language);
 await page.goto(app.url+'/?id=equal-language&secondary=none');await page.getByRole('heading',{level:1}).waitFor();
 const sizes=await page.evaluate(()=>{const a=document.getElementById('primary-lang').getBoundingClientRect(),b=document.getElementById('secondary-lang').getBoundingClientRect();return {a:a.width,b:b.width,topA:a.top,topB:b.top,right:b.right,viewport:innerWidth};});
 assert.ok(Math.abs(sizes.a-sizes.b)<=1&&Math.abs(sizes.topA-sizes.topB)<=1&&sizes.right<=sizes.viewport,JSON.stringify(sizes));
},{viewport:{width,height:930}}));
