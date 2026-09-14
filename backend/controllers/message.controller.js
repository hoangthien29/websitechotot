const { validationResult } = require('express-validator');

const conversationService = require('../services/conversation.service');
const messageService = require('../services/message.service');
const {
  buildConversationMessagesUrl,
  buildMessagesUrl,
  createConversationMessagesPagination,
  createMessagesPagination,
} = require('../utils/createPagination');
const presentConversation = require('../utils/presentConversation');
const presentMessage = require('../utils/presentMessage');

const getFieldErrors = (req) => {
  const mappedErrors = validationResult(req).mapped();

  return Object.fromEntries(
    Object.entries(mappedErrors).map(([field, error]) => [field, error.msg]),
  );
};

const getGeneralError = (errors) =>
  errors._unknown_fields || errors.general || '';

const renderNotFound = (req, res) =>
  res.status(404).render('errors/404', {
    pageTitle: 'Không tìm thấy trang',
    requestedUrl: req.originalUrl,
  });

const renderForbidden = (res) =>
  res.status(403).render('errors/403', {
    pageTitle: 'Không có quyền thực hiện',
  });

const getEmptyConversationsPagination = () =>
  createMessagesPagination({
    page: 1,
    limit: conversationService.CONVERSATIONS_PER_PAGE,
    totalItems: 0,
    totalPages: 1,
    hasPrev: false,
    hasNext: false,
    previousPage: null,
    nextPage: null,
  });

const renderConversation = async (req, res, conversation, options = {}) => {
  const page = options.page || 1;
  const messageResult =
    options.messageResult ||
    (await messageService.getMessagesPage(
      conversation._id,
      page,
      messageService.MESSAGES_PER_PAGE,
    ));
  const presentedConversation = presentConversation(
    conversation,
    req.user._id,
  );
  const pagination = createConversationMessagesPagination(
    messageResult.pagination,
    conversation._id,
  );

  return res.status(options.statusCode || 200).render('messages/show', {
    pageTitle: `Trò chuyện với ${presentedConversation.otherParticipant.name}`,
    conversation: presentedConversation,
    messages: messageResult.items.map((message) =>
      presentMessage(message, req.user._id),
    ),
    pagination,
    totalItems: pagination.totalItems,
    canSend: ['active', 'sold'].includes(
      presentedConversation.listing.status,
    ),
    errors: options.errors || {},
    oldInput: {
      content:
        typeof options.oldInput?.content === 'string'
          ? options.oldInput.content
          : '',
    },
  });
};

const listConversations = async (req, res, next) => {
  const errors = getFieldErrors(req);

  if (Object.keys(errors).length > 0) {
    return res.status(422).render('messages/index', {
      pageTitle: 'Tin nhắn',
      conversations: [],
      pagination: getEmptyConversationsPagination(),
      totalItems: 0,
      currentPage: 1,
      errors: {
        page: errors.page,
        general: getGeneralError(errors),
      },
    });
  }

  try {
    const page = Number(req.query.page || 1);
    const result = await conversationService.getUserConversationsPage(
      req.user._id,
      page,
      conversationService.CONVERSATIONS_PER_PAGE,
    );

    if (
      result.pagination.totalItems > 0 &&
      page > result.pagination.totalPages
    ) {
      return res.redirect(
        302,
        buildMessagesUrl(result.pagination.totalPages),
      );
    }

    const pagination = createMessagesPagination(result.pagination);

    return res.render('messages/index', {
      pageTitle: 'Tin nhắn',
      conversations: result.items.map((conversation) =>
        presentConversation(conversation, req.user._id),
      ),
      pagination,
      totalItems: pagination.totalItems,
      currentPage: pagination.page,
      errors: {},
    });
  } catch (error) {
    return next(error);
  }
};

const startConversation = async (req, res, next) => {
  if (Object.keys(getFieldErrors(req)).length > 0) {
    return renderNotFound(req, res);
  }

  try {
    const conversation =
      await conversationService.findOrCreateConversation(
        req.params.id,
        req.user._id,
      );

    return res.redirect(303, `/messages/${conversation._id}#latest`);
  } catch (error) {
    if (
      error.code === conversationService.CONVERSATION_LISTING_NOT_FOUND
    ) {
      return renderNotFound(req, res);
    }

    if (error.code === conversationService.CONVERSATION_OWN_LISTING) {
      return renderForbidden(res);
    }

    if (error.code === conversationService.CONVERSATION_LISTING_SOLD) {
      return res.status(422).render('messages/unavailable', {
        pageTitle: 'Không thể bắt đầu trò chuyện',
        message: error.message,
        listingUrl: `/listings/${req.params.id}`,
      });
    }

    return next(error);
  }
};

const showConversation = async (req, res, next) => {
  const errors = getFieldErrors(req);

  if (errors.conversationId) {
    return renderNotFound(req, res);
  }

  try {
    const conversation =
      await conversationService.getConversationForParticipant(
        req.params.conversationId,
        req.user._id,
      );

    if (!conversation) {
      return renderNotFound(req, res);
    }

    const page = errors.page || getGeneralError(errors)
      ? 1
      : Number(req.query.page || 1);
    const readResult = await messageService.markConversationAsRead(
      conversation._id,
      req.user._id,
    );
    res.locals.unreadMessageCount = Math.max(
      0,
      Number(res.locals.unreadMessageCount || 0) -
        readResult.markedCount,
    );
    const messageResult = await messageService.getMessagesPage(
      conversation._id,
      page,
      messageService.MESSAGES_PER_PAGE,
    );

    if (
      Object.keys(errors).length === 0 &&
      messageResult.pagination.totalItems > 0 &&
      page > messageResult.pagination.totalPages
    ) {
      return res.redirect(
        302,
        buildConversationMessagesUrl(
          conversation._id,
          messageResult.pagination.totalPages,
        ),
      );
    }

    return await renderConversation(req, res, conversation, {
      statusCode: Object.keys(errors).length > 0 ? 422 : 200,
      page,
      messageResult,
      errors: {
        page: errors.page,
        general: getGeneralError(errors),
      },
    });
  } catch (error) {
    return next(error);
  }
};

const sendMessage = async (req, res, next) => {
  const errors = getFieldErrors(req);

  if (errors.conversationId) {
    return renderNotFound(req, res);
  }

  try {
    const conversation =
      await conversationService.getConversationForParticipant(
        req.params.conversationId,
        req.user._id,
      );

    if (!conversation) {
      return renderNotFound(req, res);
    }

    if (errors.content) {
      return await renderConversation(req, res, conversation, {
        statusCode: 422,
        errors: { content: errors.content },
        oldInput: req.body,
      });
    }

    try {
      await messageService.sendMessage({
        conversation,
        senderId: req.user._id,
        content: req.body.content,
      });
    } catch (error) {
      if (
        error.code === messageService.MESSAGE_LISTING_HIDDEN ||
        error.code === messageService.MESSAGE_CONTENT_INVALID
      ) {
        return await renderConversation(req, res, conversation, {
          statusCode: 422,
          errors:
            error.code === messageService.MESSAGE_CONTENT_INVALID
              ? { content: error.message }
              : { general: error.message },
          oldInput: req.body,
        });
      }

      throw error;
    }

    return res.redirect(
      303,
      `/messages/${conversation._id}#latest`,
    );
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  listConversations,
  sendMessage,
  showConversation,
  startConversation,
};
