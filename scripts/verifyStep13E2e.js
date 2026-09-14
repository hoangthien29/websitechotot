require('dotenv').config({ quiet: true });

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const bcrypt = require('bcrypt');
const mongoose = require('mongoose');

const connectDatabase = require('../src/config/database');
const { closeSessionStore } = require('../src/config/session');
const Category = require('../src/models/Category');
const Conversation = require('../src/models/Conversation');
const Favorite = require('../src/models/Favorite');
const Listing = require('../src/models/Listing');
const Message = require('../src/models/Message');
const User = require('../src/models/User');
const { runDataAudit } = require('./auditData');
const { buildPlan } = require('./cleanupOrphans');
const { extractCsrfToken } = require('./e2eCsrf');
const { runResponsiveAudit } = require('./responsiveAudit');
const { createImageFixture } = require('../testSupport/imageFixtures');
const {
  AVATAR_UPLOAD_DIRECTORY,
  deleteStoredAvatar,
} = require('../src/utils/avatarStorage');
const {
  CATEGORY_IMAGE_UPLOAD_DIRECTORY,
  deleteStoredCategoryImage,
} = require('../src/utils/categoryImageStorage');
const {
  LISTING_UPLOAD_DIRECTORY,
  deleteStoredFiles,
} = require('../src/utils/fileStorage');

process.env.NODE_ENV = 'test';

const id = crypto.randomUUID();
const shortId = id.slice(0, 8);
const password = `Step13A${crypto.randomBytes(8).toString('hex')}`;
const emails = {
  admin: `step13-admin-${id}@example.invalid`,
  buyer: `step13-buyer-${id}@example.invalid`,
  seller: `step13-seller-${id}@example.invalid`,
  third: `step13-third-${id}@example.invalid`,
};
const fixtureIds = {
  categories: new Set(),
  conversations: new Set(),
  favorites: new Set(),
  listings: new Set(),
  messages: new Set(),
  users: new Set(),
};
const fixtureFiles = {
  avatars: new Set(),
  categories: new Set(),
  listings: new Set(),
};

let assertionCount = 0;
let baseUrl = '';
let server;
let controlledOrphanFile = '';
let controlledOrphanFavoriteId = null;
let historicalAuditSummary = null;
let responsiveSummary = null;

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

const cookiePair = (setCookie = '') => setCookie.split(';', 1)[0];
const isMutation = (method) =>
  ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(method).toUpperCase());

class BrowserClient {
  constructor() {
    this.cookie = '';
    this.authenticated = false;
  }

  async raw(pathname, options = {}) {
    const headers = new Headers(options.headers || {});

    if (this.cookie) {
      headers.set('cookie', this.cookie);
    }

    const response = await fetch(`${baseUrl}${pathname}`, {
      ...options,
      headers,
      redirect: 'manual',
    });
    const setCookie = response.headers.get('set-cookie') || '';

    if (setCookie) {
      this.cookie = cookiePair(setCookie);
    }

    const text = options.readBody === false ? '' : await response.text();
    return {
      contentType: response.headers.get('content-type') || '',
      headers: response.headers,
      location: response.headers.get('location') || '',
      setCookie,
      status: response.status,
      text,
    };
  }

  async getCsrfToken() {
    const candidates = this.authenticated ? ['/', '/login'] : ['/login'];

    for (const pathname of candidates) {
      const response = await this.raw(pathname);
      const token = extractCsrfToken(response.text);

      if (token) {
        return token;
      }
    }

    throw new Error('Step 13 E2E could not obtain a CSRF token.');
  }

  async request(pathname, options = {}) {
    const headers = new Headers(options.headers || {});

    if (isMutation(options.method || 'GET') && options.csrf !== false) {
      headers.set('x-csrf-token', await this.getCsrfToken());
    }

    return this.raw(pathname, { ...options, headers });
  }
}

const formBody = (values = {}) => ({
  body: new URLSearchParams(values),
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  method: 'POST',
});

const appendFields = (form, values) => {
  for (const [name, value] of Object.entries(values)) {
    form.append(name, String(value));
  }

  return form;
};

const createProfileForm = ({ bytes, type = 'image/png', ...values }) => {
  const form = appendFields(new FormData(), {
    address: 'TP.HCM',
    name: 'Step 13 Seller',
    phone: '+84 912-345-678',
    ...values,
  });

  if (bytes) {
    form.append('avatar', new Blob([bytes], { type }), 'avatar-client-name.svg');
  }

  return form;
};

const createListingForm = ({ bytes, type = 'image/jpeg', ...values }) => {
  const form = appendFields(new FormData(), values);

  if (bytes) {
    form.append('images', new Blob([bytes], { type }), '../listing-client-name.svg');
  }

  return form;
};

const createCategoryForm = ({ bytes, type = 'image/webp', ...values }) => {
  const form = appendFields(new FormData(), values);

  if (bytes) {
    form.append('image', new Blob([bytes], { type }), '..\\category-client-name.svg');
  }

  return form;
};

