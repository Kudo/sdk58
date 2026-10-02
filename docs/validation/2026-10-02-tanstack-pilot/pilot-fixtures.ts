// Explicit fixed connectivity; no network probes or connectivity transitions.
export default {turboModules:{RNCNetInfo:{
 configure() {},
 getCurrentState: async () => ({type:'wifi',isConnected:true,isInternetReachable:true,details:{isConnectionExpensive:false}}),
 addListener(event: string) {if(event!=='netInfo.networkStatusDidChange')throw new Error('Unexpected NetInfo event: '+event);},
 removeListeners(count: number) {if(!Number.isInteger(count)||count<0)throw new Error('Invalid listener count');}
}}};
