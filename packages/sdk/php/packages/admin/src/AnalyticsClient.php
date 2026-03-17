<?php

declare(strict_types=1);

namespace EdgeBase\Admin;

use EdgeBase\Core\Generated\GeneratedAdminApi;
use EdgeBase\Core\Generated\GeneratedAnalyticsMethods;
use EdgeBase\Core\Generated\GeneratedDbApi;

class AnalyticsClient
{
    private GeneratedAnalyticsMethods $methods;

    public function __construct(
        GeneratedDbApi $core,
        private GeneratedAdminApi $adminCore,
    ) {
        $this->methods = new GeneratedAnalyticsMethods($core);
    }

    /** @return array<string, mixed> */
    public function overview(array $options = []): array
    {
        $result = $this->adminCore->query_analytics($this->buildQuery('overview', $options));
        return is_array($result) ? $result : [];
    }

    /** @return list<array<string, mixed>> */
    public function timeSeries(array $options = []): array
    {
        $result = $this->adminCore->query_analytics($this->buildQuery('timeSeries', $options));
        return is_array($result) && isset($result['timeSeries']) && is_array($result['timeSeries'])
            ? array_values(array_filter($result['timeSeries'], 'is_array'))
            : [];
    }

    /** @return list<array<string, mixed>> */
    public function breakdown(array $options = []): array
    {
        $result = $this->adminCore->query_analytics($this->buildQuery('breakdown', $options));
        return is_array($result) && isset($result['breakdown']) && is_array($result['breakdown'])
            ? array_values(array_filter($result['breakdown'], 'is_array'))
            : [];
    }

    /** @return list<array<string, mixed>> */
    public function topEndpoints(array $options = []): array
    {
        $result = $this->adminCore->query_analytics($this->buildQuery('topEndpoints', $options));
        return is_array($result) && isset($result['topItems']) && is_array($result['topItems'])
            ? array_values(array_filter($result['topItems'], 'is_array'))
            : [];
    }

    public function track(string $name, array $properties = [], ?string $userId = null): void
    {
        $event = [
            'name' => $name,
            'timestamp' => (int) round(microtime(true) * 1000),
        ];
        if ($properties !== []) {
            $event['properties'] = $properties;
        }
        if ($userId !== null && $userId !== '') {
            $event['userId'] = $userId;
        }
        $this->trackBatch([$event]);
    }

    /** @param list<array<string, mixed>> $events */
    public function trackBatch(array $events): void
    {
        if ($events === []) {
            return;
        }

        $normalized = array_map(function (array $event): array {
            if (!isset($event['timestamp'])) {
                $event['timestamp'] = (int) round(microtime(true) * 1000);
            }
            return $event;
        }, $events);

        $this->methods->track(['events' => $normalized]);
    }

    public function queryEvents(array $options = []): mixed
    {
        return $this->adminCore->query_custom_events($options);
    }

    /** @return array<string, string> */
    private function buildQuery(string $metric, array $options): array
    {
        return ['metric' => $metric, ...$options];
    }
}
