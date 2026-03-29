---
sidebar_position: 16
title: "Media Setup (Cloudflare RealtimeKit Provider)"
description: Room Media의 cloudflare_realtimekit provider를 사용하기 위한 Cloudflare RealtimeKit 설정 가이드
sidebar_label: "Media Setup"
---

# Media Setup (Cloudflare RealtimeKit Provider)

:::info Beta
Room Media는 현재 **beta** 단계입니다. 기본 `cloudflare_realtimekit`
provider를 중심으로 지원 매트릭스를 정리하고 있습니다.
:::

이 문서는 `room.media.transport()`의 기본값인 `cloudflare_realtimekit` provider를 설정하는 방법을 설명합니다.

현재 EdgeBase Room Media의 `cloudflare_realtimekit` provider는 **RealtimeKit participant token** 기반 연결 경로를 사용합니다. 그래서 프로젝트 설정도 `App Secret + TURN Key` 조합이 아니라 **Cloudflare API Token + RealtimeKit App ID** 기준으로 맞추면 됩니다.

:::info `p2p` provider는 별도 설정이 필요 없습니다
`room.media.transport({ provider: 'p2p' })`는 Cloudflare control-plane 설정 없이 바로 사용할 수 있습니다. 다만 STUN-only best-effort mesh라서 네트워크 환경에 따라 연결이 실패할 수 있습니다.
:::

Web SDK의 `p2p` transport는 연결 시점에 `room.media.realtime.iceServers()`를 먼저 시도하고, 사용 가능한 ICE / relay 자격 증명이 없을 때만 기본 STUN 설정으로 fallback합니다.

---

## 1. Cloudflare Realtime 활성화

Cloudflare Dashboard에서 Realtime 제품을 먼저 활성화합니다.

