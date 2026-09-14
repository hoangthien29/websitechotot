const assert = require('node:assert/strict');
const { test } = require('node:test');
const mongoose = require('mongoose');

const Favorite = require('../src/models/Favorite');
const Listing = require('../src/models/Listing');
const favoriteService = require('../src/services/favorite.service');

const createLeanQuery = (value) => ({
  select() {
    return this;
  },
  populate() {
    return this;
  },
  lean() {
    return Promise.resolve(value);
  },
});

test('addFavorite chỉ tạo cho Listing public không thuộc chính User', async (t) => {
  const userId = new mongoose.Types.ObjectId();
  const sellerId = new mongoose.Types.ObjectId();
  const listingId = new mongoose.Types.ObjectId();
  let updateFilter;
  let updateDocument;

  t.mock.method(Listing, 'findById', () =>
    createLeanQuery({
      _id: listingId,
      seller: sellerId,
      status: 'active',
    }),
  );
  t.mock.method(Favorite, 'updateOne', async (filter, update) => {
    updateFilter = filter;
    updateDocument = update;
    return { upsertedCount: 1 };
  });

  const result = await favoriteService.addFavorite(userId, listingId);

  assert.deepEqual(result, { created: true });
  assert.deepEqual(updateFilter, { user: userId, listing: listingId });
  assert.deepEqual(updateDocument, {
    $setOnInsert: { user: userId, listing: listingId },
  });
});

test('addFavorite cho phép Listing sold và xử lý duplicate key idempotent', async (t) => {
  const userId = new mongoose.Types.ObjectId();
  const listingId = new mongoose.Types.ObjectId();

  t.mock.method(Listing, 'findById', () =>
    createLeanQuery({
      _id: listingId,
      seller: new mongoose.Types.ObjectId(),
      status: 'sold',
    }),
  );
  t.mock.method(Favorite, 'updateOne', async () => {
    const error = new Error('duplicate');
    error.code = 11000;
    throw error;
  });

  assert.deepEqual(
    await favoriteService.addFavorite(userId, listingId),
    { created: false },
  );
});

test('addFavorite không làm lộ Listing hidden hoặc không tồn tại', async (t) => {
  const userId = new mongoose.Types.ObjectId();
  const listingId = new mongoose.Types.ObjectId();
  const findByIdMock = t.mock.method(Listing, 'findById', () =>
    createLeanQuery({
      _id: listingId,
      seller: new mongoose.Types.ObjectId(),
      status: 'hidden',
    }),
  );
  const updateMock = t.mock.method(Favorite, 'updateOne', async () => {
    assert.fail('Không được ghi Favorite');
  });

  await assert.rejects(
    favoriteService.addFavorite(userId, listingId),
    (error) =>
      error.code === favoriteService.FAVORITE_LISTING_NOT_FOUND &&
      error.message === favoriteService.FAVORITE_LISTING_NOT_FOUND_MESSAGE,
  );

  findByIdMock.mock.mockImplementation(() => createLeanQuery(null));
  await assert.rejects(
    favoriteService.addFavorite(userId, listingId),
    (error) => error.code === favoriteService.FAVORITE_LISTING_NOT_FOUND,
  );
  assert.equal(updateMock.mock.callCount(), 0);
});

test('addFavorite từ chối Listing của chính User', async (t) => {
  const userId = new mongoose.Types.ObjectId();
  const listingId = new mongoose.Types.ObjectId();

  t.mock.method(Listing, 'findById', () =>
    createLeanQuery({
      _id: listingId,
      seller: userId,
      status: 'active',
    }),
  );
  const updateMock = t.mock.method(Favorite, 'updateOne', async () => {
    assert.fail('Không được ghi Favorite');
  });

  await assert.rejects(
    favoriteService.addFavorite(userId, listingId),
    (error) => error.code === favoriteService.FAVORITE_OWN_LISTING,
  );
  assert.equal(updateMock.mock.callCount(), 0);
});

