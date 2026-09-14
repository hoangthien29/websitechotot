const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const profileController = require('../src/controllers/profile.controller');
const profileService = require('../src/services/profile.service');
const {
  AVATAR_UPLOAD_DIRECTORY,
} = require('../src/utils/avatarStorage');
const {
  updateProfileValidator,
} = require('../src/validators/profile.validator');

const USER_ID = '507f1f77bcf86cd799439011';
const createdFiles = new Set();

const createAvatarFixture = async (extension = 'jpg') => {
  const filename = `${crypto.randomUUID()}.${extension}`;
  const diskPath = path.join(AVATAR_UPLOAD_DIRECTORY, filename);

  await fs.mkdir(AVATAR_UPLOAD_DIRECTORY, { recursive: true });
  await fs.writeFile(diskPath, Buffer.from(`fixture-${filename}`));
  createdFiles.add(diskPath);

  return {
    diskPath,
    file: { filename },
    publicPath: `/uploads/avatars/${filename}`,
  };
};

const exists = async (filePath) =>
  fs.access(filePath).then(
    () => true,
    () => false,
  );

const createProfileUser = (avatar = '') => ({
  _id: USER_ID,
  name: 'Tên hiện tại',
  email: 'profile@example.test',
  phone: '0912345678',
  address: 'TP.HCM',
  avatar,
  role: 'user',
  status: 'active',
  createdAt: new Date('2024-01-02T00:00:00.000Z'),
  updatedAt: new Date('2024-01-02T00:00:00.000Z'),
});

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

const validateRequest = async (req) => {
  for (const validator of updateProfileValidator) {
    await validator.run(req);
  }
};

const invokeUpdate = async (req) => {
  const res = createResponse();
  let nextError = null;

  await validateRequest(req);
  await profileController.updateProfile(req, res, (error) => {
    nextError = error;
  });

  return { nextError, res };
};

afterEach(async () => {
  await Promise.all(
    [...createdFiles].map((filePath) =>
      fs.unlink(filePath).catch((error) => {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }),
    ),
  );
  createdFiles.clear();
});

test('showProfile dùng req.user, thống kê và tối đa Listing do service trả về', async (t) => {
  const profileUser = createProfileUser('');
  const overview = {
    profileUser,
    stats: {
      totalListings: 3,
      activeListings: 1,
      soldListings: 1,
      hiddenListings: 1,
    },
    recentListings: [
      {
        _id: '507f1f77bcf86cd799439021',
        title: 'Sản phẩm gần đây',
        price: 100000,
        location: 'TP.HCM',
        condition: 'used',
        images: [],
        status: 'hidden',
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
      },
    ],
  };
  const getOverview = t.mock.method(
    profileService,
    'getProfileOverview',
    async (userId) => {
      assert.equal(userId, USER_ID);
      return overview;
    },
  );
  const req = { query: { updated: 'untrusted' }, user: { _id: USER_ID } };
  const res = createResponse();
  let nextError = null;

  await profileController.showProfile(req, res, (error) => {
    nextError = error;
  });

  assert.equal(nextError, null);
  assert.equal(getOverview.mock.callCount(), 1);
  assert.equal(res.view, 'profile/index');
  assert.equal(res.data.profileUser.avatarUrl, '/images/default-avatar.svg');
  assert.equal(res.data.recentListings[0].statusLabel, 'Đã ẩn');
  assert.equal(res.data.successMessage, '');
});

test('showEditProfile dùng User hiện tại và không lấy userId từ request', async (t) => {
  const profileUser = createProfileUser('');
  const getProfileUser = t.mock.method(
    profileService,
    'getProfileUser',
    async (userId) => {
      assert.equal(userId, USER_ID);
      return profileUser;
    },
  );
  const req = {
    body: { userId: '507f1f77bcf86cd799439099' },
    params: { userId: '507f1f77bcf86cd799439098' },
    user: { _id: USER_ID },
  };
  const res = createResponse();

  await profileController.showEditProfile(req, res, assert.fail);

  assert.equal(getProfileUser.mock.callCount(), 1);
  assert.equal(res.view, 'profile/edit');
  assert.equal(res.data.profileUser.email, profileUser.email);
});

test('validation lỗi xóa avatar mới, giữ avatar cũ và không update database', async (t) => {
  const oldAvatar = await createAvatarFixture();
  const newAvatar = await createAvatarFixture('png');
  const profileUser = createProfileUser(oldAvatar.publicPath);
  t.mock.method(
    profileService,
    'getProfileUser',
    async () => profileUser,
  );
  const updateProfile = t.mock.method(
    profileService,
    'updateProfile',
    async () => assert.fail('Không được cập nhật khi validation lỗi'),
  );
  const req = {
    avatarUploadError: null,
    body: {
      name: 'A',
      phone: '',
      address: '',
    },
    file: newAvatar.file,
    user: { _id: USER_ID, avatar: oldAvatar.publicPath },
  };

  const { nextError, res } = await invokeUpdate(req);

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 422);
  assert.equal(res.view, 'profile/edit');
  assert.ok(res.data.errors.name);
  assert.equal(updateProfile.mock.callCount(), 0);
  assert.equal(await exists(newAvatar.diskPath), false);
  assert.equal(await exists(oldAvatar.diskPath), true);
});

