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

for(const width of [1280,390])test(`SIDEBAR-02 platform icons retain identities in light and dark ${width}`,{timeout:30000},t=>browserCase(t,async({page,app,dir})=>{
 const cases=[['google',{url:'https://meet.google.com/abc-defg-hij'},'meet','Google Meet'],['teams',{source:'teams',url:'https://teams.live.com/meet/123?p=private'},'teams','Microsoft Teams'],['legacy',{source:null,code:'abc-defg-hij'},'meet','Google Meet'],['mic',{source:'microphone'},'microphone','本機麥克風'],['desktop',{source:'teams'},'desktop','電腦雙路錄音'],['unknown',{source:null,url:'https://meet.google.com.evil.example'},'unknown','會議（類型未確認）']];
 for(const [id,status] of cases)app.seed(id,{state:'done',title:id,...status});
 const response=await fetch(app.url+'/api/meetings');const payload=await response.json();
 const rows=Array.isArray(payload)?payload:payload.meetings;
 for(const [id,,kind] of cases){const item=rows.find(x=>x.id===id);assert.equal(item.platform,kind);assert.equal('url' in item,false);}
 await page.goto(app.url);
 const sidebar=page.getByRole('complementary',{name:'歷史會議清單'});
 for(const mode of ['light','dark']){
  if(mode==='dark')await page.getByRole('button',{name:'深色模式',exact:true}).click();
  for(const [id,,,label] of cases){const card=sidebar.getByRole('button',{name:new RegExp(id)}).filter({has:page.getByRole('img',{name:label,exact:true})});await card.waitFor({state:'visible'});const box=await card.getByRole('img',{name:label,exact:true}).boundingBox();assert.ok(box.width>=20&&box.height>=20);await card.getByRole('img',{name:label,exact:true}).click();}
  await page.screenshot({path:dir+'/'+mode+'.png'});
 }
},{viewport:{width,height:844}}));

for(const width of [1280,390])test(`SIDEBAR-03 segmented categories switch with keyboard and both themes ${width}`,{timeout:25000},t=>browserCase(t,async({page,app,dir})=>{
 app.seed('active-card',{state:'done',title:'展示會議'});app.seed('archived-card',{state:'archived',title:'展示封存'});
 await page.goto(app.url);
 const group=page.getByRole('group',{name:'會議篩選'}),active=group.getByRole('button',{name:'進行與完成',exact:true}),archived=group.getByRole('button',{name:/已封存/});
 for(const theme of ['light','dark']){
  if(theme==='dark')await page.getByRole('button',{name:'深色模式',exact:true}).click();
  await active.click();assert.equal(await active.getAttribute('aria-pressed'),'true');
  const a=await active.boundingBox(),b=await archived.boundingBox();assert.ok(Math.abs(a.y-b.y)<2);assert.ok(a.width>=80&&b.width>=80);
  await archived.focus();await page.keyboard.press('Enter');assert.equal(await archived.getAttribute('aria-pressed'),'true');assert.equal(await active.getAttribute('aria-pressed'),'false');
  await page.getByRole('complementary',{name:'歷史會議清單'}).getByRole('button',{name:/展示封存/}).waitFor({state:'visible'});
  await page.screenshot({path:dir+'/'+theme+'.png'});
  await active.click();await page.getByRole('complementary',{name:'歷史會議清單'}).getByRole('button',{name:/展示會議/}).waitFor({state:'visible'});
 }
},{viewport:{width,height:844}}));


test('SIDEBAR-04 meeting link labels follow platform and stale links are cleared',{timeout:30000},t=>browserCase(t,async({page,app})=>{
 const cases=[['meet',{url:'https://meet.google.com/abc-defg-hij'},'進入 Meet ↗'],['teams',{url:'https://teams.live.com/meet/123?p=demo'},'進入 Teams ↗'],['teams-work',{url:'https://teams.microsoft.com/l/meetup-join/demo'},'進入 Teams ↗'],['teams-cloud',{recordingUrl:'https://teams.cloud.microsoft/meet/123'},'進入 Teams ↗'],['local',{},null],['spoof',{url:'https://meet.google.com.evil.example/test'},null],['credentials',{url:'https://user:password@meet.google.com/test'},null],['http',{url:'http://teams.live.com/meet/123'},null]];
 for(const [id,status] of cases)app.seed(id,{state:'done',title:id,...status});
 await page.goto(app.url+'/?id=meet&secondary=none');
 for(const [id,status,label] of cases){
  if(id!=='meet')await page.getByRole('complementary',{name:'歷史會議清單'}).getByTitle(id+' · '+id,{exact:true}).getByRole('img').click();
  await page.getByRole('heading',{name:id,exact:true,level:1}).waitFor();await page.getByLabel('會議更多操作').click();
  if(label){const link=page.getByRole('link',{name:label,exact:true});await link.waitFor();assert.equal(await link.getAttribute('href'),status.url||status.recordingUrl);}else assert.equal(await page.getByRole('link',{name:/進入 (Meet|Teams)/}).count(),0);
  await page.getByLabel('會議更多操作').click();
 }
}));
