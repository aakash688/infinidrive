/**
 * Cloudflare R2 Storage Service
 * Used for intermediate file cache during upload process
 * Free tier: 10GB storage, 1M operations/month
 */

export interface R2Bucket {
  put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string, options?: R2PutOptions): Promise<R2Object>;
  get(key: string, options?: R2GetOptions): Promise<R2Object | null>;
  delete(key: string): Promise<void>;
  head(key: string): Promise<R2Object | null>;
}

export interface R2Object {
  key: string;
  size: number;
  etag: string;
  uploaded: Date;
  httpEtag: string;
  checksums: R2Checksums;
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
  body?: ReadableStream;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
}

export interface R2PutOptions {
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
  onlyIf?: R2Conditional;
}

export interface R2GetOptions {
  onlyIf?: R2Conditional;
  range?: R2Range;
}

export interface R2HTTPMetadata {
  contentType?: string;
  contentLanguage?: string;
  contentEncoding?: string;
  contentDisposition?: string;
  cacheControl?: string;
  cacheExpiry?: Date;
}

export interface R2Checksums {
  md5?: ArrayBuffer;
  sha1?: ArrayBuffer;
  sha256?: ArrayBuffer;
  sha384?: ArrayBuffer;
  sha512?: ArrayBuffer;
}

export interface R2Conditional {
  etagMatches?: string;
  etagDoesNotMatch?: string;
  uploadedBefore?: Date;
  uploadedAfter?: Date;
}

export interface R2Range {
  offset?: number;
  length?: number;
  suffix?: number;
}

/**
 * Store file in R2 cache
 */
export async function storeInR2(
  r2: R2Bucket,
  fileId: string,
  fileData: ArrayBuffer | Uint8Array,
  mimeType?: string
): Promise<void> {
  const key = `temp/${fileId}`;
  await r2.put(key, fileData, {
    httpMetadata: {
      contentType: mimeType || 'application/octet-stream',
    },
    customMetadata: {
      uploaded_at: new Date().toISOString(),
    },
  });
}

/**
 * Retrieve file from R2 cache
 */
export async function getFromR2(
  r2: R2Bucket,
  fileId: string
): Promise<ArrayBuffer | null> {
  const key = `temp/${fileId}`;
  const object = await r2.get(key);
  
  if (!object) {
    return null;
  }

  return await object.arrayBuffer();
}

/**
 * Delete file from R2 cache
 */
export async function deleteFromR2(
  r2: R2Bucket,
  fileId: string
): Promise<void> {
  const key = `temp/${fileId}`;
  await r2.delete(key);
}

/**
 * Check if file exists in R2
 */
export async function existsInR2(
  r2: R2Bucket,
  fileId: string
): Promise<boolean> {
  const key = `temp/${fileId}`;
  const object = await r2.head(key);
  return object !== null;
}
