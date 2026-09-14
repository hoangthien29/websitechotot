require('dotenv').config({ quiet: true });

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const mongoose = require('mongoose');

const connectDatabase = require('../src/config/database');
const { prepareCsrfHeaders } = require('./e2eCsrf');

process.env.NODE_ENV = 'test';

let assertionCount = 0;
let server;
let baseUrl;
const testEmails = new Set();
const testUserIds = new Set();
const testCategoryIds = new Set();
const testListingIds = new Set();

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

  check(browserExecutable, 'A Chromium browser is required for viewport audit');

  const browserDataDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ntt-step11-browser-'),
  );
  const selectors = [
    '.site-navbar .nav-link',
    '.site-navbar .btn',
    '.messages-page-heading .btn',
    '.message-back-nav a',
    '.conversation-header > .btn',
    '.message-page-navigation .btn',
    '.message-compose-actions .btn',
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
    const widths = [320, 375, 414, 768];

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
                style="display:block;width:${width}px;height:900px;border:0"
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
            '--virtual-time-budget=1000',
            '--window-size=1024,1000',
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
          `Chromium must render ${page.label} at ${width}px`,
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
          `Viewport ${width}px must use the requested CSS width`,
        );
        check(
          overflow <= 0,
          `${page.label} must not overflow horizontally at ${width}px`,
        );
        checkEqual(
          wrappedCount,
          0,
          `${page.label} clickable labels must not wrap at ${width}px`,
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

const registerUser = async (email, password, name) => {
  testEmails.add(email);
  const response = await request(
    '/register',
    urlEncoded({
      confirmPassword: password,
      email,
      name,
      password,
    }),
  );

  checkEqual(response.status, 303, 'Register must redirect with 303');
};

const loginUser = async (email, password) => {
  const response = await request(
    '/login',
    urlEncoded({ email, password }),
  );

  checkEqual(response.status, 303, 'Login must redirect with 303');
  check(response.setCookie.length > 0, 'Login must issue a session cookie');
  return getSessionCookie(response.setCookie);
};

const countMatches = (source, pattern) =>
  (source.match(pattern) || []).length;

const assertLoginRedirect = (response, message) => {
  checkEqual(response.status, 303, message);
  check(
    response.location.startsWith('/login'),
    `${message}: location must be internal login`,
  );
};

const cleanupTestData = async () => {
  const cleanup = {
    categoriesDeleted: 0,
    conversationsDeleted: 0,
    favoritesDeleted: 0,
    listingsDeleted: 0,
    messagesDeleted: 0,
    orphanConversations: 0,
    orphanMessages: 0,
    remainingTestConversations: 0,
    remainingTestMessages: 0,
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

  if (favoriteClauses.length > 0) {
    const result = await Favorite.deleteMany({ $or: favoriteClauses });
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

  cleanup.remainingTestConversations = conversationFilter
    ? await Conversation.countDocuments(conversationFilter)
    : 0;
  cleanup.remainingTestMessages = messageFilter
    ? await Message.countDocuments(messageFilter)
    : 0;

  const [orphanConversationRows, orphanMessageRows] = await Promise.all([
    Conversation.aggregate([
      {
        $lookup: {
          from: 'listings',
          localField: 'listing',
          foreignField: '_id',
          as: 'listingDocument',
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: 'buyer',
          foreignField: '_id',
          as: 'buyerDocument',
        },
      },
      {
        $lookup: {
          from: 'users',
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
          from: 'conversations',
          localField: 'conversation',
          foreignField: '_id',
          as: 'conversationDocument',
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: 'sender',
          foreignField: '_id',
          as: 'senderDocument',
        },
      },
      {
        $lookup: {
          from: 'users',
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

  cleanup.orphanConversations = orphanConversationRows[0]?.count || 0;
  cleanup.orphanMessages = orphanMessageRows[0]?.count || 0;

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
  const messageService = require('../src/services/message.service');

  await Promise.all([
    Conversation.init(),
    Favorite.init(),
    Message.init(),
  ]);

  const testId = crypto.randomUUID().replaceAll('-', '');
  const password = `Step11A1!${testId}`;
  const buyerEmail = `codex-step11-buyer-${testId}@example.test`;
  const sellerEmail = `codex-step11-seller-${testId}@example.test`;
  const thirdEmail = `codex-step11-third-${testId}@example.test`;
  const adminEmail = `codex-step11-admin-${testId}@example.test`;

  await registerUser(buyerEmail, password, 'Step 11 Buyer');
  await registerUser(sellerEmail, password, 'Step 11 Seller');
  await registerUser(thirdEmail, password, 'Step 11 Third');
  await registerUser(adminEmail, password, 'Step 11 Admin');

  await User.updateOne(
    { email: adminEmail },
    { $set: { role: 'admin' } },
  );

  const [buyer, seller, third, admin] = await Promise.all([
    User.findOne({ email: buyerEmail }).select('_id name').lean(),
    User.findOne({ email: sellerEmail }).select('_id name').lean(),
    User.findOne({ email: thirdEmail }).select('_id name').lean(),
    User.findOne({ email: adminEmail }).select('_id name role').lean(),
  ]);

  [buyer, seller, third, admin].forEach((user) => {
    check(user?._id, 'Each test User must exist');
    testUserIds.add(user._id.toString());
  });
  checkEqual(admin.role, 'admin', 'Admin test role must be active');

  const [buyerCookie, sellerCookie, thirdCookie, adminCookie] =
    await Promise.all([
      loginUser(buyerEmail, password),
      loginUser(sellerEmail, password),
      loginUser(thirdEmail, password),
      loginUser(adminEmail, password),
    ]);

  const category = await Category.create({
    name: `Step 11 test ${testId}`,
    slug: `step-11-test-${testId}`,
    description: 'Category used only for Step 11 messaging verification.',
    status: 'active',
  });
  testCategoryIds.add(category._id.toString());

  const createListing = async (suffix, status = 'active', owner = seller) => {
    const listing = await Listing.create({
      category: category._id,
      condition: 'used',
      description:
        `Step 11 listing ${suffix} has enough text for validation and cleanup.`,
      images: [],
      location: 'Ho Chi Minh City',
      price: 1100000,
      seller: owner._id,
      status,
      title: `Step11 ${suffix} ${testId.slice(0, 8)}`,
    });
    testListingIds.add(listing._id.toString());
    return listing;
  };

  const activeListing = await createListing('Active');
  const soldListing = await createListing('Sold new', 'sold');
  const hiddenListing = await createListing('Hidden new', 'hidden');

  const guestList = await request('/messages');
  assertLoginRedirect(guestList, 'Guest message list must require login');
  check(
    !guestList.text.includes(activeListing.title),
    'Guest redirect must not disclose a Conversation',
  );

  const guestShow = await request(
    `/messages/${new mongoose.Types.ObjectId()}`,
  );
  assertLoginRedirect(guestShow, 'Guest Conversation must require login');

  const guestConversationCount = await Conversation.countDocuments({
    listing: activeListing._id,
  });
  const guestStart = await request(
    `/listings/${activeListing._id}/conversations`,
    urlEncoded({}),
  );
  assertLoginRedirect(guestStart, 'Guest cannot create a Conversation');
  checkEqual(
    await Conversation.countDocuments({ listing: activeListing._id }),
    guestConversationCount,
    'Guest request must not create a Conversation document',
  );

  const guestMessageCount = await Message.countDocuments();
  const guestSend = await request(
    `/messages/${new mongoose.Types.ObjectId()}`,
    urlEncoded({ content: 'guest must not send' }),
  );
  assertLoginRedirect(guestSend, 'Guest cannot send a Message');
  checkEqual(
    await Message.countDocuments(),
    guestMessageCount,
    'Guest request must not create a Message document',
  );

  const start = await request(
    `/listings/${activeListing._id}/conversations`,
    {
      ...urlEncoded({}),
      cookie: buyerCookie,
    },
  );
  checkEqual(start.status, 303, 'Active Listing must create Conversation');
  const conversationMatch = start.location.match(
    /^\/messages\/([0-9a-f]{24})#latest$/,
  );
  check(conversationMatch, 'Conversation redirect must contain a safe ID');
  const conversationId = conversationMatch[1];
  const conversation = await Conversation.findById(conversationId).lean();
  checkEqual(
    conversation.buyer.toString(),
    buyer._id.toString(),
    'Conversation buyer must come from req.user',
  );
  checkEqual(
    conversation.seller.toString(),
    seller._id.toString(),
    'Conversation seller must come from Listing',
  );

  const duplicateStart = await request(
    `/listings/${activeListing._id}/conversations`,
    {
      ...urlEncoded({}),
      cookie: buyerCookie,
    },
  );
  checkEqual(duplicateStart.status, 303, 'Duplicate start must be handled');
  checkEqual(
    duplicateStart.location,
    start.location,
    'Duplicate start must reuse the existing Conversation',
  );
  checkEqual(
    await Conversation.countDocuments({
      buyer: buyer._id,
      listing: activeListing._id,
      seller: seller._id,
    }),
    1,
    'Unique participant triplet must have one document',
  );

  const concurrentListing = await createListing('Concurrent');
  const concurrentResponses = await Promise.all([
    request(`/listings/${concurrentListing._id}/conversations`, {
      ...urlEncoded({}),
      cookie: buyerCookie,
    }),
    request(`/listings/${concurrentListing._id}/conversations`, {
      ...urlEncoded({}),
      cookie: buyerCookie,
    }),
  ]);
  concurrentResponses.forEach((response) =>
    checkEqual(
      response.status,
      303,
      'Concurrent start request must not produce an unhandled 500',
    ),
  );
  checkEqual(
    concurrentResponses[0].location,
    concurrentResponses[1].location,
    'Concurrent starts must resolve to the same Conversation',
  );
  checkEqual(
    await Conversation.countDocuments({
      buyer: buyer._id,
      listing: concurrentListing._id,
      seller: seller._id,
    }),
    1,
    'Unique index must prevent concurrent duplicates',
  );

  const ownerStart = await request(
    `/listings/${activeListing._id}/conversations`,
    {
      ...urlEncoded({}),
      cookie: sellerCookie,
    },
  );
  checkEqual(ownerStart.status, 403, 'Seller cannot chat with self');
  checkEqual(
    await Conversation.countDocuments({
      buyer: seller._id,
      listing: activeListing._id,
    }),
    0,
    'Self-chat must not create a Conversation',
  );

  const soldStart = await request(
    `/listings/${soldListing._id}/conversations`,
    {
      ...urlEncoded({}),
      cookie: buyerCookie,
    },
  );
  checkEqual(soldStart.status, 422, 'Sold Listing without chat must be 422');
  checkEqual(
    await Conversation.countDocuments({ listing: soldListing._id }),
    0,
    'Sold Listing must not create a new Conversation',
  );

  const hiddenStart = await request(
    `/listings/${hiddenListing._id}/conversations`,
    {
      ...urlEncoded({}),
      cookie: buyerCookie,
    },
  );
  checkEqual(hiddenStart.status, 404, 'Hidden Listing start must be 404');
  check(
    !hiddenStart.text.includes(hiddenListing.title),
    'Hidden Listing response must not disclose its title',
  );
  checkEqual(
    await Conversation.countDocuments({ listing: hiddenListing._id }),
    0,
    'Hidden Listing must not create a new Conversation',
  );

  await Listing.updateOne(
    { _id: activeListing._id },
    { $set: { status: 'sold' } },
  );
  const soldBuyerView = await request(`/messages/${conversationId}`, {
    cookie: buyerCookie,
  });
  const soldSellerView = await request(`/messages/${conversationId}`, {
    cookie: sellerCookie,
  });
  checkEqual(soldBuyerView.status, 200, 'Buyer can view an existing sold chat');
  checkEqual(soldSellerView.status, 200, 'Seller can view an existing sold chat');

  const buyerMessageContent = `Buyer-valid-${testId}`;
  const buyerSend = await request(`/messages/${conversationId}`, {
    ...urlEncoded({ content: buyerMessageContent }),
    cookie: buyerCookie,
  });
  checkEqual(buyerSend.status, 303, 'Buyer can send in an existing sold chat');
  const buyerMessage = await Message.findOne({
    content: buyerMessageContent,
  }).lean();
  check(buyerMessage, 'Buyer Message must be stored');
  checkEqual(
    buyerMessage.sender.toString(),
    buyer._id.toString(),
    'Message sender must be buyer',
  );
  checkEqual(
    buyerMessage.recipient.toString(),
    seller._id.toString(),
    'Message recipient must be seller',
  );
  checkEqual(buyerMessage.readAt, null, 'New Message readAt must be null');

  const sellerMessageContent = `Seller-reply-${testId}`;
  const sellerSend = await request(`/messages/${conversationId}`, {
    ...urlEncoded({ content: sellerMessageContent }),
    cookie: sellerCookie,
  });
  checkEqual(sellerSend.status, 303, 'Seller can reply in a sold chat');
  const sellerMessage = await Message.findOne({
    content: sellerMessageContent,
  }).lean();
  checkEqual(
    sellerMessage.sender.toString(),
    seller._id.toString(),
    'Reply sender must be seller',
  );
  checkEqual(
    sellerMessage.recipient.toString(),
    buyer._id.toString(),
    'Reply recipient must be buyer',
  );

  const historyListing = await createListing('Hidden history');
  const historyStart = await request(
    `/listings/${historyListing._id}/conversations`,
    {
      ...urlEncoded({}),
      cookie: buyerCookie,
    },
  );
  const historyConversationId =
    historyStart.location.match(/\/messages\/([0-9a-f]{24})/)?.[1];
  check(historyConversationId, 'History Conversation must be created');
  await request(`/messages/${historyConversationId}`, {
    ...urlEncoded({ content: `History-${testId}` }),
    cookie: buyerCookie,
  });
  await Listing.updateOne(
    { _id: historyListing._id },
    { $set: { status: 'hidden' } },
  );
  const hiddenBuyerView = await request(
    `/messages/${historyConversationId}`,
    { cookie: buyerCookie },
  );
  const hiddenSellerView = await request(
    `/messages/${historyConversationId}`,
    { cookie: sellerCookie },
  );
  checkEqual(hiddenBuyerView.status, 200, 'Buyer keeps hidden Listing history');
  checkEqual(hiddenSellerView.status, 200, 'Seller keeps hidden Listing history');
  check(
    hiddenBuyerView.text.includes('message-readonly-notice'),
    'Hidden Listing chat must be read-only',
  );
  check(
    !hiddenBuyerView.text.includes(`href="/listings/${historyListing._id}"`),
    'Hidden Listing chat must not expose a public Listing link',
  );
  const hiddenMessageCount = await Message.countDocuments({
    conversation: historyConversationId,
  });
  const hiddenSend = await request(`/messages/${historyConversationId}`, {
    ...urlEncoded({ content: 'must not be saved while hidden' }),
    cookie: buyerCookie,
  });
  checkEqual(hiddenSend.status, 422, 'Hidden Listing chat cannot send');
  checkEqual(
    await Message.countDocuments({ conversation: historyConversationId }),
    hiddenMessageCount,
    'Hidden send must not create Message',
  );

  await Listing.updateOne(
    { _id: historyListing._id },
    { $set: { status: 'active' } },
  );
  const activeAgain = await request(
    `/listings/${historyListing._id}/conversations`,
    {
      ...urlEncoded({}),
      cookie: buyerCookie,
    },
  );
  checkEqual(activeAgain.status, 303, 'Reactivated Listing chat can resume');
  check(
    activeAgain.location.includes(historyConversationId),
    'Reactivated Listing must reuse old Conversation',
  );
  checkEqual(
    await Conversation.countDocuments({
      buyer: buyer._id,
      listing: historyListing._id,
      seller: seller._id,
    }),
    1,
    'Reactivation must not create a duplicate Conversation',
  );

  const privateMarker = `Private-${testId}`;
  await request(`/messages/${conversationId}`, {
    ...urlEncoded({ content: privateMarker }),
    cookie: buyerCookie,
  });
  const thirdView = await request(`/messages/${conversationId}`, {
    cookie: thirdCookie,
  });
  const adminView = await request(`/messages/${conversationId}`, {
    cookie: adminCookie,
  });
  checkEqual(thirdView.status, 404, 'Third User must receive 404');
  check(
    !thirdView.text.includes(privateMarker),
    'Third User response must not leak Message content',
  );
  checkEqual(adminView.status, 404, 'Non-participant Admin must receive 404');
  check(
    !adminView.text.includes(privateMarker),
    'Admin must not bypass Conversation privacy',
  );
  const invalidConversation = await request('/messages/not-an-object-id', {
    cookie: buyerCookie,
  });
  checkEqual(
    invalidConversation.status,
    404,
    'Invalid Conversation ObjectId must not return 500',
  );

  const fakeIdentityContent = `Fake-identity-${testId}`;
  const fakeIdentitySend = await request(`/messages/${conversationId}`, {
    ...urlEncoded({
      content: fakeIdentityContent,
      recipient: third._id.toString(),
      sender: third._id.toString(),
    }),
    cookie: buyerCookie,
  });
  checkEqual(fakeIdentitySend.status, 303, 'Fake identity fields are ignored');
  const fakeIdentityMessage = await Message.findOne({
    content: fakeIdentityContent,
  }).lean();
  checkEqual(
    fakeIdentityMessage.sender.toString(),
    buyer._id.toString(),
    'Fake sender must not override req.user',
  );
  checkEqual(
    fakeIdentityMessage.recipient.toString(),
    seller._id.toString(),
    'Fake recipient must not override the other participant',
  );

  const invalidBefore = await Message.countDocuments({
    conversation: conversationId,
  });
  for (const content of ['', '   \r\n  ', 'x'.repeat(2001)]) {
    const invalidSend = await request(`/messages/${conversationId}`, {
      ...urlEncoded({ content }),
      cookie: buyerCookie,
    });
    checkEqual(invalidSend.status, 422, 'Invalid content must return 422');
  }
  checkEqual(
    await Message.countDocuments({ conversation: conversationId }),
    invalidBefore,
    'Invalid content must not create Message',
  );

  const xssContent = '<script>alert(1)</script>';
  const xssSend = await request(`/messages/${conversationId}`, {
    ...urlEncoded({ content: xssContent }),
    cookie: buyerCookie,
  });
  checkEqual(xssSend.status, 303, 'HTML-like content may be stored as text');
  const storedXss = await Message.findOne({
    conversation: conversationId,
    content: xssContent,
  }).lean();
  checkEqual(storedXss.content, xssContent, 'HTML content must remain plain text');
  const escapedView = await request(`/messages/${conversationId}`, {
    cookie: buyerCookie,
  });
  check(
    escapedView.text.includes('&lt;script&gt;alert(1)&lt;/script&gt;'),
    'Message HTML must be escaped by EJS',
  );
  check(
    !escapedView.text.includes(`<p class="message-content">${xssContent}</p>`),
    'Message HTML must not render as executable markup',
  );

  const lineBreakContent = `first line ${testId}\nsecond line`;
  await request(`/messages/${conversationId}`, {
    ...urlEncoded({ content: lineBreakContent }),
    cookie: buyerCookie,
  });
  const storedLineBreak = await Message.findOne({
    content: lineBreakContent,
  }).lean();
  check(
    storedLineBreak.content.includes('\n'),
    'Line break must remain in stored plain text',
  );
  const messageCss = fs.readFileSync(
    path.resolve(__dirname, '..', 'src', 'public', 'css', 'messages.css'),
    'utf8',
  );
  check(
    /white-space:\s*pre-wrap/.test(messageCss),
    'Message CSS must preserve line breaks',
  );

  const metadata = await Conversation.findById(conversationId).lean();
  checkEqual(
    metadata.lastMessagePreview,
    lineBreakContent.slice(0, 200),
    'Conversation preview must match the latest Message',
  );
  checkEqual(
    metadata.lastSender.toString(),
    buyer._id.toString(),
    'Conversation lastSender must match the latest sender',
  );
  check(
    metadata.lastMessageAt instanceof Date,
    'Conversation lastMessageAt must be updated',
  );

  const rollbackContent = `Rollback-${testId}`;
  let rollbackError;

  try {
    await messageService.sendMessage({
      content: rollbackContent,
      conversation: {
        _id: new mongoose.Types.ObjectId(),
        buyer: buyer._id,
        listing: activeListing._id,
        seller: seller._id,
      },
      senderId: buyer._id,
    });
  } catch (error) {
    rollbackError = error;
  }

  check(
    rollbackError?.code === messageService.MESSAGE_METADATA_UPDATE_FAILED,
    'Metadata failure must abort the transaction',
  );
  checkEqual(
    await Message.countDocuments({ content: rollbackContent }),
    0,
    'Atlas transaction rollback must leave no Message',
  );

  const paginationListing = await createListing('Message pagination');
  const paginationConversation = await Conversation.create({
    buyer: buyer._id,
    listing: paginationListing._id,
    seller: seller._id,
  });
  const paginationStart = new Date(Date.now() - 200000);
  const paginationMessages = Array.from({ length: 51 }, (_, index) => ({
    content: `PageMessage-${String(index).padStart(3, '0')}-${testId}`,
    conversation: paginationConversation._id,
    createdAt: new Date(paginationStart.getTime() + index * 1000),
    readAt: new Date(),
    recipient: seller._id,
    sender: buyer._id,
    updatedAt: new Date(paginationStart.getTime() + index * 1000),
  }));
  await Message.insertMany(paginationMessages);
  const newestMessagePage = await request(
    `/messages/${paginationConversation._id}`,
    { cookie: buyerCookie },
  );
  const olderMessagePage = await request(
    `/messages/${paginationConversation._id}?page=2`,
    { cookie: buyerCookie },
  );
  checkEqual(
    countMatches(newestMessagePage.text, /class="message-row /g),
    50,
    'Newest Message page must contain at most 50 rows',
  );
  check(
    newestMessagePage.text.includes('PageMessage-001-') &&
      newestMessagePage.text.includes('PageMessage-050-'),
    'Newest page must render its stable old-to-new range',
  );
  check(
    newestMessagePage.text.indexOf('PageMessage-001-') <
      newestMessagePage.text.indexOf('PageMessage-050-'),
    'Messages must display from older to newer within a page',
  );
  check(
    newestMessagePage.text.includes(`?page=2`),
    'Newest Message page must link to older Messages',
  );
  checkEqual(
    countMatches(olderMessagePage.text, /class="message-row /g),
    1,
    'Older Message page must contain the remaining row',
  );
  check(
    olderMessagePage.text.includes('PageMessage-000-') &&
      !newestMessagePage.text.includes('PageMessage-000-'),
    'Stable Message pages must not duplicate rows',
  );

  const conversationFixtures = [];

  for (let index = 0; index < 21; index += 1) {
    const listing = await createListing(
      `Conversation page ${String(index).padStart(2, '0')}`,
    );
    const createdAt = new Date(Date.now() - index * 60000);
    conversationFixtures.push(
      await Conversation.create({
        buyer: buyer._id,
        createdAt,
        lastMessageAt: createdAt,
        lastMessagePreview: `Conversation preview ${index}`,
        lastSender: buyer._id,
        listing: listing._id,
        seller: seller._id,
        updatedAt: createdAt,
      }),
    );
  }

  const conversationPageOne = await request('/messages', {
    cookie: buyerCookie,
  });
  const conversationPageTwo = await request('/messages?page=2', {
    cookie: buyerCookie,
  });
  checkEqual(
    countMatches(
      conversationPageOne.text,
      /class="conversation-card (?:has-unread)?"/g,
    ),
    20,
    'Conversation page must contain at most 20 cards',
  );
  check(
    countMatches(
      conversationPageTwo.text,
      /class="conversation-card (?:has-unread)?"/g,
    ) > 0,
    'Second Conversation page must contain remaining cards',
  );
  check(
    conversationPageOne.text.includes('Conversation preview 0'),
    'Conversation list must include newest lastMessageAt first',
  );
  check(
    !conversationPageTwo.text.includes('Conversation preview 0'),
    'Stable Conversation pages must not duplicate the newest row',
  );

  await Message.updateMany(
    {
      $or: [
        { recipient: buyer._id },
        { recipient: seller._id },
      ],
    },
    { $set: { readAt: new Date() } },
  );
  await Listing.updateOne(
    { _id: activeListing._id },
    { $set: { status: 'active' } },
  );
  const unreadContent = `Unread-current-${testId}`;
  await request(`/messages/${conversationId}`, {
    ...urlEncoded({ content: unreadContent }),
    cookie: buyerCookie,
  });
  checkEqual(
    await Message.countDocuments({
      recipient: seller._id,
      readAt: null,
    }),
    1,
    'Seller unread count must increase after buyer sends',
  );
  checkEqual(
    await Message.countDocuments({
      sender: buyer._id,
      recipient: buyer._id,
      readAt: null,
    }),
    0,
    'Buyer must not count own sent Message as unread',
  );

  const otherUnreadConversation = conversationFixtures[0];
  const otherUnreadMessage = await Message.create({
    content: `Unread-other-${testId}`,
    conversation: otherUnreadConversation._id,
    readAt: null,
    recipient: seller._id,
    sender: buyer._id,
  });
  const sellerHeaderBefore = await request('/', { cookie: sellerCookie });
  check(
    /nav-unread-badge/.test(sellerHeaderBefore.text),
    'Authenticated Header must show unread badge',
  );
  const currentReadView = await request(`/messages/${conversationId}`, {
    cookie: sellerCookie,
  });
  checkEqual(currentReadView.status, 200, 'Seller can open current Conversation');
  const currentUnread = await Message.findOne({
    content: unreadContent,
  }).lean();
  const untouchedOtherUnread = await Message.findById(
    otherUnreadMessage._id,
  ).lean();
  check(
    currentUnread.readAt instanceof Date,
    'Opening Conversation must mark current recipient Messages read',
  );
  checkEqual(
    untouchedOtherUnread.readAt,
    null,
    'Opening one Conversation must not mark another Conversation read',
  );
  check(
    /nav-unread-badge/.test(currentReadView.text),
    'Same response Header must retain only unread from other Conversations',
  );

  await Message.insertMany(
    Array.from({ length: 99 }, (_, index) => ({
      content: `Unread-cap-${index}-${testId}`,
      conversation: otherUnreadConversation._id,
      readAt: null,
      recipient: seller._id,
      sender: buyer._id,
    })),
  );
  const cappedHeader = await request('/', { cookie: sellerCookie });
  check(
    /nav-unread-badge[\s\S]*?99\+/.test(cappedHeader.text),
    'Header must cap unread display at 99+',
  );

  const sellerConversationList = await request('/messages', {
    cookie: sellerCookie,
  });
  check(
    sellerConversationList.text.includes('has-unread'),
    'Conversation list must show unread state',
  );
  check(
    sellerConversationList.text.includes(buyer.name),
    'Conversation list must present the correct other participant',
  );
  for (const email of testEmails) {
    check(
      !sellerConversationList.text.includes(email),
      'Conversation page must not expose participant email',
    );
  }
  check(
    !sellerConversationList.text.includes(password),
    'Conversation page must not expose password data',
  );

  const noMessageConversation = conversationFixtures[20];
  await Message.deleteMany({ conversation: noMessageConversation._id });
  await Conversation.updateOne(
    { _id: noMessageConversation._id },
    {
      $set: {
        lastMessageAt: null,
        lastMessagePreview: '',
        lastSender: null,
      },
    },
  );
  const noMessageView = await request(
    `/messages/${noMessageConversation._id}`,
    { cookie: buyerCookie },
  );
  checkEqual(noMessageView.status, 200, 'Empty Conversation must not crash');
  check(
    noMessageView.text.includes('message-thread-empty'),
    'Empty Conversation must render its empty state',
  );
  check(
    noMessageView.text.includes('/images/listing-placeholder.svg'),
    'Listing without image must use placeholder thumbnail',
  );
  check(
    hiddenBuyerView.text.includes('status-badge--hidden'),
    'Hidden Listing context must show hidden status',
  );

  const guestDetail = await request(`/listings/${activeListing._id}`);
  const buyerDetail = await request(`/listings/${activeListing._id}`, {
    cookie: buyerCookie,
  });
  const thirdDetail = await request(`/listings/${activeListing._id}`, {
    cookie: thirdCookie,
  });
  const ownerDetail = await request(`/listings/${activeListing._id}`, {
    cookie: sellerCookie,
  });
  check(
    guestDetail.text.includes('href="/login"') &&
      guestDetail.text.includes('listing-detail-message-action'),
    'Guest active detail must offer login to message',
  );
  check(
    buyerDetail.text.includes(`href="/messages/${conversationId}#latest"`),
    'Existing participant must see continue Conversation link',
  );
  check(
    thirdDetail.text.includes(
      `action="/listings/${activeListing._id}/conversations"`,
    ),
    'Authenticated non-owner must see start Message action',
  );
  check(
    !ownerDetail.text.includes(
      `action="/listings/${activeListing._id}/conversations"`,
    ),
    'Listing owner must not see self-chat action',
  );

  const addFavorite = await request(
    `/listings/${activeListing._id}/favorite`,
    {
      ...urlEncoded({ returnTo: `/listings/${activeListing._id}` }),
      cookie: buyerCookie,
    },
  );
  checkEqual(addFavorite.status, 303, 'Favorite add must still work');
  checkEqual(
    await Favorite.countDocuments({
      listing: activeListing._id,
      user: buyer._id,
    }),
    1,
    'Favorite document must coexist with Conversation',
  );
  const favoriteAndMessageDetail = await request(
    `/listings/${activeListing._id}`,
    { cookie: buyerCookie },
  );
  check(
    favoriteAndMessageDetail.text.includes('_method=DELETE') &&
      favoriteAndMessageDetail.text.includes(`/messages/${conversationId}`),
    'Favorite and Message controls must coexist on Listing detail',
  );

  const refreshedHome = await request('/', { cookie: buyerCookie });
  const requireGuest = await request('/login', { cookie: buyerCookie });
  const requireAuth = await request('/profile');
  checkEqual(refreshedHome.status, 200, 'Session must survive page refresh');
  checkEqual(requireGuest.status, 303, 'requireGuest must redirect active User');
  assertLoginRedirect(requireAuth, 'requireAuth must redirect Guest');
  const logout = await request('/logout', {
    ...urlEncoded({}),
    cookie: thirdCookie,
  });
  checkEqual(logout.status, 303, 'Logout must remain functional');
  const afterLogout = await request('/messages', { cookie: thirdCookie });
  assertLoginRedirect(afterLogout, 'Logged-out session cannot access Messages');

  const publicCategories = await request('/categories');
  const adminCategories = await request('/admin/categories', {
    cookie: adminCookie,
  });
  check(
    publicCategories.text.includes(category.name),
    'Active Category must remain public',
  );
  check(
    publicCategories.text.includes('category-card__icon-svg'),
    'Category without image must render a slug icon or fallback',
  );
  checkEqual(adminCategories.status, 200, 'Admin Category route must remain available');
  const deniedAdmin = await request('/admin/categories', {
    cookie: buyerCookie,
  });
  checkEqual(deniedAdmin.status, 403, 'requireAdmin must still reject normal User');
  await Category.updateOne(
    { _id: category._id },
    { $set: { status: 'inactive' } },
  );
  const inactiveCategory = await request(`/categories/${category.slug}`);
  checkEqual(inactiveCategory.status, 404, 'Inactive Category must remain private');
  await Category.updateOne(
    { _id: category._id },
    { $set: { status: 'active' } },
  );

  const createListingResponse = await request('/listings', {
    ...urlEncoded({
      category: category._id.toString(),
      condition: 'used',
      description:
        'Step 11 CRUD listing has enough text and remains scoped to cleanup.',
      location: 'Da Nang',
      price: '2300000',
      title: `Step11 CRUD ${testId.slice(0, 8)}`,
    }),
    cookie: buyerCookie,
  });
  checkEqual(createListingResponse.status, 303, 'Listing create must work');
  const crudListingId = createListingResponse.location.match(
    /^\/listings\/([0-9a-f]{24})\?created=1$/,
  )?.[1];
  check(crudListingId, 'Listing create must return a safe ID');
  testListingIds.add(crudListingId);
  const readListing = await request(`/listings/${crudListingId}`);
  checkEqual(readListing.status, 200, 'Listing public read must work');
  const updateListing = await request(
    `/listings/${crudListingId}?_method=PUT`,
    {
      ...urlEncoded({
        category: category._id.toString(),
        condition: 'new',
        description:
          'Step 11 CRUD listing was updated with enough validation text.',
        location: 'Ha Noi',
        price: '2400000',
        title: `Step11 CRUD updated ${testId.slice(0, 8)}`,
      }),
      cookie: buyerCookie,
    },
  );
  checkEqual(updateListing.status, 303, 'Listing update must work');
  for (const status of ['sold', 'active']) {
    const statusResponse = await request(
      `/listings/${crudListingId}/status?_method=PATCH`,
      {
        ...urlEncoded({ status }),
        cookie: buyerCookie,
      },
    );
    checkEqual(statusResponse.status, 303, `Listing ${status} must work`);
  }
  const myListings = await request('/my-listings', {
    cookie: buyerCookie,
  });
  check(
    myListings.text.includes(`Step11 CRUD updated ${testId.slice(0, 8)}`),
    'My Listings must include the owner Listing',
  );
  const ownerEdit = await request(`/listings/${crudListingId}/edit`, {
    cookie: buyerCookie,
  });
  checkEqual(ownerEdit.status, 200, 'Owner can edit own Listing');
  const unauthorizedEdit = await request(`/listings/${crudListingId}/edit`, {
    cookie: sellerCookie,
  });
  checkEqual(unauthorizedEdit.status, 403, 'Non-owner User must receive 403');
  const adminEdit = await request(`/listings/${crudListingId}/edit`, {
    cookie: adminCookie,
  });
  checkEqual(adminEdit.status, 200, 'Admin can manage Listing CRUD');
  const missingListing = await request(
    `/listings/${new mongoose.Types.ObjectId()}/edit`,
    { cookie: buyerCookie },
  );
  checkEqual(missingListing.status, 404, 'Missing Listing must return 404');

  const search = await request(
    `/listings?keyword=Step11%20Active&category=${category.slug}` +
      '&condition=used&minPrice=1000000&maxPrice=1200000' +
      '&location=Ho%20Chi%20Minh&status=active&sort=price-asc&page=1',
  );
  checkEqual(search.status, 200, 'Search filters must remain accepted');
  check(
    search.text.includes(activeListing.title),
    'Search must return matching public Listing',
  );
  check(
    !search.text.includes(hiddenListing.title),
    'Search must not expose hidden Listing',
  );
  const invalidSearchPage = await request('/listings?page=10000');
  check(
    [200, 302].includes(invalidSearchPage.status),
    'Search pagination must resolve without server error',
  );

  const profile = await request('/profile', { cookie: buyerCookie });
  const profileEdit = await request('/profile/edit', {
    cookie: buyerCookie,
  });
  checkEqual(profile.status, 200, 'Profile page must remain functional');
  checkEqual(profileEdit.status, 200, 'Profile edit page must remain functional');
  check(
    refreshedHome.text.includes('/profile'),
    'Authenticated Header must keep Profile link',
  );

  const styleCss = fs.readFileSync(
    path.resolve(__dirname, '..', 'src', 'public', 'css', 'style.css'),
    'utf8',
  );
  const detailCss = fs.readFileSync(
    path.resolve(
      __dirname,
      '..',
      'src',
      'public',
      'css',
      'listing-detail.css',
    ),
    'utf8',
  );
  check(
    messageCss.includes(':focus-visible') &&
      styleCss.includes(':focus-visible'),
    'Message and shared controls must preserve focus-visible',
  );
  check(
    messageCss.includes('@media (min-width: 40rem)') &&
      messageCss.includes('@media (prefers-reduced-motion: reduce)'),
    'Message UI must be mobile-first and respect reduced motion',
  );
  check(
    !messageCss.includes('overflow-x: hidden') &&
      !styleCss.includes('overflow-x: hidden'),
    'New Message and shared UI must not hide horizontal overflow defects',
  );
  check(
    /overflow-wrap:\s*anywhere/.test(messageCss) &&
      /min-width:\s*0/.test(messageCss),
    'Long Message content must not break 320-768px layouts',
  );
  check(
    /object-fit:\s*contain/.test(messageCss) &&
      /listing-detail-media-frame/.test(detailCss),
    'Message thumbnails and Listing gallery must preserve image layout',
  );

  const responsiveMessagesList = await request('/messages', {
    cookie: buyerCookie,
  });
  const responsiveConversation = await request(
    `/messages/${conversationId}`,
    { cookie: buyerCookie },
  );
  await runResponsiveBrowserAudit({
    pages: [
      {
        html: responsiveMessagesList.text,
        label: 'messages-list',
      },
      {
        html: responsiveConversation.text,
        label: 'message-detail',
      },
    ],
  });

  const hiddenCrud = await request(
    `/listings/${crudListingId}/status?_method=PATCH`,
    {
      ...urlEncoded({ status: 'hidden' }),
      cookie: buyerCookie,
    },
  );
  checkEqual(hiddenCrud.status, 303, 'Listing hidden transition must work');
  const hiddenPublicRead = await request(`/listings/${crudListingId}`);
  checkEqual(hiddenPublicRead.status, 404, 'Hidden Listing must not be public');
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

  checkEqual(
    cleanup.remainingTestConversations,
    0,
    'Cleanup must leave no Step 11 Conversation',
  );
  checkEqual(
    cleanup.remainingTestMessages,
    0,
    'Cleanup must leave no Step 11 Message',
  );

  console.log(
    JSON.stringify(
      {
        assertions: assertionCount,
        cleanup,
        coveredCases: 48,
        status: 'passed',
        suite: 'Step 11 buyer-seller Message E2E',
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
      : 'Unexpected E2E failure; sensitive connection details were suppressed.';
  console.error(`Step 11 E2E failed: ${safeMessage}`);
  process.exit(1);
});
