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

let assertionCount = 0;
let server;
let baseUrl;
const testEmails = new Set();
const testUserIds = new Set();
const testCategoryIds = new Set();
const testListingIds = new Set();
const createdFilePaths = new Set();

const check = (value, message) => {
  assertionCount += 1;
  assert.ok(value, message);
};

const checkEqual = (actual, expected, message) => {
  assertionCount += 1;
  assert.equal(actual, expected, message);
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

const getSessionCookie = (setCookie) => setCookie.split(';', 1)[0];
const countMatches = (source, pattern) => (source.match(pattern) || []).length;

const assertLoginRedirect = (response, message) => {
  checkEqual(response.status, 303, message);
  check(
    response.location.startsWith('/login'),
    `${message}: phải redirect nội bộ tới login`,
  );
};

const findBrowserExecutable = () => {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
};

const runResponsiveBrowserAudit = async ({ pages }) => {
  const browserExecutable = findBrowserExecutable();
  check(browserExecutable, 'Cần Chromium để audit responsive Admin');

  const browserDataDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ntt-step12-browser-'),
  );
  const selectors = [
    '.site-navbar .nav-link',
    '.site-navbar .btn',
    '.admin-navigation__link',
    '.admin-page .btn',
    '.admin-breadcrumb a',
    '.admin-panel__heading a',
  ];
  const measurementScript = `<script>
    (() => {
      const measure = () => {
        const root = document.documentElement;
        const body = document.body;
        const overflow = Math.max(root.scrollWidth, body.scrollWidth) -
          window.innerWidth;
        const wrappedLabels = [...document.querySelectorAll(
          ${JSON.stringify(selectors.join(','))}
        )]
          .filter((element) => element.getClientRects().length > 0)
          .filter((element) => {
            const range = document.createRange();
            range.selectNodeContents(element);
            const lines = new Set(
              [...range.getClientRects()]
                .filter((rect) => rect.width > 0 && rect.height > 0)
                .map((rect) => Math.round(rect.top))
            );
            return lines.size > 1;
          });

        root.dataset.responsiveReady = 'true';
        root.dataset.responsiveInnerWidth = String(window.innerWidth);
        root.dataset.responsiveOverflow = String(overflow);
        root.dataset.responsiveWrappedCount = String(wrappedLabels.length);
      };

      if (document.readyState === 'complete') {
        measure();
      } else {
        window.addEventListener('load', measure, { once: true });
      }
    })();
  </script>`;

  try {
    const widths = [320, 375, 414, 768, 1024];

    for (const page of pages) {
      const absoluteHtml = page.html
        .replaceAll('href="/', `href="${baseUrl}/`)
        .replaceAll('src="/', `src="${baseUrl}/`);
      const snapshotHtml = absoluteHtml.replace(
        '</body>',
        `${measurementScript}</body>`,
      );
      const snapshotPath = path.join(
        browserDataDirectory,
        `${page.label}.html`,
      );
      fs.writeFileSync(snapshotPath, snapshotHtml, 'utf8');

      for (const width of widths) {
        const profileDirectory = path.join(
          browserDataDirectory,
          `${page.label}-${width}`,
        );
        const harnessPath = path.join(
          browserDataDirectory,
          `${page.label}-${width}-harness.html`,
        );
        const snapshotUrl = pathToFileURL(snapshotPath).href;
        const harnessHtml = `<!doctype html>
          <html>
            <head><meta charset="utf-8"><title>Responsive audit</title></head>
            <body>
              <iframe
                id="responsive-frame"
                src="${snapshotUrl}"
                title="Responsive audit frame"
                style="display:block;width:${width}px;height:1000px;border:0"
              ></iframe>
              <script>
                (() => {
                  const frame = document.getElementById('responsive-frame');
                  const copyMeasurements = () => {
                    const source = frame.contentDocument.documentElement;
                    const target = document.documentElement;
                    target.dataset.responsiveReady =
                      source.dataset.responsiveReady || '';
                    target.dataset.responsiveInnerWidth =
                      source.dataset.responsiveInnerWidth || '';
                    target.dataset.responsiveOverflow =
                      source.dataset.responsiveOverflow || '';
                    target.dataset.responsiveWrappedCount =
                      source.dataset.responsiveWrappedCount || '';
                  };
                  frame.addEventListener('load', copyMeasurements, {
                    once: true
                  });
                })();
              </script>
            </body>
          </html>`;
        fs.writeFileSync(harnessPath, harnessHtml, 'utf8');
        const browserProcess = spawn(
          browserExecutable,
          [
            '--headless=new',
            '--allow-file-access-from-files',
            '--disable-background-networking',
            '--disable-default-apps',
            '--disable-extensions',
            '--disable-gpu',
            '--disable-sync',
            '--force-device-scale-factor=1',
            '--no-first-run',
            '--no-proxy-server',
            '--run-all-compositor-stages-before-draw',
            `--user-data-dir=${profileDirectory}`,
            '--virtual-time-budget=1200',
            '--window-size=1280,1100',
            '--dump-dom',
            pathToFileURL(harnessPath).href,
          ],
          {
            stdio: ['ignore', 'pipe', 'ignore'],
            windowsHide: true,
          },
        );
        let output = '';
        browserProcess.stdout.setEncoding('utf8');
        browserProcess.stdout.on('data', (chunk) => {
          output += chunk;
        });
        const browserStatus = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            browserProcess.kill();
            resolve(null);
          }, 30000);

          browserProcess.once('error', (error) => {
            clearTimeout(timeout);
            reject(error);
          });
          browserProcess.once('close', (code) => {
            clearTimeout(timeout);
            resolve(code);
          });
        });
        checkEqual(
          browserStatus,
          0,
          `Chromium phải render ${page.label} ở ${width}px`,
        );
        const innerWidth = Number(
          output.match(/data-responsive-inner-width="(-?\d+)"/)?.[1],
        );
        const overflow = Number(
          output.match(/data-responsive-overflow="(-?\d+)"/)?.[1],
        );
        const wrappedCount = Number(
          output.match(/data-responsive-wrapped-count="(\d+)"/)?.[1],
        );

        checkEqual(
          innerWidth,
          width,
          `Viewport ${width}px phải đúng CSS width`,
        );
        check(
          overflow <= 0,
          `${page.label} không được tràn ngang ở ${width}px (đang tràn ${overflow}px)`,
        );
        checkEqual(
          wrappedCount,
          0,
          `${page.label} không được có nhãn click xuống hai dòng ở ${width}px`,
        );
      }
    }
  } finally {
    fs.rmSync(browserDataDirectory, {
      force: true,
      maxRetries: 10,
      recursive: true,
      retryDelay: 100,
    });
  }
};

