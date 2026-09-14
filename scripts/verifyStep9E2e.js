require('dotenv').config({ quiet: true });

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');

const connectDatabase = require('../src/config/database');
const { prepareCsrfHeaders } = require('./e2eCsrf');

process.env.NODE_ENV = 'test';

const DEFAULT_AVATAR = '/images/default-avatar.svg';
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

let assertionCount = 0;
let server;
let baseUrl;
let testEmail;
let testPassword;
let testUserId;
let sessionCookie = '';
const testAvatarPaths = new Set();
const testCategoryIds = new Set();
const testListingIds = new Set();
const testListingImagePaths = new Set();

const checkEqual = (actual, expected, message) => {
  assertionCount += 1;
  assert.equal(actual, expected, message);
};

const check = (value, message) => {
  assertionCount += 1;
  assert.ok(value, message);
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
  const requestCookie = options.authenticated ? sessionCookie : '';

  if (requestCookie) {
    headers.set('cookie', requestCookie);
  }

  await prepareCsrfHeaders({
    baseUrl,
    cookie: requestCookie,
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
    contentType: response.headers.get('content-type') || '',
    location: response.headers.get('location') || '',
    setCookie: response.headers.get('set-cookie') || '',
    status: response.status,
    text,
  };
};

const urlEncoded = (data) => ({
  body: new URLSearchParams(data),
  headers: {
    'content-type': 'application/x-www-form-urlencoded',
  },
  method: 'POST',
});

const createProfileForm = (overrides = {}, includeAvatar = false) => {
  const form = new FormData();
  const values = {
    name: 'Người Dùng Đã Cập Nhật',
    phone: '+84 912-345-678',
    address: 'Quận 4, TP.HCM',
    ...overrides,
  };

  for (const [key, value] of Object.entries(values)) {
    form.append(key, value);
  }

  if (includeAvatar) {
    form.append(
      'avatar',
      new Blob([ONE_PIXEL_PNG], { type: 'image/png' }),
      'avatar-fixture.png',
    );
  }

  return form;
};

const createListingForm = (
  categoryId,
  values,
  includeImage = false,
) => {
  const form = new FormData();
  const fields = {
    category: categoryId,
    condition: 'used',
    description:
      'Mô tả sản phẩm kiểm thử đủ dài và chỉ dùng cho E2E có cleanup.',
    location: 'TP.HCM',
    price: '150000',
    ...values,
  };

  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value);
  }

  if (includeImage) {
    form.append(
      'images',
      new Blob([ONE_PIXEL_PNG], { type: 'image/png' }),
      'listing-fixture.png',
    );
  }

  return form;
};

const getAvatarDiskPath = (publicPath) =>
  path.resolve(
    __dirname,
    '..',
    'uploads',
    'avatars',
    path.basename(publicPath),
  );

const getAvatarFiles = () => {
  const directory = path.resolve(__dirname, '..', 'uploads', 'avatars');

  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs
    .readdirSync(directory)
    .filter((filename) => /^[0-9a-f-]+\.(jpg|png|webp)$/i.test(filename));
};

