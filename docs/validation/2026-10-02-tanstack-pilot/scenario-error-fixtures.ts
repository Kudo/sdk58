// Copied to the temporary app root; upstream source files remain unchanged.
import {AppState, DeviceEventEmitter} from 'react-native';
import movies from './src/data/movies.json';
import nativeFixtures from './pilot-fixtures';

console.warn('[APPLICATION_FIXTURE] pilot/movies-data: removing a listed movie then restoring the bundled JSON array; real query functions and retries remain unchanged.');
console.warn('[APPLICATION_FIXTURE] pilot/app-state: injecting JS AppState notifications; OS lifecycle delivery is not tested.');
const original = movies.slice();
// Initial list query resolves within 2199 ms. Its title/year objects are copies.
setTimeout(() => {
  const index = movies.findIndex(movie => movie.title === 'Rush');
  if (index < 0) throw new Error('Pilot expected Rush in the original dataset');
  movies.splice(index, 1);
  console.log('PILOT_RUSH_REMOVED');
}, 2600);

setTimeout(() => {
  movies.splice(0, movies.length, ...original);
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
}, 20000);

export default nativeFixtures;
