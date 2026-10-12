import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';
import {transformSync} from 'esbuild';
import {getOfficeMessages} from '../src/client/locales.ts';
import {blankDocument} from '../src/core/templates.ts';

// Exercise the actual workspace handlers with deterministic hooks, timers and RPCs.
// This is not a browser/focus-trap simulation; native dialog keyboard proof is separate.
const code=transformSync(readFileSync(new URL('../src/client/OfficeWorkspace.tsx',import.meta.url),'utf8'),
 {loader:'tsx',format:'cjs',jsx:'transform',target:'es2022'}).code;
const text=node=>node==null||typeof node==='boolean'?'':Array.isArray(node)?node.map(text).join(''):typeof node==='object'?text(node.children):String(node);
function nodes(tree,predicate){const result=[];const visit=node=>{if(Array.isArray(node)){node.forEach(visit);return;}if(!node||typeof node!=='object')return;if(predicate(node))result.push(node);visit(node.children);};visit(tree);return result;}
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const content=value=>({...blankDocument(),doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:value}]}]}});

async function workspace(options={}){
 const slots=[],effects=[],timers=new Map(),elementRefs=new WeakMap(),trace=[];
 let cursor=0,dirty=true,tree,focused=null,timerId=0,restoreHook=options.restoreHook;
 const document=new EventTarget(),window=new EventTarget();const opener={isConnected:true,focus(){focused=opener;}};document.activeElement=opener;
 window.confirm=()=>{throw Error('A native confirm must not be used for restore');};
 const historical=content('Original version');
 let serverFile={id:'10000000-0000-4000-8000-000000000001',tenantId:'20000000-0000-4000-8000-000000000001',ownerId:'30000000-0000-4000-8000-000000000001',title:'Office restore example',kind:'document',revision:3,content:content('Current version'),parentId:null,updatedAt:'2026-10-11T10:00:00Z',createdAt:'2026-10-11T09:00:00Z'};
 serverFile={...serverFile,...options.file};
 const responses=new Map();
 async function applyRestore(body){
  if(responses.has(body.idempotencyKey))return structuredClone(responses.get(body.idempotencyKey));
  if(body.expectedRevision!==serverFile.revision)throw Object.assign(Error('REVISION_CONFLICT'),{status:409});
  serverFile={...serverFile,revision:serverFile.revision+1,content:structuredClone(historical)};
  const response={file:structuredClone(serverFile)};responses.set(body.idempotencyKey,response);return structuredClone(response);
 }
 async function respond(body){
  switch(body.op){
   case 'listFiles':return {files:[structuredClone(serverFile)],nextCursor:null};
   case 'read':return {file:structuredClone(serverFile)};
   case 'permissions':return {permissions:options.permissions??{role:'owner',ownerId:serverFile.ownerId,canWrite:true,canDelete:true}};
   case 'listVersions':return {versionSummaries:[1,2,3].map(revision=>({revision,createdAt:'2026-10-11T09:00:00Z'}))};
   case 'listProposals':return {proposalSummaries:[{id:'40000000-0000-4000-8000-000000000001',fileId:serverFile.id,baseRevision:3,status:'pending',summary:'Reviewed change',createdAt:serverFile.updatedAt}]};
   case 'readProposal':return {proposal:{id:'40000000-0000-4000-8000-000000000001',fileId:serverFile.id,baseRevision:3,status:'pending',summary:'Reviewed change',content:content('Approved proposal'),createdAt:serverFile.updatedAt}};
   case 'approve':assert.equal(body.expectedRevision,serverFile.revision);serverFile={...serverFile,content:content('Approved proposal'),revision:serverFile.revision+1};return {file:structuredClone(serverFile)};
   case 'save':assert.equal(body.expectedRevision,serverFile.revision);serverFile={...serverFile,content:structuredClone(body.content),revision:serverFile.revision+1};return {file:structuredClone(serverFile)};
   case 'restore':return restoreHook?restoreHook(body,applyRestore):applyRestore(body);
   default:throw Error('Unexpected RPC '+body.op);
  }
 }
 const transport={async request(body){trace.push(structuredClone(body));return options.requestHook?options.requestHook(body,respond):respond(body);}};
 let props={transport,locale:'en',...options.props};
 const React={
  createElement(type,attributes,...children){return {type,props:attributes??{},children};},Fragment:Symbol('Fragment'),Suspense:Symbol('Suspense'),lazy:()=>Symbol('Editor'),
  useState(initial){const index=cursor++;if(!slots[index])slots[index]={value:typeof initial==='function'?initial():initial};return [slots[index].value,value=>{const next=typeof value==='function'?value(slots[index].value):value;if(!Object.is(next,slots[index].value)){slots[index].value=next;dirty=true;}}];},
  useRef(initial){const index=cursor++;if(!slots[index])slots[index]={current:initial};return slots[index];},
  useId(){const index=cursor++;return 'restore-test-'+index;},
  useEffect(effect,deps){const index=cursor++,previous=slots[index];if(!previous||deps.some((dep,i)=>!Object.is(dep,previous.deps[i]))){slots[index]={deps,cleanup:previous?.cleanup};effects.push(()=>{slots[index].cleanup?.();slots[index].cleanup=effect();});}}
 };
 const module={exports:{}};
 runInNewContext(code,{module,exports:module.exports,require(name){if(name==='react')return React;if(name==='./locales')return {getOfficeMessages};if(name==='./SharingDialog')return {SharingDialog:Symbol('SharingDialog')};if(name==='../core/templates')return {OFFICE_TEMPLATES:[]};throw Error('Unexpected dependency '+name);},structuredClone,crypto:{randomUUID},document,window,navigator:{onLine:true},Event,Intl,Date,console,
  requestAnimationFrame:fn=>queueMicrotask(fn),setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id)});
 function render(){
  if(!dirty)return;dirty=false;cursor=0;tree=module.exports.OfficeWorkspace(props);
  for(const node of nodes(tree,node=>node.props.ref)){
   const ref=node.props.ref;let element=elementRefs.get(ref);
   if(!element){element={open:false,focus(){focused=element;},showModal(){this.open=true;},close(){this.open=false;}};elementRefs.set(ref,element);}ref.current=element;
  }
  while(effects.length)effects.shift()();
 }
 async function settle(){for(let i=0;i<100;i++){await Promise.resolve();render();}}
 async function fireTimers(delay){for(const [id,timer]of [...timers])if(timer.delay===delay){timers.delete(id);timer.fn();}await settle();}
 const find=(predicate,root=tree)=>nodes(root,predicate);
 const button=(label,root=tree)=>{const matches=find(n=>n.type==='button'&&text(n)===label,root);assert.equal(matches.length,1,'Expected one button '+label);return matches[0];};
 async function click(node){assert.equal(Boolean(node.props.disabled),false,'Button must be enabled');node.props.onClick?.();await settle();}
 const dialog=()=>find(n=>n.type==='dialog')[0];
 const editor=()=>find(n=>n.props.onChange&&n.props.content)[0];
 async function history(){await click(button('Version history'));}
 async function begin(){const row=find(n=>n.props.className==='office-version')[0];await click(button('Restore',row));assert.ok(dialog());}
 async function submit(form=find(n=>n.type==='form',dialog())[0]){form.props.onSubmit({preventDefault(){}});await settle();}
 render();await fireTimers(180);if(!options.startInList){await click(find(n=>n.props.className==='office-file-name')[0]);await history();}
 return {trace,transport,document,dialog,editor,button,find,click,begin,submit,settle,fireTimers,
  get file(){return serverFile;},get tree(){return tree;},get focused(){return focused;},opener,
  mutateServer(){serverFile={...serverFile,revision:serverFile.revision+1};},
  async update(next){props={...props,...next};dirty=true;await settle();},
  pending(){const event=new Event('diriqo-office-pending-cell');Object.defineProperty(event,'detail',{value:{pending:true}});document.dispatchEvent(event);},
  writes(){return trace.filter(item=>['save','restore'].includes(item.op));}
 };
}

