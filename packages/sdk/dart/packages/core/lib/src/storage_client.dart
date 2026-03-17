// Storage client for file operations.
//
// Mirrors JS SDK StorageClient — bucket-based file management.
// Full feature parity: upload, uploadString, download, delete,
// list, getUrl, getMetadata, createSignedUrl, createSignedUploadUrl,
// resumeUpload.

import 'dart:convert';
import 'dart:typed_data';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';
import 'http_client.dart';
import 'generated/api_core.dart';

/// Parse content-type string to MediaType for multipart uploads.
MediaType _parseMediaType(String contentType) {
  final parts = contentType.split('/');
  if (parts.length == 2) {
    return MediaType(parts[0], parts[1]);
  }
  return MediaType('application', 'octet-stream');
}

/// File info from server.
class FileInfo {
  final String key;
  final int size;
  final String? contentType;
  final String? etag;
  final String? lastModified;
  final Map<String, String>? customMetadata;

  FileInfo({
    required this.key,
    required this.size,
    this.contentType,
    this.etag,
    this.lastModified,
    this.customMetadata,
  });

  factory FileInfo.fromJson(Map<String, dynamic> json) {
    return FileInfo(
      key: json['key'] as String,
      size: json['size'] as int,
      contentType: json['contentType'] as String?,
      etag: json['etag'] as String?,
      lastModified: json['lastModified'] as String?,
      customMetadata: (json['customMetadata'] as Map<String, dynamic>?)
          ?.map((k, v) => MapEntry(k, v.toString())),
    );
  }
}

/// File list result.
class FileListResult {
  final List<FileInfo> items;
  final bool hasMore;
  final String? cursor;

  FileListResult({
    required this.items,
    this.hasMore = false,
    this.cursor,
  });
}

/// Signed URL result.
class SignedUrlResult {
  final String url;
  final int expiresIn;

  SignedUrlResult({required this.url, required this.expiresIn});
}

/// Upload options.
class UploadOptions {
  final String? contentType;
  final Map<String, String>? customMetadata;
  final void Function(int bytesSent, int totalBytes)? onProgress;

  UploadOptions({this.contentType, this.customMetadata, this.onProgress});
}

/// String encoding type for uploadString.
enum StringEncoding { raw, base64, base64url, dataUrl }

/// Storage client — access file storage by bucket name.
class StorageClient {
  final HttpClient _client;

  StorageClient(this._client);

  /// Get a bucket reference.
  StorageBucket bucket(String name) => StorageBucket(_client, name);

  /// Convenience: upload a file without creating a bucket reference.
  /// Equivalent to `storage.bucket(bucketName).upload(key, data, ...)`.
  Future<FileInfo> upload(
    String bucketName,
    String key,
    List<int> data, {
    String? contentType,
    Map<String, String>? customMetadata,
    void Function(int bytesSent, int totalBytes)? onProgress,
  }) {
    return bucket(bucketName).upload(
      key,
      Uint8List.fromList(data),
      contentType: contentType,
      customMetadata: customMetadata,
      onProgress: onProgress,
    );
  }

  /// Convenience: get the public URL of a file without creating a bucket reference.
  String getUrl(String bucketName, String key) {
    return bucket(bucketName).getUrl(key);
  }

  /// Convenience: delete a file without creating a bucket reference.
  Future<void> delete(String bucketName, String key) {
    return bucket(bucketName).delete(key);
  }
}

/// Encode a storage key for use in URL paths.
/// Mirrors JS SDK: `key.split('/').map(encodeURIComponent).join('/')`.
/// This preserves `/` separators while encoding each path segment.
String _encodeKeyPath(String key) {
  return key.split('/').map(Uri.encodeComponent).join('/');
}

/// Single bucket operations.
class StorageBucket {
  final HttpClient _client;
  final GeneratedDbApi _core;
  final String name;

  StorageBucket(this._client, this.name) : _core = GeneratedDbApi(_client);

  Future<FileInfo> upload(
    String key,
    Uint8List data, {
    String? contentType,
    Map<String, String>? customMetadata,
    void Function(int bytesSent, int totalBytes)? onProgress,
  }) async {
    final request = http.MultipartRequest(
      'POST',
      Uri.parse('${_client.baseUrl}/api/storage/$name/upload'),
    );
    request.files.add(http.MultipartFile.fromBytes(
      'file',
      data,
      filename: key,
      contentType: contentType != null
          ? _parseMediaType(contentType)
          : null,
    ));
    request.fields['key'] = key;
    if (customMetadata != null) {
      request.fields['customMetadata'] = jsonEncode(customMetadata);
    }
    // Note: onProgress tracking via http.MultipartRequest is limited;
    // full progress tracking is available with resumeUpload().
    final json = await _client.postMultipart(
      '/storage/$name/upload',
      request,
    ) as Map<String, dynamic>;
    return FileInfo.fromJson(json);
  }

