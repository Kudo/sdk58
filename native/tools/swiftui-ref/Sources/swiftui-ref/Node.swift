import Foundation

/// One node of the input tree: an `@expo/ui` SwiftUI component with its props, modifiers and
/// children, in the shape the host sees (`type` is the `@expo/ui` component name, props and
/// modifier params use the `@expo/ui` names).
struct Node {
  let type: String
  let props: [String: Any]
  let modifiers: [[String: Any]]
  let children: [Node]

  init(json: [String: Any]) throws {
    guard let type = json["type"] as? String else {
      throw InputError("node without a string \"type\": \(json)")
    }
    self.type = type
    self.props = json["props"] as? [String: Any] ?? [:]
    self.modifiers = json["modifiers"] as? [[String: Any]] ?? []
    self.children = try (json["children"] as? [[String: Any]] ?? []).map { try Node(json: $0) }
  }

  func string(_ key: String) -> String? {
    props[key] as? String
  }

  func number(_ key: String) -> Double? {
    parseNumber(props[key])
  }

  func bool(_ key: String) -> Bool? {
    props[key] as? Bool
  }

  /// Children of a `Slot` child with this name (`@expo/ui` wraps named children in
  /// `<Slot name="...">`, e.g. Section `header`/`footer`/`content`, Picker `content`).
  func slot(_ name: String) -> [Node]? {
    children.first { $0.type == "Slot" && $0.string("name") == name }?.children
  }

  /// Children that are not in a named slot, plus the children of a `content` slot.
  var contentChildren: [Node] {
    if let content = slot("content") {
      return content
    }
    return children.filter { $0.type != "Slot" }
  }

  func modifier(_ type: String) -> [String: Any]? {
    modifiers.last { $0["$type"] as? String == type }
  }
}

/// Numbers from JSON. JSON has no `Infinity`, so `"infinity"` / `"Infinity"` (and any value
/// >= 1e9) mean `.infinity`, the value `@expo/ui` gets from JS `Infinity` over JSI.
func parseNumber(_ value: Any?) -> Double? {
  if let value = value as? Double {
    return value >= 1e9 ? .infinity : value
  }
  if let value = value as? Int {
    return Double(value)
  }
  if let value = value as? String, value.lowercased() == "infinity" {
    return .infinity
  }
  return nil
}

struct InputError: Error, CustomStringConvertible {
  let description: String
  init(_ description: String) {
    self.description = description
  }
}
