using System;
// EdgeBase C# Unity SDK — Exception
namespace EdgeBase
{

/// <summary>EdgeBase API 오류 — Unity 클라이언트에서 발생하는 API 예외.</summary>
public sealed class EdgeBaseException : Exception
{
    /// <summary>HTTP 상태 코드 (예: 400, 401, 404, 500).</summary>
    public int StatusCode { get; }

    /// <summary>
    /// 서버에서 반환한 에러 응답 본문.
    /// JSON인 경우 `message`, `code` 필드가 포함될 수 있습니다.
    /// </summary>
    public string? Body { get; }

    /// <summary>EdgeBaseException 생성.</summary>
    /// <param name="statusCode">HTTP 상태 코드</param>
    /// <param name="body">서버 응답 본문</param>
    public EdgeBaseException(int statusCode, string? body = null)
        : base(ExtractMessage(statusCode, body))
    {
        StatusCode = statusCode;
        Body       = body;
    }

    /// <summary>네트워크 레벨 오류 래핑용 — innerException 체이닝.</summary>
    public EdgeBaseException(int statusCode, string? body, Exception? innerException)
        : base(ExtractMessage(statusCode, body), innerException)
    {
        StatusCode = statusCode;
        Body       = body;
    }

    private static string ExtractMessage(int statusCode, string? body)
    {
        if (string.IsNullOrWhiteSpace(body))
            return $"HTTP {statusCode}";

        // {"message":"..."} 형태면 메시지 추출
        try
        {
            var doc = System.Text.Json.JsonDocument.Parse(body);
            if (doc.RootElement.TryGetProperty("message", out var msg))
                return msg.GetString() ?? body;
        }
        catch { /* 파싱 실패 시 원문 사용 */ }

        return body.Length > 200 ? body[..200] : body;
    }

    public override string ToString() => $"EdgeBaseException [{StatusCode}] {Message}";
}
}