const cleanupTestData = async () => {
  const cleanup = {
    categoriesDeleted: 0,
    listingImagesDeleted: 0,
    listingsDeleted: 0,
    sessionsDeleted: 0,
    usersDeleted: 0,
  };

  if (mongoose.connection.readyState === 0 || !testEmail) {
    return cleanup;
  }

  const User = require('../src/models/User');
  const user = await User.findOne({ email: testEmail })
    .select('_id avatar')
    .lean();

  if (user) {
    testUserId = user._id.toString();

    if (
      typeof user.avatar === 'string' &&
      /^\/uploads\/avatars\/[0-9a-f-]+\.(jpg|png|webp)$/i.test(user.avatar)
    ) {
      testAvatarPaths.add(user.avatar);
    }

    const Listing = require('../src/models/Listing');
    const listingIds = [...testListingIds];

    if (listingIds.length > 0) {
      const listings = await Listing.find({
        _id: { $in: listingIds },
        seller: user._id,
      })
        .select('_id images')
        .lean();

      for (const listing of listings) {
        for (const image of listing.images || []) {
          testListingImagePaths.add(image);
        }
      }

      const listingResult = await Listing.deleteMany({
        _id: { $in: listingIds },
        seller: user._id,
      });
      cleanup.listingsDeleted = listingResult.deletedCount;
    }

    const {
      deleteStoredFiles,
    } = require('../src/utils/fileStorage');
    const deletedImages = await deleteStoredFiles([
      ...testListingImagePaths,
    ]);
    cleanup.listingImagesDeleted = deletedImages.filter(Boolean).length;

    const categoryIds = [...testCategoryIds];

    if (categoryIds.length > 0) {
      const Category = require('../src/models/Category');
      const categoryResult = await Category.deleteMany({
        _id: { $in: categoryIds },
      });
      cleanup.categoriesDeleted = categoryResult.deletedCount;
    }

    const sessionResult = await mongoose.connection
      .collection('sessions')
      .deleteMany({ session: new RegExp(testUserId) });
    cleanup.sessionsDeleted = sessionResult.deletedCount;

    const userResult = await User.deleteOne({
      _id: user._id,
      email: testEmail,
    });
    cleanup.usersDeleted = userResult.deletedCount;
  }

  for (const avatarPath of testAvatarPaths) {
    const diskPath = getAvatarDiskPath(avatarPath);

    try {
      fs.unlinkSync(diskPath);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  return cleanup;
};

const auditAvatarFiles = async () => {
  const User = require('../src/models/User');
  const users = await User.find({
    avatar: /^\/uploads\/avatars\//,
  })
    .select('avatar')
    .lean();
  const referencedFiles = new Set(
    users.map((user) => path.basename(user.avatar)),
  );
  const avatarFiles = getAvatarFiles();

  return {
    avatarFileCount: avatarFiles.length,
    orphanCount: avatarFiles.filter(
      (filename) => !referencedFiles.has(filename),
    ).length,
    referencedAvatarCount: referencedFiles.size,
  };
};

const run = async () => {
  const originalLog = console.log;
  console.log = () => {};
  await connectDatabase();
  console.log = originalLog;

  const app = require('../src/app');
  server = await listen(app);
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const testId = crypto.randomUUID().replaceAll('-', '');
  testEmail = `codex-step9-${testId}@example.test`;
  testPassword = `Step9A1!${testId}`;

  const initialAvatarFiles = getAvatarFiles();
  const register = await request(
    '/register',
    urlEncoded({
      confirmPassword: testPassword,
      email: testEmail,
      name: 'Người Dùng Kiểm Thử',
      password: testPassword,
    }),
  );
  checkEqual(register.status, 303, 'Đăng ký phải redirect 303.');
  check(
    register.location.endsWith('/login?registered=1'),
    'Đăng ký phải chuyển về login.',
  );

  const login = await request(
    '/login',
    urlEncoded({
      email: testEmail,
      password: testPassword,
    }),
  );
  checkEqual(login.status, 303, 'Đăng nhập phải redirect 303.');
  check(login.location.endsWith('/'), 'Đăng nhập phải chuyển về home.');
  sessionCookie = login.setCookie.split(';', 1)[0];
  check(Boolean(sessionCookie), 'Đăng nhập phải tạo session cookie.');

  const profile = await request('/profile', { authenticated: true });
  checkEqual(profile.status, 200, 'User phải mở được profile.');
  check(
    profile.text.includes('Người Dùng Kiểm Thử'),
    'Profile phải hiển thị đúng tên.',
  );
  check(
    !profile.text.includes('password') && !profile.text.includes('session'),
    'Profile không được hiển thị password/session.',
  );
  check(
    profile.text.includes('data-stat="total">0') &&
      profile.text.includes('data-stat="active">0') &&
      profile.text.includes('data-stat="sold">0') &&
      profile.text.includes('data-stat="hidden">0'),
    'Tài khoản test không có Listing phải có thống kê bằng 0.',
  );
  check(
    profile.text.includes('Bạn chưa có bài đăng nào.'),
    'Profile phải có empty state Listing gần đây.',
  );

  const edit = await request('/profile/edit', { authenticated: true });
  checkEqual(edit.status, 200, 'User phải mở được edit profile.');
  check(
    /id="profileEmail"[\s\S]*?disabled>/.test(edit.text),
    'Email phải read-only.',
  );
  check(
    !/name="(?:email|password|role|status|userId)"/.test(edit.text),
    'Form không được có field nhạy cảm.',
  );

  const User = require('../src/models/User');
  const testUser = await User.findOne({ email: testEmail })
    .select('_id')
    .lean();
  check(Boolean(testUser), 'User test phải tồn tại sau đăng nhập.');
  testUserId = testUser._id.toString();

  const Category = require('../src/models/Category');
  const Listing = require('../src/models/Listing');
  const activeCategory = await Category.findOne({ status: 'active' })
    .select('_id slug')
    .lean();
  check(Boolean(activeCategory), 'Cần ít nhất một Category active cho E2E.');
  const categoryDetail = await request(
    `/categories/${encodeURIComponent(activeCategory.slug)}`,
  );
  checkEqual(categoryDetail.status, 200, 'Category detail phải hoạt động.');
  const userAdminPage = await request('/admin/categories', {
    authenticated: true,
  });
  checkEqual(userAdminPage.status, 403, 'USER không được vào trang admin.');

  const listingKeyword = `step9-${testId}`;
  const hiddenTitle = `Không ảnh ${listingKeyword}`;
  const imageTitle = `Có ảnh ${listingKeyword}`;
  const invalidListingForm = createListingForm(
    activeCategory._id.toString(),
    { title: `Sai ảnh ${listingKeyword}` },
  );
  invalidListingForm.append(
    'images',
    new Blob(['<svg>invalid-listing</svg>'], {
      type: 'image/svg+xml',
    }),
    'invalid.svg',
  );
  const invalidListingUpload = await request('/listings', {
    authenticated: true,
    body: invalidListingForm,
    method: 'POST',
  });
  checkEqual(
    invalidListingUpload.status,
    422,
    'Upload Listing SVG phải bị từ chối.',
  );
  check(
    invalidListingUpload.text.includes(
      'Chỉ chấp nhận ảnh JPG, JPEG, PNG hoặc WEBP.',
    ),
    'Upload Listing sai MIME phải có lỗi tiếng Việt.',
  );
  checkEqual(
    await Listing.countDocuments({
      seller: testUserId,
      title: `Sai ảnh ${listingKeyword}`,
    }),
    0,
    'Listing upload sai MIME không được tạo.',
  );

  const createWithoutImage = await request('/listings', {
    authenticated: true,
    body: createListingForm(activeCategory._id.toString(), {
      title: hiddenTitle,
    }),
    method: 'POST',
  });
  checkEqual(
    createWithoutImage.status,
    303,
    'Tạo Listing không ảnh phải thành công.',
  );
  const firstListingMatch = createWithoutImage.location.match(
    /\/listings\/([0-9a-f]{24})\?created=1$/i,
  );
  check(firstListingMatch, 'Redirect phải chứa ID Listing mới.');
  const firstListingId = firstListingMatch[1];
  testListingIds.add(firstListingId);
  const listingWithoutImageDetail = await request(
    `/listings/${firstListingId}`,
    { authenticated: true },
  );
  checkEqual(listingWithoutImageDetail.status, 200);
  check(
    listingWithoutImageDetail.text.includes(
      '/images/listing-placeholder.svg',
    ),
    'Listing không ảnh phải dùng placeholder.',
  );

  const createWithImage = await request('/listings', {
    authenticated: true,
    body: createListingForm(
      activeCategory._id.toString(),
      { title: imageTitle },
      true,
    ),
    method: 'POST',
  });
  checkEqual(
    createWithImage.status,
    303,
    'Tạo Listing có ảnh phải thành công.',
  );
  const secondListingMatch = createWithImage.location.match(
    /\/listings\/([0-9a-f]{24})\?created=1$/i,
  );
  check(secondListingMatch, 'Redirect phải chứa ID Listing có ảnh.');
  const secondListingId = secondListingMatch[1];
  testListingIds.add(secondListingId);
  const ownerEdit = await request(`/listings/${secondListingId}/edit`, {
    authenticated: true,
  });
  checkEqual(ownerEdit.status, 200, 'Owner phải mở được edit Listing.');

  const listingWithImage = await Listing.findById(secondListingId)
    .select('images seller')
    .lean();
  checkEqual(
    listingWithImage.seller.toString(),
    testUserId,
  );
  checkEqual(listingWithImage.images.length, 1);
  const originalListingImage = listingWithImage.images[0];
  testListingImagePaths.add(originalListingImage);
  check(
    fs.existsSync(
      path.resolve(
        __dirname,
        '..',
        'uploads',
        'listings',
        path.basename(originalListingImage),
      ),
    ),
    'Ảnh Listing mới phải tồn tại trên disk.',
  );
  const listingGallery = await request(`/listings/${secondListingId}`, {
    authenticated: true,
  });
  check(
    listingGallery.text.includes(originalListingImage),
    'Listing detail phải hiển thị gallery ảnh đã upload.',
  );

  const keepImageUpdate = await request(
    `/listings/${secondListingId}?_method=PUT`,
    {
      authenticated: true,
      body: createListingForm(activeCategory._id.toString(), {
        title: `${imageTitle} đã sửa`,
      }),
      method: 'POST',
    },
  );
  checkEqual(keepImageUpdate.status, 303, 'Sửa Listing phải thành công.');
  const afterKeepImage = await Listing.findById(secondListingId)
    .select('images title')
    .lean();
  checkEqual(afterKeepImage.images[0], originalListingImage);

  const replaceImageForm = createListingForm(
    activeCategory._id.toString(),
    { title: `${imageTitle} thay ảnh` },
    true,
  );
  replaceImageForm.append('removeImages', originalListingImage);
  const replaceImageUpdate = await request(
    `/listings/${secondListingId}?_method=PUT`,
    {
      authenticated: true,
      body: replaceImageForm,
      method: 'POST',
    },
  );
  checkEqual(
    replaceImageUpdate.status,
    303,
    'Thay ảnh Listing phải thành công.',
  );
  const afterReplaceImage = await Listing.findById(secondListingId)
    .select('images')
    .lean();
  checkEqual(afterReplaceImage.images.length, 1);
  check(
    afterReplaceImage.images[0] !== originalListingImage,
    'Ảnh Listing mới phải có UUID khác.',
  );
  testListingImagePaths.add(afterReplaceImage.images[0]);
  check(
    !fs.existsSync(
      path.resolve(
        __dirname,
        '..',
        'uploads',
        'listings',
        path.basename(originalListingImage),
      ),
    ),
    'Ảnh Listing cũ phải bị xóa sau database update.',
  );

  for (const status of ['sold', 'active', 'sold']) {
    const statusUpdate = await request(
      `/listings/${secondListingId}/status?_method=PATCH`,
      {
        ...urlEncoded({ status }),
        authenticated: true,
      },
    );
    checkEqual(
      statusUpdate.status,
      303,
      `Chuyển trạng thái ${status} phải thành công.`,
    );
  }

  const hideListing = await request(
    `/listings/${firstListingId}?_method=DELETE`,
    {
      authenticated: true,
      body: new URLSearchParams(),
      method: 'POST',
    },
  );
  checkEqual(hideListing.status, 303, 'Soft delete phải thành công.');
  const hiddenListing = await Listing.findById(firstListingId)
    .select('status')
    .lean();
  checkEqual(hiddenListing.status, 'hidden');

  const profileWithListings = await request('/profile', {
    authenticated: true,
  });
  check(
    profileWithListings.text.includes('data-stat="total">2') &&
      profileWithListings.text.includes('data-stat="active">0') &&
      profileWithListings.text.includes('data-stat="sold">1') &&
      profileWithListings.text.includes('data-stat="hidden">1'),
    'Thống kê phải tính đúng active/sold/hidden của User test.',
  );
  check(
    profileWithListings.text.includes(hiddenTitle) &&
      profileWithListings.text.includes(`${imageTitle} thay ảnh`) &&
      profileWithListings.text.includes('Đã ẩn') &&
      profileWithListings.text.includes('Đã bán'),
    'Listing gần đây phải gồm sold và hidden của owner.',
  );
  const myListings = await request('/my-listings', {
    authenticated: true,
  });
  checkEqual(myListings.status, 200, 'My Listings phải hoạt động.');
  check(
    myListings.text.includes(hiddenTitle) &&
      myListings.text.includes(`${imageTitle} thay ảnh`),
    'My Listings phải hiển thị cả sold và hidden của owner.',
  );

  const filteredSearch = await request(
    `/listings?keyword=${encodeURIComponent(listingKeyword)}` +
      `&category=${encodeURIComponent(activeCategory.slug)}` +
      '&condition=used&minPrice=100000&maxPrice=200000' +
      '&location=HCM&status=sold&sort=price-desc&page=1',
  );
  checkEqual(filteredSearch.status, 200);
  check(
    filteredSearch.text.includes(`${imageTitle} thay ảnh`),
    'Search phải thấy Listing sold phù hợp.',
  );
  check(
    !filteredSearch.text.includes(hiddenTitle),
    'Search public không được thấy Listing hidden.',
  );
  const pageOverflow = await request(
    `/listings?keyword=${encodeURIComponent(listingKeyword)}&page=10000`,
  );
  checkEqual(pageOverflow.status, 302, 'Page vượt phạm vi phải redirect.');

  const updateForm = createProfileForm(
    {
      avatarPath: '/uploads/listings/other.jpg',
      email: 'attacker@example.test',
      password: 'ChangedPassword123',
      role: 'admin',
      status: 'blocked',
      userId: '507f1f77bcf86cd799439099',
    },
    true,
  );
  const update = await request('/profile?_method=PUT', {
    authenticated: true,
    body: updateForm,
    method: 'POST',
  });
  checkEqual(update.status, 303, 'Update profile phải redirect 303.');
  check(
    update.location.endsWith('/profile?updated=1'),
    'Update phải chuyển về profile.',
  );

  const userAfterUpdate = await User.findOne({ email: testEmail })
    .select('_id name email phone address avatar role status')
    .lean();
  check(Boolean(userAfterUpdate), 'User test phải tồn tại sau update.');
  testUserId = userAfterUpdate._id.toString();
  checkEqual(userAfterUpdate.name, 'Người Dùng Đã Cập Nhật');
  checkEqual(userAfterUpdate.phone, '+84 912-345-678');
  checkEqual(userAfterUpdate.address, 'Quận 4, TP.HCM');
  checkEqual(userAfterUpdate.email, testEmail, 'Email phải được giữ nguyên.');
  checkEqual(userAfterUpdate.role, 'user', 'Role phải được giữ nguyên.');
  checkEqual(userAfterUpdate.status, 'active', 'Status phải được giữ nguyên.');
  check(
    /^\/uploads\/avatars\/[0-9a-f-]+\.png$/i.test(
      userAfterUpdate.avatar,
    ),
    'MongoDB phải lưu public avatar path PNG.',
  );
  testAvatarPaths.add(userAfterUpdate.avatar);
  check(
    fs.existsSync(getAvatarDiskPath(userAfterUpdate.avatar)),
    'Avatar phải tồn tại trên disk sau update.',
  );

  const updatedProfile = await request('/profile?updated=1', {
    authenticated: true,
  });
  checkEqual(updatedProfile.status, 200);
  check(
    updatedProfile.text.includes('Cập nhật hồ sơ thành công.'),
    'Chỉ hiển thị success message cố định.',
  );
  check(
    updatedProfile.text.includes('Người Dùng Đã Cập Nhật'),
    'Header/profile phải hiển thị tên mới.',
  );
  check(
    updatedProfile.text.includes(userAfterUpdate.avatar),
    'Header/profile phải hiển thị avatar mới.',
  );
  check(
    !updatedProfile.text.includes('Quản lý danh mục'),
    'USER không được biến thành ADMIN.',
  );

  const listingAfterAvatarUpdate = await request(
    `/listings/${secondListingId}`,
    { authenticated: true },
  );
  checkEqual(listingAfterAvatarUpdate.status, 200);
  check(
    listingAfterAvatarUpdate.text.includes(userAfterUpdate.avatar) &&
      listingAfterAvatarUpdate.text.includes('Người Dùng Đã Cập Nhật'),
    'Listing seller phải lấy name/avatar mới từ User populate.',
  );

  const remove = await request('/profile?_method=PUT', {
    authenticated: true,
    body: createProfileForm({ removeAvatar: '1' }),
    method: 'POST',
  });
  checkEqual(remove.status, 303, 'Xóa avatar phải redirect 303.');

  const userAfterRemove = await User.findOne({ email: testEmail })
    .select('avatar')
    .lean();
  checkEqual(userAfterRemove.avatar, '', 'Avatar phải trở về chuỗi rỗng.');
  check(
    !fs.existsSync(getAvatarDiskPath(userAfterUpdate.avatar)),
    'Avatar cũ phải bị xóa sau database update.',
  );
  const removedProfile = await request('/profile', {
    authenticated: true,
  });
  check(
    removedProfile.text.includes(DEFAULT_AVATAR),
    'Placeholder phải xuất hiện sau khi xóa avatar.',
  );
  const listingAfterAvatarRemove = await request(
    `/listings/${secondListingId}`,
    { authenticated: true },
  );
  check(
    listingAfterAvatarRemove.text.includes(DEFAULT_AVATAR),
    'Listing seller phải dùng placeholder sau khi xóa avatar.',
  );

  const beforeInvalidFiles = getAvatarFiles().sort();
  const invalid = await request('/profile?_method=PUT', {
    authenticated: true,
    body: createProfileForm(
      {
        name: 'A',
        phone: 'invalid.phone',
      },
      true,
    ),
    method: 'POST',
  });
  checkEqual(invalid.status, 422, 'Validation text lỗi phải trả 422.');
  check(
    invalid.text.includes('Họ và tên phải có từ 2 đến 100 ký tự.'),
    'Validation phải hiển thị lỗi tiếng Việt.',
  );
  check(
    invalid.text.includes('Vui lòng chọn lại ảnh'),
    'Form phải yêu cầu chọn lại avatar.',
  );
  check(
    getAvatarFiles().sort().join('|') === beforeInvalidFiles.join('|'),
    'Validation lỗi không được để avatar mồ côi.',
  );

  const longAddress = await request('/profile?_method=PUT', {
    authenticated: true,
    body: createProfileForm({ address: 'A'.repeat(201) }),
    method: 'POST',
  });
  checkEqual(longAddress.status, 422, 'Address quá dài phải trả 422.');

  const noAvatarChange = await request('/profile?_method=PUT', {
    authenticated: true,
    body: createProfileForm({ name: 'Tên Chỉ Đổi Text' }),
    method: 'POST',
  });
  checkEqual(noAvatarChange.status, 303);
  const userAfterTextOnly = await User.findOne({ email: testEmail })
    .select('name avatar')
    .lean();
  checkEqual(userAfterTextOnly.name, 'Tên Chỉ Đổi Text');
  checkEqual(userAfterTextOnly.avatar, '');

  await User.updateOne(
    { _id: testUserId, email: testEmail },
    { $set: { role: 'admin' } },
  );
  const adminPage = await request('/admin/categories', {
    authenticated: true,
  });
  checkEqual(adminPage.status, 200, 'ADMIN test phải vào được quản lý Category.');

  const testCategoryName = `Danh mục Step 9 ${testId}`;
  const createCategory = await request(
    '/admin/categories',
    {
      ...urlEncoded({
        description: 'Danh mục chỉ dùng cho E2E và sẽ được xóa.',
        image: '',
        name: testCategoryName,
        status: 'active',
      }),
      authenticated: true,
    },
  );
  checkEqual(createCategory.status, 303, 'ADMIN phải tạo được Category.');
  const createdCategory = await Category.findOne({
    name: testCategoryName,
  })
    .select('_id slug status')
    .lean();
  check(Boolean(createdCategory), 'Category test phải được lưu.');
  testCategoryIds.add(createdCategory._id.toString());

  const activeCategoryDetail = await request(
    `/categories/${encodeURIComponent(createdCategory.slug)}`,
  );
  checkEqual(activeCategoryDetail.status, 200);
  const deactivateCategory = await request(
    `/admin/categories/${createdCategory._id}/status?_method=PATCH`,
    {
      ...urlEncoded({ status: 'inactive' }),
      authenticated: true,
    },
  );
  checkEqual(
    deactivateCategory.status,
    303,
    'ADMIN phải chuyển Category inactive được.',
  );
  const inactiveCategoryDetail = await request(
    `/categories/${encodeURIComponent(createdCategory.slug)}`,
  );
  checkEqual(
    inactiveCategoryDetail.status,
    404,
    'Category inactive không được public.',
  );
  const reactivateCategory = await request(
    `/admin/categories/${createdCategory._id}/status?_method=PATCH`,
    {
      ...urlEncoded({ status: 'active' }),
      authenticated: true,
    },
  );
  checkEqual(
    reactivateCategory.status,
    303,
    'ADMIN phải kích hoạt lại Category được.',
  );
  await User.updateOne(
    { _id: testUserId, email: testEmail },
    { $set: { role: 'user' } },
  );
  const userAdminPageAfterRestore = await request('/admin/categories', {
    authenticated: true,
  });
  checkEqual(
    userAdminPageAfterRestore.status,
    403,
    'Hạ role về USER phải mất quyền admin ngay request sau.',
  );

  const staticAvatar = await request(DEFAULT_AVATAR);
  checkEqual(staticAvatar.status, 200, 'Static avatar phải truy cập được.');
  check(
    staticAvatar.contentType.startsWith('image/svg+xml'),
    'Static avatar phải có MIME SVG.',
  );

  const category = await request('/categories');
  checkEqual(category.status, 200, 'Category public phải hoạt động.');
  const search = await request(
    '/listings?keyword=test&condition=used&status=all&sort=newest&page=1',
  );
  checkEqual(search.status, 200, 'Search hợp lệ phải hoạt động.');
  const hiddenSearch = await request('/listings?status=hidden');
  checkEqual(hiddenSearch.status, 422, 'Hidden không được tìm công khai.');
  const unknownSearch = await request('/listings?role=admin');
  checkEqual(unknownSearch.status, 422, 'Query lạ phải bị từ chối.');

  const logout = await request('/logout', {
    authenticated: true,
    method: 'POST',
  });
  checkEqual(logout.status, 303, 'Logout phải redirect 303.');
  const afterLogout = await request('/profile', { authenticated: true });
  checkEqual(afterLogout.status, 303, 'Session đã logout phải bị từ chối.');
  check(
    afterLogout.location.endsWith('/login'),
    'Sau logout profile phải chuyển về login.',
  );

  const oldPasswordLogin = await request(
    '/login',
    urlEncoded({
      email: testEmail,
      password: testPassword,
    }),
  );
  checkEqual(
    oldPasswordLogin.status,
    303,
    'Mật khẩu cũ phải tiếp tục đăng nhập được.',
  );
  sessionCookie = oldPasswordLogin.setCookie.split(';', 1)[0];

  check(
    getAvatarFiles().sort().join('|') === initialAvatarFiles.sort().join('|'),
    'E2E không được để lại avatar test.',
  );
};

const main = async () => {
  let runError = null;
  let cleanup = {
    categoriesDeleted: 0,
    listingImagesDeleted: 0,
    listingsDeleted: 0,
    sessionsDeleted: 0,
    usersDeleted: 0,
  };
  let avatarAudit = {
    avatarFileCount: 0,
    orphanCount: 0,
    referencedAvatarCount: 0,
  };

  try {
    await run();
  } catch (error) {
    runError = error;
  } finally {
    try {
      cleanup = await cleanupTestData();
      avatarAudit = await auditAvatarFiles();
    } catch (cleanupError) {
      runError ||= cleanupError;
    }

    await closeServer();

    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }

  const result = {
    assertionsPassed: runError ? 0 : assertionCount,
    avatarAudit,
    cleanup,
    passed: !runError,
    testAccountKept: false,
    testAvatarKept: false,
  };

  console.log(JSON.stringify(result));

  if (runError) {
    console.error(
      JSON.stringify({
        error: runError.name || 'Error',
      }),
    );
    process.exit(1);
  }

  process.exit(0);
};

void main();
