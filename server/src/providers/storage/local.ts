import fs from 'node:fs';
import path from 'node:path';
import type { StorageService, Zone } from './types';

export class LocalStorageService implements StorageService {
  constructor(private root: string) {
    for (const z of ['public', 'private']) fs.mkdirSync(path.join(root, z), { recursive: true });
  }
  /** Résout la clé en refusant tout path traversal. */
  private resolve(zone: Zone, key: string) {
    if (!/^[a-zA-Z0-9._-]+$/.test(key)) throw new Error('Clé de stockage invalide');
    const base = path.join(this.root, zone);
    const full = path.join(base, key);
    if (!full.startsWith(base + path.sep)) throw new Error('Path traversal détecté');
    return full;
  }
  async put(zone: Zone, key: string, data: Buffer) {
    await fs.promises.writeFile(this.resolve(zone, key), data);
  }
  async getStream(zone: Zone, key: string, range?: { start: number; end: number }) {
    return fs.createReadStream(this.resolve(zone, key), range);
  }
  async size(zone: Zone, key: string) {
    return (await fs.promises.stat(this.resolve(zone, key))).size;
  }
  async delete(zone: Zone, key: string) {
    await fs.promises.rm(this.resolve(zone, key), { force: true });
  }
  publicUrl(key: string) {
    return `/files/public/${key}`;
  }
}
