const assert = require('node:assert/strict');
const { test } = require('node:test');

const User = require('../src/models/User');
const adminUserService = require('../src/services/adminUser.service');

const ADMIN_ID = '507f1f77bcf86cd799439011';
const USER_ID = '507f1f77bcf86cd799439012';

const createUserQuery = (value) => ({
  select() {
    return this;
  },
  sort() {
    return this;
  },
  skip() {
    return this;
  },
  limit(limit) {
    assert.equal(limit, adminUserService.ADMIN_USERS_PER_PAGE);
    return this;
  },
  lean: async () => value,
});

test('getUsersPage escape keyword, whitelist sort và giới hạn 20 bản ghi', async (t) => {
  let capturedFilter;
  let capturedSort;
  t.mock.method(User, 'find', (filter) => {
    capturedFilter = filter;
    const query = createUserQuery([{ _id: USER_ID }]);
    query.sort = (sort) => {
      capturedSort = sort;
      return query;
    };
    return query;
  });
  t.mock.method(User, 'countDocuments', async () => 21);

  const result = await adminUserService.getUsersPage({
    keyword: 'an (test)+',
    status: 'active',
    role: 'user',
    sort: 'name-asc',
    page: 2,
  });

  assert.equal(capturedFilter.status, 'active');
  assert.equal(capturedFilter.role, 'user');
  assert.equal(capturedFilter.$or[0].name.source, 'an \\(test\\)\\+');
  assert.deepEqual(capturedSort, { name: 1, _id: 1 });
  assert.equal(result.pagination.limit, 20);
  assert.equal(result.pagination.totalPages, 2);
});

test('approveUser chỉ cập nhật pending role=user và ghi metadata server', async (t) => {
  let capturedFilter;
  let capturedUpdate;
  t.mock.method(User, 'findOneAndUpdate', (filter, update) => {
    capturedFilter = filter;
    capturedUpdate = update;
    return { select: async () => ({ _id: USER_ID, status: 'active' }) };
  });

  await adminUserService.approveUser(USER_ID, ADMIN_ID);

  assert.deepEqual(capturedFilter, {
    _id: USER_ID,
    role: 'user',
    status: 'pending',
  });
  assert.equal(capturedUpdate.$set.status, 'active');
  assert.equal(
    capturedUpdate.$set['accountModeration.approvedBy'],
    ADMIN_ID,
  );
  assert.ok(
    capturedUpdate.$set['accountModeration.approvedAt'] instanceof Date,
  );
});

test('blockUser trim reason và không nhận role/status từ client', async (t) => {
  let capturedFilter;
  let capturedUpdate;
  t.mock.method(User, 'findOneAndUpdate', (filter, update) => {
    capturedFilter = filter;
    capturedUpdate = update;
    return { select: async () => ({ _id: USER_ID, status: 'blocked' }) };
  });

  await adminUserService.blockUser(
    USER_ID,
    ADMIN_ID,
    '  Vi phạm quy định đăng tin  ',
  );

  assert.equal(capturedFilter.role, 'user');
  assert.equal(capturedFilter.status, 'active');
  assert.equal(capturedUpdate.$set.status, 'blocked');
  assert.equal(
    capturedUpdate.$set['accountModeration.blockedReason'],
    'Vi phạm quy định đăng tin',
  );
  assert.equal(
    capturedUpdate.$set['accountModeration.blockedBy'],
    ADMIN_ID,
  );
});

test('unblockUser xóa metadata khóa hiện tại theo quy ước', async (t) => {
  let capturedUpdate;
  t.mock.method(User, 'findOneAndUpdate', (filter, update) => {
    assert.equal(filter.status, 'blocked');
    capturedUpdate = update;
    return { select: async () => ({ _id: USER_ID, status: 'active' }) };
  });

  await adminUserService.unblockUser(USER_ID, ADMIN_ID);

  assert.equal(capturedUpdate.$set.status, 'active');
  assert.equal(
    capturedUpdate.$set['accountModeration.blockedReason'],
    '',
  );
  assert.equal(capturedUpdate.$set['accountModeration.blockedAt'], null);
  assert.equal(capturedUpdate.$set['accountModeration.blockedBy'], null);
});

test('không cho tự khóa và từ chối reason ngoài 10–500 ký tự', async () => {
  await assert.rejects(
    adminUserService.blockUser(ADMIN_ID, ADMIN_ID, 'Lý do hợp lệ đủ dài'),
    (error) => error.code === adminUserService.ADMIN_USER_PROTECTED,
  );
  await assert.rejects(
    adminUserService.blockUser(USER_ID, ADMIN_ID, 'ngắn'),
    (error) => error.code === adminUserService.ADMIN_BLOCK_REASON_INVALID,
  );
});
