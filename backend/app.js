const path = require('path');
const express = require('express');
const helmet = require('helmet');
const methodOverride = require('method-override');
const morgan = require('morgan');

const { csrfProtection } = require('./config/csrf');
const { getTrustProxy, isProduction } = require('./config/environment');
const { createSessionMiddleware } = require('./config/session');
const adminRoutes = require('./routes/admin.routes');
const adminCategoryRoutes = require('./routes/adminCategory.routes');
const authRoutes = require('./routes/auth.routes');
const categoryRoutes = require('./routes/category.routes');
const favoriteRoutes = require('./routes/favorite.routes');
const homeRoutes = require('./routes/home.routes');
const listingRoutes = require('./routes/listing.routes');
const messageRoutes = require('./routes/message.routes');
const profileRoutes = require('./routes/profile.routes');
const { loadCurrentUser } = require('./middlewares/auth.middleware');
const {
  loadUnreadMessageCount,
} = require('./middlewares/message.middleware');
const notFoundMiddleware = require('./middlewares/notFound.middleware');
const errorMiddleware = require('./middlewares/error.middleware');
const {
  attachCsrfToken,
  handleCsrfError,
} = require('./middlewares/csrf.middleware');

const app = express();

app.set('view engine', 'ejs');
app.set("views", path.join(__dirname, "../frontend/views"));

app.locals.siteName = 'NTT Marketplace';
app.locals.currentYear = new Date().getFullYear();

const trustProxy = getTrustProxy();

if (trustProxy !== false) {
  app.set('trust proxy', trustProxy);
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", 'https://cdn.jsdelivr.net'],
        scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
        fontSrc: ["'self'", 'https://cdn.jsdelivr.net', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        upgradeInsecureRequests: isProduction() ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'no-referrer' },
    strictTransportSecurity: isProduction()
      ? {
          maxAge: 15552000,
          includeSubDomains: true,
          preload: false,
        }
      : false,
  }),
);

if (isProduction()) {
  app.use(morgan(':method :status :response-time ms'));
} else if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

app.use(express.static(path.join(__dirname, "../frontend/public")));
app.use(
  '/uploads',
  express.static(path.join(__dirname, '..', 'uploads'), {
    dotfiles: 'deny',
    index: false,
  }),
);
app.use(
  express.urlencoded({
    extended: true,
    limit: '32kb',
    parameterLimit: 50,
  }),
);
app.use(express.json({ limit: '32kb', strict: true }));
app.use(methodOverride('_method'));

const sessionMiddleware = createSessionMiddleware();
app.locals.sessionMiddleware = sessionMiddleware;
app.use(sessionMiddleware);
app.use(loadCurrentUser);
app.use(loadUnreadMessageCount);
app.use(csrfProtection);
app.use(attachCsrfToken);

app.use('/', authRoutes);
app.use('/', profileRoutes);
app.use('/', favoriteRoutes);
app.use('/', messageRoutes);
app.use('/', listingRoutes);
app.use('/categories', categoryRoutes);
app.use('/admin/categories', adminCategoryRoutes);
app.use('/admin', adminRoutes);
app.use('/', homeRoutes);

app.use(notFoundMiddleware);
app.use(handleCsrfError);
app.use(errorMiddleware);

module.exports = app;
