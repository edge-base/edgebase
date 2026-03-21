<?php

declare(strict_types=1);

namespace EdgeBase;

final class D1Client
{
    public function __construct(private readonly \EdgeBase\Admin\D1Client $inner)
    {
    }

    public function __call(string $name, array $arguments): mixed
    {
        return $this->inner->{$name}(...$arguments);
    }
}
