import {execFile} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {createServer} from 'node:http';
import {afterEach, describe, expect, it} from 'vitest';
import {cleanup, render, screen, user} from '../packages/react-native-a11y-tree/src/testing.ts';
import {cli, CLI, E2E_PRESETS, hostSkip, ROOT} from './helpers.ts';

const exec = promisify(execFile);
const dirs: string[] = [];
afterEach(async () => {
  try {await cleanup();}
  finally {for (const dir of dirs.splice(0)) fs.rmSync(dir, {recursive: true, force: true});}
});

function project() {
  const dir = fs.mkdtempSync(path.join(ROOT, 'examples/.vitest-flow-'));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({name: 'vitest-flow', private: true, dependencies: {expo: '58.0.0', 'expo-router': '~58.0.9'}}));
  return dir;
}

describe('Vitest host interactions', () => {
  it.for(E2E_PRESETS)('should drive a sign-in flow on $name using familiar queries and matchers', {timeout: 180_000}, async (preset, t) => {
    if (hostSkip) t.skip(hostSkip);
    await render('examples/basic/App.tsx', {projectRoot: ROOT, preset: preset.name});
    const input = screen.getByTestId('email');
    await user.type(input, 'old');
    await user.type(input, 'new');
    expect(screen.getByTestId('email')).toHaveTextContent('new');
    expect(screen.getByLabelText('Remember me')).toBeChecked();
    const remember = screen.getByRole('switch', {checked: true});
    await user.press(remember);
    expect(remember).not.toBeChecked();
    expect(screen.getByRole('switch', {checked: false})).toHaveAccessibleName('Remember me');
    const button = screen.getByRole('button', {name: 'Submit'});
    expect(button).toHaveTextContent('Submit');
    expect(button).toHaveAccessibleName('Submit');
    expect(button).toHaveTouchTarget(44);
    expect(button).toBeVisible();
    expect(screen.queryByText('Submitted')).toBeNull();
    await user.press(button);
    expect(await screen.findByText('Submitted')).toHaveTextContent('Submitted');
    await user.clear(input);
    expect(screen.queryByTestId('echo')).toBeNull();
    expect(() => screen.getByTestId('missing')).toThrow(/found 0/);
    await render('examples/basic/App.tsx', {projectRoot: ROOT, preset: preset.name});
    expect(screen.queryByText('Submitted')).toBeNull();
    await expect(user.press(button)).rejects.toThrow(/earlier render/);
  });

  it.for(E2E_PRESETS)('should dispatch long presses and swipes through user on $name', {timeout: 180_000}, async (preset, t) => {
    if (hostSkip) t.skip(hostSkip);
    await render('examples/gestures/App.tsx', {projectRoot: ROOT, preset: preset.name});
    const drag = screen.getByTestId('drag');
    const initialX = drag.box.x;
    await user.press(drag);
    expect(screen.getByTestId('tap-out')).toHaveTextContent('tapped');
    await user.swipe(drag, {dx: 100, dy: 0, steps: 10, durationMs: 200});
    const moved = screen.getByTestId('drag').box.x - initialX;
    expect(moved).toBeGreaterThan(70);
    expect(moved).toBeLessThanOrEqual(100);
    expect(screen.getByTestId('pos-out')).toHaveTextContent(`pos ${moved}`);
    await user.longPress(drag);
    expect(screen.getByTestId('long-out')).toHaveTextContent('long-pressed');
  });

  it.for(E2E_PRESETS)('should scroll lists and press rows at their updated position on $name', {timeout: 180_000}, async (preset, t) => {
    if (hostSkip) t.skip(hostSkip);
    await render('examples/scrolling/App.tsx', {projectRoot: ROOT, preset: preset.name});
    const row = screen.getByTestId('row-12');
    const initialY = row.box.y;
    await user.scroll(screen.getByTestId('list'), {x: 0, y: 600});
    expect(screen.getByTestId('offset')).toHaveTextContent('offset 600');
    expect(screen.getByTestId('row-12').box.y).toBeCloseTo(initialY - 600, 3);
    await user.press(row);
    expect(screen.getByTestId('selected')).toHaveTextContent('row 12');
    expect(screen.queryByTestId('flat-row-50')).toBeNull();
    await user.scroll(screen.getByTestId('flat'), {y: 3000});
    expect(await screen.findByTestId('flat-row-50')).toHaveTextContent('Item 50');
  });

  it.for(E2E_PRESETS)('should query accessible states and distinguish hidden elements and content on $name', {timeout: 180_000}, async (preset, t) => {
    if (hostSkip) t.skip(hostSkip);
    const root = project();
    fs.writeFileSync(path.join(root, 'App.tsx'), `
      import React,{useState} from 'react';
      import {Pressable,Text,View} from 'react-native';
      export default function App(){
        const [selected,setSelected]=useState(false);
        return <View>
          <Pressable testID="choice" role="button" accessibilityLabel="Save note"
            accessibilityState={{selected}} style={{width:100,height:48}} onPress={()=>setSelected(x=>!x)}>
            <Text>Save</Text>
          </Pressable>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" collapsable={false}>
            <Text testID="hidden">Secret</Text>
          </View>
          <View style={{opacity:0}} collapsable={false}><Text testID="transparent">Invisible</Text></View>
          <View accessibilityState={{disabled:true}} collapsable={false}>
            <Pressable role="button" accessibilityLabel="Inherited disabled" onPress={()=>setSelected(true)}><Text>Locked</Text></Pressable>
          </View>
          <Pressable testID="tiny" role="button" style={{width:20,height:20}}><Text>Small</Text></Pressable>
          <Text testID="duplicate">One</Text><Text testID="duplicate">Two</Text>
        </View>;
      }`);
    await render('App.tsx', {projectRoot: root, preset: preset.name});
    const choice = screen.getByLabelText(/Save note/g);
    expect(choice).toHaveAccessibleName(/Save note/);
    expect(choice).toHaveTextContent('Save');
    expect(choice).not.toHaveTextContent('Save note');
    expect(choice).not.toHaveTextContent('');
    expect(choice).not.toBeSelected();
    expect(screen.getByText('sav', {exact: false})).toHaveTextContent(/^Save$/g);
    expect(screen.getByRole('button', {name: 'Save note', selected: false})).toBe(choice);
    await user.press(choice);
    expect(choice).toBeSelected();
    expect(await screen.findByRole('button', {name: 'Save note', selected: true})).toHaveTextContent('Save');
    expect(screen.queryByText('Secret')).toBeNull();
    expect(screen.getByTestId('hidden', {includeHiddenElements: true})).not.toBeVisible();
    expect(screen.getByTestId('transparent')).not.toBeVisible();
    const disabled = screen.getByRole('button', {name: 'Inherited disabled', disabled: true});
    expect(disabled).toBeDisabled();
    await expect(user.press(disabled)).rejects.toThrow(/disabled/);
    expect(screen.getByTestId('tiny')).not.toHaveTouchTarget(44);
    expect(screen.getByTestId('tiny')).toHaveTouchTarget(20);
    expect(screen.getAllByTestId('duplicate')).toHaveLength(2);
    expect(await screen.findAllByTestId('duplicate')).toHaveLength(2);
    expect(screen.queryAllByText('absent')).toEqual([]);
    expect(() => screen.getAllByText('absent')).toThrow(/found 0/);
    expect(() => screen.getByTestId('duplicate')).toThrow(/found 2/);
  });

  it('should advance host timers while waiting and reject duplicate or missing matches', {timeout: 180_000}, async t => {
    if (hostSkip) t.skip(hostSkip);
    const root = project();
    fs.writeFileSync(path.join(root, 'App.tsx'), `import React,{useEffect,useState} from 'react'; import {Text,View} from 'react-native'; export default function App(){const [ready,setReady]=useState(false);useEffect(()=>{const id=setTimeout(()=>setReady(true),150);return()=>clearTimeout(id)},[]);return <View><Text testID="same">One</Text><Text testID="same">Two</Text>{ready&&<Text testID="ready">Ready</Text>}</View>}`);
    await render('App.tsx', {projectRoot: root});
    expect(screen.getAllByTestId('same')).toHaveLength(2);
    expect(() => screen.queryByTestId('same')).toThrow(/found 2/);
    expect(await screen.findByText('Ready')).toHaveTextContent('Ready');
    await expect(screen.findByText('never', {}, {timeout: 100, interval: 50})).rejects.toThrow(/found 0/);
    await cleanup();
    const script = cli(['run', path.join(root, 'App.tsx'), '--format', 'json', '--script', '[{"expect":{"testID":"ready","text":"Ready"}}]'], E2E_PRESETS[0]);
    expect(script.status, script.stderr).toBe(0);
    expect(JSON.parse(script.stdout).steps[0].assertion.actual).toBe('Ready');
  });

  it('should keep fixture storage isolated across renders', {timeout: 180_000}, async t => {
    if (hostSkip) t.skip(hostSkip);
    const options = {projectRoot: ROOT, fixtures: 'expo' as const};
    await render('examples/storage-fixture/App.tsx', options);
    await user.type(screen.getByTestId('note'), 'Groceries');
    await user.press(screen.getByRole('button', {name: 'Save'}));
    expect(await screen.findByText('Saved')).toHaveTextContent('Saved');
    await render('examples/storage-fixture/App.tsx', options);
    await user.press(screen.getByRole('button', {name: 'Load'}));
    expect(await screen.findByText('Loaded')).toHaveTextContent('Loaded');
    expect(screen.getByTestId('note')).toHaveTextContent('');
  });

  it('should report startup errors and allow a subsequent render', {timeout: 180_000}, async t => {
    if (hostSkip) t.skip(hostSkip);
    const root = project();
    await expect(render('missing.tsx', {projectRoot: root})).rejects.toThrow(/missing.tsx/);
    fs.writeFileSync(path.join(root, 'App.tsx'), `export default function App(){throw new Error('Expected startup failure')}`);
    await expect(render('App.tsx', {projectRoot: root})).rejects.toThrow(/Expected startup failure/);
    await render('examples/basic/App.tsx', {projectRoot: ROOT});
    expect(screen.getByRole('button', {name: 'Submit'})).toHaveTextContent('Submit');
    await expect(user.back()).rejects.toThrow(/requires renderRoute/);
    await cleanup();
    await cleanup();
    expect(() => screen.queryByText('Submitted')).toThrow(/Render an app/);
  });

  it.for(E2E_PRESETS)('should apply project config, native fixtures and explicit overrides on $name', {timeout: 180_000}, async (preset, t) => {
    if (hostSkip) t.skip(hostSkip);
    const root = project();
    fs.writeFileSync(path.join(root, 'App.tsx'), `
      import React,{useState} from 'react';
      import {Dimensions,Platform,Pressable,Text,TurboModuleRegistry,View} from 'react-native';
      const counter=TurboModuleRegistry.getEnforcing('ExampleCounter');
      export default function App(){
        const [value,setValue]=useState(counter.read());
        return <View><Text testID="device">{Platform.OS+':'+Dimensions.get('window').width}</Text>
          <Text testID="count">{String(value)}</Text>
          <Pressable role="button" onPress={()=>setValue(counter.increment())}><Text>Increment</Text></Pressable>
        </View>;
      }`);
    fs.writeFileSync(path.join(root, 'fixtures.ts'), `let value=0;export default {turboModules:{ExampleCounter:{read:()=>value,increment:()=>++value}}}`);
    fs.writeFileSync(path.join(root, 'a11y-tree.json'), JSON.stringify({preset: preset.name, setup: './fixtures.ts', failOnFallback: true, allowFallback: ['react-native']}));
    await expect(render('App.tsx', {projectRoot: root})).rejects.toThrow(/UNSUPPORTED_NATIVE/);
    const options = {projectRoot: root, allowFallback: ['react-native', 'turbo/ExampleCounter']};
    await render('App.tsx', options);
    expect(screen.getByTestId('device')).toHaveTextContent(`${preset.platform}:${preset.width}`);
    await user.press(screen.getByRole('button', {name: 'Increment'}));
    expect(screen.getByTestId('count')).toHaveTextContent('1');
    await render('App.tsx', {...options, width: 500});
    expect(screen.getByTestId('device')).toHaveTextContent(`${preset.platform}:500`);
    expect(screen.getByTestId('count')).toHaveTextContent('0');
    fs.writeFileSync(path.join(root, 'fixtures.ts'), `let value=10;export default {turboModules:{ExampleCounter:{read:()=>value,increment:()=>++value}}}`);
    await render('App.tsx', {...options, failOnFallback: false});
    expect(screen.getByTestId('count')).toHaveTextContent('10');
  });

  it.for(E2E_PRESETS)('should record a request after pressing, keep actions responsive and reject replay misses on $name', {timeout: 180_000}, async (preset, t) => {
    if (hostSkip) t.skip(hostSkip);
    const requests: {method: string; body: string; header: string | undefined}[] = [];
    let release!: () => void;
    let arrived!: () => void;
    const requestArrived = new Promise<void>(resolve => {arrived = resolve;});
    const server = createServer((request, response) => {
      let body = '';
      request.on('data', chunk => {body += String(chunk);});
      request.on('end', () => {
        requests.push({method: request.method!, body, header: request.headers['x-request'] as string | undefined});
        release = () => {response.writeHead(201, {'x-response': 'recorded'});response.end(JSON.stringify({message: body}));};
        arrived();
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing HTTP address');
    const root = project();
    fs.writeFileSync(path.join(root, 'App.tsx'), `
      import React,{useState} from 'react';import {Pressable,Text,TextInput,View} from 'react-native';
      export default function App(){
        const [note,setNote]=useState('');const [status,setStatus]=useState('idle');const [count,setCount]=useState(0);
        const save=async()=>{setStatus('saving');try{
          const response=await fetch('http://127.0.0.1:${address.port}/notes',{method:'POST',headers:{'x-request':'from-app'},body:note});
          const data=await response.json();setStatus(response.status+':'+response.headers.get('x-response')+':'+data.message);
        }catch(error){setStatus(error.message)}};
        return <View><TextInput testID="note" style={{height:48}} onChangeText={setNote}/>
          <Pressable role="button" style={{height:48}} onPress={save}><Text>Save</Text></Pressable>
          <Pressable role="button" style={{height:48}} onPress={()=>setCount(x=>x+1)}><Text>Increment</Text></Pressable>
          <Text testID="count">{String(count)}</Text><Text testID="status">{status}</Text></View>;
      }`);
    const options = {projectRoot: root, preset: preset.name, networkFile: 'recordings/notes.json'};
    try {
      await render('App.tsx', {...options, network: 'record'});
      expect(requests).toHaveLength(0);
      await user.type(screen.getByTestId('note'), 'Groceries 🥕');
      await user.press(screen.getByRole('button', {name: 'Save'}));
      await requestArrived;
      expect(screen.getByTestId('status')).toHaveTextContent('saving');
      await user.press(screen.getByRole('button', {name: 'Increment'}));
      expect(screen.getByTestId('count')).toHaveTextContent('1');
      release();
      expect(await screen.findByText('201:recorded:Groceries 🥕')).toHaveTextContent('Groceries 🥕');
      expect(requests).toEqual([{method: 'POST', body: 'Groceries 🥕', header: 'from-app'}]);
      expect(fs.existsSync(path.join(root, options.networkFile))).toBe(true);
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await render('App.tsx', {...options, network: 'replay'});
      await user.type(screen.getByTestId('note'), 'Groceries 🥕');
      await user.press(screen.getByRole('button', {name: 'Save'}));
      expect(await screen.findByText('201:recorded:Groceries 🥕')).toHaveTextContent('Groceries 🥕');
      await user.type(screen.getByTestId('note'), 'Changed body');
      await user.press(screen.getByRole('button', {name: 'Save'}));
      expect(await screen.findByText(/NETWORK_NOT_RECORDED/)).toHaveTextContent('NETWORK_NOT_RECORDED');
      expect(requests).toHaveLength(1);
    } finally {await cleanup();server.closeAllConnections();server.close();}
  });

  it.for(E2E_PRESETS)('should deliver session Expo fetch and XMLHttpRequest results and surface transport errors on $name', {timeout: 180_000}, async (preset, t) => {
    if (hostSkip) t.skip(hostSkip);
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(request.url!);
      if (request.url === '/broken') {request.socket.destroy();return;}
      response.writeHead(request.url === '/expo' ? 503 : 202, {'content-type': 'application/json'});
      response.end(JSON.stringify({message: request.url}));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing HTTP address');
    const root = project();
    fs.writeFileSync(path.join(root, 'App.tsx'), `
      import React,{useState} from 'react';import {Pressable,Text,View} from 'react-native';import {fetch as expoFetch} from 'expo/fetch';
      export default function App(){
        const [expo,setExpo]=useState('idle');const [xhr,setXHR]=useState('idle');const [error,setError]=useState('idle');
        const load=()=>{
          expoFetch('http://127.0.0.1:${address.port}/expo').then(async r=>setExpo(r.status+':'+r.ok+':'+(await r.json()).message)).catch(e=>setExpo(e.message));
          const request=new XMLHttpRequest();request.open('GET','http://127.0.0.1:${address.port}/xhr');request.responseType='json';
          request.onload=()=>setXHR(request.status+':'+request.response.message);request.onerror=e=>setXHR(String(e));request.send();
          fetch('http://127.0.0.1:${address.port}/broken').catch(e=>setError(e.message));
        };
        return <View><Pressable role="button" onPress={load}><Text>Load</Text></Pressable>
          <Text testID="expo">{expo}</Text><Text testID="xhr">{xhr}</Text><Text testID="error">{error}</Text></View>;
      }`);
    try {
      await render('App.tsx', {projectRoot: root, preset: preset.name, network: 'live'});
      await user.press(screen.getByRole('button', {name: 'Load'}));
      expect(await screen.findByText('503:false:/expo')).toHaveTextContent('/expo');
      expect(await screen.findByText('202:/xhr')).toHaveTextContent('/xhr');
      expect(await screen.findByText(/NETWORK_ERROR/)).toHaveTextContent('NETWORK_ERROR');
      expect(requests.sort()).toEqual(['/broken', '/expo', '/xhr']);
    } finally {await cleanup();server.closeAllConnections();server.close();}
  });

  it('should preserve element identity across reordered siblings and reject removed handles', {timeout: 180_000}, async t => {
    if (hostSkip) t.skip(hostSkip);
    const root = project();
    fs.writeFileSync(path.join(root, 'App.tsx'), `import React,{useState} from 'react';import {Pressable,Text,View} from 'react-native';export default function App(){const [items,setItems]=useState(['One','Two']);const [value,setValue]=useState('initial');return <View>{items.map(item=><Pressable key={item} role="button" style={{height:48}} onPress={()=>setValue(item)}><Text>{item}</Text></Pressable>)}<Pressable role="button" onPress={()=>setItems(xs=>[...xs].reverse())}><Text>Reverse</Text></Pressable><Pressable role="button" onPress={()=>setItems(xs=>xs.filter(x=>x!=='One'))}><Text>Remove</Text></Pressable><Text testID="value">{value}</Text></View>}`);
    await render('App.tsx', {projectRoot: root});
    const one = screen.getByRole('button', {name: 'One'});
    await user.press(screen.getByRole('button', {name: 'Reverse'}));
    await user.press(one);
    expect(screen.getByTestId('value')).toHaveTextContent('One');
    await user.press(screen.getByRole('button', {name: 'Remove'}));
    await expect(user.press(one)).rejects.toThrow(/no longer/);
    expect(screen.getByTestId('value')).toHaveTextContent('One');
  });

  it('should reject disabled and covered presses before dispatching events', {timeout: 180_000}, async t => {
    if (hostSkip) t.skip(hostSkip);
    const root = project();
    fs.writeFileSync(path.join(root, 'App.tsx'), `import React,{useState} from 'react';import {Pressable,Text,View} from 'react-native';export default function App(){const [status,setStatus]=useState('initial');const style={position:'absolute',left:20,top:20,width:100,height:48};return <View style={{flex:1}}><Pressable testID="covered" role="button" style={style} onPress={()=>setStatus('covered pressed')}><Text>Save</Text></Pressable><Pressable testID="overlay" style={style} onPress={()=>setStatus('overlay pressed')}><Text>Overlay</Text></Pressable><Pressable testID="disabled" disabled style={{top:100}} onPress={()=>setStatus('disabled pressed')}><Text>Disabled</Text></Pressable><Text testID="status" style={{top:200}}>{status}</Text></View>}`);
    await render('App.tsx', {projectRoot: root});
    expect(screen.getByTestId('disabled')).toBeDisabled();
    await expect(user.press(screen.getByTestId('disabled'))).rejects.toThrow(/disabled/);
    await expect(user.press(screen.getByTestId('covered'))).rejects.toThrow(/TARGET_COVERED/);
    expect(await screen.findByTestId('status')).toHaveTextContent('initial');
  });

  it('should finish cleanup while a live session request is pending', {timeout: 180_000}, async t => {
    if (hostSkip) t.skip(hostSkip);
    let requested!: () => void;
    const requestArrived = new Promise<void>(resolve => {requested = resolve;});
    const server = createServer(() => requested());
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing HTTP address');
    const root = project();
    fs.writeFileSync(path.join(root, 'App.tsx'), `import React,{useEffect} from 'react';import {Text} from 'react-native';export default function App(){useEffect(()=>{fetch('http://127.0.0.1:${address.port}/pending').catch(()=>{})},[]);return <Text>Pending</Text>}`);
    try {
      await render('App.tsx', {projectRoot: root, network: 'live'});
      await requestArrived;
      const start = performance.now();
      await cleanup();
      expect(performance.now() - start).toBeLessThan(2000);
    } finally {await cleanup(); server.closeAllConnections(); server.close();}
  });

  it('should resolve concurrent session fetches and replay them with no live requests', {timeout: 180_000}, async t => {
    if (hostSkip) t.skip(hostSkip);
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(request.url!);
      setTimeout(() => response.end(JSON.stringify({message: request.url})), request.url === '/slow' ? 100 : 5);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing HTTP address');
    const root = project();
    fs.writeFileSync(path.join(root, 'App.tsx'), `import React,{useEffect,useState} from 'react';import {Text,View} from 'react-native';export default function App(){const [value,setValue]=useState('pending');useEffect(()=>{Promise.all(['/slow','/fast'].map(p=>fetch('http://127.0.0.1:${address.port}'+p).then(r=>r.json()))).then(xs=>setValue(xs.map(x=>x.message).join(' '))).catch(e=>setValue('error:'+e.message))},[]);return <View><Text>{value}</Text></View>}`);
    try {
      await render('App.tsx', {projectRoot: root, network: 'record'});
      expect(await screen.findByText('/slow /fast')).toHaveTextContent('/slow /fast');
      expect(requests.sort()).toEqual(['/fast', '/slow']);
      await render('App.tsx', {projectRoot: root, network: 'replay'});
      expect(await screen.findByText('/slow /fast')).toHaveTextContent('/slow /fast');
      expect(requests).toHaveLength(2);
      await render('App.tsx', {projectRoot: root, network: 'off'});
      expect(await screen.findByText(/NETWORK_DISABLED/)).toHaveTextContent('NETWORK_DISABLED');
    } finally { await cleanup(); server.closeAllConnections(); server.close(); }
  });

  it.for(E2E_PRESETS)('should run a Router flow on $name and forward Vitest name and reporter flags', {timeout: 180_000}, async (preset, t) => {
    if (hostSkip) t.skip(hostSkip);
    const root = project();
    fs.mkdirSync(path.join(root, 'app'));
    fs.writeFileSync(path.join(root, 'app/_layout.tsx'), `import {Stack} from 'expo-router';export default function Layout(){return <Stack screenOptions={{headerShown:false}}/>}`);
    fs.writeFileSync(path.join(root, 'app/index.tsx'), `import {router} from 'expo-router';import {Pressable,Text,View} from 'react-native';export default function Home(){return <View><Text>Notes</Text><Pressable accessibilityRole="button" onPress={()=>router.push('/edit')}><Text>New Note</Text></Pressable></View>}`);
    fs.writeFileSync(path.join(root, 'app/edit.tsx'), `import {TextInput,View} from 'react-native';export default function Edit(){return <View><TextInput testID="body" style={{height:48}}/></View>}`);
    fs.writeFileSync(path.join(root, 'notes.a11y.test.ts'), `
      import {test,expect,renderRoute,screen,user} from 'react-native-a11y-tree/test';
      test('should create a note',async()=>{
        await renderRoute('/',{preset:'${preset.name}'});
        await user.press(screen.getByRole('button',{name:'New Note'}));
        await user.type(await screen.findByTestId('body'),'Groceries');
        expect(screen.getByTestId('body')).toHaveTextContent('Groceries');
        expect(screen.queryByText('Notes')).toBeNull();
        expect(screen.queryByRole('button',{name:'New Note'})).toBeNull();
        expect(screen.getByText('Notes',{includeHiddenElements:true})).not.toBeVisible();
        await user.back();expect(await screen.findByText('Notes')).toHaveTextContent('Notes');
        await expect(user.back()).rejects.toThrow(/root/);
      });
      test('should create a note from a direct route',async()=>{
        await renderRoute('/edit',{preset:'${preset.name}'});
        expect(screen.getByTestId('body')).toHaveTextContent('');
        await user.type(screen.getByTestId('body'),'Direct route');
        expect(screen.getByTestId('body')).toHaveTextContent('Direct route');
      });
      test('should skip this flow',()=>{throw new Error('name filter failed')});`);
    let result;
    try {
      result = await exec(process.execPath, ['--experimental-strip-types', CLI, 'test', '-t', 'should create a note', '--reporter=json'], {
        cwd: root, env: process.env, timeout: 160_000, maxBuffer: 4 * 1024 * 1024,
      });
    } catch (error) {
      const reportFile = path.join(root, '.vitest/json/output.json');
      throw new Error(fs.existsSync(reportFile) ? fs.readFileSync(reportFile, 'utf8') : String(error));
    }
    const report = JSON.parse(fs.readFileSync(path.join(root, '.vitest/json/output.json'), 'utf8'));
    expect(report.numPassedTests).toBe(2);
    expect(report.numPendingTests).toBe(1);
  });
});
