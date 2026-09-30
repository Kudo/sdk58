import SwiftUI

/// Frames recorded during layout, in window coordinates (SwiftUI `.global`, y down).
final class FrameStore {
  struct Entry {
    var type: String
    var frame: CGRect?
    var contentFrame: CGRect?
    var text: String?
    var accessibilityLabel: String?
    /// Group, Slot and Section have no view of their own: SwiftUI applies their modifiers to each
    /// child. Their frame is the union of their children's frames.
    var virtual = false
    /// Picker options are drawn by the AppKit control (segments, menu items), not laid out by
    /// SwiftUI, so they have no frame.
    var platformRendered = false
  }

  var entries: [String: Entry] = [:]
  var order: [String] = []
  var unsupported: [String: [String]] = [:]

  func register(path: String, type: String, text: String?, accessibilityLabel: String?, virtual: Bool) {
    if entries[path] == nil {
      order.append(path)
    }
    let platformRendered = entries[path]?.platformRendered ?? false
    entries[path] = Entry(
      type: type, text: text, accessibilityLabel: accessibilityLabel, virtual: virtual,
      platformRendered: platformRendered)
  }

  func markPlatformRendered(path: String) {
    if entries[path] == nil {
      order.append(path)
      entries[path] = Entry(type: "")
    }
    entries[path]?.platformRendered = true
  }

  func record(path: String, frame: CGRect, content: Bool) {
    if entries[path] == nil {
      // The host's own entries ("host", "host.content") are not nodes and are not in `order`.
      entries[path] = Entry(type: path)
    }
    if content {
      entries[path]?.contentFrame = frame
    } else {
      entries[path]?.frame = frame
    }
  }

  func noteUnsupported(_ kind: String, _ name: String, path: String) {
    let key = "\(kind):\(name)"
    if unsupported[key]?.contains(path) != true {
      unsupported[key, default: []].append(path)
    }
  }
}

/// Records the frame of the view it is the background of. The body runs during layout, so the
/// frame is written as soon as SwiftUI resolves it (preferences do not cross the NSTableView cells
/// that back List and Form on macOS; a side effect does).
private struct FrameRecorder: View {
  let store: FrameStore
  let path: String
  let content: Bool

  var body: some View {
    GeometryReader { proxy in
      let frame = proxy.frame(in: .global)
      let _ = store.record(path: path, frame: frame, content: content)
      Color.clear
    }
  }
}

extension View {
  func recordFrame(_ store: FrameStore, path: String, content: Bool = false) -> some View {
    background(FrameRecorder(store: store, path: path, content: content))
  }
}

/// Builds the SwiftUI tree for the input, the way `@expo/ui`'s Swift views do (see
/// `packages/expo-ui/ios/*View.swift` at sdk-58), with frame recorders on every node.
struct Builder {
  let store: FrameStore

  func build(_ node: Node, path: String) -> AnyView {
    let text = node.type == "Text" ? node.string("text") : nil
    let label = node.modifier("accessibilityLabel")?["label"] as? String
    let virtual = ["Group", "Slot", "Section"].contains(node.type)
    store.register(path: path, type: node.type, text: text, accessibilityLabel: label, virtual: virtual)

    if virtual {
      return applyModifiers(node, to: buildContent(node, path: path), path: path)
    }
    let content = buildContent(node, path: path)
      .recordFrame(store, path: path, content: true)
    return applyModifiers(node, to: AnyView(content), path: path)
      .recordFrame(store, path: path)
      .eraseToAnyView()
  }

  private func children(_ nodes: [Node], path: String) -> some View {
    ForEach(Array(nodes.enumerated()), id: \.offset) { index, child in
      build(child, path: "\(path)/\(index)")
    }
  }

  // MARK: - Components

