import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const logs=[]
function load(file){
  const mod={exports:{}}
  const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  const quietConsole=Object.fromEntries(['log','warn','error','info','debug'].map(key=>[key,(...args)=>logs.push(args)]))
  vm.runInNewContext('(function(require,module,exports){'+code+'\n})',{console:quietConsole},{filename:file})(id=>{
    assert.equal(id,'./upload-messages','No runtime dependency or side effect is allowed')
    return load(resolve(dirname(file),'upload-messages.ts'))
  },mod,mod.exports)
  return mod.exports
}
const {classifyOfficeUploadError}=load(resolve(root,'lib/office/upload-errors.ts'))
const {officeUploadUserMessage,officeUploadStatuses,officeUploadMessages}=load(resolve(root,'lib/office/upload-messages.ts'))
const secret='Sensitive-company-client-Budget-240000.odt /srv/private/password.pem <customer>PRIVATE</customer>'
const withCode=(message,code)=>Object.assign(new Error(message),{code})

test('Office upload classification distinguishes transport, parser, protection, limits and worker failures',()=>{
  const cases=[
    [new TypeError('Failed to parse multipart '+secret),'multipart','OFFICE_UPLOAD_INVALID',400],
    [new Error('OFFICE_FORMAT: Expected multipart upload'),'multipart','OFFICE_UPLOAD_INVALID',400],
    [new Error('OFFICE_FORMAT: Invalid file'),'import','OFFICE_UPLOAD_INVALID',400],
    [new Error('OFFICE_FORMAT: Upload size exceeds limit'),'multipart','OFFICE_HOST_LIMIT',413],
    [new Error('OFFICE_HOST_LIMIT'),'import','OFFICE_HOST_LIMIT',413],
    [new Error('OFFICE_FORMAT: Malformed ODT XML'),'import','OFFICE_IMPORT_FORMAT',422],
    [new Error('OFFICE_FORMAT: Only Excel 97–2003 BIFF8 XLS is supported'),'import','OFFICE_IMPORT_FORMAT',422],
    [new Error('OFFICE_FORMAT: Encrypted or obfuscated DOC is not accepted'),'import','OFFICE_IMPORT_PROTECTED',422],
    [new Error('OFFICE_FORMAT: Macro sheets are not accepted'),'import','OFFICE_IMPORT_PROTECTED',422],
    [new Error('OFFICE_FORMAT: OpenDocument external resources are disabled'),'import','OFFICE_IMPORT_PROTECTED',422],
    [withCode(secret,'UNSAFE_FORMULA'),'import','OFFICE_IMPORT_PROTECTED',422],
    [new Error('OFFICE_FORMAT: ODT text expansion limit exceeded'),'import','OFFICE_IMPORT_LIMIT',413],
    [new Error('OFFICE_FORMAT: ZIP expansion limit exceeded'),'import','OFFICE_IMPORT_LIMIT',413],
    [withCode(secret,'CONTENT_LIMIT'),'import','OFFICE_IMPORT_LIMIT',413],
    [withCode(secret,'ERR_WORKER_OUT_OF_MEMORY'),'import','OFFICE_IMPORT_LIMIT',413],
    [new Error('OFFICE_FORMAT: Import processing time limit exceeded'),'import','OFFICE_IMPORT_TIMEOUT',422],
    [new Error('OFFICE_FORMAT: Import worker exited (1)'),'import','OFFICE_IMPORT_RUNTIME',503],
    [withCode(secret,'ERR_MODULE_NOT_FOUND'),'import','OFFICE_IMPORT_RUNTIME',503],
    [withCode(secret,'Z_DATA_ERROR'),'import','OFFICE_IMPORT_FORMAT',422],
    [new Error(secret),'import','OFFICE_IMPORT_RUNTIME',503],
  ]
  for(const [error,stage,expected,status] of cases){
    const actual=classifyOfficeUploadError(error,stage)
    assert.equal(actual.code,expected,error.message)
    assert.equal(actual.status,status)
    assert.deepEqual(Object.keys(actual).sort(),['code','status'])
    assert.equal(JSON.stringify(actual).includes(secret),false)
  }
  assert.deepEqual(logs,[],'No raw diagnostics are logged')
})

test('Ambiguous ZIP errors and lookalike payloads never claim an unsupported specific cause',()=>{
  for(const message of ['Encrypted, oversized or unsupported ZIP entry','Invalid ZIP or file too large',
    'Invalid workbook or macros','Macro sheets are not accepted '+secret,'Import processing time limit exceeded '+secret]){
    assert.equal(classifyOfficeUploadError(new Error('OFFICE_FORMAT: '+message),'import').code,'OFFICE_IMPORT_FORMAT')
  }
  assert.equal(classifyOfficeUploadError(new Error(secret+' OFFICE_HOST_LIMIT'),'import').code,'OFFICE_IMPORT_RUNTIME')
  assert.equal(classifyOfficeUploadError(new Error('filename is encrypted.doc'),'import').code,'OFFICE_IMPORT_RUNTIME')
})

test('Unknown exceptions, hostile accessors and long messages are never evaluated, returned or logged',()=>{
  let reads=0
  const getters={get message(){reads++;throw Error(secret)},get code(){reads++;throw Error(secret)}}
  const proxy=new Proxy({}, {getOwnPropertyDescriptor(){throw Error(secret)}})
  const values=[null,undefined,42,secret,getters,proxy,new Error(secret.repeat(1000)),
    {message:secret,filename:secret,content:secret,stack:secret,token:secret},
    Object.create({message:'OFFICE_HOST_LIMIT'})]
  for(const error of values){
    const result=classifyOfficeUploadError(error,'import')
    assert.equal(result.code,'OFFICE_IMPORT_RUNTIME')
    assert.equal(JSON.stringify(result),'{"code":"OFFICE_IMPORT_RUNTIME","status":503}')
  }
  assert.equal(reads,0);assert.deepEqual(logs,[])
})

test('Every public upload category has fixed messages for all seven Office locales',()=>{
  assert.deepEqual(Object.keys(officeUploadMessages).sort(),['cs','de','en','pl','sk','sq','tr'])
  for(const locale of Object.keys(officeUploadMessages))for(const code of Object.keys(officeUploadStatuses)){
    const message=officeUploadUserMessage(code,locale)
    assert.equal(typeof message,'string');assert.ok(message.length>25)
    assert.equal(message.includes(secret),false)
    assert.equal(message.includes('OFFICE_'),false)
    assert.equal(officeUploadUserMessage(code,'unknown'),officeUploadUserMessage(code,'cs'))
  }
  assert.equal(officeUploadUserMessage('OFFICE_IMPORT_FORMAT','__proto__'),officeUploadUserMessage('OFFICE_IMPORT_FORMAT','cs'))
})

test('Client messages require an exact code allowlist, never parser text or arbitrary response fields',()=>{
  for(const code of [null,undefined,{},secret,'OFFICE_FORMAT','__proto__','constructor','toString',
    'OFFICE_IMPORT_FORMAT: '+secret,'OFFICE_IMPORT_RUNTIME\n'+secret,'OFFICE_UPLOAD_INVALID '+secret,
    'OFFICE_TENANT_CHANGED',withCode(secret,'OFFICE_IMPORT_FORMAT')]){
    assert.equal(officeUploadUserMessage(code,'cs'),undefined)
  }
  for(const code of Object.keys(officeUploadStatuses)){
    const classified=classifyOfficeUploadError(new Error(code),'import')
    assert.equal(classified.code,code,'Safe rethrows retain their category')
  }
  assert.deepEqual(logs,[])
})
