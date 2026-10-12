/** Test the actual host helper source with Node's built-in TypeScript stripper. */
import {readFile,writeFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const report={checkedAt:new Date().toISOString(),hosts:[]};
for(const host of ['hub','diriqo']){
 const source=await readFile(`integrations/${host}/app/office/OfficeClient.tsx`,'utf8');
 const helper=source.slice(source.indexOf('async function fileResponse<'),source.indexOf('export default function OfficeClient'));
 assert.ok(helper.startsWith('async function fileResponse<'));
 const fn=vm.runInNewContext(stripTypeScriptTypes(helper)+'\nfileResponse',{},{timeout:1000});
 const json=(body,status=200,type='application/json')=>new Response(body,{status,headers:{'content-type':type}});
 assert.equal((await fn(json('{"ok":true}'))).ok,true);
 assert.equal((await fn(json('{"ok":true}',200,'application/problem+json'))).ok,true);
 await assert.rejects(()=>fn(json('{}',401)),/OFFICE_UNAUTHENTICATED/);
 const redirect=json('<html>Sign in</html>',200,'text/html');Object.defineProperty(redirect,'redirected',{value:true});
 await assert.rejects(()=>fn(redirect),/OFFICE_UNAUTHENTICATED/);
 await assert.rejects(()=>fn(json('gateway',502,'text/html')),/OFFICE_INVALID_RESPONSE/);
 await assert.rejects(()=>fn(json('{"error":"OFFICE_FORMAT: File exceeds limit"}',400)),/OFFICE_FORMAT: File exceeds limit/);
 await assert.rejects(()=>fn(json('{')),/OFFICE_INVALID_RESPONSE/);
 await assert.rejects(()=>fn(json('null')),/OFFICE_INVALID_RESPONSE/);
 report.hosts.push({host,status:'PASS',assertions:8});
}
await writeFile('reports/host-transport.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
