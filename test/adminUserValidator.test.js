const assert = require('node:assert/strict');
const { test } = require('node:test');
const { validationResult } = require('express-validator');

const {
  adminUserIdValidator,
  adminUsersQueryValidator,
  blockUserValidator,
} = require('../src/validators/adminUser.validator');

const USER_ID = '507f1f77bcf86cd799439012';

test('query User Admin nhận whitelist scalar hợp lệ', async () => {
  const req = {
    query: {
      keyword: ' Nguyễn ',
      status: 'pending',
      role: 'user',
      sort: 'name-desc',
      page: '2',
    },
  };

  await adminUsersQueryValidator.run(req);

  assert.equal(validationResult(req).isEmpty(), true);
  assert.equal(req.query.keyword, 'Nguyễn');
  assert.equal(req.query.page, 2);
});

test('query User Admin từ chối field lạ, array và operator', async () => {
  const req = {
    query: {
      keyword: { $ne: '' },
      status: ['active'],
      role: 'admin',
      debug: '1',
    },
  };

  await adminUsersQueryValidator.run(req);
  const errors = validationResult(req).array();

  assert.ok(errors.some((error) => error.path === 'keyword'));
  assert.ok(errors.some((error) => error.path === 'status'));
  assert.ok(
    errors.some(
      (error) =>
        error.type === 'unknown_fields' ||
        error.msg.includes('không được hỗ trợ'),
    ),
  );
});

test('User id validator từ chối ObjectId sai và body status tùy ý', async () => {
  const req = {
    params: { id: '../user' },
    body: { status: 'admin' },
  };

  await adminUserIdValidator.run(req);
  const errors = validationResult(req).array();

  assert.ok(errors.some((error) => error.path === 'id'));
  assert.ok(
    errors.some(
      (error) =>
        error.type === 'unknown_fields' ||
        error.msg.includes('không được hỗ trợ'),
    ),
  );
});

test('block validator trim reason và giới hạn 10–500 ký tự', async () => {
  const validReq = {
    params: { id: USER_ID },
    body: { reason: '  Vi phạm quy định đăng tin  ' },
  };
  await blockUserValidator.run(validReq);
  assert.equal(validationResult(validReq).isEmpty(), true);
  assert.equal(validReq.body.reason, 'Vi phạm quy định đăng tin');

  const invalidReq = {
    params: { id: USER_ID },
    body: { reason: 'x'.repeat(501) },
  };
  await blockUserValidator.run(invalidReq);
  assert.ok(
    validationResult(invalidReq)
      .array()
      .some((error) => error.path === 'reason'),
  );
});
