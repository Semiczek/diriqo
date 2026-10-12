import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire,stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

const root=new URL('../../',import.meta.url),origin='https://office-preview.vercel.app';
const refs={hub:'amuhcvnvubsrvsfclqtg',diriqo:'pkjzoplczxqqmmstnqgy'};
async function load(host,file,bindings,result){
 const source=(await readFile(new URL('integrations/'+host+'/'+file,root),'utf8'))
  .replace(/^import[\s\S]*?from ['"][^'"]+['"]\r?\n/gm,'').replace(/^export /gm,'');
 return vm.runInNewContext(stripTypeScriptTypes(source)+'\n;('+result+')',{URL,Set,Headers,...bindings},{filename:host+'/'+file});
}
const TestDate=class extends Date {static now(){return Date.parse('2026-10-11T12:00:00Z');}};
const guard={};for(const host of Object.keys(refs))guard[host]=await load(host,'lib/office/staging-guard.ts',{Date:TestDate},'officeStagingDecision');
const envFor=host=>({OFFICE_STAGING_ONLY:'1',OFFICE_STAGING_EXPIRES_AT:'2026-10-12T17:00:00Z',OFFICE_STAGING_PROJECT_REF:refs[host],NEXT_PUBLIC_SUPABASE_URL:'https://'+refs[host]+'.supabase.co',OFFICE_PUBLIC_ORIGIN:origin});
const request=(path,method='GET',requestOrigin)=>({url:origin+path,method,origin:requestOrigin});

