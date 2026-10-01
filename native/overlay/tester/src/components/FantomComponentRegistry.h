#pragma once

#include <memory>
#include <mutex>
#include <react/renderer/componentregistry/ComponentDescriptorRegistry.h>

namespace facebook::react {

// The renderer owns the registry. NativeFantom only probes it while alive.
struct FantomComponentRegistry {
  std::mutex mutex;
  std::weak_ptr<const ComponentDescriptorRegistry> registry;
};

inline FantomComponentRegistry& fantomComponentRegistry() {
  static FantomComponentRegistry state;
  return state;
}

} // namespace facebook::react
