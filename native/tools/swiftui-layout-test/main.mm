// swiftui-layout: runs the C++ SwiftUI layout engine on a swiftui-ref input (stdin) and prints
// the result in the swiftui-ref output format.
//
//   swiftui-layout [--platform macos|ios] < tree.json

#include <iostream>
#include <iterator>
#include <string>

#include "CoreTextMeasurer.h"
#include "Layout.h"

using namespace expoui::layout;

int main(int argc, char** argv) {
  std::string platform = "macos";
  for (int i = 1; i < argc; i++) {
    std::string arg = argv[i];
    if (arg == "--platform" && i + 1 < argc) {
      platform = argv[++i];
    } else {
      std::cerr << "usage: swiftui-layout [--platform macos|ios] < tree.json\n";
      return 1;
    }
  }
  try {
    std::string input((std::istreambuf_iterator<char>(std::cin)), std::istreambuf_iterator<char>());
    Value json = Value::parse(input);
    HostSpec host = HostSpec::fromValue(json["host"]);
    Node root = Node::fromValue(json["root"]);
    CoreTextMeasurer measurer(platform != "ios");
    ControlMetrics metrics = platform == "ios" ? ControlMetrics::ios() : ControlMetrics::macos();
    LayoutResult result = layout(host, root, measurer, metrics);
    std::cout << result.toValue().serialize(2) << "\n";
  } catch (const std::exception& e) {
    std::cerr << "swiftui-layout: " << e.what() << "\n";
    return 1;
  }
  return 0;
}
