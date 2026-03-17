<?php

declare(strict_types=1);

namespace EdgeBase\Admin;

use EdgeBase\Core\HttpClient;

/**
 * AdminAuthClient — server-side user management via Service Key.
 *.
 *
 * 7 methods: getUser, listUsers, createUser, updateUser, deleteUser,
 *            setCustomClaims, revokeAllSessions, importUsers.
 *
 * Usage:
 *   $user    = $admin->adminAuth->getUser('user-id');
 *   $result  = $admin->adminAuth->listUsers(limit: 20);
 *   $newUser = $admin->adminAuth->createUser(['email' => 'a@b.com', 'password' => 'secure']);
 *   $admin->adminAuth->setCustomClaims('user-id', ['role' => 'pro']);
 *   $admin->adminAuth->revokeAllSessions('user-id');
 */
class AdminAuthClient
{
    public function __construct(private HttpClient $client)
    {
    }

    // ─── getUser ───

    /**
     * Fetch a single user by ID.
     *
     * @return array<string, mixed>
     */
    public function getUser(string $userId): array
    {
        /** @var array<string, mixed> $result */
        $result = $this->client->get("/auth/admin/users/{$userId}");
        return $result['user'] ?? $result;
    }

    // ─── listUsers ───

    /**
     * List users with cursor-based pagination.
     *
     * @return array{users: array<int, array<string, mixed>>, cursor: string|null}
     */
    public function listUsers(int $limit = 20, string $cursor = ''): array
    {
        $q = ['limit' => (string) $limit];
        if ($cursor !== '') {
            $q['cursor'] = $cursor;
        }
        /** @var array{users: array<int, array<string, mixed>>, cursor: string|null} */
        return $this->client->get('/auth/admin/users', $q);
    }

    // ─── createUser ───

    /**
     * Create a new user.
     *
     * @param array{email: string, password: string, displayName?: string, role?: string} $data
     * @return array<string, mixed>
     */
    public function createUser(array $data): array
    {
        /** @var array<string, mixed> $result */
        $result = $this->client->post('/auth/admin/users', $data);
        return $result['user'] ?? $result;
    }

    // ─── updateUser ───

    /**
     * Update a user by ID.
     *
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    public function updateUser(string $userId, array $data): array
    {
        /** @var array<string, mixed> $result */
        $result = $this->client->patch("/auth/admin/users/{$userId}", $data);
        return $result['user'] ?? $result;
    }

    // ─── deleteUser ───

    /**
     * Delete a user by ID.
     */
    public function deleteUser(string $userId): void
    {
        $this->client->delete("/auth/admin/users/{$userId}");
    }

    // ─── setCustomClaims ───

    /**
     * Set custom JWT claims for a user.
     * Claims are reflected in the JWT on next token refresh.
     *
     * @param array<string, mixed> $claims
     */
    public function setCustomClaims(string $userId, array $claims): void
    {
        $this->client->put("/auth/admin/users/{$userId}/claims", $claims);
    }

    // ─── revokeAllSessions ───

    /**
     * Revoke all sessions for a user, forcing re-authentication.
     */
    public function revokeAllSessions(string $userId): void
    {
        $this->client->post("/auth/admin/users/{$userId}/revoke");
    }

    /**
     * Import multiple users in a single admin call.
     *
     * @param array<int, array<string, mixed>> $users
     * @return array<string, mixed>
     */
    public function importUsers(array $users): array
    {
        /** @var array<string, mixed> $result */
        $result = $this->client->post('/auth/admin/users/import', ['users' => $users]);
        return $result;
    }

    // ─── disableMfa ───

    /**
     * Disable MFA for a user (admin operation via Service Key).
     *
     * Removes all MFA factors for the specified user, allowing them
     * to sign in without MFA verification.
     */
    public function disableMfa(string $userId): void
    {
        $this->client->delete("/auth/admin/users/{$userId}/mfa");
    }
}
