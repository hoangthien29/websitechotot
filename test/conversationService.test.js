const assert = require('node:assert/strict');
const { test } = require('node:test');
const mongoose = require('mongoose');

const Conversation = require('../src/models/Conversation');
const Listing = require('../src/models/Listing');
const Message = require('../src/models/Message');
const conversationService = require('../src/services/conversation.service');

const createLeanQuery = (value) => ({
  select() {
    return this;
  },
  populate() {
    return this;
  },
  sort() {
    return this;
  },
  skip() {
    return this;
  },
  limit() {
    return this;
  },
  lean() {
    return Promise.resolve(value);
  },
});

test('findOrCreateConversation lấy buyer từ user và seller từ Listing', async (t) => {
  const listingId = new mongoose.Types.ObjectId();
  const buyerId = new mongoose.Types.ObjectId();
  const sellerId = new mongoose.Types.ObjectId();
  let receivedFilter;
  let receivedUpdate;

  t.mock.method(Listing, 'findById', () =>
    createLeanQuery({
      _id: listingId,
      seller: sellerId,
      status: 'active',
    }),
  );
  t.mock.method(Conversation, 'findOne', () => createLeanQuery(null));
  t.mock.method(
    Conversation,
    'findOneAndUpdate',
    async (filter, update) => {
      receivedFilter = filter;
      receivedUpdate = update;
      return { _id: new mongoose.Types.ObjectId(), ...filter };
    },
  );

  const result = await conversationService.findOrCreateConversation(
    listingId,
    buyerId,
  );

  assert.equal(result.buyer, buyerId);
  assert.equal(result.seller, sellerId);
  assert.deepEqual(receivedFilter, {
    listing: listingId,
    buyer: buyerId,
    seller: sellerId,
  });
  assert.deepEqual(receivedUpdate, { $setOnInsert: receivedFilter });
});

test('findOrCreateConversation giữ Conversation cũ cho sold/hidden và chặn tạo mới', async (t) => {
  const listingId = new mongoose.Types.ObjectId();
  const buyerId = new mongoose.Types.ObjectId();
  const sellerId = new mongoose.Types.ObjectId();
  const conversationId = new mongoose.Types.ObjectId();
  let status = 'sold';
  let existing = {
    _id: conversationId,
    listing: listingId,
    buyer: buyerId,
    seller: sellerId,
  };

  t.mock.method(Listing, 'findById', () =>
    createLeanQuery({ _id: listingId, seller: sellerId, status }),
  );
  t.mock.method(Conversation, 'findOne', () => createLeanQuery(existing));
  const createMock = t.mock.method(Conversation, 'findOneAndUpdate', async () => {
    assert.fail('Không được tạo Conversation mới');
  });

  assert.equal(
    (
      await conversationService.findOrCreateConversation(
        listingId,
        buyerId,
      )
    )._id,
    conversationId,
  );

  status = 'hidden';
  assert.equal(
    (
      await conversationService.findOrCreateConversation(
        listingId,
        buyerId,
      )
    )._id,
    conversationId,
  );

  existing = null;
  await assert.rejects(
    conversationService.findOrCreateConversation(listingId, buyerId),
    (error) =>
      error.code ===
      conversationService.CONVERSATION_LISTING_NOT_FOUND,
  );

  status = 'sold';
  await assert.rejects(
    conversationService.findOrCreateConversation(listingId, buyerId),
    (error) =>
      error.code === conversationService.CONVERSATION_LISTING_SOLD,
  );
  assert.equal(createMock.mock.callCount(), 0);
});

test('findOrCreateConversation chặn owner và phục hồi an toàn sau E11000', async (t) => {
  const listingId = new mongoose.Types.ObjectId();
  const buyerId = new mongoose.Types.ObjectId();
  const sellerId = new mongoose.Types.ObjectId();
  let seller = buyerId;
  let findCount = 0;

  t.mock.method(Listing, 'findById', () =>
    createLeanQuery({
      _id: listingId,
      seller,
      status: 'active',
    }),
  );
  t.mock.method(Conversation, 'findOne', () => {
    findCount += 1;
    return createLeanQuery(
      findCount > 1
        ? {
            _id: new mongoose.Types.ObjectId(),
            listing: listingId,
            buyer: buyerId,
            seller: sellerId,
          }
        : null,
    );
  });
  t.mock.method(Conversation, 'findOneAndUpdate', async () => {
    const error = new Error('duplicate');
    error.code = 11000;
    throw error;
  });

  await assert.rejects(
    conversationService.findOrCreateConversation(listingId, buyerId),
    (error) => error.code === conversationService.CONVERSATION_OWN_LISTING,
  );

  seller = sellerId;
  const result = await conversationService.findOrCreateConversation(
    listingId,
    buyerId,
  );
  assert.ok(result._id);
});

test('getConversationForParticipant khóa query theo participant và populate an toàn', async (t) => {
  const conversationId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  let receivedFilter;
  const query = createLeanQuery({ _id: conversationId });
  const populateCalls = [];
  query.populate = function populate(path, fields) {
    populateCalls.push([path, fields]);
    return this;
  };

  t.mock.method(Conversation, 'findOne', (filter) => {
    receivedFilter = filter;
    return query;
  });

  await conversationService.getConversationForParticipant(
    conversationId,
    userId,
  );

  assert.deepEqual(receivedFilter, {
    _id: conversationId,
    $or: [{ buyer: userId }, { seller: userId }],
  });
  assert.deepEqual(populateCalls, [
    ['listing', 'title status images price'],
    ['buyer', 'name avatar'],
    ['seller', 'name avatar'],
  ]);
});

test('getUserConversationsPage phân trang và aggregate unread đúng một lần', async (t) => {
  const userId = new mongoose.Types.ObjectId();
  const conversationId = new mongoose.Types.ObjectId();
  let participantFilter;
  let unreadPipeline;

  t.mock.method(Conversation, 'find', (filter) => {
    participantFilter = filter;
    return createLeanQuery([
      {
        _id: conversationId,
        buyer: userId,
        seller: new mongoose.Types.ObjectId(),
      },
    ]);
  });
  t.mock.method(Conversation, 'countDocuments', async () => 21);
  t.mock.method(Message, 'aggregate', async (pipeline) => {
    unreadPipeline = pipeline;
    return [{ _id: conversationId, unreadCount: 3 }];
  });

  const result = await conversationService.getUserConversationsPage(
    userId,
    2,
    20,
  );

  assert.deepEqual(participantFilter, {
    $or: [{ buyer: userId }, { seller: userId }],
  });
  assert.equal(result.items[0].unreadCount, 3);
  assert.equal(result.pagination.totalPages, 2);
  assert.equal(result.pagination.page, 2);
  assert.equal(unreadPipeline[0].$match.recipient.toString(), userId.toString());
  assert.deepEqual(unreadPipeline[1], {
    $group: {
      _id: '$conversation',
      unreadCount: { $sum: 1 },
    },
  });
});
