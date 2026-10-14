import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';
import {transformSync} from 'esbuild';
import {getOfficeMessages} from '../src/client/locales.ts';

// Exercise the real component and handlers. Native browser focus containment is
// verified separately; the inert element doubles only record dialog lifecycle.
const code=transformSync(readFileSync(new URL('../src/client/SharingDialog.tsx',import.meta.url),'utf8'),
 {loader:'tsx',format:'cjs',jsx:'transform',target:'es2022'}).code;
const text=node=>node==null||typeof node==='boolean'?'':Array.isArray(node)?node.map(text).join(''):typeof node==='object'?text(node.children):String(node);
const nodes=(tree,predicate=()=>true)=>Array.isArray(tree)?tree.flatMap(node=>nodes(node,predicate)):!tree||typeof tree!=='object'?[]:[...(predicate(tree)?[tree]:[]),...nodes(tree.children,predicate)];
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const initialState=()=>({fileId:'file-a',owner:{id:'owner-a',name:'Author Alice'},visibility:'private',revision:3,canManage:true,
 members:[{id:'member-b',name:'Colleague Bruno',role:'reader'}],colleagues:[{id:'owner-a',name:'Author Alice'},{id:'member-b',name:'Colleague Bruno'},{id:'member-c',name:'Colleague Carla'}],automaticReaders:[{id:'manager-a',name:'Manager Dora'}]});

async function dialogApp(options={}){
 const slots=[],effects=[],refs=new WeakMap(),reads=[],writes=[],updates=[],responses=new Map();
 let index=0,dirty=true,tree,focused=null,closed=0,unmounted=false,server=structuredClone(options.state??initialState());
 const opener={isConnected:true,focus(){focused=opener;}},document={activeElement:null};document.activeElement=opener;
 async function apply(input){
  if(responses.has(input.idempotencyKey))return structuredClone(responses.get(input.idempotencyKey));
  assert.equal(input.fileId,server.fileId,'A sharing write must retain its original document');
  if(input.expectedRevision!==server.revision)throw Error('OFFICE_REVISION_CONFLICT');
  const colleague=server.colleagues.find(person=>person.id===input.memberId);
  assert.ok(colleague,'Only a supplied colleague can be shared');
  const members=server.members.filter(person=>person.id!==input.memberId);
  if(input.role)members.push({...colleague,role:input.role});
  server={...server,members,revision:server.revision+1};responses.set(input.idempotencyKey,structuredClone(server));return structuredClone(server);
 }
 const transport={
  async sharingRead(id,query){reads.push({id,query});return options.readHook?options.readHook({id,query},()=>structuredClone(server)):structuredClone(server);},
  async sharingUpdate(input){writes.push(structuredClone(input));return options.updateHook?options.updateHook(input,apply):apply(input);},
  request(){throw Error('Sharing cannot execute general document operations');},
 };
 let props={file:{id:'file-a',title:'Work document'},transport,locale:'en',onClose(){closed++;},onUpdated(){updates.push(true);}};
 const React={
  createElement(type,attributes,...children){return {type,props:attributes??{},children};},Fragment:Symbol('Fragment'),
  useState(initial){const slot=index++;if(!slots[slot])slots[slot]={value:typeof initial==='function'?initial():initial};return [slots[slot].value,value=>{if(unmounted)return;const next=typeof value==='function'?value(slots[slot].value):value;if(!Object.is(next,slots[slot].value)){slots[slot].value=next;dirty=true;}}];},
  useRef(initial){const slot=index++;if(!slots[slot])slots[slot]={current:initial};return slots[slot];},
  useId(){return 'share-test-'+index++;},
  useEffect(effect,deps){const slot=index++,previous=slots[slot];if(!previous||deps.some((dep,i)=>!Object.is(dep,previous.deps[i]))){slots[slot]={deps,cleanup:previous?.cleanup};effects.push(()=>{slots[slot].cleanup?.();slots[slot].cleanup=effect();});}},
 };
 const module={exports:{}};
 runInNewContext(code,{module,exports:module.exports,require(name){if(name==='react')return React;if(name==='./locales')return {getOfficeMessages};throw Error('Unexpected sharing dependency '+name);},crypto:{randomUUID},document,
  fetch(){throw Error('Sharing must use the authorized host transport');},localStorage:{getItem(){throw Error('No browser storage for sharing');},setItem(){throw Error('No browser storage for sharing');}},console});
 function render(){if(!dirty||unmounted)return;dirty=false;index=0;tree=module.exports.SharingDialog(props);for(const node of nodes(tree,node=>node.props.ref)){const ref=node.props.ref;let element=refs.get(ref);if(!element){element={open:false,focus(){focused=element;},showModal(){this.open=true;},close(){this.open=false;}};refs.set(ref,element);}ref.current=element;}while(effects.length)effects.shift()();}
 async function settle(){for(let i=0;i<60;i++){await Promise.resolve();render();}}
 const find=(predicate,root=tree)=>nodes(root,predicate);
 const button=(label)=>{const matches=find(node=>node.type==='button'&&(text(node)===label||node.props['aria-label']===label));assert.equal(matches.length,1,'Expected one button '+label);return matches[0];};
 const shareForm=()=>find(node=>node.type==='form'&&node.props.className!=='office-sharing-search')[0];
 async function submit(form=shareForm()){assert.ok(form,'Sharing form must be present');form.props.onSubmit({preventDefault(){}});await settle();}
 async function click(node){assert.equal(Boolean(node.props.disabled),false,'Button must be enabled');node.props.onClick?.();await settle();}
 async function select(member='member-c',role='reader'){const fields=find(node=>node.type==='select');assert.equal(fields.length,2);fields[0].props.onChange({target:{value:member}});fields[1].props.onChange({target:{value:role}});await settle();}
 render();await settle();
 return {find,button,click,select,submit,shareForm,settle,reads,writes,updates,transport,opener,
  get tree(){return tree;},get focused(){return focused;},get closed(){return closed;},get server(){return server;},
  async search(value){const input=find(node=>node.type==='input'&&node.props.type==='search')[0];input.props.onChange({target:{value}});await settle();await submit(find(node=>node.props.className==='office-sharing-search')[0]);},
  async update(next){props={...props,...next};dirty=true;await settle();},
  mutateServer(){server={...server,revision:server.revision+1};},
  unmount(){unmounted=true;slots.forEach(slot=>slot?.cleanup?.());},
 };
}

