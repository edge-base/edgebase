import Foundation
import RealtimeKit
import UIKit

let roomMediaDocsURL = "https://edgebase.fun/docs/room/media"

public typealias RoomMediaTransportConnectPayload = [String: Any]

public struct RoomMediaRemoteTrackEvent {
    public let kind: String
    public let track: Any?
    public let view: AnyObject?
    public let trackName: String?
    public let providerSessionId: String?
    public let participantId: String?
    public let customParticipantId: String?
    public let userId: String?
    public let participant: [String: Any]

    public init(
        kind: String,
        track: Any?,
        view: AnyObject?,
        trackName: String? = nil,
        providerSessionId: String? = nil,
        participantId: String? = nil,
        customParticipantId: String? = nil,
        userId: String? = nil,
        participant: [String: Any] = [:]
    ) {
        self.kind = kind
        self.track = track
        self.view = view
        self.trackName = trackName
        self.providerSessionId = providerSessionId
        self.participantId = participantId
        self.customParticipantId = customParticipantId
        self.userId = userId
        self.participant = participant
    }
}

public protocol RoomMediaTransport: AnyObject {
    func connect(_ payload: RoomMediaTransportConnectPayload?) async throws -> String
    func enableAudio(_ payload: [String: Any]?) async throws -> Any?
    func enableVideo(_ payload: [String: Any]?) async throws -> Any?
    func startScreenShare(_ payload: [String: Any]?) async throws -> Any?
    func disableAudio() async throws
    func disableVideo() async throws
    func stopScreenShare() async throws
    func setMuted(kind: String, muted: Bool) async throws
    func switchDevices(_ payload: [String: Any]) async throws
    func onRemoteTrack(_ handler: @escaping (RoomMediaRemoteTrackEvent) -> Void) -> Subscription
    func getSessionId() -> String?
    func getPeerConnection() -> AnyObject?
    func destroy()
}

public enum RoomMediaTransportProvider: String, Sendable {
    case cloudflareRealtimeKit = "cloudflare_realtimekit"
    case p2p = "p2p"
}

public struct RoomCloudflareRealtimeKitTransportOptions {
    public var autoSubscribe: Bool
    public var baseDomain: String
    public var clientFactory: RoomCloudflareRealtimeKitClientFactory?

    public init(
        autoSubscribe: Bool = true,
        baseDomain: String = "dyte.io",
        clientFactory: RoomCloudflareRealtimeKitClientFactory? = nil
    ) {
        self.autoSubscribe = autoSubscribe
        self.baseDomain = baseDomain
        self.clientFactory = clientFactory
    }
}

public struct RoomMediaTransportOptions {
    public var provider: RoomMediaTransportProvider
    public var cloudflareRealtimeKit: RoomCloudflareRealtimeKitTransportOptions?
    public var p2p: RoomP2PMediaTransportOptions?

    public init(
        provider: RoomMediaTransportProvider = .cloudflareRealtimeKit,
        cloudflareRealtimeKit: RoomCloudflareRealtimeKitTransportOptions? = nil,
        p2p: RoomP2PMediaTransportOptions? = nil
    ) {
        self.provider = provider
        self.cloudflareRealtimeKit = cloudflareRealtimeKit
        self.p2p = p2p
    }
}

public struct RoomCloudflareRealtimeKitClientFactoryOptions {
    public let authToken: String
    public let displayName: String?
    public let enableAudio: Bool
    public let enableVideo: Bool
    public let baseDomain: String

    public init(
        authToken: String,
        displayName: String? = nil,
        enableAudio: Bool = false,
        enableVideo: Bool = false,
        baseDomain: String = "dyte.io"
    ) {
        self.authToken = authToken
        self.displayName = displayName
        self.enableAudio = enableAudio
        self.enableVideo = enableVideo
        self.baseDomain = baseDomain
    }
}

