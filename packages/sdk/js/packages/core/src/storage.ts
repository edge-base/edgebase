/**
 * Storage SDK — R2 File Storage client (M7, M17)
 *
 * @example
 * // Upload
 * const meta = await client.storage.bucket('avatars').upload('user-123.jpg', file);
 *
 * // Download
 * const blob = await client.storage.bucket('avatars').download('user-123.jpg');
 *
 * // Signed URL
 * const url = await client.storage.bucket('documents').createSignedUrl('report.pdf', { expiresIn: '1h' });
 *
 * // Resume upload (M17)
 * try { await bucket.upload('large.zip', file); }
 * catch (e) { if (e instanceof ResumableUploadError) await bucket.resumeUpload(e.key, e.uploadId); }
 */

import type { HttpClient } from './http.js';
import type { GeneratedDbApi } from './generated/api-core.js';
import { getMimeType } from './mime.js';

// ─── Types ───

/**
 * An upload Promise with a `.cancel()` method.
 * Awaitable like a regular Promise; call `.cancel()` to abort the upload.
 *
 * @example
 * const task = bucket.upload('video.mp4', largeFile);
 * cancelButton.onclick = () => task.cancel();
 * const result = await task;
 */
export type UploadTask<T> = Promise<T> & { cancel: () => void };

export interface FileInfo {
  key: string;
  size: number;
  contentType: string;
  etag: string;
  uploadedAt: string;
  uploadedBy: string | null;
  customMetadata: Record<string, string>;
}

export type FileMetadata = FileInfo;

export interface FileListResult {
  files: FileInfo[];
  cursor: string | null;
  truncated: boolean;
}

export interface UploadOptions {
  contentType?: string;
  customMetadata?: Record<string, string>;
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
}

export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

export interface DownloadOptions {
  as?: 'blob' | 'arraybuffer' | 'stream' | 'text';
}

export interface SignedUrlOptions {
  expiresIn?: string;
}

export interface SignedUploadUrlOptions {
  expiresIn?: string;
  maxFileSize?: string;
}

export interface SignedUrlResult {
  key: string;
  url: string;
  expiresAt: string;
}

export interface DeleteManyResult {
  deleted: string[];
  failed: Array<{ key: string; error: string }>;
}

export interface SignedUploadUrlResult {
  url: string;
  expiresAt: string;
  maxFileSize: string | null;
  uploadedBy: string | null;
}

export interface ListOptions {
  prefix?: string;
  cursor?: string;
  limit?: number;
}

export type StringFormat = 'raw' | 'base64' | 'base64url' | 'data_url';

/** M17: Resumable upload part info */
export interface UploadPartInfo {
  partNumber: number;
  etag: string;
}

/** M17: Upload parts query result */
export interface UploadPartsResult {
  uploadId: string;
  key: string;
  parts: UploadPartInfo[];
}

/**
 * M17: Error thrown when a multipart upload fails but can be resumed.
 * Contains the uploadId and key needed to call resumeUpload().
 */
export class ResumableUploadError extends Error {
  constructor(
    public readonly key: string,
    public readonly uploadId: string,
    public readonly completedParts: UploadPartInfo[],
    public readonly failedPartNumber: number,
    message: string,
  ) {
    super(message);
    this.name = 'ResumableUploadError';
  }
}

// ─── StorageBucket ───

export class StorageBucket {
  constructor(
    private httpClient: HttpClient,
    private bucketName: string,
    private core?: GeneratedDbApi,
  ) {}

  /**
   * Upload a file (File, Blob, ArrayBuffer, or Uint8Array).
   *
   * Returns an `UploadTask` — awaitable like a regular Promise, but also
   * exposes a `.cancel()` method to abort the upload mid-flight.
   *
   * `contentType` is auto-detected from the file extension when omitted.
   */
  upload(
    key: string,
    data: File | Blob | ArrayBuffer | Uint8Array,
    options?: UploadOptions,
  ): UploadTask<FileInfo> {
    const controller = new AbortController();
    if (options?.signal) {
      options.signal.addEventListener('abort', () => controller.abort(options.signal!.reason), { once: true });
    }

    // Resolve contentType: explicit > File.type > extension > fallback
    const contentType = options?.contentType
      || (data instanceof File && data.type ? data.type : null)
      || getMimeType(key);

    const mergedOptions: UploadOptions = { ...options, contentType, signal: controller.signal };

    const promise = this._doUpload(key, data, mergedOptions);
    return Object.assign(promise, { cancel: () => controller.abort() }) as UploadTask<FileInfo>;
  }

