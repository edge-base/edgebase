import Foundation
import AVFoundation
import RTKWebRTC
import UIKit

let roomP2PDefaultSignalPrefix = "edgebase.media.p2p"
let roomP2PDefaultMemberReadyTimeoutMs: UInt64 = 10_000

public struct RoomP2PIceServerOptions: Sendable {
    public var urls: [String]
    public var username: String?
    public var credential: String?

    public init(urls: [String], username: String? = nil, credential: String? = nil) {
        self.urls = urls
        self.username = username
        self.credential = credential
    }
}

public struct RoomP2PRtcConfigurationOptions: Sendable {
    public var iceServers: [RoomP2PIceServerOptions]

    public init(
        iceServers: [RoomP2PIceServerOptions] = [
            RoomP2PIceServerOptions(urls: ["stun:stun.l.google.com:19302"]),
        ]
    ) {
        self.iceServers = iceServers
    }
}

public struct RoomP2PMediaTransportOptions: Sendable {
    public var signalPrefix: String
    public var rtcConfiguration: RoomP2PRtcConfigurationOptions
    public var currentMemberTimeoutMs: UInt64

    public init(
        signalPrefix: String = "edgebase.media.p2p",
        rtcConfiguration: RoomP2PRtcConfigurationOptions = RoomP2PRtcConfigurationOptions(),
        currentMemberTimeoutMs: UInt64 = 10_000
    ) {
        self.signalPrefix = signalPrefix
        self.rtcConfiguration = rtcConfiguration
        self.currentMemberTimeoutMs = currentMemberTimeoutMs
    }
}

public struct RoomP2PScreenShareSource {
    public let track: RTKRTCVideoTrack
    public let stream: RTKRTCMediaStream?
    public let deviceId: String?
    public let stopHandler: (() -> Void)?

    public init(
        track: RTKRTCVideoTrack,
        stream: RTKRTCMediaStream? = nil,
        deviceId: String? = nil,
        stopHandler: (() -> Void)? = nil
    ) {
        self.track = track
        self.stream = stream
        self.deviceId = deviceId
        self.stopHandler = stopHandler
    }
}

internal struct RoomP2PSessionDescription {
    let type: String
    let sdp: String
}

internal struct RoomP2PIceCandidate {
    let candidate: String
    let sdpMid: String?
    let sdpMLineIndex: Int32

    init(candidate: String, sdpMid: String? = nil, sdpMLineIndex: Int32 = 0) {
        self.candidate = candidate
        self.sdpMid = sdpMid
        self.sdpMLineIndex = sdpMLineIndex
    }
}

internal protocol RoomP2PMediaTrackAdapter: AnyObject {
    var id: String { get }
    var kind: String { get }
    var deviceId: String? { get }
    var enabled: Bool { get set }
    func stop()
    func onEnded(_ handler: (() -> Void)?)
    func dispose()
    func asAny() -> Any?
}

internal protocol RoomP2PMediaStreamAdapter: AnyObject {
    func release()
    func asAny() -> Any?
}

internal struct RoomP2PCapturedTrack {
    let kind: String
    let track: RoomP2PMediaTrackAdapter
    let stream: RoomP2PMediaStreamAdapter
    let stopOnCleanup: Bool
}

internal struct RoomP2PRemoteTrackPayload {
    let track: RoomP2PMediaTrackAdapter
    let stream: RoomP2PMediaStreamAdapter
}

internal protocol RoomP2PRtpSenderAdapter: AnyObject {
    var track: RoomP2PMediaTrackAdapter? { get }
    func replaceTrack(_ track: RoomP2PMediaTrackAdapter) async throws
}

internal protocol RoomP2PPeerConnectionAdapter: AnyObject {
    var connectionState: String { get }
    var signalingState: String { get }
    var localDescription: RoomP2PSessionDescription? { get }
    var remoteDescription: RoomP2PSessionDescription? { get }
    func setIceCandidateHandler(_ handler: (@Sendable (RoomP2PIceCandidate) async -> Void)?)
    func setNegotiationNeededHandler(_ handler: (@Sendable () async -> Void)?)
    func setTrackHandler(_ handler: (@Sendable (RoomP2PRemoteTrackPayload) async -> Void)?)
    func createOffer() async throws -> RoomP2PSessionDescription
    func createAnswer() async throws -> RoomP2PSessionDescription
    func setLocalDescription(_ description: RoomP2PSessionDescription) async throws
    func setRemoteDescription(_ description: RoomP2PSessionDescription) async throws
    func addIceCandidate(_ candidate: RoomP2PIceCandidate) async throws -> Bool
    func addTrack(_ track: RoomP2PMediaTrackAdapter, stream: RoomP2PMediaStreamAdapter) -> RoomP2PRtpSenderAdapter
    func removeTrack(_ sender: RoomP2PRtpSenderAdapter) -> Bool
    func close()
    func asAnyObject() -> AnyObject?
}

internal protocol RoomP2PMediaRuntimeAdapter: AnyObject {
    func createPeerConnection(configuration: RoomP2PRtcConfigurationOptions) async throws -> RoomP2PPeerConnectionAdapter
    func captureUserMedia(kind: String, deviceId: String?) async throws -> RoomP2PCapturedTrack?
    func captureDisplayMedia() async throws -> RoomP2PCapturedTrack?
    func destroy()
}

internal typealias RoomP2PMediaRuntimeFactory = @Sendable () -> RoomP2PMediaRuntimeAdapter
internal var roomP2PMediaRuntimeFactoryOverride: RoomP2PMediaRuntimeFactory?

private struct RoomP2PLocalTrackState {
    let kind: String
    let track: RoomP2PMediaTrackAdapter
    let stream: RoomP2PMediaStreamAdapter
    let deviceId: String?
    let stopOnCleanup: Bool
}

private struct RoomP2PPendingRemoteTrack {
    let memberId: String
    let track: RoomP2PMediaTrackAdapter
    let stream: RoomP2PMediaStreamAdapter
}

