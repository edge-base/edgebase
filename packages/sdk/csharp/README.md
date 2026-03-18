# EdgeBase C# SDK — Unity 클라이언트 SDK

> **Unity 전용 클라이언트 SDK입니다.** 서버/백엔드 기능(AdminAuth, SQL, Broadcast)은 없습니다.
> 서버 측에는 JS/Python/Go/Kotlin SDK를 사용하세요.

## 요구사항

- **Unity 2021.3 LTS** 이상
- **.NET Standard 2.1** (Unity 2021.3+에서 기본 지원)
- IL2CPP / Mono 양쪽 지원

## 설치

1. `packages/sdk/csharp/src/` 폴더를 Unity 프로젝트의 `Assets/Plugins/EdgeBase/` 에 복사합니다.
2. 또는 `.dll` 빌드 후 `Assets/Plugins/` 에 추가합니다.

## 사용법

```csharp
using EdgeBase;

// MonoBehaviour 예시
public class GameManager : MonoBehaviour
{
    private EdgeBase.EdgeBase _jb;

    private void Awake()
    {
        _jb = new EdgeBase.EdgeBase("https://your-project.edgebase.fun");
    }

    private void OnDestroy() => _jb.Destroy();

    private async void Start()
    {
        // 회원가입
        var result = await _jb.Auth.SignUpAsync("user@example.com", "password");
        Debug.Log($"Signed up: {result["accessToken"]}");

        // 컬렉션 CRUD
        var post = await _jb.Collection("posts").InsertAsync(new() {
            ["title"] = "Hello EdgeBase",
            ["status"] = "published"
        });

        // 스토리지 업로드
        var bytes = System.IO.File.ReadAllBytes("asset.png");
        await _jb.Storage.Bucket("avatars").UploadAsync("user123.png", bytes, "image/png");
    }
}
```

## API

### Auth (`client.Auth.*`)

| 메서드 | 설명 |
|---|---|
| `SignUpAsync(email, password, userData?)` | 이메일 회원가입 |
| `SignInAsync(email, password)` | 이메일 로그인 |
| `SignOutAsync()` | 로그아웃 + 토큰 초기화 |
| `SignInAnonymouslyAsync()` | 익명 로그인 |
| `SignInWithOAuth(provider, redirectUrl?)` | OAuth 시작 URL 반환 (네트워크 없음) |
| `LinkWithEmailAsync(email, password)` | 익명 계정 → 이메일 연결 |
| `LinkWithOAuth(provider, redirectUrl?)` | 익명 계정 → OAuth 연결 URL 반환 |
| `UpdateProfileAsync(data)` | 프로필 수정 (displayName, avatarUrl) |
| `ChangePasswordAsync(current, new)` | 비밀번호 변경 + 새 토큰 자동 적용 |
| `RequestPasswordResetAsync(email)` | 비밀번호 재설정 이메일 요청 |
| `ResetPasswordAsync(token, newPassword)` | 재설정 토큰으로 비밀번호 변경 |
| `VerifyEmailAsync(token)` | 이메일 인증 완료 |
| `ListSessionsAsync()` | 활성 세션 목록 |
| `RevokeSessionAsync(id)` | 특정 세션 만료 |
| `GetAccessToken()` | 현재 토큰 반환 (null이면 미로그인) |
| `SetAccessToken(token)` | 토큰 복원 (Unity PlayerPrefs 연동용) |

### Collection (`admin.Collection("name").*`)

#### 쿼리 빌더 (불변 체이닝)

| 메서드 | 설명 |
|---|---|
| `.Where(field, op, value)` | 필터 조건 추가 |
| `.OrderBy(field, dir)` | 정렬 ("asc" / "desc") |
| `.Limit(n)` | 최대 결과 수 |
| `.Offset(n)` | 건너뛸 개수 |
| `.Page(number)` | 페이지 지정 (1부터 시작, `.Limit()`와 함께 사용) |
| `.Search(string)` | 전체 텍스트 검색 |
| `.After(cursor)` | 커서 기반 페이징 |
| `.Before(cursor)` | 커서 기반 역방향 페이징 |
| `.Doc(id)` | 특정 문서 참조 |

#### CRUD

