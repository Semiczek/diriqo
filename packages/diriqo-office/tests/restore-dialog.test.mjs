import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';
import {transformSync} from 'esbuild';
import {getOfficeMessages} from '../src/client/locales.ts';
import {blankDocument,blankSpreadsheet} from '../src/core/templates.ts';
import * as officeFormats from '../src/core/formats.ts';
import {isSpreadsheetCachedPreview} from '../src/core/spreadsheet-execution.ts';

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
   case 'rename':assert.equal(body.expectedRevision,serverFile.revision);serverFile={...serverFile,title:body.title,revision:serverFile.revision+1};return {file:structuredClone(serverFile)};
   case 'create':assert.equal(body.kind,'folder');serverFile={...serverFile,id:randomUUID(),title:body.title,kind:'folder',content:null,revision:1};return {file:structuredClone(serverFile)};
   case 'restore':return restoreHook?restoreHook(body,applyRestore):applyRestore(body);
   default:throw Error('Unexpected RPC '+body.op);
  }
 }
 const transport={async request(body){trace.push(structuredClone(body));return options.requestHook?options.requestHook(body,respond):respond(body);}};
 let props={transport,locale:'en',...options.props};
 const React={
  createElement(type,attributes,...children){return {type,props:attributes??{},children};},Fragment:Symbol('Fragment'),Suspense:Symbol('Suspense'),lazy:()=>Symbol('Editor'),
  useState(initial){const index=cursor++;if(!slots[index])slots[index]={value:typeof initial==='function'?initial():initial};return [slots[index].value,value=>{const next=typeof value==='function'?value(slots[index].value):value;if(!Object.is(next,slots[index].value)){slots[index].value=next;dirty=true;}}];},
  useMemo(factory,deps){const index=cursor++,previous=slots[index];if(!previous||deps.some((dep,i)=>!Object.is(dep,previous.deps[i])))slots[index]={deps,value:factory()};return slots[index].value;},
  useRef(initial){const index=cursor++;if(!slots[index])slots[index]={current:initial};return slots[index];},
  useId(){const index=cursor++;return 'restore-test-'+index;},
  useEffect(effect,deps){const index=cursor++,previous=slots[index];if(!previous||deps.some((dep,i)=>!Object.is(dep,previous.deps[i]))){slots[index]={deps,cleanup:previous?.cleanup};effects.push(()=>{slots[index].cleanup?.();slots[index].cleanup=effect();});}}
 };
 const module={exports:{}};
 runInNewContext(code,{module,exports:module.exports,require(name){if(name==='react')return React;if(name==='./locales')return {getOfficeMessages};if(name==='./SharingDialog')return {SharingDialog:Symbol('SharingDialog')};if(name==='../core/templates')return {OFFICE_TEMPLATES:[]};if(name==='../core/formats')return officeFormats;if(name==='../core/spreadsheet-execution')return {isSpreadsheetCachedPreview};throw Error('Unexpected dependency '+name);},structuredClone,crypto:{randomUUID},document,window,navigator:{onLine:true},Event,Intl,Date,console,
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

for(const action of ['＋ New folder','Rename']) test(`${action}: dragging a name selection outside the dialog keeps the draft available for typing and saving`,async()=>{
 const app=await workspace({startInList:true,file:{kind:'folder',content:null,title:'Původní složka'}});
 await app.click(app.button(action));
 const editableDialog=()=>app.find(n=>n.type==='dialog'||n.props.role==='dialog')[0];
 const nameInput=()=>app.find(n=>n.type==='input'&&n.props.required&&n.props.maxLength===200,editableDialog())[0];
 const input=nameInput();assert.ok(input);
 // Browser selection can start inside the input and release on the backdrop.
 // Its click is targeted at the common ancestor, rather than the original input.
 const surface=app.find(n=>n.props.className==='office-modal-backdrop')[0]??editableDialog();
 input.props.onPointerDown?.({button:0,target:input,currentTarget:input});
 input.props.onMouseDown?.({button:0,target:input,currentTarget:input});
 surface.props.onPointerUp?.({button:0,target:surface,currentTarget:surface});
 surface.props.onMouseUp?.({button:0,target:surface,currentTarget:surface});
 surface.props.onClick?.({button:0,target:surface,currentTarget:surface});
 await app.settle();
 assert.ok(editableDialog(),'selection release must not discard the name dialog');
 assert.equal(nameInput().props.value,input.props.value,'unfinished name stays intact');
 nameInput().props.onChange({target:{value:'Objednávky 2026'}});await app.settle();
 await app.submit(app.find(n=>n.type==='form',editableDialog())[0]);
 assert.equal(editableDialog(),undefined);
 const request=app.trace.filter(n=>n.op===(action==='Rename'?'rename':'create'));
 assert.equal(request.length,1);assert.equal(request[0].title,'Objednávky 2026');
 assert.equal(app.file.title,'Objednávky 2026');
});

test('folder dialog opens modally, focuses the name, and explicit Cancel or Escape restores focus without writing',async()=>{
 for(const method of ['button','escape']){
  const app=await workspace({startInList:true});await app.click(app.button('＋ New folder'));
  const dialog=app.dialog(),input=app.find(n=>n.type==='input'&&n.props.required,dialog)[0];
  assert.equal(dialog.props.ref.current.open,true);assert.equal(app.focused,input.props.ref.current);
  assert.ok(app.find(n=>n.props.id===dialog.props['aria-labelledby'],dialog).length);
  input.props.onChange({target:{value:'Unsubmitted folder'}});await app.settle();
  if(method==='button')await app.click(app.button('Cancel',app.dialog()));
  else {let prevented=false;app.dialog().props.onCancel({preventDefault(){prevented=true;}});await app.settle();assert.equal(prevented,true);}
  assert.equal(app.dialog(),undefined);assert.equal(app.focused,app.opener);
  assert.equal(app.trace.some(n=>['create','rename'].includes(n.op)),false);
 }
});

test('Escape and a retained Cancel handler cannot dismiss a folder save that is already in flight',async()=>{
 const pending=deferred();let saveBody;
 const app=await workspace({startInList:true,requestHook(body,respond){if(body.op==='create'){saveBody=body;return pending.promise;}return respond(body);}});
 await app.click(app.button('＋ New folder'));const cancel=app.button('Cancel',app.dialog()).props.onClick;
 const form=app.find(n=>n.type==='form',app.dialog())[0];form.props.onSubmit({preventDefault(){}});
 // Exercise the interval before React has rendered disabled controls as well.
 cancel();app.dialog().props.onCancel({preventDefault(){}});await app.settle();
 assert.ok(app.dialog());assert.equal(app.button('Cancel',app.dialog()).props.disabled,true);
 assert.equal(saveBody.kind,'folder');
 app.dialog().props.onCancel({preventDefault(){}});await app.settle();assert.ok(app.dialog());
 pending.resolve({file:{...app.file,id:'saved-folder',kind:'folder',content:null,title:saveBody.title,revision:1}});await app.settle();
 assert.equal(app.dialog(),undefined);assert.equal(app.trace.filter(n=>n.op==='create').length,1);
});

test('host can hide the Office topbar while tenant warnings, recovery controls and file creation remain available',async()=>{
 let recovered=false;
 const recovery={type:'button',props:{onClick(){recovered=true;}},children:['Restore access']};
 const app=await workspace({startInList:true,props:{title:'Host Office',headerSecondary:['Company context changed',recovery]}});
 assert.equal(app.find(n=>n.props.className==='office-topbar').length,1);assert.match(text(app.tree),/Company context changed/);
 await app.update({hideHeader:true});
 assert.equal(app.find(n=>n.props.className==='office-topbar').length,0);assert.equal(app.find(n=>n.props.className==='office-header-secondary').length,1);
 assert.match(text(app.tree),/Company context changed/);assert.equal(app.find(n=>n.props.className==='office-file-workspace').length,1);
 await app.click(app.button('Restore access'));assert.equal(recovered,true);
 await app.click(app.button('＋ New folder'));assert.ok(app.dialog());await app.click(app.button('Cancel',app.dialog()));
 await app.update({hideHeader:false});assert.equal(app.find(n=>n.props.className==='office-topbar').length,1);assert.match(text(app.tree),/Company context changed/);
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

test('workspace upload exposes supported formats and explains limited DOC import before choosing a file',async()=>{
 const app=await workspace({startInList:true});
 const upload=app.find(node=>node.type==='input'&&node.props.type==='file')[0];
 for(const extension of ['.odt','.doc','.ods','.xls','.tsv'])assert.ok(upload.props.accept.split(',').includes(extension),extension);
 assert.match(text(app.tree),/text import only, without formatting or images/);
 assert.match(text(app.tree),/original file is preserved/);
 assert.doesNotMatch(upload.props.accept,/\.docm|\.xlsm/);
});

test('workspace export menus offer document and spreadsheet formats separately and never offer DOC',async()=>{
 for(const [kind,expected]of [['document',['','docx','odt','pdf','txt','html']],['spreadsheet',['','xlsx','ods','xls','csv','tsv']]]){
  const app=await workspace({file:{kind}});
  const select=app.find(node=>node.type==='select'&&node.props['aria-label']==='Export')[0];
  assert.deepEqual(app.find(node=>node.type==='option',select).map(node=>node.props.value),expected);
  if(kind==='spreadsheet'){
   assert.equal(text(app.find(node=>node.type==='option'&&node.props.value==='xls',select)[0]),'XLS (values only)');
   assert.match(text(app.tree),/XLS export saves the last calculated values without formulas/);
  }
  // Forged values must not reach the transport even outside normal select UI.
  let called=false;app.transport.exportFile=async()=>{called=true;throw Error('Unexpected export');};
  select.props.onChange({target:{value:'doc'}});await app.settle();assert.equal(called,false);
 }
});

test('cached spreadsheet preview disables editor, saving and restoration, including a stale editor callback',async()=>{
 const preview=blankSpreadsheet();preview.workbook.officeCalculationMode='cached-readonly-v1';preview.workbook.sheets['sheet-1'].cellData={0:{0:{f:'=1+1',v:2}}};
 const app=await workspace({file:{kind:'spreadsheet',content:preview}});
 assert.equal(app.editor().props.readOnly,true);assert.equal(app.button('Save').props.disabled,true);
 for(const node of app.find(n=>n.type==='button'&&text(n)==='Restore'))assert.equal(node.props.disabled,true);
 app.editor().props.onChange(content('Stale editor must not overwrite imported workbook'));
 await app.settle();await app.fireTimers(900);assert.equal(app.writes().length,0);assert.deepEqual(app.file.content,preview);
});