  /** Internal upload logic (separated from upload() for UploadTask wrapping). */
  private async _doUpload(
    key: string,
    data: File | Blob | ArrayBuffer | Uint8Array,
    options: UploadOptions,
  ): Promise<FileInfo> {
    // For large files (>5MB), use multipart upload
    const size = data instanceof Blob ? data.size : (data as ArrayBuffer).byteLength;
    if (size > 5 * 1024 * 1024) {
      return this.multipartUpload(key, data, options);
    }

    const formData = new FormData();
    const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: options.contentType });
    formData.append('file', blob, key);
    formData.append('key', key);
    if (options.customMetadata) {
      formData.append('customMetadata', JSON.stringify(options.customMetadata));
    }

    return this.uploadFormData(key, formData, options);
  }

  /**
   * Upload a string in various formats.
   * Returns an `UploadTask` with `.cancel()` support.
   *
   * Content type is auto-detected: data_url header > raw → text/plain > file extension.
   */
  uploadString(
    key: string,
    value: string,
    format: StringFormat = 'raw',
    options?: UploadOptions,
  ): UploadTask<FileInfo> {
    let data: Uint8Array;
    let contentType = options?.contentType;

    switch (format) {
      case 'raw':
        data = new TextEncoder().encode(value);
        if (!contentType) contentType = 'text/plain';
        break;
      case 'base64':
        data = this.base64ToBytes(value);
        break;
      case 'base64url':
        data = this.base64ToBytes(value.replace(/-/g, '+').replace(/_/g, '/'));
        break;
      case 'data_url': {
        const commaIndex = value.indexOf(',');
        if (commaIndex === -1) throw new Error('Invalid data URL format.');
        const header = value.substring(0, commaIndex);
        const mimeMatch = header.match(/data:([^;]+)/);
        if (mimeMatch && !contentType) contentType = mimeMatch[1];
        const base64Data = value.substring(commaIndex + 1);
        data = this.base64ToBytes(base64Data);
        break;
      }
      default:
        throw new Error(`Unknown format: ${format}`);
    }

    // Delegates to upload() which handles UploadTask wrapping + remaining auto-detection
    return this.upload(key, data, { ...options, contentType });
  }

  /**
   * Download a file.
   *
   * NOTE: Direct HTTP — requires raw Response for blob/arraybuffer/stream conversion.
   * Generated core's downloadFile() returns parsed JSON via transport adapter,
   * which cannot provide raw Response access needed here.
   */
  async download(key: string, options?: DownloadOptions): Promise<Blob | ArrayBuffer | ReadableStream | string> {
    const encodedKey = key.split('/').map(encodeURIComponent).join('/');
    const response = await this.httpClient.getRaw(`/api/storage/${this.bucketName}/${encodedKey}`);

    const format = options?.as || 'blob';
    switch (format) {
      case 'blob':
        return response.blob();
      case 'arraybuffer':
        return response.arrayBuffer();
      case 'stream':
        return response.body!;
      case 'text':
        return response.text();
      default:
        return response.blob();
    }
  }

  /**
   * Get the public URL of a file (synchronous, just URL calculation).
   */
  getUrl(key: string): string {
    const encodedKey = key.split('/').map(encodeURIComponent).join('/');
    return this.httpClient.getBaseUrl() + `/api/storage/${this.bucketName}/${encodedKey}`;
  }

  /**
   * Create a signed download URL with expiration.
   */
  async createSignedUrl(key: string, options?: SignedUrlOptions): Promise<string> {
    const body = { key, expiresIn: options?.expiresIn || '1h' };
    const result = this.core
      ? await this.core.createSignedDownloadUrl(this.bucketName, body) as { url: string; expiresAt: string }
      : await this.httpClient.post<{ url: string; expiresAt: string }>(`/api/storage/${this.bucketName}/signed-url`, body);
    return result.url;
  }

  /**
   * Create signed download URLs for multiple files in a single request.
   */
  async createSignedUrls(keys: string[], options?: SignedUrlOptions): Promise<SignedUrlResult[]> {
    const body = { keys, expiresIn: options?.expiresIn || '1h' };
    const result = this.core
      ? await this.core.createSignedDownloadUrls(this.bucketName, body) as { urls: SignedUrlResult[] }
      : await this.httpClient.post<{ urls: SignedUrlResult[] }>(`/api/storage/${this.bucketName}/signed-urls`, body);
    return result.urls;
  }

  /**
   * Create a signed upload URL for direct R2 upload.
   */
  async createSignedUploadUrl(key: string, options?: SignedUploadUrlOptions): Promise<SignedUploadUrlResult> {
    const body = { key, expiresIn: options?.expiresIn || '30m', maxFileSize: options?.maxFileSize };
    return this.core
      ? await this.core.createSignedUploadUrl(this.bucketName, body) as SignedUploadUrlResult
      : this.httpClient.post<SignedUploadUrlResult>(`/api/storage/${this.bucketName}/signed-upload-url`, body);
  }

  /**
   * Get file metadata.
   */
  async getMetadata(key: string): Promise<FileMetadata> {
    const encodedKey = key.split('/').map(encodeURIComponent).join('/');
    return this.core
      ? await this.core.getFileMetadata(this.bucketName, encodedKey) as FileMetadata
      : this.httpClient.get<FileMetadata>(`/api/storage/${this.bucketName}/${encodedKey}/metadata`);
  }

  /**
   * Update file metadata (custom metadata, content type).
   */
  async updateMetadata(key: string, metadata: { customMetadata?: Record<string, string>; contentType?: string }): Promise<FileMetadata> {
    const encodedKey = key.split('/').map(encodeURIComponent).join('/');
    return this.core
      ? await this.core.updateFileMetadata(this.bucketName, encodedKey, metadata) as FileMetadata
      : this.httpClient.patch<FileMetadata>(`/api/storage/${this.bucketName}/${encodedKey}/metadata`, metadata);
  }

  /**
   * Check if a file exists.
   *
   * NOTE: Direct HTTP — uses HEAD request. Generated core has no HEAD method support;
   * headRaw() is the only way to check existence without downloading the file.
   */
  async exists(key: string): Promise<boolean> {
    const encodedKey = key.split('/').map(encodeURIComponent).join('/');
    try {
      await this.httpClient.headRaw(`/api/storage/${this.bucketName}/${encodedKey}`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete a file.
   */
  async delete(key: string): Promise<void> {
    const encodedKey = key.split('/').map(encodeURIComponent).join('/');
    if (this.core) {
      await this.core.deleteFile(this.bucketName, encodedKey);
    } else {
      await this.httpClient.delete(`/api/storage/${this.bucketName}/${encodedKey}`);
    }
  }

  /**
   * Delete multiple files in a single request.
   */
  async deleteMany(keys: string[]): Promise<DeleteManyResult> {
    const body = { keys };
    return this.core
      ? await this.core.deleteBatch(this.bucketName, body) as DeleteManyResult
      : this.httpClient.post<DeleteManyResult>(`/api/storage/${this.bucketName}/delete-batch`, body);
  }

  /**
   * List files in the bucket.
   *
   * NOTE: Direct HTTP — generated listFiles(bucket) accepts no query params,
   * but this method needs prefix/cursor/limit filtering. Codegen limitation.
   */
  async list(options?: ListOptions): Promise<FileListResult> {
    const query: Record<string, string> = {};
    if (options?.prefix) query.prefix = options.prefix;
    if (options?.cursor) query.cursor = options.cursor;
    if (options?.limit) query.limit = String(options.limit);
    return this.httpClient.get<FileListResult>(`/api/storage/${this.bucketName}`, query);
  }

  // ─── Private helpers ───

  private base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  /** NOTE: Direct HTTP — FormData upload requires raw fetch for multipart/form-data boundary handling. */
  private async uploadFormData(
    key: string,
    formData: FormData,
    options?: UploadOptions,
  ): Promise<FileInfo> {
    // Direct fetch with FormData (HttpClient doesn't support non-JSON bodies)
    const headers = await this.httpClient.getAuthHeaders();
    // Do NOT set Content-Type — browser sets it with boundary for FormData
    delete headers['Content-Type'];

    const fetchOptions: RequestInit = {
      method: 'POST',
      headers,
      body: formData,
      signal: options?.signal,
    };

    const response = await fetch(
      this.httpClient.getBaseUrl() + `/api/storage/${this.bucketName}/upload`,
      fetchOptions,
    );

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const msg = (body as Record<string, unknown>)?.message || `Upload failed: ${response.status}`;
      throw new Error(String(msg));
    }

    return (await response.json()) as FileInfo;
  }

  private async multipartUpload(
    key: string,
    data: File | Blob | ArrayBuffer | Uint8Array,
    options?: UploadOptions,
  ): Promise<FileInfo> {
    const blob = data instanceof Blob ? data : new Blob([data as BlobPart]);
    // contentType is already resolved by upload() → _doUpload() before reaching here
    const contentType = options?.contentType || 'application/octet-stream';

    // 1. Create multipart upload
    const createBody = { key, contentType, customMetadata: options?.customMetadata };
    const { uploadId } = this.core
      ? await this.core.createMultipartUpload(this.bucketName, createBody) as { uploadId: string; key: string }
      : await this.httpClient.post<{ uploadId: string; key: string }>(`/api/storage/${this.bucketName}/multipart/create`, createBody);

    // 2. Upload parts (5MB chunks)
    const PART_SIZE = 5 * 1024 * 1024;
    const totalSize = blob.size;
    const parts: Array<{ partNumber: number; etag: string }> = [];
    let uploaded = 0;

    // NOTE: Direct HTTP for part uploads — binary chunk body + progress tracking + abort signal
    // require raw fetch. Generated uploadPart() only accepts JSON body via transport.
    for (let partNumber = 1; uploaded < totalSize; partNumber++) {
      const start = uploaded;
      const end = Math.min(start + PART_SIZE, totalSize);
      const chunk = blob.slice(start, end);

      const headers = await this.httpClient.getAuthHeaders();
      delete headers['Content-Type'];

      const params = new URLSearchParams({
        uploadId,
        partNumber: String(partNumber),
        key,
      });

      const response = await fetch(
        `${this.httpClient.getBaseUrl()}/api/storage/${this.bucketName}/multipart/upload-part?${params}`,
        { method: 'POST', headers, body: chunk, signal: options?.signal },
      );

      if (!response.ok) {
        // M17: Throw resumable error instead of aborting
        throw new ResumableUploadError(
          key,
          uploadId,
          parts,
          partNumber,
          `Multipart upload failed at part ${partNumber}`,
        );
      }

      const part = (await response.json()) as { partNumber: number; etag: string };
      parts.push(part);
      uploaded = end;

      if (options?.onProgress) {
        options.onProgress({
          loaded: uploaded,
          total: totalSize,
          percent: Math.round((uploaded / totalSize) * 100),
        });
      }
    }

    // 3. Complete multipart upload
    const completeBody = { uploadId, key, parts };
    return this.core
      ? await this.core.completeMultipartUpload(this.bucketName, completeBody) as FileInfo
      : this.httpClient.post<FileInfo>(`/api/storage/${this.bucketName}/multipart/complete`, completeBody);
  }

  /**
   * Start a multipart upload and return the upload ID so callers can resume it later.
   */
  async initiateResumableUpload(key: string, contentType?: string): Promise<string> {
    const createBody: Record<string, unknown> = { key };
    if (contentType) {
      createBody.contentType = contentType;
    }

    const result = this.core
      ? await this.core.createMultipartUpload(this.bucketName, createBody) as { uploadId: string }
      : await this.httpClient.post<{ uploadId: string }>(
        `/api/storage/${this.bucketName}/multipart/create`,
        createBody,
      );

    return result.uploadId;
  }

  /**
   * M17: Get uploaded parts for an in-progress multipart upload.
   * Use this to check which parts have been uploaded before calling resumeUpload().
   *
   * NOTE: Direct HTTP — generated getUploadParts(bucket, uploadId) accepts no query params,
   * but this method needs { key } query parameter. Codegen limitation.
   */
  async getUploadParts(key: string, uploadId: string): Promise<UploadPartsResult> {
    return this.httpClient.get<UploadPartsResult>(
      `/api/storage/${this.bucketName}/uploads/${encodeURIComponent(uploadId)}/parts`,
      { key },
    );
  }

  /**
   * M17: Resume a previously failed multipart upload.
   * Queries the server for completed parts, then uploads only the remaining chunks.
   * Returns an `UploadTask` with `.cancel()` support.
   */
  resumeUpload(
    key: string,
    uploadId: string,
    data: File | Blob | ArrayBuffer | Uint8Array,
    options?: UploadOptions,
  ): UploadTask<FileInfo> {
    const controller = new AbortController();
    if (options?.signal) {
      options.signal.addEventListener('abort', () => controller.abort(options.signal!.reason), { once: true });
    }

    const mergedOptions: UploadOptions = { ...options, signal: controller.signal };
    const promise = this._doResumeUpload(key, uploadId, data, mergedOptions);
    return Object.assign(promise, { cancel: () => controller.abort() }) as UploadTask<FileInfo>;
  }

  /** Internal resume upload logic. */
  private async _doResumeUpload(
    key: string,
    uploadId: string,
    data: File | Blob | ArrayBuffer | Uint8Array,
    options: UploadOptions,
  ): Promise<FileInfo> {
    const blob = data instanceof Blob ? data : new Blob([data as BlobPart]);
    const totalSize = blob.size;
    const PART_SIZE = 5 * 1024 * 1024;

    // 1. Query server for already-uploaded parts
    const { parts: completedParts } = await this.getUploadParts(key, uploadId);
    const completedSet = new Set(completedParts.map(p => p.partNumber));

    // 2. Upload remaining parts
    const allParts: UploadPartInfo[] = [...completedParts];
    let uploaded = 0;

    for (let partNumber = 1; uploaded < totalSize; partNumber++) {
      const start = (partNumber - 1) * PART_SIZE;
      const end = Math.min(start + PART_SIZE, totalSize);

      if (completedSet.has(partNumber)) {
        // Skip already-uploaded part
        uploaded = end;
        if (options.onProgress) {
          options.onProgress({ loaded: uploaded, total: totalSize, percent: Math.round((uploaded / totalSize) * 100) });
        }
        continue;
      }

      // NOTE: Direct HTTP for part uploads — binary chunk body + abort signal
      // require raw fetch. Generated uploadPart() only accepts JSON body via transport.
      const chunk = blob.slice(start, end);
      const headers = await this.httpClient.getAuthHeaders();
      delete headers['Content-Type'];

      const params = new URLSearchParams({
        uploadId,
        partNumber: String(partNumber),
        key,
      });

      const response = await fetch(
        `${this.httpClient.getBaseUrl()}/api/storage/${this.bucketName}/multipart/upload-part?${params}`,
        { method: 'POST', headers, body: chunk, signal: options.signal },
      );

      if (!response.ok) {
        throw new ResumableUploadError(
          key,
          uploadId,
          allParts,
          partNumber,
          `Resume upload failed at part ${partNumber}`,
        );
      }

      const part = (await response.json()) as UploadPartInfo;
      allParts.push(part);
      uploaded = end;

      if (options.onProgress) {
        options.onProgress({ loaded: uploaded, total: totalSize, percent: Math.round((uploaded / totalSize) * 100) });
      }
    }

    // 3. Complete
    // Sort parts by partNumber for R2
    allParts.sort((a, b) => a.partNumber - b.partNumber);
    const completeBody = { uploadId, key, parts: allParts };
    return this.core
      ? await this.core.completeMultipartUpload(this.bucketName, completeBody) as FileInfo
      : this.httpClient.post<FileInfo>(`/api/storage/${this.bucketName}/multipart/complete`, completeBody);
  }
}

// ─── StorageClient ───

export class StorageClient {
  constructor(
    private httpClient: HttpClient,
    private core?: GeneratedDbApi,
  ) {}

  /**
   * Get a bucket reference.
   * @example
   * const avatarsBucket = client.storage.bucket('avatars');
   */
  bucket(name: string): StorageBucket {
    return new StorageBucket(this.httpClient, name, this.core);
  }

  /**
   * Convenience: get public URL for a file without creating a bucket reference.
   * @example
   * const url = admin.storage.getUrl('avatars', 'profile.png');
   */
  getUrl(bucketName: string, key: string): string {
    return new StorageBucket(this.httpClient, bucketName, this.core).getUrl(key);
  }

  /**
   * Convenience: upload a file without creating a bucket reference.
   * @example
   * await admin.storage.upload('avatars', 'profile.png', blob);
   */
  upload(
    bucketName: string,
    key: string,
    data: File | Blob | ArrayBuffer | Uint8Array,
    options?: UploadOptions,
  ): UploadTask<FileInfo> {
    return new StorageBucket(this.httpClient, bucketName, this.core).upload(key, data, options);
  }

  /**
   * Convenience: delete a file without creating a bucket reference.
   */
  delete(bucketName: string, key: string): Promise<void> {
    return new StorageBucket(this.httpClient, bucketName, this.core).delete(key);
  }
}
