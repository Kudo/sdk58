// swiftui-ref: reads an `@expo/ui` SwiftUI tree as JSON on stdin, lays it out with real SwiftUI
// inside a copy of `@expo/ui`'s `HostView`, and prints the frames as JSON on stdout.
// See README.md for the input and output formats.
//
// macOS: this file. iOS (simulator app): IOSApp.swift, built by scripts/run-ios.sh.

#if os(macOS)
import AppKit
import SwiftUI

MainActor.assumeIsolated {
  let (root, options) = parseInput(FileHandle.standardInput.readDataToEndOfFile())

  let app = NSApplication.shared
  app.setActivationPolicy(.prohibited)

  let store = FrameStore()
  let builder = Builder(store: store)
  let content = HostContent(options: options, root: builder.build(root, path: "0"), store: store)

  let size = NSSize(width: options.width, height: options.height)
  let hosting = NSHostingView(rootView: content)
  hosting.frame = NSRect(origin: .zero, size: size)
  // A borderless window far offscreen: List/Form (NSTableView) only lay out their rows inside a
  // window on screen.
  let window = NSWindow(
    contentRect: NSRect(x: -10000, y: -10000, width: size.width, height: size.height),
    styleMask: [.borderless],
    backing: .buffered,
    defer: false
  )
  window.contentView = hosting
  window.orderFrontRegardless()
  hosting.layoutSubtreeIfNeeded()
  // Let deferred work (table rows, geometry updates) run, then lay out again.
  for _ in 0..<5 {
    RunLoop.main.run(until: Date().addingTimeInterval(0.02))
    hosting.layoutSubtreeIfNeeded()
    window.displayIfNeeded()
  }

  FileHandle.standardOutput.write(jsonData(makeOutput(store: store, options: options, fittingSize: hosting.fittingSize)))
  FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}
#else
import UIKit

UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(RefAppDelegate.self))
#endif
