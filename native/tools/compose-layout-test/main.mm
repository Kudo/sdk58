// compose-layout: the C++ Compose engine as a CLI with compose-ref's interface.
//
//   build/compose-layout [--density N] [--font-scale N] [--no-touch-target] [--shared-measurer] < input.json
//
// Text goes through the host adapter (FantomComposeText.mm) with the embedded Roboto.

#import <Foundation/Foundation.h>

#include <iostream>
#include <iterator>
#include <string>

#include "expoui/compose/ComposeLayout.h"
#include "components/FantomComposeText.h"

using namespace expoui;

namespace {

/// Only the shared interface (no ComposeTextMeasurer): what a host measurer that serves both
/// engines provides. `--shared-measurer` checks the engine's fallback path.
class SharedOnly : public layout::TextMeasurer {
 public:
  explicit SharedOnly(layout::TextMeasurer& inner) : inner_(inner) {}
  layout::TextMeasurement measureText(const std::string& text, const layout::FontSpec& font, double maxWidth,
                                      int maxLines) override {
    return inner_.measureText(text, font, maxWidth, maxLines);
  }
  double lineHeight(const layout::FontSpec& font) override { return inner_.lineHeight(font); }
  layout::Size measureSymbol(const std::string& name, const layout::FontSpec& font) override {
    return inner_.measureSymbol(name, font);
  }

 private:
  layout::TextMeasurer& inner_;
};

}  // namespace

int main(int argc, char** argv) {
  @autoreleasepool {
    compose::ControlMetrics metrics;
    bool sharedOnly = false;
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
      } else if (arg == "--shared-measurer") {
        sharedOnly = true;
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
      SharedOnly shared(roboto);
      layout::TextMeasurer& text = sharedOnly ? static_cast<layout::TextMeasurer&>(shared) : roboto;
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