test('restore opens a named, described DOM dialog; cancel preserves content and writes nothing',async()=>{
 const app=await workspace();await app.begin();const dialog=app.dialog();
 assert.equal(dialog.props['aria-modal'],'true');assert.equal(dialog.props.ref.current.open,true);
 assert.equal(app.focused,app.button('Cancel',dialog).props.ref.current);
 assert.ok(app.find(n=>n.props.id===dialog.props['aria-labelledby'],dialog).length);
 assert.match(text(app.find(n=>n.props.id===dialog.props['aria-describedby'],dialog)[0]),/current version remains in history/);
 assert.match(text(dialog),/Office restore example/);assert.match(text(dialog),/rev\. 3 → 1/);
 assert.ok(app.find(n=>n.props.inert===true).length);assert.equal(app.writes().length,0);
 await app.click(app.button('Cancel',dialog));assert.equal(app.dialog(),undefined);assert.equal(app.writes().length,0);assert.equal(app.file.revision,3);assert.equal(app.focused,app.opener);
});

test('Escape cancels the dialog without any restore or phantom save',async()=>{
 const app=await workspace();await app.begin();let prevented=false;
 app.dialog().props.onCancel({preventDefault(){prevented=true;}});await app.settle();await app.fireTimers(900);
 assert.equal(prevented,true);assert.equal(app.dialog(),undefined);assert.equal(app.writes().length,0);
});

