const assert = require('node:assert/strict');
const { test } = require('node:test');

const Listing = require('../src/models/Listing');
const adminListingService = require('../src/services/adminListing.service');

const ADMIN_ID = '507f1f77bcf86cd799439011';
const LISTING_ID = '507f1f77bcf86cd799439021';

const createListingQuery = (value) => ({
  select() {
    return this;
  },
  populate() {
    return this;
  },
  sort() {
    return this;
  },
  skip() {
    return this;
  },
  limit(limit) {
    assert.equal(limit, 20);
    return this;
  },
  lean: async () => value,
});

test('getListingsPage escape keyword và lọc admin-hidden trong MongoDB', async (t) => {
  let capturedFilter;
  t.mock.method(Listing, 'find', (filter) => {
    capturedFilter = filter;
    return createListingQuery([]);
  });
  t.mock.method(Listing, 'countDocuments', async () => 0);

  const result = await adminListingService.getListingsPage({
    keyword: 'xe (cũ)+',
    category: '',
    status: 'all',
    moderation: 'admin-hidden',
    seller: '',
    sort: 'newest',
    page: 1,
  });

  assert.equal(capturedFilter.$or[0].title.source, 'xe \\(cũ\\)\\+');
  assert.equal(capturedFilter.status, 'hidden');
  assert.equal(capturedFilter['moderation.isHiddenByAdmin'], true);
  assert.equal(result.pagination.limit, 20);
});

test('hideListingByAdmin dùng query điều kiện và giữ status cũ trong pipeline', async (t) => {
  let capturedFilter;
  let capturedPipeline;
  t.mock.method(
    Listing,
    'findOneAndUpdate',
    async (filter, pipeline) => {
      capturedFilter = filter;
      capturedPipeline = pipeline;
      return { _id: LISTING_ID, status: 'hidden' };
    },
  );

  await adminListingService.hideListingByAdmin(
    LISTING_ID,
    ADMIN_ID,
    '  Nội dung vi phạm quy định  ',
  );

  assert.deepEqual(capturedFilter.status, { $in: ['active', 'sold'] });
  assert.deepEqual(
    capturedFilter['moderation.isHiddenByAdmin'],
    { $ne: true },
  );
  assert.equal(
    capturedPipeline[0].$set.moderation.previousStatus,
    '$status',
  );
  assert.equal(
    capturedPipeline[0].$set.moderation.reason,
    'Nội dung vi phạm quy định',
  );
  assert.equal(capturedPipeline[0].$set.status, 'hidden');
});

test('restoreListingByAdmin tự suy ra sold và xóa metadata hiện tại', async (t) => {
  t.mock.method(Listing, 'findOne', () =>
    createListingQuery({
      _id: LISTING_ID,
      moderation: { previousStatus: 'sold' },
    }),
  );
  let capturedFilter;
  let capturedUpdate;
  t.mock.method(
    Listing,
    'findOneAndUpdate',
    async (filter, update) => {
      capturedFilter = filter;
      capturedUpdate = update;
      return { _id: LISTING_ID, status: 'sold' };
    },
  );

  const result = await adminListingService.restoreListingByAdmin(
    LISTING_ID,
  );

  assert.equal(capturedFilter.status, 'hidden');
  assert.equal(capturedFilter['moderation.previousStatus'], 'sold');
  assert.equal(capturedUpdate.$set.status, 'sold');
  assert.equal(capturedUpdate.$set.moderation.isHiddenByAdmin, false);
  assert.equal(capturedUpdate.$set.moderation.previousStatus, null);
  assert.equal(result.restoredStatus, 'sold');
});

test('hide reason sai bị từ chối trước khi ghi database', async (t) => {
  const update = t.mock.method(Listing, 'findOneAndUpdate');

  await assert.rejects(
    adminListingService.hideListingByAdmin(
      LISTING_ID,
      ADMIN_ID,
      'ngắn',
    ),
    (error) =>
      error.code === adminListingService.ADMIN_LISTING_REASON_INVALID,
  );
  assert.equal(update.mock.callCount(), 0);
});
