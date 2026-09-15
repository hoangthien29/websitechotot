document.addEventListener('DOMContentLoaded', () => {
  const navbar = document.querySelector('.site-navbar');

  if (navbar) {
    const updateNavbar = () => {
      navbar.classList.toggle('is-scrolled', window.scrollY > 12);
    };

    let frameRequested = false;

    const requestNavbarUpdate = () => {
      if (frameRequested) {
        return;
      }

      frameRequested = true;
      window.requestAnimationFrame(() => {
        updateNavbar();
        frameRequested = false;
      });
    };

    updateNavbar();
    window.addEventListener('scroll', requestNavbarUpdate, { passive: true });
  }

  const currentUserId = document.body.dataset.currentUserId || '';

  if (window.io) {
    const socket = window.io({ withCredentials: true });

    const scrollThreadToLatest = (thread) => {
      if (!thread) return;
      const scroll = () => {
        thread.scrollTop = thread.scrollHeight;
      };
      scroll();
      window.requestAnimationFrame(scroll);
      window.setTimeout(scroll, 120);
    };

    if (currentUserId) {
      socket.emit('joinUser', currentUserId);
      socket.on('connect', () => {
        socket.emit('joinUser', currentUserId);
      });
    }

    const setHeaderTotalUnread = (totalUnread = 0) => {
      const iconWrap = document.querySelector('.nav-messages-link .site-icon-link__icon-wrap');
      if (!iconWrap) {
        return;
      }

      let badge = iconWrap.querySelector('.nav-unread-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'nav-unread-badge';
        badge.setAttribute('aria-hidden', 'true');
        iconWrap.appendChild(badge);
      }

      const safeTotal = Math.max(0, Math.min(Number(totalUnread) || 0, 99));
      badge.textContent = safeTotal >= 99 ? '99+' : String(safeTotal);
      badge.hidden = safeTotal <= 0;
    };

    const updateConversationPreview = (payload) => {
      const card = document.querySelector(
        `[data-conversation-id="${payload.conversationId}"]`,
      );

      if (!card) {
        return;
      }

      const preview = card.querySelector('.conversation-redesign-preview');
      const time = card.querySelector('.conversation-redesign-time');
      const unreadEl = card.querySelector('.conversation-redesign-unread');
      const explicitUnreadCount = Number(
        payload.unreadCountForThisUser ?? payload.unreadDelta ?? 0,
      );
      const unreadCount = Number.isFinite(explicitUnreadCount)
        ? Math.max(0, Math.min(explicitUnreadCount, 99))
        : 0;

      if (preview) {
        preview.textContent = payload.preview || preview.textContent;
      }

      if (time) {
        time.textContent = new Date(payload.lastMessageAt || Date.now()).toLocaleString('vi-VN', {
          hour: '2-digit',
          minute: '2-digit',
          day: '2-digit',
          month: '2-digit',
        });
      }

      if (unreadCount > 0) {
        let nextUnread = unreadEl || document.createElement('span');
        nextUnread.className = 'conversation-redesign-unread';
        nextUnread.textContent = unreadCount >= 99 ? '99+' : String(unreadCount);
        if (!unreadEl) {
          card.querySelector('.conversation-redesign-link')?.appendChild(nextUnread);
        }
      } else if (unreadEl) {
        unreadEl.remove();
      }

      card.classList.toggle('has-unread', unreadCount > 0);
      card.classList.toggle('has-latest', Boolean(payload.markLatest));
      card.parentElement?.prepend(card);

      if (typeof payload.totalUnread === 'number') {
        setHeaderTotalUnread(payload.totalUnread);
      }
    };

    const updateNavBadge = (delta = 1) => {
      const iconWrap = document.querySelector('.nav-messages-link .site-icon-link__icon-wrap');
      if (!iconWrap) {
        return;
      }

      let badge = iconWrap.querySelector('.nav-unread-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'nav-unread-badge';
        badge.setAttribute('aria-hidden', 'true');
        iconWrap.appendChild(badge);
      }
      const currentValue = Number.parseInt(badge.textContent || '0', 10) || 0;
      const nextValue = Math.max(0, Math.min(currentValue + delta, 99));
      badge.textContent = String(nextValue);
      badge.hidden = nextValue <= 0;
    };

    const clearConversationUnread = (conversationId) => {
      const card = document.querySelector(
        `[data-conversation-id="${conversationId}"]`,
      );
      const unread = card?.querySelector('.conversation-redesign-unread');
      const unreadCount = unread
        ? Number.parseInt(unread.textContent, 10) || 0
        : 0;

      unread?.remove();
      card?.classList.remove('has-unread');

      if (unreadCount > 0) {
        updateNavBadge(-unreadCount);
      }
    };

    const handleMessageNotification = (payload) => {
      if (!payload?.conversationId) {
        return;
      }

      updateConversationPreview(payload);

      if (typeof payload.totalUnread === 'number') {
        setHeaderTotalUnread(payload.totalUnread);
      } else if (payload.unreadDelta > 0
        && document.body.dataset.currentConversationId !== String(payload.conversationId)) {
        updateNavBadge(payload.unreadDelta);
      }
    };

    socket.on('messageNotification', handleMessageNotification);
    document.addEventListener('messageSent', (event) => {
      if (event.detail?.conversationId) {
        const payload = {
          ...event.detail,
          unreadCountForThisUser: Number(event.detail.unreadCountForThisUser ?? 0),
          totalUnread: Number(event.detail.totalUnread ?? 0),
          markLatest: true,
        };
        updateConversationPreview(payload);
      }
    });

    document.addEventListener('conversationPanelLoaded', (event) => {
      const conversationId = event.detail?.conversationId;
      if (conversationId) {
        clearConversationUnread(conversationId);
      }
    });

    socket.on('conversationUpdated', (payload) => {
      if (!payload || !payload.conversationId) {
        return;
      }

      updateConversationPreview(payload);

    });

    const handleIncomingMessage = (payload) => {
      if (!payload || !payload.conversationId || !payload.message) {
        return;
      }

      const currentId = document.body.dataset.currentConversationId || '';
      const message = payload.message || {};
      const isMine = String(message.senderId || '') === String(currentUserId || '');

      if (currentId && currentId === payload.conversationId) {
        const thread = document.querySelector('.message-thread');
        if (!thread) {
          return;
        }
        let list = thread.querySelector('.message-list');
        if (!list) {
          thread.querySelector('.message-thread-empty')?.remove();
          list = document.createElement('ol');
          list.className = 'message-list';
          thread.insertBefore(list, thread.querySelector('#latest'));
        }
        if (message.id && list.querySelector(`[data-message-id="${message.id}"]`)) {
          updateConversationPreview({
            conversationId: payload.conversationId,
            preview: message.content || 'Đã gửi ảnh/video',
            lastMessageAt: message.createdAt || Date.now(),
            senderId: message.senderId || '',
            unreadDelta: 0,
            markLatest: isMine,
          });
          return;
        }

        const row = document.createElement('li');
        row.className = `message-row ${isMine ? 'is-mine' : 'is-other'}`;
        row.dataset.messageId = message.id || '';

        if (!isMine) {
          const avatarLink = document.createElement('a');
          avatarLink.className = 'message-avatar-link';
          avatarLink.href = message.senderProfileUrl || '#';
          avatarLink.setAttribute(
            'aria-label',
            `Xem trang cá nhân của ${message.senderName || 'người dùng'}`,
          );

          const avatar = document.createElement('img');
          avatar.className = 'message-avatar';
          avatar.src = message.senderAvatarUrl || '/images/default-avatar.svg';
          avatar.alt = message.senderName || 'Người dùng';
          avatar.width = 36;
          avatar.height = 36;
          avatar.loading = 'lazy';
          avatarLink.appendChild(avatar);
          row.appendChild(avatarLink);
        }

        const bubble = document.createElement('article');
        bubble.className = `message-bubble ${isMine ? 'message-bubble--mine' : 'message-bubble--other'}`;

        const label = document.createElement('p');
        label.className = 'message-sender-label';
        label.textContent = isMine ? 'Bạn' : (message.senderName || 'Người dùng');
        bubble.appendChild(label);

        const content = document.createElement('p');
        content.className = 'message-content';
        const hasAttachments = Array.isArray(message.attachments)
          && message.attachments.some((attachment) => attachment?.url);
        if (message.content || !hasAttachments) {
          content.textContent = message.content || 'Đã gửi tệp đính kèm';
          bubble.appendChild(content);
        }

        if (hasAttachments) {
          const attachments = document.createElement('div');
          attachments.className = 'message-attachments';
          message.attachments.forEach((attachment) => {
            if (!attachment?.url) return;
            const media = document.createElement(
              attachment.type === 'video' ? 'video' : 'img',
            );
            media.className = `message-attachment media-${attachment.type === 'video' ? 'video' : 'image'}`;
            media.src = attachment.url;
            if (attachment.type === 'video') {
              media.controls = true;
              media.preload = 'metadata';
              media.playsInline = true;
            } else {
              media.alt = 'Ảnh tin nhắn';
              media.loading = 'lazy';
            }
            attachments.appendChild(media);
          });
          bubble.appendChild(attachments);
        }

        const meta = document.createElement('footer');
        meta.className = 'message-meta';
        const time = document.createElement('time');
        time.textContent = new Date(message.createdAt || Date.now()).toLocaleTimeString('vi-VN', {
          hour: '2-digit',
          minute: '2-digit',
        });
        meta.appendChild(time);

        bubble.appendChild(meta);
        row.appendChild(bubble);
        list.appendChild(row);
        scrollThreadToLatest(thread);
      }

      updateConversationPreview({
        conversationId: payload.conversationId,
        preview: message.content || 'Đã gửi ảnh/video',
        lastMessageAt: message.createdAt || Date.now(),
        senderId: message.senderId || '',
        unreadDelta: 0,
      });
    };

    socket.on('chatMessageReceived', handleIncomingMessage);
    socket.on('new_message', (message) => {
      if (!message || !message.conversationId) {
        return;
      }
      handleIncomingMessage({
        conversationId: message.conversationId,
        message,
      });
    });

    socket.on('conversation_update', (payload) => {
      if (!payload || !payload.conversationId) {
        return;
      }

      const preview = payload.preview || 'Đã gửi tin nhắn';
      const unreadCount = Number(payload.unreadCountForThisUser || 0);
      updateConversationPreview({
        conversationId: payload.conversationId,
        preview,
        lastMessageAt: payload.lastMessageAt || Date.now(),
        senderId: payload.senderId || '',
        unreadCountForThisUser: unreadCount,
        totalUnread: payload.totalUnread,
        markLatest: Boolean(payload.markLatest),
      });

      if (typeof payload.totalUnread === 'number') {
        setHeaderTotalUnread(payload.totalUnread);
      }
    });

    document.addEventListener('conversationPanelLoaded', (event) => {
      const conversationId = event.detail?.conversationId;
      if (conversationId) {
        socket.emit('joinConversation', conversationId);
        socket.emit('mark_read', { conversationId, userId: currentUserId });
      }
    });

    const activeId = document.querySelector('.messages-content-panel')?.dataset.conversationId;
    if (activeId) {
      socket.emit('joinConversation', activeId);
    }
  }
});
