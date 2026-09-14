require('dotenv').config({ quiet: true });

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');

const connectDatabase = require('../src/config/database');
const { prepareCsrfHeaders } = require('./e2eCsrf');
const { createImageFixture } = require('../testSupport/imageFixtures');

process.env.NODE_ENV = 'test';

const ONE_PIXEL_IMAGE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const CATEGORY_IMAGE_PATTERN =
  /^\/uploads\/categories\/[0-9a-f-]+\.(jpg|png|webp)$/i;

let assertionCount = 0;
let server;
let baseUrl;
const testCategoryIds = new Set();
const testCategoryImagePaths = new Set();
const testConversationIds = new Set();
const testListingIds = new Set();
const testListingImagePaths = new Set();
const testUserIds = new Set();
const testAvatarPaths = new Set();

const check = (value, message) => {
  assertionCount += 1;
  assert.ok(value, message);
};

const checkEqual = (actual, expected, message) => {
  assertionCount += 1;
  assert.equal(actual, expected, message);
};

const reportStage = (stage) => {
  console.log(`[category-image-e2e] ${stage}`);
};

const listen = (app) =>
  new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });

const closeServer = () =>
  new Promise((resolve) => {
    if (!server?.listening) {
      resolve();
      return;
    }

    server.close(() => resolve());
  });

const request = async (pathname, options = {}) => {
  const headers = new Headers(options.headers || {});

  if (options.cookie) {
    headers.set('cookie', options.cookie);
  }

  await prepareCsrfHeaders({
    baseUrl,
    cookie: options.cookie,
    headers,
    method: options.method,
    skipCsrf: options.skipCsrf,
  });

  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers,
    redirect: 'manual',
  });
  const text = options.readBody === false ? '' : await response.text();

  return {
    contentType: response.headers.get('content-type') || '',
    location: response.headers.get('location') || '',
    setCookie: response.headers.get('set-cookie') || '',
    status: response.status,
    text,
  };
};

const urlEncoded = (data, overrides = {}) => ({
  body: new URLSearchParams(data),
  headers: {
    'content-type': 'application/x-www-form-urlencoded',
  },
  method: 'POST',
  ...overrides,
});

const createCategoryForm = ({
  description = 'Danh mục fixture E2E có cleanup an toàn.',
  file,
  imageBody,
  name,
  removeImage,
  status = 'active',
}) => {
  const form = new FormData();

  form.append('name', name);
  form.append('description', description);
  form.append('status', status);

  if (removeImage) {
    form.append('removeImage', removeImage);
  }

  if (typeof imageBody === 'string') {
    form.append('image', imageBody);
  } else if (file) {
    form.append(
      file.fieldName || 'image',
      new Blob([file.bytes], { type: file.type }),
      file.name,
    );
  }

  return form;
};

const createListingForm = (categoryId, title, includeImage = false) => {
  const form = new FormData();

  for (const [field, value] of Object.entries({
    category: categoryId,
    condition: 'used',
    description:
      'Listing fixture cho regression ảnh Category và được cleanup.',
    location: 'TP.HCM',
    price: '125000',
    title,
  })) {
    form.append(field, value);
  }

  if (includeImage) {
    form.append(
      'images',
      new Blob([ONE_PIXEL_IMAGE], { type: 'image/png' }),
      'listing-regression.png',
    );
  }

  return form;
};

const createProfileForm = () => {
  const form = new FormData();

  form.append('name', 'User Category Image E2E');
  form.append('phone', '');
  form.append('address', '');
  form.append(
    'avatar',
    new Blob([ONE_PIXEL_IMAGE], { type: 'image/png' }),
    'avatar-regression.png',
  );

  return form;
};

const getCategoryImageDiskPath = (publicPath) =>
  path.resolve(
    __dirname,
    '..',
    'uploads',
    'categories',
    path.basename(publicPath),
  );

const getManagedCategoryFiles = () => {
  const directory = path.resolve(
    __dirname,
    '..',
    'uploads',
    'categories',
  );

  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs
    .readdirSync(directory)
    .filter((filename) =>
      /^[0-9a-f-]+\.(jpg|png|webp)$/i.test(filename),
    );
};

const exists = (filePath) => fs.existsSync(filePath);

const rememberCategory = (category) => {
  if (!category) {
    return;
  }

  testCategoryIds.add(category._id.toString());

  if (CATEGORY_IMAGE_PATTERN.test(category.image || '')) {
    testCategoryImagePaths.add(category.image);
  }
};

const findBrowserExecutable = () => {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
};

const runProcess = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    let stdout = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Responsive browser audit timed out.'));
    }, 30000);

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);

      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(new Error(`Responsive browser audit failed (${code}).`));
    });
  });

const getDatasetValue = (html, name) => {
  const match = html.match(new RegExp(`data-${name}="([^"]*)"`));
  return match?.[1] || '';
};

