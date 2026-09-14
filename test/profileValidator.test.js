const assert = require('node:assert/strict');
const { test } = require('node:test');
const { validationResult } = require('express-validator');

const {
  updateProfileValidator,
} = require('../src/validators/profile.validator');

const validate = async (body) => {
  const req = { body: { ...body } };

  for (const validator of updateProfileValidator) {
    await validator.run(req);
  }

  return {
    body: req.body,
    errors: validationResult(req).mapped(),
  };
};

test('chấp nhận name, phone, address và removeAvatar hợp lệ', async () => {
  const result = await validate({
    name: '  Nguyễn Văn An  ',
    phone: '+84 912-345-678',
    address: '  Quận 4, TP.HCM  ',
    removeAvatar: '1',
  });

  assert.deepEqual(result.errors, {});
  assert.equal(result.body.name, 'Nguyễn Văn An');
  assert.equal(result.body.phone, '+84 912-345-678');
  assert.equal(result.body.address, 'Quận 4, TP.HCM');
});

test('phone và address có thể để trống', async () => {
  const result = await validate({
    name: 'Nguyễn An',
    phone: '',
    address: '',
  });

  assert.deepEqual(result.errors, {});
});

test('từ chối name quá ngắn', async () => {
  const result = await validate({ name: 'A', phone: '', address: '' });

  assert.equal(
    result.errors.name.msg,
    'Họ và tên phải có từ 2 đến 100 ký tự.',
  );
});

test('từ chối phone sai ký tự hoặc sai số chữ số', async () => {
  const invalidCharacter = await validate({
    name: 'Nguyễn An',
    phone: '0912.ABC.789',
    address: '',
  });
  const invalidLength = await validate({
    name: 'Nguyễn An',
    phone: '1234567',
    address: '',
  });
  const misplacedPlus = await validate({
    name: 'Nguyễn An',
    phone: '09+12345678',
    address: '',
  });

  assert.ok(invalidCharacter.errors.phone);
  assert.equal(
    invalidLength.errors.phone.msg,
    'Số điện thoại phải có từ 8 đến 15 chữ số.',
  );
  assert.ok(misplacedPlus.errors.phone);
});

test('từ chối address dài hơn 200 ký tự', async () => {
  const result = await validate({
    name: 'Nguyễn An',
    phone: '',
    address: 'A'.repeat(201),
  });

  assert.equal(
    result.errors.address.msg,
    'Địa chỉ không được vượt quá 200 ký tự.',
  );
});

test('removeAvatar chỉ nhận 1 hoặc on', async () => {
  const one = await validate({
    name: 'Nguyễn An',
    removeAvatar: '1',
  });
  const on = await validate({
    name: 'Nguyễn An',
    removeAvatar: 'on',
  });
  const path = await validate({
    name: 'Nguyễn An',
    removeAvatar: '/uploads/avatars/other.jpg',
  });

  assert.deepEqual(one.errors, {});
  assert.deepEqual(on.errors, {});
  assert.ok(path.errors.removeAvatar);
});

test('validator không biến email, password, role hoặc status thành field cập nhật', async () => {
  const result = await validate({
    name: 'Nguyễn An',
    phone: '',
    address: '',
    email: 'attacker@example.test',
    password: 'NotUsed123',
    role: 'admin',
    status: 'blocked',
  });

  assert.deepEqual(result.errors, {});
  assert.equal(result.body.role, 'admin');
});
