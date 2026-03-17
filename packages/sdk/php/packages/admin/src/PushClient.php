<?php

declare(strict_types=1);

namespace EdgeBase\Admin;

use EdgeBase\Core\HttpClient;
use EdgeBase\Core\Generated\GeneratedAdminApi;

/**
 * PushClient — Push notification management for Admin SDK.
 *
 *   $result = $client->push->send('userId', ['title' => 'Hello', 'body' => 'World']);
 *   $result = $client->push->sendMany(['u1', 'u2'], ['title' => 'News']);
 *   $logs = $client->push->getLogs('userId');
 */
class PushClient
{
    private HttpClient $http;
    private GeneratedAdminApi $adminCore;

    public function __construct(HttpClient $http)
    {
        $this->http = $http;
        $this->adminCore = new GeneratedAdminApi($http);
    }

    /**
     * Send a push notification to a single user's devices.
     * @param array<string, mixed> $payload
     * @return array<string, mixed>
     */
    public function send(string $userId, array $payload): array
    {
        /** @var array<string, mixed> $res */
        $res = $this->adminCore->push_send([
            'userId' => $userId,
            'payload' => $payload,
        ]);
        return is_array($res) ? $res : [];
    }

    /**
     * Send a push notification to multiple users (no limit — server chunks internally).
     * @param string[] $userIds
     * @param array<string, mixed> $payload
     * @return array<string, mixed>
     */
    public function sendMany(array $userIds, array $payload): array
    {
        /** @var array<string, mixed> $res */
        $res = $this->adminCore->push_send_many([
            'userIds' => $userIds,
            'payload' => $payload,
        ]);
        return is_array($res) ? $res : [];
    }

    /**
     * Send a push notification to a specific device token.
     * @param array<string, mixed> $payload
     * @return array<string, mixed>
     */
    public function sendToToken(string $token, array $payload, ?string $platform = null): array
    {
        /** @var array<string, mixed> $res */
        $res = $this->adminCore->push_send_to_token([
            'token' => $token,
            'payload' => $payload,
            'platform' => $platform ?? 'web',
        ]);
        return is_array($res) ? $res : [];
    }

    /**
     * Get registered device tokens for a user — token values NOT exposed.
     * @return array<int, array<string, mixed>>
     */
    public function getTokens(string $userId): array
    {
        /** @var array<string, mixed> $res */
        $res = $this->adminCore->get_push_tokens(['userId' => $userId]);
        return is_array($res) && isset($res['items']) ? $res['items'] : [];
    }

    /**
     * Get push send logs for a user (last 24 hours).
     * @return array<int, array<string, mixed>>
     */
    public function getLogs(string $userId, ?int $limit = null): array
    {
        $query = ['userId' => $userId];
        if ($limit !== null) {
            $query['limit'] = (string) $limit;
        }
        /** @var array<string, mixed> $res */
        $res = $this->adminCore->get_push_logs($query);
        return is_array($res) && isset($res['items']) ? $res['items'] : [];
    }

    /**
     * Send a push notification to an FCM topic.
     * @param array<string, mixed> $payload
     * @return array<string, mixed>
     */
    public function sendToTopic(string $topic, array $payload): array
    {
        /** @var array<string, mixed> $res */
        $res = $this->adminCore->push_send_to_topic([
            'topic' => $topic,
            'payload' => $payload,
        ]);
        return is_array($res) ? $res : [];
    }

    /**
     * Broadcast a push notification to all devices via /topics/all.
     * @param array<string, mixed> $payload
     * @return array<string, mixed>
     */
    public function broadcast(array $payload): array
    {
        /** @var array<string, mixed> $res */
        $res = $this->adminCore->push_broadcast([
            'payload' => $payload,
        ]);
        return is_array($res) ? $res : [];
    }
}
