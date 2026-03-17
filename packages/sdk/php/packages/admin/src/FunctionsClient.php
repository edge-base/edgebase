<?php

declare(strict_types=1);

namespace EdgeBase\Admin;

use EdgeBase\Core\HttpClient;

class FunctionsClient
{
    public function __construct(
        private HttpClient $http,
    ) {
    }

    public function call(
        string $path,
        string $method = 'POST',
        mixed $body = null,
        array $query = [],
    ): mixed {
        $normalizedPath = '/functions/' . ltrim($path, '/');
        $normalizedMethod = strtoupper($method);

        return match ($normalizedMethod) {
            'GET' => $this->http->get($normalizedPath, $query),
            'PUT' => $this->http->put($normalizedPath, $body),
            'PATCH' => $this->http->patch($normalizedPath, $body),
            'DELETE' => $this->http->delete($normalizedPath),
            default => $this->http->post($normalizedPath, $body),
        };
    }

    public function get(string $path, array $query = []): mixed
    {
        return $this->call($path, 'GET', null, $query);
    }

    public function post(string $path, mixed $body = null): mixed
    {
        return $this->call($path, 'POST', $body);
    }

    public function put(string $path, mixed $body = null): mixed
    {
        return $this->call($path, 'PUT', $body);
    }

    public function patch(string $path, mixed $body = null): mixed
    {
        return $this->call($path, 'PATCH', $body);
    }

    public function delete(string $path): mixed
    {
        return $this->call($path, 'DELETE');
    }
}
