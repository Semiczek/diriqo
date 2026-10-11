import { parentPort, workerData } from 'node:worker_threads';
import { importOfficeFile } from './formats.ts';
try {
  const result = await importOfficeFile(workerData.name, workerData.bytes);
  parentPort?.postMessage({ result });
} catch (error) {
  parentPort?.postMessage({ error: error instanceof Error ? error.message : 'OFFICE_FORMAT: Import failed' });
}
