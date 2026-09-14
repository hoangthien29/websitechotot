const assert = require('node:assert/strict');
const { test } = require('node:test');

const Listing = require('../src/models/Listing');
const User = require('../src/models/User');
const profileService = require('../src/services/profile.service');

const USER_ID = '507f1f77bcf86cd799439011';
const OTHER_USER_ID = '507f1f77bcf86cd799439012';
const MANAGED_AVATAR =
  '/uploads/avatars/123e4567-e89b-42d3-a456-426614174000.jpg';

const createLeanQuery = (value) => ({
  select() {
    return this;
  },
  populate() {
    return this;
  },
  sort() {
    return this;
  },
  limit() {
    return this;
  },
  lean() {
    return Promise.resolve(value);
  },
});

test('getProfileOverview đếm đúng seller và lấy tối đa 4 Listing gần đây', async (t) => {
  const countFilters = [];
  const findFilters = [];
  const profileUser = {
    _id: USER_ID,
    name: 'Nguyễn An',
    email: 'profile@example.test',
  };
  const recentListings = [
    {
      _id: '507f1f77bcf86cd799439021',
      title: 'Sản phẩm gần đây',
      seller: USER_ID,
    },
  ];
  const statusCounts = {
    active: 3,
    sold: 2,
    hidden: 1,
  };

  t.mock.method(User, 'findById', (userId) => {
    assert.equal(userId, USER_ID);
    return createLeanQuery(profileUser);
  });
  t.mock.method(Listing, 'countDocuments', (filter) => {
    countFilters.push(filter);
    return Promise.resolve(statusCounts[filter.status]);
  });
  t.mock.method(Listing, 'find', (filter) => {
    findFilters.push(filter);
    const query = createLeanQuery(recentListings);
    const originalLimit = query.limit;
    query.limit = (limit) => {
      assert.equal(limit, profileService.RECENT_LISTINGS_LIMIT);
      return originalLimit.call(query);
    };
    return query;
  });

  const overview = await profileService.getProfileOverview(USER_ID);

  assert.equal(overview.profileUser, profileUser);
  assert.deepEqual(overview.stats, {
    totalListings: 6,
    activeListings: 3,
    soldListings: 2,
    hiddenListings: 1,
  });
  assert.equal(overview.recentListings, recentListings);
  assert.deepEqual(
    countFilters.map((filter) => filter.seller),
    [USER_ID, USER_ID, USER_ID],
  );
  assert.deepEqual(findFilters, [{ seller: USER_ID }]);
  assert.equal(
    countFilters.some((filter) => filter.seller === OTHER_USER_ID),
    false,
  );
});

test('getProfileOverview không query với userId không hợp lệ', async (t) => {
  const findById = t.mock.method(User, 'findById', () => {
    throw new Error('Không được gọi');
  });
  const countDocuments = t.mock.method(Listing, 'countDocuments', () => {
    throw new Error('Không được gọi');
  });

  assert.equal(await profileService.getProfileOverview('../other-user'), null);
  assert.equal(findById.mock.callCount(), 0);
  assert.equal(countDocuments.mock.callCount(), 0);
});

test('updateProfile chỉ gán field được phép và chuẩn hóa text', async (t) => {
  const user = {
    _id: USER_ID,
    name: 'Tên cũ',
    phone: '',
    address: '',
    avatar: '',
    email: 'original@example.test',
    password: 'hash-kept',
    role: 'user',
    status: 'active',
    async save() {
      return this;
    },
  };

  t.mock.method(User, 'findById', (userId) => ({
    select: async () => {
      assert.equal(userId, USER_ID);
      return user;
    },
  }));

  const updated = await profileService.updateProfile(USER_ID, {
    name: '  Tên mới  ',
    phone: '  +84 912 345 678  ',
    address: '  TP.HCM  ',
    avatar: MANAGED_AVATAR,
    email: 'attacker@example.test',
    password: 'changed',
    role: 'admin',
    status: 'blocked',
  });

  assert.equal(updated.name, 'Tên mới');
  assert.equal(updated.phone, '+84 912 345 678');
  assert.equal(updated.address, 'TP.HCM');
  assert.equal(updated.avatar, MANAGED_AVATAR);
  assert.equal(updated.email, 'original@example.test');
  assert.equal(updated.password, 'hash-kept');
  assert.equal(updated.role, 'user');
  assert.equal(updated.status, 'active');
});

test('updateProfile từ chối avatar path ngoài thư mục managed', async (t) => {
  const user = {
    avatar: '',
    save: async () => user,
  };
  t.mock.method(User, 'findById', () => ({
    select: async () => user,
  }));

  await assert.rejects(
    profileService.updateProfile(USER_ID, {
      name: 'Nguyễn An',
      phone: '',
      address: '',
      avatar: '/uploads/listings/not-an-avatar.jpg',
    }),
    (error) => error.code === profileService.INVALID_PROFILE_AVATAR,
  );
});

test('updateProfile báo không tìm thấy khi userId hoặc User không hợp lệ', async (t) => {
  await assert.rejects(
    profileService.updateProfile('../other-user', {
      name: 'Nguyễn An',
    }),
    (error) => error.code === profileService.PROFILE_USER_NOT_FOUND,
  );

  t.mock.method(User, 'findById', () => ({
    select: async () => null,
  }));

  await assert.rejects(
    profileService.updateProfile(USER_ID, {
      name: 'Nguyễn An',
    }),
    (error) => error.code === profileService.PROFILE_USER_NOT_FOUND,
  );
});
