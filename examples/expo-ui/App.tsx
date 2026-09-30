import {Platform} from 'react-native';

import SwiftUIScreen from './SwiftUIScreen';
import UniversalScreen from './UniversalScreen';

/**
 * `--platform android` (e.g. `--preset android-phone`): universal @expo/ui
 * (Compose views). Other platforms: the @expo/ui/swift-ui screen. Render
 * SwiftUIScreen.tsx directly to get the SwiftUI views with `--platform android`.
 */
export default function App() {
  return Platform.OS === 'android' ? <UniversalScreen /> : <SwiftUIScreen />;
}