1. [Cloudflare Dashboard](https://dash.cloudflare.com) 로그인
2. 왼쪽 메뉴에서 **Realtime** 열기
3. **RealtimeKit** 또는 **Serverless SFU** 화면이 보이도록 활성화
4. 제품이 처음이라면 안내에 따라 Realtime 사용을 시작

:::info 참고
Cloudflare UI에서는 `RealtimeKit`, `TURN Server`, `Serverless SFU`가 별도 화면으로 보일 수 있습니다. EdgeBase Room Media의 기본 경로는 이 중 **RealtimeKit** 입니다.
:::

---

## 2. RealtimeKit App 생성

EdgeBase가 참가자 토큰을 발급하려면 Cloudflare RealtimeKit app이 필요합니다.

1. Dashboard에서 **RealtimeKit**
2. **Create**
3. App 이름 입력
4. 생성 후 **App ID** 복사

필요하면 preset도 하나 준비하세요. EdgeBase는 다음 순서로 preset을 선택합니다.

1. `CF_REALTIME_PRESET_NAME` 환경변수
2. Cloudflare 기본 preset 이름인 `group_call_participant`
3. 계정에 존재하는 첫 preset

즉, 특별한 preset 이름을 고정하고 싶지 않다면 기본 preset만 있어도 시작할 수 있습니다.

---

## 3. User API Token 생성

Room Media control plane은 `wrangler login` OAuth가 아니라 **Cloudflare API Token**을 사용합니다.

권장 경로는 **User API Token** 입니다.

1. Dashboard 오른쪽 위 프로필 메뉴
2. **My Profile**
3. **API Tokens**
4. **Create Token**
5. **Custom token**

아래처럼 설정합니다.

- Token name: `EdgeBase Realtime Token`
- Permissions: `Account -> Realtime -> Admin`
- Account Resources: 대상 account 포함
- Client IP filtering: 비움
- TTL: 비움

:::warning 토큰은 한 번만 표시됩니다
Cloudflare는 생성 직후에만 토큰 값을 보여줍니다. 생성 직후 복사해 두세요.
:::

:::info 왜 Realtime 권한인가요?
Room Media의 현재 경로는 Cloudflare RealtimeKit participant token 발급 API를 사용합니다. `wrangler` OAuth만으로는 이 경로를 신뢰성 있게 자동화할 수 없어서, `Account -> Realtime -> Admin` user token을 기준으로 안내합니다.
:::

---

## 4. Account ID 확인

보통 가장 쉬운 방법은 이미 로그인된 Wrangler에서 account id를 읽는 것입니다.

```bash
npx wrangler whoami
```

환경에 따라 여러 account가 보일 수 있으니, Room Media를 붙일 대상 account id를 확인해 주세요.

---

## 5. edgebase 프로젝트에 연결

이제 아래 환경변수를 프로젝트에 설정합니다.

```bash
# .env.development 또는 .dev.vars
CF_ACCOUNT_ID=your-account-id
CF_API_TOKEN=your-cloudflare-api-token
CF_REALTIME_APP_ID=your-realtimekit-app-id

# 선택: 특정 preset 이름을 고정하고 싶을 때
CF_REALTIME_PRESET_NAME=group_call_participant
```

| 환경변수 | 필수 | 설명 |
|----------|------|------|
| `CF_ACCOUNT_ID` | **필수** | Cloudflare account id |
| `CF_API_TOKEN` | **필수** | `Account -> Realtime -> Admin` 권한이 있는 Cloudflare API token |
| `CF_REALTIME_APP_ID` | **필수** | Cloudflare RealtimeKit app id |
| `CF_REALTIME_PRESET_NAME` | 선택 | 참가자 생성 시 사용할 preset 이름 |

:::tip 로컬 개발
로컬 개발에서는 `.env.development` 또는 `.dev.vars` 중 현재 프로젝트가 읽는 쪽에 넣으면 됩니다.
:::

:::warning `wrangler dev`에서 shell export만으로는 부족할 수 있습니다
Cloudflare Worker local runtime은 shell에서 `export CF_ACCOUNT_ID=...`처럼 설정한 값을 자동으로 Worker `env` 바인딩으로 넘기지 않을 수 있습니다. 로컬 검증에서는 `.dev.vars`에 넣거나 `wrangler dev --var CF_ACCOUNT_ID:... --var CF_API_TOKEN:... --var CF_REALTIME_APP_ID:...`처럼 명시적으로 주입하는 방식이 가장 확실했습니다.
:::

---

## 6. 설정 확인

서버를 시작한 뒤 Room Media Cloudflare session endpoint가 participant token을 발급하면 설정이 완료된 것입니다.

```bash
npx edgebase dev --port 4008
```

정상 설정 시:

- `POST /api/room/media/cloudflare_realtimekit/session`
  - Cloudflare RealtimeKit participant session 생성
  - `authToken`, `meetingId`, `participantId` 반환

Room Media의 HTTP control plane endpoint는 `POST /api/room/media/cloudflare_realtimekit/session` 하나만 사용합니다.

설정이 누락되면 대략 이런 에러가 납니다.

```text
Error: Cloudflare Realtime is not configured. Set CF_ACCOUNT_ID, CF_API_TOKEN, and CF_REALTIME_APP_ID.
```

---

## 7. 클라이언트에서 사용

설정이 끝나면 기존 `room.media` surface를 그대로 사용할 수 있습니다. 일반적인 앱 코드에서는 `room.media.connect(...)`를 우선 사용하고, `room.media.transport(...)`는 직접 transport lifecycle을 관리해야 할 때만 쓰는 편이 좋습니다.

```ts
const room = client.room('meeting', roomId);
await room.join();

const media = await room.media.connect();

await media.transport.enableAudio();
await media.transport.enableVideo();

room.media.onRemoteTrack(({ track, kind }) => {
  // <audio> / <video> element에 연결
});
```

Room Media state API는 그대로 유지됩니다.

```ts
await room.media.audio.enable();
await room.media.video.enable();
await room.media.screen.start();
```

자세한 사용법은 [Media (Voice/Video)](/docs/room/media) 문서를 참고하세요.

---

## 문제 해결

### `Cloudflare Realtime is not configured`

`CF_ACCOUNT_ID`, `CF_API_TOKEN`, `CF_REALTIME_APP_ID` 중 하나가 빠졌습니다.

### `authentication error` 또는 `authorization failure`

대부분 토큰 권한 또는 account/app 조합 문제입니다.

확인 순서:

1. token이 **User API Token**인지
2. token 권한이 `Account -> Realtime -> Admin`인지
3. `CF_ACCOUNT_ID`가 token이 속한 account와 맞는지
4. `CF_REALTIME_APP_ID`가 같은 account의 RealtimeKit app인지

### `wrangler login`만 했는데 왜 안 되나요?

Room Media의 현재 경로는 `wrangler` OAuth가 아니라 **Cloudflare API Token**을 기준으로 동작합니다. `wrangler login`만으로는 RealtimeKit control plane 호출을 안정적으로 보장하지 않습니다.

---

## P2P Provider Quick Start

Cloudflare 설정 없이 시작하려면 `p2p` provider를 선택하면 됩니다.

```ts
const room = client.room('meeting', roomId);
await room.join();

const media = await room.media.connect({
  candidates: [
    { label: 'p2p', options: { provider: 'p2p' } },
  ],
});

await media.transport.enableAudio();
```

필요하면 STUN 설정을 직접 넘기기 위해 low-level transport를 직접 만들 수도 있습니다.

```ts
const transport = room.media.transport({
  provider: 'p2p',
  p2p: {
    rtcConfiguration: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
      ],
    },
  },
});
```

`p2p` provider는 1:1 또는 소규모 room용 best-effort 모드입니다. 안정적인 multi-party 통화가 필요하면 기본 `cloudflare_realtimekit` provider를 권장합니다.