private final class RoomP2PPeerState {
    let memberId: String
    let pc: RoomP2PPeerConnectionAdapter
    let polite: Bool
    var senders: [String: RoomP2PRtpSenderAdapter] = [:]
    var pendingCandidates: [RoomP2PIceCandidate] = []
    var makingOffer = false
    var ignoreOffer = false
    var isSettingRemoteAnswerPending = false

    init(memberId: String, pc: RoomP2PPeerConnectionAdapter, polite: Bool) {
        self.memberId = memberId
        self.pc = pc
        self.polite = polite
    }
}

public final class RoomP2PMediaTransport: RoomMediaTransport {
    private unowned let room: RoomClient
    private let options: RoomP2PMediaTransportOptions

    private var runtime: RoomP2PMediaRuntimeAdapter?
    private var localTracks: [String: RoomP2PLocalTrackState] = [:]
    private var peers: [String: RoomP2PPeerState] = [:]
    private var remoteTrackHandlers: [UUID: (RoomMediaRemoteTrackEvent) -> Void] = [:]
    private var remoteTrackKinds: [String: String] = [:]
    private var emittedRemoteTracks = Set<String>()
    private var pendingRemoteTracks: [String: RoomP2PPendingRemoteTrack] = [:]
    private var subscriptions: [Subscription] = []
    private var localMemberId: String?
    private var connected = false

    private var offerEvent: String { "\(options.signalPrefix).offer" }
    private var answerEvent: String { "\(options.signalPrefix).answer" }
    private var iceEvent: String { "\(options.signalPrefix).ice" }

    init(room: RoomClient, options: RoomP2PMediaTransportOptions) {
        self.room = room
        self.options = options
    }

    public func connect(_ payload: RoomMediaTransportConnectPayload? = nil) async throws -> String {
        if connected, let localMemberId {
            return localMemberId
        }

        if payload?["sessionDescription"] != nil {
            throw RoomMediaTransportError(
                "RoomP2PMediaTransport.connect() does not accept sessionDescription. Use room.signals through the built-in transport instead."
            )
        }

        _ = try resolveRuntime()
        guard let currentMember = try await waitForCurrentMember() else {
            throw RoomMediaTransportError("Join the room before connecting a P2P media transport.")
        }
        guard let memberId = currentMember["memberId"] as? String else {
            throw RoomMediaTransportError("Current room member is missing memberId.")
        }

        localMemberId = memberId
        connected = true
        hydrateRemoteTrackKinds()
        attachRoomSubscriptions()

        for member in room.members.list() {
            guard let peerMemberId = member["memberId"] as? String, peerMemberId != memberId else { continue }
            _ = try await ensurePeer(memberId: peerMemberId)
        }

        return memberId
    }

    public func enableAudio(_ payload: [String: Any]? = nil) async throws -> Any? {
        let captured = try await captureUserMediaTrack(kind: "audio", deviceId: payload?["deviceId"] as? String)
            ?? { throw RoomMediaTransportError("P2P transport could not create a local audio track.") }()

        let providerSessionId = try await ensureConnectedMemberId()
        rememberLocalTrack(kind: "audio", captured: captured)

        var next = payload ?? [:]
        next["trackId"] = captured.track.id
        if let deviceId = captured.track.deviceId {
            next["deviceId"] = deviceId
        }
        next["providerSessionId"] = providerSessionId
        try await room.media.audio.enable(next)
        try await syncAllPeerSenders()
        return captured.track.asAny()
    }

    public func enableVideo(_ payload: [String: Any]? = nil) async throws -> Any? {
        let captured = try await captureUserMediaTrack(kind: "video", deviceId: payload?["deviceId"] as? String)
            ?? { throw RoomMediaTransportError("P2P transport could not create a local video track.") }()

        let providerSessionId = try await ensureConnectedMemberId()
        rememberLocalTrack(kind: "video", captured: captured)

        var next = payload ?? [:]
        next["trackId"] = captured.track.id
        if let deviceId = captured.track.deviceId {
            next["deviceId"] = deviceId
        }
        next["providerSessionId"] = providerSessionId
        try await room.media.video.enable(next)
        try await syncAllPeerSenders()
        return buildView(kind: "video", track: captured.track, stream: captured.stream, isLocal: true) ?? (captured.stream.asAny() as AnyObject?)
    }

    public func startScreenShare(_ payload: [String: Any]? = nil) async throws -> Any? {
        let captured = try await resolveScreenShareCapture(payload)

        captured.track.onEnded { [weak self] in
            Task { try? await self?.stopScreenShare() }
        }

        let providerSessionId = try await ensureConnectedMemberId()
        rememberLocalTrack(kind: "screen", captured: captured)

        var next = payload ?? [:]
        next.removeValue(forKey: "source")
        next.removeValue(forKey: "videoTrack")
        next.removeValue(forKey: "track")
        next.removeValue(forKey: "stream")
        next.removeValue(forKey: "stopHandler")
        next["trackId"] = captured.track.id
        if let deviceId = captured.track.deviceId {
            next["deviceId"] = deviceId
        }
        next["providerSessionId"] = providerSessionId
        try await room.media.screen.start(next)
        try await syncAllPeerSenders()
        return buildView(kind: "screen", track: captured.track, stream: captured.stream, isLocal: true) ?? (captured.stream.asAny() as AnyObject?)
    }

    public func disableAudio() async throws {
        releaseLocalTrack(kind: "audio")
        try await syncAllPeerSenders()
        try await room.media.audio.disable()
    }

    public func disableVideo() async throws {
        releaseLocalTrack(kind: "video")
        try await syncAllPeerSenders()
        try await room.media.video.disable()
    }

    public func stopScreenShare() async throws {
        releaseLocalTrack(kind: "screen")
        try await syncAllPeerSenders()
        try await room.media.screen.stop()
    }

    public func setMuted(kind: String, muted: Bool) async throws {
        switch kind {
        case "audio":
            try await room.media.audio.setMuted(muted)
        case "video":
            try await room.media.video.setMuted(muted)
        default:
            throw RoomMediaTransportError("Unsupported mute kind: \(kind)")
        }
    }

