# frozen_string_literal: true

require "edgebase_core"

module EdgebaseAdmin
  # Client for push notification operations.
  #
  #   result = admin.push.send("userId", { "title" => "Hello", "body" => "World" })
  #   result = admin.push.send_many(["u1", "u2"], { "title" => "News" })
  #   logs = admin.push.get_logs("userId")
  class PushClient
    def initialize(http_client)
      @http = http_client
      @admin_core = EdgebaseAdmin::GeneratedAdminApi.new(http_client)
    end

    # Send a push notification to a single user's devices.
    def send(user_id, payload)
      @admin_core.push_send({ "userId" => user_id, "payload" => payload })
    end

    # Send a push notification to multiple users.
    def send_many(user_ids, payload)
      @admin_core.push_send_many({ "userIds" => user_ids, "payload" => payload })
    end

    # Send a push notification directly to a specific FCM token.
    def send_to_token(token, payload, platform: nil)
      body = { "token" => token, "payload" => payload }
      body["platform"] = platform if platform
      @admin_core.push_send_to_token(body)
    end

    # Get registered device tokens for a user.
    def get_tokens(user_id)
      res = @admin_core.get_push_tokens(query: { "userId" => user_id })
      res.is_a?(Hash) ? (res["items"] || []) : []
    end

    # Get push send logs for a user (last 24 hours).
    def get_logs(user_id, limit: nil)
      params = { "userId" => user_id }
      params["limit"] = limit.to_s if limit
      res = @admin_core.get_push_logs(query: params)
      res.is_a?(Hash) ? (res["items"] || []) : []
    end

    # Send a push notification to an FCM topic.
    def send_to_topic(topic, payload)
      @admin_core.push_send_to_topic({ "topic" => topic, "payload" => payload })
    end

    # Broadcast a push notification to all devices via /topics/all.
    def broadcast(payload)
      @admin_core.push_broadcast({ "payload" => payload })
    end
  end
end