public typealias RoomCloudflareRealtimeKitClientFactory =
    @Sendable (RoomCloudflareRealtimeKitClientFactoryOptions) async throws -> any RoomCloudflareRealtimeKitClientAdapter

public struct RoomCloudflareParticipantSnapshot {
    public let id: String
    public let userId: String
    public let name: String
    public let picture: String?
    public let customParticipantId: String?
    public let audioEnabled: Bool
    public let videoEnabled: Bool
    public let screenShareEnabled: Bool
    public let participantHandle: AnyObject?

    public init(
        id: String,
        userId: String,
        name: String,
        picture: String? = nil,
        customParticipantId: String? = nil,
        audioEnabled: Bool,
        videoEnabled: Bool,
        screenShareEnabled: Bool,
        participantHandle: AnyObject?
    ) {
        self.id = id
        self.userId = userId
        self.name = name
        self.picture = picture
        self.customParticipantId = customParticipantId
        self.audioEnabled = audioEnabled
        self.videoEnabled = videoEnabled
        self.screenShareEnabled = screenShareEnabled
        self.participantHandle = participantHandle
    }

    public func toMap() -> [String: Any] {
        var result: [String: Any] = [
            "id": id,
            "userId": userId,
            "name": name,
            "audioEnabled": audioEnabled,
            "videoEnabled": videoEnabled,
            "screenShareEnabled": screenShareEnabled,
        ]
        if let picture {
            result["picture"] = picture
        }
        if let customParticipantId {
            result["customParticipantId"] = customParticipantId
        }
        return result
    }
}

public protocol RoomCloudflareParticipantListener: AnyObject {
    func onParticipantJoin(_ participant: RoomCloudflareParticipantSnapshot)
    func onParticipantLeave(_ participant: RoomCloudflareParticipantSnapshot)
    func onAudioUpdate(_ participant: RoomCloudflareParticipantSnapshot, enabled: Bool)
    func onVideoUpdate(_ participant: RoomCloudflareParticipantSnapshot, enabled: Bool)
    func onScreenShareUpdate(_ participant: RoomCloudflareParticipantSnapshot, enabled: Bool)
    func onParticipantsSync(_ participants: [RoomCloudflareParticipantSnapshot])
}

extension RoomCloudflareParticipantListener {
    public func onParticipantJoin(_ participant: RoomCloudflareParticipantSnapshot) {}
    public func onParticipantLeave(_ participant: RoomCloudflareParticipantSnapshot) {}
    public func onAudioUpdate(_ participant: RoomCloudflareParticipantSnapshot, enabled: Bool) {}
    public func onVideoUpdate(_ participant: RoomCloudflareParticipantSnapshot, enabled: Bool) {}
    public func onScreenShareUpdate(_ participant: RoomCloudflareParticipantSnapshot, enabled: Bool) {}
    public func onParticipantsSync(_ participants: [RoomCloudflareParticipantSnapshot]) {}
}

public protocol RoomCloudflareRealtimeKitClientAdapter: AnyObject {
    func joinRoom() async throws
    func leaveRoom() async throws
    func enableAudio() async throws
    func disableAudio() async throws
    func enableVideo() async throws
    func disableVideo() async throws
    func enableScreenShare() async throws
    func disableScreenShare() async throws
    func setAudioDevice(_ deviceId: String) async throws
    func setVideoDevice(_ deviceId: String) async throws
    var localParticipant: RoomCloudflareParticipantSnapshot { get }
    var joinedParticipants: [RoomCloudflareParticipantSnapshot] { get }
    func buildView(participant: RoomCloudflareParticipantSnapshot, kind: String, isSelf: Bool) -> AnyObject?
    func addListener(_ listener: any RoomCloudflareParticipantListener)
    func removeListener(_ listener: any RoomCloudflareParticipantListener)
}