test('confirmation restores exactly the pinned revision and remount does not produce a phantom save',async()=>{
 const app=await workspace();await app.begin();await app.submit();
 assert.equal(app.dialog(),undefined);assert.equal(app.file.revision,4);assert.match(JSON.stringify(app.editor().props.content),/Original version/);
 assert.deepEqual(app.writes().map(({op,expectedRevision,revision})=>({op,expectedRevision,revision})),[{op:'restore',expectedRevision:3,revision:1}]);
 app.editor().props.onChange(structuredClone(app.editor().props.content));await app.settle();await app.fireTimers(900);
 assert.equal(app.writes().length,1,'An unchanged newly mounted editor must not save');
});

test('real unsaved content is saved before asking; confirmation uses that resulting revision',async()=>{
 const app=await workspace();app.editor().props.onChange(content('Unsaved work'));await app.settle();await app.begin();
 assert.deepEqual(app.writes().map(item=>item.op),['save']);assert.match(JSON.stringify(app.writes()[0].content),/Unsaved work/);
 assert.match(text(app.dialog()),/rev\. 4 → 1/);await app.submit();
 assert.equal(app.writes()[1].expectedRevision,4);assert.equal(app.file.revision,5);
});

test('editing or a pending spreadsheet input invalidates even a retained old confirm handler',async()=>{
 for(const pending of [false,true]){
  const app=await workspace();await app.begin();const form=app.find(n=>n.type==='form',app.dialog())[0];
  if(pending)app.pending();else app.editor().props.onChange(content('New local work'));
  await app.settle();assert.equal(app.dialog(),undefined);await app.submit(form);
  assert.equal(app.writes().length,0);assert.match(text(app.tree),/document changed/);
 }
});

test('transport or write-permission change invalidates the confirmation before any mutation',async()=>{
 for(const next of [{readOnly:true},{transport:{request(){throw Error('The replacement tenant transport must not be called');}}}]){
  const app=await workspace();await app.begin();const form=app.find(n=>n.type==='form',app.dialog())[0];
  await app.update(next);assert.equal(app.dialog(),undefined);await app.submit(form);assert.equal(app.writes().length,0);
 }
});

test('leaving the document invalidates a retained confirmation handler',async()=>{
 const app=await workspace();await app.begin();const form=app.find(n=>n.type==='form',app.dialog())[0];
 // A queued navigation handler can run independently of browser background inertness.
 await app.click(app.button('← Back to files'));assert.equal(app.dialog(),undefined);assert.equal(app.editor(),undefined);
 await app.submit(form);assert.equal(app.writes().length,0);
});

test('captured cell content changing during confirm cannot advance CAS or overwrite that edit',async()=>{
 const app=await workspace();await app.begin();
 app.document.addEventListener('diriqo-office-commit',()=>app.editor().props.onChange(content('Committed cell')), {once:true});
 await app.submit();assert.equal(app.dialog(),undefined);assert.equal(app.writes().length,0);
 assert.match(JSON.stringify(app.editor().props.content),/Committed cell/);
});

test('server revision conflict closes confirmation and preserves the current local content',async()=>{
 const app=await workspace();await app.begin();app.mutateServer();await app.submit();
 assert.equal(app.dialog(),undefined);assert.equal(app.writes().length,1);assert.equal(app.writes()[0].expectedRevision,3);
 assert.match(text(app.tree),/A newer version exists/);assert.match(JSON.stringify(app.editor().props.content),/Current version/);
});

test('unknown network outcome can retry with the same idempotency key without another version',async()=>{
 let first=true;const app=await workspace({async restoreHook(body,apply){const result=await apply(body);if(first){first=false;throw Error('network');}return result;}});
 await app.begin();await app.submit();assert.ok(app.dialog());assert.ok(app.find(n=>n.props.role==='alert',app.dialog()).length);
 await app.submit();assert.equal(app.file.revision,4);assert.equal(app.dialog(),undefined);
 const calls=app.writes();assert.equal(calls.length,2);assert.equal(calls[0].idempotencyKey,calls[1].idempotencyKey);
});

