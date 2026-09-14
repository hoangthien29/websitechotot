const assert = require('node:assert/strict');
const { test } = require('node:test');
const { validationResult } = require('express-validator');

const {
  adminListingIdValidator,
  adminListingsQueryValidator,
  hideListingValidator,
} = require('../src/validators/adminListing.validator');

const LISTING_ID = '507f1f77bcf86cd799439021';

test('query Listing Admin nhận đầy đủ whitelist hợp lệ', async () => {
  const req = {
    query: {
      keyword: ' xe máy ',
      category: 'xe-may',
      status: 'hidden',
      moderation: 'admin-hidden',
      seller: ' người bán ',
      sort: 'price-desc',
      page: '3',
    },
  };

  await adminListingsQueryValidator.run(req);

  assert.equal(validationResult(req).isEmpty(), true);
  assert.equal(req.query.keyword, 'xe máy');
  assert.equal(req.query.page, 3);
});

test('query Listing Admin từ chối operator, array và sort tùy ý', async () => {
  const req = {
    query: {
      keyword: { $where: 'true' },
      status: ['hidden'],
      sort: '$natural',
    },
  };

  await adminListingsQueryValidator.run(req);
  const errors = validationResult(req).array();

  assert.ok(errors.some((error) => error.path === 'keyword'));
  assert.ok(errors.some((error) => error.path === 'status'));
  assert.ok(errors.some((error) => error.path === 'sort'));
});

test('hide validator chỉ nhận reason và ObjectId scalar', async () => {
  const req = {
    params: { id: LISTING_ID },
    body: {
      reason: 'Lý do kiểm duyệt có độ dài hợp lệ',
      moderation: { isHiddenByAdmin: false },
      previousStatus: 'sold',
    },
  };

  await hideListingValidator.run(req);
  const errors = validationResult(req).array();

  assert.ok(errors.some((error) => error.type === 'unknown_fields'));
});

test('restore id validator từ chối body status do client chọn', async () => {
  const req = {
    params: { id: LISTING_ID },
    body: { status: 'active' },
  };

  await adminListingIdValidator.run(req);
  assert.ok(
    validationResult(req)
      .array()
      .some(
        (error) =>
          error.type === 'unknown_fields' ||
          error.msg.includes('không được hỗ trợ'),
      ),
  );
});