public final class RoomCloudflareMediaTransport: RoomMediaTransport {
    private unowned let room: RoomClient
    private let options: RoomCloudflareRealtimeKitTransportOptions
    private var remoteTrackHandlers: [UUID: (RoomMediaRemoteTrackEvent) -> Void] = [:]
    private var publishedRemoteKeys = Set<String>()
    private var client: (any RoomCloudflareRealtimeKitClientAdapter)?
    private var sessionId: String?
    private var providerSessionId: String?
    private var participantListener: _RoomCloudflareTransportParticipantListener?

    init(room: RoomClient, options: RoomCloudflareRealtimeKitTransportOptions) {
        self.room = room
        self.options = options
    }

    public func connect(_ payload: RoomMediaTransportConnectPayload? = nil) async throws -> String {
        if let sessionId {
            return sessionId
        }

        let session = try await room.media.cloudflareRealtimeKit.createSession(payload ?? [:])
        guard let authToken = session["authToken"] as? String else {
            throw RoomMediaTransportError("Cloudflare RealtimeKit session is missing authToken.")
        }

        let factory = try resolveClientFactory()
        let client = try await factory(
            RoomCloudflareRealtimeKitClientFactoryOptions(
                authToken: authToken,
                displayName: payload?["name"] as? String,
                enableAudio: false,
                enableVideo: false,
                baseDomain: options.baseDomain
            )
        )

        self.client = client
        sessionId = session["sessionId"] as? String
        providerSessionId = session["participantId"] as? String

        let listener = _RoomCloudflareTransportParticipantListener(transport: self)
        participantListener = listener
        client.addListener(listener)

        do {
            try await client.joinRoom()
            syncParticipants(client.joinedParticipants)
            return sessionId ?? (session["sessionId"] as? String) ?? ""
        } catch {
            client.removeListener(listener)
            participantListener = nil
            self.client = nil
            sessionId = nil
            providerSessionId = nil
            throw error
        }
    }

    public func enableAudio(_ payload: [String: Any]? = nil) async throws -> Any? {
        let client = try requireClient()
        try await client.enableAudio()
        try await room.media.audio.enable(withProviderSession(payload))
        return client.localParticipant.participantHandle
    }

    public func enableVideo(_ payload: [String: Any]? = nil) async throws -> Any? {
        let client = try requireClient()
        try await client.enableVideo()
        try await room.media.video.enable(withProviderSession(payload))
        return client.buildView(participant: client.localParticipant, kind: "video", isSelf: true)
    }

    public func startScreenShare(_ payload: [String: Any]? = nil) async throws -> Any? {
        let client = try requireClient()
        try await client.enableScreenShare()
        try await room.media.screen.start(withProviderSession(payload))
        return client.buildView(participant: client.localParticipant, kind: "screen", isSelf: true)
    }

    public func disableAudio() async throws {
        guard let client else { return }
        try await client.disableAudio()
        try await room.media.audio.disable()
    }

    public func disableVideo() async throws {
        guard let client else { return }
        try await client.disableVideo()
        try await room.media.video.disable()
    }

    public func stopScreenShare() async throws {
        guard let client else { return }
        try await client.disableScreenShare()
        try await room.media.screen.stop()
    }

    public func setMuted(kind: String, muted: Bool) async throws {
        switch kind {
        case "audio":
            if muted {
                try await disableAudio()
            } else {
                _ = try await enableAudio(["providerSessionId": providerSessionId as Any])
            }
        case "video":
            if muted {
                try await disableVideo()
            } else {
                _ = try await enableVideo(["providerSessionId": providerSessionId as Any])
            }
        default:
            throw RoomMediaTransportError("Unsupported mute kind: \(kind)")
        }
    }

    public func switchDevices(_ payload: [String: Any]) async throws {
        let client = try requireClient()

        if let audioInputId = payload["audioInputId"] as? String, !audioInputId.isEmpty {
            try await client.setAudioDevice(audioInputId)
        }

        if let videoInputId = payload["videoInputId"] as? String, !videoInputId.isEmpty {
            try await client.setVideoDevice(videoInputId)
        }

        try await room.media.devices.switch(payload)
    }

