<?php

declare(strict_types=1);

namespace EdgeBase\Core\Tests;

use EdgeBase\RoomClient;
use PHPUnit\Framework\TestCase;

final class RoomClientTest extends TestCase
{
    private function createFakeSocket(): object
    {
        return new class {
            /** @var list<string> */
            public array $events = [];
            /** @var list<array<string, mixed>> */
            public array $messages = [];
            /** @var list<string> */
            public array $queuedResponses = [];

            public function send(string $payload): void
            {
                /** @var array<string, mixed> $decoded */
                $decoded = json_decode($payload, true, flags: JSON_THROW_ON_ERROR);
                $this->messages[] = $decoded;
                $this->events[] = 'send:' . $decoded['type'];

                $requestId = $decoded['requestId'] ?? null;
                if (!is_string($requestId)) {
                    return;
                }

                switch ($decoded['type']) {
                    case 'signal':
                        $this->queuedResponses[] = json_encode([
                            'type' => 'signal_sent',
                            'requestId' => $requestId,
                            'event' => $decoded['event'] ?? '',
                        ], JSON_THROW_ON_ERROR);
                        break;
                    case 'member_state':
                        $this->queuedResponses[] = json_encode([
                            'type' => 'member_state',
                            'requestId' => $requestId,
                            'member' => [
                                'memberId' => 'user-1',
                                'userId' => 'user-1',
                                'state' => $decoded['state'] ?? [],
                            ],
                            'state' => $decoded['state'] ?? [],
                        ], JSON_THROW_ON_ERROR);
                        break;
                    case 'admin':
                        $this->queuedResponses[] = json_encode([
                            'type' => 'admin_result',
                            'requestId' => $requestId,
                            'operation' => $decoded['operation'] ?? '',
                            'memberId' => $decoded['memberId'] ?? '',
                        ], JSON_THROW_ON_ERROR);
                        break;
                    case 'media':
                        $this->queuedResponses[] = json_encode([
                            'type' => 'media_result',
                            'requestId' => $requestId,
                            'operation' => $decoded['operation'] ?? '',
                            'kind' => $decoded['kind'] ?? '',
                        ], JSON_THROW_ON_ERROR);
                        break;
                }
            }

            public function receive(): ?string
            {
                if ($this->queuedResponses === []) {
                    throw new class('timed out') extends \RuntimeException {};
                }

                return array_shift($this->queuedResponses);
            }

            public function close(): void
            {
                $this->events[] = 'close';
            }

            public function setTimeout(int $seconds): void
            {
            }
        };
    }

    public function test_leave_sends_explicit_leave_before_close(): void
    {
        $room = new RoomClient('http://localhost:8688', 'game', 'room-1', fn (): string => 'token');
        $fakeSocket = $this->createFakeSocket();
        $room->attachSocketForTesting($fakeSocket);

        $room->leave();

        $this->assertSame(['send:leave', 'close'], $fakeSocket->events);
    }

