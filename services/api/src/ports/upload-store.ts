export type UploadPhoto = Readonly<{
  sha256: string;
  bytes: number;
  contentType: 'image/jpeg' | 'image/heic' | 'image/webp';
}>;
export type StoredUploadPhoto = UploadPhoto & Readonly<{ key: string }>;
export type UploadSession = Readonly<{
  id: string;
  trancheId: string;
  status: 'OPEN' | 'COMPLETE';
  photos: readonly StoredUploadPhoto[];
  expiresAt: number;
  completedAt: number | null;
}>;
export interface UploadStore {
  reserve(
    platformId: string,
    trancheId: string,
    key: string,
    fingerprint: string,
    photos: readonly UploadPhoto[],
    now: number,
  ): Promise<UploadSession>;
  get(platformId: string, trancheId: string, id: string): Promise<UploadSession | null>;
  complete(platformId: string, trancheId: string, id: string, now: number): Promise<UploadSession>;
}
export interface UploadObjects {
  presignPut(
    photo: StoredUploadPhoto,
    expiresAt: number,
  ): Readonly<{ url: string; headers: Readonly<Record<string, string>> }>;
  get(key: string, maxBytes: number): Promise<Buffer | null>;
}
export class UploadError extends Error {
  constructor(readonly code: 'INVALID' | 'NOT_FOUND' | 'CONFLICT' | 'EXPIRED' | 'INCOMPLETE' | 'MISMATCH') {
    super(code);
  }
}
