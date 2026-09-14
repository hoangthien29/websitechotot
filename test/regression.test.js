const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const User = require('../src/models/User');
const {
  loadCurrentUser,
  requireAuth,
  requireGuest,
} = require('../src/middlewares/auth.middleware');
const { requireAdmin } = require('../src/middlewares/admin.middleware');
const {
  requireListingOwnerOrAdmin,
} = require('../src/middlewares/listing.middleware');
const {
  isListingImagePublicPath,
  publicPathToDiskPath,
} = require('../src/utils/fileStorage');
const escapeRegex = require('../src/utils/escapeRegex');
const normalizeListingQuery = require('../src/utils/normalizeListingQuery');
const presentListing = require('../src/utils/presentListing');
const {
  listListingsQueryValidator,
} = require('../src/validators/listing.validator');
const { validationResult } = require('express-validator');

const ROOT = path.resolve(__dirname, '..');

const createResponse = () => ({
  locals: {},
  statusCode: 200,
  redirectStatus: null,
  redirectUrl: '',
  view: '',
  status(code) {
    this.statusCode = code;
    return this;
  },
  redirect(status, url) {
    this.redirectStatus = status;
    this.redirectUrl = url;
    return this;
  },
  render(view) {
    this.view = view;
    return this;
  },
});

test('requireAuth và requireGuest giữ đúng hồi quy đăng nhập', () => {
  const guestResponse = createResponse();
  const guestNext = { called: false };
  requireAuth({}, guestResponse, () => {
    guestNext.called = true;
  });

  assert.equal(guestResponse.redirectStatus, 303);
  assert.equal(guestResponse.redirectUrl, '/login');
  assert.equal(guestNext.called, false);

  const authResponse = createResponse();
  let authNextCalled = false;
  requireAuth({ user: { _id: 'user' } }, authResponse, () => {
    authNextCalled = true;
  });
  assert.equal(authNextCalled, true);

  const guestAllowedResponse = createResponse();
  let guestAllowed = false;
  requireGuest({ user: null }, guestAllowedResponse, () => {
    guestAllowed = true;
  });
  assert.equal(guestAllowed, true);

  const loggedInResponse = createResponse();
  requireGuest({ user: { _id: 'user' } }, loggedInResponse, assert.fail);
  assert.equal(loggedInResponse.redirectStatus, 303);
  assert.equal(loggedInResponse.redirectUrl, '/');
});

