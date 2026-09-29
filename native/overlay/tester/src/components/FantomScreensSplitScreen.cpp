/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "FantomScreens.h"

#ifdef FANTOM_WITH_RNSCREENS
#include <react/renderer/components/rnscreens/RNSSplitScreenComponentDescriptor.h>
#endif

namespace facebook::react {

void registerScreensSplitScreenComponentDescriptor(
    const std::shared_ptr<ComponentDescriptorProviderRegistry>&
        providerRegistry) {
#ifdef FANTOM_WITH_RNSCREENS
  providerRegistry->add(
      concreteComponentDescriptorProvider<RNSSplitScreenComponentDescriptor>());
#else
  (void)providerRegistry;
#endif
}

} // namespace facebook::react
