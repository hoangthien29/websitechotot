const assert = require('node:assert/strict');
const { test } = require('node:test');
const mongoose = require('mongoose');

const {
  loadUnreadMessageCount,
} = require('../src/middlewares/message.middleware');
const messageService = require('../src/services/message.service');

test('guest nhận unread 0 mà không query database', async (t) => {
  const countMock = t.mock.method(
    messageService,
    'countUnreadMessages',
    async () => {
      assert.fail('Guest không được query unread');
    },
  );
  const req = { user: null };
  const res = { locals: {} };
  let nextCalled = false;

  await loadUnreadMessageCount(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.locals.unreadMessageCount, 0);
  assert.equal(nextCalled, true);
  assert.equal(countMock.mock.callCount(), 0);
});

test('User chỉ query một unread count và lỗi được chuyển tới next', async (t) => {
  const userId = new mongoose.Types.ObjectId();
  const countMock = t.mock.method(
    messageService,
    'countUnreadMessages',
    async (receivedUserId) => {
      assert.equal(receivedUserId, userId);
      return 8;
    },
  );
  const res = { locals: {} };
  let nextError;

  await loadUnreadMessageCount(
    { user: { _id: userId } },
    res,
    (error) => {
      nextError = error;
    },
  );

  assert.equal(res.locals.unreadMessageCount, 8);
  assert.equal(nextError, undefined);
  assert.equal(countMock.mock.callCount(), 1);

  const expectedError = new Error('count failed');
  countMock.mock.mockImplementation(async () => {
    throw expectedError;
  });
  await loadUnreadMessageCount(
    { user: { _id: userId } },
    { locals: {} },
    (error) => {
      nextError = error;
    },
  );
  assert.equal(nextError, expectedError);
});
