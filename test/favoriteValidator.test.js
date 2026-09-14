const assert = require('node:assert/strict');
const { test } = require('node:test');
const { validationResult } = require('express-validator');

const {
  favoriteListingIdValidator,
  favoritesPageValidator,
} = require('../src/validators/favorite.validator');

const runValidators = async (validators, req) => {
  const middleware = Array.isArray(validators) ? validators : [validators];

  for (const validator of middleware) {
    await new Promise((resolve, reject) => {
      validator(req, {}, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  return validationResult(req);
};

test('validator Favorite nhận ObjectId hợp lệ và từ chối giá trị bất thường', async () => {
  const validRequest = {
    params: { id: '507f1f77bcf86cd799439011' },
    query: {},
    body: {},
  };
  const validResult = await runValidators(
    favoriteListingIdValidator,
    validRequest,
  );
  assert.equal(validResult.isEmpty(), true);

  for (const id of ['sai-id', '', { $ne: null }, ['507f1f77bcf86cd799439011']]) {
    const req = { params: { id }, query: {}, body: {} };
    const result = await runValidators(favoriteListingIdValidator, req);
    assert.equal(result.isEmpty(), false);
  }
});

test('validator trang Favorites chỉ nhận scalar integer từ 1 đến 10000', async () => {
  for (const page of [undefined, '1', '12', '10000']) {
    const query = page === undefined ? {} : { page };
    const req = { params: {}, query, body: {} };
    const result = await runValidators(favoritesPageValidator, req);
    assert.equal(result.isEmpty(), true, String(page));
  }

  for (const page of ['0', '-1', 'abc', '1.5', '10001', ['1'], { $gt: 0 }]) {
    const req = { params: {}, query: { page }, body: {} };
    const result = await runValidators(favoritesPageValidator, req);
    assert.equal(result.isEmpty(), false, String(page));
  }
});

test('validator trang Favorites từ chối query field không hỗ trợ', async () => {
  const req = {
    params: {},
    query: { page: '1', userId: '507f1f77bcf86cd799439011' },
    body: {},
  };
  const result = await runValidators(favoritesPageValidator, req);

  assert.equal(result.isEmpty(), false);
});
