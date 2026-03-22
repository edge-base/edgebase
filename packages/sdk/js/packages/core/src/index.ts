/**
 * @edge-base/core — Shared modules used by both Client and Admin SDKs.
 *: Core 모듈 (Client + Admin 공통)
 *
 * Modules: HttpClient, TableRef, StorageClient, FieldOps, Context, Errors, Types
 */

// Abstract interfaces for decoupling
export type { ITokenManager, ITokenPair, IDatabaseLiveSubscriber, IDbChange, FilterMatchFn, Subscription } from './types.js';
export { createSubscription } from './types.js';

// HTTP
export { HttpClient, type HttpClientOptions } from './http.js';

// Table
export { TableRef, DocRef, DbRef, OrBuilder, type ListResult, type TableSnapshot, type FilterTuple, type UpsertResult, type BatchByFilterResult } from './table.js';

// Storage
export { StorageClient, StorageBucket, ResumableUploadError, type UploadTask, type FileInfo, type FileMetadata, type FileListResult, type UploadOptions, type UploadProgress, type DownloadOptions, type SignedUrlOptions, type SignedUrlResult, type SignedUploadUrlOptions, type SignedUploadUrlResult, type DeleteManyResult, type ListOptions, type StringFormat, type UploadPartInfo, type UploadPartsResult } from './storage.js';

// MIME
export { getMimeType } from './mime.js';

// Field Operations
export { increment, deleteField } from './field-ops.js';

// Context
export { ContextManager, type ContextValue } from './context.js';

// Functions
export { FunctionsClient, type FunctionCallOptions } from './functions.js';

// Generated Core
export { DefaultDbApi, ApiPaths, type GeneratedDbApi, type HttpTransport } from './generated/api-core.js';
export {
  GeneratedAuthMethods,
  GeneratedStorageMethods,
  GeneratedAnalyticsMethods,
} from './generated/client-wrappers.js';

// Transport Adapter
export { HttpClientAdapter, PublicHttpClientAdapter } from './transport-adapter.js';

// Errors
export { EdgeBaseError } from './errors.js';
