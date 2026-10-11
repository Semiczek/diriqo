import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {transform} from 'esbuild';
import vm from 'node:vm';

const root=new URL('../../',import.meta.url);
async function moduleFrom(file,bindings,result){
 let source=await readFile(new URL(file,root),'utf8');
 source=source.replace(/^import ['"]server-only['"]\r?\n/gm,'')
  .replace(/^import[\s\S]*?from ['"][^'"]+['"]\r?\n/gm,'')
  .replace(/^export default /gm,'').replace(/^export /gm,'');
 const code=file.endsWith('.tsx')?(await transform(source,{loader:'tsx',jsxFactory:'jsx'})).code:stripTypeScriptTypes(source);
 return vm.runInNewContext(code+'\n;('+result+')',bindings,{filename:file});
}
async function proxyHarness({user={id:'auth-user'},authError=null,role='worker',profile=true,membership=true}={}){
 const queries=[],adminChecks=[],reply=(kind,url)=>({kind,url,headers:new Headers(),cookies:{set(){}}});
 const supabase={auth:{async getUser(){return {data:{user},error:authError};}},
  from(table){queries.push(table);const data=table==='profiles'?(profile?[{id:'profile'}]:[]):table==='company_members'?(membership?[{company_id:'company',role,is_active:true}]:[]):[];
   return {select(){return this;},eq(){return this;},async maybeSingle(){return {data:data[0]??null,error:null};},
    then(resolve,reject){return Promise.resolve({data,error:null}).then(resolve,reject);}};
  }};
 const roleFns=await moduleFrom('integrations/diriqo/lib/hub-access.ts',{},'({hasAnyHubAccessRole,hasCompanyMemberRole})');
 const proxy=await moduleFrom('integrations/diriqo/proxy.ts',{
  ...roleFns,createServerClient:()=>supabase,
  NextResponse:{next:()=>reply('next'),redirect:url=>reply('redirect',String(url))},
  hasPlatformAdminAccess:async()=>{adminChecks.push(true);return false;},
  LOCALE_COOKIE_NAME:'locale',LOCALE_HEADER_NAME:'locale',LOCALE_COUNTRY_HEADER_NAME:'country',
  normalizeLocale:()=>null,getPreferredLocaleFromHeader:()=> 'cs',getFallbackLocaleFromCountry:()=> 'cs',
  process:{env:{}},Headers,URL
 },'proxy');
 return {queries,adminChecks,run:path=>proxy({url:'https://diriqo.invalid'+path,nextUrl:new URL('https://diriqo.invalid'+path),
  headers:new Headers(),cookies:{get(){},set(){}}})};
}
test('authenticated workers can reach exact logout without profile or privileged-role requirements',async()=>{
 for(const config of [{role:'worker'},{role:'manager'},{profile:false,membership:false},{membership:false}]){
  const p=await proxyHarness(config);assert.equal((await p.run('/logout')).kind,'next');
  assert.equal(p.queries.length,0);assert.equal(p.adminChecks.length,0);
 }
});
test('logout remains authenticated and the exception excludes child paths and privileged routes',async()=>{
 for(const config of [{user:null},{authError:{message:'fake'}}]){
  const p=await proxyHarness(config);assert.equal((await p.run('/logout')).url,'https://diriqo.invalid/sign-in');
 }
 const p=await proxyHarness();
 for(const path of ['/jobs','/settings','/billing'])assert.equal((await p.run(path)).url,'https://diriqo.invalid/moje-prace');
 // The real original Next matcher excluded this nonexistent child route. Catch-all
 // staging coverage preserves that normal-mode bypass; staging denies it separately.
 assert.equal((await p.run('/logout/child')).kind,'next');
 assert.match((await p.run('/admin')).url,/\/sign-in\?error=no-hub-access$/);
 assert.equal(p.adminChecks.length,1);
});

async function logoutHarness({providerError=false,host='diriqo'}={}){
 const values=new Map([['sb-staging-auth-token','synthetic-session'],['active_company_id','tenant-a'],['locale','cs']]);
 const events=[];let writable=false,authCalls=0;
 const cookieStore={
  getAll:()=>[...values].map(([name,value])=>({name,value})),
  set(name,value,options){if(!writable)throw Error('Cookies cannot be modified during render');events.push({op:'set',name,value,options});values.set(name,value);},
  delete(name){if(!writable)throw Error('Cookies cannot be modified during render');events.push({op:'delete',name});values.delete(name);}
 };
 // Execute the real host cookie adapter; fake only the provider request.
 const serverClient=await moduleFrom('integrations/'+host+'/lib/supabase-server.ts',{
  cookies:async()=>cookieStore,headers:async()=>new Headers(),process:{env:{}},
  createServerClient:(_url,_key,options)=>({auth:{async signOut({scope}){
   authCalls++;assert.equal(scope,'local');
   if(providerError)return {error:{message:'sensitive upstream text'}};
   options.cookies.setAll([{name:'sb-staging-auth-token',value:'',options:{path:'/',maxAge:0}}]);
   return {error:null};
  }}})
 },'createSupabaseServerClient');
 const Page=await moduleFrom('integrations/'+host+'/app/logout/page.tsx',{
  createSupabaseServerClient:serverClient,cookies:async()=>cookieStore,
  redirect:location=>{throw Object.assign(new Error('redirect'),{location});},
  getRequestDictionary:async()=>({common:{logout:'Odhlásit se',logoutFailed:'Odhlášení se nepovedlo.'}}),
  jsx:(type,props,...children)=>({type,props:props??{},children})
 },'LogoutPage');
 const findForm=node=>node&&typeof node==='object'?(node.type==='form'?node:node.children?.map(findForm).find(Boolean)):null;
 return {values,events,Page,authCalls:()=>authCalls,async submit(tree){writable=true;try{return await findForm(tree).props.action();}finally{writable=false;}}};
}
test('logout GET and prefetch render a native form without signOut or cookie mutation',async()=>{
 const h=await logoutHarness();
 const tree=await h.Page({searchParams:Promise.resolve({})});
 assert.equal(tree.type,'main');assert.equal(h.authCalls(),0);assert.deepEqual(h.events,[]);
 assert.equal(h.values.get('active_company_id'),'tenant-a');
});
test('explicit logout server action clears session cookie through the real adapter and selected company',async()=>{
 const h=await logoutHarness(),tree=await h.Page({searchParams:Promise.resolve({})});
 await assert.rejects(h.submit(tree),error=>error.location==='/sign-in');
 assert.equal(h.authCalls(),1);assert.equal(h.values.get('sb-staging-auth-token'),'');
 assert.equal(h.values.has('active_company_id'),false);assert.equal(h.values.get('locale'),'cs');
 assert.equal(h.events[0].name,'sb-staging-auth-token');assert.equal(h.events[0].options.maxAge,0);
 assert.equal(h.events[1].name,'active_company_id');
});
test('logout failure retains tenant selection and reveals no provider message',async()=>{
 const h=await logoutHarness({providerError:true}),tree=await h.Page({searchParams:Promise.resolve({})});
 await assert.rejects(h.submit(tree),error=>error.location==='/logout?error=signout'&&!error.message.includes('sensitive'));
 assert.equal(h.values.get('active_company_id'),'tenant-a');assert.equal(h.values.get('sb-staging-auth-token'),'synthetic-session');
 assert.deepEqual(h.events,[]);
 const errorPage=await h.Page({searchParams:Promise.resolve({error:'signout'})});
 assert.ok(JSON.stringify(errorPage).includes('Odhlášení se nepovedlo.'));
 assert.equal(JSON.stringify(errorPage).includes('sensitive upstream'),false);
});

test('Hub logout GET has no side effect and explicit action clears its session and selected tenant',async()=>{
 const h=await logoutHarness({host:'hub'}),tree=await h.Page({searchParams:Promise.resolve({})});
 assert.equal(h.authCalls(),0);assert.deepEqual(h.events,[]);assert.equal(h.values.get('active_company_id'),'tenant-a');
 await assert.rejects(h.submit(tree),error=>error.location==='/login?next=/office');
 assert.equal(h.authCalls(),1);assert.equal(h.values.get('sb-staging-auth-token'),'');assert.equal(h.values.has('active_company_id'),false);
 assert.equal(h.values.get('locale'),'cs');
});

test('Hub failed signOut preserves session and tenant and reports only its translated error',async()=>{
 const h=await logoutHarness({host:'hub',providerError:true}),tree=await h.Page({searchParams:Promise.resolve({})});
 await assert.rejects(h.submit(tree),error=>error.location==='/logout?error=signout');
 assert.deepEqual(h.events,[]);assert.equal(h.values.get('active_company_id'),'tenant-a');assert.equal(h.values.get('sb-staging-auth-token'),'synthetic-session');
 const failure=await h.Page({searchParams:Promise.resolve({error:'signout'})});
 assert.ok(JSON.stringify(failure).includes('Odhlášení se nepovedlo.'));assert.equal(JSON.stringify(failure).includes('sensitive upstream'),false);
});
