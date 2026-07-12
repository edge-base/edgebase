#include <edgebase/edgebase.h>

int main() {
  client::EdgeBase sdk("https://packaged-consumer.invalid");
  const auto auth = sdk.auth();
  const auto room = sdk.room("release-check", "metadata-free-link");
  return auth.currentToken().empty() && room ? 0 : 1;
}
