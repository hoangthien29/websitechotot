const crypto = require('node:crypto');
const bcrypt = require('bcrypt');

const User = require('../models/User');

const BCRYPT_SALT_ROUNDS = 12;
const EMAIL_ALREADY_EXISTS = 'EMAIL_ALREADY_EXISTS';
const EMAIL_ALREADY_EXISTS_MESSAGE =
  'Email này đã được sử dụng. Vui lòng chọn email khác.';
const INVALID_CREDENTIALS = 'INVALID_CREDENTIALS';
const INVALID_CREDENTIALS_MESSAGE = 'Email hoặc mật khẩu không đúng.';
const ACCOUNT_BLOCKED = 'ACCOUNT_BLOCKED';
const ACCOUNT_BLOCKED_MESSAGE = 'Tài khoản của bạn đã bị khóa.';
const ACCOUNT_PENDING = 'ACCOUNT_PENDING';
const ACCOUNT_PENDING_MESSAGE = 'Tài khoản của bạn chưa được kích hoạt.';
const GOOGLE_AUTH_ERROR = 'GOOGLE_AUTH_ERROR';
const GOOGLE_AUTH_ERROR_MESSAGE =
  'Đăng nhập Google không thành công. Vui lòng thử lại.';

const createEmailAlreadyExistsError = () => {
  const error = new Error(EMAIL_ALREADY_EXISTS_MESSAGE);
  error.code = EMAIL_ALREADY_EXISTS;
  return error;
};

const createAuthError = (code, message) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const createGoogleAuthError = (message = GOOGLE_AUTH_ERROR_MESSAGE) => {
  const error = new Error(message);
  error.code = GOOGLE_AUTH_ERROR;
  return error;
};

const registerUser = async (data) => {
  const { name, email, password } = data;
  const normalizedName = name.trim();
  const normalizedEmail = email.trim().toLowerCase();

  const existingUser = await User.findOne({ email: normalizedEmail }).select('_id');

  if (existingUser) {
    throw createEmailAlreadyExistsError();
  }

  const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  try {
    const user = await User.create({
      name: normalizedName,
      email: normalizedEmail,
      password: hashedPassword,
      role: 'user',
      status: 'active',
    });

    return { userId: user._id };
  } catch (error) {
    if (error.code === 11000) {
      throw createEmailAlreadyExistsError();
    }

    throw error;
  }
};

const authenticateUser = async ({ email, password }) => {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await User.findOne({ email: normalizedEmail }).select('+password');

  if (!user) {
    throw createAuthError(INVALID_CREDENTIALS, INVALID_CREDENTIALS_MESSAGE);
  }

  const passwordMatches = await bcrypt.compare(password, user.password);

  if (!passwordMatches) {
    throw createAuthError(INVALID_CREDENTIALS, INVALID_CREDENTIALS_MESSAGE);
  }

  if (user.status === 'blocked') {
    throw createAuthError(ACCOUNT_BLOCKED, ACCOUNT_BLOCKED_MESSAGE);
  }

  if (user.status === 'pending') {
    throw createAuthError(ACCOUNT_PENDING, ACCOUNT_PENDING_MESSAGE);
  }

  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    avatar: user.avatar,
    role: user.role,
    status: user.status,
  };
};

const findOrCreateGoogleUser = async (profile = {}) => {
  const email = String(profile.email || '').trim().toLowerCase();
  const rawName = String(profile.name || '').trim();

  if (!email) {
    throw createGoogleAuthError('Email Google không hợp lệ.');
  }

  const existingUserQuery = User.findOne({ email });
  const existingUser =
    typeof existingUserQuery?.select === 'function'
      ? await existingUserQuery.select('+password')
      : await existingUserQuery;

  if (existingUser) {
    if (existingUser.status === 'blocked') {
      throw createAuthError(ACCOUNT_BLOCKED, ACCOUNT_BLOCKED_MESSAGE);
    }

    if (existingUser.status === 'pending') {
      throw createAuthError(ACCOUNT_PENDING, ACCOUNT_PENDING_MESSAGE);
    }

    return {
      created: false,
      user: {
        _id: existingUser._id,
        name: existingUser.name,
        email: existingUser.email,
        avatar: existingUser.avatar,
        role: existingUser.role,
        status: existingUser.status,
      },
    };
  }

  const generatedPassword = crypto.randomBytes(32).toString('hex');
  const hashedPassword = await bcrypt.hash(generatedPassword, BCRYPT_SALT_ROUNDS);
  const safeName = rawName || 'Google User';

  try {
    const user = await User.create({
      name: safeName,
      email,
      password: hashedPassword,
      avatar: typeof profile.picture === 'string' ? profile.picture : '',
      role: 'user',
      status: 'active',
    });

    return {
      created: true,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        role: user.role,
        status: user.status,
      },
    };
  } catch (error) {
    if (error.code === 11000) {
      throw createEmailAlreadyExistsError();
    }

    throw error;
  }
};

module.exports = {
  ACCOUNT_BLOCKED,
  ACCOUNT_BLOCKED_MESSAGE,
  ACCOUNT_PENDING,
  ACCOUNT_PENDING_MESSAGE,
  BCRYPT_SALT_ROUNDS,
  EMAIL_ALREADY_EXISTS,
  EMAIL_ALREADY_EXISTS_MESSAGE,
  GOOGLE_AUTH_ERROR,
  GOOGLE_AUTH_ERROR_MESSAGE,
  INVALID_CREDENTIALS,
  INVALID_CREDENTIALS_MESSAGE,
  authenticateUser,
  createGoogleAuthError,
  findOrCreateGoogleUser,
  registerUser,
};
