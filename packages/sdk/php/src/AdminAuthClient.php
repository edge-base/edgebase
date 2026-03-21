<?php

declare(strict_types=1);

namespace EdgeBase;

final class AdminAuthClient
{
    public function __construct(private readonly \EdgeBase\Admin\AdminAuthClient $inner)
    {
    }

    public function getUser(string $userId): array
    {
        return $this->inner->getUser($userId);
    }

    public function listUsers(int $limit = 20, string $cursor = ''): array
    {
        return $this->inner->listUsers($limit, $cursor);
    }

    public function createUser(array|string $data, ?string $password = null): array
    {
        if (is_string($data)) {
            if ($password === null) {
                throw new \InvalidArgumentException('password is required when createUser() is called with an email string');
            }
            return $this->inner->createUser([
                'email' => $data,
                'password' => $password,
            ]);
        }

        return $this->inner->createUser($data);
    }

    public function updateUser(string $userId, array $data): array
    {
        return $this->inner->updateUser($userId, $data);
    }

    public function deleteUser(string $userId): void
    {
        $this->inner->deleteUser($userId);
    }

    public function setCustomClaims(string $userId, array $claims): void
    {
        $this->inner->setCustomClaims($userId, $claims);
    }

    public function revokeAllSessions(string $userId): void
    {
        $this->inner->revokeAllSessions($userId);
    }
}
