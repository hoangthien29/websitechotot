const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const categoryController = require('../src/controllers/category.controller');
const categoryService = require('../src/services/category.service');
const {
  CATEGORY_IMAGE_UPLOAD_DIRECTORY,
} = require('../src/utils/categoryImageStorage');
const {
  createCategoryValidator,
  updateCategoryValidator,
} = require('../src/validators/category.validator');

const CATEGORY_ID = '507f1f77bcf86cd799439011';
const createdFiles = new Set();

const createImageFixture = async (extension = 'jpg') => {
  const filename = `${crypto.randomUUID()}.${extension}`;
  const diskPath = path.join(
    CATEGORY_IMAGE_UPLOAD_DIRECTORY,
    filename,
  );

  await fs.mkdir(CATEGORY_IMAGE_UPLOAD_DIRECTORY, { recursive: true });
  await fs.writeFile(diskPath, Buffer.from(`fixture-${filename}`));
  createdFiles.add(diskPath);

  return {
    diskPath,
    file: { filename },
    publicPath: `/uploads/categories/${filename}`,
  };
};

const exists = (filePath) =>
  fs.access(filePath).then(
    () => true,
    () => false,
  );

const createCategoryRecord = (image = '') => ({
  _id: CATEGORY_ID,
  name: 'Điện thoại',
  slug: 'dien-thoai',
  description: 'Thiết bị di động',
  image,
  status: 'active',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
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

const validateRequest = async (req, validators) => {
  for (const validator of validators) {
    await validator.run(req);
  }
};

const invoke = async (method, req, validators) => {
  const res = createResponse();
  let nextError = null;

  await validateRequest(req, validators);
  await categoryController[method](req, res, (error) => {
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

test('create validation lỗi xóa ảnh mới và không ghi database', async (t) => {
  const image = await createImageFixture('png');
  const createCategory = t.mock.method(
    categoryService,
    'createCategory',
    async () => assert.fail('Không được tạo khi validation lỗi'),
  );
  const req = {
    body: {
      name: 'A',
      description: '',
      status: 'active',
    },
    file: image.file,
  };

  const { nextError, res } = await invoke(
    'createCategory',
    req,
    createCategoryValidator,
  );

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 422);
  assert.equal(res.view, 'admin/categories/create');
  assert.equal(createCategory.mock.callCount(), 0);
  assert.equal(await exists(image.diskPath), false);
});

test('create duplicate hoặc database lỗi đều cleanup ảnh mới', async (t) => {
  const image = await createImageFixture();
  const duplicateError = new Error('Tên danh mục đã tồn tại.');
  duplicateError.code = categoryService.CATEGORY_ALREADY_EXISTS;
  t.mock.method(categoryService, 'createCategory', async () => {
    throw duplicateError;
  });
  const req = {
    body: {
      name: 'Điện thoại',
      description: '',
      status: 'active',
    },
    file: image.file,
  };

  const { nextError, res } = await invoke(
    'createCategory',
    req,
    createCategoryValidator,
  );

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 409);
  assert.equal(await exists(image.diskPath), false);
});

test('create thành công lưu path file server và bỏ qua image từ body', async (t) => {
  const image = await createImageFixture('webp');
  let createData;
  t.mock.method(categoryService, 'createCategory', async (data) => {
    createData = data;
    return data;
  });
  const req = {
    body: {
      name: 'Thiết bị số',
      description: 'Mô tả',
      image: 'https://attacker.example/image.jpg',
      status: 'active',
    },
    file: image.file,
  };

  const { nextError, res } = await invoke(
    'createCategory',
    req,
    createCategoryValidator,
  );

  assert.equal(nextError, null);
  assert.equal(createData.image, image.publicPath);
  assert.equal(await exists(image.diskPath), true);
  assert.equal(res.redirectStatus, 303);
  assert.equal(res.redirectUrl, '/admin/categories?created=1');
});

test('update validation lỗi xóa ảnh mới và giữ ảnh cũ', async (t) => {
  const oldImage = await createImageFixture();
  const newImage = await createImageFixture('png');
  t.mock.method(categoryService, 'getCategoryById', async () =>
    createCategoryRecord(oldImage.publicPath),
  );
  const updateCategory = t.mock.method(
    categoryService,
    'updateCategory',
    async () => assert.fail('Không được update khi validation lỗi'),
  );
  const req = {
    body: { name: 'A', description: '', status: 'active' },
    file: newImage.file,
    params: { id: CATEGORY_ID },
  };

  const { nextError, res } = await invoke(
    'updateCategory',
    req,
    updateCategoryValidator,
  );

  assert.equal(nextError, null);
  assert.equal(res.statusCode, 422);
  assert.equal(updateCategory.mock.callCount(), 0);
  assert.equal(await exists(newImage.diskPath), false);
  assert.equal(await exists(oldImage.diskPath), true);
});

test('update database lỗi xóa ảnh mới và giữ ảnh cũ', async (t) => {
  const oldImage = await createImageFixture();
  const newImage = await createImageFixture('png');
  const databaseError = new Error('Synthetic database failure');
  t.mock.method(categoryService, 'getCategoryById', async () =>
    createCategoryRecord(oldImage.publicPath),
  );
  t.mock.method(categoryService, 'updateCategory', async () => {
    throw databaseError;
  });
  const req = {
    body: {
      name: 'Tên hợp lệ',
      description: '',
      status: 'active',
    },
    file: newImage.file,
    params: { id: CATEGORY_ID },
  };

  const { nextError } = await invoke(
    'updateCategory',
    req,
    updateCategoryValidator,
  );

  assert.equal(nextError, databaseError);
  assert.equal(await exists(newImage.diskPath), false);
  assert.equal(await exists(oldImage.diskPath), true);
});

test('thay ảnh cập nhật database trước rồi mới xóa ảnh cũ', async (t) => {
  const oldImage = await createImageFixture();
  const newImage = await createImageFixture('webp');
  let updateData;
  t.mock.method(categoryService, 'getCategoryById', async () =>
    createCategoryRecord(oldImage.publicPath),
  );
  t.mock.method(categoryService, 'updateCategory', async (id, data) => {
    assert.equal(id, CATEGORY_ID);
    assert.equal(await exists(oldImage.diskPath), true);
    updateData = data;
    return { ...createCategoryRecord(), ...data };
  });
  const req = {
    body: {
      name: 'Tên hợp lệ',
      description: '',
      status: 'active',
    },
    file: newImage.file,
    params: { id: CATEGORY_ID },
  };

  const { nextError, res } = await invoke(
    'updateCategory',
    req,
    updateCategoryValidator,
  );

  assert.equal(nextError, null);
  assert.equal(updateData.image, newImage.publicPath);
  assert.equal(await exists(oldImage.diskPath), false);
  assert.equal(await exists(newImage.diskPath), true);
  assert.equal(res.redirectStatus, 303);
});

test('xóa ảnh ghi image rỗng trước rồi mới xóa file cũ', async (t) => {
  const oldImage = await createImageFixture();
  let updateData;
  t.mock.method(categoryService, 'getCategoryById', async () =>
    createCategoryRecord(oldImage.publicPath),
  );
  t.mock.method(categoryService, 'updateCategory', async (id, data) => {
    assert.equal(await exists(oldImage.diskPath), true);
    updateData = data;
    return { ...createCategoryRecord(), ...data };
  });
  const req = {
    body: {
      name: 'Tên hợp lệ',
      description: '',
      removeImage: '1',
      status: 'active',
    },
    params: { id: CATEGORY_ID },
  };

  const { nextError } = await invoke(
    'updateCategory',
    req,
    updateCategoryValidator,
  );

  assert.equal(nextError, null);
  assert.equal(updateData.image, '');
  assert.equal(await exists(oldImage.diskPath), false);
});

test('ảnh mới được ưu tiên khi đồng thời chọn removeImage', async (t) => {
  const oldImage = await createImageFixture();
  const newImage = await createImageFixture('png');
  let finalImage;
  t.mock.method(categoryService, 'getCategoryById', async () =>
    createCategoryRecord(oldImage.publicPath),
  );
  t.mock.method(categoryService, 'updateCategory', async (id, data) => {
    finalImage = data.image;
    return { ...createCategoryRecord(), ...data };
  });
  const req = {
    body: {
      name: 'Tên hợp lệ',
      description: '',
      removeImage: '1',
      status: 'active',
    },
    file: newImage.file,
    params: { id: CATEGORY_ID },
  };

  await invoke('updateCategory', req, updateCategoryValidator);

  assert.equal(finalImage, newImage.publicPath);
  assert.equal(await exists(newImage.diskPath), true);
  assert.equal(await exists(oldImage.diskPath), false);
});

test('edit text không đổi ảnh thì không xóa file', async (t) => {
  const oldImage = await createImageFixture();
  let updateData;
  t.mock.method(categoryService, 'getCategoryById', async () =>
    createCategoryRecord(oldImage.publicPath),
  );
  t.mock.method(categoryService, 'updateCategory', async (id, data) => {
    updateData = data;
    return { ...createCategoryRecord(), ...data };
  });
  const req = {
    body: {
      name: 'Tên đã đổi',
      description: 'Mô tả',
      status: 'inactive',
    },
    params: { id: CATEGORY_ID },
  };

  await invoke('updateCategory', req, updateCategoryValidator);

  assert.equal(updateData.image, oldImage.publicPath);
  assert.equal(await exists(oldImage.diskPath), true);
});

test('lỗi đọc Category sau upload vẫn cleanup ảnh mới', async (t) => {
  const newImage = await createImageFixture();
  const databaseError = new Error('Synthetic read failure');
  t.mock.method(categoryService, 'getCategoryById', async () => {
    throw databaseError;
  });
  const req = {
    body: {
      name: 'Tên hợp lệ',
      description: '',
      status: 'active',
    },
    file: newImage.file,
    params: { id: CATEGORY_ID },
  };

  const { nextError } = await invoke(
    'updateCategory',
    req,
    updateCategoryValidator,
  );

  assert.equal(nextError, databaseError);
  assert.equal(await exists(newImage.diskPath), false);
});
