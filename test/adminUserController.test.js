const assert = require('node:assert/strict');
const { test } = require('node:test');

const adminUserController = require('../src/controllers/adminUser.controller');
const adminUserService = require('../src/services/adminUser.service');
const {
  blockUserValidator,
} = require('../src/validators/adminUser.validator');

const ADMIN_ID = '507f1f77bcf86cd799439011';
const USER_ID = '507f1f77bcf86cd799439012';

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

const createDetail = () => ({
  user: {
    _id: USER_ID,
    name: 'Nguyễn An',
    email: 'safe@example.test',
    role: 'user',
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  stats: {
    totalListings: 0,
    activeListings: 0,
    soldListings: 0,
    hiddenListings: 0,
    favoriteCount: 0,
    conversationCount: 0,
    sentMessageCount: 0,
  },
  recentListings: [],
});

test('listUsers chuẩn hóa query và render dữ liệu service', async (t) => {
  const getUsersPage = t.mock.method(
    adminUserService,
    'getUsersPage',
    async (filters) => {
      assert.equal(filters.status, 'all');
      assert.equal(filters.page, 1);
      return {
        items: [],
        pagination: {
          page: 1,
          limit: 20,
          totalItems: 0,
          totalPages: 1,
          hasPrev: false,
          hasNext: false,
        },
      };
    },
  );
  const res = createResponse();

  await adminUserController.listUsers(
    { query: {} },
    res,
    assert.fail,
  );

  assert.equal(getUsersPage.mock.callCount(), 1);
  assert.equal(res.view, 'admin/users/index');
  assert.equal(res.data.totalItems, 0);
});

test('blockUser luôn dùng admin từ session và redirect 303', async (t) => {
  t.mock.method(
    adminUserService,
    'blockUser',
    async (userId, adminId, reason) => {
      assert.equal(userId, USER_ID);
      assert.equal(adminId, ADMIN_ID);
      assert.equal(reason, 'Lý do kiểm duyệt hợp lệ');
    },
  );
  const req = {
    body: { reason: 'Lý do kiểm duyệt hợp lệ' },
    params: { id: USER_ID },
    user: { _id: ADMIN_ID },
  };
  const res = createResponse();

  await blockUserValidator.run(req);
  await adminUserController.blockUser(req, res, assert.fail);

  assert.equal(res.redirectStatus, 303);
  assert.equal(res.redirectUrl, `/admin/users/${USER_ID}?blocked=1`);
});

test('block reason sai render detail 422 và không gọi mutation', async (t) => {
  const blockUser = t.mock.method(adminUserService, 'blockUser');
  t.mock.method(
    adminUserService,
    'getUserAdminDetail',
    async () => createDetail(),
  );
  const req = {
    body: { reason: 'ngắn' },
    originalUrl: `/admin/users/${USER_ID}/block`,
    params: { id: USER_ID },
    query: {},
    user: { _id: ADMIN_ID },
  };
  const res = createResponse();

  await blockUserValidator.run(req);
  await adminUserController.blockUser(req, res, assert.fail);

  assert.equal(blockUser.mock.callCount(), 0);
  assert.equal(res.statusCode, 422);
  assert.equal(res.view, 'admin/users/show');
  assert.ok(res.data.errors.reason);
});
