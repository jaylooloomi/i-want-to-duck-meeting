import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fixture} from './harness.js';

test('FLOW-API stop is exact scoped, origin protected, rejects terminal/finalizing sessions',async()=>{
  const app=await fixture();
  try {
    const dir=app.seed('active',{pid:process.pid});
    const done=app.seed('done',{state:'done',pid:process.pid});
    const finalizing=app.seed('finalizing',{state:'transcribing',pid:process.pid});
    const post=(id,origin=app.url)=>fetch(app.url+'/api/meetings/action',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({id,action:'stop'})});
    assert.equal((await post('active','https://untrusted.example')).status,403);
    assert.equal(fs.existsSync(path.join(dir,'STOP')),false);
    assert.equal((await post('missing')).status,404);
    assert.equal((await post('done')).status,409);
    assert.equal((await post('finalizing')).status,409);
    assert.equal((await post('active')).status,200);
    assert.equal(fs.existsSync(path.join(dir,'STOP')),true);
    assert.equal(fs.existsSync(path.join(done,'STOP')),false);
    assert.equal(fs.existsSync(path.join(finalizing,'STOP')),false);
  } finally {await app.close();}
});
