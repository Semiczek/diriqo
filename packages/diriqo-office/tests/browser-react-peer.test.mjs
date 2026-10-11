import test from 'node:test';
import assert from 'node:assert/strict';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {browserReactPeerPlugin,assertBrowserEsmPeerEdges} from '../scripts/browser-react-peer.mjs';

const execFileAsync=promisify(execFile);
const root=fileURLToPath(new URL('../',import.meta.url));
const source=`
import React from 'react';
import {useSyncExternalStoreWithSelector} from 'use-sync-external-store/shim/with-selector.js';
const fromCjs=require('react');
if(typeof globalThis.require!=='undefined')throw new Error('Unexpected global require in ESM smoke runtime');
if(fromCjs.useState!==React.useState||fromCjs.useSyncExternalStore!==React.useSyncExternalStore
 ||fromCjs.createContext!==React.createContext||fromCjs.version!==React.version)
 throw new Error('React peer identity was changed');
if(typeof useSyncExternalStoreWithSelector!=='function')throw new Error('Real selector shim did not load');
console.log('REACT_PEER_SMOKE_PASS');
`;
async function compile(useBridge){
 return build({
  stdin:{contents:source,resolveDir:root,sourcefile:'office-react-peer-smoke.js',loader:'js'},
  absWorkingDir:root,bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',
  define:{'process.env.NODE_ENV':'"production"'},metafile:true,logLevel:'silent',
  external:['react','react/*','react-dom','react-dom/*'],
  plugins:useBridge?[browserReactPeerPlugin()]:[]
 });
}
async function execute(code){
 // No filesystem output. Native ESM has no require, like a browser module.
 // Uses the same installed host React peer through normal static module imports.
 return execFileAsync(process.execPath,['--input-type=module','--eval',code],
  {cwd:root,timeout:20000,maxBuffer:1024*1024});
}
test('real CJS selector package reproduces the unbridged browser ESM failure',async()=>{
 const output=await compile(false);
 assert.throws(()=>assertBrowserEsmPeerEdges(output.metafile),/external require-call/);
 await assert.rejects(execute(output.outputFiles[0].text),/Dynamic require of "react" is not supported/);
});
test('static React bridge loads the real selector shim and preserves host hook identity',async()=>{
 const output=await compile(true);
 assert.doesNotThrow(()=>assertBrowserEsmPeerEdges(output.metafile));
 assert.equal(Object.keys(output.metafile.inputs).some(path=>/[\\/]node_modules[\\/]react[\\/]|^node_modules\/react\//.test(path)),false,
  'React implementation must stay external');
 const result=await execute(output.outputFiles[0].text);
 assert.equal(result.stdout.trim(),'REACT_PEER_SMOKE_PASS');
});
test('build guard rejects any newly introduced external require, not only React',()=>{
 assert.throws(()=>assertBrowserEsmPeerEdges({outputs:{'client.js':{imports:[
  {path:'unexpected-peer',external:true,kind:'require-call'}]}}}),/unexpected-peer/);
 assert.doesNotThrow(()=>assertBrowserEsmPeerEdges({outputs:{'client.js':{imports:[
  {path:'react',external:true,kind:'import-statement'}]}}}));
});
