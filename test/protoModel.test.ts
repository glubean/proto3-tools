import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProto, renumberText } from '../src/protoModel';

test('parseProto captures imports, messages, enums, and services', () => {
  const parsed = parseProto(`
    import "google/type/date.proto";

    message User {
      string name = 1;
      oneof contact {
        string email = 2;
      }
    }

    enum Status {
      UNKNOWN = 0;
    }

    service Users {
      rpc GetUser(GetUserRequest) returns (User);
    }
  `);

  assert.equal(parsed.imports.length, 1);
  assert.equal(parsed.nodes.length, 3);
  assert.equal(parsed.nodes[0].kind, 'message');
  assert.equal(parsed.nodes[1].kind, 'enum');
  assert.equal(parsed.nodes[2].kind, 'service');
});

test('renumberText renumbers message fields and oneof fields', () => {
  const text = `
message User {
  string id = 9;
  oneof contact {
    string email = 12;
    string phone = 20;
  }
}
`.trim();

  const result = renumberText(text, 1);
  assert.match(result, /string id = 1;/);
  assert.match(result, /string email = 2;/);
  assert.match(result, /string phone = 3;/);
});

test('renumberText renumbers enum values from zero', () => {
  const text = `
enum Status {
  UNKNOWN = 5;
  ACTIVE = 7;
}
`.trim();

  const result = renumberText(text, 1);
  assert.match(result, /UNKNOWN = 0;/);
  assert.match(result, /ACTIVE = 1;/);
});
