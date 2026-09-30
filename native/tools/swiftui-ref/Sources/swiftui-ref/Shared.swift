import SwiftUI

// Input parsing, the Host view and the output format, shared by the macOS and iOS entry points.

struct HostOptions {
  var width: CGFloat = 390
  var height: CGFloat = 844
  var matchContentsHorizontal = false
  var matchContentsVertical = false
  var layoutDirection: LayoutDirection = .leftToRight

  init(json: [String: Any]?) {
    guard let json else { return }
    if let w = parseNumber(json["width"]) { width = CGFloat(w) }
    if let h = parseNumber(json["height"]) { height = CGFloat(h) }
    if let match = json["matchContents"] as? Bool {
      matchContentsHorizontal = match
      matchContentsVertical = match
    } else if let match = json["matchContents"] as? [String: Any] {
      matchContentsHorizontal = match["horizontal"] as? Bool ?? false
      matchContentsVertical = match["vertical"] as? Bool ?? false
    }
    if json["layoutDirection"] as? String == "rightToLeft" {
      layoutDirection = .rightToLeft
    }
  }
}

/// The body of `packages/expo-ui/ios/HostView.swift` (sdk-58) without `useViewportSizeMeasurement`,
/// color scheme and seed color: a top-leading `ZStackLayout` around the children, `fixedSize` on the
/// `matchContents` axes, then a frame that fills (or pins, for `matchContents`) the proposal.
struct HostContent: View {
  let options: HostOptions
  let root: AnyView
  let store: FrameStore

  var body: some View {
    let alignment: Alignment = options.layoutDirection == .rightToLeft ? .topTrailing : .topLeading
    let fillHorizontal = !options.matchContentsHorizontal
    let fillVertical = !options.matchContentsVertical
    let pinHorizontal = options.matchContentsHorizontal
    let pinVertical = options.matchContentsVertical

    ZStack(alignment: alignment) {
      root
    }
    .fixedSize(horizontal: options.matchContentsHorizontal, vertical: options.matchContentsVertical)
    .environment(\.layoutDirection, options.layoutDirection)
    // `GeometryChangeModifier` sits here in HostView: this size is what `matchContents` sends to Yoga.
    .recordFrame(store, path: "host.content")
    .frame(
      minWidth: pinHorizontal ? 0 : nil,
      maxWidth: fillHorizontal || pinHorizontal ? .infinity : nil,
      minHeight: pinVertical ? 0 : nil,
      maxHeight: fillVertical || pinVertical ? .infinity : nil,
      alignment: alignment
    )
    .recordFrame(store, path: "host")
  }
}

func fail(_ message: String) -> Never {
  FileHandle.standardError.write("swiftui-ref: \(message)\n".data(using: .utf8)!)
  exit(1)
}

func rounded(_ value: CGFloat) -> Double {
  (Double(value) * 1000).rounded() / 1000
}

func frameJSON(_ rect: CGRect, origin: CGPoint) -> [String: Any] {
  [
    "x": rounded(rect.minX - origin.x),
    "y": rounded(rect.minY - origin.y),
    "width": rounded(rect.width),
    "height": rounded(rect.height),
  ]
}

/// Parses one input document.
func parseInput(_ data: Data) -> (Node, HostOptions) {
  guard let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
    fail("input is not a JSON object")
  }
  guard let rootJSON = json["root"] as? [String: Any] else {
    fail("missing \"root\"")
  }
  do {
    return (try Node(json: rootJSON), HostOptions(json: json["host"] as? [String: Any]))
  } catch {
    fail("\(error)")
  }
}

/// The output document for the recorded frames.
func makeOutput(store: FrameStore, options: HostOptions, fittingSize: CGSize) -> [String: Any] {
  guard let hostFrame = store.entries["host"]?.frame else {
    fail("the host frame was not recorded")
  }
  let origin = hostFrame.origin
  let contentFrame = store.entries["host.content"]?.frame ?? hostFrame

  // `matchContents` axes take the content size (what HostView sends to Yoga); the others keep the
  // given size.
  let hostSize: [String: Any] = [
    "width": rounded(options.matchContentsHorizontal ? contentFrame.width : options.width),
    "height": rounded(options.matchContentsVertical ? contentFrame.height : options.height),
  ]

  /// Frame of a node; for virtual nodes the union of their descendants' frames.
  func resolvedFrame(_ path: String) -> CGRect? {
    guard let entry = store.entries[path], !entry.platformRendered else { return nil }
    if !entry.virtual {
      return entry.frame
    }
    let prefix = path + "/"
    let frames = store.order
      .filter { $0.hasPrefix(prefix) && !(store.entries[$0]?.virtual ?? true) }
      .compactMap { p -> CGRect? in
        guard let e = store.entries[p], !e.platformRendered else { return nil }
        return e.frame
      }
    return frames.dropFirst().reduce(frames.first) { $0?.union($1) }
  }

  var nodes: [[String: Any]] = []
  let sorted = store.order.sorted {
    $0.split(separator: "/").lexicographicallyPrecedes($1.split(separator: "/")) { Int($0)! < Int($1)! }
  }
  for path in sorted {
    guard let entry = store.entries[path] else { continue }
    var node: [String: Any] = ["path": path, "type": entry.type]
    if let frame = resolvedFrame(path) {
      node["frame"] = frameJSON(frame, origin: origin)
    } else {
      node["frame"] = NSNull()
    }
    if entry.virtual { node["virtual"] = true }
    if entry.platformRendered { node["platformRendered"] = true }
    if !entry.virtual, !entry.platformRendered, let inner = entry.contentFrame, inner != entry.frame {
      node["contentFrame"] = frameJSON(inner, origin: origin)
    }
    if let text = entry.text { node["text"] = text }
    if let label = entry.accessibilityLabel { node["accessibilityLabel"] = label }
    nodes.append(node)
  }

  var output: [String: Any] = [
    "host": hostSize,
    "fittingSize": ["width": rounded(fittingSize.width), "height": rounded(fittingSize.height)],
    "nodes": nodes,
  ]
  if !store.unsupported.isEmpty {
    output["unsupported"] = store.unsupported
  }
  return output
}

func jsonData(_ object: Any) -> Data {
  try! JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys])
}
