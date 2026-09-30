// compose-layout: the C++ Compose engine as a CLI with compose-ref's interface.
//
//   build/compose-layout [--density N] [--font-scale N] [--no-touch-target] < input.json
//
// Text goes through the host adapter (FantomComposeText.mm) with the embedded Roboto.

#import <Foundation/Foundation.h>

#include <iostream>
#include <iterator>
#include <string>

#include "expoui/compose/ComposeLayout.h"
#include "components/FantomComposeText.h"

using namespace expoui;


int main(int argc, char** argv) {
  @autoreleasepool {
    compose::ControlMetrics metrics;
    for (int i = 1; i < argc; i++) {
      std::string arg = argv[i];
      auto value = [&]() -> std::string {
        if (i + 1 >= argc) {
          std::cerr << "compose-layout: " << arg << " needs a value\n";
          exit(1);
        }
        return argv[++i];
      };
      if (arg == "--density") {
        metrics.density = std::stof(value());
      } else if (arg == "--font-scale") {
        metrics.fontScale = std::stof(value());
      } else if (arg == "--no-touch-target") {
        metrics.touchTarget = false;
      } else {
        std::cerr << "compose-layout: unknown argument " << arg << "\n";
        return 1;
      }
    }
    std::string input((std::istreambuf_iterator<char>(std::cin)), std::istreambuf_iterator<char>());
    try {
      layout::Value json = layout::Value::parse(input);
      facebook::react::FantomComposeTextMeasurer roboto;
      if (!roboto.hasRoboto()) {
        std::cerr << "compose-layout: the embedded Roboto did not register\n";
        return 1;
      }
      layout::TextMeasurer& text = roboto;
      layout::LayoutResult result = compose::layout(layout::HostSpec::fromValue(json["host"]),
                                                    layout::Node::fromValue(json["root"]), text, metrics);
      std::cout << result.toValue().serialize(2) << "\n";
    } catch (const std::exception& e) {
      std::cerr << "compose-layout: " << e.what() << "\n";
      return 1;
    }
  }
  return 0;
}