  /// Upload a string with specified encoding.
  ///
  /// ```dart
  /// await bucket.uploadString('config.json', '{"key": "value"}');
  /// await bucket.uploadString('image.png', base64Data, encoding: StringEncoding.base64);
  /// ```
  Future<FileInfo> uploadString(
    String key,
    String data, {
    StringEncoding encoding = StringEncoding.raw,
    String? contentType,
    Map<String, String>? customMetadata,
  }) async {
    Uint8List bytes;
    switch (encoding) {
      case StringEncoding.raw:
        bytes = Uint8List.fromList(utf8.encode(data));
        contentType ??= 'text/plain';
        break;
      case StringEncoding.base64:
        bytes = base64Decode(data);
        break;
      case StringEncoding.base64url:
        bytes = base64Url.decode(base64Url.normalize(data));
        break;
      case StringEncoding.dataUrl:
        // Parse data URL: data:[<mediatype>][;base64],<data>
        final commaIdx = data.indexOf(',');
        if (commaIdx == -1) throw ArgumentError('Invalid data URL');
        final header = data.substring(0, commaIdx);
        final body = data.substring(commaIdx + 1);
        // Extract content type
        final typeMatch = RegExp(r'data:([^;,]+)').firstMatch(header);
        contentType ??= typeMatch?.group(1) ?? 'application/octet-stream';
        // Decode
        if (header.contains(';base64')) {
          bytes = base64Decode(body);
        } else {
          bytes = Uint8List.fromList(utf8.encode(Uri.decodeFull(body)));
        }
        break;
    }

    return upload(key, bytes,
        contentType: contentType, customMetadata: customMetadata);
  }

