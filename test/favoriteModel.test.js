const assert = require('node:assert/strict');
const { test } = require('node:test');

const Favorite = require('../src/models/Favorite');

test('Favorite chỉ lưu user, listing và timestamps', () => {
  const schemaPaths = Object.keys(Favorite.schema.paths).sort();

  assert.deepEqual(schemaPaths, [
    '__v',
    '_id',
    'createdAt',
    'listing',
    'updatedAt',
    'user',
  ]);
  assert.equal(Favorite.schema.path('user').options.ref, 'User');
  assert.equal(Favorite.schema.path('listing').options.ref, 'Listing');
  assert.equal(Favorite.schema.path('user').options.immutable, true);
  assert.equal(Favorite.schema.path('listing').options.immutable, true);
});

test('Favorite có unique compound index và index phân trang theo user', () => {
  const indexes = Favorite.schema.indexes();
  const uniqueIndex = indexes.find(
    ([fields, options]) =>
      fields.user === 1 &&
      fields.listing === 1 &&
      options.unique === true,
  );
  const paginationIndex = indexes.find(
    ([fields]) => fields.user === 1 && fields.createdAt === -1,
  );

  assert.ok(uniqueIndex);
  assert.ok(paginationIndex);
});