    public func switchDevices(_ payload: [String: Any]) async throws {
        if let audioInputId = payload["audioInputId"] as? String, localTracks["audio"] != nil {
            if let captured = try await captureUserMediaTrack(kind: "audio", deviceId: audioInputId) {
                rememberLocalTrack(kind: "audio", captured: captured)
            }
        }
        if let videoInputId = payload["videoInputId"] as? String, localTracks["video"] != nil {
            if let captured = try await captureUserMediaTrack(kind: "video", deviceId: videoInputId) {
                rememberLocalTrack(kind: "video", captured: captured)
            }
        }

        try await syncAllPeerSenders()
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
        localMemberId
    }

    public func getPeerConnection() -> AnyObject? {
        peers.count == 1 ? peers.values.first?.pc.asAnyObject() : nil
    }

    public func destroy() {
        connected = false
        localMemberId = nil
        subscriptions.forEach { $0.unsubscribe() }
        subscriptions.removeAll()
        peers.values.forEach(destroyPeer)
        peers.removeAll()
        for kind in Array(localTracks.keys) {
            releaseLocalTrack(kind: kind)
        }
        remoteTrackKinds.removeAll()
        emittedRemoteTracks.removeAll()
        pendingRemoteTracks.removeAll()
        runtime?.destroy()
        runtime = nil
    }

    private func attachRoomSubscriptions() {
        guard subscriptions.isEmpty else { return }

        subscriptions.append(room.members.onJoin { [weak self] member in
            guard let self else { return }
            guard let memberId = member["memberId"] as? String, memberId != self.localMemberId else { return }
            Task { _ = try? await self.ensurePeer(memberId: memberId) }
        })
        subscriptions.append(room.members.onSync { [weak self] members in
            guard let self else { return }
            for member in members {
                guard let memberId = member["memberId"] as? String, memberId != self.localMemberId else { continue }
                Task { _ = try? await self.ensurePeer(memberId: memberId) }
            }
        })
        subscriptions.append(room.members.onLeave { [weak self] member, _ in
            guard let self, let memberId = member["memberId"] as? String else { return }
            self.remoteTrackKinds.keys.filter { $0.hasPrefix("\(memberId):") }.forEach { self.remoteTrackKinds.removeValue(forKey: $0) }
            self.emittedRemoteTracks = self.emittedRemoteTracks.filter { !$0.hasPrefix("\(memberId):") }
            self.pendingRemoteTracks.keys.filter { $0.hasPrefix("\(memberId):") }.forEach { self.pendingRemoteTracks.removeValue(forKey: $0) }
            self.closePeer(memberId: memberId)
        })
        subscriptions.append(room.signals.on(offerEvent) { [weak self] payload, meta in
            guard let self else { return }
            Task { try? await self.handleDescriptionSignal(expectedType: "offer", payload: payload, meta: meta) }
        })
        subscriptions.append(room.signals.on(answerEvent) { [weak self] payload, meta in
            guard let self else { return }
            Task { try? await self.handleDescriptionSignal(expectedType: "answer", payload: payload, meta: meta) }
        })
        subscriptions.append(room.signals.on(iceEvent) { [weak self] payload, meta in
            guard let self else { return }
            Task { try? await self.handleIceSignal(payload: payload, meta: meta) }
        })
        subscriptions.append(room.media.onTrack { [weak self] track, member in
            guard let self else { return }
            let memberId = member["memberId"] as? String
            if let memberId, memberId != self.localMemberId {
                Task { _ = try? await self.ensurePeer(memberId: memberId) }
            }
            self.rememberRemoteTrackKind(track: track, member: member)
        })
        subscriptions.append(room.media.onTrackRemoved { [weak self] track, member in
            guard let self else { return }
            guard let memberId = member["memberId"] as? String, let trackId = track["trackId"] as? String else { return }
            let key = buildTrackKey(memberId: memberId, trackId: trackId)
            self.remoteTrackKinds.removeValue(forKey: key)
            self.emittedRemoteTracks.remove(key)
            self.pendingRemoteTracks.removeValue(forKey: key)
        })
    }

    private func waitForCurrentMember() async throws -> [String: Any]? {
        let deadline = options.currentMemberTimeoutMs
        var waited: UInt64 = 0
        while waited < deadline {
            if let current = currentMember() {
                return current
            }
            try await Task.sleep(nanoseconds: 50_000_000)
            waited += 50
        }
        return currentMember()
    }

    private func currentMember() -> [String: Any]? {
        guard let userId = room.session.userId() else { return nil }
        let connectionId = room.session.connectionId()
        return room.members.list().first { member in
            let memberUserId = member["userId"] as? String
            let memberConnectionId = member["connectionId"] as? String
            return memberUserId == userId && (connectionId == nil || memberConnectionId == connectionId)
        }
    }

    private func ensurePeer(memberId: String) async throws -> RoomP2PPeerState {
        if let peer = peers[memberId] {
            try await syncPeerSenders(peer)
            return peer
        }

        let peerConnection = try await resolveRuntime().createPeerConnection(configuration: options.rtcConfiguration)
        let peer = RoomP2PPeerState(
            memberId: memberId,
            pc: peerConnection,
            polite: (localMemberId?.compare(memberId) ?? .orderedAscending) == .orderedDescending
        )

        peerConnection.setIceCandidateHandler { [weak self] candidate in
            guard let self, !candidate.candidate.isEmpty else { return }
            try? await self.room.signals.sendTo(
                memberId: memberId,
                event: self.iceEvent,
                payload: [
                    "candidate": [
                        "candidate": candidate.candidate,
                        "sdpMid": candidate.sdpMid as Any,
                        "sdpMLineIndex": Int(candidate.sdpMLineIndex),
                    ],
                ]
            )
        }

        peerConnection.setNegotiationNeededHandler { [weak self] in
            guard let self else { return }
            try? await self.negotiatePeer(peer)
        }

        peerConnection.setTrackHandler { [weak self] payload in
            guard let self else { return }
            let key = self.buildTrackKey(memberId: memberId, trackId: payload.track.id)
            let exactKind = self.remoteTrackKinds[key]
            let fallbackKind = exactKind == nil ? self.resolveFallbackRemoteTrackKind(memberId: memberId, track: payload.track) : nil
            let normalizedKind = self.normalizeTrackKind(payload.track.kind)
            let roomKind = exactKind ?? fallbackKind ?? normalizedKind
            if roomKind == nil || (exactKind == nil && fallbackKind == nil && roomKind == "video" && payload.track.kind.lowercased() == "video") {
                self.pendingRemoteTracks[key] = RoomP2PPendingRemoteTrack(memberId: memberId, track: payload.track, stream: payload.stream)
                return
            }
            self.emitRemoteTrack(memberId: memberId, track: payload.track, stream: payload.stream, kind: roomKind!)
        }

        peers[memberId] = peer
        try await syncPeerSenders(peer)
        return peer
    }