test('sharing opens a named native dialog, identifies the author and restores focus without sending notifications',async()=>{
 const app=await dialogApp();const dialog=app.find(node=>node.type==='dialog')[0];
 assert.equal(dialog.props.ref.current.open,true);assert.equal(app.focused,app.button('Close').props.ref.current);
 assert.equal(app.find(node=>node.props.id===dialog.props['aria-labelledby']).length,1);
 assert.equal(app.find(node=>node.props.id===dialog.props['aria-describedby']).length,1);
 for(const name of ['Work document','Author Alice','Colleague Bruno','Manager Dora'])assert.match(text(app.tree),new RegExp(name));
 assert.equal(app.find(node=>node.type==='option'&&node.props.value==='owner-a').length,0,'The author cannot be added as an ordinary member');
 assert.deepEqual(app.reads,[{id:'file-a',query:''}]);assert.equal(app.writes.length,0);
 await app.click(app.button('Close'));assert.equal(app.closed,1);app.unmount();assert.equal(app.focused,app.opener);assert.equal(dialog.props.ref.current.open,false);
});

test('sharing load failure or mismatched file fails closed with no writable controls',async()=>{
 for(const failure of ['network','tenant','wrong-file']){
  const app=await dialogApp({readHook(){if(failure==='wrong-file')return {...initialState(),fileId:'foreign-file'};throw Error(failure==='tenant'?'OFFICE_TENANT_CHANGED':'network');}});
  assert.equal(app.find(node=>node.props.role==='alert').length,1,failure);assert.equal(app.shareForm(),undefined);assert.equal(app.writes.length,0);
  assert.doesNotMatch(text(app.tree),/Author Alice|Colleague Bruno/);app.unmount();
 }
});

test('reader can inspect sharing and company visibility but cannot grant or remove access',async()=>{
 const app=await dialogApp({state:{...initialState(),canManage:false,visibility:'company'}});
 assert.match(text(app.tree),/available to the company/);assert.match(text(app.tree),/managed by the document author/);
 assert.equal(app.shareForm(),undefined);assert.equal(app.find(node=>node.type==='button'&&text(node)==='Remove sharing').length,0);assert.equal(app.writes.length,0);app.unmount();
});

test('granting view or edit access uses the pinned file, access revision and selected colleague',async()=>{
 for(const role of ['reader','editor']){
  const app=await dialogApp();await app.select('member-c',role);await app.submit();
  assert.equal(app.writes.length,1);assert.deepEqual({...app.writes[0],idempotencyKey:'verified'}, {fileId:'file-a',expectedRevision:3,memberId:'member-c',role,idempotencyKey:'verified'});
  assert.match(app.writes[0].idempotencyKey,/^[0-9a-f-]{36}$/);assert.equal(app.server.revision,4);assert.equal(app.server.members.find(person=>person.id==='member-c').role,role);
  assert.match(text(app.tree),/Sharing saved/);assert.equal(app.updates.length,1);app.unmount();
 }
});

test('revoking a colleague uses null role and the next permission revision',async()=>{
 const app=await dialogApp();await app.select();await app.submit();await app.click(app.button('Remove sharing: Colleague Bruno'));
 assert.equal(app.writes.length,2);assert.equal(app.writes[1].memberId,'member-b');assert.equal(app.writes[1].role,null);assert.equal(app.writes[1].expectedRevision,4);
 assert.notEqual(app.writes[0].idempotencyKey,app.writes[1].idempotencyKey);assert.equal(app.server.members.some(person=>person.id==='member-b'),false);app.unmount();
});

