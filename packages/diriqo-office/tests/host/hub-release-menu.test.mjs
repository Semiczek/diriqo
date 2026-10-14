import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import vm from 'node:vm';

const host=fileURLToPath(new URL('../../integrations/hub/',import.meta.url));
const require=createRequire(resolve(host,'package.json'));
const ts=require('typescript');
const A='00000000-0000-4000-8000-000000001001',B='00000000-0000-4000-8000-000000001002';
const jsx=(type,props)=>({type,props});
const Link=()=>null;
function load(entry,bindings={}){
 const cache=new Map();
 const mocks={'server-only':{},'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},
  'react':{useMemo:fn=>fn(),useEffect(){},useState:initial=>[initial,()=>{}]},
  'next/link':{__esModule:true,default:Link},'next/navigation':{usePathname:()=> '/',useRouter:()=>({prefetch(){}})},
  './I18nProvider':{useI18n:()=>({locale:'cs'})},...bindings};
 function read(filename){
  if(cache.has(filename))return cache.get(filename).exports;
  const testModule={exports:{}};cache.set(filename,testModule);
  const output=ts.transpileModule(readFileSync(filename,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const localRequire=id=>{
   if(Object.hasOwn(mocks,id))return mocks[id];
   const base=id.startsWith('@/')?resolve(host,id.slice(2)):id.startsWith('.')?resolve(dirname(filename),id):null;
   if(!base)throw new Error('Unexpected import '+id);
   const file=[base,base+'.ts',base+'.tsx'].find(existsSync);if(!file)throw new Error('Missing '+base);
   return read(file);
  };
  vm.runInNewContext('(function(require,module,exports){'+output+'\n})',{Error,Set,Map,URL,console},{filename})(localRequire,testModule,testModule.exports);
  return testModule.exports;
 }
 return read(resolve(host,entry));
}
function nodes(tree){if(!tree||typeof tree!=='object')return[];if(Array.isArray(tree))return tree.flatMap(nodes);return[tree,...nodes(tree.props?.children)];}
const hrefs=tree=>nodes(tree).filter(n=>n.props?.href).map(n=>n.props.href);

test('Hub superadmin can reach Office configuration with the module disabled; ordinary members cannot',()=>{
 const Sidebar=load('components/DashboardSidebar.tsx',{
  'react':{useMemo:fn=>fn(),useEffect(){},useState:initial=>[typeof initial==='object'?{office:true}:initial,()=>{}]},
 }).default;
 for(const role of ['super_admin','company_admin','manager','user','worker',null]){
  const disabled=hrefs(Sidebar({role,officeEnabled:false,activeModules:['gastro']}));
  assert.equal(disabled.includes('/office/settings'),role==='super_admin',String(role));
  assert.equal(disabled.includes('/office'),false);
  const enabled=hrefs(Sidebar({role,officeEnabled:true,activeModules:['gastro']}));
  assert.equal(enabled.includes('/office'),true);
  assert.deepEqual(enabled.filter(h=>!h.startsWith('/office')),disabled.filter(h=>!h.startsWith('/office')),'Office cannot add/remove POS or other links');
 }
});

function settingsHarness({role='super_admin',companyId=A,cookie=A,user={id:'auth-user'},enabled=false,rpcError=null}={}){
 const calls=[],revalidated=[];
 let active={role,companyId,companyName:'Company A'};
 let currentCookie=cookie;
 const client={auth:{getUser:async()=>({data:{user},error:null})},
  from(table){assert.equal(table,'office_settings');return{select(){return this},eq(column,value){assert.equal(column,'company_id');assert.equal(value,active.companyId);return this},maybeSingle:async()=>({data:{enabled},error:null})}},
  rpc:async(name,args)=>{calls.push({name,args});return{error:rpcError}}};
 const Page=load('app/office/settings/page.tsx',{
  'next/headers':{cookies:async()=>({get:()=>currentCookie===undefined?undefined:{value:currentCookie}})},
  'next/cache':{revalidatePath:path=>revalidated.push(path)},
  '@/lib/active-company':{getActiveCompanyContext:async()=>active},
  '@/lib/supabase-server':{createSupabaseServerClient:async()=>client},
 }).default;
 return{Page,calls,revalidated,setActive(value,newCookie=value.companyId){active=value;currentCookie=newCookie}};
}

test('Hub settings applies the active company flag and uses a full return navigation to refresh cached menu',async()=>{
 const h=settingsHarness();const page=await h.Page();
 const back=nodes(page).find(n=>n.props?.href==='/');assert.equal(back.type,'a','Next Link would reuse stale shell memory after enabling');
 const form=nodes(page).find(n=>n.type==='form');assert.ok(form);
 const payload=new FormData();payload.set('companyId',A);payload.set('enabled','on');
 await form.props.action(payload);
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].name,'office_set_enabled');
 assert.equal(h.calls[0].args.p_company_id,A);assert.equal(h.calls[0].args.p_enabled,true);
 assert.deepEqual(h.revalidated,['/office/settings']);
 payload.delete('enabled');await form.props.action(payload);assert.equal(h.calls[1].args.p_enabled,false);
});

