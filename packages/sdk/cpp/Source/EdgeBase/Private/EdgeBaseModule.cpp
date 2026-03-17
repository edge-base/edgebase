#include "Modules/ModuleManager.h"

class FEdgeBaseModule final : public IModuleInterface {
public:
  void StartupModule() override {}
  void ShutdownModule() override {}
};

IMPLEMENT_MODULE(FEdgeBaseModule, EdgeBase)
