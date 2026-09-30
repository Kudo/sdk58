// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "swiftui-ref",
  platforms: [.macOS("13.4")],
  targets: [
    .executableTarget(name: "swiftui-ref", path: "Sources/swiftui-ref")
  ]
)
