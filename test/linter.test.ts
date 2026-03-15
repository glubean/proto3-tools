import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProtolintOutput } from '../src/protolintParser';

test('parseProtolintOutput handles bracket-style protolint output', () => {
  const result = parseProtolintOutput(
    '/workspace/test.proto',
    '[test.proto:2:1] Message name "foo" must be UpperCamelCase.'
  );

  assert.equal(result.recognized, true);
  assert.equal(result.messages.length, 1);
  assert.match(result.messages[0].message, /UpperCamelCase/);
});

test('parseProtolintOutput handles colon-style output and filters unrelated files', () => {
  const result = parseProtolintOutput(
    '/workspace/test.proto',
    [
      '/tmp/other.proto:1:1: ignore me',
      '/workspace/test.proto:2:1: Message name "foo" must be UpperCamelCase.',
    ].join('\n')
  );

  assert.equal(result.recognized, true);
  assert.equal(result.messages.length, 1);
  assert.match(result.messages[0].message, /UpperCamelCase/);
});

test('parseProtolintOutput preserves raw output for binary errors', () => {
  const result = parseProtolintOutput('/workspace/test.proto', 'spawn protolint ENOENT');

  assert.equal(result.recognized, false);
  assert.equal(result.messages.length, 0);
  assert.equal(result.raw, 'spawn protolint ENOENT');
});