const cleanupTestData = async () => {
  const cleanup = {
    categoriesDeleted: 0,
    conversationsDeleted: 0,
    favoritesDeleted: 0,
    filesDeleted: 0,
    globalOrphanDocuments: 0,
    globalOrphanFiles: 0,
    listingsDeleted: 0,
    messagesDeleted: 0,
    remainingTestCategories: 0,
    remainingTestConversations: 0,
    remainingTestFavorites: 0,
    remainingTestFiles: 0,
    remainingTestListings: 0,
    remainingTestMessages: 0,
    remainingTestUsers: 0,
    sessionsDeleted: 0,
    usersDeleted: 0,
  };

  if (mongoose.connection.readyState === 0) {
    return cleanup;
  }

  const Category = require('../src/models/Category');
  const Conversation = require('../src/models/Conversation');
  const Favorite = require('../src/models/Favorite');
  const Listing = require('../src/models/Listing');
  const Message = require('../src/models/Message');
  const User = require('../src/models/User');
  const users = await User.find({ email: { $in: [...testEmails] } })
    .select('_id')
    .lean();
  users.forEach((user) => testUserIds.add(user._id.toString()));

  const userIds = [...testUserIds];
  const listingIds = [...testListingIds];
  const categoryIds = [...testCategoryIds];
  const conversationClauses = [];

  if (userIds.length > 0) {
    conversationClauses.push(
      { buyer: { $in: userIds } },
      { seller: { $in: userIds } },
    );
  }
  if (listingIds.length > 0) {
    conversationClauses.push({ listing: { $in: listingIds } });
  }

  const conversationFilter =
    conversationClauses.length > 0 ? { $or: conversationClauses } : null;
  const testConversations = conversationFilter
    ? await Conversation.find(conversationFilter).select('_id').lean()
    : [];
  const conversationIds = testConversations.map((row) => row._id);
  const messageClauses = [];

  if (conversationIds.length > 0) {
    messageClauses.push({ conversation: { $in: conversationIds } });
  }
  if (userIds.length > 0) {
    messageClauses.push(
      { sender: { $in: userIds } },
      { recipient: { $in: userIds } },
    );
  }
  const messageFilter =
    messageClauses.length > 0 ? { $or: messageClauses } : null;

  if (messageFilter) {
    const result = await Message.deleteMany(messageFilter);
    cleanup.messagesDeleted = result.deletedCount;
  }
  if (conversationFilter) {
    const result = await Conversation.deleteMany(conversationFilter);
    cleanup.conversationsDeleted = result.deletedCount;
  }

  const favoriteClauses = [];
  if (userIds.length > 0) {
    favoriteClauses.push({ user: { $in: userIds } });
  }
  if (listingIds.length > 0) {
    favoriteClauses.push({ listing: { $in: listingIds } });
  }
  const favoriteFilter =
    favoriteClauses.length > 0 ? { $or: favoriteClauses } : null;

  if (favoriteFilter) {
    const result = await Favorite.deleteMany(favoriteFilter);
    cleanup.favoritesDeleted = result.deletedCount;
  }
  if (listingIds.length > 0) {
    const result = await Listing.deleteMany({ _id: { $in: listingIds } });
    cleanup.listingsDeleted = result.deletedCount;
  }
  if (categoryIds.length > 0) {
    const result = await Category.deleteMany({
      _id: { $in: categoryIds },
    });
    cleanup.categoriesDeleted = result.deletedCount;
  }

  if (userIds.length > 0) {
    const sessionCollection = mongoose.connection.collection('sessions');
    const sessionIds = [];
    for (const userId of userIds) {
      const sessions = await sessionCollection
        .find({ session: new RegExp(userId) }, { projection: { _id: 1 } })
        .toArray();
      sessions.forEach((session) => sessionIds.push(session._id));
    }
    if (sessionIds.length > 0) {
      const result = await sessionCollection.deleteMany({
        _id: { $in: sessionIds },
      });
      cleanup.sessionsDeleted = result.deletedCount;
    }

    const result = await User.deleteMany({
      _id: { $in: userIds },
      email: { $in: [...testEmails] },
    });
    cleanup.usersDeleted = result.deletedCount;
  }

  for (const filePath of createdFilePaths) {
    try {
      fs.unlinkSync(filePath);
      cleanup.filesDeleted += 1;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  cleanup.remainingTestUsers =
    userIds.length === 0
      ? 0
      : await User.countDocuments({
          _id: { $in: userIds },
          email: { $in: [...testEmails] },
        });
  cleanup.remainingTestListings =
    listingIds.length === 0
      ? 0
      : await Listing.countDocuments({ _id: { $in: listingIds } });
  cleanup.remainingTestCategories =
    categoryIds.length === 0
      ? 0
      : await Category.countDocuments({ _id: { $in: categoryIds } });
  cleanup.remainingTestFavorites = favoriteFilter
    ? await Favorite.countDocuments(favoriteFilter)
    : 0;
  cleanup.remainingTestConversations = conversationFilter
    ? await Conversation.countDocuments(conversationFilter)
    : 0;
  cleanup.remainingTestMessages = messageFilter
    ? await Message.countDocuments(messageFilter)
    : 0;
  cleanup.remainingTestFiles = [...createdFilePaths].filter((filePath) =>
    fs.existsSync(filePath),
  ).length;

  const [
    orphanListings,
    orphanFavorites,
    orphanConversations,
    orphanMessages,
  ] = await Promise.all([
    Listing.aggregate([
      {
        $lookup: {
          from: User.collection.name,
          localField: 'seller',
          foreignField: '_id',
          as: 'sellerDocument',
        },
      },
      {
        $lookup: {
          from: Category.collection.name,
          localField: 'category',
          foreignField: '_id',
          as: 'categoryDocument',
        },
      },
      {
        $match: {
          $or: [
            { sellerDocument: { $size: 0 } },
            { categoryDocument: { $size: 0 } },
          ],
        },
      },
      { $count: 'count' },
    ]),
    Favorite.aggregate([
      {
        $lookup: {
          from: User.collection.name,
          localField: 'user',
          foreignField: '_id',
          as: 'userDocument',
        },
      },
      {
        $lookup: {
          from: Listing.collection.name,
          localField: 'listing',
          foreignField: '_id',
          as: 'listingDocument',
        },
      },
      {
        $match: {
          $or: [
            { userDocument: { $size: 0 } },
            { listingDocument: { $size: 0 } },
          ],
        },
      },
      { $count: 'count' },
    ]),
    Conversation.aggregate([
      {
        $lookup: {
          from: Listing.collection.name,
          localField: 'listing',
          foreignField: '_id',
          as: 'listingDocument',
        },
      },
      {
        $lookup: {
          from: User.collection.name,
          localField: 'buyer',
          foreignField: '_id',
          as: 'buyerDocument',
        },
      },
      {
        $lookup: {
          from: User.collection.name,
          localField: 'seller',
          foreignField: '_id',
          as: 'sellerDocument',
        },
      },
      {
        $match: {
          $or: [
            { listingDocument: { $size: 0 } },
            { buyerDocument: { $size: 0 } },
            { sellerDocument: { $size: 0 } },
          ],
        },
      },
      { $count: 'count' },
    ]),
    Message.aggregate([
      {
        $lookup: {
          from: Conversation.collection.name,
          localField: 'conversation',
          foreignField: '_id',
          as: 'conversationDocument',
        },
      },
      {
        $lookup: {
          from: User.collection.name,
          localField: 'sender',
          foreignField: '_id',
          as: 'senderDocument',
        },
      },
      {
        $lookup: {
          from: User.collection.name,
          localField: 'recipient',
          foreignField: '_id',
          as: 'recipientDocument',
        },
      },
      {
        $match: {
          $or: [
            { conversationDocument: { $size: 0 } },
            { senderDocument: { $size: 0 } },
            { recipientDocument: { $size: 0 } },
          ],
        },
      },
      { $count: 'count' },
    ]),
  ]);
  cleanup.globalOrphanDocuments =
    (orphanListings[0]?.count || 0) +
    (orphanFavorites[0]?.count || 0) +
    (orphanConversations[0]?.count || 0) +
    (orphanMessages[0]?.count || 0);

  const [avatarRows, listingRows] = await Promise.all([
    User.find({ avatar: /^\/uploads\/avatars\// })
      .select('avatar -_id')
      .lean(),
    Listing.find({ images: /^\/uploads\/listings\// })
      .select('images -_id')
      .lean(),
  ]);
  const referencedFiles = new Set([
    ...avatarRows.map((row) =>
      path.resolve(__dirname, '..', row.avatar.replace(/^\//, '')),
    ),
    ...listingRows.flatMap((row) =>
      (row.images || []).map((image) =>
        path.resolve(__dirname, '..', image.replace(/^\//, '')),
      ),
    ),
  ]);
  const uploadDirectories = [
    path.resolve(__dirname, '..', 'uploads', 'avatars'),
    path.resolve(__dirname, '..', 'uploads', 'listings'),
  ];
  cleanup.globalOrphanFiles = uploadDirectories.flatMap((directory) =>
    fs.existsSync(directory)
      ? fs
          .readdirSync(directory, { withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => path.join(directory, entry.name))
      : [],
  ).filter((filePath) => !referencedFiles.has(filePath)).length;

  return cleanup;
};

const run = async () => {
  const originalLog = console.log;
  console.log = () => {};
  await connectDatabase();
  console.log = originalLog;

  const app = require('../src/app');
  server = await listen(app);
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const Category = require('../src/models/Category');
  const Conversation = require('../src/models/Conversation');
  const Favorite = require('../src/models/Favorite');
  const Listing = require('../src/models/Listing');
  const Message = require('../src/models/Message');
  const User = require('../src/models/User');
  const adminDashboardService = require('../src/services/adminDashboard.service');

  await Promise.all([
    Conversation.init(),
    Favorite.init(),
    Listing.init(),
    Message.init(),
    User.init(),
  ]);

  const testId = crypto.randomUUID().replaceAll('-', '');
  const shortId = testId.slice(0, 10);
  const password =
    `${crypto.randomBytes(18).toString('base64url')}7a`;
  const passwordHash = await bcrypt.hash(password, 12);
  const privateMessageContent = crypto.randomUUID();

  const createUser = async (label, status = 'active', role = 'user') => {
    const email = `codex-s12-${label}-${testId}@example.test`;
    testEmails.add(email);
    const user = await User.create({
      name: `S12 ${label} ${shortId}`,
      email,
      password: passwordHash,
      role,
      status,
    });
    testUserIds.add(user._id.toString());
    return user;
  };

  const createListing = async ({
    title,
    seller,
    category,
    status = 'active',
    price = 1000000,
    images = [],
    moderation,
  }) => {
    const listing = await Listing.create({
      title,
      description:
        `Mô tả kiểm thử Bước 12 cho ${title}, đủ độ dài theo validation.`,
      price,
      category,
      seller,
      location: 'TP.HCM',
      condition: 'used',
      images,
      status,
      ...(moderation ? { moderation } : {}),
    });
    testListingIds.add(listing._id.toString());
    return listing;
  };

  const loginUser = async (email) => {
    const response = await request(
      '/login',
      urlEncoded({ email, password }),
    );
    checkEqual(response.status, 303, 'Đăng nhập phải redirect 303');
    check(response.setCookie, 'Đăng nhập phải cấp session cookie');
    return getSessionCookie(response.setCookie);
  };

  const admin = await createUser('admin', 'active', 'admin');
  const secondAdmin = await createUser(
    'admin-second',
    'active',
    'admin',
  );
  const activeUser = await createUser('active');
  const pendingUser = await createUser('pending', 'pending');
  const blockedUser = await createUser('blocked', 'blocked');
  const seller = await createUser('seller');
  const otherUser = await createUser('other');

  const activeCategory = await Category.create({
    name: `S12 Category ${shortId}`,
    slug: `s12-category-${shortId}`,
    description: 'Danh mục fixture cho Bước 12.',
    status: 'active',
  });
  const inactiveCategory = await Category.create({
    name: `S12 Inactive ${shortId}`,
    slug: `s12-inactive-${shortId}`,
    description: 'Danh mục inactive fixture.',
    status: 'inactive',
  });
  testCategoryIds.add(activeCategory._id.toString());
  testCategoryIds.add(inactiveCategory._id.toString());

  const listingImageFilename = `${crypto.randomUUID()}.jpg`;
  const listingImageDirectory = path.resolve(
    __dirname,
    '..',
    'uploads',
    'listings',
  );
  const listingImagePath = path.join(
    listingImageDirectory,
    listingImageFilename,
  );
  fs.mkdirSync(listingImageDirectory, { recursive: true });
  fs.writeFileSync(listingImagePath, Buffer.from('step12-image-fixture'));
  createdFilePaths.add(listingImagePath);
  const listingImagePublicPath =
    `/uploads/listings/${listingImageFilename}`;

  const activeListing = await createListing({
    title: `S12 Active ${shortId}`,
    seller: seller._id,
    category: activeCategory._id,
    images: [listingImagePublicPath],
    price: 3000000,
  });
  const soldListing = await createListing({
    title: `S12 Sold ${shortId}`,
    seller: seller._id,
    category: activeCategory._id,
    status: 'sold',
    price: 4000000,
  });
  const ownerHiddenListing = await createListing({
    title: `S12 Owner Hidden ${shortId}`,
    seller: seller._id,
    category: activeCategory._id,
    status: 'hidden',
  });
  const invalidReasonListing = await createListing({
    title: `S12 Invalid Reason ${shortId}`,
    seller: seller._id,
    category: activeCategory._id,
  });
  const ownedDataListing = await createListing({
    title: `S12 Block Preserve ${shortId}`,
    seller: activeUser._id,
    category: activeCategory._id,
  });

  const favorite = await Favorite.create({
    user: activeUser._id,
    listing: activeListing._id,
  });
  const conversation = await Conversation.create({
    listing: activeListing._id,
    buyer: activeUser._id,
    seller: seller._id,
    lastMessagePreview: privateMessageContent,
    lastMessageAt: new Date(),
    lastSender: activeUser._id,
  });
  const privateMessage = await Message.create({
    conversation: conversation._id,
    sender: activeUser._id,
    recipient: seller._id,
    content: privateMessageContent,
    readAt: null,
  });

  const adminCookie = await loginUser(admin.email);
  const userCookie = await loginUser(activeUser.email);
  const sellerCookie = await loginUser(seller.email);
  const secondAdminCookie = await loginUser(secondAdmin.email);

  // 1–4. Dashboard authorization and blocked session.
  assertLoginRedirect(
    await request('/admin'),
    'Guest không được mở /admin',
  );
  checkEqual(
    (await request('/admin', { cookie: userCookie })).status,
    403,
    'User thường mở /admin phải nhận 403',
  );
  const adminDashboard = await request('/admin', {
    cookie: adminCookie,
  });
  checkEqual(adminDashboard.status, 200, 'Active Admin mở /admin phải 200');
  check(
    adminDashboard.text.includes('Quản trị hệ thống'),
    'Dashboard phải render tiêu đề',
  );
  await User.updateOne(
    { _id: secondAdmin._id },
    { $set: { status: 'blocked' } },
  );
  assertLoginRedirect(
    await request('/admin', { cookie: secondAdminCookie }),
    'Blocked Admin dùng session cũ không được vào Admin',
  );
  await User.updateOne(
    { _id: secondAdmin._id },
    { $set: { status: 'active' } },
  );

  // 5–10. Dashboard counts, privacy and recent ordering.
  const overview =
    await adminDashboardService.getDashboardOverview();
  checkEqual(
    overview.stats.users.total,
    await User.countDocuments(),
    'Dashboard total User phải đúng',
  );
  for (const status of ['active', 'pending', 'blocked']) {
    checkEqual(
      overview.stats.users[status],
      await User.countDocuments({ status }),
      `Dashboard User ${status} phải đúng`,
    );
  }
  for (const status of ['active', 'sold', 'hidden']) {
    checkEqual(
      overview.stats.listings[status],
      await Listing.countDocuments({ status }),
      `Dashboard Listing ${status} phải đúng`,
    );
  }
  checkEqual(
    overview.stats.listings.adminHidden,
    await Listing.countDocuments({
      status: 'hidden',
      'moderation.isHiddenByAdmin': true,
    }),
    'Dashboard admin-hidden phải đúng',
  );
  checkEqual(
    overview.stats.listings.ownerHidden,
    await Listing.countDocuments({
      status: 'hidden',
      'moderation.isHiddenByAdmin': { $ne: true },
    }),
    'Dashboard owner-hidden phải đúng',
  );
  checkEqual(
    overview.stats.categories.active,
    await Category.countDocuments({ status: 'active' }),
    'Dashboard Category active phải đúng',
  );
  checkEqual(
    overview.stats.categories.inactive,
    await Category.countDocuments({ status: 'inactive' }),
    'Dashboard Category inactive phải đúng',
  );
  checkEqual(
    overview.stats.favorites.total,
    await Favorite.countDocuments(),
    'Dashboard Favorite count phải đúng',
  );
  checkEqual(
    overview.stats.conversations.total,
    await Conversation.countDocuments(),
    'Dashboard Conversation count phải đúng',
  );
  checkEqual(
    overview.stats.messages.total,
    await Message.countDocuments(),
    'Dashboard Message count phải đúng',
  );
  check(
    !adminDashboard.text.includes(privateMessageContent),
    'Dashboard không được lộ Message content',
  );
  const expectedRecentUsers = await User.find()
    .sort({ createdAt: -1, _id: -1 })
    .limit(5)
    .select('_id')
    .lean();
  checkEqual(
    overview.recentUsers[0]?._id.toString(),
    expectedRecentUsers[0]?._id.toString(),
    'Recent User phải đúng thứ tự',
  );
  check(
    !Object.hasOwn(overview.recentUsers[0] || {}, 'password'),
    'Recent User không được có password',
  );
  const expectedRecentListings = await Listing.find()
    .sort({ createdAt: -1, _id: -1 })
    .limit(5)
    .select('_id')
    .lean();
  checkEqual(
    overview.recentListings[0]?._id.toString(),
    expectedRecentListings[0]?._id.toString(),
    'Recent Listing phải đúng thứ tự',
  );

  // 11–20. User list/search/filter/sort/pagination/detail.
  const adminUsers = await request('/admin/users', {
    cookie: adminCookie,
  });
  checkEqual(adminUsers.status, 200, 'Admin User list phải 200');
  check(
    !/password|SESSION_SECRET/.test(adminUsers.text),
    'Admin User list không được lộ password/session',
  );
  const nameSearch = await request(
    `/admin/users?keyword=${encodeURIComponent(`S12 active ${shortId}`)}`,
    { cookie: adminCookie },
  );
  check(
    nameSearch.text.includes(activeUser.name),
    'Search User theo name phải đúng',
  );
  const emailSearch = await request(
    `/admin/users?keyword=${encodeURIComponent(pendingUser.email)}`,
    { cookie: adminCookie },
  );
  check(
    emailSearch.text.includes(pendingUser.email),
    'Search User theo email phải đúng',
  );
  for (const [status, user] of [
    ['active', activeUser],
    ['pending', pendingUser],
    ['blocked', blockedUser],
  ]) {
    const filtered = await request(
      `/admin/users?keyword=${shortId}&status=${status}`,
      { cookie: adminCookie },
    );
    check(
      filtered.text.includes(user.email),
      `Filter User ${status} phải đúng`,
    );
  }
  const roleUser = await request(
    `/admin/users?keyword=${shortId}&role=user`,
    { cookie: adminCookie },
  );
  const roleAdmin = await request(
    `/admin/users?keyword=${shortId}&role=admin`,
    { cookie: adminCookie },
  );
  check(
    roleUser.text.includes(activeUser.email) &&
      !roleUser.text.includes(admin.email),
    'Filter role=user phải đúng',
  );
  check(
    roleAdmin.text.includes(admin.email) &&
      !roleAdmin.text.includes(activeUser.email),
    'Filter role=admin phải đúng',
  );

  const sortUsers = await Promise.all([
    createUser('sort-alpha'),
    createUser('sort-zulu'),
  ]);
  const userSortAsc = await request(
    `/admin/users?keyword=${shortId}&sort=name-asc`,
    { cookie: adminCookie },
  );
  const userSortDesc = await request(
    `/admin/users?keyword=${shortId}&sort=name-desc`,
    { cookie: adminCookie },
  );
  check(
    userSortAsc.text.indexOf(sortUsers[0].name) <
      userSortAsc.text.indexOf(sortUsers[1].name),
    'Sort User name-asc phải đúng',
  );
  check(
    userSortDesc.text.indexOf(sortUsers[1].name) <
      userSortDesc.text.indexOf(sortUsers[0].name),
    'Sort User name-desc phải đúng',
  );
  checkEqual(
    (await request('/admin/users?sort=oldest', { cookie: adminCookie }))
      .status,
    200,
    'Sort User oldest phải hợp lệ',
  );
  checkEqual(
    (await request('/admin/users?sort=newest', { cookie: adminCookie }))
      .status,
    200,
    'Sort User newest phải hợp lệ',
  );

  const pageUserKeyword = `S12Page${shortId}`;
  for (let index = 0; index < 22; index += 1) {
    const email =
      `codex-s12-page-${index}-${testId}@example.test`;
    testEmails.add(email);
    const user = await User.create({
      name: `${pageUserKeyword} ${String(index).padStart(2, '0')}`,
      email,
      password: passwordHash,
      role: 'user',
      status: 'active',
    });
    testUserIds.add(user._id.toString());
  }
  const userPageOne = await request(
    `/admin/users?keyword=${pageUserKeyword}`,
    { cookie: adminCookie },
  );
  const userPageTwo = await request(
    `/admin/users?keyword=${pageUserKeyword}&page=2`,
    { cookie: adminCookie },
  );
  checkEqual(
    countMatches(userPageOne.text, /class="admin-person"/g),
    20,
    'User page 1 tối đa 20 row',
  );
  checkEqual(
    countMatches(userPageTwo.text, /class="admin-person"/g),
    2,
    'User page 2 chứa phần còn lại',
  );
  checkEqual(
    (
      await request('/admin/users?status=unknown&debug=1', {
        cookie: adminCookie,
      })
    ).status,
    422,
    'Query User bất hợp lệ phải 422',
  );
  const userDetail = await request(`/admin/users/${activeUser._id}`, {
    cookie: adminCookie,
  });
  checkEqual(userDetail.status, 200, 'Admin User detail phải 200');
  check(
    userDetail.text.includes(activeUser.email) &&
      userDetail.text.includes('Conversation') &&
      !userDetail.text.includes(privateMessageContent),
    'User detail có thống kê nhưng không có Message content',
  );
  checkEqual(
    (await request('/admin/users/not-an-object-id', {
      cookie: adminCookie,
    })).status,
    404,
    'User ID sai không được thành CastError 500',
  );

  // 21–34. User moderation and data preservation.
  const approve = await request(
    `/admin/users/${pendingUser._id}/approve?_method=PATCH`,
    { ...urlEncoded({}), cookie: adminCookie },
  );
  checkEqual(approve.status, 303, 'Duyệt pending phải redirect 303');
  const approvedUser = await User.findById(pendingUser._id).lean();
  checkEqual(approvedUser.status, 'active', 'Pending phải thành active');
  check(
    approvedUser.accountModeration.approvedAt instanceof Date &&
      approvedUser.accountModeration.approvedBy.toString() ===
        admin._id.toString(),
    'Approve phải ghi metadata',
  );
  checkEqual(
    (
      await request(
        `/admin/users/${pendingUser._id}/approve?_method=PATCH`,
        { ...urlEncoded({}), cookie: adminCookie },
      )
    ).status,
    422,
    'Duyệt User active phải 422 nhất quán',
  );
  for (const reason of ['', 'ngắn', 'x'.repeat(501)]) {
    const invalidBlock = await request(
      `/admin/users/${activeUser._id}/block?_method=PATCH`,
      { ...urlEncoded({ reason }), cookie: adminCookie },
    );
    checkEqual(
      invalidBlock.status,
      422,
      'Block reason sai phải 422',
    );
    checkEqual(
      (await User.findById(activeUser._id).select('status').lean()).status,
      'active',
      'Reason sai không được khóa User',
    );
  }
  const injectedRole = await request(
    `/admin/users/${activeUser._id}/block?_method=PATCH`,
    {
      ...urlEncoded({
        reason: 'Lý do hợp lệ nhưng có role giả mạo',
        role: 'admin',
      }),
      cookie: adminCookie,
    },
  );
  checkEqual(injectedRole.status, 422, 'Client gửi role phải bị từ chối');
  checkEqual(
    (await User.findById(activeUser._id).select('role status').lean()).role,
    'user',
    'Role không được thay đổi',
  );
  const arbitraryStatus = await request(
    `/admin/users/${activeUser._id}/approve?_method=PATCH`,
    {
      ...urlEncoded({ status: 'blocked' }),
      cookie: adminCookie,
    },
  );
  checkEqual(
    arbitraryStatus.status,
    422,
    'Client gửi status tùy ý phải bị từ chối',
  );
  checkEqual(
    (
      await request(
        `/admin/users/${admin._id}/block?_method=PATCH`,
        {
          ...urlEncoded({ reason: 'Không được tự khóa quản trị viên' }),
          cookie: adminCookie,
        },
      )
    ).status,
    403,
    'Admin không được tự khóa',
  );
  checkEqual(
    (
      await request(
        `/admin/users/${secondAdmin._id}/block?_method=PATCH`,
        {
          ...urlEncoded({ reason: 'Không được khóa quản trị viên khác' }),
          cookie: adminCookie,
        },
      )
    ).status,
    403,
    'Admin không được khóa Admin khác',
  );

  const scriptReason =
    '<script>alert(1)</script> vi phạm nội quy đăng tin';
  const block = await request(
    `/admin/users/${activeUser._id}/block?_method=PATCH`,
    {
      ...urlEncoded({ reason: scriptReason }),
      cookie: adminCookie,
    },
  );
  checkEqual(block.status, 303, 'Khóa active User phải redirect 303');
  const blockedAfterAction = await User.findById(activeUser._id).lean();
  checkEqual(
    blockedAfterAction.status,
    'blocked',
    'Active User phải thành blocked',
  );
  checkEqual(
    blockedAfterAction.accountModeration.blockedReason,
    scriptReason,
    'Block phải trim và lưu reason',
  );
  check(
    blockedAfterAction.accountModeration.blockedAt instanceof Date &&
      blockedAfterAction.accountModeration.blockedBy.toString() ===
        admin._id.toString(),
    'Block phải ghi time/admin',
  );
  const escapedReasonPage = await request(
    `/admin/users/${activeUser._id}`,
    { cookie: adminCookie },
  );
  check(
    escapedReasonPage.text.includes('&lt;script&gt;') &&
      !escapedReasonPage.text.includes('<script>alert(1)</script>'),
    'Block reason chứa script phải render escaped',
  );
  for (const privatePath of ['/profile', '/favorites', '/messages']) {
    assertLoginRedirect(
      await request(privatePath, { cookie: userCookie }),
      `Blocked User không được tiếp tục ${privatePath}`,
    );
  }
  checkEqual(
    await Listing.countDocuments({ _id: ownedDataListing._id }),
    1,
    'Blocking User không xóa Listing',
  );
  checkEqual(
    await Favorite.countDocuments({ _id: favorite._id }),
    1,
    'Blocking User không xóa Favorite',
  );
  checkEqual(
    await Conversation.countDocuments({ _id: conversation._id }),
    1,
    'Blocking User không xóa Conversation',
  );
  checkEqual(
    await Message.countDocuments({ _id: privateMessage._id }),
    1,
    'Blocking User không xóa Message',
  );
  const unblock = await request(
    `/admin/users/${activeUser._id}/unblock?_method=PATCH`,
    { ...urlEncoded({}), cookie: adminCookie },
  );
  checkEqual(unblock.status, 303, 'Mở khóa phải redirect 303');
  const unblocked = await User.findById(activeUser._id).lean();
  checkEqual(unblocked.status, 'active', 'Blocked User phải thành active');
  checkEqual(
    unblocked.accountModeration.blockedReason,
    '',
    'Unblock phải xóa blockedReason hiện tại',
  );
  const refreshedUserCookie = await loginUser(activeUser.email);

  // 35–44. Listing list/search/filter/sort/pagination/detail.
  const listingList = await request('/admin/listings', {
    cookie: adminCookie,
  });
  checkEqual(listingList.status, 200, 'Admin Listing list phải 200');
  check(
    listingList.text.includes(activeListing.title) &&
      listingList.text.includes(soldListing.title) &&
      listingList.text.includes(ownerHiddenListing.title),
    'Listing list phải có active/sold/hidden',
  );
  const titleSearch = await request(
    `/admin/listings?keyword=${encodeURIComponent(activeListing.title)}`,
    { cookie: adminCookie },
  );
  check(
    titleSearch.text.includes(activeListing.title) &&
      !titleSearch.text.includes(soldListing.title),
    'Search Listing title phải đúng',
  );
  const categoryFilter = await request(
    `/admin/listings?category=${activeCategory.slug}`,
    { cookie: adminCookie },
  );
  check(
    categoryFilter.text.includes(activeListing.title),
    'Filter Listing Category phải đúng',
  );
  const statusFilter = await request(
    `/admin/listings?keyword=${shortId}&status=sold`,
    { cookie: adminCookie },
  );
  check(
    statusFilter.text.includes(soldListing.title) &&
      !statusFilter.text.includes(activeListing.title),
    'Filter Listing status phải đúng',
  );
  const sellerFilter = await request(
    `/admin/listings?seller=${encodeURIComponent(seller.email)}`,
    { cookie: adminCookie },
  );
  check(
    sellerFilter.text.includes(activeListing.title),
    'Search Listing seller phải đúng',
  );

  const sortPrefix = `S12 SORT ${shortId}`;
  const sortLow = await createListing({
    title: `${sortPrefix} Alpha`,
    seller: seller._id,
    category: activeCategory._id,
    price: 100,
  });
  const sortHigh = await createListing({
    title: `${sortPrefix} Zulu`,
    seller: seller._id,
    category: activeCategory._id,
    price: 900,
  });
  const priceAsc = await request(
    `/admin/listings?keyword=${encodeURIComponent(sortPrefix)}&sort=price-asc`,
    { cookie: adminCookie },
  );
  const priceDesc = await request(
    `/admin/listings?keyword=${encodeURIComponent(sortPrefix)}&sort=price-desc`,
    { cookie: adminCookie },
  );
  const titleAsc = await request(
    `/admin/listings?keyword=${encodeURIComponent(sortPrefix)}&sort=title-asc`,
    { cookie: adminCookie },
  );
  check(
    priceAsc.text.indexOf(sortLow.title) <
      priceAsc.text.indexOf(sortHigh.title),
    'Sort Listing price-asc phải đúng',
  );
  check(
    priceDesc.text.indexOf(sortHigh.title) <
      priceDesc.text.indexOf(sortLow.title),
    'Sort Listing price-desc phải đúng',
  );
  check(
    titleAsc.text.indexOf(sortLow.title) <
      titleAsc.text.indexOf(sortHigh.title),
    'Sort Listing title-asc phải đúng',
  );
  checkEqual(
    (
      await request('/admin/listings?sort=oldest', {
        cookie: adminCookie,
      })
    ).status,
    200,
    'Sort Listing oldest phải hợp lệ',
  );
  checkEqual(
    (
      await request('/admin/listings?sort=newest', {
        cookie: adminCookie,
      })
    ).status,
    200,
    'Sort Listing newest phải hợp lệ',
  );

  const listingPagePrefix = `S12-PAGE-${shortId}`;
  const pageListings = [];
  for (let index = 0; index < 22; index += 1) {
    pageListings.push(
      await createListing({
        title: `${listingPagePrefix}-${String(index).padStart(2, '0')}`,
        seller: seller._id,
        category: activeCategory._id,
        price: index + 1000,
      }),
    );
  }
  const listingPageOne = await request(
    `/admin/listings?keyword=${listingPagePrefix}`,
    { cookie: adminCookie },
  );
  const listingPageTwo = await request(
    `/admin/listings?keyword=${listingPagePrefix}&page=2`,
    { cookie: adminCookie },
  );
  checkEqual(
    countMatches(listingPageOne.text, /class="admin-listing-cell"/g),
    20,
    'Listing page 1 tối đa 20 row',
  );
  checkEqual(
    countMatches(listingPageTwo.text, /class="admin-listing-cell"/g),
    2,
    'Listing page 2 chứa phần còn lại',
  );
  const listingDetail = await request(
    `/admin/listings/${activeListing._id}`,
    { cookie: adminCookie },
  );
  checkEqual(listingDetail.status, 200, 'Admin Listing detail phải 200');
  check(
    listingDetail.text.includes(activeListing.title) &&
      listingDetail.text.includes('Favorite') &&
      listingDetail.text.includes('Conversation') &&
      !listingDetail.text.includes(privateMessageContent),
    'Listing detail có metadata/count nhưng không lộ Message',
  );

  // 45–60. Listing moderation, preservation, owner restrictions.
  const validModerationReason = 'Bài đăng vi phạm quy định kiểm duyệt';
  const hideActive = await request(
    `/admin/listings/${activeListing._id}/hide?_method=PATCH`,
    {
      ...urlEncoded({ reason: validModerationReason }),
      cookie: adminCookie,
    },
  );
  checkEqual(hideActive.status, 303, 'Admin hide active phải redirect 303');
  let hiddenActive = await Listing.findById(activeListing._id).lean();
  checkEqual(hiddenActive.status, 'hidden', 'Admin hide phải set hidden');
  checkEqual(
    hiddenActive.moderation.previousStatus,
    'active',
    'Admin hide active phải giữ previousStatus=active',
  );
  check(
    hiddenActive.moderation.isHiddenByAdmin &&
      hiddenActive.moderation.reason === validModerationReason &&
      hiddenActive.moderation.moderatedBy.toString() ===
        admin._id.toString(),
    'Admin hide phải ghi moderation metadata',
  );
  const hideSold = await request(
    `/admin/listings/${soldListing._id}/hide?_method=PATCH`,
    {
      ...urlEncoded({ reason: validModerationReason }),
      cookie: adminCookie,
    },
  );
  checkEqual(hideSold.status, 303, 'Admin hide sold phải redirect 303');
  const hiddenSold = await Listing.findById(soldListing._id).lean();
  checkEqual(
    hiddenSold.moderation.previousStatus,
    'sold',
    'Admin hide sold phải giữ previousStatus=sold',
  );
  for (const reason of ['', 'ngắn', 'x'.repeat(501)]) {
    const invalidHide = await request(
      `/admin/listings/${invalidReasonListing._id}/hide?_method=PATCH`,
      {
        ...urlEncoded({ reason }),
        cookie: adminCookie,
      },
    );
    checkEqual(invalidHide.status, 422, 'Hide reason sai phải 422');
    checkEqual(
      (
        await Listing.findById(invalidReasonListing._id)
          .select('status')
          .lean()
      ).status,
      'active',
      'Hide reason sai không được đổi Listing',
    );
  }
  const repeatHide = await request(
    `/admin/listings/${activeListing._id}/hide?_method=PATCH`,
    {
      ...urlEncoded({ reason: 'Một lý do khác không được ghi đè' }),
      cookie: adminCookie,
    },
  );
  checkEqual(repeatHide.status, 422, 'Hide lại admin-hidden phải 422');
  hiddenActive = await Listing.findById(activeListing._id).lean();
  checkEqual(
    hiddenActive.moderation.previousStatus,
    'active',
    'Hide lại không được ghi đè previousStatus thành hidden',
  );
  const adminHiddenFilter = await request(
    '/admin/listings?moderation=admin-hidden',
    { cookie: adminCookie },
  );
  const ownerHiddenFilter = await request(
    '/admin/listings?moderation=owner-hidden',
    { cookie: adminCookie },
  );
  check(
    adminHiddenFilter.text.includes(activeListing.title) &&
      !adminHiddenFilter.text.includes(ownerHiddenListing.title),
    'Filter admin-hidden chỉ lấy Admin hidden',
  );
  check(
    ownerHiddenFilter.text.includes(ownerHiddenListing.title) &&
      !ownerHiddenFilter.text.includes(activeListing.title),
    'Filter owner-hidden chỉ lấy owner hidden',
  );
  check(
    fs.existsSync(listingImagePath),
    'Admin hide không được xóa ảnh Listing',
  );
  checkEqual(
    await Favorite.countDocuments({ _id: favorite._id }),
    1,
    'Admin hide không được xóa Favorite document',
  );
  const hiddenFavorites = await request('/favorites', {
    cookie: refreshedUserCookie,
  });
  check(
    !hiddenFavorites.text.includes(activeListing.title),
    'Admin-hidden Listing không hiển thị trong Favorites',
  );
  checkEqual(
    await Conversation.countDocuments({ _id: conversation._id }),
    1,
    'Admin hide không được xóa Conversation',
  );
  checkEqual(
    await Message.countDocuments({ _id: privateMessage._id }),
    1,
    'Admin hide không được xóa Message',
  );
  const messageCountBeforeHiddenSend = await Message.countDocuments({
    conversation: conversation._id,
  });
  const hiddenSend = await request(`/messages/${conversation._id}`, {
    ...urlEncoded({ content: crypto.randomUUID() }),
    cookie: refreshedUserCookie,
  });
  checkEqual(hiddenSend.status, 422, 'Admin-hidden chặn gửi Message mới');
  checkEqual(
    await Message.countDocuments({ conversation: conversation._id }),
    messageCountBeforeHiddenSend,
    'Hidden send không được tạo Message',
  );
  checkEqual(
    (
      await request(
        `/listings/${activeListing._id}/status?_method=PATCH`,
        {
          ...urlEncoded({ status: 'active' }),
          cookie: sellerCookie,
        },
      )
    ).status,
    403,
    'Owner không được active admin-hidden Listing',
  );
  checkEqual(
    (
      await request(`/listings/${activeListing._id}/edit`, {
        cookie: sellerCookie,
      })
    ).status,
    403,
    'Owner không được sửa admin-hidden Listing',
  );
  checkEqual(
    (
      await request(
        `/admin/listings/${ownerHiddenListing._id}/restore?_method=PATCH`,
        { ...urlEncoded({}), cookie: adminCookie },
      )
    ).status,
    422,
    'Admin không được restore owner-hidden Listing',
  );
  const restoreActive = await request(
    `/admin/listings/${activeListing._id}/restore?_method=PATCH`,
    { ...urlEncoded({}), cookie: adminCookie },
  );
  const restoreSold = await request(
    `/admin/listings/${soldListing._id}/restore?_method=PATCH`,
    { ...urlEncoded({}), cookie: adminCookie },
  );
  checkEqual(restoreActive.status, 303, 'Restore active phải 303');
  checkEqual(restoreSold.status, 303, 'Restore sold phải 303');
  checkEqual(
    (await Listing.findById(activeListing._id).select('status').lean())
      .status,
    'active',
    'Restore phải đưa active Listing về active',
  );
  checkEqual(
    (await Listing.findById(soldListing._id).select('status').lean())
      .status,
    'sold',
    'Restore phải đưa sold Listing về sold',
  );
  const restoredFavorites = await request('/favorites', {
    cookie: refreshedUserCookie,
  });
  check(
    restoredFavorites.text.includes(activeListing.title),
    'Restore phải làm Favorite xuất hiện lại',
  );
  const restoredSend = await request(`/messages/${conversation._id}`, {
    ...urlEncoded({ content: crypto.randomUUID() }),
    cookie: refreshedUserCookie,
  });
  checkEqual(
    restoredSend.status,
    303,
    'Restore active phải cho Conversation gửi lại',
  );
  checkEqual(
    (
      await request('/admin/listings/not-an-object-id', {
        cookie: adminCookie,
      })
    ).status,
    404,
    'Listing ID sai không được thành CastError 500',
  );
  checkEqual(
    (
      await request('/admin/listings?keyword[$ne]=x', {
        cookie: adminCookie,
      })
    ).status,
    422,
    'NoSQL operator trong query phải bị từ chối',
  );
  checkEqual(
    (
      await request('/admin/listings', {
        cookie: refreshedUserCookie,
      })
    ).status,
    403,
    'User thường gọi Admin Listing route phải 403',
  );

  // 61–65. Privacy boundaries.
  checkEqual(
    (await request('/admin/messages', { cookie: adminCookie })).status,
    404,
    'Không được có Admin Message detail route',
  );
  checkEqual(
    (
      await request(`/messages/${conversation._id}`, {
        cookie: adminCookie,
      })
    ).status,
    404,
    'Admin không phải participant vẫn nhận 404',
  );
  const privacyDashboard = await request('/admin', {
    cookie: adminCookie,
  });
  const privacyUser = await request(`/admin/users/${activeUser._id}`, {
    cookie: adminCookie,
  });
  const privacyListing = await request(
    `/admin/listings/${activeListing._id}`,
    { cookie: adminCookie },
  );
  for (const [label, response] of [
    ['Dashboard', privacyDashboard],
    ['User detail', privacyUser],
    ['Listing detail', privacyListing],
  ]) {
    check(
      !response.text.includes(privateMessageContent),
      `${label} không được chứa Message content`,
    );
  }

  // 66. Auth regression: register/login/session/logout.
  const regressionEmail =
    `codex-s12-regression-${testId}@example.test`;
  testEmails.add(regressionEmail);
  const register = await request(
    '/register',
    urlEncoded({
      name: `S12 Regression ${shortId}`,
      email: regressionEmail,
      password,
      confirmPassword: password,
    }),
  );
  checkEqual(register.status, 303, 'Auth register phải hoạt động');
  const regressionUser = await User.findOne({
    email: regressionEmail,
  }).lean();
  testUserIds.add(regressionUser._id.toString());
  const regressionCookie = await loginUser(regressionEmail);
  checkEqual(
    (await request('/', { cookie: regressionCookie })).status,
    200,
    'Session phải sống qua request tiếp theo',
  );
  checkEqual(
    (
      await request('/logout', {
        ...urlEncoded({}),
        cookie: regressionCookie,
      })
    ).status,
    303,
    'Logout phải hoạt động',
  );
  assertLoginRedirect(
    await request('/profile', { cookie: regressionCookie }),
    'Cookie sau logout không được mở profile',
  );

  // 67. Category regression.
  const publicCategories = await request('/categories');
  const adminCategories = await request('/admin/categories', {
    cookie: adminCookie,
  });
  check(
    publicCategories.text.includes(activeCategory.name) &&
      publicCategories.text.includes('category-card__icon-svg'),
    'Category public active/icon phải hoạt động',
  );
  check(
    !publicCategories.text.includes(inactiveCategory.name),
    'Category inactive không được public',
  );
  checkEqual(
    (
      await request(`/categories/${inactiveCategory.slug}`)
    ).status,
    404,
    'Category inactive detail phải 404',
  );
  checkEqual(adminCategories.status, 200, 'Admin Category phải hoạt động');
  check(
    adminCategories.text.includes('aria-current="page"'),
    'Admin Category navigation phải có current page',
  );

  // 68–71. Listing CRUD/upload/search/Profile regression.
  const createFormData = new FormData();
  for (const [key, value] of Object.entries({
    title: `S12 CRUD ${shortId}`,
    description:
      'Bài đăng CRUD Bước 12 có mô tả đủ dài để kiểm thử regression.',
    price: '2500000',
    category: activeCategory._id.toString(),
    location: 'Đà Nẵng',
    condition: 'used',
  })) {
    createFormData.append(key, value);
  }
  createFormData.append(
    'images',
    new Blob([createImageFixture('image/jpeg')], { type: 'image/jpeg' }),
    'fixture.jpg',
  );
  const createCrud = await request('/listings', {
    method: 'POST',
    body: createFormData,
    cookie: refreshedUserCookie,
  });
  checkEqual(createCrud.status, 303, 'Listing create/upload phải hoạt động');
  const crudListingId = createCrud.location.match(
    /^\/listings\/([0-9a-f]{24})\?created=1$/,
  )?.[1];
  check(crudListingId, 'Listing create phải trả ID an toàn');
  testListingIds.add(crudListingId);
  const crudListing = await Listing.findById(crudListingId).lean();
  checkEqual(crudListing.images.length, 1, 'Upload phải lưu một image path');
  const crudImagePath = path.resolve(
    __dirname,
    '..',
    crudListing.images[0].replace(/^\//, ''),
  );
  createdFilePaths.add(crudImagePath);
  check(fs.existsSync(crudImagePath), 'Upload Listing phải tạo file');
  checkEqual(
    (await request(`/listings/${crudListingId}`)).status,
    200,
    'Listing read phải hoạt động',
  );
  const updateCrud = await request(
    `/listings/${crudListingId}?_method=PUT`,
    {
      ...urlEncoded({
        title: `S12 CRUD Updated ${shortId}`,
        description:
          'Bài đăng CRUD Bước 12 đã cập nhật với mô tả đủ dài.',
        price: '2600000',
        category: activeCategory._id.toString(),
        location: 'Hà Nội',
        condition: 'new',
      }),
      cookie: refreshedUserCookie,
    },
  );
  checkEqual(updateCrud.status, 303, 'Listing update phải hoạt động');
  for (const status of ['sold', 'active', 'hidden']) {
    const statusResponse = await request(
      `/listings/${crudListingId}/status?_method=PATCH`,
      {
        ...urlEncoded({ status }),
        cookie: refreshedUserCookie,
      },
    );
    checkEqual(
      statusResponse.status,
      303,
      `Listing ${status} regression phải hoạt động`,
    );
  }
  const gallery = await request(`/listings/${activeListing._id}`);
  check(
    gallery.text.includes('listing-detail-media-frame') &&
      gallery.text.includes(listingImagePublicPath),
    'Listing gallery/placeholder route phải render',
  );
  const searchRegression = await request(
    `/listings?keyword=${encodeURIComponent(activeListing.title)}` +
      `&category=${activeCategory.slug}&condition=used` +
      '&minPrice=1000000&maxPrice=5000000&location=TP.HCM' +
      '&status=active&sort=price-asc&page=1',
  );
  checkEqual(searchRegression.status, 200, 'Search regression phải 200');
  check(
    searchRegression.text.includes(activeListing.title),
    'Search regression phải trả Listing đúng',
  );
  const profile = await request('/profile', {
    cookie: refreshedUserCookie,
  });
  const profileEdit = await request('/profile/edit', {
    cookie: refreshedUserCookie,
  });
  checkEqual(profile.status, 200, 'Profile view phải hoạt động');
  checkEqual(profileEdit.status, 200, 'Profile edit phải hoạt động');
  const avatarForm = new FormData();
  avatarForm.append('name', activeUser.name);
  avatarForm.append('phone', '0912345678');
  avatarForm.append('address', 'TP.HCM');
  avatarForm.append(
    'avatar',
    new Blob([createImageFixture('image/png')], { type: 'image/png' }),
    'avatar.png',
  );
  const avatarUpdate = await request('/profile?_method=PUT', {
    method: 'POST',
    body: avatarForm,
    cookie: refreshedUserCookie,
  });
  checkEqual(avatarUpdate.status, 303, 'Avatar update phải hoạt động');
  const avatarUser = await User.findById(activeUser._id)
    .select('avatar')
    .lean();
  const avatarFilePath = path.resolve(
    __dirname,
    '..',
    avatarUser.avatar.replace(/^\//, ''),
  );
  createdFilePaths.add(avatarFilePath);
  check(fs.existsSync(avatarFilePath), 'Avatar upload phải tạo file');
  const profileHeader = await request('/', {
    cookie: refreshedUserCookie,
  });
  check(
    profileHeader.text.includes(avatarUser.avatar),
    'Header phải dùng avatar mới',
  );

  // 72. Favorite regression including pagination.
  const favoriteTargetIds = pageListings.slice(0, 13).map((item) => item._id);
  for (const listingId of favoriteTargetIds) {
    const add = await request(`/listings/${listingId}/favorite`, {
      ...urlEncoded({ returnTo: '/favorites' }),
      cookie: refreshedUserCookie,
    });
    checkEqual(add.status, 303, 'Favorite add phải hoạt động');
  }
  const favoritePageOne = await request('/favorites', {
    cookie: refreshedUserCookie,
  });
  const favoritePageTwo = await request('/favorites?page=2', {
    cookie: refreshedUserCookie,
  });
  checkEqual(
    countMatches(favoritePageOne.text, /class="card product-card"/g),
    12,
    'Favorite page 1 tối đa 12 card',
  );
  check(
    countMatches(favoritePageTwo.text, /class="card product-card"/g) >= 1,
    'Favorite page 2 phải có phần còn lại',
  );
  const removeFavoriteId = favoriteTargetIds[0];
  const removeFavorite = await request(
    `/listings/${removeFavoriteId}/favorite?_method=DELETE`,
    {
      ...urlEncoded({ returnTo: '/favorites' }),
      cookie: refreshedUserCookie,
    },
  );
  checkEqual(removeFavorite.status, 303, 'Favorite remove phải hoạt động');
  checkEqual(
    await Favorite.countDocuments({
      user: activeUser._id,
      listing: removeFavoriteId,
    }),
    0,
    'Favorite remove phải xóa đúng document',
  );

  // 73. Message regression: conversation/send/read/unread/privacy.
  const messageBuyer = otherUser;
  const messageBuyerCookie = await loginUser(messageBuyer.email);
  const startConversation = await request(
    `/listings/${activeListing._id}/conversations`,
    {
      ...urlEncoded({}),
      cookie: messageBuyerCookie,
    },
  );
  checkEqual(
    startConversation.status,
    303,
    'Message Conversation start phải hoạt động',
  );
  const regressionConversationId = startConversation.location.match(
    /^\/messages\/([0-9a-f]{24})#latest$/,
  )?.[1];
  check(regressionConversationId, 'Conversation redirect phải có ID');
  const runtimeMessage = crypto.randomUUID();
  const sendMessage = await request(
    `/messages/${regressionConversationId}`,
    {
      ...urlEncoded({ content: runtimeMessage }),
      cookie: messageBuyerCookie,
    },
  );
  checkEqual(sendMessage.status, 303, 'Message send phải hoạt động');
  const sentDocument = await Message.findOne({
    conversation: regressionConversationId,
    sender: messageBuyer._id,
  }).lean();
  check(sentDocument && sentDocument.readAt === null, 'Unread phải được lưu');
  const sellerConversation = await request(
    `/messages/${regressionConversationId}`,
    { cookie: sellerCookie },
  );
  checkEqual(
    sellerConversation.status,
    200,
    'Seller participant phải mở Conversation',
  );
  check(
    (
      await Message.findById(sentDocument._id).select('readAt').lean()
    ).readAt instanceof Date,
    'Mở Conversation phải mark read',
  );
  checkEqual(
    (
      await request(`/messages/${regressionConversationId}`, {
        cookie: adminCookie,
      })
    ).status,
    404,
    'Admin ngoài participant không được đọc Message',
  );

  // 74. Hallmark responsive regression.
  const responsiveDashboard = await request('/admin', {
    cookie: adminCookie,
  });
  const responsiveUsers = await request(
    `/admin/users?keyword=${pageUserKeyword}`,
    { cookie: adminCookie },
  );
  const responsiveListings = await request(
    `/admin/listings?keyword=${listingPagePrefix}`,
    { cookie: adminCookie },
  );
  await runResponsiveBrowserAudit({
    pages: [
      { html: responsiveDashboard.text, label: 'admin-dashboard' },
      { html: responsiveUsers.text, label: 'admin-users' },
      { html: responsiveListings.text, label: 'admin-listings' },
    ],
  });

  const adminCss = fs.readFileSync(
    path.resolve(__dirname, '..', 'src', 'public', 'css', 'admin.css'),
    'utf8',
  );
  check(
    adminCss.includes('Hallmark · macrostructure: Stat-Led') &&
      adminCss.includes('@media (prefers-reduced-motion: reduce)') &&
      adminCss.includes('object-fit: contain'),
    'Admin CSS phải giữ Hallmark stamp, reduced motion và ảnh contain',
  );
  check(
    !adminCss.includes('overflow-x: hidden') &&
      !adminCss.includes('transition-all'),
    'Admin CSS không được che overflow hoặc dùng transition-all',
  );
};

const main = async () => {
  let cleanup;
  let runError;

  try {
    await run();
  } catch (error) {
    runError = error;
  } finally {
    try {
      await closeServer();
      cleanup = await cleanupTestData();
    } finally {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
    }
  }

  if (runError) {
    throw runError;
  }

  for (const [key, value] of Object.entries({
    remainingTestUsers: cleanup.remainingTestUsers,
    remainingTestListings: cleanup.remainingTestListings,
    remainingTestCategories: cleanup.remainingTestCategories,
    remainingTestFavorites: cleanup.remainingTestFavorites,
    remainingTestConversations: cleanup.remainingTestConversations,
    remainingTestMessages: cleanup.remainingTestMessages,
    remainingTestFiles: cleanup.remainingTestFiles,
  })) {
    checkEqual(value, 0, `${key} phải bằng 0 sau cleanup`);
  }

  console.log(
    JSON.stringify(
      {
        assertions: assertionCount,
        cleanup,
        coveredCases: 74,
        status: 'passed',
        suite: 'Step 12 Admin Dashboard and Moderation E2E',
      },
      null,
      2,
    ),
  );
  process.exit(0);
};

main().catch((error) => {
  const safeMessage =
    error?.code === 'ERR_ASSERTION'
      ? error.message
      : 'Unexpected E2E failure; sensitive details were suppressed.';
  console.error(`Step 12 E2E failed: ${safeMessage}`);
  process.exit(1);
});
