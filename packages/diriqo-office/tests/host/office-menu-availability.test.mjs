import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

const root=new URL('../../',import.meta.url);
const A='00000000-0000-4000-8000-000000001001',B='00000000-0000-4000-8000-000000001002';
async function authored(file,bindings,expression){
 let source=await readFile(new URL(file,root),'utf8');
 source=source.replace(/^import ['"]server-only['"]\r?\n/gm,'').replace(/^import[\s\S]*?from ['"][^'"]+['"]\r?\n/gm,'').replace(/^export /gm,'');
 return vm.runInNewContext(stripTypeScriptTypes(source,{mode:'transform'})+'\n;('+expression+')',{Error,...bindings},{filename:file});
}
async function normalizer(){
 const source=await readFile(new URL('integrations/hub/components/DashboardShell.tsx',root),'utf8');
 const match=source.match(/function normalizeActiveCompanyPayload\([\s\S]*?\r?\n}\r?\n/);
 assert.ok(match,'Actual host normalizer must be present');
 return vm.runInNewContext(stripTypeScriptTypes(match[0])+';normalizeActiveCompanyPayload',{DEFAULT_ACTIVE_MODULES:['cleaning']});
}

test('Hub menu cache preserves enabled Office and clears it for a disabled or unknown target',async()=>{
 const normalize=await normalizer();
 assert.equal(normalize({companyId:A,officeEnabled:true}).officeEnabled,true);
 for(const officeEnabled of [false,undefined,null,'true',1])assert.equal(normalize({companyId:B,officeEnabled}).officeEnabled,false);
 const restored=normalize(JSON.parse(JSON.stringify(normalize({companyId:A,officeEnabled:true}))));
 assert.equal(restored.officeEnabled,true,'Session cache round trip preserves a verified boolean');
});

test('Hub company switching returns the target company Office flag after membership validation',async()=>{
 const calls=[],members=[{id:'member-a',companyId:A,companyName:'A',role:'manager'},{id:'member-b',companyId:B,companyName:'B',role:'manager'}];
 const build=await authored('integrations/hub/lib/active-company-switch.ts',{
  getCompanyMembershipContext:async()=>({profile:{id:'profile',full_name:'Name',email:'test@example.invalid'},memberships:members.map(member=>({id:member.id,company_id:member.companyId,companies:{name:member.companyName},role:member.role,is_active:true}))}),
  createSupabaseServerClient:async()=>({}),loadCompanyActiveModules:async()=>['gastro'],loadCompanyMenuItemVisibility:async()=>null,
  getDefaultMenuPath:()=> '/',readOfficeAvailability:async id=>{calls.push(id);return id===A;},
 },'buildActiveCompanySwitchPayload');
 const normalize=await normalizer();
 assert.equal(normalize(await build(B)).officeEnabled,false);
 assert.equal(normalize(await build(A)).officeEnabled,true);
 assert.deepEqual(calls,[B,A]);
 await assert.rejects(build('00000000-0000-4000-8000-000000001003'),/K teto firme nemate pristup/);
 assert.deepEqual(calls,[B,A],'No Office query before membership authorization');
});

for(const host of ['hub','diriqo'])test(host+': Office availability queries only the authorized company and fails closed',async()=>{
 for(const result of [{data:{enabled:true},error:null},{data:{enabled:false},error:null},{data:null,error:null},{data:{enabled:true},error:{message:'denied'}}]){
  const calls=[];
  const read=await authored('integrations/'+host+'/lib/office/availability.ts',{createSupabaseServerClient:async()=>({
   from(table){calls.push(['from',table]);return{select(columns){calls.push(['select',columns]);return this},eq(column,value){calls.push(['eq',column,value]);return this},maybeSingle:async()=>result}}
  })},'readOfficeAvailability');
  assert.equal(await read(B),!result.error&&result.data?.enabled===true);
  assert.deepEqual(calls,[['from','office_settings'],['select','enabled'],['eq','company_id',B]]);
 }
});

test('Hub POS menu keeps the existing Gastro, role and membership visibility requirements',async()=>{
 const config=await authored('integrations/hub/lib/menu/menuConfig.ts',{},'({COMPANY_MODULES,DEFAULT_ACTIVE_MODULES,HUB_ROLES,MENU_ITEMS,MENU_SECTION_LABELS,MENU_SECTION_ORDER,isMenuItemId})');
 const canSee=await authored('integrations/hub/lib/menu/menuPermissions.ts',config,'canSeeMenuItem');
 const pos=config.MENU_ITEMS.find(item=>item.id==='gastroPos');assert.equal(pos.path,'/gastro/pos');
 assert.equal(canSee(pos,'manager',['gastro'],null),true);
 assert.equal(canSee(pos,'manager',['cleaning'],null),false);
 assert.equal(canSee(pos,'user',['gastro'],null),false);
 assert.equal(canSee(pos,'manager',['gastro'],{gastroPos:false}),false);
 assert.equal(canSee(pos,'company_admin',['cleaning'],null),false);
});
