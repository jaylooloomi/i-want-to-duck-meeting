import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {actionItems,setActionItem,storageInfo} from '../../src/workspace-actions.js';

const markdown='# Test\n\n## 重要決議\n\n1. Keep originals\n\n## 行動方案\n\n| 事項 | 負責人 | 期限 |\n| --- | --- | --- |\n| Review \\| sample | Emma | 未指定 |\n| Review \\| sample | Emma | 未指定 |\n';
test('action overlay persists exact duplicate rows independently without rewriting notes',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duck-actions-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.writeFileSync(path.join(dir,'summary.md'),markdown);const before=actionItems(dir,markdown);
 assert.equal(before.items.length,2);assert.equal(before.items[0].text,'Review | sample');assert.notEqual(before.items[0].key,before.items[1].key);
 const first=setActionItem(dir,markdown,{key:before.items[0].key,revision:before.revision,completed:true});
 assert.equal(first.items[0].completed,true);assert.equal(first.items[1].completed,false);
 assert.equal(actionItems(dir,markdown).items[0].completed,true);assert.equal(fs.readFileSync(path.join(dir,'summary.md'),'utf8'),markdown);
 const reset=setActionItem(dir,markdown,{key:first.items[0].key,revision:first.revision,completed:false});assert.equal(reset.items[0].completed,false);
 assert.throws(()=>setActionItem(dir,markdown,{revision:first.revision,key:'forged',completed:true}),/找不到/);
 assert.throws(()=>setActionItem(dir,markdown+'revision',{revision:first.revision,key:first.items[0].key,completed:true}),/已更新/);
 assert.throws(()=>setActionItem(dir,markdown,{revision:first.revision,key:first.items[0].key,completed:'true'}),/布林/);
 fs.writeFileSync(path.join(dir,'action-items.json'),'null');assert.equal(actionItems(dir,markdown).items[0].completed,false);
 assert.equal(actionItems(dir,markdown.replace('## 行動方案','## 行動方案\n\n### 本週')).items.length,2);
 assert.deepEqual(actionItems(dir,'## 會議摘要\n\n| 事項 | 負責人 |\n| --- | --- |\n| Not an action | Someone |').items,[]);
});
test('storage totals use actual local file bytes and do not follow links',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duck-storage-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.mkdirSync(path.join(dir,'nested'));fs.writeFileSync(path.join(dir,'one'),Buffer.alloc(123));fs.writeFileSync(path.join(dir,'nested','two'),Buffer.alloc(456));
 const external=fs.mkdtempSync(path.join(os.tmpdir(),'duck-storage-outside-'));t.after(()=>fs.rmSync(external,{recursive:true,force:true}));fs.writeFileSync(path.join(external,'not-counted'),Buffer.alloc(999));fs.symlinkSync(external,path.join(dir,'outside-link'),process.platform==='win32'?'junction':'dir');
 const info=storageInfo(dir);assert.equal(info.usedBytes,579);assert.equal(info.files,2);assert.equal(info.partial,false);assert.ok(info.availableBytes>=0);assert.ok(info.totalBytes>=info.availableBytes);
});
