<?php

declare(strict_types=1);

namespace EdgeBase;

final class VectorizeClient
{
    public function __construct(private readonly \EdgeBase\Admin\VectorizeClient $inner)
    {
    }

    public function __call(string $name, array $arguments): mixed
    {
        return $this->inner->{$name}(...$arguments);
    }
}
