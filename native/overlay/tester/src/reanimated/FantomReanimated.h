/*
 * rn-a11y: reanimated
 *
 * Hooks that connect react-native-reanimated and react-native-worklets to the
 * Fantom tester. This header has no library includes, so the tester files that
 * call the hooks do not need the library include paths.
 *
 * Thread model: the Fantom main thread is the JS thread and also the "UI
 * thread" of the worklets UI runtime. Frames are produced only by the hooks
 * below (produceFramesForDuration steps and the end of every work loop).
 */

#pragma once

#include <functional>
#include <memory>
#include <string>

namespace facebook::react {

class CallInvoker;
class ComponentDescriptorProviderRegistry;
class TurboModule;

namespace fantom_reanimated {

// Sets the animation clock (milliseconds). The tester passes StubClock, so
// `produceFramesForDuration` moves animation time.
void setClock(std::function<double()> nowMs);

// Returns the C++ TurboModules `WorkletsModule` and `ReanimatedModule`, or
// nullptr for other names.
std::shared_ptr<TurboModule> getTurboModule(
    const std::string &name,
    const std::shared_ptr<CallInvoker> &jsInvoker);

// Registers REASharedTransitionBoundary.
void registerComponentDescriptors(ComponentDescriptorProviderRegistry &registry);

// True after the JS bundle has installed the worklets module.
bool isActive();

// Runs one frame at the current clock time: drains queued UI jobs, runs the
// worklets `requestAnimationFrame` callbacks and the reanimated
// `requestRender` callbacks with the frame timestamp, then calls
// `ReanimatedModuleProxy::performOperations` (which commits the animated
// props to the shadow tree). No-op before `isActive()`.
void produceFrame();

} // namespace fantom_reanimated

} // namespace facebook::react
