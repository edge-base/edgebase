<?php

declare(strict_types=1);

namespace EdgeBase;

final class FieldOps
{
    public static function increment(int|float $value): array
    {
        return \EdgeBase\Core\FieldOps::increment($value);
    }

    public static function deleteField(): array
    {
        return \EdgeBase\Core\FieldOps::deleteField();
    }
}