    public function test_unified_surface_parses_members_signals_media_and_session_frames(): void
    {
        $room = new RoomClient('http://localhost:8688', 'game', 'room-1', fn (): string => 'token');
        $memberSyncSnapshots = [];
        $memberLeaves = [];
        $signalEvents = [];
        $mediaTracks = [];
        $mediaDevices = [];
        $connectionStates = [];

        $room->members->onSync(function (array $members) use (&$memberSyncSnapshots): void {
            $memberSyncSnapshots[] = $members;
        });
        $room->members->onLeave(function (array $member, string $reason) use (&$memberLeaves): void {
            $memberLeaves[] = ($member['memberId'] ?? '') . ':' . $reason;
        });
        $room->signals->onAny(function (string $event, mixed $payload, array $meta) use (&$signalEvents): void {
            $signalEvents[] = $event . ':' . ($meta['userId'] ?? '');
        });
        $room->media->onTrack(function (array $track, array $member) use (&$mediaTracks): void {
            $mediaTracks[] = ($track['kind'] ?? '') . ':' . ($member['memberId'] ?? '');
        });
        $room->media->onDeviceChange(function (array $member, array $change) use (&$mediaDevices): void {
            $mediaDevices[] = ($change['kind'] ?? '') . ':' . ($change['deviceId'] ?? '');
        });
        $room->session->onConnectionStateChange(function (string $state) use (&$connectionStates): void {
            $connectionStates[] = $state;
        });

        $room->handleMessageForTesting('{"type":"auth_success","userId":"user-1","connectionId":"conn-1"}');
        $room->handleMessageForTesting('{"type":"sync","sharedState":{"topic":"focus"},"sharedVersion":1,"playerState":{"ready":true},"playerVersion":2}');
        $room->handleMessageForTesting('{"type":"members_sync","members":[{"memberId":"user-1","userId":"user-1","connectionId":"conn-1","connectionCount":1,"state":{"typing":false}}]}');
        $room->handleMessageForTesting('{"type":"member_join","member":{"memberId":"user-2","userId":"user-2","connectionCount":1,"state":{}}}');
        $room->handleMessageForTesting('{"type":"signal","event":"cursor.move","payload":{"x":10,"y":20},"meta":{"memberId":"user-2","userId":"user-2","connectionId":"conn-2","sentAt":123}}');
        $room->handleMessageForTesting('{"type":"media_track","member":{"memberId":"user-2","userId":"user-2","state":{}},"track":{"kind":"video","trackId":"video-1","deviceId":"cam-1","muted":false}}');
        $room->handleMessageForTesting('{"type":"media_device","member":{"memberId":"user-2","userId":"user-2","state":{}},"kind":"video","deviceId":"cam-2"}');
        $room->handleMessageForTesting('{"type":"member_leave","member":{"memberId":"user-2","userId":"user-2","state":{}},"reason":"timeout"}');

        $this->assertSame(['topic' => 'focus'], $room->state->getShared());
        $this->assertSame(['ready' => true], $room->state->getMine());
        $this->assertSame('user-1', $room->session->getUserId());
        $this->assertSame('conn-1', $room->session->getConnectionId());
        $this->assertSame('connected', $room->session->getConnectionState());
        $this->assertSame(['connected'], $connectionStates);
        $this->assertCount(1, $memberSyncSnapshots);
        $this->assertSame('user-1', $memberSyncSnapshots[0][0]['memberId']);
        $this->assertSame(['cursor.move:user-2'], $signalEvents);
        $this->assertSame(['video:user-2'], $mediaTracks);
        $this->assertSame(['video:cam-2'], $mediaDevices);
        $this->assertSame(['user-2:timeout'], $memberLeaves);
        $this->assertCount(1, $room->members->list());
        $this->assertSame('user-1', $room->members->list()[0]['memberId']);
        $this->assertCount(0, $room->media->list());
    }

    public function test_unified_surface_sends_signal_member_admin_and_media_frames(): void
    {
        $room = new RoomClient('http://localhost:8688', 'game', 'room-1', fn (): string => 'token');
        $fakeSocket = $this->createFakeSocket();
        $room->attachSocketForTesting($fakeSocket);
        $room->handleMessageForTesting('{"type":"auth_success","userId":"user-1","connectionId":"conn-1"}');

        $room->signals->send('cursor.move', ['x' => 10], ['includeSelf' => true]);
        $this->assertSame('signal', $fakeSocket->messages[0]['type']);
        $this->assertSame('cursor.move', $fakeSocket->messages[0]['event']);
        $this->assertTrue($fakeSocket->messages[0]['includeSelf']);

        $room->members->setState(['typing' => true]);
        $this->assertSame('member_state', $fakeSocket->messages[1]['type']);
        $this->assertTrue($fakeSocket->messages[1]['state']['typing']);

        $room->admin->disableVideo('user-2');
        $this->assertSame('admin', $fakeSocket->messages[2]['type']);
        $this->assertSame('disableVideo', $fakeSocket->messages[2]['operation']);
        $this->assertSame('user-2', $fakeSocket->messages[2]['memberId']);

        $room->media->audio->setMuted(true);
        $this->assertSame('media', $fakeSocket->messages[3]['type']);
        $this->assertSame('mute', $fakeSocket->messages[3]['operation']);
        $this->assertSame('audio', $fakeSocket->messages[3]['kind']);
        $this->assertTrue($fakeSocket->messages[3]['payload']['muted']);

        $this->assertSame(['send:signal', 'send:member_state', 'send:admin', 'send:media'], $fakeSocket->events);
    }
}
