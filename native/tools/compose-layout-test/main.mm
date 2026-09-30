// compose-layout: the C++ Compose engine as a CLI with compose-ref's interface.
//
//   build/compose-layout [--density N] [--font-scale N] [--no-touch-target] [--fonts DIR] < input.json

#import <Foundation/Foundation.h>

#include <iostream>
#include <iterator>
#include <string>

#include "ComposeLayout.h"
#include "RobotoTextMeasurer.h"

using namespace expoui::compose;

int main(int argc, char** argv) {
  @autoreleasepool {
    LayoutOptions options;
    std::string exe = [[[NSBundle mainBundle] executablePath] UTF8String];
    std::string fonts = exe.substr(0, exe.rfind('/')) + "/../../compose-ref/fonts";
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
        options.density = std::stof(value());
      } else if (arg == "--font-scale") {
        options.fontScale = std::stof(value());
      } else if (arg == "--no-touch-target") {
        options.touchTarget = false;
      } else if (arg == "--fonts") {
        fonts = value();
      } else {
        std::cerr << "compose-layout: unknown argument " << arg << "\n";
        return 1;
      }
    }
    if (!RobotoTextMeasurer::registerFonts(fonts)) {
      std::cerr << "compose-layout: no Roboto-*.ttf in " << fonts << " (run compose-ref/fetch-fonts.sh)\n";
      return 1;
    }
    std::string input((std::istreambuf_iterator<char>(std::cin)), std::istreambuf_iterator<char>());
    try {
      Json json = Json::parse(input);
      RobotoTextMeasurer text;
      LayoutResult result = layout(json, text, options);
      std::cout << toJson(result, options).dump(2) << "\n";
    } catch (const std::exception& e) {
      std::cerr << "compose-layout: " << e.what() << "\n";
      return 1;
    }
  }
  return 0;
}
