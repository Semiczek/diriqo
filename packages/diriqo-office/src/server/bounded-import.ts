import { Worker } from 'node:worker_threads';
import { FORMAT_LIMITS } from './formats.ts';
import type { importOfficeFile } from './formats.ts';

/** Separate worker bounds parsing time and heap usage. No user-controlled code or file paths. */
export function importOfficeFileBounded(name: string, bytes: Uint8Array, workerUrl = new URL('./import-worker.js', import.meta.url)): ReturnType<typeof importOfficeFile> {
  if (bytes.length > FORMAT_LIMITS.inputBytes) return Promise.reject(new Error('OFFICE_FORMAT: File exceeds 12 MiB'));
  return new Promise((resolve, reject) => {
    // A bundling host supplies its own fixed deployment path, never an upload/request value.
    const worker = new Worker(workerUrl, { workerData: { name, bytes }, resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 } });
    let settled = false;
    const finish = (error?: Error, result?: Awaited<ReturnType<typeof importOfficeFile>>) => { if (settled) return; settled = true; clearTimeout(timer); void worker.terminate(); if (error) reject(error); else resolve(result!); };
    const timer = setTimeout(() => finish(new Error('OFFICE_FORMAT: Import processing time limit exceeded')), 10000);
    worker.once('message', message => finish(message.error ? new Error(message.error) : undefined, message.result));
    worker.once('error', error => finish(error));
    worker.once('exit', code => { if (!settled) finish(new Error(`OFFICE_FORMAT: Import worker exited (${code})`)); });
  });
}
