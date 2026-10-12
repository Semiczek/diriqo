/** Read the actual stream, not a caller-controlled Content-Length, before parsing multipart. */
export async function readBoundedOfficeMultipart(request:Request,maxBytes=12*1024*1024+65536):Promise<FormData>{
 const type=request.headers.get('content-type')??'';
 if(!/^multipart\/form-data;\s*boundary=/i.test(type)||!request.body)throw new Error('OFFICE_FORMAT: Expected multipart upload');
 const reader=request.body.getReader(),chunks:Uint8Array[]=[];let length=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>maxBytes){await reader.cancel();throw new Error('OFFICE_FORMAT: Upload size exceeds limit');}chunks.push(value);}}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 return new Request('http://office.invalid',{method:'POST',headers:{'Content-Type':type},body:bytes}).formData();
}