| 메서드 | 반환 | 설명 |
|---|---|---|
| `.GetAsync()` | `ListResult` | 목록 조회 (Items/Total/Cursor) |
| `.GetOneAsync(id)` | `Dictionary` | 단건 조회 |
| `.GetAsync(id)` | `Dictionary` | 단건 조회 (별칭) |
| `.InsertAsync(data)` | `Dictionary` | 생성 |
| `.UpdateAsync(id, data)` | `Dictionary` | 수정 (PATCH) |
| `.DeleteAsync(id)` | `Dictionary` | 삭제 |
| `.UpsertAsync(data, conflictTarget?)` | `Dictionary` | upsert (없으면 생성, 있으면 업데이트) |
| `.CountAsync()` | `int` | 개수 반환 |

#### 배치

| 메서드 | 반환 | 설명 |
|---|---|---|
| `.InsertManyAsync(records)` | `List<Dictionary>` | 다건 생성 |
| `.UpsertManyAsync(records, conflictTarget?)` | `Dictionary` | 다건 upsert |
| `.UpdateManyAsync(update)` | `Dictionary` | 필터 조건에 맞는 전체 수정 |
| `.DeleteManyAsync()` | `Dictionary` | 필터 조건에 맞는 전체 삭제 |

### Storage (`admin.Storage.Bucket("name").*`)

| 메서드 | 반환 | 설명 |
|---|---|---|
| `.GetUrl(key)` | `string` | 공개 URL (네트워크 없음) |
| `.UploadAsync(key, data, contentType?)` | `Dictionary` | 바이트 배열 업로드 |
| `.UploadStringAsync(key, content, contentType?)` | `Dictionary` | 텍스트 업로드 (UTF-8 자동 변환) |
| `.DownloadAsync(key)` | `byte[]` | 파일 다운로드 |
| `.DeleteAsync(key)` | `Dictionary` | 파일 삭제 |
| `.ListAsync(prefix?, limit?, offset?)` | `FileListResult` | 목록 조회 |
| `.GetMetadataAsync(key)` | `Dictionary` | 메타데이터 조회 |
| `.UpdateMetadataAsync(key, metadata)` | `Dictionary` | 메타데이터 수정 |
| `.CreateSignedUrlAsync(key, expiresIn?)` | `SignedUrlResult` | 서명된 다운로드 URL |
| `.CreateSignedUploadUrlAsync(key, expiresIn?)` | `Dictionary` | 서명된 업로드 URL (클라이언트 직접 업로드) |

### 반환 타입

```csharp
// ListResult (Collection.GetAsync 반환)
record ListResult(
    List<Dictionary<string, object?>> Items,
    int Total,
    string? Cursor
);

// FileListResult (Storage.ListAsync 반환)
record FileListResult(List<FileInfo> Files, string? Cursor);

// FileInfo
record FileInfo(string Key, long Size, string ContentType, string UpdatedAt,
                string Etag, string UploadedBy,
                Dictionary<string, string>? CustomMetadata);

// SignedUrlResult (Storage.CreateSignedUrlAsync 반환)
record SignedUrlResult(string Url, long ExpiresAt);

// 오류
class EdgeBaseException : Exception {
    int StatusCode;
    string? Body;     // 서버 응답 원문
}
```

## 예제

```csharp
// 게임 유저 점수 저장
var score = await _jb.Collection("scores").InsertAsync(new() {
    ["uid"]   = _jb.Auth.GetAccessToken(),
    ["score"] = 9999,
    ["stage"] = 5
});

// 상위 10명 조회
var top = await _jb.Collection("scores")
    .OrderBy("score", "desc")
    .Limit(10)
    .GetAsync();

foreach (var item in top.Items)
    Debug.Log($"Score: {item["score"]}");

// 파일 업로드
var png = await System.IO.File.ReadAllBytesAsync("screenshot.png");
await _jb.Storage.Bucket("screenshots").UploadAsync("round1.png", png, "image/png");
```

## 서버 기능이 필요하다면

게임 서버(Node.js, Go 등)에서 아래 SDK를 사용하세요:
- **Node.js**: `createAdminClient()` from `@edge-base/admin`
- **Go**: `edgebase.NewAdminClient(url, serviceKey)`
- **Python**: `EdgeBaseServer(url, service_key=)`