for(const host of Object.keys(refs)){
 test(host+': staging configuration binds the approved project and origin before any route',()=>{
  const run=(env,path='/office')=>guard[host](host,request(path),env);
  assert.equal(run({}).kind,'disabled');assert.equal(run(envFor(host)).kind,'allow');
  const fallback=envFor(host);delete fallback.OFFICE_PUBLIC_ORIGIN;fallback.VERCEL_URL='office-preview.vercel.app';assert.equal(run(fallback).kind,'allow');
  const variants=[{OFFICE_STAGING_ONLY:'true'},{OFFICE_STAGING_ONLY:'0'},{OFFICE_STAGING_ONLY:''},{OFFICE_STAGING_PROJECT_REF:undefined},{OFFICE_PUBLIC_ORIGIN:undefined},
   ...['wfcpfraxiuhuglnuaxqj','yrxfozthravgbbcqklzy',refs[host==='hub'?'diriqo':'hub']].map(ref=>({OFFICE_STAGING_PROJECT_REF:ref,NEXT_PUBLIC_SUPABASE_URL:'https://'+ref+'.supabase.co'})),
   ...['http://'+refs[host]+'.supabase.co','https://'+refs[host]+'.supabase.co/','https://'+refs[host]+'.supabase.co.evil.test'].map(NEXT_PUBLIC_SUPABASE_URL=>({NEXT_PUBLIC_SUPABASE_URL})),
   {SUPABASE_URL:'https://wfcpfraxiuhuglnuaxqj.supabase.co'},
   ...['https://user:password@office-preview.vercel.app','https://office-preview.vercel.app/','https://office-preview.vercel.app?x=1','http://office-preview.vercel.app','https://127.0.0.1','https://office-preview.vercel.app:8443'].map(OFFICE_PUBLIC_ORIGIN=>({OFFICE_PUBLIC_ORIGIN}))];
  for(const patch of variants){const result=run({...envFor(host),...patch});assert.equal(result.kind,'deny',JSON.stringify(patch));assert.equal(result.status,503);}
  assert.equal(guard[host](host,{...request('/office'),url:'https://evil.invalid/office'},envFor(host)).status,403);
 });

 test(host+': exact Office/auth routes, methods and mutation Origin are enforced',()=>{
  const run=(path,method='GET',requestOrigin)=>guard[host](host,request(path,method,requestOrigin),envFor(host));
  for(const path of ['/office','/office/settings','/api/office/files','/api/office/context','/api/active-company','/logout',host==='hub'?'/login':'/sign-in']){
   assert.equal(run(path).kind,'allow',path);assert.equal(run(path,'HEAD').kind,'allow',path);
  }
  assert.equal(run('/').kind,'redirect');assert.equal(run('/','POST',origin).status,405);
  const writes=[['/office','POST'],['/office/settings','POST'],['/api/office/files','POST'],['/logout','POST'],['/api/active-company',host==='hub'?'PATCH':'POST'],[host==='hub'?'/api/active-company/switch':'/auth/sign-in','POST']];
  if(host==='diriqo')writes.push(['/api/office/company','POST']);
  for(const [path,method]of writes){assert.equal(run(path,method,origin).kind,'allow',path);for(const bad of [undefined,'null','https://other.vercel.app','http://office-preview.vercel.app'])assert.equal(run(path,method,bad).status,403,path);}
  assert.equal(run('/api/office/context','POST',origin).status,405);
  for(const path of ['/sign-up','/sign-up/child','/register','/onboarding','/jobs','/admin','/api/jobs','/api/office/private','/api/office/files/child','/office-other','/office/anything','/logout/child','/auth/callback','/settings.png','/api/jobs.png','//office','/off%69ce','/api%2foffice/files','/_next/data/build/jobs.json','/_next/webpack-hmr'])assert.equal(run(path).kind,'deny',path);
 });

 test(host+': staging expires at the exact UTC boundary and missing or invalid deadlines fail closed',()=>{
  for(const expiration of [undefined,'','2026-10-11T11:59:59Z','2026-10-11T12:00:00Z','2026-10-12T19:00:00+02:00','2026-10-12','2026-02-31T17:00:00Z','2026-10-12T17:00:00.000Z','not-a-date']){
   const result=guard[host](host,request('/office'),{...envFor(host),OFFICE_STAGING_EXPIRES_AT:expiration});
   assert.equal(result.status,503,String(expiration));assert.equal(result.code,'OFFICE_STAGING_ENDED');
  }
  assert.equal(guard[host](host,request('/office'),{...envFor(host),OFFICE_STAGING_EXPIRES_AT:'2026-10-11T12:00:01Z'}).kind,'allow');
  assert.equal(guard[host](host,request('/office'),{OFFICE_STAGING_EXPIRES_AT:'expired'}).kind,'disabled');
 });

 test(host+': only known assets and bounded local image optimization bypass auth',()=>{
  const run=(path,method='GET')=>guard[host](host,request(path,method,origin),envFor(host));
  const logo=host==='hub'?'/jspd-logo-blue.png':'/diriqo-logo-full.png';
  for(const path of [logo,'/icon.png','/apple-icon.png','/_next/static/chunks/abc.js','/_next/static/css/style.css','/_next/static/media/font.woff2','/_next/image?url='+encodeURIComponent(logo)+'&w=640&q=75']){
   assert.equal(run(path).kind,'allow',path);assert.equal(run(path).staticAsset,true);assert.equal(run(path,'POST').status,405);
  }
  for(const path of ['/other.png','/_next/static/chunks/a.map','/_next/static/.env','/_next/image?url=https%3A%2F%2Finternal.invalid&w=640&q=75','/_next/image?url=%2Fapi%2Foffice%2Ffiles&w=640&q=75','/_next/image?url='+encodeURIComponent(logo)+'&url=/api/jobs&w=640&q=75','/_next/image?url='+encodeURIComponent(logo)+'&w=9999&q=75'])assert.equal(run(path).kind,'deny',path);
 });
}

