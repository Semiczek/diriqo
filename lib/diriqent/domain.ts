export const AI_RATE_VERSION='diriqent-test-czk-v1'
export const AI_MODEL='gpt-5.6-terra'
export type AiKind='chat'|'proposal'|'smart_quotes.ocr'|'inventory.ocr'|'invoicing.ocr'
export const AI_KINDS:readonly AiKind[]=['chat','proposal','smart_quotes.ocr','inventory.ocr','invoicing.ocr']
export const isAiKind=(value:unknown):value is AiKind=>typeof value==='string' && AI_KINDS.includes(value as AiKind)
export const aiProduct=(kind:AiKind)=>kind==='chat'||kind==='proposal'?'ai_assistant':kind.split('.')[0]
export const aiCapability=(kind:AiKind)=>kind==='chat'||kind==='proposal'?'ai_assistant.conversation.run':`${kind}.request`
export const formatCredits=(units:number)=>new Intl.NumberFormat('cs-CZ',{style:'currency',currency:'CZK'}).format(units/100)
export const MAX_PROMPT=4000
export const MAX_FILE_BYTES=3*1024*1024
export const MAX_OUTPUT_TOKENS=2400
export type JobDraft={title:string;description:string;address:string;customerId:string|null;startAt:string|null;endAt:string|null;price:number|null}
export type ChatResult={answer:string;jobProposal:JobDraft|null}
export type OcrItem={name:string;quantity:number|null;unit:string;unitPrice:number|null;vatRate:number|null;total:number|null;confidence:'high'|'medium'|'low';source:string}
export type OcrResult={documentType:string;supplierName:string;documentNumber:string;date:string|null;currency:string;items:OcrItem[];total:number|null;warnings:string[];extractedText:string}
export type AiUsage={inputTokens:number;cachedTokens:number;outputTokens:number}

/** Pricing snapshot: USD provider micro-units, CZK credit cents. Never equate credit to provider cost. */
export function usageCharge(usage:AiUsage,reserved:number) {
  for(const n of [...Object.values(usage),reserved]) if(!Number.isSafeInteger(n)||n<0) throw new Error('Neplatná spotřeba.')
  if(usage.cachedTokens>usage.inputTokens) throw new Error('Neplatná spotřeba cache.')
  const providerMicrousd=Math.ceil(((usage.inputTokens-usage.cachedTokens)*2000000+usage.cachedTokens*200000+usage.outputTokens*12000000)/1000000)
  // Explicit test tariff: USD/CZK 25 and multiplier 3; do not silently change a saved rate version.
  const calculatedCredit=Math.ceil(providerMicrousd*7500/1000000)
  return {providerMicrousd,creditUnits:Math.min(reserved,calculatedCredit),unbilledUnits:Math.max(0,calculatedCredit-reserved)}
}
export function validateJobDraft(value:unknown,complete=false):JobDraft {
  if(!value||typeof value!=='object'||Array.isArray(value)) throw new Error('Neplatný návrh zakázky.')
  const d=value as Record<string,unknown>
  const text=(key:string,max:number)=>{if(typeof d[key]!=='string'||(d[key] as string).length>max) throw new Error('Neplatný návrh zakázky.');return (d[key] as string).trim()}
  const title=text('title',200),description=text('description',8000),address=text('address',1000)
  if(!title) throw new Error('Vyplňte název zakázky.')
  const customerId=d.customerId===null||d.customerId===''?null:String(d.customerId)
  if(customerId&&!/^[0-9a-f-]{36}$/i.test(customerId)) throw new Error('Neplatný zákazník.')
  const startAt=d.startAt ? new Date(String(d.startAt)).toISOString() : null
  const endAt=d.endAt ? new Date(String(d.endAt)).toISOString() : null
  const price=d.price===null?null:d.price
  if(price!==null&&(typeof price!=='number'||!Number.isFinite(price)||price<0||price>999999999)) throw new Error('Zkontrolujte cenu zakázky.')
  if(complete&&(!startAt||!endAt||endAt<=startAt||price===null)) throw new Error('Vyplňte cenu, začátek a pozdější konec zakázky.')
  return {title,description,address,customerId,startAt,endAt,price:price as number|null}
}
export function parseChatResult(text:string):ChatResult {
  const value=JSON.parse(text)
  if(typeof value.answer!=='string'||!value.answer.trim()||value.answer.length>16000) throw new Error('Asistent nevrátil použitelnou odpověď.')
  return {answer:value.answer,jobProposal:value.jobProposal?validateJobDraft(value.jobProposal):null}
}
export function parseOcrResult(text:string):OcrResult {
  const value=JSON.parse(text)
  if(!value||typeof value!=='object'||!Array.isArray(value.items)||value.items.length>100||!Array.isArray(value.warnings)) throw new Error('Dokument se nepodařilo spolehlivě přečíst.')
  const str=(v:unknown,max:number)=>{if(typeof v!=='string'||v.length>max) throw new Error('Neplatný výsledek OCR.');return v}
  const num=(v:unknown,max=999999999)=>{if(v===null)return null;if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>max)throw new Error('Neplatná číselná hodnota OCR.');return v}
  return {documentType:str(value.documentType,100),supplierName:str(value.supplierName,200),documentNumber:str(value.documentNumber,100),date:value.date===null?null:str(value.date,30),currency:str(value.currency,10),total:num(value.total),extractedText:str(value.extractedText,24000),warnings:value.warnings.slice(0,30).map((v:unknown)=>str(v,1000)),
    items:value.items.map((i:Record<string,unknown>)=>({name:str(i.name,200),quantity:num(i.quantity,1000000),unit:str(i.unit,20),unitPrice:num(i.unitPrice),vatRate:num(i.vatRate,100),total:num(i.total),confidence:['high','medium','low'].includes(String(i.confidence))?i.confidence as OcrItem['confidence']:'low',source:str(i.source,500)}))}
}
export function detectDocumentType(bytes:Uint8Array):'application/pdf'|'image/png'|'image/jpeg'|'image/webp'|null {
  if(bytes.length>=5&&String.fromCharCode(...bytes.slice(0,5))==='%PDF-')return 'application/pdf'
  if(bytes.length>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))return 'image/png'
  if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg'
  if(bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')return 'image/webp'
  return null
}

export function imageDimensions(bytes:Uint8Array,mime:string):{width:number;height:number}|null {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)
  if(mime==='image/png'&&bytes.length>=24)return {width:view.getUint32(16),height:view.getUint32(20)}
  if(mime==='image/jpeg') {
    let offset=2
    while(offset+8<bytes.length) {
      if(bytes[offset]!==255)return null
      const marker=bytes[offset+1]
      if(marker===216||marker===217){offset+=2;continue}
      const length=view.getUint16(offset+2)
      if(length<2||offset+length+2>bytes.length)return null
      if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker))return {height:view.getUint16(offset+5),width:view.getUint16(offset+7)}
      offset+=length+2
    }
  }
  if(mime==='image/webp'&&bytes.length>=30) {
    const kind=String.fromCharCode(...bytes.slice(12,16))
    if(kind==='VP8X')return {width:1+bytes[24]+(bytes[25]<<8)+(bytes[26]<<16),height:1+bytes[27]+(bytes[28]<<8)+(bytes[29]<<16)}
    if(kind==='VP8 ')return {width:view.getUint16(26,true)&16383,height:view.getUint16(28,true)&16383}
    if(kind==='VP8L'&&bytes[20]===47)return {width:1+(((bytes[22]&63)<<8)|bytes[21]),height:1+(((bytes[24]&15)<<10)|(bytes[23]<<2)|(bytes[22]>>6))}
  }
  return null
}
