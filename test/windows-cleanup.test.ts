import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PassThrough, Writable} from 'node:stream';
import {afterAll, afterEach, beforeAll, expect, it, vi} from 'vitest';
import {runHost} from '../packages/react-native-a11y-tree/src/host.ts';
import {runSession} from '../packages/react-native-a11y-tree/src/session.ts';
import * as cleanup from '../packages/react-native-a11y-tree/src/processCleanup.ts';

const WINDOWS = process.platform === 'win32';
const TEST = {timeout:15_000};
let directory: string;
let fixture: string;
const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
beforeAll(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'windows-cleanup-'));
  const worker = path.join(directory, 'worker.cjs');
  fs.writeFileSync(worker, String.raw`
    const fs=require('node:fs');
    fs.appendFileSync(process.env.TEST_WINDOWS_PIDS,process.pid+'\n');
    if(process.argv[2]==='1') {
      const child=require('node:child_process').spawn(process.execPath,[__filename,'2'],{stdio:['ignore','inherit','inherit','ipc']});
      child.once('message',()=>process.send('ready'));
    } else process.send('ready');
    setInterval(()=>{},1000);
  `);
  fixture = path.join(directory, 'runner.cjs');
  fs.writeFileSync(fixture, String.raw`
    const fs=require('node:fs');
    const mode=process.env.TEST_WINDOWS_MODE;
    fs.appendFileSync(process.env.TEST_WINDOWS_PIDS,process.pid+'\n');
    const child=require('node:child_process').spawn(process.execPath,[process.env.TEST_WINDOWS_WORKER,'1'],{stdio:['ignore','inherit','inherit','ipc']});
    const ready=new Promise(resolve=>child.once('message',()=>{
      fs.writeFileSync(process.env.TEST_WINDOWS_READY,'ready');
      if(mode==='result') console.log(JSON.stringify({type:'rn-a11y-tree-result',rnA11yTree:{done:true}}));
      if(mode==='root-gone') process.exit(0);
      if(mode==='overflow') {
        let sent=0; const chunk=Buffer.alloc(65536,120);
        const pump=()=>{while(sent<40*1024*1024){sent+=chunk.length;if(!process.stderr.write(chunk)){process.stderr.once('drain',pump);return;}}}; pump();
      }
      resolve();
    }));
    let buffer=Buffer.alloc(0),evalId=0,chain=Promise.resolve();
    process.stdin.on('data',chunk=>{
      buffer=Buffer.concat([buffer,chunk]);
      for(;;){
        const newline=buffer.indexOf(10);if(newline<0)return;
        const size=Number(buffer.subarray(0,newline).toString());if(buffer.length<newline+1+size)return;
        const code=buffer.subarray(newline+1,newline+1+size).toString();buffer=buffer.subarray(newline+1+size);
        const match=/request\(("(?:[^"\\]|\\.)*")\)/.exec(code);
        const request=JSON.parse(JSON.parse(match[1]));
        chain=chain.then(async()=>{
          await ready;
          if(!request.start&&!request.quit)return;
          console.log(JSON.stringify({type:'rn-a11y-tree-response',id:request.id,ok:true,...(request.start?{ready:true,hostInfo:{protocolVersion:1}}:{quit:true})}));
          console.log(JSON.stringify({type:'repl-eval-complete',id:evalId++}));
        });
      }
    });
    setInterval(()=>{},1000);
  `);
  vi.stubEnv('TEST_WINDOWS_WORKER',worker);
});
afterEach(() => {Object.defineProperty(process,'platform',platformDescriptor); vi.restoreAllMocks(); vi.unstubAllEnvs();});
afterAll(() => fs.rmSync(directory,{recursive:true,force:true}));

function prepare(mode: string) {
  const pidFile=path.join(directory,`${mode}-pids`),ready=path.join(directory,`${mode}-ready`);
  fs.writeFileSync(pidFile,''); fs.rmSync(ready,{force:true});
  vi.stubEnv('TEST_WINDOWS_PIDS',pidFile);
  vi.stubEnv('TEST_WINDOWS_READY',ready);
  vi.stubEnv('TEST_WINDOWS_MODE',mode);
  vi.stubEnv('TEST_WINDOWS_WORKER',path.join(directory,'worker.cjs'));
  vi.stubEnv('RN_A11Y_HOST_BIN',fixture);
  vi.stubEnv('RN_A11Y_HOST_RUNNER',process.execPath);
  vi.stubEnv('RN_A11Y_HOST_STDERR_LOG','');
  const pids=()=>fs.readFileSync(pidFile,'utf8').trim().split('\n').filter(Boolean).map(Number);
  const dispose=()=>{for(const pid of pids()){try{process.kill(pid,'SIGKILL');}catch{}}};
  return {pids,dispose,ready};
}
function alive(pid: number) {
  try {process.kill(pid,0);return true;} catch(error) {
    if((error as NodeJS.ErrnoException).code==='ESRCH')return false;
    throw error;
  }
}

