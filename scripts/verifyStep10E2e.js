require('dotenv').config({ quiet: true });

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');

const connectDatabase = require('../src/config/database');
const { prepareCsrfHeaders } = require('./e2eCsrf');

process.env.NODE_ENV = 'test';

let assertionCount = 0;
let server;
let baseUrl;
let buyerCookie = '';
const testEmails = new Set();
const testUserIds = new Set();
const testCategoryIds = new Set();
const testListingIds = new Set();

const check = (value, message) => {
  assertionCount += 1;
  assert.ok(value, message);
};

const checkEqual = (actual, expected, message) => {
  assertionCount += 1;
  assert.equal(actual, expected, message);
};

const listen = (app) =>
  new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });

const closeServer = () =>
  new Promise((resolve) => {
    if (!server?.listening) {
      resolve();
      return;
    }

    server.close(() => resolve());
  });

const request = async (pathname, options = {}) => {
  const headers = new Headers(options.headers || {});

  if (options.cookie) {
    headers.set('cookie', options.cookie);
  }

  await prepareCsrfHeaders({
    baseUrl,
    cookie: options.cookie,
    headers,
    method: options.method,
    skipCsrf: options.skipCsrf,
  });

  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers,
    redirect: 'manual',
  });
  const text = options.readBody === false ? '' : await response.text();

  return {
    location: response.headers.get('location') || '',
    setCookie: response.headers.get('set-cookie') || '',
    status: response.status,
    text,
  };
};

const urlEncoded = (data, overrides = {}) => ({
  body: new URLSearchParams(data),
  headers: {
    'content-type': 'application/x-www-form-urlencoded',
  },
  method: 'POST',
  ...overrides,
});

const getSessionCookie = (setCookie) => setCookie.split(';', 1)[0];

const registerUser = async (email, password, name) => {
  testEmails.add(email);
  const response = await request(
    '/register',
    urlEncoded({
      confirmPassword: password,
      email,
      name,
      password,
    }),
  );

  checkEqual(response.status, 303, 'Đăng ký test User phải redirect 303');
};

const loginUser = async (email, password) => {
  const response = await request(
    '/login',
    urlEncoded({ email, password }),
  );

  checkEqual(response.status, 303, 'Đăng nhập test User phải redirect 303');
  check(response.setCookie.length > 0, 'Đăng nhập phải tạo session cookie');
  return getSessionCookie(response.setCookie);
};

const countCards = (html) =>
  (html.match(/class="card product-card"/g) || []).length;

const getListingLinks = (html) =>
  new Set(
    [...html.matchAll(/href="\/listings\/([0-9a-f]{24})"/g)].map(
      (match) => match[1],
    ),
  );

const cleanupTestData = async () => {
  const cleanup = {
    categoriesDeleted: 0,
    favoritesDeleted: 0,
    listingsDeleted: 0,
    remainingTestFavorites: 0,
    sessionsDeleted: 0,
    usersDeleted: 0,
  };

  if (mongoose.connection.readyState === 0) {
    return cleanup;
  }

  const Category = require('../src/models/Category');
  const Favorite = require('../src/models/Favorite');
  const Listing = require('../src/models/Listing');
  const User = require('../src/models/User');
  const users = await User.find({ email: { $in: [...testEmails] } })
    .select('_id')
    .lean();

  users.forEach((user) => testUserIds.add(user._id.toString()));

  const userIds = [...testUserIds];
  const listingIds = [...testListingIds];
  const categoryIds = [...testCategoryIds];

  if (userIds.length > 0 || listingIds.length > 0) {
    const favoriteFilter = { $or: [] };

    if (userIds.length > 0) {
      favoriteFilter.$or.push({ user: { $in: userIds } });
    }

    if (listingIds.length > 0) {
      favoriteFilter.$or.push({ listing: { $in: listingIds } });
    }

    const favoriteResult = await Favorite.deleteMany(favoriteFilter);
    cleanup.favoritesDeleted = favoriteResult.deletedCount;
  }

  if (listingIds.length > 0) {
    const listingResult = await Listing.deleteMany({
      _id: { $in: listingIds },
    });
    cleanup.listingsDeleted = listingResult.deletedCount;
  }

  if (categoryIds.length > 0) {
    const categoryResult = await Category.deleteMany({
      _id: { $in: categoryIds },
    });
    cleanup.categoriesDeleted = categoryResult.deletedCount;
  }

  if (userIds.length > 0) {
    const sessionCollection = mongoose.connection.collection('sessions');
    const sessionIds = [];

    for (const userId of userIds) {
      const sessions = await sessionCollection
        .find({ session: new RegExp(userId) }, { projection: { _id: 1 } })
        .toArray();
      sessions.forEach((session) => sessionIds.push(session._id));
    }

    if (sessionIds.length > 0) {
      const sessionResult = await sessionCollection.deleteMany({
        _id: { $in: sessionIds },
      });
      cleanup.sessionsDeleted = sessionResult.deletedCount;
    }

    const userResult = await User.deleteMany({
      _id: { $in: userIds },
      email: { $in: [...testEmails] },
    });
    cleanup.usersDeleted = userResult.deletedCount;
  }

  const remainingClauses = [];

  if (userIds.length > 0) {
    remainingClauses.push({ user: { $in: userIds } });
  }

  if (listingIds.length > 0) {
    remainingClauses.push({ listing: { $in: listingIds } });
  }

  cleanup.remainingTestFavorites =
    remainingClauses.length > 0
      ? await Favorite.countDocuments({ $or: remainingClauses })
      : 0;

  return cleanup;
};