test('loadCurrentUser chỉ nhận active User và tạo avatarUrl an toàn', async (t) => {
  const managedAvatar =
    '/uploads/avatars/123e4567-e89b-42d3-a456-426614174000.jpg';
  t.mock.method(User, 'findById', () => ({
    select() {
      return this;
    },
    lean: async () => ({
      _id: '507f1f77bcf86cd799439011',
      name: 'Nguyễn An',
      avatar: managedAvatar,
      role: 'user',
      status: 'active',
    }),
  }));
  const req = { session: { userId: '507f1f77bcf86cd799439011' } };
  const res = createResponse();
  let nextCalled = false;

  await loadCurrentUser(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(req.user.avatarUrl, managedAvatar);
  assert.equal(res.locals.currentUser.avatarUrl, managedAvatar);
  assert.equal(res.locals.isAuthenticated, true);
});

test('loadCurrentUser dùng placeholder cho avatar ngoài managed folder', async (t) => {
  t.mock.method(User, 'findById', () => ({
    select() {
      return this;
    },
    lean: async () => ({
      _id: '507f1f77bcf86cd799439011',
      name: 'Nguyễn An',
      avatar: '/uploads/listings/not-avatar.jpg',
      role: 'user',
      status: 'active',
    }),
  }));
  const req = { session: { userId: '507f1f77bcf86cd799439011' } };
  const res = createResponse();

  await loadCurrentUser(req, res, () => {});

  assert.equal(req.user.avatarUrl, '/images/default-avatar.svg');
});

test('loadCurrentUser loại blocked/pending khỏi session', async (t) => {
  t.mock.method(User, 'findById', () => ({
    select() {
      return this;
    },
    lean: async () => ({
      _id: '507f1f77bcf86cd799439011',
      status: 'blocked',
    }),
  }));
  const req = { session: { userId: '507f1f77bcf86cd799439011' } };
  const res = createResponse();

  await loadCurrentUser(req, res, () => {});

  assert.equal(req.user, null);
  assert.equal(req.session.userId, undefined);
  assert.equal(res.locals.isAuthenticated, false);
});

test('requireAdmin từ chối USER và cho ADMIN đi tiếp', () => {
  const userResponse = createResponse();
  requireAdmin({ user: { role: 'user' } }, userResponse, assert.fail);
  assert.equal(userResponse.statusCode, 403);
  assert.equal(userResponse.view, 'errors/403');

  let adminNext = false;
  requireAdmin(
    { user: { role: 'admin' } },
    createResponse(),
    () => {
      adminNext = true;
    },
  );
  assert.equal(adminNext, true);
});

test('Listing chỉ cho owner hoặc admin quản lý', () => {
  const guestResponse = createResponse();
  requireListingOwnerOrAdmin(
    {
      listing: { seller: { equals: () => false } },
      user: null,
    },
    guestResponse,
    assert.fail,
  );
  assert.equal(guestResponse.redirectStatus, 303);
  assert.equal(guestResponse.redirectUrl, '/login');

  const userResponse = createResponse();
  requireListingOwnerOrAdmin(
    {
      listing: { seller: { equals: () => false } },
      user: { _id: 'other', role: 'user' },
    },
    userResponse,
    assert.fail,
  );
  assert.equal(userResponse.statusCode, 403);
  assert.equal(userResponse.view, 'errors/403');

  let ownerNext = false;
  requireListingOwnerOrAdmin(
    {
      listing: { seller: { equals: () => true } },
      user: { _id: 'owner', role: 'user' },
    },
    createResponse(),
    () => {
      ownerNext = true;
    },
  );
  assert.equal(ownerNext, true);

  let adminNext = false;
  requireListingOwnerOrAdmin(
    {
      listing: { seller: { equals: () => false } },
      user: { _id: 'admin', role: 'admin' },
    },
    createResponse(),
    () => {
      adminNext = true;
    },
  );
  assert.equal(adminNext, true);
});

test('file storage Listing không nhận avatar hoặc path traversal', () => {
  const listingPath =
    '/uploads/listings/123e4567-e89b-42d3-a456-426614174000.jpg';

  assert.equal(isListingImagePublicPath(listingPath), true);
  assert.ok(publicPathToDiskPath(listingPath));
  assert.equal(
    isListingImagePublicPath(
      '/uploads/avatars/123e4567-e89b-42d3-a456-426614174000.jpg',
    ),
    false,
  );
  assert.equal(
    publicPathToDiskPath('/uploads/listings/../../.env'),
    null,
  );
});

test('presentListing giữ nhãn hidden cho trang owner', () => {
  const listing = presentListing({
    _id: '507f1f77bcf86cd799439021',
    title: 'Bài đăng ẩn',
    price: 1000,
    condition: 'used',
    images: [],
    status: 'hidden',
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
  });

  assert.equal(listing.statusLabel, 'Đã ẩn');
  assert.equal(listing.hasImages, false);
  assert.equal(listing.primaryImage, '/images/listing-placeholder.svg');
});

test('search escape regex và normalize whitelist giữ hồi quy Bước 8', () => {
  assert.equal(escapeRegex('điện thoại (cũ)+'), 'điện thoại \\(cũ\\)\\+');

  const filters = normalizeListingQuery({
    keyword: '  laptop  ',
    category: 'dien-tu',
    condition: 'used',
    minPrice: '1000',
    maxPrice: '5000',
    location: '  HCM ',
    status: 'sold',
    sort: 'price-asc',
    page: '2',
  });

  assert.deepEqual(filters, {
    keyword: 'laptop',
    category: 'dien-tu',
    condition: 'used',
    minPrice: 1000,
    maxPrice: 5000,
    location: 'HCM',
    status: 'sold',
    sort: 'price-asc',
    page: 2,
  });
});

test('validator search từ chối hidden và field lạ', async () => {
  const req = {
    query: {
      status: 'hidden',
      role: 'admin',
    },
  };

  await listListingsQueryValidator.run(req);
  const errors = validationResult(req).array();

  assert.ok(errors.some((error) => error.path === 'status'));
  assert.ok(errors.some((error) => error.type === 'unknown_fields'));
});

test('route/view profile không chứa userId hoặc input field bị cấm', () => {
  const route = fs.readFileSync(
    path.join(ROOT, 'src/routes/profile.routes.js'),
    'utf8',
  );
  const editView = fs.readFileSync(
    path.join(ROOT, 'src/views/profile/edit.ejs'),
    'utf8',
  );
  const header = fs.readFileSync(
    path.join(ROOT, 'src/views/partials/header.ejs'),
    'utf8',
  );

  assert.match(route, /router\.get\('\/profile', requireAuth/);
  assert.match(route, /router\.get\('\/profile\/edit', requireAuth/);
  assert.match(
    route,
    /router\.put\(\s*'\/profile',\s*requireAuth,\s*uploadAvatar,\s*multipartCsrfProtection,\s*updateProfileValidator/s,
  );
  assert.doesNotMatch(route, /profile\/:userId/);
  assert.match(editView, /enctype="multipart\/form-data"/);
  assert.match(editView, /name="avatar"/);
  assert.match(editView, /id="profileEmail"[\s\S]*?disabled>/);
  assert.doesNotMatch(editView, /name="(?:email|password|role|status|userId)"/);
  assert.match(header, /href="\/profile"/);
  assert.match(header, /src="<%= currentUser\.avatarUrl %>"/);
  assert.doesNotMatch(header, /<%-\s*currentUser\.name/);
});

test('app giữ Helmet, static uploads và mount profile trước 404', () => {
  const appSource = fs.readFileSync(path.join(ROOT, 'src/app.js'), 'utf8');
  const profileIndex = appSource.indexOf("app.use('/', profileRoutes)");
  const notFoundIndex = appSource.indexOf('app.use(notFoundMiddleware)');

  assert.match(appSource, /app\.use\(\s*helmet\(/);
  assert.match(appSource, /'\/uploads',\s*express\.static/s);
  assert.ok(profileIndex >= 0);
  assert.ok(notFoundIndex > profileIndex);
});
