import {test} from 'node:test';
import assert from 'node:assert/strict';
import {browserCase} from './harness.js';
import {getCaptionLanguage,setCaptionLanguage} from '../../src/meet/incall.js';
import {configureTeamsPage} from '../../src/teams-browser.js';

for(const [code,label] of [['de-DE','German'],['ja-JP','Japanese'],['ko-KR','Korean']])for(const dataValue of [true,false])test(`LANG Meet ${code} ${dataValue?'data code':'label fallback'} verified readback`,{timeout:20000},t=>browserCase(t,async({page})=>{
 const html=`<button id="language-combo" role="combobox" aria-label="Meeting language" aria-controls="languages" onclick="document.getElementById('languages').hidden=false">English</button><ul role="listbox" id="languages" hidden><li role="option" ${dataValue?'data-value="'+code+'"':''} onclick="document.getElementById('language-combo').textContent=this.textContent;this.setAttribute('aria-selected','true');this.parentElement.hidden=true">${label}</li></ul>`;
 await page.setContent(html);assert.equal(await setCaptionLanguage(page,code),true);assert.equal(await getCaptionLanguage(page),code);assert.equal(await setCaptionLanguage(page,code),true);
}));

for(const [code,label] of [['de-DE','German (Germany)'],['ja-JP','Japanese (Japan)'],['ko-KR','Korean (Korea)']])test(`LANG Teams ${code} selects requested language and verifies`,{timeout:15000},t=>browserCase(t,async({page})=>{
 await page.route('https://teams.live.com/meet/language-fixture',route=>route.fulfill({contentType:'text/html',body:`<button>Leave</button><div data-tid="closed-caption-text">Fixture captions</div><button data-tid="closed-captions-settings-menu-trigger-button">Caption settings</button><select aria-label="Meeting spoken language"><option>中文（台灣）</option><option>${label}</option></select><button onclick="window.updated=true">Update</button>`}));
 await page.goto('https://teams.live.com/meet/language-fixture');assert.equal(await configureTeamsPage(page,{language:code}),'in_call');assert.equal(await page.getByRole('combobox',{name:'Meeting spoken language'}).inputValue(),label);assert.equal(await page.evaluate(()=>window.updated),true);assert.equal(page.__omCaptionLanguage,code.split('-')[0]);
}));

test('LANG Teams missing update/permission never claims selected language or stops transcription',{timeout:15000},t=>browserCase(t,async({page})=>{
 await page.route('https://teams.live.com/meet/language-fixture',route=>route.fulfill({contentType:'text/html',body:'<button>Leave</button><div data-tid="closed-caption-text">Fixture captions</div><button data-tid="closed-captions-settings-menu-trigger-button">Caption settings</button><select aria-label="Meeting spoken language"><option>中文（台灣）</option><option>German (Germany)</option></select><button onclick="window.stopped=true">Stop transcription</button>'}));
 await page.goto('https://teams.live.com/meet/language-fixture');assert.equal(await configureTeamsPage(page,{language:'de-DE'}),'in_call');assert.equal(page.__omCaptionLanguage,undefined);assert.equal(await page.evaluate(()=>window.stopped),undefined);
}));
test('LANG Teams custom dropdown German selection is read back',{timeout:15000},t=>browserCase(t,async({page})=>{
 await page.route('https://teams.live.com/meet/language-fixture',route=>route.fulfill({contentType:'text/html',body:`<button>Leave</button><div data-tid="closed-caption-text">Fixture captions</div><button data-tid="closed-captions-settings-menu-trigger-button">Caption settings</button><button id="language-combo" role="combobox" aria-label="Meeting spoken language" onclick="document.getElementById('languages').hidden=false">中文（台灣）</button><ul id="languages" role="listbox" hidden><li role="option" onclick="document.getElementById('language-combo').textContent=this.textContent;this.parentElement.hidden=true">German (Germany)</li></ul><button>Update</button>`}));
 await page.goto('https://teams.live.com/meet/language-fixture');await configureTeamsPage(page,{language:'de-DE'});assert.equal(page.__omCaptionLanguage,'de');
}));