// These exercise the integrations on every OS using a fake cleanup operation;
// real taskkill/tree-death assertions below run only on Windows CI.
it.each([['host','timeout'],['session','timeout'],['host','cancel'],['session','cancel']] as const)('preserves %s %s and waits for cleanup failure metadata', TEST, async (kind,mode) => {
  const test=prepare(`mock-${kind}-${mode}`);
  Object.defineProperty(process,'platform',{...platformDescriptor,value:'win32'});
  let completed=false;
  const terminate=vi.spyOn(cleanup,'terminateWindowsTree').mockImplementation(async child=>{
    child.kill('SIGKILL');
    // Close inherited pipes before helper completion to prove callers await it.
    for(const pid of test.pids()){if(pid!==child.pid){try{process.kill(pid,'SIGKILL');}catch{}}}
    await new Promise(resolve=>setTimeout(resolve,75));
    completed=true;
    return {cleanupIncomplete:true,cleanupReason:'taskkill-failed',cleanupExitCode:5};
  });
  const input=new PassThrough(); const records:any[]=[];
  const output=new Writable({write(chunk,_encoding,done){const record=JSON.parse(chunk.toString());records.push(record);done();if(record.ready)setImmediate(()=>{if(mode==='cancel')process.emit('SIGINT');else input.write('{"id":17,"tree":true}\n');});}});
  try {
    if(kind==='host') {
      const controller=new AbortController();
      const pending=runHost({bundlePath:'unused',timeoutMs:3000,signal:controller.signal,quiet:true}).catch(error=>error);
      if(mode==='cancel'){await vi.waitFor(()=>expect(fs.existsSync(test.ready)).toBe(true),{timeout:2500});controller.abort();}
      const result=await pending;
      expect(result).toMatchObject({code:mode==='timeout'?'TIMEOUT':'HOST_CRASHED',details:{cleanupIncomplete:true,cleanupReason:'taskkill-failed',cleanupExitCode:5,...(mode==='cancel'?{cancelled:true}:{})}});
    } else {
      const code=await runSession({bundlePath:'unused',windowWidth:300,windowHeight:600,timeoutMs:3000,quiet:true,io:{input,output,log:()=>{}}});
      expect(code).toBe(5);
      expect(records.at(-1)).toMatchObject({id:mode==='timeout'?17:null,error:{code:mode==='timeout'?'TIMEOUT':'HOST_CRASHED',details:{cleanupIncomplete:true,cleanupReason:'taskkill-failed',cleanupExitCode:5,...(mode==='cancel'?{cancelled:true}:{})}}});
    }
    expect(completed).toBe(true);
    expect(terminate).toHaveBeenCalledOnce();
  } finally {test.dispose();input.destroy();output.destroy();}
});

it.skipIf(!WINDOWS).each(['timeout','result','cancel','overflow'])('real Windows taskkill reaps runner/worker/grandchild on %s', TEST, async mode => {
  const test=prepare(mode);const controller=new AbortController();
  try {
    const pending=runHost({bundlePath:'unused',timeoutMs:3000,signal:controller.signal,quiet:true}).catch(error=>error);
    if(mode==='cancel') {await vi.waitFor(()=>expect(fs.existsSync(test.ready)).toBe(true),{timeout:2500});controller.abort();}
    const result=await pending;
    expect(result.code).toBe(mode==='timeout'||mode==='result'?'TIMEOUT':'HOST_CRASHED');
    if(mode==='cancel')expect(result.details.cancelled).toBe(true);
    if(mode==='overflow')expect(result.details.outputLimit).toBe(true);
    expect(result.details.cleanupIncomplete).not.toBe(true);
    expect(test.pids()).toHaveLength(3);
    // Assert death before defensive cleanup; bounded return alone is not proof.
    await vi.waitFor(()=>expect(test.pids().some(alive)).toBe(false),{timeout:1500});
  } finally {test.dispose();}
});

it.skipIf(!WINDOWS).each(['timeout','quit','cancel'])('real Windows session cleans descendants on %s', TEST, async mode => {
  const test=prepare(`session-${mode}`); const input=new PassThrough();const records:any[]=[];
  const output=new Writable({write(chunk,_encoding,done){const record=JSON.parse(chunk.toString());records.push(record);done();if(record.ready)setImmediate(()=>{
    if(mode==='cancel')process.emit('SIGTERM');
    else input.write(JSON.stringify({id:19,...(mode==='quit'?{quit:true}:{tree:true})})+'\n');
  });}});
  try {
    expect(await runSession({bundlePath:'unused',windowWidth:300,windowHeight:600,timeoutMs:3000,quiet:true,io:{input,output,log:()=>{}}})).toBe(5);
    expect(records.at(-1).error.code).toBe(mode==='timeout'?'TIMEOUT':'HOST_CRASHED');
    expect(records.at(-1).error.details?.cleanupIncomplete).not.toBe(true);
    expect(test.pids()).toHaveLength(3);
    await vi.waitFor(()=>expect(test.pids().some(alive)).toBe(false),{timeout:1500});
  } finally {test.dispose();input.destroy();output.destroy();}
});

it.skipIf(!WINDOWS)('reports the already-exited-root limitation instead of claiming tree cleanup', TEST, async()=>{
  const test=prepare('root-gone');
  try {
    const result=await runHost({bundlePath:'unused',timeoutMs:3000,quiet:true}).catch(error=>error);
    expect(result).toMatchObject({code:'TIMEOUT',details:{cleanupIncomplete:true,cleanupReason:'root-exited'}});
    expect(test.pids()).toHaveLength(3);
  } finally {test.dispose();}
});
