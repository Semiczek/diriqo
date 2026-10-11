import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import vm from 'node:vm';

async function sourceModule(file,bindings,result){
 const path=new URL('../../integrations/diriqo/'+file,import.meta.url);
 const source=(await readFile(path,'utf8')).replace(/^import[\s\S]*?from ['"][^'"]+['"]\r?\n/gm,'')
  .replace(/^export default /gm,'').replace(/^export /gm,'');
 const {code}=await transform(source,{loader:file.endsWith('.tsx')?'tsx':'ts',jsxFactory:'jsx'});
 return vm.runInNewContext(code+'\n;('+result+')',bindings,{filename:file});
}
function auth({authenticated=true,signInError=null}={}){
 let calls=0;
 return {calls:()=>calls,client:{auth:{async signInWithPassword(){calls++;return {error:signInError};},async getUser(){return {data:{user:authenticated?{id:'synthetic-user'}:null},error:null};}}}};
}
test('Diriqo staging authenticated sign-in page selects Office without invoking onboarding',async()=>{
 for(const stage of [true,false]){
  let onboarding=0;const {client}=auth();const Page=await sourceModule('app/sign-in/page.tsx',{
   process:{env:stage?{OFFICE_STAGING_ONLY:'1'}:{}},createSupabaseServerClient:async()=>client,
   getPostLoginRedirect:async()=>{onboarding++;return '/onboarding';},redirect:location=>{throw Object.assign(Error('redirect'),{location});},jsx:()=>({}),Suspense:'Suspense',SignInForm:'SignInForm',
  },'SignInPage');
  await assert.rejects(Page(),error=>error.location===(stage?'/office':'/onboarding'));assert.equal(onboarding,stage?0:1);
 }
});
test('Diriqo real auth POST still verifies authentication and only staging changes its destination',async()=>{
 for(const stage of [true,false]){
  let onboarding=0;const h=auth();const POST=await sourceModule('app/auth/sign-in/route.ts',{
   process:{env:stage?{OFFICE_STAGING_ONLY:'1'}:{}},createSupabaseServerClient:async()=>h.client,
   getPostLoginRedirect:async()=>{onboarding++;return '/onboarding';},NextResponse:{json:(body,init)=>({body,...init})},
  },'POST');
  const response=await POST({json:async()=>({email:'office-synthetic@office-staging.invalid',password:'synthetic-test-only'})});
  assert.equal(response.body.ok,true);assert.equal(response.body.redirectTo,stage?'/office':'/onboarding');assert.equal(h.calls(),1);assert.equal(onboarding,stage?0:1);
  assert.equal(response.headers['Cache-Control'],'no-store');
 }
});
test('Diriqo staging auth POST never returns Office when the verified user is missing',async()=>{
 const h=auth({authenticated:false});const POST=await sourceModule('app/auth/sign-in/route.ts',{
  process:{env:{OFFICE_STAGING_ONLY:'1'}},createSupabaseServerClient:async()=>h.client,
  getPostLoginRedirect:async()=>{throw Error('Must not select a destination without verified auth');},NextResponse:{json:(body,init)=>({body,...init})},
 },'POST');
 const response=await POST({json:async()=>({email:'office-synthetic@office-staging.invalid',password:'synthetic-test-only'})});
 assert.equal(response.status,401);assert.equal(response.body.ok,false);assert.equal(response.body.redirectTo,undefined);
});
