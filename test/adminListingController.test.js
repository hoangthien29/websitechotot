const assert = require('node:assert/strict');
const { test } = require('node:test');

const adminListingController = require('../src/controllers/adminListing.controller');
const adminListingService = require('../src/services/adminListing.service');
const categoryService = require('../src/services/category.service');
const {
  hideListingValidator,
} = require('../src/validators/adminListing.validator');

const ADMIN_ID = '507f1f77bcf86cd799439011';
const LISTING_ID = '507f1f77bcf86cd799439021';

const createResponse = () => ({
  statusCode: 200,
  view: '',
  data: null,
  redirectStatus: null,
  redirectUrl: '',
  status(code) {
    this.statusCode = code;
    return this;
  },
  render(view, data) {
    this.view = view;
    this.data = data;
    return this;
  },
  redirect(status, url) {
    this.redirectStatus = status;
    this.redirectUrl = url;
    return this;
  },
});

test('listListings lấy Category Admin và render pagination', async (t) => {
  t.mock.method(categoryService, 'getAllCategoriesForAdmin', async () => []);
  t.mock.method(
    adminListingService,
    'getListingsPage',
    async () => ({
      items: [],
      pagination: {
        page: 1,
        limit: 20,
        totalItems: 0,
        totalPages: 1,
        hasPrev: false,
        hasNext: false,
      },
    }),
  );
  const res = createResponse();

  await adminListingController.listListings(
    { query: {} },
    res,
    assert.fail,
  );

  assert.equal(res.view, 'admin/listings/index');
  assert.equal(res.data.totalItems, 0);
});

test('hideListing dùng moderator từ req.user và redirect 303', async (t) => {
  t.mock.method(
    adminListingService,
    'hideListingByAdmin',
    async (listingId, adminId, reason) => {
      assert.equal(listingId, LISTING_ID);
      assert.equal(adminId, ADMIN_ID);
      assert.equal(reason, 'Lý do kiểm duyệt hợp lệ');
    },
  );
  const req = {
    body: { reason: 'Lý do kiểm duyệt hợp lệ' },
    params: { id: LISTING_ID },
    user: { _id: ADMIN_ID },
  };
  const res = createResponse();

  await hideListingValidator.run(req);
  await adminListingController.hideListing(req, res, assert.fail);

  assert.equal(res.redirectStatus, 303);
  assert.equal(
    res.redirectUrl,
    `/admin/listings/${LISTING_ID}?hidden=1`,
  );
});

test('restoreListing không nhận status khôi phục từ body', async (t) => {
  const restore = t.mock.method(
    adminListingService,
    'restoreListingByAdmin',
    async () => {
      throw new Error('Không được gọi khi body có field lạ');
    },
  );
  const {
    adminListingIdValidator,
  } = require('../src/validators/adminListing.validator');
  const req = {
    body: { status: 'sold' },
    originalUrl: `/admin/listings/${LISTING_ID}/restore`,
    params: { id: LISTING_ID },
    query: {},
    user: { _id: ADMIN_ID },
  };
  t.mock.method(
    adminListingService,
    'getListingAdminDetail',
    async () => ({
      listing: {
        _id: LISTING_ID,
        title: 'Listing kiểm thử',
        description: 'Mô tả đủ dài cho presenter.',
        price: 1,
        location: 'HCM',
        condition: 'used',
        images: [],
        status: 'hidden',
        moderation: { isHiddenByAdmin: true, previousStatus: 'active' },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      stats: {
        favoriteCount: 0,
        conversationCount: 0,
        messageCount: 0,
      },
    }),
  );
  const res = createResponse();

  await adminListingIdValidator.run(req);
  await adminListingController.restoreListing(req, res, assert.fail);

  assert.equal(restore.mock.callCount(), 0);
  assert.equal(res.statusCode, 422);
  assert.equal(res.view, 'admin/listings/show');
});
