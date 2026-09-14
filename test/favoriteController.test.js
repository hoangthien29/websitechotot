const assert = require('node:assert/strict');
const { test } = require('node:test');
const mongoose = require('mongoose');

const favoriteController = require('../src/controllers/favorite.controller');
const favoriteService = require('../src/services/favorite.service');

const createResponse = () => ({
  statusCode: 200,
  redirectStatus: null,
  redirectUrl: '',
  view: '',
  data: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  redirect(status, url) {
    this.redirectStatus = status;
    this.redirectUrl = url;
    return this;
  },
  render(view, data) {
    this.view = view;
    this.data = data;
    return this;
  },
});

test('addFavorite luôn dùng req.user và giữ returnTo nội bộ', async (t) => {
  const userId = new mongoose.Types.ObjectId();
  const listingId = new mongoose.Types.ObjectId();
  let receivedUserId;
  let receivedListingId;

  t.mock.method(favoriteService, 'addFavorite', async (first, second) => {
    receivedUserId = first;
    receivedListingId = second;
    return { created: true };
  });
  const req = {
    user: { _id: userId },
    params: { id: listingId.toString() },
    body: {
      userId: new mongoose.Types.ObjectId().toString(),
      returnTo: '/listings?keyword=iphone&page=2',
    },
    query: {},
    originalUrl: `/listings/${listingId}/favorite`,
  };
  const res = createResponse();

  await favoriteController.addFavorite(req, res, assert.fail);

  assert.equal(receivedUserId, userId);
  assert.equal(receivedListingId, listingId.toString());
  assert.equal(res.redirectStatus, 303);
  assert.equal(res.redirectUrl, '/listings?keyword=iphone&page=2');
});

test('addFavorite dùng fallback nội bộ và trả 404/403 cho lỗi nghiệp vụ', async (t) => {
  const listingId = new mongoose.Types.ObjectId().toString();
  const req = {
    user: { _id: new mongoose.Types.ObjectId() },
    params: { id: listingId },
    body: { returnTo: 'https://example.com' },
    query: {},
    originalUrl: `/listings/${listingId}/favorite`,
  };
  const addMock = t.mock.method(
    favoriteService,
    'addFavorite',
    async () => ({ created: true }),
  );
  const fallbackResponse = createResponse();

  await favoriteController.addFavorite(req, fallbackResponse, assert.fail);
  assert.equal(fallbackResponse.redirectUrl, `/listings/${listingId}`);

  addMock.mock.mockImplementation(async () => {
    const error = new Error('not found');
    error.code = favoriteService.FAVORITE_LISTING_NOT_FOUND;
    throw error;
  });
  const notFoundResponse = createResponse();
  await favoriteController.addFavorite(req, notFoundResponse, assert.fail);
  assert.equal(notFoundResponse.statusCode, 404);
  assert.equal(notFoundResponse.view, 'errors/404');

  addMock.mock.mockImplementation(async () => {
    const error = new Error('own');
    error.code = favoriteService.FAVORITE_OWN_LISTING;
    throw error;
  });
  const forbiddenResponse = createResponse();
  await favoriteController.addFavorite(req, forbiddenResponse, assert.fail);
  assert.equal(forbiddenResponse.statusCode, 403);
  assert.equal(forbiddenResponse.view, 'errors/403');
});

test('removeFavorite idempotent và không redirect ra ngoài', async (t) => {
  const userId = new mongoose.Types.ObjectId();
  const listingId = new mongoose.Types.ObjectId().toString();
  let receivedFilter;
  t.mock.method(favoriteService, 'removeFavorite', async (first, second) => {
    receivedFilter = { user: first, listing: second };
    return { removed: false };
  });
  const req = {
    user: { _id: userId },
    params: { id: listingId },
    body: { returnTo: '//example.com' },
    query: {},
    originalUrl: `/listings/${listingId}/favorite`,
  };
  const res = createResponse();

  await favoriteController.removeFavorite(req, res, assert.fail);

  assert.deepEqual(receivedFilter, { user: userId, listing: listingId });
  assert.equal(res.redirectStatus, 303);
  assert.equal(res.redirectUrl, '/favorites');
});

test('listFavorites presenter mọi item với isFavorited=true', async (t) => {
  const userId = new mongoose.Types.ObjectId();
  const listingId = new mongoose.Types.ObjectId();
  let receivedPage;
  t.mock.method(
    favoriteService,
    'getUserFavoritesPage',
    async (receivedUserId, page) => {
      receivedPage = page;
      return {
        items: [
          {
            _id: listingId,
            title: 'Sản phẩm Step 10',
            price: 100000,
            category: null,
            seller: { _id: new mongoose.Types.ObjectId(), name: 'Người bán' },
            location: 'TP.HCM',
            condition: 'used',
            images: [],
            status: 'active',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        ],
        pagination: {
          page: 1,
          limit: 12,
          totalItems: 1,
          totalPages: 1,
          hasPrev: false,
          hasNext: false,
          previousPage: null,
          nextPage: null,
        },
      };
    },
  );
  const req = {
    user: { _id: userId },
    params: {},
    query: { page: '1' },
    body: {},
    originalUrl: '/favorites',
  };
  const res = createResponse();

  await favoriteController.listFavorites(req, res, assert.fail);

  assert.equal(res.view, 'favorites/index');
  assert.equal(res.data.listings.length, 1);
  assert.equal(res.data.listings[0].isFavorited, true);
  assert.equal(res.data.totalItems, 1);
  assert.equal(receivedPage, 1);
});