const run = async () => {
  const originalLog = console.log;
  console.log = () => {};
  await connectDatabase();
  console.log = originalLog;

  const app = require('../src/app');
  server = await listen(app);
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const Category = require('../src/models/Category');
  const Favorite = require('../src/models/Favorite');
  const Listing = require('../src/models/Listing');
  const User = require('../src/models/User');

  await Favorite.init();

  const testId = crypto.randomUUID().replaceAll('-', '');
  const password = `Step10A1!${testId}`;
  const buyerEmail = `codex-step10-buyer-${testId}@example.test`;
  const sellerEmail = `codex-step10-seller-${testId}@example.test`;
  const otherEmail = `codex-step10-other-${testId}@example.test`;

  await registerUser(buyerEmail, password, 'Step 10 Buyer');
  await registerUser(sellerEmail, password, 'Step 10 Seller');
  await registerUser(otherEmail, password, 'Step 10 Other');

  const [buyer, seller, other] = await Promise.all([
    User.findOne({ email: buyerEmail }).select('_id').lean(),
    User.findOne({ email: sellerEmail }).select('_id').lean(),
    User.findOne({ email: otherEmail }).select('_id').lean(),
  ]);

  [buyer, seller, other].forEach((user) => {
    check(user?._id, 'Test User phải tồn tại');
    testUserIds.add(user._id.toString());
  });

  const category = await Category.create({
    name: `Step 10 test ${testId}`,
    slug: `step-10-test-${testId}`,
    description: 'Danh mục dành riêng cho kiểm thử Favorite Bước 10.',
    status: 'active',
  });
  testCategoryIds.add(category._id.toString());

  const createListing = async ({
    owner = seller._id,
    status = 'active',
    suffix,
  }) => {
    const listing = await Listing.create({
      title: `Step 10 test ${suffix} ${testId}`,
      description:
        'Mô tả Listing Step 10 đủ dài, chỉ dùng cho kiểm thử và sẽ được xóa.',
      price: 100000,
      category: category._id,
      seller: owner,
      location: 'TP.HCM',
      condition: 'used',
      images: [],
      status,
    });
    testListingIds.add(listing._id.toString());
    return listing;
  };

  const activeListing = await createListing({ suffix: 'active' });
  const soldListing = await createListing({
    status: 'sold',
    suffix: 'sold',
  });
  const hiddenListing = await createListing({
    status: 'hidden',
    suffix: 'hidden',
  });
  const ownerListing = await createListing({
    owner: buyer._id,
    suffix: 'owner',
  });
  const extraListings = [];

  for (let index = 1; index <= 13; index += 1) {
    extraListings.push(
      await createListing({ suffix: `pagination-${index}` }),
    );
  }

  const guestFavorites = await request('/favorites');
  checkEqual(guestFavorites.status, 303, 'Guest GET Favorites phải redirect');
  checkEqual(guestFavorites.location, '/login', 'Guest phải về login');

  const guestAdd = await request(
    `/listings/${activeListing._id}/favorite`,
    urlEncoded({ returnTo: '/' }),
  );
  checkEqual(guestAdd.status, 303, 'Guest add phải redirect login');
  checkEqual(
    await Favorite.countDocuments({ listing: activeListing._id }),
    0,
    'Guest không được tạo Favorite',
  );

  const guestRemove = await request(
    `/listings/${activeListing._id}/favorite?_method=DELETE`,
    urlEncoded({ returnTo: '/favorites' }),
  );
  checkEqual(guestRemove.status, 303, 'Guest remove phải redirect login');
  checkEqual(
    await Favorite.countDocuments({ listing: activeListing._id }),
    0,
    'Guest không được thay đổi Favorite',
  );

  buyerCookie = await loginUser(buyerEmail, password);
  const sessionRefresh = await request('/profile', { cookie: buyerCookie });
  checkEqual(sessionRefresh.status, 200, 'Session phải tồn tại qua request mới');

  const addActive = await request(
    `/listings/${activeListing._id}/favorite`,
    {
      ...urlEncoded({ returnTo: '/listings?keyword=Step+10' }),
      cookie: buyerCookie,
    },
  );
  checkEqual(addActive.status, 303, 'Add active Favorite phải redirect 303');
  checkEqual(
    addActive.location,
    '/listings?keyword=Step+10',
    'returnTo nội bộ phải được giữ',
  );
  checkEqual(
    await Favorite.countDocuments({
      user: buyer._id,
      listing: activeListing._id,
    }),
    1,
    'Active Favorite phải được tạo đúng một bản ghi',
  );

  const duplicateAdd = await request(
    `/listings/${activeListing._id}/favorite`,
    {
      ...urlEncoded({ returnTo: '/' }),
      cookie: buyerCookie,
    },
  );
  checkEqual(duplicateAdd.status, 303, 'Add trùng vẫn phải thành công');
  checkEqual(
    await Favorite.countDocuments({
      user: buyer._id,
      listing: activeListing._id,
    }),
    1,
    'Add trùng không được tạo document thứ hai',
  );

  const removeActive = await request(
    `/listings/${activeListing._id}/favorite?_method=DELETE`,
    {
      ...urlEncoded({ returnTo: '/favorites' }),
      cookie: buyerCookie,
    },
  );
  checkEqual(removeActive.status, 303, 'Remove Favorite phải redirect 303');
  checkEqual(
    await Favorite.countDocuments({
      user: buyer._id,
      listing: activeListing._id,
    }),
    0,
    'Remove phải xóa Favorite hiện tại',
  );

  const removeMissing = await request(
    `/listings/${activeListing._id}/favorite?_method=DELETE`,
    {
      ...urlEncoded({ returnTo: '/favorites' }),
      cookie: buyerCookie,
    },
  );
  checkEqual(
    removeMissing.status,
    303,
    'Remove Favorite không tồn tại phải idempotent',
  );

  const concurrentResults = await Promise.all([
    request(`/listings/${activeListing._id}/favorite`, {
      ...urlEncoded({ returnTo: '/' }),
      cookie: buyerCookie,
    }),
    request(`/listings/${activeListing._id}/favorite`, {
      ...urlEncoded({ returnTo: '/' }),
      cookie: buyerCookie,
    }),
  ]);
  concurrentResults.forEach((response) =>
    checkEqual(response.status, 303, 'Concurrent add không được lỗi 500'),
  );
  checkEqual(
    await Favorite.countDocuments({
      user: buyer._id,
      listing: activeListing._id,
    }),
    1,
    'Unique index phải ngăn concurrent duplicate',
  );

  const addSold = await request(
    `/listings/${soldListing._id}/favorite`,
    {
      ...urlEncoded({ returnTo: '/favorites' }),
      cookie: buyerCookie,
    },
  );
  checkEqual(addSold.status, 303, 'Listing sold phải Favorite được');

  const addHidden = await request(
    `/listings/${hiddenListing._id}/favorite`,
    {
      ...urlEncoded({ returnTo: '/' }),
      cookie: buyerCookie,
    },
  );
  checkEqual(addHidden.status, 404, 'Listing hidden phải trả 404');
  check(
    !addHidden.text.includes(hiddenListing.title),
    'Response hidden không được làm lộ tiêu đề',
  );
  checkEqual(
    await Favorite.countDocuments({
      user: buyer._id,
      listing: hiddenListing._id,
    }),
    0,
    'Listing hidden không được tạo Favorite',
  );

  const missingId = new mongoose.Types.ObjectId();
  const addMissing = await request(`/listings/${missingId}/favorite`, {
    ...urlEncoded({ returnTo: '/' }),
    cookie: buyerCookie,
  });
  checkEqual(addMissing.status, 404, 'Listing không tồn tại phải trả 404');

  const addInvalid = await request('/listings/not-an-object-id/favorite', {
    ...urlEncoded({ returnTo: '/' }),
    cookie: buyerCookie,
  });
  checkEqual(addInvalid.status, 404, 'ObjectId sai không được gây 500');

  const addOwn = await request(
    `/listings/${ownerListing._id}/favorite`,
    {
      ...urlEncoded({ returnTo: '/' }),
      cookie: buyerCookie,
    },
  );
  checkEqual(addOwn.status, 403, 'User không được Favorite Listing của mình');
  checkEqual(
    await Favorite.countDocuments({
      user: buyer._id,
      listing: ownerListing._id,
    }),
    0,
    'Owner Favorite không được tạo',
  );

  await Favorite.create({
    user: other._id,
    listing: activeListing._id,
  });
  await Favorite.create({
    user: other._id,
    listing: extraListings[0]._id,
  });
  await request(
    `/listings/${activeListing._id}/favorite?_method=DELETE`,
    {
      ...urlEncoded({ returnTo: '/favorites' }),
      cookie: buyerCookie,
    },
  );
  checkEqual(
    await Favorite.countDocuments({
      user: other._id,
      listing: activeListing._id,
    }),
    1,
    'User A không được xóa Favorite của User B',
  );
  await request(`/listings/${activeListing._id}/favorite`, {
    ...urlEncoded({ returnTo: '/' }),
    cookie: buyerCookie,
  });

  const maliciousReturnPaths = [
    'https://example.com',
    '//example.com',
    'javascript:alert(1)',
  ];

  for (const returnTo of maliciousReturnPaths) {
    const response = await request(
      `/listings/${activeListing._id}/favorite`,
      {
        ...urlEncoded({ returnTo }),
        cookie: buyerCookie,
      },
    );
    checkEqual(
      response.location,
      `/listings/${activeListing._id}`,
      'returnTo độc hại phải dùng fallback nội bộ',
    );
  }

  const injectionAttempt = await request(
    `/listings/${activeListing._id}/favorite`,
    {
      ...urlEncoded({ 'returnTo[$ne]': '/outside' }),
      cookie: buyerCookie,
    },
  );
  checkEqual(
    injectionAttempt.status,
    303,
    'Body bất thường không được gây lỗi hoặc thực thi operator',
  );
  checkEqual(
    injectionAttempt.location,
    `/listings/${activeListing._id}`,
    'Body object-like phải dùng fallback',
  );

  let favoritesPage = await request('/favorites', { cookie: buyerCookie });
  checkEqual(favoritesPage.status, 200, 'Favorites phải render 200');
  check(favoritesPage.text.includes(activeListing.title), 'Phải có active');
  check(favoritesPage.text.includes(soldListing.title), 'Phải có sold');
  check(favoritesPage.text.includes('Đã bán'), 'Sold phải có nhãn Đã bán');
  check(
    !favoritesPage.text.includes(hiddenListing.title),
    'Hidden không được xuất hiện',
  );
  check(
    !favoritesPage.text.includes(extraListings[0].title),
    'Favorites không được hiển thị dữ liệu của User khác',
  );

  await Listing.updateOne(
    { _id: activeListing._id },
    { $set: { status: 'hidden' } },
  );
  favoritesPage = await request('/favorites', { cookie: buyerCookie });
  check(
    !favoritesPage.text.includes(activeListing.title),
    'Favorite hidden sau soft delete không được hiển thị',
  );
  checkEqual(
    await Favorite.countDocuments({
      user: buyer._id,
      listing: activeListing._id,
    }),
    1,
    'Soft delete phải giữ Favorite document',
  );

  await Listing.updateOne(
    { _id: activeListing._id },
    { $set: { status: 'active' } },
  );
  favoritesPage = await request('/favorites', { cookie: buyerCookie });
  check(
    favoritesPage.text.includes(activeListing.title),
    'Active lại phải làm Favorite xuất hiện',
  );

  const favoriteTimeBase = Date.now() + 60000;
  await Favorite.insertMany(
    extraListings.map((listing, index) => ({
      user: buyer._id,
      listing: listing._id,
      createdAt: new Date(favoriteTimeBase + index * 1000),
      updatedAt: new Date(favoriteTimeBase + index * 1000),
    })),
  );

  const pageOne = await request('/favorites?page=1', {
    cookie: buyerCookie,
  });
  const pageTwo = await request('/favorites?page=2', {
    cookie: buyerCookie,
  });
  checkEqual(pageOne.status, 200, 'Favorites page 1 phải 200');
  checkEqual(pageTwo.status, 200, 'Favorites page 2 phải 200');
  checkEqual(countCards(pageOne.text), 12, 'Trang 1 tối đa 12 card');
  checkEqual(countCards(pageTwo.text), 3, 'Trang 2 phải có phần còn lại');

  const pageOneLinks = getListingLinks(pageOne.text);
  const pageTwoLinks = getListingLinks(pageTwo.text);
  check(
    [...pageOneLinks].every((listingId) => !pageTwoLinks.has(listingId)),
    'Hai trang không được trùng Listing',
  );
  check(
    pageOne.text.indexOf(extraListings[12].title) <
      pageOne.text.indexOf(extraListings[11].title),
    'Favorite mới nhất phải đứng trước',
  );

  for (const invalidPage of ['0', '-1', 'abc']) {
    const response = await request(`/favorites?page=${invalidPage}`, {
      cookie: buyerCookie,
    });
    checkEqual(response.status, 422, 'Page sai phải trả 422');
  }

  const outOfRange = await request('/favorites?page=9999', {
    cookie: buyerCookie,
  });
  checkEqual(outOfRange.status, 302, 'Page vượt tổng phải redirect 302');
  checkEqual(
    outOfRange.location,
    '/favorites?page=2',
    'Page vượt tổng phải về trang cuối',
  );

  const home = await request('/', { cookie: buyerCookie });
  checkEqual(home.status, 200, 'Home phải giữ hoạt động');
  check(home.text.includes('href="/favorites"'), 'Header phải có Tin đã lưu');
  check(
    home.text.includes('aria-pressed="true"'),
    'Home card phải có trạng thái Favorite',
  );

  const listingSearch = await request(
    `/listings?keyword=${encodeURIComponent(activeListing.title)}`,
    { cookie: buyerCookie },
  );
  checkEqual(listingSearch.status, 200, 'Search phải giữ hoạt động');
  check(
    listingSearch.text.includes('aria-pressed="true"'),
    'Search card phải có trạng thái Favorite',
  );

  const categoryPage = await request(`/categories/${category.slug}`, {
    cookie: buyerCookie,
  });
  checkEqual(categoryPage.status, 200, 'Category public phải giữ hoạt động');
  check(
    categoryPage.text.includes('aria-pressed="true"'),
    'Category card phải có trạng thái Favorite',
  );

  const detailPage = await request(`/listings/${activeListing._id}`, {
    cookie: buyerCookie,
  });
  checkEqual(detailPage.status, 200, 'Listing detail phải giữ hoạt động');
  check(
    detailPage.text.includes('aria-label="Bỏ lưu sản phẩm"'),
    'Detail phải hiển thị trạng thái đã lưu',
  );

  const ownerDetail = await request(`/listings/${ownerListing._id}`, {
    cookie: buyerCookie,
  });
  check(ownerDetail.text.includes('Tin của bạn'), 'Owner phải thấy Tin của bạn');
  check(
    !ownerDetail.text.includes(
      `/listings/${ownerListing._id}/favorite`,
    ),
    'Owner không được thấy form Favorite',
  );

  const guestDetail = await request(`/listings/${activeListing._id}`);
  check(
    guestDetail.text.includes('Đăng nhập để lưu tin'),
    'Guest detail phải được dẫn đăng nhập',
  );

  const otherCookie = await loginUser(otherEmail, password);
  await Favorite.deleteMany({
    user: other._id,
    listing: { $in: [activeListing._id, extraListings[0]._id] },
  });
  const emptyFavorites = await request('/favorites', {
    cookie: otherCookie,
  });
  checkEqual(emptyFavorites.status, 200, 'Empty Favorites phải trả 200');
  check(
    emptyFavorites.text.includes('Bạn chưa lưu sản phẩm nào.'),
    'Empty state phải có thông báo',
  );
  check(
    emptyFavorites.text.includes('href="/listings"'),
    'Empty state phải có link khám phá',
  );

  const adminDenied = await request('/admin/categories', {
    cookie: buyerCookie,
  });
  checkEqual(adminDenied.status, 403, 'User thường vẫn bị chặn route admin');

  const createResponse = await request(
    '/listings',
    {
      ...urlEncoded({
        category: category._id.toString(),
        condition: 'used',
        description:
          'Listing CRUD Step 10 đủ dài, không có ảnh và sẽ được cleanup.',
        location: 'Hà Nội',
        price: '250000',
        title: `Step 10 test CRUD ${testId}`,
      }),
      cookie: buyerCookie,
    },
  );
  checkEqual(createResponse.status, 303, 'Listing create không ảnh phải hoạt động');
  const createdListingMatch = createResponse.location.match(
    /^\/listings\/([0-9a-f]{24})\?created=1$/,
  );
  check(createdListingMatch, 'Create Listing phải trả ID hợp lệ');
  const createdListingId = createdListingMatch[1];
  testListingIds.add(createdListingId);

  const editForm = await request(`/listings/${createdListingId}/edit`, {
    cookie: buyerCookie,
  });
  checkEqual(editForm.status, 200, 'Listing edit form phải hoạt động');

  const updateResponse = await request(
    `/listings/${createdListingId}?_method=PUT`,
    {
      ...urlEncoded({
        category: category._id.toString(),
        condition: 'new',
        description:
          'Listing CRUD Step 10 đã cập nhật đủ dài và sẽ được cleanup.',
        location: 'Đà Nẵng',
        price: '350000',
        title: `Step 10 test CRUD updated ${testId}`,
      }),
      cookie: buyerCookie,
    },
  );
  checkEqual(updateResponse.status, 303, 'Listing update phải hoạt động');

  for (const status of ['sold', 'active', 'hidden']) {
    const statusResponse = await request(
      `/listings/${createdListingId}/status?_method=PATCH`,
      {
        ...urlEncoded({ status }),
        cookie: buyerCookie,
      },
    );
    checkEqual(statusResponse.status, 303, `Listing status ${status} phải hoạt động`);
  }

  const updatedListing = await Listing.findById(createdListingId)
    .select('title condition status images')
    .lean();
  checkEqual(updatedListing.status, 'hidden', 'Soft delete/status phải giữ Listing');
  checkEqual(updatedListing.images.length, 0, 'Listing không ảnh vẫn hợp lệ');

  await Category.updateOne(
    { _id: category._id },
    { $set: { status: 'inactive' } },
  );
  const inactiveCategory = await request(`/categories/${category.slug}`);
  checkEqual(inactiveCategory.status, 404, 'Category inactive phải 404');
  await Category.updateOne(
    { _id: category._id },
    { $set: { status: 'active' } },
  );

  const profile = await request('/profile', { cookie: buyerCookie });
  checkEqual(profile.status, 200, 'Profile phải giữ hoạt động');
  check(profile.text.includes('Step 10 Buyer'), 'Profile phải đúng User');

  const styleSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'src', 'public', 'css', 'style.css'),
    'utf8',
  );
  check(
    styleSource.includes('.favorite-button:focus-visible'),
    'Favorite phải có focus-visible',
  );
  check(
    styleSource.includes('@media (prefers-reduced-motion: reduce)'),
    'Favorite UI phải tôn trọng reduced motion',
  );
  check(
    !styleSource.includes('overflow-x: hidden'),
    'Hallmark mobile không được dùng overflow-x hidden',
  );

  const logout = await request('/logout', {
    ...urlEncoded({}),
    cookie: buyerCookie,
  });
  checkEqual(logout.status, 303, 'Logout POST phải hoạt động');
  const afterLogout = await request('/favorites', { cookie: buyerCookie });
  checkEqual(afterLogout.status, 303, 'Session logout không còn vào Favorites');
};

const main = async () => {
  let cleanup;
  let runError;

  try {
    await run();
  } catch (error) {
    runError = error;
  } finally {
    try {
      await closeServer();
      cleanup = await cleanupTestData();
    } finally {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
    }
  }

  if (runError) {
    throw runError;
  }

  checkEqual(
    cleanup.remainingTestFavorites,
    0,
    'Cleanup không được để Favorite test hoặc Favorite mồ côi',
  );

  console.log(
    JSON.stringify(
      {
        assertions: assertionCount,
        cleanup,
        status: 'passed',
        suite: 'Step 10 Favorite E2E',
      },
      null,
      2,
    ),
  );
  process.exit(0);
};

main().catch((error) => {
  console.error(`Step 10 E2E failed: ${error.message}`);
  process.exit(1);
});
