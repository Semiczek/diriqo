import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {transform} from 'esbuild';

// Execute actual integration functions with inert Next/Supabase ports, no network.
const root=new URL('../../',import.meta.url);
async function authoredModule(file,bindings,result){
 let source=await readFile(new URL(file,root),'utf8');
 source=source.replace(/^import ['"]server-only['"]\r?\n/gm,'')
  .replace(/^import[\s\S]*?from ['"][^'"]+['"]\r?\n/gm,'')
  .replace(/^export default /gm,'').replace(/^export /gm,'');
 const code=file.endsWith('.tsx')?(await transform(source,{loader:'tsx',jsxFactory:'jsx'})).code:stripTypeScriptTypes(source);
 return vm.runInNewContext(code+'\n;('+result+')',bindings,{filename:file});
}
const A='00000000-0000-4000-8000-000000001001',B='00000000-0000-4000-8000-000000001002';
const U='00000000-0000-4000-8000-000000000004',P='00000000-0000-4000-8000-000000000104';
function client({user={id:U},profile={id:P,auth_user_id:U,user_id:U},member={},members,enabled=true,errorTable}={}){
 const tables={
  profiles:profile?[profile]:[],
  company_members:members??[{id:'membership',company_id:A,profile_id:P,role:'worker',is_active:true,companies:{id:A,name:'Tenant A'},...member}],
  office_settings:[{company_id:A,enabled}],customer_portal_users:[]
 },queries=[];
 return {
  queries,auth:{async getUser(){return {data:{user},error:null};}},
  from(table){
   const query={table,filters:[],or:null};queries.push(query);
   const result=()=>({data:(tables[table]??[]).filter(row=>query.filters.every(([key,value])=>row[key]===value))
    .filter(row=>!query.or||row.auth_user_id===U||row.user_id===U),error:table===errorTable?{}:null});
   return {
    select(){return this;},eq(key,value){query.filters.push([key,value]);return this;},
    or(value){query.or=value;return this;},
    async limit(n){const value=result();return {...value,data:value.data.slice(0,n)};},
    async maybeSingle(){const value=result();return {...value,data:value.data[0]??null};},
    then(resolve,reject){return Promise.resolve(result()).then(resolve,reject);}
   };
  }
 };
}
async function context({cookie=A,active=null,...options}={}){
 const supabase=client(options);
 const run=await authoredModule('integrations/hub/lib/office/context.ts',{
  cookies:async()=>({get:name=>name==='active_company_id'&&cookie!==null?{value:cookie}:undefined}),
  getActiveCompanyContext:async()=>active,createSupabaseServerClient:async()=>supabase
 },'requireOfficeContext');
 return {run,supabase};
}
test('Hub worker reads only its active cookie tenant and keeps the reader role',async()=>{
 const {run,supabase}=await context();const result=await run();
 assert.equal(result.actor.tenantId,A);assert.equal(result.actor.actorId,P);assert.equal(result.actor.role,'reader');
 const member=supabase.queries.find(q=>q.table==='company_members');
 assert.deepEqual(member.filters,[['profile_id',P],['is_active',true],['role','worker'],['company_id',A]]);
 assert.equal(result.active.companyName,'Tenant A');
});
test('Hub worker cannot write or use a disabled module',async()=>{
 await assert.rejects((await context()).run(true),/OFFICE_FORBIDDEN/);
 await assert.rejects((await context({enabled:false})).run(),/OFFICE_DISABLED/);
});
test('Hub worker rejects empty, malformed, foreign and inactive company selection',async()=>{
 for(const cookie of ['', 'not-a-uuid', B])await assert.rejects((await context({cookie})).run(),/OFFICE_FORBIDDEN/);
 await assert.rejects((await context({member:{is_active:false}})).run(),/OFFICE_FORBIDDEN/);
 await assert.rejects((await context({member:{profile_id:B}})).run(),/OFFICE_FORBIDDEN/);
});
test('Hub worker requires a verified auth user and bound profile, and fails on query errors',async()=>{
 await assert.rejects((await context({user:null})).run(),/OFFICE_UNAUTHENTICATED/);
 await assert.rejects((await context({profile:{id:P,auth_user_id:B,user_id:B}})).run(),/OFFICE_FORBIDDEN/);
 for(const errorTable of ['profiles','company_members'])await assert.rejects((await context({errorTable})).run(),/OFFICE_FORBIDDEN/);
 await assert.rejects((await context({errorTable:'office_settings'})).run(),/OFFICE_DISABLED/);
});
test('explicit worker tenant wins over general Hub resolver fallback to another owner tenant',async()=>{
 const result=await (await context({active:{companyId:B,companyName:'B',profileId:P,role:'company_admin'}})).run();
 assert.equal(result.actor.tenantId,A);assert.equal(result.actor.role,'reader');
 const owner=await context({active:{companyId:A,companyName:'A',profileId:P,role:'company_admin'}});
 assert.equal((await owner.run(true)).actor.role,'owner');
 assert.equal(owner.supabase.queries.some(q=>q.table==='company_members'),false);
});
async function proxyHarness({cookie=A,...options}={}){
 const supabase=client(options),reply=(kind,url)=>({kind,url,headers:new Headers(),cookies:{set(){}}});
 const roleFns=await authoredModule('integrations/hub/lib/hub-access.ts',{},'({hasAnyHubAccessRole,hasHubAccessRole})');
 const bindings={
  createServerClient:()=>supabase,NextResponse:{next:()=>reply('next'),redirect:url=>reply('redirect',String(url))},
  ...roleFns,DEFAULT_ACTIVE_MODULES:[],normalizeActiveModules:()=>[],normalizeMenuItemVisibility:()=>null,
  canAccessMenuPath:()=>false,getDefaultMenuPath:()=>'/',
  LOCALE_COOKIE_NAME:'locale',LOCALE_HEADER_NAME:'locale',LOCALE_COUNTRY_HEADER_NAME:'country',
  normalizeLocale:()=>null,getPreferredLocaleFromHeader:()=> 'cs',getFallbackLocaleFromCountry:()=> 'cs',
  process:{env:{}},Headers,URL
 };
 const module=await authoredModule('integrations/hub/proxy.ts',bindings,'({proxy,isOfficeReaderPath})');
 const run=path=>module.proxy({url:'https://hub.invalid'+path,nextUrl:new URL('https://hub.invalid'+path),headers:new Headers(),
  cookies:{get:name=>name==='active_company_id'&&cookie!==null?{value:cookie}:undefined,set(){}}});
 return {...module,run,roleFns};
}
test('Office worker proxy exception uses exact path segments and changes no general Hub role',async()=>{
 const p=await proxyHarness();
 assert.equal(p.roleFns.hasHubAccessRole('worker'),false);
 for(const path of ['/office','/office/settings','/api/office','/api/office/files']){
  assert.equal(p.isOfficeReaderPath(path),true);
  assert.equal((await p.run(path)).kind,'next');
 }
 for(const path of ['/officex','/api/officeevil','/jobs','/api/active-company'])assert.equal(p.isOfficeReaderPath(path),false);
 assert.match((await p.run('/jobs')).url,/no-hub-access/);
 assert.match((await p.run('/api/active-company')).url,/no-hub-access/);
});
test('Office worker proxy requires matching selected tenant and active membership',async()=>{
 for(const cookie of ['',B])assert.equal((await (await proxyHarness({cookie})).run('/office')).kind,'redirect');
 assert.equal((await (await proxyHarness({member:{is_active:false}})).run('/office')).kind,'redirect');
 assert.equal((await (await proxyHarness({member:{role:'unknown_role'}})).run('/office')).kind,'redirect');
});

test('fresh Office login can use exactly one active worker company without a cookie',async()=>{
 const result=await (await context({cookie:null})).run();
 assert.equal(result.actor.tenantId,A);assert.equal(result.actor.role,'reader');
 assert.equal((await (await proxyHarness({cookie:null})).run('/office')).kind,'next');
 for(const members of [[],[
  {company_id:A,profile_id:P,role:'worker',is_active:true},
  {company_id:B,profile_id:P,role:'worker',is_active:true}
 ]]){
  await assert.rejects((await context({cookie:null,members})).run(),/OFFICE_FORBIDDEN/);
  assert.equal((await (await proxyHarness({cookie:null,members})).run('/office')).kind,'redirect');
 }
 // Blank or malformed cookies are present cookies, not permission to pick a tenant.
 for(const cookie of ['','   ','invalid',B]){
  await assert.rejects((await context({cookie})).run(),/OFFICE_FORBIDDEN/);
  assert.equal((await (await proxyHarness({cookie})).run('/office')).kind,'redirect');
 }
});
test('unauthenticated Office access retains only the fixed Office login destination',async()=>{
 const p=await proxyHarness({user:null,cookie:null});
 assert.equal(new URL((await p.run('/office')).url).searchParams.get('next'),'/office');
 assert.equal(new URL((await p.run('/api/office/files')).url).searchParams.get('next'),'/office');
 assert.equal(new URL((await p.run('/jobs')).url).searchParams.has('next'),false);
});
test('actual Hub login submit preserves exact Office and existing Manager destinations and rejects open redirects',async()=>{
 for(const next of ['/office','/manager',null,'https://evil.invalid','//evil.invalid','/office?next=evil','/office/settings','/api/office']){
  let destination=null,authCalls=0;
  const Login=await authoredModule('integrations/hub/app/login/page.tsx',{
   useSearchParams:()=>new URLSearchParams(next===null?'':{next}),
   useI18n:()=>({dictionary:{auth:{}}}),useState:value=>[typeof value==='function'?value():value,()=>{}],
   supabase:{auth:{async signInWithPassword(){authCalls++;return {data:{session:{}},error:null};}}},
   window:{location:{assign(value){destination=value;}}},URLSearchParams,
   LanguageSwitcher(){},Image(){},Suspense(){},
   jsx:(type,props,...children)=>({type,props:props??{},children})
  },'LoginPageContent');
  const tree=Login(),find=node=>node&&typeof node==='object'?(node.type==='form'?node:node.children?.map(find).find(Boolean)):null;
  const form=find(tree);assert.ok(form?.props.onSubmit);
  await form.props.onSubmit({preventDefault(){}});
  assert.equal(authCalls,1);assert.equal(destination,['/office','/manager'].includes(next)?next:'/');
 }
});
