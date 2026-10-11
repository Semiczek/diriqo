import {readFile,readdir,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export async function checkOfficeAssets(){
 const sha=b=>createHash('sha256').update(b).digest('hex');
 const directory='licenses/assets';
 const expected=['Geist-OFL.txt','Geist-Regular.ttf','evidence.json'];
 if((await lstat(directory)).isSymbolicLink())throw Error('Unreviewed asset directory symlink');
 const entries=await readdir(directory,{withFileTypes:true});
 if(entries.length!==expected.length||entries.some(e=>!e.isFile()||!expected.includes(e.name)))throw Error('Unreviewed asset or symlink');
 const evidence=JSON.parse(await readFile(directory+'/evidence.json','utf8'));
 if(evidence.schemaVersion!==1||evidence.assets.length!==1)throw Error('Unreviewed asset evidence');
 const a=evidence.assets[0];
 if(a.name!=='Geist Regular'||a.version!=='1.800'||a.license!=='OFL-1.1'||a.modified!==false||a.path!==directory+'/Geist-Regular.ttf'||a.licensePath!==directory+'/Geist-OFL.txt'||a.sha256!=='bde046ddd9f20be35b0bd56cc79eb752b967fb6661a3fe76cb067bb09f871d76'||a.licenseSha256!=='1781d2806a07d91c4edf4740b88449fab7d0eadad53f7c351b94cd4d4eb8c00f')throw Error('Unreviewed font identity');
 const font=await readFile(a.path), license=await readFile(a.licensePath);
 if(sha(font)!==a.sha256||sha(license)!==a.licenseSha256)throw Error('Changed font/license asset');
 if(!license.toString().includes('Copyright 2024 The Geist Project Authors')||!license.toString().includes('SIL OPEN FONT LICENSE Version 1.1'))throw Error('Font license/copyright missing');
 const generated=await readFile('src/server/pdf-font-data.ts','utf8');
 const embedded=generated.match(/export const PDF_FONT_BASE64 = '([A-Za-z0-9+/=]+)';/);
 if(!embedded||sha(Buffer.from(embedded[1],'base64'))!==a.sha256||!generated.includes(a.sha256))throw Error('Generated font differs from reviewed asset');
 const embeddedLicense=generated.match(/export const PDF_FONT_LICENSE_BASE64 = '([A-Za-z0-9+/=]+)';/);
 if(!embeddedLicense||sha(Buffer.from(embeddedLicense[1],'base64'))!==a.licenseSha256)throw Error('Generated font license differs from reviewed asset');
 if(a.source!=='https://raw.githubusercontent.com/vercel/next.js/v16.2.0/packages/next/src/compiled/@vercel/og/Geist-Regular.ttf'||a.licenseSource!=='https://raw.githubusercontent.com/vercel/geist-font/4d655731f83507f0258ce5541c297b6553d5d081/OFL.txt')throw Error('Unreviewed font provenance');
 return evidence.assets;
}