  private func buildContent(_ node: Node, path: String) -> AnyView {
    switch node.type {
    case "VStack":
      // VStackView.swift: VStack(alignment: ?? .center, spacing:)
      return VStack(alignment: horizontalAlignment(node.string("alignment")), spacing: node.number("spacing").map { CGFloat($0) }) {
        children(node.children, path: path)
      }.eraseToAnyView()
    case "HStack":
      // HStackView.swift: HStack(alignment: ?? .center, spacing:)
      return HStack(alignment: verticalAlignment(node.string("alignment")), spacing: node.number("spacing").map { CGFloat($0) }) {
        children(node.children, path: path)
      }.eraseToAnyView()
    case "ZStack":
      // ZStackView.swift: ZStack(alignment: ?? .center)
      return ZStack(alignment: alignment(node.string("alignment")) ?? .center) {
        children(node.children, path: path)
      }.eraseToAnyView()
    case "Group", "Slot":
      return Group { children(node.children, path: path) }.eraseToAnyView()
    case "Spacer":
      return Spacer(minLength: node.number("minLength").map { CGFloat($0) }).eraseToAnyView()
    case "ScrollView":
      // ScrollViewComponent.swift: ScrollView(axes, showsIndicators:)
      let axes: Axis.Set = switch node.string("axes") {
      case "horizontal": .horizontal
      case "both": [.horizontal, .vertical]
      default: .vertical
      }
      return ScrollView(axes, showsIndicators: node.bool("showsIndicators") ?? true) {
        children(node.children, path: path)
      }.eraseToAnyView()
    case "List":
      return List { children(node.children, path: path) }.eraseToAnyView()
    case "Form":
      // The macOS default form style is `.columns`; iOS forms look like `.grouped`.
      return Form { children(node.children, path: path) }.formStyle(.grouped).eraseToAnyView()
    case "Section":
      return section(node, path: path)
    case "Text":
      return Text(node.string("text") ?? "").eraseToAnyView()
    case "Button":
      return button(node, path: path)
    case "Toggle":
      // Toggle/ToggleView.swift. macOS defaults to a checkbox; iOS to a switch. The `toggleStyle`
      // modifier (applied later) overrides this default.
      let isOn = Binding.constant(node.bool("isOn") ?? false)
      let toggle: AnyView
      if let label = node.string("label") {
        if let systemImage = node.string("systemImage") {
          toggle = Toggle(isOn: isOn) { Label(label, systemImage: systemImage) }.eraseToAnyView()
        } else {
          toggle = Toggle(label, isOn: isOn).eraseToAnyView()
        }
      } else {
        toggle = Toggle(isOn: isOn) { children(node.children, path: path) }.eraseToAnyView()
      }
      return node.modifier("toggleStyle") == nil ? toggle.toggleStyle(.switch).eraseToAnyView() : toggle
    case "Slider":
      // SliderView.swift: Slider(value:in:step:)
      let min = node.number("min") ?? 0
      let max = node.number("max") ?? 1
      let value = Binding.constant(node.number("value") ?? min)
      if let step = node.number("step"), step > 0 {
        return Slider(value: value, in: min...max, step: step).eraseToAnyView()
      }
      return Slider(value: value, in: min...max).eraseToAnyView()
    case "Picker":
      return picker(node, path: path)
    case "TextField", "SecureField":
      let placeholder = node.string("placeholder") ?? ""
      let text = Binding.constant(node.string("text") ?? node.string("defaultValue") ?? "")
      if node.type == "SecureField" {
        return SecureField(placeholder, text: text).eraseToAnyView()
      }
      return TextField(placeholder, text: text).eraseToAnyView()
    case "Image":
      if let systemName = node.string("systemName") {
        return Image(systemName: systemName).eraseToAnyView()
      }
      store.noteUnsupported("prop", "Image without systemName", path: path)
      return EmptyView().eraseToAnyView()
    case "Divider":
      return Divider().eraseToAnyView()
    case "Label":
      let title = node.string("title") ?? ""
      if let systemImage = node.string("systemImage") {
        return Label(title, systemImage: systemImage).eraseToAnyView()
      }
      // Label.swift: no icon -> .titleOnly
      return Label(title, systemImage: "").labelStyle(.titleOnly).eraseToAnyView()
    default:
      store.noteUnsupported("type", node.type, path: path)
      return EmptyView().eraseToAnyView()
    }
  }