    public func onRemoteTrack(_ handler: @escaping (RoomMediaRemoteTrackEvent) -> Void) -> Subscription {
        let id = UUID()
        remoteTrackHandlers[id] = handler
        return Subscription { [weak self] in
            self?.remoteTrackHandlers.removeValue(forKey: id)
        }
    }

    public func getSessionId() -> String? {
        sessionId
    }

    public func getPeerConnection() -> AnyObject? {
        nil
    }

    public func destroy() {
        let client = client
        let listener = participantListener
        self.client = nil
        participantListener = nil
        sessionId = nil
        providerSessionId = nil
        publishedRemoteKeys.removeAll()

        if let client, let listener {
            client.removeListener(listener)
            Task {
                try? await client.leaveRoom()
            }
        }
    }

    fileprivate func syncParticipants(_ participants: [RoomCloudflareParticipantSnapshot]) {
        for participant in participants {
            syncParticipant(participant)
        }
    }

    fileprivate func syncParticipant(_ participant: RoomCloudflareParticipantSnapshot) {
        emitParticipantKind(participant, kind: "audio", enabled: participant.audioEnabled)
        emitParticipantKind(participant, kind: "video", enabled: participant.videoEnabled)
        emitParticipantKind(participant, kind: "screen", enabled: participant.screenShareEnabled)
    }

    fileprivate func removeParticipant(_ participant: RoomCloudflareParticipantSnapshot) {
        publishedRemoteKeys = publishedRemoteKeys.filter { !$0.hasPrefix("\(participant.id):") }
    }

    fileprivate func emitParticipantKind(_ participant: RoomCloudflareParticipantSnapshot, kind: String, enabled: Bool) {
        let key = "\(participant.id):\(kind)"
        if !enabled {
            publishedRemoteKeys.remove(key)
            return
        }
        if publishedRemoteKeys.contains(key) {
            return
        }
        publishedRemoteKeys.insert(key)

        let event = RoomMediaRemoteTrackEvent(
            kind: kind,
            track: participant.participantHandle,
            view: client?.buildView(participant: participant, kind: kind, isSelf: false),
            providerSessionId: participant.id,
            participantId: participant.id,
            customParticipantId: participant.customParticipantId,
            userId: participant.userId,
            participant: participant.toMap()
        )

        for handler in remoteTrackHandlers.values {
            handler(event)
        }
    }

    private func requireClient() throws -> any RoomCloudflareRealtimeKitClientAdapter {
        guard let client else {
            throw RoomMediaTransportError(
                "Call room.media.transport().connect() before using media controls."
            )
        }
        return client
    }

    private func resolveClientFactory() throws -> RoomCloudflareRealtimeKitClientFactory {
        if let clientFactory = options.clientFactory {
            return clientFactory
        }
        if let factory = defaultCloudflareRealtimeKitClientFactory() {
            return factory
        }
        throw RoomMediaTransportError(
            "Cloudflare RealtimeKit room media requires the EdgeBase Swift iOS runtime. See \(roomMediaDocsURL)"
        )
    }

    private func withProviderSession(_ payload: [String: Any]?) -> [String: Any] {
        var next = payload ?? [:]
        if let providerSessionId {
            next["providerSessionId"] = providerSessionId
        }
        return next
    }
}

private final class UnsupportedRoomMediaTransport: RoomMediaTransport {
    private let provider: RoomMediaTransportProvider

    init(provider: RoomMediaTransportProvider) {
        self.provider = provider
    }

    func connect(_ payload: RoomMediaTransportConnectPayload?) async throws -> String {
        throw unsupported()
    }

    func enableAudio(_ payload: [String: Any]?) async throws -> Any? {
        throw unsupported()
    }

    func enableVideo(_ payload: [String: Any]?) async throws -> Any? {
        throw unsupported()
    }

    func startScreenShare(_ payload: [String: Any]?) async throws -> Any? {
        throw unsupported()
    }

