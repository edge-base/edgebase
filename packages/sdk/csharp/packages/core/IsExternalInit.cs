// IsExternalInit polyfill — netstandard2.1에서 C# 9.0+ record/init-only 사용 시 필요
// ref: https://developercommunity.visualstudio.com/t/error-cs0518-isexternalinit-not-defined/1241647

namespace System.Runtime.CompilerServices
{
    internal static class IsExternalInit { }
}
