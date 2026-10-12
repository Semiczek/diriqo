import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {inspectHostTestSources} from '../scripts/test-hosts.mjs';

// Inert filesystem/Git ports prove the standalone suite needs no host checkout.
function ports({missing,symlink,wrongTop=false}={}){
 const workspace=resolve('virtual-office-workspace'),calls=[];
 const fs={
  async lstat(path){
   calls.push(path);if(missing&&path.endsWith(missing))throw Object.assign(new Error('missing'),{code:'ENOENT'});
   const directory=path===resolve(workspace,'integrations/hub')||path===resolve(workspace,'integrations/diriqo');
   return {isDirectory:()=>directory,isFile:()=>!directory,isSymbolicLink:()=>Boolean(symlink&&path.endsWith(symlink))};
  },
  async realpath(path){return path;}
 };
 const git=(args,cwd)=>args[1]==='HEAD'?'a'.repeat(40):wrongTop?workspace:cwd;
 return {workspace,fs,git,calls};
}
test('standalone host-runner preflight validates both distinct checkouts and required source files',async()=>{
 const setup=ports(),hosts=await inspectHostTestSources(setup);
 assert.deepEqual(hosts.map(x=>[x.host,x.sourceFiles,x.runtimeFiles]),[['hub',14,1],['diriqo',17,1]]);
 assert.equal(setup.calls.length,35);
});
test('missing host checkout or integration patch fails explicitly, never skips',async()=>{
 for(const missing of [resolve('integrations/hub').split(/[/\\]/).slice(-2).join(process.platform==='win32'?'\\':'/'),'context.ts','staging-guard.ts','http-limits.ts','client-context.ts','get-page-static-info.js']){
  await assert.rejects(inspectHostTestSources(ports({missing})),/HOST_TEST_SETUP_REQUIRED/);
 }
});
test('parent repository masquerading as host checkout and symlinked sources are rejected',async()=>{
 await assert.rejects(inspectHostTestSources(ports({wrongTop:true})),/must be its own Git checkout/);
 await assert.rejects(inspectHostTestSources(ports({symlink:'proxy.ts'})),/regular source file/);
});