    private func negotiatePeer(_ peer: RoomP2PPeerState) async throws {
        if !connected ||
            peer.pc.connectionState == "closed" ||
            peer.makingOffer ||
            peer.isSettingRemoteAnswerPending ||
            peer.pc.signalingState != "stable" {
            return
        }

        peer.makingOffer = true
        defer { peer.makingOffer = false }

        let offer = try await peer.pc.createOffer()
        try await peer.pc.setLocalDescription(offer)
        try await room.signals.sendTo(
            memberId: peer.memberId,
            event: offerEvent,
            payload: [
                "description": [
                    "type": offer.type,
                    "sdp": offer.sdp,
                ],
            ]
        )
    }

    private func handleDescriptionSignal(expectedType: String, payload: Any?, meta: [String: Any]) async throws {
        guard let senderId = (meta["memberId"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !senderId.isEmpty, senderId != localMemberId else {
            return
        }
        guard let description = normalizeDescription(payload), description.type == expectedType else { return }

        let peer = try await ensurePeer(memberId: senderId)
        let readyForOffer = !peer.makingOffer && (peer.pc.signalingState == "stable" || peer.isSettingRemoteAnswerPending)
        let offerCollision = description.type == "offer" && !readyForOffer
        peer.ignoreOffer = !peer.polite && offerCollision
        if peer.ignoreOffer {
            return
        }

        do {
            peer.isSettingRemoteAnswerPending = description.type == "answer"
            try await peer.pc.setRemoteDescription(description)
            peer.isSettingRemoteAnswerPending = false
            try await flushPendingCandidates(peer)

            if description.type == "offer" {
                try await syncPeerSenders(peer)
                let answer = try await peer.pc.createAnswer()
                try await peer.pc.setLocalDescription(answer)
                try await room.signals.sendTo(
                    memberId: senderId,
                    event: answerEvent,
                    payload: [
                        "description": [
                            "type": answer.type,
                            "sdp": answer.sdp,
                        ],
                    ]
                )
            }
        } catch {
            peer.isSettingRemoteAnswerPending = false
            throw error
        }
    }

    private func handleIceSignal(payload: Any?, meta: [String: Any]) async throws {
        guard let senderId = (meta["memberId"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !senderId.isEmpty, senderId != localMemberId else {
            return
        }
        guard let candidate = normalizeIceCandidate(payload) else { return }

        let peer = try await ensurePeer(memberId: senderId)
        if peer.pc.remoteDescription == nil {
            peer.pendingCandidates.append(candidate)
            return
        }

        let added = try await peer.pc.addIceCandidate(candidate)
        if !added && !peer.ignoreOffer {
            peer.pendingCandidates.append(candidate)
        }
    }

    private func flushPendingCandidates(_ peer: RoomP2PPeerState) async throws {
        guard peer.pc.remoteDescription != nil, !peer.pendingCandidates.isEmpty else { return }
        let pending = peer.pendingCandidates
        peer.pendingCandidates.removeAll()
        for candidate in pending {
            let added = try await peer.pc.addIceCandidate(candidate)
            if !added && !peer.ignoreOffer {
                peer.pendingCandidates.append(candidate)
            }
        }
    }

    private func syncAllPeerSenders() async throws {
        for peer in peers.values {
            try await syncPeerSenders(peer)
        }
    }

    private func syncPeerSenders(_ peer: RoomP2PPeerState) async throws {
        var activeKinds = Set<String>()
        var changed = false

        for (kind, localTrack) in localTracks {
            activeKinds.insert(kind)
            if let sender = peer.senders[kind] {
                if sender.track?.id != localTrack.track.id {
                    try await sender.replaceTrack(localTrack.track)
                    changed = true
                }
            } else {
                peer.senders[kind] = peer.pc.addTrack(localTrack.track, stream: localTrack.stream)
                changed = true
            }
        }

        for (kind, sender) in peer.senders {
            guard !activeKinds.contains(kind) else { continue }
            _ = peer.pc.removeTrack(sender)
            peer.senders.removeValue(forKey: kind)
            changed = true
        }

        if changed {
            try await negotiatePeer(peer)
        }
    }

    private func hydrateRemoteTrackKinds() {
        remoteTrackKinds.removeAll()
        emittedRemoteTracks.removeAll()
        pendingRemoteTracks.removeAll()

        for mediaMember in room.media.list() {
            let member = mediaMember["member"] as? [String: Any] ?? [:]
            let tracks = mediaMember["tracks"] as? [[String: Any]] ?? []
            for track in tracks {
                rememberRemoteTrackKind(track: track, member: member)
            }
        }
    }

    private func rememberRemoteTrackKind(track: [String: Any], member: [String: Any]) {
        guard let trackId = track["trackId"] as? String,
              let memberId = member["memberId"] as? String,
              let kind = track["kind"] as? String,
              memberId != localMemberId else {
            return
        }

        let key = buildTrackKey(memberId: memberId, trackId: trackId)
        remoteTrackKinds[key] = kind
        if let pending = pendingRemoteTracks.removeValue(forKey: key) {
            emitRemoteTrack(memberId: memberId, track: pending.track, stream: pending.stream, kind: kind)
            return
        }
        flushPendingRemoteTracks(memberId: memberId, roomKind: kind)
    }

    private func emitRemoteTrack(memberId: String, track: RoomP2PMediaTrackAdapter, stream: RoomP2PMediaStreamAdapter, kind: String) {
        let key = buildTrackKey(memberId: memberId, trackId: track.id)
        guard emittedRemoteTracks.insert(key).inserted else { return }

        let participant = room.members.list().first { ($0["memberId"] as? String) == memberId } ?? ["memberId": memberId]
        let event = RoomMediaRemoteTrackEvent(
            kind: kind,
            track: track.asAny(),
            view: buildView(kind: kind, track: track, stream: stream, isLocal: false) ?? (stream.asAny() as AnyObject?),
            trackName: track.id,
            providerSessionId: memberId,
            participantId: memberId,
            customParticipantId: participant["customParticipantId"] as? String,
            userId: participant["userId"] as? String,
            participant: participant
        )

        for handler in remoteTrackHandlers.values {
            handler(event)
        }
    }

    private func resolveFallbackRemoteTrackKind(memberId: String, track: RoomP2PMediaTrackAdapter) -> String? {
        guard let normalizedKind = normalizeTrackKind(track.kind) else { return nil }
        if normalizedKind == "audio" { return normalizedKind }
        let videoLikeKinds = getPublishedVideoLikeKinds(memberId: memberId)
        guard videoLikeKinds.count == 1 else { return nil }
        return videoLikeKinds.first
    }

    private func flushPendingRemoteTracks(memberId: String, roomKind: String) {
        let expectedTrackKind = roomKind == "audio" ? "audio" : "video"
        if (roomKind == "video" || roomKind == "screen") && getPublishedVideoLikeKinds(memberId: memberId).count != 1 {
            return
        }

        if let (key, pending) = pendingRemoteTracks.first(where: { entry in
            entry.value.memberId == memberId && entry.value.track.kind.lowercased() == expectedTrackKind
        }) {
            pendingRemoteTracks.removeValue(forKey: key)
            emitRemoteTrack(memberId: memberId, track: pending.track, stream: pending.stream, kind: roomKind)
        }
    }

    private func getPublishedVideoLikeKinds(memberId: String) -> [String] {
        guard let mediaMember = room.media.list().first(where: {
            (($0["member"] as? [String: Any])?["memberId"] as? String) == memberId
        }) else {
            return []
        }
        var kinds = OrderedSet<String>()
        let tracks = mediaMember["tracks"] as? [[String: Any]] ?? []
        for track in tracks {
            if let kind = track["kind"] as? String, (kind == "video" || kind == "screen"), track["trackId"] != nil {
                kinds.append(kind)
            }
        }
        return kinds.values
    }

    private func rememberLocalTrack(kind: String, captured: RoomP2PCapturedTrack) {
        releaseLocalTrack(kind: kind)
        localTracks[kind] = RoomP2PLocalTrackState(
            kind: kind,
            track: captured.track,
            stream: captured.stream,
            deviceId: captured.track.deviceId,
            stopOnCleanup: captured.stopOnCleanup
        )
    }

    private func releaseLocalTrack(kind: String) {
        guard let localTrack = localTracks.removeValue(forKey: kind) else { return }
        localTrack.track.onEnded(nil)
        if localTrack.stopOnCleanup {
            localTrack.track.stop()
        }
        localTrack.stream.release()
        localTrack.track.dispose()
    }

    private func captureUserMediaTrack(kind: String, deviceId: String?) async throws -> RoomP2PCapturedTrack? {
        try await resolveRuntime().captureUserMedia(kind: kind, deviceId: deviceId)
    }

    private func resolveScreenShareCapture(_ payload: [String: Any]?) async throws -> RoomP2PCapturedTrack {
        if let source = payload?["source"] as? RoomP2PScreenShareSource {
            return buildInjectedScreenCapture(
                track: source.track,
                stream: source.stream,
                deviceId: source.deviceId,
                stopHandler: source.stopHandler
            )
        }

        let injectedTrack = (payload?["videoTrack"] as? RTKRTCVideoTrack)
            ?? (payload?["track"] as? RTKRTCVideoTrack)
        if let injectedTrack {
            return buildInjectedScreenCapture(
                track: injectedTrack,
                stream: payload?["stream"] as? RTKRTCMediaStream,
                deviceId: payload?["deviceId"] as? String,
                stopHandler: payload?["stopHandler"] as? (() -> Void)
            )
        }

        if let captured = try await resolveRuntime().captureDisplayMedia() {
            return captured
        }

        throw RoomMediaTransportError(
            "P2P screen sharing on iOS requires an app-provided RTKRTCVideoTrack " +
            "(payload['source'], payload['videoTrack'], or payload['track']). See \(roomMediaDocsURL)"
        )
    }

    private func buildInjectedScreenCapture(
        track: RTKRTCVideoTrack,
        stream: RTKRTCMediaStream?,
        deviceId: String?,
        stopHandler: (() -> Void)?
    ) -> RoomP2PCapturedTrack {
        let resolvedStream: RTKRTCMediaStream
        if let stream {
            resolvedStream = stream
        } else {
            let streamFactory = RTKRTCPeerConnectionFactory()
            let generated = streamFactory.mediaStream(withStreamId: "screen-\(track.trackId)")
            generated.addVideoTrack(track)
            resolvedStream = generated
        }

        return RoomP2PCapturedTrack(
            kind: "screen",
            track: NativeRoomP2PMediaTrack(
                track: track,
                deviceId: deviceId,
                stopHandler: stopHandler
            ),
            stream: NativeRoomP2PMediaStream(stream: resolvedStream),
            stopOnCleanup: stopHandler != nil
        )
    }

    private func ensureConnectedMemberId() async throws -> String {
        if let localMemberId { return localMemberId }
        return try await connect()
    }

    private func closePeer(memberId: String) {
        if let peer = peers.removeValue(forKey: memberId) {
            destroyPeer(peer)
        }
    }

    private func destroyPeer(_ peer: RoomP2PPeerState) {
        peer.pc.setIceCandidateHandler(nil)
        peer.pc.setNegotiationNeededHandler(nil)
        peer.pc.setTrackHandler(nil)
        peer.pc.close()
    }

    private func resolveRuntime() throws -> RoomP2PMediaRuntimeAdapter {
        if let runtime { return runtime }
        let factory = roomP2PMediaRuntimeFactoryOverride ?? defaultP2PMediaRuntimeFactory()
        guard let factory else {
            throw RoomMediaTransportError("P2P room media transport is not yet available in EdgeBase Swift. See \(roomMediaDocsURL)")
        }
        let runtime = factory()
        self.runtime = runtime
        return runtime
    }

    private func normalizeDescription(_ payload: Any?) -> RoomP2PSessionDescription? {
        guard let map = payload as? [String: Any],
              let description = map["description"] as? [String: Any],
              let type = (description["type"] as? String)?.lowercased(),
              let sdp = description["sdp"] as? String,
              ["offer", "answer", "pranswer", "rollback"].contains(type) else {
            return nil
        }
        return RoomP2PSessionDescription(type: type, sdp: sdp)
    }

    private func normalizeIceCandidate(_ payload: Any?) -> RoomP2PIceCandidate? {
        guard let map = payload as? [String: Any],
              let candidate = map["candidate"] as? [String: Any],
              let sdp = candidate["candidate"] as? String else {
            return nil
        }
        return RoomP2PIceCandidate(
            candidate: sdp,
            sdpMid: candidate["sdpMid"] as? String,
            sdpMLineIndex: Int32(candidate["sdpMLineIndex"] as? Int ?? 0)
        )
    }

    private func normalizeTrackKind(_ kind: String) -> String? {
        switch kind.lowercased() {
        case "audio": return "audio"
        case "video": return "video"
        default: return nil
        }
    }

    private func buildTrackKey(memberId: String, trackId: String) -> String {
        "\(memberId):\(trackId)"
    }

    private func buildView(kind: String, track: RoomP2PMediaTrackAdapter, stream: RoomP2PMediaStreamAdapter, isLocal: Bool) -> AnyObject? {
        let createView = {
            () -> AnyObject? in
        guard kind == "video" || kind == "screen",
              let videoTrack = track.asAny() as? RTKRTCVideoTrack else {
            return stream.asAny() as AnyObject?
        }
        let view = RTKRTCMTLVideoView(frame: .zero)
        videoTrack.add(view)
        return view
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
}

private struct OrderedSet<Element: Hashable> {
    private var seen = Set<Element>()
    private(set) var values: [Element] = []

    mutating func append(_ value: Element) {
        if seen.insert(value).inserted {
            values.append(value)
        }
    }
}

private func defaultP2PMediaRuntimeFactory() -> RoomP2PMediaRuntimeFactory? {
    return {
        NativeRoomP2PMediaRuntime()
    }
}

private final class NativeRoomP2PMediaRuntime: RoomP2PMediaRuntimeAdapter {
    private let factory = RTKRTCPeerConnectionFactory()

    func createPeerConnection(configuration: RoomP2PRtcConfigurationOptions) async throws -> RoomP2PPeerConnectionAdapter {
        let rtcConfiguration = RTKRTCConfiguration()
        rtcConfiguration.iceServers = configuration.iceServers.map { iceServer in
            RTKRTCIceServer(urlStrings: iceServer.urls, username: iceServer.username, credential: iceServer.credential)
        }
        let constraints = RTKRTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        guard let peerConnection = factory.peerConnection(with: rtcConfiguration, constraints: constraints, delegate: nil) else {
            throw RoomMediaTransportError("Failed to create an iOS RTCPeerConnection.")
        }
        let adapter = NativeRoomP2PPeerConnectionAdapter(factory: factory, peerConnection: peerConnection)
        peerConnection.delegate = adapter
        return adapter
    }

    func captureUserMedia(kind: String, deviceId: String?) async throws -> RoomP2PCapturedTrack? {
        switch kind {
        case "audio":
            let trackId = UUID().uuidString
            let stream = factory.mediaStream(withStreamId: "stream-\(trackId)")
            let track = factory.audioTrack(withTrackId: trackId)
            stream.addAudioTrack(track)
            return RoomP2PCapturedTrack(
                kind: kind,
                track: NativeRoomP2PMediaTrack(track: track, deviceId: deviceId),
                stream: NativeRoomP2PMediaStream(stream: stream),
                stopOnCleanup: true
            )
        case "video":
            let trackId = UUID().uuidString
            let stream = factory.mediaStream(withStreamId: "stream-\(trackId)")
            let source = factory.videoSource()
            let capturer = RTKRTCCameraVideoCapturer(delegate: source)
            let device = try resolveCaptureDevice(deviceId: deviceId)
            let format = resolveCaptureFormat(device: device)
            let fps = resolveCaptureFps(format: format)
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                capturer.startCapture(with: device, format: format, fps: fps) { error in
                    if let error {
                        continuation.resume(throwing: error)
                    } else {
                        continuation.resume(returning: ())
                    }
                }
            }
            let track = factory.videoTrack(with: source, trackId: trackId)
            stream.addVideoTrack(track)
            return RoomP2PCapturedTrack(
                kind: kind,
                track: NativeRoomP2PMediaTrack(track: track, deviceId: device.uniqueID, capturer: capturer),
                stream: NativeRoomP2PMediaStream(stream: stream),
                stopOnCleanup: true
            )
        default:
            return nil
        }
    }

    func captureDisplayMedia() async throws -> RoomP2PCapturedTrack? {
        nil
    }

    func destroy() {}

    private func resolveCaptureDevice(deviceId: String?) throws -> AVCaptureDevice {
        let devices = RTKRTCCameraVideoCapturer.captureDevices()
        if let deviceId, let device = devices.first(where: { $0.uniqueID == deviceId }) {
            return device
        }
        if let front = devices.first(where: { $0.position == .front }) {
            return front
        }
        if let first = devices.first {
            return first
        }
        throw RoomMediaTransportError("No camera capture devices are available.")
    }

    private func resolveCaptureFormat(device: AVCaptureDevice) -> AVCaptureDevice.Format {
        let formats = RTKRTCCameraVideoCapturer.supportedFormats(for: device)
        return formats.max { lhs, rhs in
            let left = CMVideoFormatDescriptionGetDimensions(lhs.formatDescription)
            let right = CMVideoFormatDescriptionGetDimensions(rhs.formatDescription)
            return left.width * left.height < right.width * right.height
        } ?? device.formats.first!
    }

    private func resolveCaptureFps(format: AVCaptureDevice.Format) -> Int {
        Int(format.videoSupportedFrameRateRanges.map(\.maxFrameRate).max() ?? 30.0)
    }
}

private final class NativeRoomP2PPeerConnectionAdapter: NSObject, RoomP2PPeerConnectionAdapter, RTKRTCPeerConnectionDelegate {
    private let factory: RTKRTCPeerConnectionFactory
    private let peerConnection: RTKRTCPeerConnection
    private var iceCandidateHandler: (@Sendable (RoomP2PIceCandidate) async -> Void)?
    private var negotiationNeededHandler: (@Sendable () async -> Void)?
    private var trackHandler: (@Sendable (RoomP2PRemoteTrackPayload) async -> Void)?

    init(factory: RTKRTCPeerConnectionFactory, peerConnection: RTKRTCPeerConnection) {
        self.factory = factory
        self.peerConnection = peerConnection
        super.init()
    }

    var connectionState: String {
        switch peerConnection.connectionState {
        case .new: return "new"
        case .connecting: return "connecting"
        case .connected: return "connected"
        case .disconnected: return "disconnected"
        case .failed: return "failed"
        case .closed: return "closed"
        @unknown default: return "new"
        }
    }

    var signalingState: String {
        switch peerConnection.signalingState {
        case .stable: return "stable"
        case .haveLocalOffer: return "have_local_offer"
        case .haveLocalPrAnswer: return "have_local_pranswer"
        case .haveRemoteOffer: return "have_remote_offer"
        case .haveRemotePrAnswer: return "have_remote_pranswer"
        case .closed: return "closed"
        @unknown default: return "stable"
        }
    }

    var localDescription: RoomP2PSessionDescription? {
        peerConnection.localDescription.map {
            RoomP2PSessionDescription(
                type: RTKRTCSessionDescription.string(for: $0.type).lowercased(),
                sdp: $0.sdp
            )
        }
    }

    var remoteDescription: RoomP2PSessionDescription? {
        peerConnection.remoteDescription.map {
            RoomP2PSessionDescription(
                type: RTKRTCSessionDescription.string(for: $0.type).lowercased(),
                sdp: $0.sdp
            )
        }
    }

    func setIceCandidateHandler(_ handler: (@Sendable (RoomP2PIceCandidate) async -> Void)?) {
        iceCandidateHandler = handler
    }

    func setNegotiationNeededHandler(_ handler: (@Sendable () async -> Void)?) {
        negotiationNeededHandler = handler
    }

    func setTrackHandler(_ handler: (@Sendable (RoomP2PRemoteTrackPayload) async -> Void)?) {
        trackHandler = handler
    }

    func createOffer() async throws -> RoomP2PSessionDescription {
        let constraints = RTKRTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        let offer = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<RTKRTCSessionDescription, Error>) in
            peerConnection.offer(for: constraints) { description, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let description {
                    continuation.resume(returning: description)
                } else {
                    continuation.resume(throwing: RoomMediaTransportError("RTCPeerConnection offer returned no description."))
                }
            }
        }
        return RoomP2PSessionDescription(type: RTKRTCSessionDescription.string(for: offer.type).lowercased(), sdp: offer.sdp)
    }

    func createAnswer() async throws -> RoomP2PSessionDescription {
        let constraints = RTKRTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        let answer = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<RTKRTCSessionDescription, Error>) in
            peerConnection.answer(for: constraints) { description, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let description {
                    continuation.resume(returning: description)
                } else {
                    continuation.resume(throwing: RoomMediaTransportError("RTCPeerConnection answer returned no description."))
                }
            }
        }
        return RoomP2PSessionDescription(type: RTKRTCSessionDescription.string(for: answer.type).lowercased(), sdp: answer.sdp)
    }

    func setLocalDescription(_ description: RoomP2PSessionDescription) async throws {
        let rtcDescription = RTKRTCSessionDescription(type: rtcSdpType(description.type), sdp: description.sdp)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            peerConnection.setLocalDescription(rtcDescription) { error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: ())
                }
            }
        }
    }

    func setRemoteDescription(_ description: RoomP2PSessionDescription) async throws {
        let rtcDescription = RTKRTCSessionDescription(type: rtcSdpType(description.type), sdp: description.sdp)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            peerConnection.setRemoteDescription(rtcDescription) { error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: ())
                }
            }
        }
    }

    func addIceCandidate(_ candidate: RoomP2PIceCandidate) async throws -> Bool {
        let rtcCandidate = RTKRTCIceCandidate(
            sdp: candidate.candidate,
            sdpMLineIndex: Int32(candidate.sdpMLineIndex),
            sdpMid: candidate.sdpMid
        )
        return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Bool, Error>) in
            peerConnection.add(rtcCandidate) { error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: true)
                }
            }
        }
    }

    func addTrack(_ track: RoomP2PMediaTrackAdapter, stream: RoomP2PMediaStreamAdapter) -> RoomP2PRtpSenderAdapter {
        let nativeTrack = track.asAny() as! RTKRTCMediaStreamTrack
        let nativeStream = stream.asAny() as! RTKRTCMediaStream
        let sender = peerConnection.add(nativeTrack, streamIds: [nativeStream.streamId])
        return NativeRoomP2PRtpSenderAdapter(sender: sender)
    }

    func removeTrack(_ sender: RoomP2PRtpSenderAdapter) -> Bool {
        guard let nativeSender = sender as? NativeRoomP2PRtpSenderAdapter,
              let sender = nativeSender.sender else { return false }
        return peerConnection.removeTrack(sender)
    }

    func close() {
        peerConnection.close()
    }

    func asAnyObject() -> AnyObject? {
        peerConnection
    }

    func peerConnectionShouldNegotiate(_ peerConnection: RTKRTCPeerConnection) {
        Task { await negotiationNeededHandler?() }
    }

    func peerConnection(_ peerConnection: RTKRTCPeerConnection, didChange stateChanged: RTKRTCSignalingState) {}

    func peerConnection(_ peerConnection: RTKRTCPeerConnection, didChange newState: RTKRTCIceConnectionState) {}

    func peerConnection(_ peerConnection: RTKRTCPeerConnection, didChange newState: RTKRTCIceGatheringState) {}

    func peerConnection(_ peerConnection: RTKRTCPeerConnection, didGenerate candidate: RTKRTCIceCandidate) {
        Task {
            await iceCandidateHandler?(
                RoomP2PIceCandidate(
                    candidate: candidate.sdp,
                    sdpMid: candidate.sdpMid,
                    sdpMLineIndex: Int32(candidate.sdpMLineIndex)
                )
            )
        }
    }

    func peerConnection(_ peerConnection: RTKRTCPeerConnection, didRemove candidates: [RTKRTCIceCandidate]) {}

    func peerConnection(_ peerConnection: RTKRTCPeerConnection, didAdd stream: RTKRTCMediaStream) {
        if let audioTrack = stream.audioTracks.first {
            Task {
                await trackHandler?(
                    RoomP2PRemoteTrackPayload(
                        track: NativeRoomP2PMediaTrack(track: audioTrack, deviceId: nil),
                        stream: NativeRoomP2PMediaStream(stream: stream)
                    )
                )
            }
        }
        if let videoTrack = stream.videoTracks.first {
            Task {
                await trackHandler?(
                    RoomP2PRemoteTrackPayload(
                        track: NativeRoomP2PMediaTrack(track: videoTrack, deviceId: nil),
                        stream: NativeRoomP2PMediaStream(stream: stream)
                    )
                )
            }
        }
    }

    func peerConnection(_ peerConnection: RTKRTCPeerConnection, didRemove stream: RTKRTCMediaStream) {}

    func peerConnection(_ peerConnection: RTKRTCPeerConnection, didAdd rtpReceiver: RTKRTCRtpReceiver, streams mediaStreams: [RTKRTCMediaStream]) {
        guard let track = rtpReceiver.track else { return }
        let stream = mediaStreams.first ?? {
            let stream = factory.mediaStream(withStreamId: "remote-\(UUID().uuidString)")
            if let audioTrack = track as? RTKRTCAudioTrack {
                stream.addAudioTrack(audioTrack)
            } else if let videoTrack = track as? RTKRTCVideoTrack {
                stream.addVideoTrack(videoTrack)
            }
            return stream
        }()

        Task {
            await trackHandler?(
                RoomP2PRemoteTrackPayload(
                    track: NativeRoomP2PMediaTrack(track: track, deviceId: nil),
                    stream: NativeRoomP2PMediaStream(stream: stream)
                )
            )
        }
    }

    func peerConnection(_ peerConnection: RTKRTCPeerConnection, didOpen dataChannel: RTKRTCDataChannel) {}

    private func rtcSdpType(_ type: String) -> RTKRTCSdpType {
        switch type {
        case "offer": return .offer
        case "answer": return .answer
        case "pranswer": return .prAnswer
        case "rollback": return .rollback
        default: return .offer
        }
    }
}

