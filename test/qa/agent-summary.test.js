import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {browserCase,record} from './harness.js';
import {requestAgentSummary} from '../../src/agent-summary.js';
import {writeStatus} from '../../src/status.js';

test('AGENT-01 waiting handoff is visible without pretend progress; actual agent notes appear',{timeout:20000},t=>browserCase(t,async({page,app})=>{
  const dir=app.seed('agent-summary',{state:'done'},[record('待核對的會議內容')]);requestAgentSummary(dir);
  await page.goto(app.url+'/?id=agent-summary');
  await page.getByText('等待 Codex／Claude 接手',{exact:true}).waitFor();
  assert.equal(await page.getByText('正在整理中',{exact:true}).isVisible(),false);
  fs.writeFileSync(path.join(dir,'summary.md'),'## Agent 實際整理成果\n\n已根據原文確認，無指定待辦。');
  writeStatus(dir,{summaryJob:{state:'ready',provider:'agent'}});
  await page.getByText('Agent 實際整理成果',{exact:true}).waitFor();
  await page.getByText('已完成整理',{exact:true}).waitFor();
}));
