import EdgeBaseCore
import Foundation

public struct AnalyticsEvent {
    public let name: String
    public let properties: [String: Any]?
    public let timestamp: Int?

    public init(name: String, properties: [String: Any]? = nil, timestamp: Int? = nil) {
        self.name = name
        self.properties = properties
        self.timestamp = timestamp
    }
}

public final class AnalyticsClient {
    private let methods: GeneratedAnalyticsMethods

    init(core: GeneratedDbApi) {
        self.methods = GeneratedAnalyticsMethods(core: core)
    }

    public func track(_ name: String, properties: [String: Any]? = nil) async throws {
        try await trackBatch([AnalyticsEvent(name: name, properties: properties)])
    }

    public func trackBatch(_ events: [AnalyticsEvent]) async throws {
        guard !events.isEmpty else { return }

        let body: [String: Any] = [
            "events": events.map { event in
                var payload: [String: Any] = [
                    "name": event.name,
                    "timestamp": event.timestamp ?? Int(Date().timeIntervalSince1970 * 1000),
                ]
                if let properties = event.properties, !properties.isEmpty {
                    payload["properties"] = properties
                }
                return payload
            }
        ]

        _ = try await methods.track(body)
    }

    public func flush() async {}

    public func destroy() {}
}
