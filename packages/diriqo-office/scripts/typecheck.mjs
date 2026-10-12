import {existsSync} from 'node:fs';import {execFileSync} from 'node:child_process';
const compiler=process.env.OFFICE_TSC_PATH;
if(!compiler||!existsSync(compiler))throw Error('Set OFFICE_TSC_PATH to the existing host TypeScript compiler (node_modules/typescript/bin/tsc). It is a validation tool, not an installed/distributed Office dependency.');
execFileSync(process.execPath,[compiler,'--noEmit'],{stdio:'inherit'});