test('double submit and Escape cannot dismiss or duplicate an in-flight sharing mutation',async()=>{
 const gate=deferred();const app=await dialogApp({async updateHook(input,apply){await gate.promise;return apply(input);}});
 await app.select();const form=app.shareForm();await app.submit(form);await app.submit(form);assert.equal(app.writes.length,1);
 assert.equal(app.button('Close').props.disabled,true);let prevented=false;
 app.find(node=>node.type==='dialog')[0].props.onCancel({preventDefault(){prevented=true;}});await app.settle();assert.equal(prevented,true);assert.equal(app.closed,0);
 gate.resolve();await app.settle();assert.equal(app.server.revision,4);assert.equal(app.button('Close').props.disabled,false);app.unmount();
});

test('lost mutation reply retries the identical operation without another permission revision',async()=>{
 let first=true;const app=await dialogApp({async updateHook(input,apply){const result=await apply(input);if(first){first=false;throw Error('network');}return result;}});
 await app.select('member-c','editor');await app.submit();assert.equal(app.find(node=>node.props.role==='alert').length,1);
 assert.equal(app.find(node=>node.type==='select').every(node=>node.props.disabled),true,'Changing the target is disabled until the uncertain operation is resolved');
 await app.click(app.button('Retry'));assert.equal(app.writes.length,2);assert.deepEqual(app.writes[1],app.writes[0]);assert.equal(app.server.revision,4);assert.equal(app.updates.length,1);app.unmount();
});

test('revision conflict requires a fresh read before a new operation can use the latest revision',async()=>{
 const app=await dialogApp();await app.select();app.mutateServer();await app.submit();assert.equal(app.updates.length,0);assert.equal(app.find(node=>node.props.role==='alert').length,1);
 await app.click(app.button('Refresh list'));await app.select();await app.submit();assert.equal(app.writes.length,2);assert.equal(app.writes[1].expectedRevision,4);assert.notEqual(app.writes[1].idempotencyKey,app.writes[0].idempotencyKey);assert.equal(app.server.revision,5);app.unmount();
});

test('an obsolete colleague search cannot replace a newer server-verified result',async()=>{
 const old=deferred();const app=await dialogApp({readHook({query},read){if(query==='old')return old.promise;if(query==='new')return {...read(),colleagues:[{id:'member-c',name:'Current Carla'}]};return read();}});
 await app.search('old');await app.update({transport:{...app.transport,sharingRead:async()=>({...initialState(),colleagues:[{id:'member-c',name:'Current Carla'}]})}});
 old.resolve({...initialState(),colleagues:[{id:'old-person',name:'STALE COLLEAGUE'}]});await app.settle();
 assert.match(text(app.tree),/Current Carla/);assert.doesNotMatch(text(app.tree),/STALE COLLEAGUE/);assert.equal(app.writes.length,0);app.unmount();
});

test('unmount discards late mutation replies and never triggers an update callback',async()=>{
 const gate=deferred();const app=await dialogApp({async updateHook(input,apply){await gate.promise;return apply(input);}});await app.select();await app.submit();app.unmount();gate.resolve();await app.settle();assert.equal(app.updates.length,0);assert.equal(app.writes.length,1);
});

test('a retained submit handler cannot write after the host transport changes or access fails',async()=>{
 const app=await dialogApp();await app.select();const oldForm=app.shareForm();
 await app.update({transport:{...app.transport,sharingRead:async()=>{throw Error('OFFICE_TENANT_CHANGED');},sharingUpdate(){throw Error('A new tenant must never receive the old sharing operation');}}});
 assert.equal(app.shareForm(),undefined);await app.submit(oldForm);
 assert.equal(app.writes.length,0,'A queued handler must not use the old authorized transport after its context changes');app.unmount();
});

test('a late mutation reply cannot restore old authority after a changed host transport',async()=>{
 const gate=deferred();const app=await dialogApp({async updateHook(input,apply){await gate.promise;return apply(input);}});
 await app.select();await app.submit();
 await app.update({transport:{...app.transport,sharingRead:async()=>({...initialState(),canManage:false})}});
 gate.resolve();await app.settle();
 assert.equal(app.updates.length,0,'Late sharing success belongs only to its initiating context');
 assert.equal(app.shareForm(),undefined,'Old server response cannot restore the old write controls');app.unmount();
});

test('sharing labels are available in all seven supported languages',()=>{
 for(const locale of ['cs','sk','en','de','pl','tr','sq'])for(const key of ['share','author','sharingRestricted','sharingCompany','sharedWith','searchColleagues','accessLevel','shareRead','shareEdit','revokeShare','sharingFailed'])assert.ok(getOfficeMessages(locale)[key]?.trim(),locale+': '+key);
});
