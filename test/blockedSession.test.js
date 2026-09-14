const assert = require('node:assert/strict');
const { test } = require('node:test');

const User = require('../src/models/User');
const {
  loadCurrentUser,
} = require('../src/middlewares/auth.middleware');

const USER_ID = '507f1f77bcf86cd799439012';

const createResponse = () => ({
  locals: {},
});

test('blocked User làm session cũ bị destroy ở request tiếp theo', async (t) => {
  t.mock.method(User, 'findById', () => ({
    select() {
      return this;
    },
    lean: async () => ({
      _id: USER_ID,
      role: 'user',
      status: 'blocked',
    }),
  }));
  let destroyCalled = false;
  const req = {
    session: {
      userId: USER_ID,
      destroy(callback) {
        destroyCalled = true;
        callback();
      },
    },
  };
  const res = createResponse();
  let nextCalled = false;

  await loadCurrentUser(req, res, () => {
    nextCalled = true;
  });

  assert.equal(destroyCalled, true);
  assert.equal(nextCalled, true);
  assert.equal(req.user, null);
  assert.equal(res.locals.currentUser, null);
  assert.equal(res.locals.isAuthenticated, false);
});

test('lỗi destroy session không làm request bị treo hoặc thành 500', async (t) => {
  t.mock.method(User, 'findById', () => ({
    select() {
      return this;
    },
    lean: async () => null,
  }));
  const req = {
    session: {
      userId: USER_ID,
      destroy(callback) {
        callback(new Error('store unavailable'));
      },
    },
  };
  const res = createResponse();
  let nextValue = 'not-called';

  await loadCurrentUser(req, res, (error) => {
    nextValue = error || null;
  });

  assert.equal(nextValue, null);
  assert.equal(req.user, null);
});
