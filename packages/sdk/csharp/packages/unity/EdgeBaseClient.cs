using System;
using System.Collections.Generic;
using EdgeBase.Generated;

namespace EdgeBase
{
    /// <summary>
    /// Main EdgeBase client entry point.
    /// </summary>
    public class EdgeBase : IDisposable
    {
        public string BaseUrl { get; }
        public AuthClient Auth { get; }
        public StorageClient Storage { get; }
        public PushClient Push { get; }
        public FunctionsClient Functions { get; }
        public AnalyticsClient Analytics { get; }
        private readonly JbHttpClient _http;
        private readonly GeneratedDbApi _core;
        private readonly DatabaseLiveClient _databaseLive;

        public EdgeBase(string baseUrl)
        {
            BaseUrl = baseUrl.TrimEnd('/');
            _http = new JbHttpClient(BaseUrl);
            _core = new GeneratedDbApi(_http);
            Auth = new AuthClient(_http);
            Storage = new StorageClient(_http);
            _databaseLive = new DatabaseLiveClient(BaseUrl, _http, Auth);
            Push = new PushClient(_http);
            Functions = new FunctionsClient(_http);
            Analytics = new AnalyticsClient(_core);
        }

        public static EdgeBase CreateClient(string baseUrl) => new(baseUrl);

        public DbRef Db(string ns, string? instanceId = null) => new DbRef(_databaseLive, _core, ns, instanceId);

        /// <summary>
        /// Create a RoomClient for the given namespace and room ID (v2 protocol).
        /// </summary>
        /// <example>
        /// var room = client.Room("game", "room-123");
        /// await room.Join();
        /// var result = await room.Send("SET_SCORE", new { score = 42 });
        /// </example>
        public RoomClient Room(string namespaceName, string roomId,
                               int maxReconnectAttempts = 10, int reconnectBaseDelayMs = 1000, int sendTimeoutMs = 10000)
            => new RoomClient(BaseUrl, namespaceName, roomId, () => Auth.GetAccessToken(),
                              maxReconnectAttempts, reconnectBaseDelayMs, sendTimeoutMs);

        public void SetContext(Dictionary<string, object> context) => _http.SetContext(context);

        public Dictionary<string, object>? GetContext() => _http.GetContext();

        public void SetLocale(string? locale) => _http.SetLocale(locale);

        public string? GetLocale() => _http.GetLocale();

        public void ClearContext() => _http.SetContext(new Dictionary<string, object>());

        public void Destroy() => Dispose();

        public void Dispose()
        {
            Analytics?.Destroy();
            _http?.Dispose();
            _databaseLive?.Dispose();
        }
    }
}

namespace EdgeBase
{
    /// <summary>DB namespace block reference for table access (#133 §2).</summary>
    public sealed class DbRef
    {
        private readonly DatabaseLiveClient _databaseLive;
        private readonly GeneratedDbApi _core;
        private readonly string _ns;
        private readonly string? _instanceId;

        internal DbRef(DatabaseLiveClient databaseLive, GeneratedDbApi core, string ns, string? instanceId)
        { _databaseLive = databaseLive; _core = core; _ns = ns; _instanceId = instanceId; }

        public TableRef Table(string name)
            => TableRef.WithDb(_core, name, _ns, _instanceId, _databaseLive.OnSnapshot);
    }

}
