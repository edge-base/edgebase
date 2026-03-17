<?php
/**
 * Unit tests for FieldOps.
 */

declare(strict_types=1);

use PHPUnit\Framework\TestCase;
use EdgeBase\FieldOps;

class FieldOpsTest extends TestCase
{
    public function testIncrementReturnsCorrectMarker(): void
    {
        $marker = FieldOps::increment(1);
        $this->assertSame('increment', $marker['$op']);
        $this->assertSame(1, $marker['value']);
    }

    public function testIncrementNegativeValues(): void
    {
        $marker = FieldOps::increment(-5);
        $this->assertSame(-5, $marker['value']);
    }

    public function testIncrementFloatValues(): void
    {
        $marker = FieldOps::increment(1.5);
        $this->assertSame(1.5, $marker['value']);
    }

    public function testDeleteFieldReturnsCorrectMarker(): void
    {
        $marker = FieldOps::deleteField();
        $this->assertSame('deleteField', $marker['$op']);
        $this->assertArrayNotHasKey('value', $marker);
    }
}
