# frozen_string_literal: true

require "uri"
require "base64"

module EdgebaseCore
  # Signed URL result.
  SignedUrlResult = Struct.new(:url, :expires_in, keyword_init: true)

  # File metadata.
  FileInfo = Struct.new(:key, :size, :content_type, :etag, :custom_metadata, keyword_init: true) do
    def self.from_json(data)
      new(
        key: data["key"] || "",
        size: data["size"] || 0,
        content_type: data["contentType"],
        etag: data["etag"],
        custom_metadata: data["customMetadata"] || data["custom_metadata"] || {}
      )
    end
  end

  # Storage subsystem — bucket factory.
  #
  #   bucket = client.storage.bucket("avatars")
  #   url = bucket.get_url("profile.png")
  class StorageClient
    def initialize(client)
      @client = client
    end

    def bucket(name)
      StorageBucket.new(@client, name)
    end
  end

  # Bucket-level storage operations.
  class StorageBucket
    attr_reader :name

    def initialize(client, name)
      @client = client
      @core = EdgebaseCore::GeneratedDbApi.new(client)
      @name = name
    end

    # Get the public URL of a file.
    def get_url(path)
      "#{@client.base_url}/api/storage/#{@name}/#{URI.encode_www_form_component(path)}"
    end

    # ── Upload ─────────────────────────────────────────────────────────────

    def upload(path, data, content_type: "application/octet-stream")
      @client.post_multipart(
        "/storage/#{@name}/upload",
        files: { "file" => [path, data, content_type] },
        data: { "key" => path }
      )
    end

    def upload_string(path, data, encoding: "raw", content_type: "text/plain")
      raw_bytes = case encoding
                  when "raw"
                    data.encode("UTF-8")
                  when "base64"
                    Base64.decode64(data)
                  when "base64url"
                    Base64.urlsafe_decode64(data)
                  when "data_url"
                    _, encoded = data.split(",", 2)
                    Base64.decode64(encoded)
                  else
                    data.encode("UTF-8")
                  end
      upload(path, raw_bytes, content_type: content_type)
    end

    # ── Download ───────────────────────────────────────────────────────────

    def download(path)
      @client.get_raw("/storage/#{@name}/#{URI.encode_www_form_component(path)}")
    end

    # ── Metadata ───────────────────────────────────────────────────────────

    def get_metadata(path)
      data = @core.get_file_metadata(@name, path)
      FileInfo.from_json(data)
    end

    def update_metadata(path, metadata)
      @core.update_file_metadata(@name, path, metadata)
    end

    # ── Signed URLs ────────────────────────────────────────────────────────

    def create_signed_url(path, expires_in: "1h")
      data = @core.create_signed_download_url(
        @name, { "key" => path, "expiresIn" => expires_in }
      )
      SignedUrlResult.new(url: data["url"] || "", expires_in: data["expiresIn"] || expires_in)
    end

    def create_signed_upload_url(path, expires_in: 3600)
      data = @core.create_signed_upload_url(
        @name, { "key" => path, "expiresIn" => "#{expires_in}s" }
      )
      SignedUrlResult.new(url: data["url"] || "", expires_in: data["expiresIn"] || expires_in)
    end

    # ── Management ─────────────────────────────────────────────────────────

    def delete_file(path)
      @core.delete_file(@name, path)
    end

    alias delete delete_file

    def list_files(prefix: "", limit: 100, offset: 0)
      params = { "limit" => limit.to_s, "offset" => offset.to_s }
      params["prefix"] = prefix unless prefix.empty?
      data = @client.get("/storage/#{@name}", params: params)
      items = data.is_a?(Hash) ? (data["files"] || data["items"] || []) : []
      items.map { |item| FileInfo.from_json(item) }
    end

    alias list list_files

    # ── Resumable / Multipart Upload ───────────────────────────────────────

    def initiate_resumable_upload(path, content_type: "application/octet-stream", total_size: nil)
      body = { "key" => path, "contentType" => content_type }
      body["totalSize"] = total_size if total_size
      data = @core.create_multipart_upload(@name, body)
      data["uploadId"] || ""
    end

    def resume_upload(path, upload_id, chunk, part_number: 1, is_last_chunk: false)
      encoded_path = URI.encode_www_form_component(path)
      params = "uploadId=#{upload_id}&partNumber=#{part_number}&key=#{encoded_path}"
      @client.post_raw(
        "/storage/#{@name}/multipart/upload-part?#{params}",
        data: chunk,
        content_type: "application/octet-stream"
      )
    end

    def complete_resumable_upload(path, upload_id, parts)
      @core.complete_multipart_upload(
        @name, { "uploadId" => upload_id, "key" => path, "parts" => parts }
      )
    end

    def abort_resumable_upload(path, upload_id)
      @core.abort_multipart_upload(
        @name, { "uploadId" => upload_id, "key" => path }
      )
    end
  end
end
