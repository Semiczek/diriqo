import type { OfficeActor, OfficeRequest, OfficeResponse, OfficeFile } from '../core/types.ts';
import {OfficeError,check,id,title,validateContent,validateRequest,validateExportAuditFormat,OFFICE_LIMITS} from '../core/validation.ts';
import {guardActor,type ImportInput} from './service.ts';
import {createHash} from 'node:crypto';
type RpcClient={rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:any;error:any}>};
/** Requires an authenticated Supabase client. The RPC independently authorizes operations. */
export class SupabaseOfficeService {
 private readonly client:RpcClient;
 constructor(client:RpcClient){this.client=client;}
 private async call(actor:OfficeActor,request:Record<string,unknown>):Promise<any>{const{data,error}=await this.client.rpc('office_request',{p_company_id:actor.tenantId,p_request:request,p_principal:actor.principal});if(error){try{const parsed=JSON.parse(error.message);if(parsed.code)throw new OfficeError(parsed.code,parsed.message,parsed.status??400);}catch(e){if(e instanceof OfficeError)throw e;}throw new OfficeError('PERSISTENCE_ERROR','Office storage operation failed.',500);}return data;}
 async request(actor:OfficeActor,input:OfficeRequest):Promise<OfficeResponse>{const request=validateRequest(input);const read=['list','listFiles','listVersions','readVersion','listProposals','readProposal','read','versions','proposals','permissions'].includes(request.op);guardActor(actor,!read);if(actor.principal==='ai')check(read||request.op==='propose','HUMAN_APPROVAL_REQUIRED','AI may read and propose; a human must apply changes.',403);return this.call(actor,request);}
 async import(actor:OfficeActor,input:ImportInput):Promise<{file:OfficeFile}>{guardActor(actor,true);check(actor.principal==='human','HUMAN_APPROVAL_REQUIRED','Human import required.',403);check(input.original.bytes instanceof Uint8Array&&input.original.bytes.length>0&&input.original.bytes.length<=OFFICE_LIMITS.originalBytes,'FILE_LIMIT','Original exceeds 12 MiB limit.');const bytes=input.original.bytes;return this.call(actor,{op:'import',title:title(input.title),parentId:input.parentId==null?null:id(input.parentId),content:validateContent(input.content),original:{name:title(input.original.name),mime:title(input.original.mime,160),size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),base64:Buffer.from(bytes).toString('base64')},idempotencyKey:id(input.idempotencyKey)});}
 async original(actor:OfficeActor,fileId:string):Promise<{name:string;mime:string;bytes:Uint8Array}>{guardActor(actor);const result=await this.call(actor,{op:'original',id:id(fileId)});return{name:result.name,mime:result.mime,bytes:Buffer.from(result.base64,'base64')};}
 async recordExport(actor:OfficeActor,fileId:string,format:string):Promise<void>{guardActor(actor);validateExportAuditFormat(format);await this.call(actor,{op:'recordExport',id:id(fileId),format});}
}