test('thay avatar update database trước, xóa avatar cũ và bỏ qua field cấm', async (t) => {
  const oldAvatar = await createAvatarFixture();
  const newAvatar = await createAvatarFixture('webp');
  const profileUser = createProfileUser(oldAvatar.publicPath);
  let updateData;
  t.mock.method(
    profileService,
    'getProfileUser',
    async () => profileUser,
  );
  t.mock.method(
    profileService,
    'updateProfile',
    async (userId, data) => {
      assert.equal(await exists(oldAvatar.diskPath), true);
      assert.equal(userId, USER_ID);
      updateData = data;
      return { ...profileUser, ...data };
    },
  );
  const req = {
    body: {
      name: '  Tên mới  ',
      phone: '+84 912-345-678',
      address: '  Địa chỉ mới  ',
      email: 'attacker@example.test',
      password: 'Changed123',
      role: 'admin',
      status: 'blocked',
      _id: '507f1f77bcf86cd799439099',
      userId: '507f1f77bcf86cd799439098',
    },
    file: newAvatar.file,
    params: { userId: '507f1f77bcf86cd799439097' },
    user: { _id: USER_ID, avatar: oldAvatar.publicPath },
  };

  const { nextError, res } = await invokeUpdate(req);

  assert.equal(nextError, null);
  assert.deepEqual(updateData, {
    name: 'Tên mới',
    phone: '+84 912-345-678',
    address: 'Địa chỉ mới',
    avatar: newAvatar.publicPath,
  });
  assert.equal(Object.hasOwn(updateData, 'role'), false);
  assert.equal(Object.hasOwn(updateData, 'status'), false);
  assert.equal(Object.hasOwn(updateData, 'email'), false);
  assert.equal(Object.hasOwn(updateData, 'password'), false);
  assert.equal(await exists(oldAvatar.diskPath), false);
  assert.equal(await exists(newAvatar.diskPath), true);
  assert.equal(res.redirectStatus, 303);
  assert.equal(res.redirectUrl, '/profile?updated=1');
});

test('xóa avatar cập nhật chuỗi rỗng trước rồi mới xóa file', async (t) => {
  const oldAvatar = await createAvatarFixture();
  const profileUser = createProfileUser(oldAvatar.publicPath);
  let avatarAtUpdate = null;
  t.mock.method(
    profileService,
    'getProfileUser',
    async () => profileUser,
  );
  t.mock.method(
    profileService,
    'updateProfile',
    async (userId, data) => {
      assert.equal(userId, USER_ID);
      assert.equal(await exists(oldAvatar.diskPath), true);
      avatarAtUpdate = data.avatar;
      return { ...profileUser, ...data };
    },
  );
  const req = {
    body: {
      name: 'Tên hiện tại',
      phone: '0912345678',
      address: 'TP.HCM',
      removeAvatar: '1',
    },
    user: { _id: USER_ID, avatar: oldAvatar.publicPath },
  };

  const { nextError, res } = await invokeUpdate(req);

  assert.equal(nextError, null);
  assert.equal(avatarAtUpdate, '');
  assert.equal(await exists(oldAvatar.diskPath), false);
  assert.equal(res.redirectStatus, 303);
});

test('update text không đổi avatar thì không tạo hoặc xóa file', async (t) => {
  const oldAvatar = await createAvatarFixture();
  const profileUser = createProfileUser(oldAvatar.publicPath);
  let updateData;
  t.mock.method(
    profileService,
    'getProfileUser',
    async () => profileUser,
  );
  t.mock.method(
    profileService,
    'updateProfile',
    async (userId, data) => {
      assert.equal(userId, USER_ID);
      updateData = data;
      return { ...profileUser, ...data };
    },
  );
  const req = {
    body: {
      name: 'Tên chỉ đổi text',
      phone: '',
      address: '',
    },
    user: { _id: USER_ID, avatar: oldAvatar.publicPath },
  };

  const { nextError } = await invokeUpdate(req);

  assert.equal(nextError, null);
  assert.equal(updateData.avatar, oldAvatar.publicPath);
  assert.equal(await exists(oldAvatar.diskPath), true);
});

test('database update lỗi xóa avatar mới và giữ avatar cũ', async (t) => {
  const oldAvatar = await createAvatarFixture();
  const newAvatar = await createAvatarFixture('png');
  const profileUser = createProfileUser(oldAvatar.publicPath);
  const databaseError = new Error('Synthetic database failure');
  t.mock.method(
    profileService,
    'getProfileUser',
    async () => profileUser,
  );
  t.mock.method(
    profileService,
    'updateProfile',
    async () => {
      throw databaseError;
    },
  );
  const req = {
    body: {
      name: 'Tên hợp lệ',
      phone: '',
      address: '',
    },
    file: newAvatar.file,
    user: { _id: USER_ID, avatar: oldAvatar.publicPath },
  };

  const { nextError } = await invokeUpdate(req);

  assert.equal(nextError, databaseError);
  assert.equal(await exists(newAvatar.diskPath), false);
  assert.equal(await exists(oldAvatar.diskPath), true);
});

test('lỗi đọc User sau upload cũng cleanup avatar mới', async (t) => {
  const newAvatar = await createAvatarFixture();
  const databaseError = new Error('Synthetic read failure');
  t.mock.method(
    profileService,
    'getProfileUser',
    async () => {
      throw databaseError;
    },
  );
  const req = {
    body: {
      name: 'Tên hợp lệ',
      phone: '',
      address: '',
    },
    file: newAvatar.file,
    user: { _id: USER_ID, avatar: '' },
  };

  const { nextError } = await invokeUpdate(req);

  assert.equal(nextError, databaseError);
  assert.equal(await exists(newAvatar.diskPath), false);
});
