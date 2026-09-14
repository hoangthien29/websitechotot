const assert = require('node:assert/strict');
const { test } = require('node:test');

const Message = require('../src/models/Message');

test('Message chỉ lưu reference, plain text, readAt và timestamps', () => {
  assert.deepEqual(Object.keys(Message.schema.paths).sort(), [
    '__v',
    '_id',
    'content',
    'conversation',
    'createdAt',
    'readAt',
    'recipient',
    'sender',
    'updatedAt',
  ]);
  assert.equal(Message.schema.path('conversation').options.ref, 'Conversation');
  assert.equal(Message.schema.path('sender').options.ref, 'User');
  assert.equal(Message.schema.path('recipient').options.ref, 'User');
  assert.equal(Message.schema.path('conversation').options.immutable, true);
  assert.equal(Message.schema.path('sender').options.immutable, true);
  assert.equal(Message.schema.path('recipient').options.immutable, true);
  assert.equal(Message.schema.path('content').options.minlength[0], 1);
  assert.equal(Message.schema.path('content').options.maxlength[0], 2000);
  assert.equal(Message.schema.path('readAt').options.default, null);
});

test('Message có index trang tin, unread và mark-read', () => {
  const indexes = Message.schema.indexes();

  assert.ok(
    indexes.some(
      ([fields]) =>
        fields.conversation === 1 &&
        fields.createdAt === -1 &&
        fields._id === -1,
    ),
  );
  assert.ok(
    indexes.some(
      ([fields]) =>
        fields.recipient === 1 &&
        fields.readAt === 1 &&
        fields.createdAt === -1,
    ),
  );
  assert.ok(
    indexes.some(
      ([fields]) =>
        fields.conversation === 1 &&
        fields.recipient === 1 &&
        fields.readAt === 1,
    ),
  );
});
