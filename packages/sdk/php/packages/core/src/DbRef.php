<?php

declare(strict_types=1);

namespace EdgeBase\Core;

use EdgeBase\Core\Generated\GeneratedDbApi;

/**
 * DbRef — reference to a DB namespace block for table access (#133 §2).
 *
 * Obtained via AdminClient::db('shared') or AdminClient::db('workspace', 'ws-456').
 *
 * Usage:
 *   $result = $admin->db('shared')->table('posts')->where('published', '==', true)->get();
 *   $result = $admin->db('workspace', 'ws-456')->table('docs')->get();
 */
class DbRef
{
    public function __construct(
        private readonly GeneratedDbApi $core,
        private readonly string $namespace,
        private readonly ?string $instanceId = null,
    ) {
    }

    /** Get a TableRef for the named table. */
    public function table(string $name): TableRef
    {
        return new TableRef($this->core, $name, $this->namespace, $this->instanceId);
    }
}