const getManagedFileCount = (directory) => {
  if (!fs.existsSync(directory)) {
    return 0;
  }

  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile()).length;
};

const login = async (client, email) => {
  const oldCookie = client.cookie;
  const response = await client.request('/login', formBody({ email, password }));
  checkEqual(response.status, 303, 'Login must redirect');
  checkEqual(response.location, '/', 'Login redirect must stay internal');
  check(Boolean(client.cookie), 'Login must issue a session cookie');
  check(client.cookie !== oldCookie, 'Login must regenerate the session ID');
  check(/HttpOnly/i.test(response.setCookie), 'Session cookie must be HttpOnly');
  check(/SameSite=Lax/i.test(response.setCookie), 'Session cookie must use SameSite=Lax');
  check(!/;\s*Secure/i.test(response.setCookie), 'Test HTTP cookie must not be Secure');
  client.authenticated = true;
};

const logout = async (client) => {
  const response = await client.request('/logout', { method: 'POST' });
  checkEqual(response.status, 303, 'Logout must redirect');
  client.authenticated = false;
  const afterLogout = await client.request('/profile');
  checkEqual(afterLogout.status, 303, 'Destroyed session must not remain authenticated');
};

const rememberDocument = (namespace, document) => {
  fixtureIds[namespace].add(document._id.toString());
  return document;
};

const cleanupStaleStep13Fixtures = async () => {
  const staleUsers = await User.find({
    email: /^step13-(?:admin|buyer|seller|third)-[0-9a-f-]{36}@example\.invalid$/,
  }).select('_id avatar').lean();
  const staleCategories = await Category.find({
    name: /^Step 13 Category [0-9a-f]{8}$/,
  }).select('_id image').lean();
  const userIds = staleUsers.map((user) => user._id);
  const categoryIds = staleCategories.map((category) => category._id);
  const listingClauses = [];

  if (userIds.length > 0) {
    listingClauses.push({ seller: { $in: userIds } });
  }
  if (categoryIds.length > 0) {
    listingClauses.push({ category: { $in: categoryIds } });
  }

  const staleListings = listingClauses.length > 0
    ? await Listing.find({ $or: listingClauses }).select('_id images').lean()
    : [];
  const listingIds = staleListings.map((listing) => listing._id);
  const conversationClauses = [];

  if (listingIds.length > 0) {
    conversationClauses.push({ listing: { $in: listingIds } });
  }
  if (userIds.length > 0) {
    conversationClauses.push({ buyer: { $in: userIds } }, { seller: { $in: userIds } });
  }

  const staleConversations = conversationClauses.length > 0
    ? await Conversation.find({ $or: conversationClauses }).select('_id').lean()
    : [];
  const conversationIds = staleConversations.map((conversation) => conversation._id);
  const messageClauses = [];
  const favoriteClauses = [];

  if (conversationIds.length > 0) {
    messageClauses.push({ conversation: { $in: conversationIds } });
  }
  if (userIds.length > 0) {
    messageClauses.push({ sender: { $in: userIds } }, { recipient: { $in: userIds } });
    favoriteClauses.push({ user: { $in: userIds } });
  }
  if (listingIds.length > 0) {
    favoriteClauses.push({ listing: { $in: listingIds } });
  }

  if (messageClauses.length > 0) {
    const messageIds = await Message.find({ $or: messageClauses }).distinct('_id');
    if (messageIds.length > 0) await Message.deleteMany({ _id: { $in: messageIds } });
  }
  if (conversationIds.length > 0) {
    await Conversation.deleteMany({ _id: { $in: conversationIds } });
  }
  if (favoriteClauses.length > 0) {
    const favoriteIds = await Favorite.find({ $or: favoriteClauses }).distinct('_id');
    if (favoriteIds.length > 0) await Favorite.deleteMany({ _id: { $in: favoriteIds } });
  }
  if (listingIds.length > 0) {
    await Listing.deleteMany({ _id: { $in: listingIds } });
  }
  if (categoryIds.length > 0) {
    await Category.deleteMany({ _id: { $in: categoryIds } });
  }
  if (userIds.length > 0) {
    await User.deleteMany({ _id: { $in: userIds } });
    const escapedIds = userIds.map((value) =>
      value.toString().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    );
    await mongoose.connection.collection('sessions').deleteMany({
      session: { $regex: escapedIds.join('|') },
    });
  }

  await Promise.all([
    deleteStoredFiles(staleListings.flatMap((listing) => listing.images || [])),
    ...staleUsers.map((user) => deleteStoredAvatar(user.avatar)),
    ...staleCategories.map((category) => deleteStoredCategoryImage(category.image)),
  ]);
};

