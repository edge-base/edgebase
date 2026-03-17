// EdgeBase — Unreal Engine Turnstile adapter.
//
// Built-in adapter using UE's SWebBrowser (CEF). Zero third-party dependencies.
// Automatically handles both invisible auto-pass (99%) and interactive overlay (1%).
//
// ─── Setup ──────────────────────────────────────────────────────────────────
//
// 1. Add "WebBrowserWidget" to your .Build.cs:
//
//    PublicDependencyModuleNames.AddRange(new string[] {
//        "WebBrowserWidget", "Slate", "SlateCore"
//    });
//
// 2. Include this header in ANY .cpp file in your project:
//
//    #include "edgebase/turnstile_adapter_ue.h"
//
// That's it. The adapter auto-registers after engine initialization via
// FCoreDelegates::OnPostEngineInit. No manual function calls needed.
//
// ─── How it works ───────────────────────────────────────────────────────────
//
// 1. FCoreDelegates::OnPostEngineInit → RegisterUnrealTurnstile() auto-called
// 2. Auth methods call resolveCaptchaToken() on a background thread
// 3. Factory dispatches to Game Thread → creates hidden SWindow + SWebBrowser
// 4. SWebBrowser loads Turnstile HTML (from getTurnstileHtml)
// 5. JS communicates via edgebase:// URL scheme, intercepted by OnBeforeNavigation
//    - edgebase://token/<token>       → capture token, close window
//    - edgebase://error/<msg>         → close window, return empty
//    - edgebase://interactive/show    → show the hidden window
//    - edgebase://interactive/hide    → hide window (token follows)
// 6. FEvent signals the background thread → token returned
//
// IMPORTANT: Do NOT call auth methods from the Game Thread — they block
// while waiting for the browser. Use Async() or background tasks.

#pragma once

#if WITH_ENGINE

#include "edgebase/turnstile_provider.h"

#include "HAL/Event.h"
#include "HAL/PlatformProcess.h"
#include "Async/Async.h"
#include "Misc/CoreDelegates.h"
#include "Misc/ScopeLock.h"
#include "Framework/Application/SlateApplication.h"
#include "Widgets/SWindow.h"
#include "Widgets/Layout/SBox.h"
#include "SWebBrowser.h"

namespace client {

/**
 * Register the built-in Unreal Turnstile adapter.
 * Normally called automatically via OnPostEngineInit.
 * Can also be called manually if needed.
 */
inline void RegisterUnrealTurnstile()
{
    TurnstileProvider::setWebViewFactory(
        [](const std::string& siteKey, const std::string& action) -> std::string
        {
            // ── Shared state between game thread and caller thread ──
            struct SharedState
            {
                FString Token;
                FEvent* DoneEvent = FPlatformProcess::GetSynchEventFromPool(false);
                TSharedPtr<SWindow> Window;
                TSharedPtr<SWebBrowser> Browser;
                bool bInteractive = false;

                ~SharedState()
                {
                    FPlatformProcess::ReturnSynchEventToPool(DoneEvent);
                    DoneEvent = nullptr;
                }
            };

            auto State = MakeShared<SharedState>();

            // ── Dispatch to Game Thread ──
            AsyncTask(ENamedThreads::GameThread, [State, siteKey, action]()
            {
                // Generate HTML
                FString Html = UTF8_TO_TCHAR(
                    TurnstileProvider::getTurnstileHtml(siteKey, action).c_str()
                );

                // Create hidden window (shown only for interactive challenges)
                State->Window = SNew(SWindow)
                    .Title(FText::FromString(TEXT("Verification")))
                    .ClientSize(FVector2D(400, 350))
                    .AutoCenter(EAutoCenter::PreferredWorkArea)
                    .SizingRule(ESizingRule::FixedSize)
                    .IsTopmostWindow(true)
                    .FocusWhenFirstShown(true)
                    .SupportsTransparency(EWindowTransparency::None)
                    .CreateTitleBar(true)
                    [
                        SNew(SBox)
                        .WidthOverride(400)
                        .HeightOverride(300)
                        [
                            SAssignNew(State->Browser, SWebBrowser)
                                .InitialURL(TEXT("about:blank"))
                                .ShowControls(false)
                                .ShowAddressBar(false)
                                .SupportsTransparency(false)
                                .OnBeforeNavigation_Lambda(
                                    [State](const FString& Url) -> bool
                                    {
                                        // Intercept edgebase:// scheme URLs
                                        if (!Url.StartsWith(TEXT("edgebase://")))
                                        {
                                            return false; // Allow normal navigation
                                        }

                                        if (Url.StartsWith(TEXT("edgebase://token/")))
                                        {
                                            State->Token = Url.RightChop(17);
                                            if (State->Window.IsValid())
                                            {
                                                State->Window->RequestDestroyWindow();
                                            }
                                            State->DoneEvent->Trigger();
                                        }
                                        else if (Url.StartsWith(TEXT("edgebase://error/")))
                                        {
                                            if (State->Window.IsValid())
                                            {
                                                State->Window->RequestDestroyWindow();
                                            }
                                            State->DoneEvent->Trigger();
                                        }
                                        else if (Url.StartsWith(TEXT("edgebase://interactive/show")))
                                        {
                                            if (State->Window.IsValid())
                                            {
                                                FSlateApplication::Get().AddWindow(State->Window.ToSharedRef());
                                                State->Window->ShowWindow();
                                                State->Window->BringToFront();
                                                State->bInteractive = true;
                                            }
                                        }
                                        else if (Url.StartsWith(TEXT("edgebase://interactive/hide")))
                                        {
                                            if (State->Window.IsValid() && State->bInteractive)
                                            {
                                                State->Window->HideWindow();
                                            }
                                        }

                                        return true; // Block edgebase:// navigation
                                    }
                                )
                        ]
                    ];

                // Add window hidden — browser needs to run for Turnstile JS
                FSlateApplication::Get().AddWindow(State->Window.ToSharedRef());
                State->Window->HideWindow();

                // Load Turnstile HTML
                State->Browser->LoadString(
                    Html,
                    TEXT("https://challenges.cloudflare.com")
                );
            });

            // ── Wait for token (30s timeout) ──
            const bool bSignaled = State->DoneEvent->Wait(30000);

            // Cleanup: close window if still open
            if (State->Window.IsValid())
            {
                AsyncTask(ENamedThreads::GameThread, [State]()
                {
                    if (State->Window.IsValid())
                    {
                        State->Window->RequestDestroyWindow();
                    }
                });
            }

            if (!bSignaled || State->Token.IsEmpty())
            {
                return ""; // Timeout or error — let server handle
            }

            return TCHAR_TO_UTF8(*State->Token);
        }
    );
}

// ─── Auto-Registration ──────────────────────────────────────────────────────
// Automatically registers the Turnstile adapter after engine initialization.
// Just #include this header in any .cpp file — no manual calls needed.

namespace detail {

inline bool& TurnstileAutoRegistered()
{
    static bool bRegistered = false;
    return bRegistered;
}

struct FAutoRegisterTurnstile
{
    FAutoRegisterTurnstile()
    {
        if (!TurnstileAutoRegistered())
        {
            TurnstileAutoRegistered() = true;
            FCoreDelegates::OnPostEngineInit.AddLambda([]()
            {
                RegisterUnrealTurnstile();
            });
        }
    }
};

// Static instance triggers auto-registration at module load time.
// FCoreDelegates::OnPostEngineInit fires after Slate is ready,
// so SWebBrowser creation is safe.
static FAutoRegisterTurnstile GAutoRegisterTurnstile;

} // namespace detail

} // namespace client

#endif // WITH_ENGINE
