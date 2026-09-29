import assert from 'node:assert/strict';
import {test} from 'node:test';

import {validateScript} from '../src/script.ts';

test('accepts every action form', () => {
  const script = [
    {tap: {x: 10, y: 20}},
    {tap: {testID: 'submit'}},
    {tap: {ref: 'n5'}},
    {longPress: {testID: 'submit'}},
    {type: {testID: 'email', text: 'a@b.c', submit: true}},
    {scroll: {testID: 'list', x: 0, y: 300}},
    {wait: 500},
    {snapshot: 'after'},
  ];
  assert.equal(validateScript(script), script);
});

test('reports the step index and the problem', () => {
  const cases: Array<[unknown, RegExp]> = [
    [{}, /must be a JSON array/],
    [[{tap: {x: 1}}], /step 0: tap: "x" and "y" must both be numbers/],
    [[{wait: 1}, {tap: {}}], /step 1: tap: needs exactly one of "testID" or "ref"/],
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
  ];
  for (const [script, pattern] of cases) {
    assert.throws(() => validateScript(script), pattern, JSON.stringify(script));
  }
});
