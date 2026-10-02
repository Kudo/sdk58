// Explicit deterministic palette for the Android NativeTabs JS defaults.
// This does not resolve Android device themes, draw tabs, or emit native events.
const colors: Record<string, string> = {
  onsurfacevariant: '#49454F',
  onsurface: '#1D1B20',
  onsecondarycontainer: '#1D192B',
  surfacecontainer: '#F3EDF7',
  primary: '#6750A4',
  secondarycontainer: '#E8DEF8',
};
function fixtureColor(name: string) {
  const value = colors[name.toLowerCase()];
  if (!value) throw new Error(`Router palette fixture does not implement ${name}`);
  return value;
}
export default {
  expoModules: {
    ExpoRouter: {Material3Color: fixtureColor, Material3DynamicColor: fixtureColor},
  },
};
