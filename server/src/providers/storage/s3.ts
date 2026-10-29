import { Readable } from 'node:stream';
import type { StorageService, Zone } from './types';

/**
 * Implémentation S3 (production). Nécessite : npm i @aws-sdk/client-s3 -w server
 * Variables : S3_BUCKET, S3_REGION (+ identifiants AWS standard). Chargement dynamique : aucune dépendance en dev.
 */
export class S3StorageService implements StorageService {
  private client: any;
  private mod: any;
  constructor(private bucket: string, private region: string, private publicBase = '') {}
  private async sdk() {
    if (!this.mod) {
      const name = '@aws-sdk/client-s3';
      this.mod = await import(/* @vite-ignore */ name).catch(() => {
        throw new Error('Installez @aws-sdk/client-s3 pour STORAGE_PROVIDER=s3');
      });
      this.client = new this.mod.S3Client({ region: this.region });
    }
    return this.mod;
  }
  private k(zone: Zone, key: string) {
    return `${zone}/${key}`;
  }
  async put(zone: Zone, key: string, data: Buffer) {
    const m = await this.sdk();
    await this.client.send(new m.PutObjectCommand({ Bucket: this.bucket, Key: this.k(zone, key), Body: data }));
  }
  async getStream(zone: Zone, key: string, range?: { start: number; end: number }) {
    const m = await this.sdk();
    const out = await this.client.send(
      new m.GetObjectCommand({ Bucket: this.bucket, Key: this.k(zone, key), Range: range ? `bytes=${range.start}-${range.end}` : undefined }),
    );
    return out.Body as Readable;
  }
  async size(zone: Zone, key: string) {
    const m = await this.sdk();
    const out = await this.client.send(new m.HeadObjectCommand({ Bucket: this.bucket, Key: this.k(zone, key) }));
    return out.ContentLength as number;
  }
  async delete(zone: Zone, key: string) {
    const m = await this.sdk();
    await this.client.send(new m.DeleteObjectCommand({ Bucket: this.bucket, Key: this.k(zone, key) }));
  }
  publicUrl(key: string) {
    return `${this.publicBase}/public/${key}`;
  }
}
