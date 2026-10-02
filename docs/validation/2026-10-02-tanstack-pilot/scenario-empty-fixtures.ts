// Copied to the temporary app root; upstream source files remain unchanged.
import {AppState, DeviceEventEmitter} from 'react-native';
import movies from './src/data/movies.json';
import nativeFixtures from './pilot-fixtures';

console.warn('[APPLICATION_FIXTURE] pilot/movies-data: clearing then restoring the shared bundled JSON array; no HTTP or API implementation replacement.');
console.warn('[APPLICATION_FIXTURE] pilot/app-state: injecting JS AppState notifications; OS lifecycle delivery is not tested.');
const original = movies.slice();
movies.splice(0);
console.log('PILOT_DATA_EMPTY');

setTimeout(() => {
  movies.push(...original);
  console.log('PILOT_DATA_RESTORED');
  const states: string[] = [];
  const subscription = AppState.addEventListener('change', state => states.push(state));
  DeviceEventEmitter.emit('appStateDidChange', {app_state: 'background'});
  DeviceEventEmitter.emit('appStateDidChange', {app_state: 'active'});
  subscription.remove();
  if (states.join(',') !== 'background,active' || AppState.currentState !== 'active') {
    throw new Error('Pilot AppState event contract did not deliver background/active');
  }
  console.log('PILOT_APPSTATE_CONTRACT_VERIFIED');
}, 6000);

export default nativeFixtures;
