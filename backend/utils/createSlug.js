const slugify = require('slugify');

const createSlug = (name) =>
  slugify(String(name || ''), {
    lower: true,
    strict: true,
    locale: 'vi',
    trim: true,
  });

module.exports = createSlug;