    func disableAudio() async throws {
        throw unsupported()
    }

    func disableVideo() async throws {
        throw unsupported()
    }

    func stopScreenShare() async throws {
        throw unsupported()
    }

    func setMuted(kind: String, muted: Bool) async throws {
        throw unsupported()
    }

    func switchDevices(_ payload: [String: Any]) async throws {
        throw unsupported()
    }

    func onRemoteTrack(_ handler: @escaping (RoomMediaRemoteTrackEvent) -> Void) -> Subscription {
        Subscription {}
    }

    func getSessionId() -> String? {
        nil
    }

    func getPeerConnection() -> AnyObject? {
        nil
    }

    func destroy() {}

    private func unsupported() -> Error {
        RoomMediaTransportError(
            "\(provider.rawValue) room media requires the EdgeBase Swift iOS runtime. See \(roomMediaDocsURL)"
        )
    }
}

private final class _RoomCloudflareTransportParticipantListener: RoomCloudflareParticipantListener {
    private weak var transport: RoomCloudflareMediaTransport?

    init(transport: RoomCloudflareMediaTransport) {
        self.transport = transport
    }

    func onParticipantJoin(_ participant: RoomCloudflareParticipantSnapshot) {
        transport?.syncParticipant(participant)
    }

    func onParticipantLeave(_ participant: RoomCloudflareParticipantSnapshot) {
        transport?.removeParticipant(participant)
    }

    func onAudioUpdate(_ participant: RoomCloudflareParticipantSnapshot, enabled: Bool) {
        transport?.emitParticipantKind(participant, kind: "audio", enabled: enabled)
    }

    func onVideoUpdate(_ participant: RoomCloudflareParticipantSnapshot, enabled: Bool) {
        transport?.emitParticipantKind(participant, kind: "video", enabled: enabled)
    }

    func onScreenShareUpdate(_ participant: RoomCloudflareParticipantSnapshot, enabled: Bool) {
        transport?.emitParticipantKind(participant, kind: "screen", enabled: enabled)
    }

    func onParticipantsSync(_ participants: [RoomCloudflareParticipantSnapshot]) {
        transport?.syncParticipants(participants)
    }
}

struct RoomMediaTransportError: LocalizedError {
    let message: String

    init(_ message: String) {
        self.message = message
    }

    var errorDescription: String? {
        message
    }
}

private func defaultCloudflareRealtimeKitClientFactory() -> RoomCloudflareRealtimeKitClientFactory? {
    return { options in
        let meeting = RealtimeKitiOSClientBuilder().build()
        let meetingInfo = RtkMeetingInfo(
            authToken: options.authToken,
            enableAudio: options.enableAudio,
            enableVideo: options.enableVideo,
            baseDomain: options.baseDomain
        )

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            meeting.doInit(
                meetingInfo: meetingInfo,
                onSuccess: {
                    continuation.resume(returning: ())
                },
                onFailure: { error in
                    continuation.resume(
                        throwing: RoomMediaTransportError("RealtimeKit init failed: \(String(describing: error))")
                    )
                }
            )
        }

        return NativeRoomCloudflareRealtimeKitClientAdapter(meeting: meeting)
    }
}

private final class NativeRoomCloudflareRealtimeKitClientAdapter: NSObject, RoomCloudflareRealtimeKitClientAdapter {
    private let meeting: RealtimeKitClient
    private let bridge = NativeRoomCloudflareParticipantsBridge()

    init(meeting: RealtimeKitClient) {
        self.meeting = meeting
    }