private final class NativeRoomP2PRtpSenderAdapter: RoomP2PRtpSenderAdapter {
    let sender: RTKRTCRtpSender?

    init(sender: RTKRTCRtpSender?) {
        self.sender = sender
    }

    var track: RoomP2PMediaTrackAdapter? {
        sender?.track.map { NativeRoomP2PMediaTrack(track: $0, deviceId: nil) }
    }

    func replaceTrack(_ track: RoomP2PMediaTrackAdapter) async throws {
        guard let sender else {
            throw RoomMediaTransportError("P2P sender is unavailable for track replacement.")
        }
        sender.track = track.asAny() as? RTKRTCMediaStreamTrack
    }
}

private final class NativeRoomP2PMediaTrack: RoomP2PMediaTrackAdapter {
    private let track: RTKRTCMediaStreamTrack
    private let capturer: RTKRTCCameraVideoCapturer?
    private let stopHandler: (() -> Void)?
    private var endedHandler: (() -> Void)?
    let deviceId: String?

    init(
        track: RTKRTCMediaStreamTrack,
        deviceId: String?,
        capturer: RTKRTCCameraVideoCapturer? = nil,
        stopHandler: (() -> Void)? = nil
    ) {
        self.track = track
        self.deviceId = deviceId
        self.capturer = capturer
        self.stopHandler = stopHandler
    }

    var id: String { track.trackId }
    var kind: String { track.kind.lowercased() }
    var enabled: Bool {
        get { track.isEnabled }
        set { track.isEnabled = newValue }
    }

    func stop() {
        if let capturer {
            capturer.stopCapture {
                self.endedHandler?()
            }
        } else {
            stopHandler?()
            endedHandler?()
        }
    }

    func onEnded(_ handler: (() -> Void)?) {
        endedHandler = handler
    }

    func dispose() {}

    func asAny() -> Any? {
        track
    }
}

private final class NativeRoomP2PMediaStream: RoomP2PMediaStreamAdapter {
    private let stream: RTKRTCMediaStream

    init(stream: RTKRTCMediaStream) {
        self.stream = stream
    }

    func release() {}

    func asAny() -> Any? {
        stream
    }
}
