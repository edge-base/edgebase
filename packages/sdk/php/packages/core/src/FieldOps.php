<?php
/**
 * Atomic field operation helpers.
 *
 * Usage:
 *   $ref->update($id, [
 *       'views' => FieldOps::increment(1),
 *       'temp'  => FieldOps::deleteField(),
 *   ]);
 */

namespace EdgeBase\Core;

class FieldOps
{
    /**
     * Increment a numeric field atomically.
     * Server: field = COALESCE(field, 0) + $value.
     *
     * @param int|float $value Amount to increment (negative to decrement).
     * @return array{$op: string, value: int|float}
     */
    public static function increment(int|float $value = 1): array
    {
        return ['$op' => 'increment', 'value' => $value];
    }

    /**
     * Delete a field (set to NULL).
     * Server: field = NULL.
     *
     * @return array{$op: string}
     */
    public static function deleteField(): array
    {
        return ['$op' => 'deleteField'];
    }
}
