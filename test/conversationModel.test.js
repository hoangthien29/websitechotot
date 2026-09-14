const assert = require('node:assert/strict');
const { test } = require('node:test');

const Conversation = require('../src/models/Conversation');

test('Conversation chỉ lưu Listing, participants và metadata cần thiết', () => {
  assert.deepEqual(Object.keys(Conversation.schema.paths).sort(), [
    '__v',
    '_id',
    'buyer',
    'createdAt',
    'lastMessageAt',
    'lastMessagePreview',
    'lastSender',
    'listing',
    'seller',
    'updatedAt',
  ]);
  assert.equal(Conversation.schema.path('listing').options.ref, 'Listing');
  assert.equal(Conversation.schema.path('buyer').options.ref, 'User');
  assert.equal(Conversation.schema.path('seller').options.ref, 'User');
  assert.equal(Conversation.schema.path('lastSender').options.ref, 'User');
  assert.equal(Conversation.schema.path('listing').options.immutable, true);
  assert.equal(Conversation.schema.path('buyer').options.immutable, true);
  assert.equal(Conversation.schema.path('seller').options.immutable, true);
  assert.equal(
    Conversation.schema.path('lastMessagePreview').options.maxlength[0],
    200,
  );
});

test('Conversation có unique index và hai index danh sách participant', () => {
  const indexes = Conversation.schema.indexes();

  assert.ok(
    indexes.some(
      ([fields, options]) =>
        fields.listing === 1 &&
        fields.buyer === 1 &&
        fields.seller === 1 &&
        options.unique === true,
    ),
  );
  assert.ok(
    indexes.some(
      ([fields]) =>
        fields.buyer === 1 &&
        fields.lastMessageAt === -1 &&
        fields.createdAt === -1,
    ),
  );
  assert.ok(
    indexes.some(
      ([fields]) =>
        fields.seller === 1 &&
        fields.lastMessageAt === -1 &&
        fields.createdAt === -1,
    ),
  );
});
