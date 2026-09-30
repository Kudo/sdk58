// iOS entry point: a simulator app (built by scripts/run-ios.sh) that lays out each input file
// and writes `{ "<input path>": <output> }` to the `--out` path.
//
//   swiftui-ref --out <result.json> <tree.json>...

#if os(iOS)
import SwiftUI
import UIKit

final class RefAppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  func application(
    _ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    let window = UIWindow(frame: UIScreen.main.bounds)
    window.rootViewController = UIViewController()
    window.makeKeyAndVisible()
    self.window = window
    DispatchQueue.main.async { self.run() }
    return true
  }

  private func run() {
    var args = Array(CommandLine.arguments.dropFirst())
    var outPath: String?
    var inputs: [String] = []
    while !args.isEmpty {
      let arg = args.removeFirst()
      if arg == "--out", !args.isEmpty {
        outPath = args.removeFirst()
      } else if !arg.hasPrefix("-") {
        inputs.append(arg)
      }
    }
    guard let outPath else {
      fail("usage: swiftui-ref --out <result.json> <tree.json>...")
    }
    var results: [String: Any] = [:]
    for input in inputs {
      guard let data = FileManager.default.contents(atPath: input) else {
        results[input] = ["error": "cannot read \(input)"]
        continue
      }
      results[input] = layout(data)
    }
    // Screen and text metrics that the engine's ControlMetrics records.
    var fonts: [String: Any] = [:]
    let styles: [(String, UIFont.TextStyle)] = [
      ("largeTitle", .largeTitle), ("title", .title1), ("title2", .title2), ("title3", .title3),
      ("headline", .headline), ("subheadline", .subheadline), ("body", .body), ("callout", .callout),
      ("footnote", .footnote), ("caption", .caption1), ("caption2", .caption2),
    ]
    for (name, style) in styles {
      let font = UIFont.preferredFont(forTextStyle: style)
      let traits = font.fontDescriptor.object(forKey: .traits) as? [UIFontDescriptor.TraitKey: Any]
      fonts[name] = [
        "pointSize": font.pointSize, "lineHeight": font.lineHeight, "ascender": font.ascender,
        "descender": font.descender, "leading": font.leading, "fontName": font.fontName,
        "weight": (traits?[.weight] as? CGFloat) ?? 0,
      ]
    }
    results["_device"] = [
      "screenScale": UIScreen.main.scale,
      "systemVersion": UIDevice.current.systemVersion,
      "model": UIDevice.current.model,
      "fonts": fonts,
    ]
    FileManager.default.createFile(atPath: outPath, contents: jsonData(results))
    exit(0)
  }

  private func layout(_ data: Data) -> [String: Any] {
    let (root, options) = parseInput(data)
    let store = FrameStore()
    let builder = Builder(store: store)
    let content = HostContent(options: options, root: builder.build(root, path: "0"), store: store)
    let controller = UIHostingController(rootView: content)
    // The Host is a plain view in the React Native tree: no safe area inside it.
    controller.safeAreaRegions = []
    let container = window!.rootViewController!
    container.addChild(controller)
    controller.view.frame = CGRect(x: 0, y: 0, width: options.width, height: options.height)
    container.view.addSubview(controller.view)
    controller.didMove(toParent: container)
    for _ in 0..<5 {
      controller.view.setNeedsLayout()
      controller.view.layoutIfNeeded()
      RunLoop.main.run(until: Date().addingTimeInterval(0.02))
    }
    let fitting = controller.sizeThatFits(in: CGSize(width: options.width, height: options.height))
    let output = makeOutput(store: store, options: options, fittingSize: fitting)
    controller.willMove(toParent: nil)
    controller.view.removeFromSuperview()
    controller.removeFromParent()
    return output
  }
}
#endif
