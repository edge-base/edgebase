<?php

declare(strict_types=1);

namespace EdgeBase\Core;

/**
 * EdgeBaseException — exception thrown by the EdgeBase PHP SDK.
 */
class EdgeBaseException extends \RuntimeException
{
    public function __construct(
        string $message,
        private readonly int $statusCode = 0,
        ?\Throwable $previous = null,
    ) {
        parent::__construct($message, $statusCode, $previous);
    }

    /** HTTP status code that triggered this exception. */
    public function getStatusCode(): int
    {
        return $this->statusCode;
    }
}
