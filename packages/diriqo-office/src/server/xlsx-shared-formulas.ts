/** OOXML shared formulas store one A1 formula and relative followers. Never evaluates input. */
const fail=(message:string):never=>{throw new Error('OFFICE_FORMAT: '+message);};
const columnName=(column:number)=>{let text='';for(let n=column+1;n>0;n=Math.floor((n-1)/26))text=String.fromCharCode(65+(n-1)%26)+text;return text;};
export function translateSharedFormula(formula:string,rowDelta:number,columnDelta:number):string {
 if(formula.length>4096)fail('Shared formula exceeds length limit');
 let result='',index=0;
 while(index<formula.length){
  const ch=formula[index];
  if(ch==='"'||ch==="'"){
   const begin=index++,quote=ch;let closed=false;
   while(index<formula.length){if(formula[index++]===quote){if(formula[index]===quote)index++;else{closed=true;break;}}}
   if(!closed)fail('Invalid shared formula quoted text');result+=formula.slice(begin,index);continue;
  }
  const number=/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(formula.slice(index));
  if(number){result+=number[0];index+=number[0].length;continue;}
  const token=/^[\p{L}_$][\p{L}\p{N}_.$]*/u.exec(formula.slice(index));
  if(!token){result+=ch;index++;continue;}
  const value=token[0];index+=value.length;
  const ref=/^(\$?)([A-Za-z]+)(\$?)([1-9][0-9]*)$/.exec(value);
  // A1-like sheet names and function names are identifiers, never shifted cells.
  if(!ref||/^\s*[!(]/.test(formula.slice(index))){result+=value;continue;}
  let col=0;for(const c of ref[2].toUpperCase())col=col*26+c.charCodeAt(0)-64;
  col=col-1+(ref[1]?0:columnDelta);const row=Number(ref[4])-1+(ref[3]?0:rowDelta);
  if(!Number.isSafeInteger(row)||row<0||row>=1048576||col<0||col>=16384)fail('Shared formula reference is out of bounds');
  result+=ref[1]+columnName(col)+ref[3]+(row+1);
 }
 if(result.length>4096)fail('Shared formula exceeds length limit');
 return result;
}