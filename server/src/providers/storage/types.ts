import type { Readable } from 'node:stream';
export type Zone = 'public' | 'private';
export interface StorageService {
  put(zone: Zone, key: string, data: Buffer): Promise<void>;
  /** Flux avec support Range (octets inclusifs). */
  getStream(zone: Zone, key: string, range?: { start: number; end: number }): Promise<Readable>;
  size(zone: Zone, key: string): Promise<number>;
  delete(zone: Zone, key: string): Promise<void>;
  /** URL publique directe (zone public uniquement). */
  publicUrl(key: string): string;
}
