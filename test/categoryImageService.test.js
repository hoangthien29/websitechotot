const assert = require('node:assert/strict');
const { test } = require('node:test');

const Category = require('../src/models/Category');
const categoryService = require('../src/services/category.service');

const CATEGORY_ID = '507f1f77bcf86cd799439011';
const MANAGED_IMAGE =
  '/uploads/categories/123e4567-e89b-42d3-a456-426614174000.jpg';

const createLeanQuery = (value) => ({
  select() {
    return this;
  },
  lean() {
    return Promise.resolve(value);
  },
});

test('Category model nhận managed path/chuỗi rỗng và từ chối path ngoài', async () => {
  for (const image of ['', MANAGED_IMAGE]) {
    const category = new Category({
      name: 'Điện thoại',
      slug: 'dien-thoai',
      image,
    });

    await assert.doesNotReject(category.validate());
  }

  for (const image of [
    'https://example.test/category.jpg',
    'C:\\uploads\\categories\\image.jpg',
    '/uploads/categories/../../.env',
    '/uploads/listings/123e4567-e89b-42d3-a456-426614174000.jpg',
  ]) {
    const category = new Category({
      name: 'Điện thoại',
      slug: 'dien-thoai',
      image,
    });

    await assert.rejects(
      category.validate(),
      (error) => Boolean(error.errors.image),
    );
  }
});

test('createCategory chỉ ghi whitelist và image đã được quản lý', async (t) => {
  let createdData;

  t.mock.method(Category, 'findOne', () => createLeanQuery(null));
  t.mock.method(Category, 'create', async (data) => {
    createdData = data;
    return data;
  });

  await categoryService.createCategory({
    _id: 'attacker-id',
    createdAt: new Date(0),
    description: '  Thiết bị di động  ',
    image: MANAGED_IMAGE,
    moderation: { hidden: true },
    name: '  Điện thoại  ',
    slug: 'client-slug',
    status: 'active',
    updatedAt: new Date(0),
  });

  assert.deepEqual(createdData, {
    name: 'Điện thoại',
    slug: 'dien-thoai',
    description: 'Thiết bị di động',
    image: MANAGED_IMAGE,
    status: 'active',
  });
});

test('service từ chối URL, absolute path và traversal trước khi ghi', async (t) => {
  const create = t.mock.method(Category, 'create', async () => {
    assert.fail('Không được tạo Category với image không hợp lệ');
  });

  for (const image of [
    'https://example.test/category.jpg',
    'C:\\uploads\\categories\\category.jpg',
    '/uploads/categories/../../.env',
    '/uploads/avatars/123e4567-e89b-42d3-a456-426614174000.jpg',
  ]) {
    await assert.rejects(
      categoryService.createCategory({
        name: 'Danh mục hợp lệ',
        description: '',
        image,
        status: 'active',
      }),
      (error) => error.code === categoryService.CATEGORY_INVALID_IMAGE,
    );
  }

  assert.equal(create.mock.callCount(), 0);
});

test('updateCategory gán tường minh và không nhận field ngoài', async (t) => {
  const category = {
    _id: CATEGORY_ID,
    name: 'Tên cũ',
    slug: 'ten-cu',
    description: '',
    image: '',
    status: 'active',
    role: 'kept',
    async save() {
      return this;
    },
  };

  t.mock.method(Category, 'findById', async (id) => {
    assert.equal(id, CATEGORY_ID);
    return category;
  });
  t.mock.method(Category, 'findOne', () => createLeanQuery(null));

  await categoryService.updateCategory(CATEGORY_ID, {
    name: '  Tên mới  ',
    description: '  Mô tả mới  ',
    image: MANAGED_IMAGE,
    status: 'inactive',
    role: 'admin',
    slug: 'client-slug',
  });

  assert.equal(category.name, 'Tên mới');
  assert.equal(category.slug, 'ten-moi');
  assert.equal(category.description, 'Mô tả mới');
  assert.equal(category.image, MANAGED_IMAGE);
  assert.equal(category.status, 'inactive');
  assert.equal(category.role, 'kept');
});

test('đổi active/inactive chỉ cập nhật status và giữ image', async (t) => {
  let update;

  t.mock.method(
    Category,
    'findByIdAndUpdate',
    async (id, changes, options) => {
      assert.equal(id, CATEGORY_ID);
      update = changes;
      assert.deepEqual(options, {
        returnDocument: 'after',
        runValidators: true,
      });
      return { _id: id, image: MANAGED_IMAGE, status: 'inactive' };
    },
  );

  const category = await categoryService.updateCategoryStatus(
    CATEGORY_ID,
    'inactive',
  );

  assert.deepEqual(update, { $set: { status: 'inactive' } });
  assert.equal(category.image, MANAGED_IMAGE);
});
