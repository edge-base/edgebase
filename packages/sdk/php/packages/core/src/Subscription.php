<?php

declare(strict_types=1);

namespace EdgeBase;

/**
 * Subscription — returned by RoomClient event subscription methods.
 *
 * Call `unsubscribe()` to remove the handler.
 */
class Subscription
{
    private \Closure $unsub;
    private bool $unsubscribed = false;

    public function __construct(callable $unsub)
    {
        $this->unsub = \Closure::fromCallable($unsub);
    }

    /** Remove the handler from the subscription list. Idempotent. */
    public function unsubscribe(): void
    {
        if ($this->unsubscribed) {
            return;
        }
        $this->unsubscribed = true;
        ($this->unsub)();
    }
}
