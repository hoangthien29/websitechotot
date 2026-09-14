const assert = require('node:assert/strict');
const { test } = require('node:test');
const { validationResult } = require('express-validator');

const {
  createCategoryValidator,
  updateCategoryValidator,
} = require('../src/validators/category.validator');

const validate = async (validators, body) => {
  const req = { body };

  for (const validator of validators) {
    await validator.run(req);
  }

  return validationResult(req).mapped();
};

test('Category validator nhận form text hợp lệ khi không có ảnh', async () => {
  const errors = await validate(createCategoryValidator, {
    name: 'Điện thoại',
    description: 'Thiết bị di động',
    status: 'active',
  });

  assert.deepEqual(errors, {});
});

test('removeImage chỉ nhận 1/on và không nhận object hoặc array', async () => {
  for (const removeImage of ['1', 'on']) {
    const errors = await validate(updateCategoryValidator, {
      name: 'Điện thoại',
      description: '',
      removeImage,
      status: 'inactive',
    });
    assert.deepEqual(errors, {});
  }

  for (const removeImage of ['true', '../image', ['1'], { value: '1' }]) {
    const errors = await validate(updateCategoryValidator, {
      name: 'Điện thoại',
      description: '',
      removeImage,
      status: 'active',
    });
    assert.ok(errors.removeImage);
  }
});

test('image path trong body không được validator biến thành dữ liệu upload', async () => {
  const errors = await validate(createCategoryValidator, {
    name: 'Điện thoại',
    description: '',
    image: 'C:\\project\\.env',
    status: 'active',
  });

  assert.equal(Object.hasOwn(errors, 'image'), false);
});