async function proxyHarness(host,env={},user={id:'auth-user'}){
 let authCalls=0;const queries=[];
 const reply=(kind,url)=>({kind,url,headers:new Headers(),cookies:{set(){}}});
 const supabase={auth:{async getUser(){authCalls++;return {data:{user},error:null};}},from(table){queries.push(table);const rows=table==='profiles'?[{id:'profile',auth_user_id:'auth-user'}]:table==='company_members'?[{id:'member',company_id:'company',role:'company_admin',is_active:true}]:[];return {select(){return this;},eq(){return this;},or(){return this;},limit(){return this;},async maybeSingle(){return {data:rows[0]??null,error:null};},then(resolve,reject){return Promise.resolve({data:rows,error:null}).then(resolve,reject);}};}};
 const bindings={officeStagingDecision:guard[host],process:{env},Headers,URL,createServerClient:()=>supabase,
  NextResponse:{next:()=>reply('next'),redirect:url=>reply('redirect',String(url)),json:(body,init)=>({...reply('json'),body,status:init.status})},
  hasAnyHubAccessRole:()=>true,hasCompanyMemberRole:()=>true,hasPlatformAdminAccess:async()=>false,
  LOCALE_COOKIE_NAME:'locale',LOCALE_HEADER_NAME:'locale',LOCALE_COUNTRY_HEADER_NAME:'country',normalizeLocale:()=>null,getPreferredLocaleFromHeader:()=> 'cs',getFallbackLocaleFromCountry:()=> 'cs',
  DEFAULT_ACTIVE_MODULES:[],canAccessMenuPath:()=>true,getDefaultMenuPath:()=> '/',normalizeActiveModules:value=>value,normalizeMenuItemVisibility:()=>({})};
 const exports=await load(host,'proxy.ts',bindings,'({proxy,config,isLegacyProxyPath,LEGACY_PROXY_MATCHERS})');
 return {...exports,queries,authCalls:()=>authCalls,run(path,method='GET',originHeader){return exports.proxy({url:origin+path,nextUrl:new URL(origin+path),method,headers:new Headers(originHeader?{origin:originHeader}:{}),cookies:{get(){},set(){}}});}};
}

test('both actual proxies cover every route and reject disabled staging paths before provider access',async()=>{
 for(const host of Object.keys(refs)){
  const p=await proxyHarness(host,envFor(host));assert.deepEqual(Array.from(p.config.matcher),['/:path*']);
  for(const path of ['/sign-up','/api/jobs','/api/jobs.png','/logout/child'])assert.equal((await p.run(path)).status,404);
  assert.equal((await p.run('/office','POST')).status,403);assert.equal(p.authCalls(),0);assert.equal(p.queries.length,0);
  assert.equal((await p.run('/')).url,origin+'/office');assert.equal((await p.run('/_next/static/chunks/abc.js')).kind,'next');
  assert.equal((await p.run('/office','POST',origin)).kind,'next');assert.equal(p.authCalls(),1);
 }
});

test('actual proxies fail closed on a production reference and keep authenticated logout separate',async()=>{
 for(const host of Object.keys(refs)){
  const blocked=await proxyHarness(host,{...envFor(host),OFFICE_STAGING_PROJECT_REF:'wfcpfraxiuhuglnuaxqj'});
  assert.equal((await blocked.run('/office')).status,503);assert.equal(blocked.authCalls(),0);
  const loggedIn=await proxyHarness(host,envFor(host));assert.equal((await loggedIn.run('/logout')).kind,'next');assert.equal(loggedIn.authCalls(),1);assert.equal(loggedIn.queries.length,0);
  const anonymous=await proxyHarness(host,envFor(host),null);assert.equal((await anonymous.run('/logout')).url,origin+(host==='hub'?'/login':'/sign-in'));
 }
});

test('normal-mode matcher emulation agrees with the installed Next compiler and bypasses new routes',async()=>{
 for(const host of Object.keys(refs)){
  const p=await proxyHarness(host);const require=createRequire(new URL('integrations/'+host+'/package.json',root));
  const {getMiddlewareMatchers}=require('next/dist/build/analysis/get-page-static-info.js');
  const matchers=getMiddlewareMatchers(Array.from(p.LEGACY_PROXY_MATCHERS),{}).map(item=>new RegExp(item.regexp));
  const candidates=['/','/index','/index.json','/does-not-exist','/sign-up','/logout/child','/api/active-company/switch','/_next/static/chunks/abc.js'];
  for(const pattern of p.LEGACY_PROXY_MATCHERS){const path=pattern.replace('/:path*','');candidates.push(path,path+'/',path+'.json',path+'/child',path+'/child.json','/_next/data/build'+path+'.json');}
  for(const path of candidates)assert.equal(p.isLegacyProxyPath(path),matchers.some(re=>re.test(path)),host+': '+path);
  assert.equal((await p.run('/new-public-route')).kind,'next');assert.equal(p.authCalls(),0);assert.equal(p.queries.length,0);
 }
});

test('the two host adapters use identical audited staging guard source',async()=>{
 assert.equal(await readFile(new URL('integrations/hub/lib/office/staging-guard.ts',root),'utf8'),await readFile(new URL('integrations/diriqo/lib/office/staging-guard.ts',root),'utf8'));
});