test('double submit sends one RPC and a late result never replaces subsequently changed local content',async()=>{
 const gate=deferred();const app=await workspace({async restoreHook(body,apply){await gate.promise;return apply(body);}});
 await app.begin();const form=app.find(n=>n.type==='form',app.dialog())[0];await app.submit(form);await app.submit(form);
 assert.equal(app.writes().length,1);let prevented=false;app.dialog().props.onCancel({preventDefault(){prevented=true;}});await app.settle();assert.equal(prevented,true);assert.ok(app.dialog(),'Cannot dismiss an operation in flight');
 app.editor().props.onChange(content('Keep later local work'));await app.settle();gate.resolve();await app.settle();
 assert.equal(app.dialog(),undefined);assert.equal(app.writes().length,1);assert.match(JSON.stringify(app.editor().props.content),/Keep later local work/);
});

test('restore invalidation message is available in all supported UI languages',()=>{
 for(const locale of ['cs','sk','en','de','pl','tr','sq'])assert.ok(getOfficeMessages(locale).restoreChanged.trim());
});

test('approval installs the bounded file-only host response without a redundant proposal or phantom save',async()=>{
 const app=await workspace();await app.click(app.button('Diriqent proposals'));assert.equal(app.button('Approve and save').props.disabled,true);await app.click(app.button('View changes'));await app.click(app.button('Approve and save'));
 assert.equal(app.file.revision,4);assert.match(JSON.stringify(app.editor().props.content),/Approved proposal/);
 const approval=app.trace.filter(item=>item.op==='approve');assert.equal(approval.length,1);assert.equal(approval[0].expectedRevision,3);
 app.editor().props.onChange(structuredClone(app.editor().props.content));await app.settle();await app.fireTimers(900);
 assert.equal(app.writes().length,0,'Installing the approval result must not create a second revision');
});

test('a delayed folder-picker response cannot replace a newer modal folder page',async()=>{
 const old=deferred();let requests=0;
 const app=await workspace({startInList:true,requestHook(body,respond){if(body.op==='listFiles'&&body.foldersOnly){requests++;return requests===1?old.promise:{files:[{id:'new-folder',kind:'folder',title:'CURRENT FOLDER'}],nextCursor:null};}return respond(body);}});
 await app.click(app.button('Move'));await app.click(app.button('Cancel'));await app.click(app.button('Move'));
 assert.match(text(app.tree),/CURRENT FOLDER/);
 old.resolve({files:[{id:'old-folder',kind:'folder',title:'STALE FOLDER'}],nextCursor:'old-cursor'});await app.settle();
 assert.match(text(app.tree),/CURRENT FOLDER/);assert.doesNotMatch(text(app.tree),/STALE FOLDER/);
 assert.equal(app.find(n=>n.type==='button'&&text(n)==='Load more').length,0);
});

test('late load-more results do not append files into a changed search',async()=>{
 const old=deferred();const app=await workspace({startInList:true,async requestHook(body,respond){if(body.op!=='listFiles')return respond(body);if(body.afterId)return old.promise;const result=await respond(body);return body.query==='different'?{files:[{...result.files[0],id:'new-result',title:'CURRENT SEARCH RESULT'}],nextCursor:null}:{...result,nextCursor:'first-page'};}});
 await app.click(app.button('Load more'));
 app.find(n=>n.type==='input'&&n.props.type==='search')[0].props.onChange({target:{value:'different'}});await app.settle();await app.fireTimers(180);
 old.resolve({files:[{id:'old-page',title:'STALE PAGE',kind:'document',updatedAt:'2026-10-11T12:00:00Z'}],nextCursor:'stale-cursor'});await app.settle();
 assert.match(text(app.tree),/CURRENT SEARCH RESULT/);assert.doesNotMatch(text(app.tree),/STALE PAGE/);
 assert.equal(app.find(n=>n.type==='button'&&text(n)==='Load more').length,0);
});

