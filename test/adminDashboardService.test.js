const assert = require('node:assert/strict');
const { test } = require('node:test');

const Category = require('../src/models/Category');
const Conversation = require('../src/models/Conversation');
const Favorite = require('../src/models/Favorite');
const Listing = require('../src/models/Listing');
const Message = require('../src/models/Message');
const User = require('../src/models/User');
const adminDashboardService = require('../src/services/adminDashboard.service');

const createQuery = (value) => ({
  select() {
    return this;
  },
  populate() {
    return this;
  },
  sort() {
    return this;
  },
  limit(limit) {
    assert.equal(limit, 5);
    return this;
  },
  lean: async () => value,
});

test('dashboard chỉ count Message và trả đúng cấu trúc thống kê', async (t) => {
  const userCounts = [9, 6, 2, 1, 8, 1];
  const categoryCounts = [3, 2, 1];
  const listingCounts = [7, 3, 2, 2, 1, 1];
  const messageCountFilters = [];

  t.mock.method(User, 'countDocuments', async () => userCounts.shift());
  t.mock.method(Category, 'countDocuments', async () =>
    categoryCounts.shift(),
  );
  t.mock.method(Listing, 'countDocuments', async () =>
    listingCounts.shift(),
  );
  t.mock.method(Favorite, 'countDocuments', async () => 4);
  t.mock.method(Conversation, 'countDocuments', async () => 5);
  t.mock.method(Message, 'countDocuments', async (filter) => {
    messageCountFilters.push(filter);
    return filter?.readAt === null ? 2 : 6;
  });
  const messageFind = t.mock.method(Message, 'find');
  t.mock.method(User, 'find', () => createQuery([]));
  t.mock.method(Listing, 'find', () => createQuery([]));

  const overview =
    await adminDashboardService.getDashboardOverview();

  assert.equal(overview.stats.users.total, 9);
  assert.equal(overview.stats.listings.adminHidden, 1);
  assert.equal(overview.stats.messages.total, 6);
  assert.equal(overview.stats.messages.unread, 2);
  assert.deepEqual(messageCountFilters, [undefined, { readAt: null }]);
  assert.equal(messageFind.mock.callCount(), 0);
});