const cleanupFixtures = async () => {
  const cleanup = {
    categories: 0,
    conversations: 0,
    favorites: 0,
    files: 0,
    listings: 0,
    messages: 0,
    sessions: 0,
    users: 0,
    remaining: {},
  };

  if (controlledOrphanFavoriteId) {
    await Favorite.deleteOne({ _id: controlledOrphanFavoriteId });
  }

  if (controlledOrphanFile) {
    await fs.promises.unlink(controlledOrphanFile).catch((error) => {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    });
  }

  if (mongoose.connection.readyState !== 0) {
    const deleteScoped = async (Model, ids, key) => {
      if (ids.size === 0) {
        return;
      }

      const result = await Model.deleteMany({ _id: { $in: [...ids] } });
      cleanup[key] = result.deletedCount || 0;
    };

    await deleteScoped(Message, fixtureIds.messages, 'messages');
    await deleteScoped(Conversation, fixtureIds.conversations, 'conversations');
    await deleteScoped(Favorite, fixtureIds.favorites, 'favorites');
    await deleteScoped(Listing, fixtureIds.listings, 'listings');
    await deleteScoped(Category, fixtureIds.categories, 'categories');
    await deleteScoped(User, fixtureIds.users, 'users');

    const userIds = [...fixtureIds.users];
    if (userIds.length > 0) {
      const sessions = mongoose.connection.collection('sessions');
      const escapedIds = userIds.map((value) =>
        value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      );
      const result = await sessions.deleteMany({
        session: { $regex: escapedIds.join('|') },
      });
      cleanup.sessions = result.deletedCount || 0;
    }
  }

  const fileResults = await Promise.all([
    deleteStoredFiles([...fixtureFiles.listings]),
    ...[...fixtureFiles.avatars].map(deleteStoredAvatar),
    ...[...fixtureFiles.categories].map(deleteStoredCategoryImage),
  ]);
  cleanup.files = fileResults.flat().filter(Boolean).length;
  if (mongoose.connection.readyState !== 0) {
    const countScoped = (Model, ids) =>
      ids.size === 0 ? 0 : Model.countDocuments({ _id: { $in: [...ids] } });
    const [categories, conversations, favorites, listings, messages, users] =
      await Promise.all([
        countScoped(Category, fixtureIds.categories),
        countScoped(Conversation, fixtureIds.conversations),
        countScoped(Favorite, fixtureIds.favorites),
        countScoped(Listing, fixtureIds.listings),
        countScoped(Message, fixtureIds.messages),
        countScoped(User, fixtureIds.users),
      ]);
    const publicPaths = [
      ...fixtureFiles.avatars,
      ...fixtureFiles.categories,
      ...fixtureFiles.listings,
    ];
    cleanup.remaining = {
      categories,
      conversations,
      favorites,
      files: publicPaths.filter((publicPath) =>
        fs.existsSync(path.resolve(__dirname, '..', publicPath.replace(/^\//, ''))),
      ).length,
      listings,
      messages,
      users,
    };
  }

  return cleanup;
};

const run = async () => {
  await connectDatabase();
  await cleanupStaleStep13Fixtures();
  const app = require('../src/app');
  server = await listen(app);
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const seller = new BrowserClient();
  const buyer = new BrowserClient();
  const admin = new BrowserClient();
  const third = new BrowserClient();
  const xssName = '<script>alert(1)</script>';
  const xssImage = '<img src=x onerror=alert(1)>';
  const listingTitle = `<script>alert(1)</script> S13 ${shortId}`;
  const listingDescription = `${xssImage} Description long enough for Step 13 validation.`;

  const health = await seller.request('/healthz');
  checkEqual(health.status, 200, 'Health endpoint must return 200');
  checkEqual(health.text, '{"status":"ok"}', 'Health endpoint must expose minimal JSON');

  const loginForm = await seller.raw('/login');
  check(Boolean(extractCsrfToken(loginForm.text)), 'Login form must contain CSRF token');
  const missingLoginCsrf = await seller.request('/login', {
    ...formBody({ email: emails.seller, password }),
    csrf: false,
  });
  checkEqual(missingLoginCsrf.status, 403, 'Login without CSRF must return 403');
  const invalidRegisterCsrf = await seller.raw('/register', {
    ...formBody({
      confirmPassword: password,
      email: emails.seller,
      name: 'Step 13 Seller',
      password,
    }),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-csrf-token': 'invalid-token',
    },
  });
  checkEqual(invalidRegisterCsrf.status, 403, 'Register with invalid CSRF must return 403');
  checkEqual(await User.countDocuments({ email: emails.seller }), 0, 'Invalid CSRF must not create User');

  const register = await seller.request(
    '/register',
    formBody({
      confirmPassword: password,
      email: emails.seller,
      name: 'Step 13 Seller',
      password,
    }),
  );
  checkEqual(register.status, 303, 'Seller registration must succeed');
  const sellerUser = rememberDocument(
    'users',
    await User.findOne({ email: emails.seller }),
  );

  const passwordHash = await bcrypt.hash(password, 12);
  const [buyerUser, adminUser, thirdUser] = await User.create([
    { name: 'Step 13 Buyer', email: emails.buyer, password: passwordHash, role: 'user', status: 'active' },
    { name: 'Step 13 Admin', email: emails.admin, password: passwordHash, role: 'admin', status: 'active' },
    { name: 'Step 13 Third', email: emails.third, password: passwordHash, role: 'user', status: 'active' },
  ]);
  rememberDocument('users', buyerUser);
  rememberDocument('users', adminUser);
  rememberDocument('users', thirdUser);
  const category = rememberDocument(
    'categories',
    await Category.create({
      name: `Step 13 Category ${shortId}`,
      slug: `step-13-category-${shortId}`,
      description: 'Step 13 controlled category.',
      status: 'active',
    }),
  );

  await login(seller, emails.seller);
  await login(buyer, emails.buyer);
  await login(admin, emails.admin);
  await login(third, emails.third);

  const sellerToken = await seller.getCsrfToken();
  const crossSessionCsrf = await buyer.raw('/favorites', {
    method: 'POST',
    headers: { 'x-csrf-token': sellerToken },
  });
  checkEqual(crossSessionCsrf.status, 403, 'CSRF token from another session must fail');

  const avatarCountBeforeCsrf = getManagedFileCount(AVATAR_UPLOAD_DIRECTORY);
  const avatarCsrfFailure = await seller.request('/profile?_method=PUT', {
    body: createProfileForm({ bytes: createImageFixture('image/png') }),
    csrf: false,
    method: 'POST',
  });
  checkEqual(avatarCsrfFailure.status, 403, 'Avatar multipart without CSRF must return 403');
  checkEqual(getManagedFileCount(AVATAR_UPLOAD_DIRECTORY), avatarCountBeforeCsrf, 'Avatar CSRF failure must cleanup file');

  const fakeAvatar = await seller.request('/profile?_method=PUT', {
    body: createProfileForm({ bytes: Buffer.from('<script>avatar</script>'), type: 'image/png' }),
    method: 'POST',
  });
  checkEqual(fakeAvatar.status, 422, 'Fake PNG avatar must return 422');
  checkEqual(getManagedFileCount(AVATAR_UPLOAD_DIRECTORY), avatarCountBeforeCsrf, 'Fake avatar must not leave a file');

  const profileUpdate = await seller.request('/profile?_method=PUT', {
    body: createProfileForm({
      address: xssImage,
      bytes: createImageFixture('image/png'),
      email: 'attacker@example.invalid',
      name: xssName,
      role: 'admin',
      status: 'blocked',
    }),
    method: 'POST',
  });
  checkEqual(profileUpdate.status, 303, 'Profile update and valid avatar must succeed');
  const updatedSeller = await User.findById(sellerUser._id).lean();
  checkEqual(updatedSeller.role, 'user', 'Profile mass assignment must not elevate role');
  checkEqual(updatedSeller.status, 'active', 'Profile mass assignment must not change status');
  checkEqual(updatedSeller.email, emails.seller, 'Profile mass assignment must not change email');
  check(updatedSeller.avatar.startsWith('/uploads/avatars/'), 'Valid avatar must use managed path');
  fixtureFiles.avatars.add(updatedSeller.avatar);
  const profilePage = await seller.request('/profile');
  check(!profilePage.text.includes(xssName), 'Profile name must not render raw script');
  check(profilePage.text.includes('&lt;script&gt;'), 'Profile XSS must render as escaped text');

  const listingFields = {
    category: category._id,
    condition: 'used',
    description: listingDescription,
    location: 'TP.HCM',
    price: '1250000',
    seller: buyerUser._id,
    status: 'sold',
    title: listingTitle,
  };
  const listingCountBeforeCsrf = getManagedFileCount(LISTING_UPLOAD_DIRECTORY);
  const listingCsrfFailure = await seller.request('/listings', {
    body: createListingForm({ ...listingFields, bytes: createImageFixture('image/jpeg') }),
    csrf: false,
    method: 'POST',
  });
  checkEqual(listingCsrfFailure.status, 403, 'Listing image multipart without CSRF must return 403');
  checkEqual(getManagedFileCount(LISTING_UPLOAD_DIRECTORY), listingCountBeforeCsrf, 'Listing CSRF failure must cleanup file');

  const fakeListingTitle = `Fake upload ${shortId}`;
  const fakeListing = await seller.request('/listings', {
    body: createListingForm({
      ...listingFields,
      bytes: Buffer.from('<html><script>listing</script></html>'),
      title: fakeListingTitle,
      type: 'image/jpeg',
    }),
    method: 'POST',
  });
  checkEqual(fakeListing.status, 422, 'HTML renamed JPEG must return 422');
  checkEqual(await Listing.countDocuments({ title: fakeListingTitle }), 0, 'Fake image must not create Listing');
  checkEqual(getManagedFileCount(LISTING_UPLOAD_DIRECTORY), listingCountBeforeCsrf, 'Fake Listing image must cleanup file');

  const listingCreate = await seller.request('/listings', {
    body: createListingForm({ ...listingFields, bytes: createImageFixture('image/jpeg') }),
    method: 'POST',
  });
  checkEqual(listingCreate.status, 303, 'Listing create must succeed');
  const listingId = listingCreate.location.match(/\/listings\/([0-9a-f]{24})/)?.[1];
  check(listingId, 'Listing create must return managed Listing ID');
  const listing = rememberDocument('listings', await Listing.findById(listingId));
  checkEqual(listing.seller.toString(), sellerUser._id.toString(), 'Client cannot replace Listing seller');
  checkEqual(listing.status, 'active', 'Client cannot choose protected Listing status');
  checkEqual(listing.images.length, 1, 'Valid Listing image must be stored');
  fixtureFiles.listings.add(listing.images[0]);

  const listingDetail = await seller.request(`/listings/${listing._id}`);
  check(!listingDetail.text.includes(listingTitle), 'Listing title must not render raw script');
  check(listingDetail.text.includes('&lt;script&gt;'), 'Listing XSS must be escaped');
  const search = await buyer.request(`/listings?keyword=${encodeURIComponent('S13 ' + shortId)}`);
  checkEqual(search.status, 200, 'Search must find the Step 13 Listing');
  check(search.text.includes('&lt;script&gt;'), 'Search result must escape title');
  const operatorQuery = await buyer.request('/listings?keyword%5B%24ne%5D=x');
  checkEqual(operatorQuery.status, 422, 'NoSQL operator-shaped query must be rejected');

  const updateFileCount = getManagedFileCount(LISTING_UPLOAD_DIRECTORY);
  const listingUpdateCsrf = await seller.request(`/listings/${listing._id}?_method=PUT`, {
    body: createListingForm({ ...listingFields, bytes: createImageFixture('image/png'), type: 'image/png' }),
    csrf: false,
    method: 'POST',
  });
  checkEqual(listingUpdateCsrf.status, 403, 'Listing update without CSRF must return 403');
  checkEqual(getManagedFileCount(LISTING_UPLOAD_DIRECTORY), updateFileCount, 'Listing update CSRF failure must cleanup file');

  const favoriteMissingCsrf = await buyer.request(`/listings/${listing._id}/favorite`, {
    ...formBody({ returnTo: '/favorites' }),
    csrf: false,
  });
  checkEqual(favoriteMissingCsrf.status, 403, 'Favorite add without CSRF must return 403');
  checkEqual(await Favorite.countDocuments({ user: buyerUser._id, listing: listing._id }), 0, 'CSRF failure must not create Favorite');
  const favoriteAdd = await buyer.request(
    `/listings/${listing._id}/favorite`,
    formBody({ returnTo: 'https://evil.example/path', user: sellerUser._id }),
  );
  checkEqual(favoriteAdd.status, 303, 'Favorite add must succeed');
  check(favoriteAdd.location.startsWith(`/listings/${listing._id}`), 'Favorite returnTo must reject external redirect');
  const favorite = rememberDocument(
    'favorites',
    await Favorite.findOne({ user: buyerUser._id, listing: listing._id }),
  );
  check(Boolean(favorite), 'Favorite must belong to current buyer');
  const thirdRemove = await third.request(
    `/listings/${listing._id}/favorite?_method=DELETE`,
    formBody({ returnTo: '/favorites' }),
  );
  checkEqual(thirdRemove.status, 303, 'Third user remove is safely idempotent');
  checkEqual(await Favorite.countDocuments({ _id: favorite._id }), 1, 'Third user cannot delete buyer Favorite');
  const favoriteRemoveCsrf = await buyer.request(
    `/listings/${listing._id}/favorite?_method=DELETE`,
    { ...formBody({ returnTo: '/favorites' }), csrf: false },
  );
  checkEqual(favoriteRemoveCsrf.status, 403, 'Favorite remove without CSRF must return 403');
  checkEqual(await Favorite.countDocuments({ _id: favorite._id }), 1, 'Favorite remove CSRF failure must not mutate DB');

  const startMissingCsrf = await buyer.request(`/listings/${listing._id}/conversations`, {
    method: 'POST',
    csrf: false,
  });
  checkEqual(startMissingCsrf.status, 403, 'Conversation create without CSRF must return 403');
  const startConversation = await buyer.request(`/listings/${listing._id}/conversations`, { method: 'POST' });
  checkEqual(startConversation.status, 303, 'Buyer must start Conversation');
  const conversationId = startConversation.location.match(/\/messages\/([0-9a-f]{24})/)?.[1];
  check(conversationId, 'Conversation redirect must contain ID');
  const conversation = rememberDocument('conversations', await Conversation.findById(conversationId));
  const messageMissingCsrf = await buyer.request(`/messages/${conversation._id}`, {
    ...formBody({ content: 'Missing CSRF message' }),
    csrf: false,
  });
  checkEqual(messageMissingCsrf.status, 403, 'Message without CSRF must return 403');
  checkEqual(await Message.countDocuments({ conversation: conversation._id }), 0, 'Message CSRF failure must not mutate DB');

  const buyerSend = await buyer.request(
    `/messages/${conversation._id}`,
    formBody({ content: `${xssName} buyer message`, recipient: thirdUser._id, sender: adminUser._id }),
  );
  checkEqual(buyerSend.status, 303, 'Buyer message must succeed');
  let messages = await Message.find({ conversation: conversation._id }).sort({ createdAt: 1 });
  messages.forEach((message) => fixtureIds.messages.add(message._id.toString()));
  checkEqual(messages[0].sender.toString(), buyerUser._id.toString(), 'Message sender must come from session');
  checkEqual(messages[0].recipient.toString(), sellerUser._id.toString(), 'Message recipient must come from Conversation');
  const sellerConversation = await seller.request(`/messages/${conversation._id}`);
  checkEqual(sellerConversation.status, 200, 'Seller must read own Conversation');
  check(!sellerConversation.text.includes(`${xssName} buyer message`), 'Message content must not render raw script');
  check(sellerConversation.text.includes('&lt;script&gt;'), 'Message XSS must be escaped');
  check((await Message.findById(messages[0]._id)).readAt, 'Opening Conversation must mark recipient message read');
  const sellerReply = await seller.request(
    `/messages/${conversation._id}`,
    formBody({ content: 'Step 13 seller reply' }),
  );
  checkEqual(sellerReply.status, 303, 'Seller reply must succeed');
  messages = await Message.find({ conversation: conversation._id });
  messages.forEach((message) => fixtureIds.messages.add(message._id.toString()));
  await buyer.request(`/messages/${conversation._id}`);
  checkEqual(await Message.countDocuments({ conversation: conversation._id, recipient: buyerUser._id, readAt: null }), 0, 'Buyer read status must update');
  checkEqual((await third.request(`/messages/${conversation._id}`)).status, 404, 'Third user cannot read Conversation');
  checkEqual((await admin.request(`/messages/${conversation._id}`)).status, 404, 'Admin cannot bypass Message privacy');

  const dashboard = await admin.request('/admin');
  checkEqual(dashboard.status, 200, 'Admin dashboard must load');
  check(!dashboard.text.includes('Step 13 seller reply'), 'Admin dashboard must not expose Message content');

  const categoryFileCount = getManagedFileCount(CATEGORY_IMAGE_UPLOAD_DIRECTORY);
  const categoryCsrfName = `Step 13 CSRF Category ${shortId}`;
  const categoryCsrfFailure = await admin.request('/admin/categories', {
    body: createCategoryForm({
      bytes: createImageFixture('image/png'),
      description: 'Controlled CSRF category.',
      name: categoryCsrfName,
      status: 'active',
      type: 'image/png',
    }),
    csrf: false,
    method: 'POST',
  });
  checkEqual(categoryCsrfFailure.status, 403, 'Category multipart without CSRF must return 403');
  checkEqual(await Category.countDocuments({ name: categoryCsrfName }), 0, 'Category CSRF failure must not create document');
  checkEqual(getManagedFileCount(CATEGORY_IMAGE_UPLOAD_DIRECTORY), categoryFileCount, 'Category CSRF failure must cleanup file');

  const fakeCategoryName = `Step 13 Fake Category ${shortId}`;
  const fakeCategory = await admin.request('/admin/categories', {
    body: createCategoryForm({
      bytes: Buffer.from('<script>category</script>'),
      description: 'Fake image category.',
      name: fakeCategoryName,
      status: 'active',
      type: 'image/jpeg',
    }),
    method: 'POST',
  });
  checkEqual(fakeCategory.status, 422, 'HTML renamed Category JPEG must return 422');
  checkEqual(await Category.countDocuments({ name: fakeCategoryName }), 0, 'Fake Category image must not create document');
  checkEqual(getManagedFileCount(CATEGORY_IMAGE_UPLOAD_DIRECTORY), categoryFileCount, 'Fake Category image must cleanup file');

  const categoryUpdate = await admin.request(`/admin/categories/${category._id}?_method=PUT`, {
    body: createCategoryForm({
      bytes: createImageFixture('image/webp'),
      description: `${xssName} category description`,
      name: category.name,
      status: 'active',
    }),
    method: 'POST',
  });
  checkEqual(categoryUpdate.status, 303, 'Category image update must succeed');
  const updatedCategory = await Category.findById(category._id).lean();
  check(updatedCategory.image.startsWith('/uploads/categories/'), 'Category image must use managed path');
  fixtureFiles.categories.add(updatedCategory.image);
  const publicCategory = await seller.request(`/categories/${updatedCategory.slug}`);
  check(!publicCategory.text.includes(`${xssName} category description`), 'Category description must not render raw script');
  check(publicCategory.text.includes('&lt;script&gt;'), 'Category XSS must be escaped');

  const hideMissingCsrf = await admin.request(`/admin/listings/${listing._id}/hide?_method=PATCH`, {
    ...formBody({ reason: 'Missing CSRF moderation reason' }),
    csrf: false,
  });
  checkEqual(hideMissingCsrf.status, 403, 'Admin mutation without CSRF must return 403');
  checkEqual((await Listing.findById(listing._id)).status, 'active', 'Admin CSRF failure must not mutate Listing');
  const moderationReason = `${xssName} moderation reason Step 13`;
  const hide = await admin.request(
    `/admin/listings/${listing._id}/hide?_method=PATCH`,
    formBody({ reason: moderationReason }),
  );
  checkEqual(hide.status, 303, 'Admin hide must succeed');
  checkEqual((await Listing.findById(listing._id)).status, 'hidden', 'Admin hide must set hidden');
  checkEqual((await buyer.request(`/listings/${listing._id}`)).status, 404, 'Hidden Listing must not be public');
  const hiddenFavorites = await buyer.request('/favorites');
  check(!hiddenFavorites.text.includes('S13 ' + shortId), 'Hidden Listing must disappear from Favorites page');
  checkEqual(await Favorite.countDocuments({ _id: favorite._id }), 1, 'Favorite document must survive moderation');
  checkEqual(await Conversation.countDocuments({ _id: conversation._id }), 1, 'Conversation must survive moderation');
  const messageCountBeforeHiddenSend = await Message.countDocuments({ conversation: conversation._id });
  const hiddenSend = await buyer.request(
    `/messages/${conversation._id}`,
    formBody({ content: 'Blocked while Listing hidden' }),
  );
  checkEqual(hiddenSend.status, 422, 'Hidden Listing must block new Message');
  checkEqual(await Message.countDocuments({ conversation: conversation._id }), messageCountBeforeHiddenSend, 'Hidden send must not create Message');
  const moderationPage = await admin.request(`/admin/listings/${listing._id}`);
  check(!moderationPage.text.includes(moderationReason), 'Moderation reason must not render raw script');
  check(moderationPage.text.includes('&lt;script&gt;'), 'Moderation reason must be escaped');

  const restore = await admin.request(
    `/admin/listings/${listing._id}/restore?_method=PATCH`,
    formBody({}),
  );
  checkEqual(restore.status, 303, 'Admin restore must succeed');
  checkEqual((await Listing.findById(listing._id)).status, 'active', 'Restore must return Listing active');
  checkEqual((await buyer.request(`/listings/${listing._id}`)).status, 200, 'Restored Listing must be public');
  const restoredFavorites = await buyer.request('/favorites');
  check(restoredFavorites.text.includes('S13 ' + shortId), 'Restored Listing must return to Favorites');
  const afterRestoreSend = await buyer.request(
    `/messages/${conversation._id}`,
    formBody({ content: 'Conversation continues after restore' }),
  );
  checkEqual(afterRestoreSend.status, 303, 'Conversation must continue after restore');
  messages = await Message.find({ conversation: conversation._id });
  messages.forEach((message) => fixtureIds.messages.add(message._id.toString()));

  const block = await admin.request(
    `/admin/users/${buyerUser._id}/block?_method=PATCH`,
    formBody({ reason: 'Controlled Step 13 account block' }),
  );
  checkEqual(block.status, 303, 'Admin block buyer must succeed');
  const blockedOldSession = await buyer.request('/favorites');
  checkEqual(blockedOldSession.status, 303, 'Blocked buyer old session must lose auth');
  const unblock = await admin.request(
    `/admin/users/${buyerUser._id}/unblock?_method=PATCH`,
    formBody({}),
  );
  checkEqual(unblock.status, 303, 'Admin unblock buyer must succeed');
  buyer.cookie = '';
  buyer.authenticated = false;
  await login(buyer, emails.buyer);

  await User.deleteOne({ _id: thirdUser._id });
  const missingUserSession = await third.request('/profile');
  checkEqual(missingUserSession.status, 303, 'Session for missing User must lose auth');

  for (const traversalPath of [
    '/uploads/../package.json',
    '/uploads/%2e%2e/package.json',
    '/uploads/categories/%2e%2e/%2e%2e/.env',
    '/uploads/categories/..%5c..%5c.env',
  ]) {
    const response = await seller.request(traversalPath);
    check(response.status !== 200, `Static traversal must not expose ${traversalPath}`);
  }
  const home = await seller.request('/');
  check(home.headers.get('content-security-policy'), 'Helmet CSP header must exist');
  checkEqual(home.headers.get('x-content-type-options'), 'nosniff', 'nosniff header must exist');
  checkEqual(home.headers.get('x-frame-options'), 'DENY', 'Frame protection must deny');
  checkEqual(home.headers.get('referrer-policy'), 'no-referrer', 'Referrer policy must be strict');
  const staticListingImage = await seller.request(listing.images[0]);
  checkEqual(staticListingImage.status, 200, 'Managed Listing image must remain static');
  check(staticListingImage.contentType.startsWith('image/jpeg'), 'Listing static MIME must be image/jpeg');
  const staticCategoryImage = await seller.request(updatedCategory.image);
  checkEqual(staticCategoryImage.status, 200, 'Managed Category image must remain static');

  controlledOrphanFavoriteId = new mongoose.Types.ObjectId();
  await Favorite.collection.insertOne({
    _id: controlledOrphanFavoriteId,
    user: new mongoose.Types.ObjectId(),
    listing: listing._id,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const orphanFilename = `${crypto.randomUUID()}.png`;
  controlledOrphanFile = path.join(AVATAR_UPLOAD_DIRECTORY, orphanFilename);
  await fs.promises.mkdir(AVATAR_UPLOAD_DIRECTORY, { recursive: true });
  await fs.promises.writeFile(controlledOrphanFile, createImageFixture('image/png'));
  const orphanPublicPath = `/uploads/avatars/${orphanFilename}`;
  const auditWithFixture = await runDataAudit();
  check(
    auditWithFixture.details.orphanDocuments.some(
      (item) => item.id === controlledOrphanFavoriteId.toString(),
    ),
    'Data audit must detect controlled orphan document',
  );
  check(
    auditWithFixture.details.orphanFiles.some(
      (item) => item.path === orphanPublicPath,
    ),
    'Data audit must detect controlled orphan file',
  );
  const dryRunPlan = buildPlan(auditWithFixture);
  check(dryRunPlan.documents.some((item) => item.id === controlledOrphanFavoriteId.toString()), 'Dry-run plan must list orphan document');
  check(dryRunPlan.files.some((item) => item.path === orphanPublicPath), 'Dry-run plan must list orphan file');
  checkEqual(await Favorite.countDocuments({ _id: controlledOrphanFavoriteId }), 1, 'Dry-run must not delete document');
  check(fs.existsSync(controlledOrphanFile), 'Dry-run must not delete file');
  await Favorite.deleteOne({ _id: controlledOrphanFavoriteId });
  controlledOrphanFavoriteId = null;
  await fs.promises.unlink(controlledOrphanFile);
  controlledOrphanFile = '';
  historicalAuditSummary = (await runDataAudit()).summary;

  const responsivePages = [
    { label: 'home', html: (await seller.request('/')).text },
    { label: 'categories', html: (await seller.request('/categories')).text },
    { label: 'listings', html: (await seller.request('/listings')).text },
    { label: 'profile', html: (await seller.request('/profile')).text },
    { label: 'favorites', html: (await buyer.request('/favorites')).text },
    { label: 'messages', html: (await buyer.request('/messages')).text },
    { label: 'conversation', html: (await buyer.request(`/messages/${conversation._id}`)).text },
    { label: 'admin', html: (await admin.request('/admin')).text },
    { label: 'admin-users', html: (await admin.request('/admin/users')).text },
    { label: 'admin-listings', html: (await admin.request('/admin/listings')).text },
  ];
  responsiveSummary = await runResponsiveAudit({ baseUrl, pages: responsivePages });
  checkEqual(responsiveSummary.snapshotCount, 60, 'Responsive audit must cover 10 pages x 6 widths');

  const missingLogoutCsrf = await seller.request('/logout', { method: 'POST', csrf: false });
  checkEqual(missingLogoutCsrf.status, 403, 'Logout without CSRF must return 403');
  checkEqual((await seller.request('/profile')).status, 200, 'Failed logout CSRF must preserve session');
  await logout(seller);
  await logout(buyer);
  await logout(admin);

  return {
    assertions: assertionCount,
    historicalOrphans: {
      documents: historicalAuditSummary.orphanDocuments,
      files: historicalAuditSummary.orphanFiles,
      invalidManagedPaths: historicalAuditSummary.invalidManagedPaths,
      missingReferencedFiles: historicalAuditSummary.missingReferencedFiles,
    },
    status: 'passed',
    suite: 'Step 13 security and production readiness E2E',
    responsive: responsiveSummary,
  };
};

(async () => {
  let result;
  let cleanup;

  try {
    result = await run();
  } catch (error) {
    process.exitCode = 1;
    console.error(`Step 13 E2E failed: ${error.message}`);
  } finally {
    try {
      await closeServer();
      await closeSessionStore();
      cleanup = await cleanupFixtures();
    } catch (cleanupError) {
      process.exitCode = 1;
      console.error(`Step 13 E2E cleanup failed: ${cleanupError.message}`);
    } finally {
      await mongoose.disconnect().catch(() => undefined);
    }
  }

  const exitCode = process.exitCode === 1 ? 1 : 0;
  const output = result && cleanup && exitCode === 0
    ? `${JSON.stringify({ ...result, cleanup }, null, 2)}\n`
    : '';

  if (output) {
    process.stdout.write(output, () => process.exit(exitCode));
  } else {
    process.exit(exitCode);
  }
})();