const runResponsiveAudit = async (pages) => {
  const browserExecutable = findBrowserExecutable();
  check(browserExecutable, 'Cần Chromium để audit responsive Category');

  const auditDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ntt-category-image-'),
  );
  const measurementScript = `<script>
    (() => {
      const measure = () => {
        const root = document.documentElement;
        const body = document.body;
        const fallback = document.querySelector(
          '.category-card__icon--large'
        );
        root.dataset.auditReady = 'true';
        root.dataset.auditWidth = String(window.innerWidth);
        root.dataset.auditOverflow = String(
          Math.max(root.scrollWidth, body.scrollWidth) - window.innerWidth
        );
        root.dataset.auditFallbackHeight = String(
          fallback ? Math.round(fallback.getBoundingClientRect().height) : 0
        );
      };
      if (document.readyState === 'complete') {
        measure();
      } else {
        window.addEventListener('load', measure, { once: true });
      }
    })();
  </script>`;

  try {
    for (const page of pages) {
      const absoluteHtml = page.html
        .replaceAll('href="/', `href="${baseUrl}/`)
        .replaceAll('src="/', `src="${baseUrl}/`);
      const snapshot = absoluteHtml.replace(
        '</body>',
        `${measurementScript}</body>`,
      );
      const snapshotPath = path.join(auditDirectory, `${page.label}.html`);
      fs.writeFileSync(snapshotPath, snapshot, 'utf8');

      for (const width of [320, 375, 414, 768, 1024]) {
        reportStage(`responsive ${page.label} ${width}px`);
        const profileDirectory = path.join(
          auditDirectory,
          `${page.label}-${width}`,
        );
        const harnessPath = path.join(
          auditDirectory,
          `${page.label}-${width}-harness.html`,
        );
        const harness = `<!doctype html>
          <html>
            <head><meta charset="utf-8"><title>Category audit</title></head>
            <body>
              <iframe
                id="audit-frame"
                src="${pathToFileURL(snapshotPath).href}"
                title="Category responsive audit"
                style="display:block;width:${width}px;height:900px;border:0"
              ></iframe>
              <script>
                (() => {
                  const frame = document.getElementById('audit-frame');
                  frame.addEventListener('load', () => {
                    const source = frame.contentDocument.documentElement;
                    const target = document.documentElement;
                    target.dataset.auditReady =
                      source.dataset.auditReady || '';
                    target.dataset.auditWidth =
                      source.dataset.auditWidth || '';
                    target.dataset.auditOverflow =
                      source.dataset.auditOverflow || '';
                    target.dataset.auditFallbackHeight =
                      source.dataset.auditFallbackHeight || '';
                  }, { once: true });
                })();
              </script>
            </body>
          </html>`;
        fs.writeFileSync(harnessPath, harness, 'utf8');
        const html = await runProcess(browserExecutable, [
          '--headless=new',
          '--allow-file-access-from-files',
          '--disable-background-networking',
          '--disable-default-apps',
          '--disable-gpu',
          '--disable-extensions',
          '--disable-sync',
          '--force-device-scale-factor=1',
          '--no-first-run',
          '--no-default-browser-check',
          '--no-proxy-server',
          '--run-all-compositor-stages-before-draw',
          '--hide-scrollbars',
          `--user-data-dir=${profileDirectory}`,
          '--window-size=1280,1000',
          '--virtual-time-budget=1200',
          '--dump-dom',
          pathToFileURL(harnessPath).href,
        ]);

        checkEqual(
          getDatasetValue(html, 'audit-ready'),
          'true',
          `${page.label} phải hoàn tất đo responsive ở ${width}px`,
        );
        check(
          Number(getDatasetValue(html, 'audit-overflow')) <= 1,
          `${page.label} không được tràn ngang ở ${width}px`,
        );
        checkEqual(
          Number(getDatasetValue(html, 'audit-width')),
          width,
          `${page.label} phải được đo đúng viewport ${width}px`,
        );

        if (page.expectFallback) {
          const fallbackHeight = Number(
            getDatasetValue(html, 'audit-fallback-height'),
          );
          check(
            fallbackHeight >= 152 && fallbackHeight <= 224,
            `Fallback detail phải gọn ở ${width}px`,
          );
        }
      }
    }
  } finally {
    const resolvedAuditDirectory = path.resolve(auditDirectory);
    const resolvedTempDirectory = `${path.resolve(os.tmpdir())}${path.sep}`;

    if (resolvedAuditDirectory.startsWith(resolvedTempDirectory)) {
      fs.rmSync(resolvedAuditDirectory, {
        force: true,
        recursive: true,
      });
    }
  }
};

