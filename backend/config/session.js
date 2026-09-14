const session = require('express-session');
const connectMongo = require('connect-mongo');

const MongoStore =
  connectMongo.MongoStore || connectMongo.default || connectMongo;

const DEFAULT_COOKIE_NAME = 'ntt_marketplace_sid';
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
let activeStore = null;

const getSessionCookieName = () =>
  process.env.SESSION_COOKIE_NAME || DEFAULT_COOKIE_NAME;

const getSessionMaxAge = () => {
  const configuredValue = Number(process.env.SESSION_MAX_AGE_MS);

  if (!process.env.SESSION_MAX_AGE_MS) {
    return DEFAULT_MAX_AGE_MS;
  }

  if (!Number.isSafeInteger(configuredValue) || configuredValue <= 0) {
    throw new Error('SESSION_MAX_AGE_MS phải là một số nguyên dương.');
  }

  return configuredValue;
};

const getSessionCookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: getSessionMaxAge(),
  path: '/',
});

const createSessionMiddleware = () => {
  const { MONGODB_URI: mongoUrl, SESSION_SECRET: secret } = process.env;

  if (!secret) {
    throw new Error(
      'SESSION_SECRET chưa được cấu hình. Hãy thêm một secret mạnh vào file .env.',
    );
  }

  if (!mongoUrl) {
    throw new Error(
      'MONGODB_URI chưa được cấu hình nên không thể khởi tạo session store.',
    );
  }

  const store = MongoStore.create({
    mongoUrl,
    collectionName: 'sessions',
  });
  activeStore = store;

  store.on('error', (error) => {
    const errorName = error?.name || 'UnknownError';
    console.error(`MongoDB session store gặp lỗi (${errorName}).`);
  });

  return session({
    name: getSessionCookieName(),
    secret,
    resave: false,
    saveUninitialized: false,
    store,
    cookie: getSessionCookieOptions(),
  });
};

const closeSessionStore = async () => {
  const store = activeStore;
  activeStore = null;

  if (store?.collectionP) {
    await store.collectionP;
  }

  if (store && typeof store.close === 'function') {
    await store.close();
  }
};

const waitForSessionStore = async () => {
  if (activeStore?.collectionP) {
    await activeStore.collectionP;
  }
};

module.exports = {
  closeSessionStore,
  createSessionMiddleware,
  getSessionCookieOptions,
  getSessionCookieName,
  getSessionMaxAge,
  waitForSessionStore,
};