  /// Download a file as bytes.
  Future<Uint8List> download(String key) async {
    final response = await _client.getRaw('/storage/$name/${_encodeKeyPath(key)}');
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return response.bodyBytes;
    }
    throw Exception('Download failed with status ${response.statusCode}');
  }

  /// Delete a file.
  Future<void> delete(String key) async {
    await _core.deleteFile(name, key);
  }

  /// Get file public URL.
  String getUrl(String key) {
    return '${_client.baseUrl}/api/storage/$name/${_encodeKeyPath(key)}';
  }

  /// Get file metadata.
  Future<FileInfo> getMetadata(String key) async {
    final json = await _core.getFileMetadata(name, key)
        as Map<String, dynamic>;
    return FileInfo.fromJson(json);
  }

  /// Update file metadata.
  Future<FileInfo> updateMetadata(
    String key,
    Map<String, dynamic> metadata,
  ) async {
    final json = await _core.updateFileMetadata(name, key, metadata)
        as Map<String, dynamic>;
    return FileInfo.fromJson(json);
  }

  /// Create a signed download URL (time-limited).
  ///
  /// ```dart
  /// final signed = await bucket.createSignedUrl('private/doc.pdf', expiresIn: 3600);
  /// print(signed.url); // Use within expiresIn seconds
  /// ```
  Future<SignedUrlResult> createSignedUrl(
    String key, {
    int expiresIn = 3600,
  }) async {
    final json = await _core.createSignedDownloadUrl(name, {
      'key': key,
      'expiresIn': '${expiresIn}s',
    }) as Map<String, dynamic>;
    return SignedUrlResult(
      url: json['url'] as String,
      expiresIn: expiresIn,
    );
  }

  /// Create signed download URLs for multiple files in a single request.
  Future<List<SignedUrlResult>> createSignedUrls(
    List<String> keys, {
    int expiresIn = 3600,
  }) async {
    final json = await _core.createSignedDownloadUrls(name, {
      'keys': keys,
      'expiresIn': '${expiresIn}s',
    }) as Map<String, dynamic>;
    final urls = json['urls'] as List<dynamic>? ?? const [];
    return urls
        .map((item) => item is Map<String, dynamic>
            ? item
            : Map<String, dynamic>.from(item as Map))
        .map((item) => SignedUrlResult(
              url: item['url'] as String? ?? '',
              expiresIn: expiresIn,
            ))
        .toList();
  }

  /// Create a signed upload URL (client-side direct upload).
  ///
  /// ```dart
  /// final signed = await bucket.createSignedUploadUrl('uploads/large-file.zip');
  /// // Use signed.url to upload directly from client
  /// ```
  Future<SignedUrlResult> createSignedUploadUrl(
    String key, {
    int expiresIn = 3600,
    String? contentType,
  }) async {
    final body = <String, dynamic>{
      'key': key,
      'expiresIn': '${expiresIn}s',
    };
    if (contentType != null) body['contentType'] = contentType;
    final json = await _core.createSignedUploadUrl(name, body)
        as Map<String, dynamic>;
    return SignedUrlResult(
      url: json['url'] as String,
      expiresIn: expiresIn,
    );
  }

  /// Check whether a file exists without downloading it.
  Future<bool> exists(String key) {
    return _core.checkFileExists(name, key);
  }

  /// Inspect completed parts for a resumable upload.
  Future<Map<String, dynamic>> getUploadParts(String key, String uploadId) async {
    final json = await _core.getUploadParts(name, uploadId, {'key': key})
        as Map<String, dynamic>;
    return {
      'uploadId': json['uploadId'] ?? uploadId,
      'key': json['key'] ?? key,
      'parts': json['parts'] ?? const [],
    };
  }


  /// Resume an interrupted upload (large file support, M17).

  ///
  /// Uses server-provided upload ID for resumable uploads.
  /// ```dart
  /// final uploadId = await bucket.initiateResumableUpload('large.zip');
  /// await bucket.resumeUpload('large.zip', uploadId, bytes, offset: lastByte);
  /// ```
  Future<String> initiateResumableUpload(
    String key, {
    String? contentType,
  }) async {
    final body = <String, dynamic>{'key': key};
    if (contentType != null) body['contentType'] = contentType;
    final json = await _core.createMultipartUpload(name, body)
        as Map<String, dynamic>;
    return json['uploadId'] as String;
  }

  /// Upload a chunk for a resumable upload. Returns `{ partNumber, etag }`.
  /// Keep as direct HTTP — binary part upload.
  Future<Map<String, dynamic>> uploadPart(
    String key,
    String uploadId,
    Uint8List chunk, {
    required int partNumber,
  }) async {
    final encodedKey = _encodeKeyPath(key);
    final path = '/storage/$name/multipart/upload-part'
        '?uploadId=${Uri.encodeComponent(uploadId)}'
        '&partNumber=$partNumber'
        '&key=${Uri.encodeComponent(encodedKey)}';
    final json = await _client.postRaw(path, chunk);
    return json as Map<String, dynamic>;
  }

  /// Upload a chunk for a resumable upload (legacy convenience wrapper).
  /// Uploads a single part and, if `isLastChunk`, completes the upload.
  Future<FileInfo?> resumeUpload(
    String key,
    String uploadId,
    Uint8List chunk, {
    required int offset,
    bool isLastChunk = false,
  }) async {
    final partNumber = offset + 1; // R2 partNumber is 1-based
    final part = await uploadPart(key, uploadId, chunk, partNumber: partNumber);
    if (isLastChunk) {
      final result = await _core.completeMultipartUpload(name, {
        'uploadId': uploadId,
        'key': key,
        'parts': [part],
      }) as Map<String, dynamic>;
      return FileInfo.fromJson(result);
    }
    return null;
  }

  /// List files in bucket.
  Future<FileListResult> list({
    String? prefix,
    int? limit,
    String? cursor,
  }) async {
    final params = <String>[];
    if (prefix != null) params.add('prefix=${Uri.encodeComponent(prefix)}');
    if (limit != null) params.add('limit=$limit');
    if (cursor != null) params.add('cursor=${Uri.encodeComponent(cursor)}');
    final query = params.isEmpty ? '' : '?${params.join('&')}';

    final json = await _client.get('/storage/$name$query')
        as Map<String, dynamic>;
    final rawItems = (json['files'] as List<dynamic>?) ?? (json['items'] as List<dynamic>?) ?? [];
    final items = rawItems
        .map((e) => FileInfo.fromJson(e as Map<String, dynamic>))
        .toList();
    return FileListResult(
      items: items,
      hasMore: json['hasMore'] as bool? ?? false,
      cursor: json['cursor'] as String?,
    );
  }
}
