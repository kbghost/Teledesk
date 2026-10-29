import { env, uploadRoot } from '../../config/env';
import { LocalStorageService } from './local';
import { S3StorageService } from './s3';
import type { StorageService } from './types';

let instance: StorageService | undefined;
export function getStorage(): StorageService {
  if (!instance) {
    instance =
      env.STORAGE_PROVIDER === 's3'
        ? new S3StorageService(process.env.S3_BUCKET ?? '', process.env.S3_REGION ?? 'eu-west-1', process.env.S3_PUBLIC_BASE ?? '')
        : new LocalStorageService(uploadRoot);
  }
  return instance;
}
export * from './types';
