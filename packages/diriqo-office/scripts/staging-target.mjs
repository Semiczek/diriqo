/**
 * Read-only validation of an operator-reviewed staging manifest.
 * No network, environment lookup or URL override is accepted.
 *
 * This is NOT a cryptographic branch attestation or remote existence check.
 * Before use, compare every manifest entry with a fresh list_branches result
 * or the authenticated Supabase branch UI. The timestamp records that review.
 */
const EXPECTED=Object.freeze({
 hub:Object.freeze({parentRef:'yrxfozthravgbbcqklzy',organizationId:'ljkxtwounsysoalxgsvw'}),
 diriqo:Object.freeze({parentRef:'wfcpfraxiuhuglnuaxqj',organizationId:'uxtwbwyxadetdybttoug'})
});
const PRODUCTION_REFS=new Set(['wfcpfraxiuhuglnuaxqj','yrxfozthravgbbcqklzy']);
const TARGET_FIELDS=['projectRef','parentRef','organizationId','branchId','name','verifiedAt'];
const DAY=24*60*60*1000;
const FUTURE=5*60*1000;

function fail(message){
 const error=new Error('Unsafe staging target: '+message);
 error.code='UNSAFE_STAGING_TARGET';
 throw error;
}
function record(value,allowed,required,label){
 if(value===null||typeof value!=='object'||Array.isArray(value))fail(label+' must be a plain record.');
 const prototype=Object.getPrototypeOf(value);
 if(prototype!==Object.prototype&&prototype!==null)fail(label+' must be a plain record.');
 for(const key of Reflect.ownKeys(value)){
  if(typeof key!=='string'||!allowed.includes(key))fail(label+' contains an unexpected field.');
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  if(!descriptor||!Object.hasOwn(descriptor,'value'))fail(label+' must contain data fields, not accessors.');
 }
 for(const key of required)if(!Object.hasOwn(value,key))fail(label+' is missing a required field.');
}
function reviewedTime(value){
 if(typeof value!=='string'||!(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{3})?Z$/).test(value))
  fail('verifiedAt must be a UTC ISO timestamp.');
 const timestamp=Date.parse(value);
 const normalized=value.length===20?value.slice(0,-1)+'.000Z':value;
 if(!Number.isFinite(timestamp)||new Date(timestamp).toISOString()!==normalized)fail('verifiedAt is not a valid calendar timestamp.');
 return timestamp;
}
function target(value,host,now){
 record(value,TARGET_FIELDS,TARGET_FIELDS,host+' target');
 for(const field of TARGET_FIELDS)if(typeof value[field]!=='string')fail(host+' target fields must be strings.');
 if(!/^[a-z]{20}$/.test(value.projectRef))fail(host+' projectRef must contain exactly 20 lowercase letters.');
 if(PRODUCTION_REFS.has(value.projectRef))fail('production projectRef is forbidden.');
 if(value.parentRef!==EXPECTED[host].parentRef)fail(host+' parentRef does not match the expected parent.');
 if(value.organizationId!==EXPECTED[host].organizationId)fail(host+' organizationId does not match the expected organization.');
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.branchId))fail(host+' branchId must be a UUID.');
 if(value.name.length>200||!value.name.includes('office-staging')||/[\u0000-\u001f\u007f]/.test(value.name))
  fail(host+' branch name must contain office-staging and no control characters.');
 const timestamp=reviewedTime(value.verifiedAt);
 if(now-timestamp>DAY)fail(host+' branch verification is older than 24 hours.');
 if(timestamp-now>FUTURE)fail(host+' branch verification is more than 5 minutes in the future.');
 return Object.freeze({host,projectRef:value.projectRef,parentRef:value.parentRef,
  organizationId:value.organizationId,branchId:value.branchId,origin:'https://'+value.projectRef+'.supabase.co'});
}

export function validateTarget(manifest,host,{now=Date.now()}={}){
 if(host!=='hub'&&host!=='diriqo')fail('unknown host.');
 if(typeof now!=='number'||!Number.isSafeInteger(now)||now<0)fail('now must be a nonnegative finite integer timestamp.');
 record(manifest,['schemaVersion','hosts'],['schemaVersion','hosts'],'manifest');
 if(manifest.schemaVersion!==1)fail('unsupported manifest schemaVersion.');
 record(manifest.hosts,['hub','diriqo'],[host],'manifest hosts');
 const validated={};
 for(const name of Object.keys(manifest.hosts))validated[name]=target(manifest.hosts[name],name,now);
 if(validated.hub&&validated.diriqo&&validated.hub.projectRef===validated.diriqo.projectRef)
  fail('two hosts cannot share the same branch projectRef.');
 return validated[host];
}
