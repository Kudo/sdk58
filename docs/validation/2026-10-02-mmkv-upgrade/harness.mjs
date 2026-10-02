// Run from the repository root: node docs/validation/2026-10-02-mmkv-upgrade/harness.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root = process.cwd();
const out = path.dirname(fileURLToPath(import.meta.url));
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mmkv-upgrade-')));
const host = process.env.RN_A11Y_HOST_BIN || path.join(root, 'native/dist', process.arch === 'x64' ? 'x86_64' : process.arch, process.platform === 'win32' ? 'rn-a11y-host.exe' : 'rn-a11y-host');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function sourceSnapshot() {
 const paths = [];
 function walk(dir) {for(const entry of fs.readdirSync(path.join(root,dir),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const name=path.posix.join(dir,entry.name);if(entry.isDirectory())walk(name);else if(entry.isFile())paths.push(name);}}
 for(const dir of ['packages/react-native-a11y-tree/src','packages/react-native-a11y-tree/runtime'])walk(dir);
 const files=Object.fromEntries(paths.sort().map(file=>[file,hash(fs.readFileSync(path.join(root,file)))]));
 return {capturedAt:new Date().toISOString(),head:command('git',['rev-parse','HEAD']).stdout.trim(),worktreeStatus:command('git',['status','--porcelain=v1']).stdout.trim(),scope:['packages/react-native-a11y-tree/src','packages/react-native-a11y-tree/runtime'],sha256:hash(JSON.stringify(files)),files};
}
async function fetchChecked(url, asJSON) {
 const response=await fetch(url,{signal:AbortSignal.timeout(30_000)});
 if(!response.ok)throw new Error(`HTTP ${response.status} fetching ${url}`);
 return asJSON ? response.json() : Buffer.from(await response.arrayBuffer());
}
const evidence = {startedAt: new Date().toISOString(), head: spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim(), platform:process.platform, arch:process.arch, node:process.version, host:{path:host,sha256:hash(fs.readFileSync(host))}, isolation:'Separate temporary app directories; unchanged dependencies symlinked to installed workspace packages. Only MMKV tarball differs. No package manager install.', sourceAtStart:sourceSnapshot(), copiedFiles:{}, packages:[], runs:[]};
const cli = path.join(root,'packages/react-native-a11y-tree/src/cli.ts');
const files=['App.tsx','fixtures.ts','actions.json','empty-fixtures.ts'];
for(const f of files) evidence.copiedFiles[f]=hash(fs.readFileSync(path.join(root,'examples/nitro-fixture',f)));
function command(program,args,options={}){
 const p=spawnSync(program,args,{encoding:'utf8',timeout:120000,killSignal:'SIGKILL',maxBuffer:64*1024*1024,...options});
 if(p.error || p.signal) throw new Error(JSON.stringify({program,args,error:p.error?.message,signal:p.signal,stderr:p.stderr}));
 return p;
}
function find(tree,id){if(tree?.testID===id)return tree; for(const c of tree?.children??[]){const found=find(c,id); if(found)return found;} if(Array.isArray(tree))for(const c of tree){const found=find(c,id);if(found)return found;}}
try {
 for(const version of ['4.3.1','4.3.2']){
  const registry=`https://registry.npmjs.org/react-native-mmkv/${version}`;
  const metadata=await fetchChecked(registry,true);
  const bytes=await fetchChecked(metadata.dist.tarball,false);
  const integrity='sha512-'+crypto.createHash('sha512').update(bytes).digest('base64');
  assert.equal(integrity,metadata.dist.integrity);
  const app=path.join(scratch,version); fs.mkdirSync(path.join(app,'node_modules'),{recursive:true});
  for(const name of fs.readdirSync(path.join(root,'node_modules'))){if(name==='react-native-mmkv'||name.startsWith('.'))continue; fs.symlinkSync(path.join(root,'node_modules',name),path.join(app,'node_modules',name),'dir');}
  const pkg=path.join(app,'node_modules/react-native-mmkv');fs.mkdirSync(pkg);
  const tar=path.join(app,'mmkv.tgz');fs.writeFileSync(tar,bytes);
  const extraction=command('tar',['-xzf',tar,'--strip-components=1','-C',pkg]);assert.equal(extraction.status,0,extraction.stderr);
  const dependencies={...JSON.parse(fs.readFileSync(path.join(root,'examples/nitro-fixture/package.json'))).dependencies,'react-native-mmkv':version};
  fs.writeFileSync(path.join(app,'package.json'),JSON.stringify({name:'mmkv-upgrade-experiment',private:true,dependencies}));
  for(const f of files){fs.copyFileSync(path.join(root,'examples/nitro-fixture',f),path.join(app,f));assert.equal(hash(fs.readFileSync(path.join(app,f))),evidence.copiedFiles[f]);}
  const req=createRequire(path.join(app,'package.json'));
  assert.equal(req.resolve('react-native-mmkv/package.json'),path.join(pkg,'package.json'));
  const tuple=Object.fromEntries([...Object.keys(dependencies),'react-native-worklets'].map(name=>[name,req(name+'/package.json').version]));
  assert.equal(tuple['react-native-mmkv'],version);
  evidence.packages.push({version,registry,tarball:metadata.dist.tarball,integrity,integrityVerified:true,tarballSha256:hash(bytes),peerDependencies:metadata.peerDependencies,tuple});
  for(const preset of ['android-phone','ios-phone']){
   function run(label,extra,expected){
    const args=[cli,...extra,'--project-root',app,'--preset',preset,'--setup',path.join(app,'fixtures.ts'),'--no-cache','--bytecode','off'];
    const start=performance.now();const p=command(process.execPath,args,{cwd:app,env:{...process.env,NODE_ENV:'production',RN_A11Y_HOST_BIN:host}});
    const result=JSON.parse(p.stdout);const diagnostics=result.diagnostics??result.error?.details?.diagnostics??[];
    const row={version,preset,label,status:p.status,elapsedMs:Math.round(performance.now()-start),args:args.map(s=>s.replaceAll(app,'<APP>').replaceAll(root,'<REPO>')),diagnostics:diagnostics.map(({code,target})=>({code,target})),stderr:p.stderr.trim(),assertions:[]};evidence.runs.push(row);
    assert.equal(p.status,expected,p.stdout+'\n'+p.stderr);return {result,row};
   }
   const appFile=path.join(app,'App.tsx');
   const normal=run('read-write-remove',['run',appFile,'--script',path.join(app,'actions.json')],0);
   assert(normal.result.steps.every(s=>!s.error));
   for(const [tree,id,value] of [[normal.result.final,'storage-id','fixture-default-mmkv'],[normal.result.snapshots.saved,'status','Saved'],[normal.result.snapshots.loaded,'note','Nitro fixture note'],[normal.result.snapshots.deleted,'status','Removed'],[normal.result.snapshots.removed,'note','']])assert.equal(find(tree,id)?.text??'',value);
   for(const target of ['nitro/MMKVFactory','nitro/MMKVPlatformContext'])assert(normal.row.diagnostics.some(d=>d.code==='APPLICATION_FIXTURE'&&d.target===target));
   assert(normal.row.diagnostics.some(d=>d.code==='NATIVE_API_UNSUPPORTED'&&d.target==='NitroModules.box'));
   normal.row.assertions=['no step errors','fixture factory storage ID','saved status','loaded original value','remove returned true','removed value empty','both exact factory diagnostics','unsupported boxing visible'];
   const saved=run('save-before-fresh-process',['run',appFile,'--script','[{"type":{"testID":"note","text":"Only this process"}},{"tap":{"testID":"save"}}]'],0);
   assert.equal(find(saved.result.final,'status').text,'Saved');saved.row.assertions=['saved status'];
   const fresh=run('fresh-process',['run',appFile,'--script','[{"tap":{"testID":"load"}}]'],0);
   assert.equal(find(fresh.result.final,'note')?.text??'','');assert.equal(find(fresh.result.final,'status').text,'Loaded');fresh.row.assertions=['fresh process value empty','loaded status'];
   for(const exact of [false,true]){
    const strict=run(exact?'strict-exact-allowances':'strict-no-allowances',['render',appFile,'--format','json','--fail-on-fallback',...(exact?['--allow-fallback','nitro/MMKVFactory','--allow-fallback','nitro/MMKVPlatformContext','--allow-fallback','NitroModules.box']:[])],6);
    assert.equal(strict.result.error.code,'UNSUPPORTED_NATIVE');
    const rejected=strict.result.error.details.diagnostics.map(({code,target})=>({code,target}));
    assert(rejected.some(d=>d.code==='NATIVE_API_UNSUPPORTED'&&d.target==='NitroModules.box'));
    if(exact)assert.deepEqual(rejected,[{code:'NATIVE_API_UNSUPPORTED',target:'NitroModules.box'}]);
    strict.row.assertions=['exit 6 UNSUPPORTED_NATIVE','boxing remains rejected',...(exact?['only boxing rejected after exact factory allowances']:[])];
   }
   console.log(`${version} ${preset}: five runs passed`);
  }
 }
 evidence.sourceAtEnd=sourceSnapshot();
 evidence.sourceStable=evidence.sourceAtStart.sha256===evidence.sourceAtEnd.sha256;
 assert(evidence.sourceStable,'CLI/runtime source changed during the experiment');
 assert.equal(hash(fs.readFileSync(host)),evidence.host.sha256,'Host artifact changed during experiment');
 evidence.success=true;
} catch(error){evidence.success=false;evidence.failure=String(error.stack??error);throw error;}
finally{evidence.sourceAtEnd??=sourceSnapshot();evidence.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');fs.rmSync(scratch,{recursive:true,force:true});}