test('Hub settings rejects stale or forged company, revoked superadmin and missing auth before the RPC',async()=>{
 for(const role of ['company_admin','manager','user','worker',null])await assert.rejects(settingsHarness({role}).Page(),/OFFICE_FORBIDDEN/);
 await assert.rejects(settingsHarness({user:null}).Page(),/OFFICE_FORBIDDEN/);
 for(const cookie of [B,'','invalid'])await assert.rejects(settingsHarness({cookie}).Page(),/OFFICE_TENANT_CHANGED/);
 const h=settingsHarness();const form=nodes(await h.Page()).find(n=>n.type==='form');
 const payload=new FormData();payload.set('companyId',B);payload.set('enabled','on');
 await assert.rejects(form.props.action(payload),/OFFICE_TENANT_CHANGED/);
 payload.set('companyId',A);h.setActive({role:'super_admin',companyId:B,companyName:'B'});
 await assert.rejects(form.props.action(payload),/OFFICE_TENANT_CHANGED/);
 h.setActive({role:'manager',companyId:A,companyName:'A'});
 await assert.rejects(form.props.action(payload),/OFFICE_FORBIDDEN/);
 assert.equal(h.calls.length,0);
});

test('Hub active company GET adds Office state without overwriting a newer switch cookie',async()=>{
 const writes=[],reads=[];
 const {GET}=load('app/api/active-company/route.ts',{
  'next/server':{NextResponse:{json:(body,options)=>({body,options,cookies:{set:value=>writes.push(value)}})}},
  '@/lib/active-company':{getActiveCompanyContext:async()=>({companyId:A,role:'manager'}),PermissionConfigurationUnavailableError:class extends Error{}},
  '@/lib/active-company-switch':{},
  '@/lib/office/availability':{readOfficeAvailability:async company=>{reads.push(company);return true}},
 });
 const response=await GET();assert.equal(response.body.companyId,A);assert.equal(response.body.officeEnabled,true);
 assert.deepEqual(reads,[A]);assert.deepEqual(writes,[]);assert.equal(response.options.headers['Cache-Control'],'private, no-store');
});

test('Hub bootstrap and unavailable permissions never guess a company for Office',async()=>{
 for(const unavailable of [false,true]){
  const reads=[];class PermissionConfigurationUnavailableError extends Error{}
  const {GET}=load('app/api/active-company/route.ts',{
   'next/server':{NextResponse:{json:(body,options)=>({body,options})}},
   '@/lib/active-company':{PermissionConfigurationUnavailableError,
    getActiveCompanyContext:async()=>{if(unavailable)throw new PermissionConfigurationUnavailableError('Unavailable');return null},
    getCompanyMembershipContext:async()=>({profile:{id:'p'},memberships:[{id:'m-a',company_id:A,role:'manager',companies:{name:'A'}},{id:'m-b',company_id:B,role:'manager',companies:{name:'B'}}]})},
   '@/lib/active-company-switch':{},
   '@/lib/office/availability':{readOfficeAvailability:async company=>{reads.push(company);return true}},
  });
  const response=await GET();assert.deepEqual(reads,[]);assert.equal(response.options.headers['Cache-Control'],'private, no-store');
  if(unavailable){assert.equal(response.options.status,503);assert.equal(response.body.code,'permission_unavailable')}
  else {assert.equal(response.body.selectionRequired,true);assert.equal(response.body.companyId,'');assert.equal(response.body.companyMemberships.length,2)}
 }
});
