using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using EdgeBase.Generated;

namespace EdgeBase.Admin
{
    public sealed class AnalyticsEvent
    {
        public string Name { get; set; } = "";
        public Dictionary<string, object?>? Properties { get; set; }
        public long? Timestamp { get; set; }
        public string? UserId { get; set; }
    }

    public sealed class AnalyticsClient
    {
        private readonly GeneratedAnalyticsMethods _methods;
        private readonly GeneratedAdminApi _adminCore;

        internal AnalyticsClient(GeneratedDbApi core, GeneratedAdminApi adminCore)
        {
            _methods = new GeneratedAnalyticsMethods(core);
            _adminCore = adminCore;
        }

        public Task<Dictionary<string, object?>> OverviewAsync(
            Dictionary<string, string>? options = null,
            CancellationToken ct = default) =>
            _adminCore.QueryAnalyticsAsync(BuildQuery("overview", options), ct);

        public async Task<List<Dictionary<string, object?>>> TimeSeriesAsync(
            Dictionary<string, string>? options = null,
            CancellationToken ct = default)
        {
            var result = await _adminCore.QueryAnalyticsAsync(BuildQuery("timeSeries", options), ct);
            return JsonHelper.ExtractList(result, "timeSeries");
        }

        public async Task<List<Dictionary<string, object?>>> BreakdownAsync(
            Dictionary<string, string>? options = null,
            CancellationToken ct = default)
        {
            var result = await _adminCore.QueryAnalyticsAsync(BuildQuery("breakdown", options), ct);
            return JsonHelper.ExtractList(result, "breakdown");
        }

        public async Task<List<Dictionary<string, object?>>> TopEndpointsAsync(
            Dictionary<string, string>? options = null,
            CancellationToken ct = default)
        {
            var result = await _adminCore.QueryAnalyticsAsync(BuildQuery("topEndpoints", options), ct);
            return JsonHelper.ExtractList(result, "topItems");
        }

        public Task TrackAsync(
            string name,
            Dictionary<string, object?>? properties = null,
            string? userId = null,
            CancellationToken ct = default) =>
            TrackBatchAsync(new[]
            {
                new AnalyticsEvent { Name = name, Properties = properties, UserId = userId }
            }, ct);

        public async Task TrackBatchAsync(
            IEnumerable<AnalyticsEvent> events,
            CancellationToken ct = default)
        {
            var materialized = events?.ToList() ?? new List<AnalyticsEvent>();
            if (materialized.Count == 0)
            {
                return;
            }

            var payload = new
            {
                events = materialized.Select(evt =>
                {
                    var entry = new Dictionary<string, object?>
                    {
                        ["name"] = evt.Name,
                        ["timestamp"] = evt.Timestamp ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                    };
                    if (evt.Properties is { Count: > 0 })
                    {
                        entry["properties"] = evt.Properties;
                    }
                    if (!string.IsNullOrWhiteSpace(evt.UserId))
                    {
                        entry["userId"] = evt.UserId;
                    }
                    return entry;
                }).ToList()
            };

            await _methods.TrackAsync(payload, ct);
        }

        public Task<Dictionary<string, object?>> QueryEventsAsync(
            Dictionary<string, string>? options = null,
            CancellationToken ct = default) =>
            _adminCore.QueryCustomEventsAsync(options ?? new Dictionary<string, string>(), ct);

        private static Dictionary<string, string> BuildQuery(
            string metric,
            Dictionary<string, string>? options)
        {
            var query = new Dictionary<string, string> { ["metric"] = metric };
            if (options == null)
            {
                return query;
            }

            foreach (var item in options)
            {
                query[item.Key] = item.Value;
            }

            return query;
        }
    }
}