const cleanupStaleFixtures = async () => {
  const Category = require('../src/models/Category');
  const Conversation = require('../src/models/Conversation');
  const Favorite = require('../src/models/Favorite');
  const Listing = require('../src/models/Listing');
  const Message = require('../src/models/Message');
  const User = require('../src/models/User');
  const {
    deleteStoredAvatar,
  } = require('../src/utils/avatarStorage');
  const {
    deleteStoredCategoryImage,
  } = require('../src/utils/categoryImageStorage');
  const { deleteStoredFiles } = require('../src/utils/fileStorage');

  const staleUsers = await User.find({
    email:
      /^category-(admin|user)-[0-9a-f]{32}@example\.test$/i,
  })
    .select('_id avatar')
    .lean();
  const staleCategories = await Category.find({
    name:
      /^(Không ảnh|JPG|PNG|WEBP|Trùng) [0-9a-f]{32}$/i,
  })
    .select('_id image')
    .lean();
  const staleUserIds = staleUsers.map((user) => user._id);
  const staleCategoryIds = staleCategories.map(
    (category) => category._id,
  );
  const staleListings = await Listing.find({
    $or: [
      { seller: { $in: staleUserIds } },
      {
        title:
          /^(Listing image regression|Seller fixture) [0-9a-f]{32}$/i,
      },
    ],
  })
    .select('_id images')
    .lean();
  const staleListingIds = staleListings.map((listing) => listing._id);
  const staleConversations = await Conversation.find({
    $or: [
      { buyer: { $in: staleUserIds } },
      { seller: { $in: staleUserIds } },
      { listing: { $in: staleListingIds } },
    ],
  })
    .select('_id')
    .lean();
  const staleConversationIds = staleConversations.map(
    (conversation) => conversation._id,
  );

  if (staleConversationIds.length > 0) {
    await Message.deleteMany({
      conversation: { $in: staleConversationIds },
    });
    await Conversation.deleteMany({
      _id: { $in: staleConversationIds },
    });
  }

  if (staleUserIds.length > 0 || staleListingIds.length > 0) {
    await Favorite.deleteMany({
      $or: [
        { user: { $in: staleUserIds } },
        { listing: { $in: staleListingIds } },
      ],
    });
  }

  if (staleListingIds.length > 0) {
    await Listing.deleteMany({ _id: { $in: staleListingIds } });
  }

  if (staleCategoryIds.length > 0) {
    await Category.deleteMany({ _id: { $in: staleCategoryIds } });
  }

  if (staleUserIds.length > 0) {
    await mongoose.connection.collection('sessions').deleteMany({
      session: new RegExp(
        staleUserIds.map((userId) => userId.toString()).join('|'),
      ),
    });
    await User.deleteMany({ _id: { $in: staleUserIds } });
  }

  await Promise.all(
    staleCategories
      .map((category) => category.image)
      .filter((image) => CATEGORY_IMAGE_PATTERN.test(image || ''))
      .map(deleteStoredCategoryImage),
  );
  await deleteStoredFiles(
    staleListings.flatMap((listing) => listing.images || []),
  );
  await Promise.all(
    staleUsers
      .map((user) => user.avatar)
      .filter(Boolean)
      .map(deleteStoredAvatar),
  );
};

const auditCategoryImageReferences = async () => {
  const Category = require('../src/models/Category');
  const categories = await Category.find({
    image: /^\/uploads\/categories\//,
  })
    .select('image')
    .lean();
  const files = new Set(getManagedCategoryFiles());
  const references = new Set(
    categories
      .map((category) => path.basename(category.image || ''))
      .filter(Boolean),
  );

  return {
    missingDocumentFiles: [...references].filter(
      (filename) => !files.has(filename),
    ).length,
    orphanFiles: [...files].filter(
      (filename) => !references.has(filename),
    ).length,
  };
};

const cleanup = async () => {
  if (mongoose.connection.readyState === 0) {
    return {
      categoryDocumentsRemaining: testCategoryIds.size,
      categoryFilesRemaining: testCategoryImagePaths.size,
      sessionsDeleted: 0,
    };
  }

  const Category = require('../src/models/Category');
  const Conversation = require('../src/models/Conversation');
  const Favorite = require('../src/models/Favorite');
  const Listing = require('../src/models/Listing');
  const Message = require('../src/models/Message');
  const User = require('../src/models/User');
  const {
    deleteStoredAvatar,
  } = require('../src/utils/avatarStorage');
  const {
    deleteStoredCategoryImage,
  } = require('../src/utils/categoryImageStorage');
  const { deleteStoredFiles } = require('../src/utils/fileStorage');

  const categoryIds = [...testCategoryIds];
  const conversationIds = [...testConversationIds];
  const listingIds = [...testListingIds];
  const userIds = [...testUserIds];

  if (conversationIds.length > 0) {
    await Message.deleteMany({
      conversation: { $in: conversationIds },
    });
    await Conversation.deleteMany({
      _id: { $in: conversationIds },
    });
  }

  if (userIds.length > 0 || listingIds.length > 0) {
    await Favorite.deleteMany({
      $or: [
        { user: { $in: userIds } },
        { listing: { $in: listingIds } },
      ],
    });
  }

  if (listingIds.length > 0) {
    const listings = await Listing.find({
      _id: { $in: listingIds },
    })
      .select('images')
      .lean();

    for (const listing of listings) {
      for (const image of listing.images || []) {
        testListingImagePaths.add(image);
      }
    }

    await Listing.deleteMany({ _id: { $in: listingIds } });
  }

  if (categoryIds.length > 0) {
    const categories = await Category.find({
      _id: { $in: categoryIds },
    })
      .select('image')
      .lean();

    for (const category of categories) {
      if (CATEGORY_IMAGE_PATTERN.test(category.image || '')) {
        testCategoryImagePaths.add(category.image);
      }
    }

    await Category.deleteMany({ _id: { $in: categoryIds } });
  }

  let sessionsDeleted = 0;

  if (userIds.length > 0) {
    const sessionResult = await mongoose.connection
      .collection('sessions')
      .deleteMany({
        session: new RegExp(userIds.join('|')),
      });
    sessionsDeleted = sessionResult.deletedCount;
    await User.deleteMany({ _id: { $in: userIds } });
  }

  await Promise.all(
    [...testCategoryImagePaths].map(deleteStoredCategoryImage),
  );
  await deleteStoredFiles([...testListingImagePaths]);
  await Promise.all([...testAvatarPaths].map(deleteStoredAvatar));

  const [categoryDocumentsRemaining, userDocumentsRemaining] =
    await Promise.all([
      categoryIds.length > 0
        ? Category.countDocuments({ _id: { $in: categoryIds } })
        : 0,
      userIds.length > 0
        ? User.countDocuments({ _id: { $in: userIds } })
        : 0,
    ]);
  const categoryFilesRemaining = [...testCategoryImagePaths].filter(
    (publicPath) => exists(getCategoryImageDiskPath(publicPath)),
  ).length;

  return {
    categoryDocumentsRemaining,
    categoryFilesRemaining,
    sessionsDeleted,
    userDocumentsRemaining,
  };
};

