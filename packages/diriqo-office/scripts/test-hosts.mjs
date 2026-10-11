import {lstat,realpath,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const sharedSources=['lib/office/context.ts','lib/hub-access.ts','proxy.ts','lib/supabase-server.ts',
 'app/logout/page.tsx','lib/office/staging-guard.ts','lib/office/http-limits.ts','lib/office/client-context.ts',
 'lib/office/context-messages.ts','app/api/office/context/route.ts','app/api/office/files/route.ts',
 'app/office/actions.ts','app/office/OfficeClient.tsx'];
const requirements={
 hub:[...sharedSources,'app/login/page.tsx'],
 diriqo:[...sharedSources,'app/sign-in/page.tsx','app/auth/sign-in/route.ts','app/api/office/company/route.ts','lib/active-company-switch.ts']
};
const requiredRuntime=['node_modules/next/dist/build/analysis/get-page-static-info.js'];
const readGit=(args,cwd)=>execFileSync('git',args,{
 cwd,encoding:'utf8',timeout:10000,maxBuffer:65536,
 env:{...process.env,GIT_OPTIONAL_LOCKS:'0'},stdio:['ignore','pipe','pipe']
});
function setupError(detail){
 return new Error('HOST_TEST_SETUP_REQUIRED: '+detail+'. Prepare isolated integrations/hub and integrations/diriqo checkouts and apply their reviewed Office patches as described in docs/ENABLEMENT.md. No clone, installation or network request is performed by this command.');
}

/** Validate actual local checkout sources. A missing host never becomes a skipped PASS. */
export async function inspectHostTestSources({workspace=root,fs={lstat,realpath},git=readGit}={}){
 const hosts=[];
 for(const [host,files]of Object.entries(requirements)){
  const location='integrations/'+host,repo=resolve(workspace,location);
  let entry;try{entry=await fs.lstat(repo);}catch{throw setupError(location+' is missing');}
  if(!entry.isDirectory()||entry.isSymbolicLink())throw setupError(location+' must be a local checkout directory');
  let top,head,canonical;
  try{
   canonical=resolve(await fs.realpath(repo));
   top=resolve(await fs.realpath(git(['rev-parse','--show-toplevel'],repo).trim()));
   head=git(['rev-parse','HEAD'],repo).trim();
  }catch{throw setupError(location+' is not an accessible Git checkout');}
  if(top!==canonical||!/^[a-f0-9]{40,64}$/i.test(head))throw setupError(location+' must be its own Git checkout');
  for(const file of [...files,...requiredRuntime]){
   let source;try{source=await fs.lstat(resolve(repo,file));}catch{throw setupError(location+'/'+file+' is missing');}
   if(!source.isFile()||source.isSymbolicLink())throw setupError(location+'/'+file+' must be a regular source file');
  }
  hosts.push({host,head,sourceFiles:files.length,runtimeFiles:requiredRuntime.length});
 }
 return hosts;
}

async function main(){
 const args=process.argv.slice(2);
 if(args.some(arg=>arg!=='--check')||args.length>1)throw new Error('Usage: node scripts/test-hosts.mjs [--check]');
 const hosts=await inspectHostTestSources();
 const folder=resolve(root,'tests/host'),files=(await readdir(folder)).filter(name=>name.endsWith('.test.mjs')).sort();
 if(!files.length)throw new Error('Host test suite is missing');
 console.log(JSON.stringify({result:'HOST_SOURCES_READY',hosts,testFiles:files.length,scope:'Actual isolated source, inert auth/Next ports; not live staging evidence'}));
 if(args.includes('--check'))return;
 // Explicit files avoid shell glob differences and never run shared tests twice.
 execFileSync(process.execPath,['--experimental-strip-types','--test',...files.map(name=>resolve(folder,name))],{
  cwd:root,stdio:'inherit'
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{await main();}catch(error){
  console.error(error?.message??'Host contract tests failed');
  process.exitCode=1;
 }
}