test('removeFavorite luôn khóa theo user và listing, kể cả khi không có bản ghi', async (t) => {
  const userId = new mongoose.Types.ObjectId();
  const listingId = new mongoose.Types.ObjectId();
  let receivedFilter;

  const deleteMock = t.mock.method(Favorite, 'deleteOne', async (filter) => {
    receivedFilter = filter;
    return { deletedCount: 0 };
  });

  assert.deepEqual(
    await favoriteService.removeFavorite(userId, listingId),
    { removed: false },
  );
  assert.deepEqual(receivedFilter, { user: userId, listing: listingId });

  assert.deepEqual(
    await favoriteService.removeFavorite(userId, 'invalid-id'),
    { removed: false },
  );
  assert.equal(deleteMock.mock.callCount(), 1);
});

test('getFavoriteListingIds không query guest/danh sách rỗng và chỉ query một lần', async (t) => {
  const userId = new mongoose.Types.ObjectId();
  const firstListingId = new mongoose.Types.ObjectId();
  const secondListingId = new mongoose.Types.ObjectId();
  let receivedFilter;
  const findMock = t.mock.method(Favorite, 'find', (filter) => {
    receivedFilter = filter;
    return createLeanQuery([{ listing: secondListingId }]);
  });

  assert.deepEqual(
    await favoriteService.getFavoriteListingIds(null, [firstListingId]),
    new Set(),
  );
  assert.deepEqual(
    await favoriteService.getFavoriteListingIds(userId, []),
    new Set(),
  );
  assert.equal(findMock.mock.callCount(), 0);

  const result = await favoriteService.getFavoriteListingIds(userId, [
    firstListingId,
    secondListingId,
    secondListingId,
    'invalid',
  ]);

  assert.deepEqual(result, new Set([secondListingId.toString()]));
  assert.equal(findMock.mock.callCount(), 1);
  assert.equal(receivedFilter.user, userId);
  assert.deepEqual(receivedFilter.listing.$in, [
    firstListingId.toString(),
    secondListingId.toString(),
  ]);
});

test('getUserFavoritesPage lọc public trước phân trang và giữ thứ tự Favorite', async (t) => {
  const userId = new mongoose.Types.ObjectId();
  const firstListingId = new mongoose.Types.ObjectId();
  const secondListingId = new mongoose.Types.ObjectId();
  let pipeline;
  let listingFilter;

  t.mock.method(Favorite, 'aggregate', async (receivedPipeline) => {
    pipeline = receivedPipeline;
    return [
      {
        metadata: [{ totalItems: 14 }],
        rows: [
          { listing: firstListingId },
          { listing: secondListingId },
        ],
      },
    ];
  });
  t.mock.method(Listing, 'find', (filter) => {
    listingFilter = filter;
    return createLeanQuery([
      { _id: secondListingId, title: 'Hai', status: 'sold' },
      { _id: firstListingId, title: 'Một', status: 'active' },
    ]);
  });

  const result = await favoriteService.getUserFavoritesPage(userId, 2, 12);

  assert.equal(result.pagination.totalItems, 14);
  assert.equal(result.pagination.totalPages, 2);
  assert.equal(result.pagination.page, 2);
  assert.deepEqual(
    result.items.map((listing) => listing._id.toString()),
    [firstListingId.toString(), secondListingId.toString()],
  );
  assert.deepEqual(listingFilter.status, { $in: ['active', 'sold'] });

  const publicMatchIndex = pipeline.findIndex(
    (stage) => stage.$match?.['listingDocument.status'],
  );
  const facetIndex = pipeline.findIndex((stage) => stage.$facet);
  assert.ok(publicMatchIndex > -1);
  assert.ok(facetIndex > publicMatchIndex);
  assert.deepEqual(pipeline[facetIndex].$facet.rows, [
    { $skip: 12 },
    { $limit: 12 },
    { $project: { _id: 0, listing: 1 } },
  ]);
});

test('getUserFavoritesPage không query Listing khi trang không có row hợp lệ', async (t) => {
  const userId = new mongoose.Types.ObjectId();
  t.mock.method(Favorite, 'aggregate', async () => [
    { metadata: [], rows: [] },
  ]);
  const findMock = t.mock.method(Listing, 'find', () => {
    assert.fail('Không được query Listing');
  });

  const result = await favoriteService.getUserFavoritesPage(userId, 1, 12);

  assert.deepEqual(result.items, []);
  assert.equal(result.pagination.totalItems, 0);
  assert.equal(result.pagination.page, 1);
  assert.equal(findMock.mock.callCount(), 0);
});
