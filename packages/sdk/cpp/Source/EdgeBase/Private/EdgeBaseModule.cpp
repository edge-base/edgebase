#include "Modules/ModuleManager.h"
#include "TurnstileAdapterUE.h"
#include "TurnstileProvider.h"

class FEdgeBaseModule final : public IModuleInterface {
public:
  void StartupModule() override { client::RegisterUnrealTurnstile(); }
  void ShutdownModule() override {
    client::TurnstileProvider::setWebViewFactory({});
    client::TurnstileProvider::setPreflightGuard({});
  }
};

IMPLEMENT_MODULE(FEdgeBaseModule, EdgeBase)
