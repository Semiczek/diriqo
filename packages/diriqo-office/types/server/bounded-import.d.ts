import type { importOfficeFile } from './formats.ts';
/** Separate worker bounds parsing time and heap usage. No user-controlled code or file paths. */
export declare function importOfficeFileBounded(name: string, bytes: Uint8Array, workerUrl?: URL): ReturnType<typeof importOfficeFile>;
