// EdgeBase — Unreal Engine hosted Turnstile adapter.
//
// Add "WebBrowser", "WebBrowserWidget", "Slate", and "SlateCore" to the
// consuming module, then include this header once. Protected auth calls must
// run off the Game Thread because the synchronous C++ API waits for the hidden
// browser to complete.

#pragma once

#if WITH_ENGINE

#include "edgebase/turnstile_provider.h"

#include "Async/Async.h"
#include "Framework/Application/SlateApplication.h"
#include "HAL/Event.h"
#include "HAL/PlatformProcess.h"
#include "Misc/CoreDelegates.h"
#include "Misc/ScopeLock.h"
#include "SWebBrowser.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/SWindow.h"

#include <atomic>
#include <stdexcept>

namespace client {

inline void RegisterUnrealTurnstile() {
  TurnstileProvider::setPreflightGuard([]() {
    if (IsInGameThread()) {
      throw std::runtime_error(
          "captcha-unavailable: synchronous protected auth cannot run on the Unreal Game Thread; use the Blueprint async wrapper or dispatch the C++ call to a background thread");
    }
  });
  TurnstileProvider::setWebViewFactory(
      [](const std::string &hostedChallengeUrl,
         const std::string &channel) -> std::string {
        struct SharedState {
          FEvent *DoneEvent = FPlatformProcess::GetSynchEventFromPool(false);
          TSharedPtr<SWindow> Window;
          TSharedPtr<SWebBrowser> Browser;
          FCriticalSection ResultMutex;
          FString Token;
          std::atomic<bool> Completed{false};
          bool Interactive = false;

          ~SharedState() {
            if (DoneEvent) {
              FPlatformProcess::ReturnSynchEventToPool(DoneEvent);
              DoneEvent = nullptr;
            }
          }

          bool CompleteOnce(const FString &InToken) {
            bool expected = false;
            if (!Completed.compare_exchange_strong(expected, true)) {
              return false;
            }
            {
              FScopeLock lock(&ResultMutex);
              Token = InToken;
            }
            if (DoneEvent) {
              DoneEvent->Trigger();
            }
            return true;
          }

          FString GetToken() {
            FScopeLock lock(&ResultMutex);
            return Token;
          }
        };

        auto State = MakeShared<SharedState>();
        if (!State->DoneEvent) {
          throw std::runtime_error(
              "captcha-unavailable: Unreal synchronization event allocation failed");
        }
        if (IsInGameThread()) {
          throw std::runtime_error(
              "captcha-unavailable: synchronous protected auth cannot run on the Unreal Game Thread; use the Blueprint async wrapper or dispatch the C++ call to a background thread");
        }

        const FString ChallengeUrl = UTF8_TO_TCHAR(hostedChallengeUrl.c_str());
        AsyncTask(ENamedThreads::GameThread,
                  [State, ChallengeUrl, channel]() {
                    if (State->Completed.load() ||
                        !FSlateApplication::IsInitialized()) {
                      State->CompleteOnce(FString());
                      return;
                    }

                    State->Window =
                        SNew(SWindow)
                            .Title(FText::FromString(TEXT("Verification")))
                            .ClientSize(FVector2D(400, 350))
                            .AutoCenter(EAutoCenter::PreferredWorkArea)
                            .SizingRule(ESizingRule::FixedSize)
                            .IsTopmostWindow(true)
                            .FocusWhenFirstShown(true)
                            .SupportsMaximize(false)
                            .SupportsMinimize(false)
                            .SupportsTransparency(EWindowTransparency::None)
                            .CreateTitleBar(true)
                            [SNew(SBox)
                                 .WidthOverride(400)
                                 .HeightOverride(300)
                                     [SAssignNew(State->Browser, SWebBrowser)
                                          .InitialURL(ChallengeUrl)
                                          .ShowControls(false)
                                          .ShowAddressBar(false)
                                          .SupportsTransparency(false)
                                          .OnLoadError_Lambda([State]() {
                                            State->CompleteOnce(FString());
                                          })
                                          .OnBeforeNavigation_Lambda(
                                              [State, ChallengeUrl,
                                               channel](const FString &Url,
                                                        const FWebNavigationRequest &Request) {
                                                (void)Request;
                                                if (Url == ChallengeUrl) {
                                                  return false;
                                                }

                                                std::string type;
                                                std::string value;
                                                const std::string rawUrl =
                                                    TCHAR_TO_UTF8(*Url);
                                                const bool parsed =
                                                    TurnstileProvider::
                                                        tryParseChallengeUri(
                                                            rawUrl, channel,
                                                            type, value);
                                                if (parsed &&
                                                    type == "interactive") {
                                                  if (value == "show" &&
                                                      State->Window.IsValid()) {
                                                    State->Window->ShowWindow();
                                                    State->Window->BringToFront();
                                                    State->Interactive = true;
                                                  } else if (
                                                      value == "hide" &&
                                                      State->Interactive &&
                                                      State->Window.IsValid()) {
                                                    State->Window->HideWindow();
                                                  }
                                                  return true;
                                                }
                                                if (parsed && type == "ready") {
                                                  return true;
                                                }

                                                const FString token =
                                                    parsed && type == "token"
                                                        ? UTF8_TO_TCHAR(
                                                              value.c_str())
                                                        : FString();
                                                if (State->CompleteOnce(token) &&
                                                    State->Window.IsValid()) {
                                                  State->Window
                                                      ->RequestDestroyWindow();
                                                }
                                                return true;
                                              })]];

                    State->Window->SetOnWindowClosed(
                        FOnWindowClosed::CreateLambda(
                            [State](const TSharedRef<SWindow> &) {
                              State->CompleteOnce(FString());
                            }));
                    FSlateApplication::Get().AddWindow(
                        State->Window.ToSharedRef(), false);
                    if (!State->Browser.IsValid()) {
                      State->CompleteOnce(FString());
                      State->Window->RequestDestroyWindow();
                      return;
                    }
                  });

        if (!State->DoneEvent->Wait(30000)) {
          State->CompleteOnce(FString());
        }

        AsyncTask(ENamedThreads::GameThread, [State]() {
          if (State->Window.IsValid()) {
            State->Window->RequestDestroyWindow();
          }
          State->Browser.Reset();
          State->Window.Reset();
        });

        const FString token = State->GetToken();
        return token.IsEmpty() ? "" : TCHAR_TO_UTF8(*token);
      });
}

namespace detail {

inline bool &TurnstileAutoRegistered() {
  static bool registered = false;
  return registered;
}

struct FAutoRegisterTurnstile {
  FAutoRegisterTurnstile() {
    if (!TurnstileAutoRegistered()) {
      TurnstileAutoRegistered() = true;
      FCoreDelegates::OnPostEngineInit.AddLambda(
          []() { RegisterUnrealTurnstile(); });
    }
  }
};

inline FAutoRegisterTurnstile GAutoRegisterTurnstile;

} // namespace detail
} // namespace client

#endif // WITH_ENGINE