    func joinRoom() async throws {
        meeting.addParticipantsEventListener(participantsEventListener: bridge)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            meeting.joinRoom(
                onSuccess: {
                    continuation.resume(returning: ())
                },
                onFailure: { error in
                    continuation.resume(
                        throwing: RoomMediaTransportError("RealtimeKit joinRoom failed: \(String(describing: error))")
                    )
                }
            )
        }
    }

    func leaveRoom() async throws {
        meeting.removeParticipantsEventListener(participantsEventListener: bridge)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            meeting.leaveRoom(
                onSuccess: {
                    continuation.resume(returning: ())
                },
                onFailure: { error in
                    continuation.resume(
                        throwing: RoomMediaTransportError("RealtimeKit leaveRoom failed: \(String(describing: error))")
                    )
                }
            )
        }
    }

    func enableAudio() async throws {
        try await waitForMediaResult { completion in
            meeting.localUser.enableAudio { error in
                completion(error)
            }
        }
    }

    func disableAudio() async throws {
        try await waitForMediaResult { completion in
            meeting.localUser.disableAudio { error in
                completion(error)
            }
        }
    }

    func enableVideo() async throws {
        try await waitForMediaResult { completion in
            meeting.localUser.enableVideo { error in
                completion(error)
            }
        }
    }

    func disableVideo() async throws {
        try await waitForMediaResult { completion in
            meeting.localUser.disableVideo { error in
                completion(error)
            }
        }
    }

    func enableScreenShare() async throws {
        if let error = meeting.localUser.enableScreenShare() {
            throw RoomMediaTransportError("RealtimeKit screen-share failed: \(String(describing: error))")
        }
    }

    func disableScreenShare() async throws {
        meeting.localUser.disableScreenShare()
    }

    func setAudioDevice(_ deviceId: String) async throws {
        guard let device = meeting.localUser.getAudioDevices().first(where: { $0.id == deviceId }) else {
            throw RoomMediaTransportError("Unknown audio input device: \(deviceId)")
        }
        meeting.localUser.setAudioDevice(rtkAudioDevice: device)
    }

    func setVideoDevice(_ deviceId: String) async throws {
        guard let device = meeting.localUser.getVideoDevices().first(where: { $0.id == deviceId }) else {
            throw RoomMediaTransportError("Unknown video input device: \(deviceId)")
        }
        meeting.localUser.setVideoDevice(rtkVideoDevice: device)
    }

    var localParticipant: RoomCloudflareParticipantSnapshot {
        snapshot(from: meeting.localUser)
    }

    var joinedParticipants: [RoomCloudflareParticipantSnapshot] {
        meeting.participants.joined.map(snapshot)
    }

    func buildView(participant: RoomCloudflareParticipantSnapshot, kind: String, isSelf: Bool) -> AnyObject? {
        let createView = { [self]
            () -> AnyObject? in
            if kind == "video" {
                if isSelf {
                    return meeting.localUser.getSelfPreview()
                }
                return (participant.participantHandle as? RtkMeetingParticipant)?.getVideoView()
            }

            if kind == "screen" {
                return (participant.participantHandle as? RtkMeetingParticipant)?.getScreenShareVideoView()
            }

            return nil
        }

        if Thread.isMainThread {
            return createView()
        }

        var view: AnyObject?
        DispatchQueue.main.sync {
            view = createView()
        }
        return view
    }

    func addListener(_ listener: any RoomCloudflareParticipantListener) {
        bridge.add(listener)
    }

    func removeListener(_ listener: any RoomCloudflareParticipantListener) {
        bridge.remove(listener)
    }

    private func snapshot(from participant: RtkMeetingParticipant) -> RoomCloudflareParticipantSnapshot {
        RoomCloudflareParticipantSnapshot(
            id: participant.id,
            userId: participant.userId,
            name: participant.name,
            picture: participant.picture,
            customParticipantId: participant.customParticipantId,
            audioEnabled: participant.audioEnabled,
            videoEnabled: participant.videoEnabled,
            screenShareEnabled: participant.screenShareEnabled,
            participantHandle: participant
        )
    }

    private func waitForMediaResult(_ action: (@escaping (Any?) -> Void) -> Void) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            action { error in
                if let error {
                    continuation.resume(
                        throwing: RoomMediaTransportError("RealtimeKit media operation failed: \(String(describing: error))")
                    )
                } else {
                    continuation.resume(returning: ())
                }
            }
        }
    }
}

