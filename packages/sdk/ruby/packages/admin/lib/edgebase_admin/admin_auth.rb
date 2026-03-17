# frozen_string_literal: true

require "edgebase_core"

module EdgebaseAdmin
  # Admin auth — server-side user management via Service Key.
  #
  #   user = admin.admin_auth.get_user("user-id")
  #   new_user = admin.admin_auth.create_user(email: "admin@example.com", password: "secure")
  #   admin.admin_auth.set_custom_claims("user-id", { "role" => "pro" })
  #   admin.admin_auth.revoke_all_sessions("user-id")
  class AdminAuthClient
    def initialize(client)
      @client = client
    end

    def get_user(user_id)
      require_service_key!
      unwrap_user(@client.get("/auth/admin/users/#{user_id}"))
    end

    def create_user(email = nil, password = nil, data: nil, **kwargs)
      require_service_key!
      body = normalize_create_user_payload(email, password, data, kwargs)
      unwrap_user(@client.post("/auth/admin/users", body))
    end

    def update_user(user_id, data)
      require_service_key!
      unwrap_user(@client.patch("/auth/admin/users/#{user_id}", data))
    end

    def delete_user(user_id)
      require_service_key!
      @client.delete("/auth/admin/users/#{user_id}")
    end

    def list_users(limit: 20, cursor: nil)
      require_service_key!
      params = { "limit" => limit.to_s }
      params["cursor"] = cursor if cursor
      result = @client.get("/auth/admin/users", params: params)
      result.is_a?(Hash) ? result : { "users" => [], "cursor" => nil }
    end

    def set_custom_claims(user_id, claims)
      require_service_key!
      unwrap_user(@client.put("/auth/admin/users/#{user_id}/claims", claims))
    end

    def revoke_all_sessions(user_id)
      require_service_key!
      @client.post("/auth/admin/users/#{user_id}/revoke")
    end

    def disable_mfa(user_id)
      require_service_key!
      @client.delete("/auth/admin/users/#{user_id}/mfa")
    end

    private

    def normalize_create_user_payload(email, password, data, kwargs)
      if email.is_a?(Hash) && password.nil? && data.nil? && kwargs.empty?
        return stringify_hash(email)
      end

      body = stringify_hash(kwargs)
      body["email"] = email if email
      body["password"] = password if password
      body["data"] = data if data
      body
    end

    def stringify_hash(value)
      value.each_with_object({}) do |(key, val), result|
        result[key.to_s] = val
      end
    end

    def unwrap_user(value)
      return value["user"] if value.is_a?(Hash) && value["user"].is_a?(Hash)

      value
    end

    def require_service_key!
      sk = @client.instance_variable_get(:@service_key)
      return if sk && !sk.empty?

      raise EdgebaseCore::EdgeBaseError.new(
        403,
        "Service Key required for admin operations. " \
        "Pass service_key: when constructing AdminClient."
      )
    end
  end
end