  private func section(_ node: Node, path: String) -> AnyView {
    // SectionView.swift: Section(title) { content }, or header/footer slots.
    let content = node.contentChildren
    let header = node.slot("header")
    let footer = node.slot("footer")
    // Slot children keep their index among the Section's children in the path.
    func slotPath(_ name: String) -> String {
      let index = node.children.firstIndex { $0.type == "Slot" && $0.string("name") == name } ?? 0
      return "\(path)/\(index)"
    }
    let contentPath = node.slot("content") != nil ? slotPath("content") : path
    if let title = node.string("title"), !title.isEmpty {
      return Section(title) { children(content, path: contentPath) }.eraseToAnyView()
    }
    return Section {
      children(content, path: contentPath)
    } header: {
      if let header { children(header, path: slotPath("header")) }
    } footer: {
      if let footer { children(footer, path: slotPath("footer")) }
    }.eraseToAnyView()
  }

  private func button(_ node: Node, path: String) -> AnyView {
    // Button/Button.swift: Button(label, systemImage:, role:) or Button(role:, action:) { children }
    let role: ButtonRole? = switch node.string("role") {
    case "destructive": .destructive
    case "cancel": .cancel
    default: nil
    }
    if let label = node.string("label") {
      if let systemImage = node.string("systemImage") {
        return Button(role: role, action: {}) { Label(label, systemImage: systemImage) }.eraseToAnyView()
      }
      return Button(label, role: role, action: {}).eraseToAnyView()
    }
    return Button(role: role, action: {}) { children(node.children, path: path) }.eraseToAnyView()
  }

  private func picker(_ node: Node, path: String) -> AnyView {
    // Picker/PickerView.swift: Picker(label, selection:) { content }. Options are the content
    // children with a `tag` modifier (tags are compared as strings here).
    let options = node.contentChildren
    let selection = Binding.constant(node.props["selection"].map { "\($0)" } ?? "")
    let contentPath = node.slot("content") != nil
      ? "\(path)/\(node.children.firstIndex { $0.type == "Slot" && $0.string("name") == "content" } ?? 0)"
      : path
    for index in options.indices {
      store.markPlatformRendered(path: "\(contentPath)/\(index)")
    }
    let content = ForEach(Array(options.enumerated()), id: \.offset) { index, option in
      build(option, path: "\(contentPath)/\(index)")
        .tag(option.modifier("tag").flatMap { $0["tag"] }.map { "\($0)" } ?? "\(index)")
    }
    let picker = Picker(node.string("label") ?? "", selection: selection) { content }
    switch node.modifier("pickerStyle")?["style"] as? String {
    case "segmented": return picker.pickerStyle(.segmented).eraseToAnyView()
    case "menu": return picker.pickerStyle(.menu).eraseToAnyView()
    case "inline": return picker.pickerStyle(.inline).eraseToAnyView()
    #if os(macOS)
    case "radioGroup": return picker.pickerStyle(.radioGroup).eraseToAnyView()
    #endif
    default: return picker.eraseToAnyView()
    }
  }

  // MARK: - Modifiers