private final class NativeRoomCloudflareParticipantsBridge: NSObject, RtkParticipantsEventListener {
    private var listeners: [ObjectIdentifier: any RoomCloudflareParticipantListener] = [:]

    func add(_ listener: any RoomCloudflareParticipantListener) {
        listeners[ObjectIdentifier(listener)] = listener
    }

    func remove(_ listener: any RoomCloudflareParticipantListener) {
        listeners.removeValue(forKey: ObjectIdentifier(listener))
    }

    func onParticipantJoin(participant: RtkRemoteParticipant) {
        let snapshot = snapshot(from: participant)
        for listener in listeners.values {
            listener.onParticipantJoin(snapshot)
        }
    }

    func onParticipantLeave(participant: RtkRemoteParticipant) {
        let snapshot = snapshot(from: participant)
        for listener in listeners.values {
            listener.onParticipantLeave(snapshot)
        }
    }

    func onParticipantPinned(participant: RtkRemoteParticipant) {}

    func onParticipantUnpinned(participant: RtkRemoteParticipant) {}

    func onActiveParticipantsChanged(active: [RtkRemoteParticipant]) {}

    func onActiveSpeakerChanged(participant: RtkRemoteParticipant?) {}

    func onAllParticipantsUpdated(allParticipants: [RtkParticipant]) {}

    func onAudioUpdate(participant: RtkRemoteParticipant, isEnabled: Bool) {
        let snapshot = snapshot(from: participant, audioEnabled: isEnabled)
        for listener in listeners.values {
            listener.onAudioUpdate(snapshot, enabled: isEnabled)
        }
    }

    func onVideoUpdate(participant: RtkRemoteParticipant, isEnabled: Bool) {
        let snapshot = snapshot(from: participant, videoEnabled: isEnabled)
        for listener in listeners.values {
            listener.onVideoUpdate(snapshot, enabled: isEnabled)
        }
    }

    func onScreenShareUpdate(participant: RtkRemoteParticipant, isEnabled: Bool) {
        let snapshot = snapshot(from: participant, screenShareEnabled: isEnabled)
        for listener in listeners.values {
            listener.onScreenShareUpdate(snapshot, enabled: isEnabled)
        }
    }

    func onUpdate(participants: RtkParticipants) {
        let snapshots = participants.joined.map { snapshot(from: $0) }
        for listener in listeners.values {
            listener.onParticipantsSync(snapshots)
        }
    }

    func onNewBroadcastMessage(type: String, payload: [String: Any]) {}

    private func snapshot(
        from participant: RtkMeetingParticipant,
        audioEnabled: Bool? = nil,
        videoEnabled: Bool? = nil,
        screenShareEnabled: Bool? = nil
    ) -> RoomCloudflareParticipantSnapshot {
        RoomCloudflareParticipantSnapshot(
            id: participant.id,
            userId: participant.userId,
            name: participant.name,
            picture: participant.picture,
            customParticipantId: participant.customParticipantId,
            audioEnabled: audioEnabled ?? participant.audioEnabled,
            videoEnabled: videoEnabled ?? participant.videoEnabled,
            screenShareEnabled: screenShareEnabled ?? participant.screenShareEnabled,
            participantHandle: participant
        )
    }
}

extension RoomMediaNamespace {
    public func transport(_ options: RoomMediaTransportOptions = RoomMediaTransportOptions()) -> any RoomMediaTransport {
        switch options.provider {
        case .cloudflareRealtimeKit:
            return RoomCloudflareMediaTransport(
                room: room,
                options: options.cloudflareRealtimeKit ?? RoomCloudflareRealtimeKitTransportOptions()
            )
        case .p2p:
            return RoomP2PMediaTransport(
                room: room,
                options: options.p2p ?? RoomP2PMediaTransportOptions()
            )
        }
    }
}
