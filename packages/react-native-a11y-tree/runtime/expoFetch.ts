/** Metro substitute for expo/fetch: its native module is unavailable in the headless host. */
export {bridgeFetch as fetch} from './network';