const run = async () => {
  const originalLog = console.log;
  console.log = () => {};
  await connectDatabase();
  console.log = originalLog;

  reportStage('connected');
  await cleanupStaleFixtures();
  reportStage('stale fixtures cleaned');
  const initialAudit = await auditCategoryImageReferences();
  const app = require('../src/app');
  server = await listen(app);
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const User = require('../src/models/User');
  const Category = require('../src/models/Category');
  const Conversation = require('../src/models/Conversation');
  const Favorite = require('../src/models/Favorite');
  const Listing = require('../src/models/Listing');
  const Message = require('../src/models/Message');

  const testId = crypto.randomUUID().replaceAll('-', '');
  const password = `CategoryA1!${testId}`;
  const passwordHash = await bcrypt.hash(password, 12);
  const [admin, regularUser] = await User.create([
    {
      name: 'Admin Category Image E2E',
      email: `category-admin-${testId}@example.test`,
      password: passwordHash,
      role: 'admin',
      status: 'active',
    },
    {
      name: 'User Category Image E2E',
      email: `category-user-${testId}@example.test`,
      password: passwordHash,
      role: 'user',
      status: 'active',
    },
  ]);
  testUserIds.add(admin._id.toString());
  testUserIds.add(regularUser._id.toString());

  const login = async (email) => {
    const response = await request(
      '/login',
      urlEncoded({ email, password }),
    );
    checkEqual(response.status, 303, 'Đăng nhập fixture phải thành công');
    const cookie = response.setCookie.split(';', 1)[0];
    check(cookie, 'Đăng nhập phải tạo session cookie');
    return cookie;
  };

  const adminCookie = await login(admin.email);
  const userCookie = await login(regularUser.email);
  reportStage('authorization fixtures ready');

  const guestAdmin = await request('/admin/categories');
  checkEqual(guestAdmin.status, 303, 'Guest phải bị chuyển tới login');
  check(
    guestAdmin.location.startsWith('/login'),
    'Guest phải redirect nội bộ tới login',
  );
  const userAdmin = await request('/admin/categories', {
    cookie: userCookie,
  });
  checkEqual(userAdmin.status, 403, 'User thường không được quản lý Category');
  const adminPage = await request('/admin/categories', {
    cookie: adminCookie,
  });
  checkEqual(adminPage.status, 200, 'Admin active mở được Category Admin');

  const names = {
    noImage: `Không ảnh ${testId}`,
    jpg: `JPG ${testId}`,
    png: `PNG ${testId}`,
    webp: `WEBP ${testId}`,
    duplicate: `Trùng ${testId}`,
  };

  const createNoImage = await request('/admin/categories', {
    body: createCategoryForm({ name: names.noImage }),
    cookie: adminCookie,
    method: 'POST',
  });
  checkEqual(createNoImage.status, 303, 'Tạo Category không ảnh thành công');
  const noImageCategory = await Category.findOne({ name: names.noImage })
    .select('name slug image status')
    .lean();
  rememberCategory(noImageCategory);
  checkEqual(noImageCategory.image, '', 'Category không ảnh lưu chuỗi rỗng');
  const noImageDetail = await request(
    `/categories/${noImageCategory.slug}`,
  );
  check(
    noImageDetail.text.includes('category-card__icon--large'),
    'Category không ảnh phải dùng icon detail fallback',
  );

  const createWithMime = async (label, type, filename) => {
    const response = await request('/admin/categories', {
      body: createCategoryForm({
        name: names[label],
        file: {
          bytes: createImageFixture(type),
          name: filename,
          type,
        },
      }),
      cookie: adminCookie,
      method: 'POST',
    });
    checkEqual(response.status, 303, `Tạo Category ${label} thành công`);
    const category = await Category.findOne({ name: names[label] })
      .select('name slug image status')
      .lean();
    rememberCategory(category);
    check(
      CATEGORY_IMAGE_PATTERN.test(category.image),
      `MongoDB chỉ lưu managed public path cho ${label}`,
    );
    check(
      exists(getCategoryImageDiskPath(category.image)),
      `File ${label} phải nằm trong uploads/categories`,
    );
    return category;
  };

  const jpgCategory = await createWithMime(
    'jpg',
    'image/jpeg',
    'client-name.svg',
  );
  const pngCategory = await createWithMime(
    'png',
    'image/png',
    'client-name.jpg',
  );
  const webpCategory = await createWithMime(
    'webp',
    'image/webp',
    'client-name.png',
  );
  check(jpgCategory.image.endsWith('.jpg'), 'JPEG phải ánh xạ .jpg');
  check(pngCategory.image.endsWith('.png'), 'PNG phải ánh xạ .png');
  check(webpCategory.image.endsWith('.webp'), 'WEBP phải ánh xạ .webp');
  reportStage('valid upload cases passed');

  for (const invalid of [
    {
      expected: 'Chỉ chấp nhận ảnh JPG, JPEG, PNG hoặc WEBP.',
      name: `SVG ${testId}`,
      file: {
        bytes: Buffer.from('<svg>category-e2e</svg>'),
        name: 'category.svg',
        type: 'image/svg+xml',
      },
    },
    {
      expected: 'Chỉ chấp nhận ảnh JPG, JPEG, PNG hoặc WEBP.',
      name: `PDF ${testId}`,
      file: {
        bytes: Buffer.from('%PDF-category-e2e'),
        name: 'category.pdf',
        type: 'application/pdf',
      },
    },
  ]) {
    const filesBefore = new Set(getManagedCategoryFiles());
    const response = await request('/admin/categories', {
      body: createCategoryForm({
        file: invalid.file,
        name: invalid.name,
      }),
      cookie: adminCookie,
      method: 'POST',
    });
    checkEqual(response.status, 422, `${invalid.file.type} phải trả 422`);
    check(
      response.text.includes(invalid.expected),
      `${invalid.file.type} phải có lỗi tiếng Việt`,
    );
    checkEqual(
      await Category.countDocuments({ name: invalid.name }),
      0,
      `${invalid.file.type} không được tạo document`,
    );
    checkEqual(
      getManagedCategoryFiles().filter(
        (filename) => !filesBefore.has(filename),
      ).length,
      0,
      `${invalid.file.type} không được để orphan file`,
    );
  }

  const oversizedName = `Quá lớn ${testId}`;
  const oversizedFilesBefore = new Set(getManagedCategoryFiles());
  const oversized = await request('/admin/categories', {
    body: createCategoryForm({
      name: oversizedName,
      file: {
        bytes: Buffer.alloc(3 * 1024 * 1024 + 1, 65),
        name: 'oversized.jpg',
        type: 'image/jpeg',
      },
    }),
    cookie: adminCookie,
    method: 'POST',
  });
  checkEqual(oversized.status, 422, 'Ảnh trên 3 MB phải trả 422');
  check(
    oversized.text.includes('Ảnh danh mục không được vượt quá 3 MB.'),
    'Ảnh quá lớn phải có lỗi tiếng Việt',
  );
  checkEqual(
    getManagedCategoryFiles().filter(
      (filename) => !oversizedFilesBefore.has(filename),
    ).length,
    0,
    'Ảnh quá lớn không được để orphan',
  );

  const invalidNameFilesBefore = new Set(getManagedCategoryFiles());
  const invalidName = await request('/admin/categories', {
    body: createCategoryForm({
      name: 'A',
      file: {
        bytes: ONE_PIXEL_IMAGE,
        name: 'validation.png',
        type: 'image/png',
      },
    }),
    cookie: adminCookie,
    method: 'POST',
  });
  checkEqual(invalidName.status, 422, 'Name lỗi sau upload phải trả 422');
  checkEqual(
    getManagedCategoryFiles().filter(
      (filename) => !invalidNameFilesBefore.has(filename),
    ).length,
    0,
    'Name lỗi phải cleanup ảnh mới',
  );
  checkEqual(
    await Category.countDocuments({ name: 'A' }),
    0,
    'Name lỗi không tạo Category',
  );

  const duplicateBase = await request('/admin/categories', {
    body: createCategoryForm({ name: names.duplicate }),
    cookie: adminCookie,
    method: 'POST',
  });
  checkEqual(duplicateBase.status, 303, 'Tạo fixture duplicate ban đầu');
  const duplicateCategory = await Category.findOne({
    name: names.duplicate,
  })
    .select('name slug image status')
    .lean();
  rememberCategory(duplicateCategory);
  const duplicateFilesBefore = new Set(getManagedCategoryFiles());
  const duplicate = await request('/admin/categories', {
    body: createCategoryForm({
      name: names.duplicate,
      file: {
        bytes: createImageFixture('image/jpeg'),
        name: 'duplicate.jpg',
        type: 'image/jpeg',
      },
    }),
    cookie: adminCookie,
    method: 'POST',
  });
  checkEqual(duplicate.status, 409, 'Duplicate có ảnh phải trả 409');
  checkEqual(
    getManagedCategoryFiles().filter(
      (filename) => !duplicateFilesBefore.has(filename),
    ).length,
    0,
    'Duplicate phải cleanup ảnh mới',
  );
  reportStage('invalid upload cleanup cases passed');

  const jpgOriginalImage = jpgCategory.image;
  const editText = await request(
    `/admin/categories/${jpgCategory._id}?_method=PUT`,
    {
      body: createCategoryForm({
        description: 'Mô tả chỉ thay đổi text.',
        name: jpgCategory.name,
      }),
      cookie: adminCookie,
      method: 'POST',
    },
  );
  checkEqual(editText.status, 303, 'Edit text phải thành công');
  const jpgAfterText = await Category.findById(jpgCategory._id)
    .select('image')
    .lean();
  checkEqual(
    jpgAfterText.image,
    jpgOriginalImage,
    'Edit text phải giữ ảnh cũ',
  );
  check(
    exists(getCategoryImageDiskPath(jpgOriginalImage)),
    'Edit text không được xóa file',
  );

  const replaceImage = await request(
    `/admin/categories/${jpgCategory._id}?_method=PUT`,
    {
      body: createCategoryForm({
        file: {
          bytes: createImageFixture('image/webp'),
          name: 'replacement.webp',
          type: 'image/webp',
        },
        name: jpgCategory.name,
        removeImage: '1',
      }),
      cookie: adminCookie,
      method: 'POST',
    },
  );
  checkEqual(replaceImage.status, 303, 'Thay ảnh phải thành công');
  const jpgAfterReplace = await Category.findById(jpgCategory._id)
    .select('image')
    .lean();
  rememberCategory(jpgAfterReplace);
  check(
    jpgAfterReplace.image.endsWith('.webp'),
    'Ảnh mới phải thắng removeImage',
  );
  check(
    !exists(getCategoryImageDiskPath(jpgOriginalImage)),
    'Ảnh cũ chỉ còn bị xóa sau update thành công',
  );
  check(
    exists(getCategoryImageDiskPath(jpgAfterReplace.image)),
    'Ảnh thay thế phải còn trên disk',
  );

  const pngOriginalImage = pngCategory.image;
  const removeImage = await request(
    `/admin/categories/${pngCategory._id}?_method=PUT`,
    {
      body: createCategoryForm({
        name: pngCategory.name,
        removeImage: '1',
      }),
      cookie: adminCookie,
      method: 'POST',
    },
  );
  checkEqual(removeImage.status, 303, 'Xóa ảnh phải thành công');
  const pngAfterRemove = await Category.findById(pngCategory._id)
    .select('image slug')
    .lean();
  checkEqual(pngAfterRemove.image, '', 'DB phải ghi image rỗng');
  check(
    !exists(getCategoryImageDiskPath(pngOriginalImage)),
    'File cũ phải bị xóa sau khi DB thành công',
  );
  const pngFallback = await request(`/categories/${pngAfterRemove.slug}`);
  check(
    pngFallback.text.includes('category-card__icon--large'),
    'Xóa ảnh xong phải hiện icon fallback',
  );

  const webpOriginalImage = webpCategory.image;
  const updateValidationFilesBefore = new Set(getManagedCategoryFiles());
  const updateValidation = await request(
    `/admin/categories/${webpCategory._id}?_method=PUT`,
    {
      body: createCategoryForm({
        name: 'A',
        file: {
          bytes: ONE_PIXEL_IMAGE,
          name: 'invalid-update.png',
          type: 'image/png',
        },
      }),
      cookie: adminCookie,
      method: 'POST',
    },
  );
  checkEqual(updateValidation.status, 422, 'Update validation lỗi trả 422');
  const webpAfterValidation = await Category.findById(webpCategory._id)
    .select('image')
    .lean();
  checkEqual(
    webpAfterValidation.image,
    webpOriginalImage,
    'Update validation lỗi giữ DB image cũ',
  );
  check(
    exists(getCategoryImageDiskPath(webpOriginalImage)),
    'Update validation lỗi giữ file cũ',
  );
  checkEqual(
    getManagedCategoryFiles().filter(
      (filename) => !updateValidationFilesBefore.has(filename),
    ).length,
    0,
    'Update validation lỗi cleanup file mới',
  );

  const databaseFailureFilesBefore = new Set(getManagedCategoryFiles());
  const originalCategorySave = Category.prototype.save;
  Category.prototype.save = async function saveCategoryFixture(...args) {
    if (this._id.toString() === webpCategory._id.toString()) {
      throw new Error('Synthetic Category update failure');
    }
    return originalCategorySave.apply(this, args);
  };
  let databaseFailure;

  try {
    databaseFailure = await request(
      `/admin/categories/${webpCategory._id}?_method=PUT`,
      {
        body: createCategoryForm({
          file: {
            bytes: createImageFixture('image/jpeg'),
            name: 'database-failure.jpg',
            type: 'image/jpeg',
          },
          name: webpCategory.name,
        }),
        cookie: adminCookie,
        method: 'POST',
      },
    );
  } finally {
    Category.prototype.save = originalCategorySave;
  }

  checkEqual(databaseFailure.status, 500, 'Database failure phải an toàn');
  const webpAfterFailure = await Category.findById(webpCategory._id)
    .select('image')
    .lean();
  checkEqual(
    webpAfterFailure.image,
    webpOriginalImage,
    'Database failure giữ DB image cũ',
  );
  check(
    exists(getCategoryImageDiskPath(webpOriginalImage)),
    'Database failure giữ file cũ',
  );
  checkEqual(
    getManagedCategoryFiles().filter(
      (filename) => !databaseFailureFilesBefore.has(filename),
    ).length,
    0,
    'Database failure cleanup file mới',
  );
  reportStage('update cleanup cases passed');

  const bodyImage = await request(
    `/admin/categories/${noImageCategory._id}?_method=PUT`,
    {
      body: createCategoryForm({
        imageBody: '/uploads/categories/../../.env',
        name: noImageCategory.name,
      }),
      cookie: adminCookie,
      method: 'POST',
    },
  );
  checkEqual(bodyImage.status, 303, 'Image path text phải bị bỏ qua');
  const noImageAfterBody = await Category.findById(noImageCategory._id)
    .select('image')
    .lean();
  checkEqual(
    noImageAfterBody.image,
    '',
    'Client không thể ghi image path từ body',
  );
  check(exists(path.resolve(__dirname, '..', 'package.json')), 'Source còn nguyên');

  const inactive = await request(
    `/admin/categories/${webpCategory._id}/status?_method=PATCH`,
    {
      cookie: adminCookie,
      ...urlEncoded({ status: 'inactive' }),
    },
  );
  checkEqual(inactive.status, 303, 'Inactive Category phải thành công');
  const webpInactive = await Category.findById(webpCategory._id)
    .select('image status')
    .lean();
  checkEqual(webpInactive.image, webpOriginalImage, 'Inactive giữ image');
  check(
    exists(getCategoryImageDiskPath(webpOriginalImage)),
    'Inactive giữ file',
  );
  const activeAgain = await request(
    `/admin/categories/${webpCategory._id}/status?_method=PATCH`,
    {
      cookie: adminCookie,
      ...urlEncoded({ status: 'active' }),
    },
  );
  checkEqual(activeAgain.status, 303, 'Active lại phải thành công');
  const webpActive = await Category.findById(webpCategory._id)
    .select('image status slug')
    .lean();
  checkEqual(webpActive.image, webpOriginalImage, 'Active lại giữ image');

  const publicCategories = await request('/categories');
  checkEqual(publicCategories.status, 200, '/categories phải hoạt động');
  check(
    publicCategories.text.includes(jpgAfterReplace.image),
    'Category có ảnh phải render managed image',
  );
  check(
    publicCategories.text.includes(
      `/categories/${noImageCategory.slug}`,
    ) &&
      publicCategories.text.includes('category-card__icon'),
    'Category không ảnh phải có icon fallback',
  );
  check(
    publicCategories.text.includes('loading="lazy"'),
    'Ảnh Category list phải lazy load',
  );

  const imageDetail = await request(`/categories/${webpActive.slug}`);
  checkEqual(imageDetail.status, 200, 'Category detail ảnh hoạt động');
  check(
    imageDetail.text.includes(webpOriginalImage),
    'Detail phải render ảnh Category',
  );
  const fallbackDetail = await request(
    `/categories/${noImageCategory.slug}`,
  );
  check(
    fallbackDetail.text.includes('category-card__icon--large'),
    'Detail không ảnh phải render fallback gọn',
  );

  const home = await request('/');
  checkEqual(home.status, 200, 'Home phải hoạt động');
  check(
    home.text.includes('home-category-icon'),
    'Home tiếp tục dùng icon compact',
  );
  check(
    !home.text.includes(webpOriginalImage),
    'Home không đổi Category compact thành ảnh',
  );

  const adminList = await request('/admin/categories', {
    cookie: adminCookie,
  });
  check(
    adminList.text.includes('admin-category-thumbnail') &&
      adminList.text.includes(webpOriginalImage),
    'Admin list phải hiển thị thumbnail',
  );

  const staticImage = await request(webpOriginalImage);
  checkEqual(staticImage.status, 200, 'Static Category image trả 200');
  check(
    staticImage.contentType.startsWith('image/webp'),
    'Static Category image có MIME đúng',
  );
  for (const traversalPath of [
    '/uploads/categories/%2e%2e/%2e%2e/package.json',
    '/uploads/categories/%2e%2e/%2e%2e/.env',
    '/uploads/.env',
  ]) {
    const traversal = await request(traversalPath, {
      readBody: false,
    });
    check(
      traversal.status !== 200,
      'Static traversal không được đọc source hoặc cấu hình',
    );
  }
  reportStage('public and static cases passed');

  const listingTitle = `Listing image regression ${testId}`;
  const listingCreate = await request('/listings', {
    body: createListingForm(
      noImageCategory._id.toString(),
      listingTitle,
      true,
    ),
    cookie: userCookie,
    method: 'POST',
  });
  checkEqual(
    listingCreate.status,
    303,
    'Regression upload Listing phải thành công',
  );
  const listingId = listingCreate.location.match(
    /\/listings\/([0-9a-f]{24})\?created=1/i,
  )?.[1];
  check(listingId, 'Listing redirect phải có ObjectId');
  testListingIds.add(listingId);
  const uploadedListing = await Listing.findById(listingId)
    .select('images')
    .lean();
  checkEqual(uploadedListing.images.length, 1, 'Listing vẫn lưu một ảnh');
  testListingImagePaths.add(uploadedListing.images[0]);
  check(
    uploadedListing.images[0].startsWith('/uploads/listings/'),
    'Listing image vẫn ở đúng namespace',
  );

  const avatarUpdate = await request('/profile?_method=PUT', {
    body: createProfileForm(),
    cookie: userCookie,
    method: 'POST',
  });
  checkEqual(avatarUpdate.status, 303, 'Regression avatar thành công');
  const userAfterAvatar = await User.findById(regularUser._id)
    .select('avatar')
    .lean();
  check(
    userAfterAvatar.avatar.startsWith('/uploads/avatars/'),
    'Avatar vẫn ở đúng namespace',
  );
  testAvatarPaths.add(userAfterAvatar.avatar);

  const sellerListing = await Listing.create({
    title: `Seller fixture ${testId}`,
    description: 'Listing fixture cho Favorite và Message regression.',
    price: 250000,
    category: noImageCategory._id,
    seller: admin._id,
    location: 'TP.HCM',
    condition: 'used',
    images: [],
    status: 'active',
  });
  testListingIds.add(sellerListing._id.toString());

  const favoriteAdd = await request(
    `/listings/${sellerListing._id}/favorite`,
    {
      cookie: userCookie,
      ...urlEncoded({ returnTo: '/favorites' }),
    },
  );
  checkEqual(favoriteAdd.status, 303, 'Regression Favorite add thành công');
  checkEqual(
    await Favorite.countDocuments({
      user: regularUser._id,
      listing: sellerListing._id,
    }),
    1,
    'Favorite document phải tồn tại',
  );
  const favoritesPage = await request('/favorites', {
    cookie: userCookie,
  });
  checkEqual(favoritesPage.status, 200, 'Favorites page vẫn hoạt động');

  const startConversation = await request(
    `/listings/${sellerListing._id}/conversations`,
    {
      cookie: userCookie,
      ...urlEncoded({}),
    },
  );
  checkEqual(
    startConversation.status,
    303,
    'Regression Message conversation thành công',
  );
  const conversationId = startConversation.location.match(
    /\/messages\/([0-9a-f]{24})/i,
  )?.[1];
  check(conversationId, 'Conversation redirect phải có ObjectId');
  testConversationIds.add(conversationId);
  const sendMessage = await request(`/messages/${conversationId}`, {
    cookie: userCookie,
    ...urlEncoded({ content: 'Tin nhắn regression Category image.' }),
  });
  checkEqual(sendMessage.status, 303, 'Regression gửi Message thành công');
  checkEqual(
    await Message.countDocuments({ conversation: conversationId }),
    1,
    'Message phải được lưu',
  );
  checkEqual(
    await Conversation.countDocuments({ _id: conversationId }),
    1,
    'Conversation phải tồn tại',
  );

  for (const adminPath of ['/admin', '/admin/users', '/admin/listings']) {
    const response = await request(adminPath, { cookie: adminCookie });
    checkEqual(
      response.status,
      200,
      `Regression Admin ${adminPath} phải hoạt động`,
    );
  }
  reportStage('regression cases passed');

  const invalidObjectId = await request(
    '/admin/categories/not-an-object-id/edit',
    { cookie: adminCookie },
  );
  checkEqual(invalidObjectId.status, 404, 'ObjectId sai không thành 500');
  const invalidSlug = await request('/categories/not-a-real-category');
  checkEqual(invalidSlug.status, 404, 'Slug sai không thành 500');

  await runResponsiveAudit([
    {
      html: publicCategories.text,
      label: 'categories',
    },
    {
      expectFallback: true,
      html: fallbackDetail.text,
      label: 'category-detail',
    },
  ]);
  reportStage('responsive cases passed');

  return initialAudit;
};

