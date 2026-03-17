using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using EdgeBase.Generated;

namespace EdgeBase
{
    public sealed class AnalyticsEvent
    {
        public string Name { get; set; } = "";
        public Dictionary<string, object?>? Properties { get; set; }
        public long? Timestamp { get; set; }
    }

    public sealed class AnalyticsClient
    {
        private readonly GeneratedAnalyticsMethods _methods;

        internal AnalyticsClient(GeneratedDbApi core)
        {
            _methods = new GeneratedAnalyticsMethods(core);
        }

        public Task TrackAsync(
            string name,
            Dictionary<string, object?>? properties = null,
            CancellationToken ct = default) =>
            TrackBatchAsync(new[]
            {
                new AnalyticsEvent { Name = name, Properties = properties }
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
                events = materialized.Select(evt => new Dictionary<string, object?>
                {
                    ["name"] = evt.Name,
                    ["properties"] = evt.Properties,
                    ["timestamp"] = evt.Timestamp ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                }).ToList()
            };

            await _methods.TrackAsync(payload, ct);
        }

        public Task FlushAsync(CancellationToken ct = default) => Task.CompletedTask;

        public void Destroy() { }
    }
}
