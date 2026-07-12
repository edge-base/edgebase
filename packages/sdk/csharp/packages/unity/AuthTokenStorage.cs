using System;
using System.Threading.Tasks;

namespace EdgeBase
{

public readonly struct AuthTokenPair
{
    public string AccessToken { get; }
    public string RefreshToken { get; }

    public AuthTokenPair(string accessToken, string refreshToken)
    {
        AccessToken = accessToken;
        RefreshToken = refreshToken;
    }
}

/// <summary>Inject platform-secure persistence for Unity auth token pairs.</summary>
public interface IAuthTokenStorage
{
    Task<AuthTokenPair?> LoadTokensAsync();
    Task SaveTokensAsync(AuthTokenPair tokens);
    Task ClearTokensAsync();
}

/// <summary>
/// Opt-in contract for storage that survives process restart and reports
/// failed writes. Irreversible anonymous-account upgrades require this type.
/// </summary>
public interface IDurableAuthTokenStorage : IAuthTokenStorage
{
}

/// <summary>Default process-memory storage; inject secure storage for restart persistence.</summary>
public sealed class MemoryAuthTokenStorage : IAuthTokenStorage
{
    private AuthTokenPair? _tokens;

    public Task<AuthTokenPair?> LoadTokensAsync() => Task.FromResult(_tokens);

    public Task SaveTokensAsync(AuthTokenPair tokens)
    {
        _tokens = tokens;
        return Task.CompletedTask;
    }

    public Task ClearTokensAsync()
    {
        _tokens = null;
        return Task.CompletedTask;
    }
}

/// <summary>Storage failed before a replacement session could be exposed.</summary>
public sealed class TokenPersistenceException : Exception
{
    public string Operation { get; }

    public TokenPersistenceException(string operation, Exception innerException)
        : base($"Token persistence {operation} failed before token adoption.", innerException)
    {
        Operation = operation;
    }
}

}