  private func applyModifiers(_ node: Node, to view: AnyView, path: String) -> AnyView {
    node.modifiers.reduce(view) { view, params in
      let type = params["$type"] as? String ?? ""
      switch type {
      case "padding":
        return padding(params, view)
      case "frame":
        return frame(params, view)
      case "fixedSize":
        // ViewModifierRegistry.swift FixedSizeModifier
        let h = params["horizontal"] as? Bool
        let v = params["vertical"] as? Bool
        if h == nil && v == nil {
          return view.fixedSize().eraseToAnyView()
        }
        return view.fixedSize(horizontal: h ?? false, vertical: v ?? false).eraseToAnyView()
      case "layoutPriority":
        return view.layoutPriority(parseNumber(params["priority"]) ?? 0).eraseToAnyView()
      case "offset":
        return view.offset(x: CGFloat(parseNumber(params["x"]) ?? 0), y: CGFloat(parseNumber(params["y"]) ?? 0)).eraseToAnyView()
      case "background":
        return view.background(shapeStyleColor(params["style"]) ?? .clear).eraseToAnyView()
      case "cornerRadius":
        return view.cornerRadius(CGFloat(parseNumber(params["radius"]) ?? 0)).eraseToAnyView()
      case "hidden":
        return (params["hidden"] as? Bool ?? true) ? view.hidden().eraseToAnyView() : view
      case "font":
        return view.font(font(params)).eraseToAnyView()
      case "accessibilityLabel":
        return view.accessibilityLabel(Text(params["label"] as? String ?? "")).eraseToAnyView()
      case "toggleStyle":
        switch params["style"] as? String {
        case "switch": return view.toggleStyle(.switch).eraseToAnyView()
        case "button": return view.toggleStyle(.button).eraseToAnyView()
        default: return view.toggleStyle(.automatic).eraseToAnyView()
        }
      case "buttonStyle":
        switch params["style"] as? String {
        case "bordered": return view.buttonStyle(.bordered).eraseToAnyView()
        case "borderedProminent": return view.buttonStyle(.borderedProminent).eraseToAnyView()
        case "borderless": return view.buttonStyle(.borderless).eraseToAnyView()
        case "plain": return view.buttonStyle(.plain).eraseToAnyView()
        default: return view
        }
      case "pickerStyle", "tag":
        // Applied by the Picker builder.
        return view
      default:
        store.noteUnsupported("modifier", type, path: path)
        return view
      }
    }
  }

  /// ViewModifierRegistry.swift PaddingModifier: edge > horizontal/vertical > all; no values ->
  /// `.padding()`; `'default'` edges get the system padding.
  private func padding(_ params: [String: Any], _ view: AnyView) -> AnyView {
    func value(_ key: String) -> Any? { params[key] }
    func resolve(_ edge: String, _ axis: String) -> Any? {
      value(edge) ?? value(axis) ?? value("all")
    }
    let edges: [(Edge.Set, Any?)] = [
      (.top, resolve("top", "vertical")),
      (.leading, resolve("leading", "horizontal")),
      (.bottom, resolve("bottom", "vertical")),
      (.trailing, resolve("trailing", "horizontal")),
    ]
    if edges.allSatisfy({ $0.1 == nil }) {
      return view.padding().eraseToAnyView()
    }
    var insets = EdgeInsets()
    var defaults: Edge.Set = []
    for (edge, raw) in edges {
      guard let raw else { continue }
      if raw as? String == "default" {
        defaults.insert(edge)
        continue
      }
      let length = CGFloat(parseNumber(raw) ?? 0)
      switch edge {
      case .top: insets.top = length
      case .leading: insets.leading = length
      case .bottom: insets.bottom = length
      default: insets.trailing = length
      }
    }
    let padded = view.padding(insets)
    return defaults.isEmpty ? padded.eraseToAnyView() : padded.padding(defaults).eraseToAnyView()
  }

  /// ViewModifierRegistry.swift FrameModifier: width/height form if either is set, else the
  /// flexible form. Default alignment `.center`.
  private func frame(_ params: [String: Any], _ view: AnyView) -> AnyView {
    func length(_ key: String) -> CGFloat? { parseNumber(params[key]).map { CGFloat($0) } }
    let align = alignment(params["alignment"] as? String) ?? .center
    if length("width") != nil || length("height") != nil {
      return view.frame(width: length("width"), height: length("height"), alignment: align).eraseToAnyView()
    }
    return view.frame(
      minWidth: length("minWidth"),
      idealWidth: length("idealWidth"),
      maxWidth: length("maxWidth"),
      minHeight: length("minHeight"),
      idealHeight: length("idealHeight"),
      maxHeight: length("maxHeight"),
      alignment: align
    ).eraseToAnyView()
  }