test('loading a second history page makes that older version available for reviewed restore',async()=>{
 const app=await workspace({requestHook(body,respond){if(body.op==='listVersions')return body.beforeRevision?{versionSummaries:[{revision:1,createdAt:'2026-10-11T09:00:00Z'}],nextCursor:null}:{versionSummaries:[{revision:3,createdAt:'2026-10-11T10:00:00Z'},{revision:2,createdAt:'2026-10-11T09:00:00Z'}],nextCursor:'2'};return respond(body);}});
 await app.click(app.button('Load more'));const rows=app.find(n=>n.props.className==='office-version');assert.equal(rows.length,3);
 await app.click(app.button('Restore',rows[2]));await app.submit();
 assert.equal(app.writes()[0].op,'restore');assert.equal(app.writes()[0].revision,1);assert.equal(app.file.revision,4);
 assert.match(JSON.stringify(app.editor().props.content),/Original version/);
});

test('context errors display the localized explanation supplied by the host',async()=>{
 const app=await workspace({startInList:true,requestHook(){throw Object.assign(Error('OFFICE_TENANT_CHANGED'),{userMessage:'Aktivní firma se změnila. Obsah zůstává v původní firmě.'});}});
 assert.match(text(app.tree),/Aktivní firma se změnila/);assert.doesNotMatch(text(app.tree),/OFFICE_TENANT_CHANGED/);
});

test('a shared editor may save its document without gaining create, copy, upload or delete access',async()=>{
 const app=await workspace({startInList:true,props:{canCreate:false},file:{access:{canWrite:true,canDelete:false,canShare:false}},permissions:{role:'editor',ownerId:'other-author',canWrite:true,canDelete:false}});
 const tiles=app.find(node=>node.props.className==='office-create-grid')[0];
 assert.equal(app.find(node=>node.type==='button',tiles).every(node=>node.props.disabled),true);
 assert.equal(app.button('＋ New folder').props.disabled,true);
 assert.equal(app.find(node=>node.type==='button'&&text(node)===getOfficeMessages('en').copy).length,0);
 assert.equal(app.find(node=>node.type==='button'&&text(node)==='Delete').length,0);
 assert.equal(app.button('Rename').props.disabled,false);
 await app.click(app.find(node=>node.props.className==='office-file-name')[0]);
 assert.equal(app.editor().props.readOnly,false);assert.equal(app.button(getOfficeMessages('en').copy).props.disabled,true);
 app.editor().props.onChange(content('Shared editor work'));await app.settle();await app.click(app.button('Save'));
 assert.equal(app.file.revision,4);assert.match(JSON.stringify(app.file.content),/Shared editor work/);
 assert.deepEqual(app.writes().map(item=>item.op),['save']);
});

test('a file shared as reader keeps editing controls disabled even when creation is separately allowed',async()=>{
 const app=await workspace({startInList:true,props:{canCreate:true},file:{access:{canWrite:false,canDelete:false,canShare:false}},permissions:{role:'reader',ownerId:'other-author',canWrite:false,canDelete:false}});
 assert.equal(app.button('＋ New folder').props.disabled,false);
 for(const label of ['Rename','Move','Delete'])assert.equal(app.find(node=>node.type==='button'&&text(node)===label).length,0,label);
 await app.click(app.find(node=>node.props.className==='office-file-name')[0]);
 assert.equal(app.editor().props.readOnly,true);assert.equal(app.button('Save').props.disabled,true);assert.equal(app.button('Rename').props.disabled,true);assert.equal(app.writes().length,0);
});

test('global read-only overrides a create capability and per-file editor permission',async()=>{
 const app=await workspace({startInList:true,props:{readOnly:true,canCreate:true},file:{access:{canWrite:true,canDelete:true,canShare:false}}});
 assert.equal(app.button('＋ New folder').props.disabled,true);
 await app.click(app.find(node=>node.props.className==='office-file-name')[0]);
 assert.equal(app.editor().props.readOnly,true);assert.equal(app.button('Save').props.disabled,true);assert.equal(app.button(getOfficeMessages('en').copy).props.disabled,true);assert.equal(app.writes().length,0);
});

test('save error recovery does not expose copying to a shared editor without create access',async()=>{
 const app=await workspace({props:{canCreate:false},permissions:{role:'editor',ownerId:'other-author',canWrite:true,canDelete:false},requestHook(body,respond){if(body.op==='save')throw Error('network');return respond(body);}});
 app.editor().props.onChange(content('Keep local work'));await app.settle();await app.click(app.button('Save'));
 const copies=app.find(node=>node.type==='button'&&text(node)===getOfficeMessages('en').copy);assert.equal(copies.length,2);assert.equal(copies.every(node=>node.props.disabled),true);
 assert.match(JSON.stringify(app.editor().props.content),/Keep local work/);assert.equal(app.file.revision,3);
});
