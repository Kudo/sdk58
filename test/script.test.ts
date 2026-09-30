import assert from 'node:assert/strict';
import {test} from 'node:test';

import {validateScript} from '../src/script.ts';

test('accepts every action form', () => {
  const script = [
    {tap: {x: 10, y: 20}},
    {tap: {testID: 'submit'}},
    {tap: {ref: 'n5'}},
    {tap: {key: 'submit/Paragraph:1'}},
    {tap: {sel: '#submit'}},
    {longPress: {testID: 'submit'}},
    {type: {testID: 'email', text: 'a@b.c', submit: true}},
    {scroll: {testID: 'list', x: 0, y: 300}},
    {pan: {testID: 'drag', dx: 100}},
    {pan: {x: 10, y: 20, dx: 5, dy: -5, steps: 4, durationMs: 100}},
    {pinch: {testID: 'photo', scale: 2}},
    {wait: 500},
    {snapshot: 'after'},
  ];
  assert.equal(validateScript(script), script);
});

test('accepts the object form with $schema and returns its actions', () => {
  const actions = [{tap: {testID: 'submit'}}, {snapshot: 'after'}];
  assert.equal(validateScript({$schema: '../../schema/script.json', actions}), actions);
  assert.equal(validateScript({actions}), actions);
});

test('reports the step index and the problem', () => {
  const cases: Array<[unknown, RegExp]> = [
    [{}, /script must be \{"actions": \[\.\.\.\]\} or a JSON array of actions/],
    ['tap', /script must be \{"actions"/],
    [{actions: [], steps: []}, /unknown key "steps" \(allowed: \$schema, actions\)/],
    [{$schema: 1, actions: []}, /"\$schema" must be a string/],
    [{actions: [{wait: 1}, {tap: {}}]}, /step 1: tap: needs exactly one of/],
    [[{tap: {x: 1}}], /step 0: tap: "x" and "y" must both be numbers/],
    [[{wait: 1}, {tap: {}}], /step 1: tap: needs exactly one of "testID", "ref", "key" or "sel"/],
    [[{tap: {testID: 'a', ref: 'n1'}}], /needs exactly one of/],
    [[{tap: {ref: 'five'}}], /"ref" must look like "n5"/],
    [[{type: {testID: 'email'}}], /step 0: type: "text" must be a string/],
    [[{type: {testID: 'email', text: 'x', submit: 'yes'}}], /"submit" must be a boolean/],
    [[{wait: -1}], /step 0: wait: must be a number of milliseconds >= 0/],
    [[{snapshot: 'a'}, {snapshot: 'a'}], /step 1: snapshot: duplicate snapshot name "a"/],
    [[{swipe: {}}], /step 0: unknown action "swipe"/],
    [[{tap: {testID: 'a'}, wait: 1}], /exactly one action key/],
    [['tap'], /must be an object/],
    [[{tap: {testID: 'a', x: 1, y: 2}}], /unknown key "testID"/],
    [[{pan: {testID: 'a'}}], /pan: needs "dx" and\/or "dy"/],
    [[{pan: {testID: 'a', dx: 1, steps: 0}}], /"steps" must be an integer >= 1/],
    [[{pinch: {testID: 'a'}}], /pinch: "scale" must be a number > 0/],
    [[{pinch: {x: 1, y: 2, scale: 2}}], /pinch: unknown key "x"/],
  ];
  for (const [script, pattern] of cases) {
    assert.throws(() => validateScript(script), pattern, JSON.stringify(script));
  }
});