  private func font(_ params: [String: Any]) -> Font {
    let weight: Font.Weight? = switch params["weight"] as? String {
    case "ultraLight": .ultraLight
    case "thin": .thin
    case "light": .light
    case "regular": .regular
    case "medium": .medium
    case "semibold": .semibold
    case "bold": .bold
    case "heavy": .heavy
    case "black": .black
    default: nil
    }
    let design: Font.Design = switch params["design"] as? String {
    case "rounded": .rounded
    case "serif": .serif
    case "monospaced": .monospaced
    default: .default
    }
    var font: Font
    if let family = params["family"] as? String, let size = parseNumber(params["size"]) {
      font = .custom(family, size: size)
    } else if let size = parseNumber(params["size"]) {
      font = .system(size: size, design: design)
    } else {
      let style: Font.TextStyle = switch params["textStyle"] as? String {
      case "largeTitle": .largeTitle
      case "title": .title
      case "title2": .title2
      case "title3": .title3
      case "headline": .headline
      case "subheadline": .subheadline
      case "callout": .callout
      case "footnote": .footnote
      case "caption": .caption
      case "caption2": .caption2
      default: .body
      }
      font = .system(style, design: design)
    }
    if let weight {
      font = font.weight(weight)
    }
    return font
  }
}

// MARK: - Helpers

extension View {
  func eraseToAnyView() -> AnyView { AnyView(self) }
}

func horizontalAlignment(_ value: String?) -> HorizontalAlignment {
  switch value {
  case "leading": .leading
  case "trailing": .trailing
  default: .center
  }
}

func verticalAlignment(_ value: String?) -> VerticalAlignment {
  switch value {
  case "top": .top
  case "bottom": .bottom
  case "firstTextBaseline": .firstTextBaseline
  case "lastTextBaseline": .lastTextBaseline
  default: .center
  }
}

/// AlignmentOptions.swift names.
func alignment(_ value: String?) -> Alignment? {
  switch value {
  case "center": .center
  case "leading": .leading
  case "trailing": .trailing
  case "top": .top
  case "bottom": .bottom
  case "topLeading": .topLeading
  case "topTrailing": .topTrailing
  case "bottomLeading": .bottomLeading
  case "bottomTrailing": .bottomTrailing
  case "centerFirstTextBaseline": .centerFirstTextBaseline
  case "centerLastTextBaseline": .centerLastTextBaseline
  case "leadingFirstTextBaseline": .leadingFirstTextBaseline
  case "leadingLastTextBaseline": .leadingLastTextBaseline
  case "trailingFirstTextBaseline": .trailingFirstTextBaseline
  case "trailingLastTextBaseline": .trailingLastTextBaseline
  default: nil
  }
}

/// `background(style)`: `@expo/ui` sends `{style: {type: 'color', color}}`
/// (`modifiers/shapeStyle.ts` `resolveShapeStyle`). A bare color string is accepted too.
func shapeStyleColor(_ value: Any?) -> Color? {
  if let style = value as? [String: Any] {
    return color(style["color"])
  }
  return color(value)
}

func color(_ value: Any?) -> Color? {
  guard let string = value as? String else { return nil }
  switch string {
  case "primary": return .primary
  case "secondary": return .secondary
  case "red": return .red
  case "orange": return .orange
  case "yellow": return .yellow
  case "green": return .green
  case "blue": return .blue
  case "purple": return .purple
  case "pink": return .pink
  case "white": return .white
  case "gray": return .gray
  case "black": return .black
  case "clear": return .clear
  case "mint": return .mint
  case "teal": return .teal
  case "cyan": return .cyan
  case "indigo": return .indigo
  case "brown": return .brown
  default: break
  }
  var hex = string.hasPrefix("#") ? String(string.dropFirst()) : string
  if hex.count == 3 {
    hex = hex.map { "\($0)\($0)" }.joined()
  }
  guard hex.count == 6 || hex.count == 8, let value = UInt64(hex, radix: 16) else { return nil }
  let hasAlpha = hex.count == 8
  let r = Double((value >> (hasAlpha ? 24 : 16)) & 0xFF) / 255
  let g = Double((value >> (hasAlpha ? 16 : 8)) & 0xFF) / 255
  let b = Double((value >> (hasAlpha ? 8 : 0)) & 0xFF) / 255
  let a = hasAlpha ? Double(value & 0xFF) / 255 : 1
  return Color(red: r, green: g, blue: b, opacity: a)
}
