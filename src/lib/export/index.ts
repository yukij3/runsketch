import type { ExportFormat, ExportInput } from '../types';

const NI = (): never => { throw new Error('not implemented'); };

export function buildGpx(_input: ExportInput): string { return NI(); }
export function buildTcx(_input: ExportInput): string { return NI(); }
export function buildFit(_input: ExportInput): Uint8Array { return NI(); }
export function exportActivity(_format: ExportFormat, _input: ExportInput): { filename: string; mime: string; blob: Blob } { return NI(); }
export function downloadBlob(_blob: Blob, _filename: string): void { NI(); }
