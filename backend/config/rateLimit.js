const { rateLimit } = require('express-rate-limit');

const MINUTE_MS = 60 * 1000;

const renderRateLimitError = (req, res) =>
  res.status(429).render('errors/429', {
    pageTitle: 'Quá nhiều yêu cầu',
  });

const createRateLimiter = ({ identifier, limit, windowMs }) =>
  rateLimit({
    identifier,
    legacyHeaders: false,
    limit,
    standardHeaders: 'draft-8',
    windowMs,
    handler: renderRateLimitError,
  });

const RATE_LIMIT_POLICIES = {
  adminMutation: {
    identifier: 'admin-mutation',
    limit: 30,
    windowMs: 10 * MINUTE_MS,
  },
  auth: {
    identifier: 'auth',
    limit: 10,
    windowMs: 15 * MINUTE_MS,
  },
  conversation: {
    identifier: 'conversation-create',
    limit: 20,
    windowMs: 10 * MINUTE_MS,
  },
  message: {
    identifier: 'message-send',
    limit: 30,
    windowMs: MINUTE_MS,
  },
};

const createApplicationRateLimiters = (overrides = {}) =>
  Object.fromEntries(
    Object.entries(RATE_LIMIT_POLICIES).map(([name, policy]) => [
      name,
      createRateLimiter({ ...policy, ...(overrides[name] || {}) }),
    ]),
  );

const applicationRateLimiters = createApplicationRateLimiters();
const adminMutationLimiter = applicationRateLimiters.adminMutation;
const authLimiter = applicationRateLimiters.auth;
const conversationLimiter = applicationRateLimiters.conversation;
const messageLimiter = applicationRateLimiters.message;

module.exports = {
  adminMutationLimiter,
  authLimiter,
  conversationLimiter,
  createApplicationRateLimiters,
  createRateLimiter,
  messageLimiter,
  RATE_LIMIT_POLICIES,
  renderRateLimitError,
};