const main = async () => {
  let initialAudit = {
    missingDocumentFiles: 0,
    orphanFiles: 0,
  };
  let failure;

  try {
    initialAudit = await run();
  } catch (error) {
    failure = error;
  } finally {
    await closeServer();

    let cleanupResult;
    let finalAudit;

    try {
      cleanupResult = await cleanup();
      finalAudit = await auditCategoryImageReferences();
    } catch (cleanupError) {
      failure ||= cleanupError;
      cleanupResult = {
        categoryDocumentsRemaining: -1,
        categoryFilesRemaining: -1,
        sessionsDeleted: -1,
        userDocumentsRemaining: -1,
      };
      finalAudit = {
        missingDocumentFiles: -1,
        orphanFiles: -1,
      };
    }

    if (!failure) {
      checkEqual(
        cleanupResult.categoryDocumentsRemaining,
        0,
        'Không còn Category fixture',
      );
      checkEqual(
        cleanupResult.categoryFilesRemaining,
        0,
        'Không còn file Category fixture',
      );
      checkEqual(
        cleanupResult.userDocumentsRemaining,
        0,
        'Không còn User fixture',
      );
      check(
        finalAudit.orphanFiles <= initialAudit.orphanFiles,
        'E2E không tạo thêm orphan Category file',
      );
      check(
        finalAudit.missingDocumentFiles <=
          initialAudit.missingDocumentFiles,
        'E2E không tạo thêm Category document mất file',
      );
    }

    console.log(
      `Category image E2E: ${failure ? 'FAIL' : 'PASS'} (${assertionCount} assertions).`,
    );
    console.log(
      `Cleanup: category documents=${cleanupResult.categoryDocumentsRemaining}, category files=${cleanupResult.categoryFilesRemaining}, sessions deleted=${cleanupResult.sessionsDeleted}.`,
    );
    console.log(
      `Orphan audit: files=${finalAudit.orphanFiles}, documents=${finalAudit.missingDocumentFiles}.`,
    );

    await mongoose.disconnect().catch(() => {});
  }

  if (failure) {
    throw failure;
  }

  process.exit(0);
};

main().catch((error) => {
  console.error(`Category image E2E failed: ${error.message}`);
  process.exit(1);
});
