const { validationResult } = require('express-validator');

const conversationService = require('../services/conversation.service');
const messageService = require('../services/message.service');
const {
  buildMessagePayload,
  emitMessage,
} = require('../services/message.dispatcher');
const socketModule = require('../socket/socket');
const {
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

const wantsJson = (req) =>
  req.xhr || req.get('Accept')?.includes('application/json');

const sendMessageError = (res, status, code, message, fieldErrors) =>
  res.status(status).json({
    code,
    message,
    ...(fieldErrors ? { fieldErrors } : {}),
  });

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

    return res.redirect(303, `/messages#conversation=${conversation._id}`);
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

    return res.redirect(302, `/messages#conversation=${conversation._id}`);
  } catch (error) {
    return next(error);
  }
};

const getConversationPanel = async (req, res, next) => {
  const errors = getFieldErrors(req);

  if (errors.conversationId) {
    return res.status(404).send('Conversation not found');
  }

  try {
    const conversation =
      await conversationService.getConversationForParticipant(
        req.params.conversationId,
        req.user._id,
      );

    if (!conversation) {
      return res.status(404).send('Conversation not found');
    }

    await messageService.markConversationAsRead(
      conversation._id,
      req.user._id,
    );

    const messageResult =
      await messageService.getMessagesPage(
        conversation._id,
        1,
        messageService.MESSAGES_PER_PAGE,
      );

    const presentedConversation = presentConversation(
      conversation,
      req.user._id,
    );

    return res.render('messages/_conversationPanel', {
      conversation: presentedConversation,
      messages: messageResult.items.map((message) =>
        presentMessage(message, req.user._id),
      ),
      pagination: createConversationMessagesPagination(
        messageResult.pagination,
        conversation._id,
      ),
      canSend: ['active', 'sold'].includes(
        presentedConversation.listing.status,
      ),
      errors: {},
      oldInput: { content: '' },
    });
  } catch (error) {
    return next(error);
  }
};

const sendMessage = async (req, res, next) => {
  const errors = getFieldErrors(req);
  const requestBody = req.body || {};

  if (errors.conversationId) {
    if (wantsJson(req)) {
      return sendMessageError(
        res,
        404,
        'MESSAGE_CONVERSATION_NOT_FOUND',
        'Không tìm thấy cuộc trò chuyện.',
      );
    }
    return renderNotFound(req, res);
  }

  try {
    const conversation =
      await conversationService.getConversationForParticipant(
        req.params.conversationId,
        req.user._id,
      );

    if (!conversation) {
      if (wantsJson(req)) {
        return sendMessageError(
          res,
          404,
          'MESSAGE_CONVERSATION_NOT_FOUND',
          'Không tìm thấy cuộc trò chuyện.',
        );
      }
      return renderNotFound(req, res);
    }

    if (Object.keys(errors).length > 0) {
      if (wantsJson(req)) {
        return sendMessageError(
          res,
          422,
          'MESSAGE_VALIDATION_FAILED',
          errors.content || errors.attachments || getGeneralError(errors),
          Object.fromEntries(
            Object.entries(errors).filter(([field]) =>
              ['content', 'attachments'].includes(field),
            ),
          ),
        );
      }
      return await renderConversation(req, res, conversation, {
        statusCode: 422,
        errors: {
          content: errors.content,
          general: errors.attachments || getGeneralError(errors),
        },
        oldInput: requestBody,
      });
    }

    let createdMessage;

    try {
      createdMessage = await messageService.sendMessage({
        conversation,
        senderId: req.user._id,
        content: requestBody.content,
        attachments: requestBody.attachments,
      });
    } catch (error) {
      if (
        error.code === messageService.MESSAGE_LISTING_HIDDEN ||
        error.code === messageService.MESSAGE_CONTENT_INVALID
      ) {
        if (wantsJson(req)) {
          return sendMessageError(
            res,
            422,
            error.code === messageService.MESSAGE_CONTENT_INVALID
              ? 'MESSAGE_VALIDATION_FAILED'
              : 'MESSAGE_LISTING_HIDDEN',
            error.message,
            error.code === messageService.MESSAGE_CONTENT_INVALID
              ? { content: error.message }
              : undefined,
          );
        }
        return await renderConversation(req, res, conversation, {
          statusCode: 422,
          errors:
            error.code === messageService.MESSAGE_CONTENT_INVALID
              ? { content: error.message }
              : { general: error.message },
          oldInput: requestBody,
        });
      }

      throw error;
    }

    const payload = buildMessagePayload({
      conversation,
      message: createdMessage,
      sender: req.user,
    });
    emitMessage(socketModule.getSocketServer(), payload);

    if (wantsJson(req)) {
      return res.status(201).json(payload);
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
  getConversationPanel,
  startConversation,
};
