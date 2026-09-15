document.addEventListener('DOMContentLoaded', () => {
  const panel = document.querySelector('#chat-panel');
  if (!panel) return;

  const getCsrfToken = (form) =>
    form.querySelector('input[name="_csrf"]')?.value || '';

  const showToast = (message, type = 'success') => {
    let toast = panel.querySelector('.message-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'message-toast';
      panel.appendChild(toast);
    }
    toast.textContent = message;
    toast.dataset.type = type;
    toast.classList.add('is-visible');
    window.clearTimeout(showToast.timeout);
    showToast.timeout = window.setTimeout(() => {
      toast.classList.remove('is-visible');
    }, 2600);
  };

  const scrollThreadToLatest = (thread) => {
    if (!thread) return;
    const scroll = () => {
      thread.scrollTop = thread.scrollHeight;
    };
    scroll();
    window.requestAnimationFrame(scroll);
    window.setTimeout(scroll, 120);
  };

  const appendMessage = (message, currentUserId) => {
    const thread = panel.querySelector('.message-thread');
    if (!thread) return;
    let list = thread.querySelector('.message-list');
    if (!list) {
      thread.querySelector('.message-thread-empty')?.remove();
      list = document.createElement('ol');
      list.className = 'message-list';
      thread.insertBefore(list, thread.querySelector('#latest'));
    }
    if (message.id && list.querySelector(`[data-message-id="${message.id}"]`)) {
      return list.querySelector(`[data-message-id="${message.id}"]`);
    }

    const isMine = String(message.senderId || '') === String(currentUserId || '');
    const row = document.createElement('li');
    row.className = `message-row ${isMine ? 'is-mine' : 'is-other'}`;
    row.dataset.messageId = message.id || '';

    const bubble = document.createElement('article');
    bubble.className = `message-bubble ${isMine ? 'message-bubble--mine' : 'message-bubble--other'}`;
    const label = document.createElement('p');
    label.className = 'message-sender-label';
    label.textContent = isMine ? 'Bạn' : (message.senderName || 'Người dùng');
    bubble.appendChild(label);
    const hasAttachments = Array.isArray(message.attachments)
      && message.attachments.some((attachment) => attachment?.url);
    if (Array.isArray(message.attachments) && message.attachments.length > 0) {
      const attachments = document.createElement('div');
      attachments.className = 'message-attachments';
      message.attachments.forEach((attachment) => {
        if (!attachment?.url) return;
        if (attachment.type === 'video') {
          const video = document.createElement('video');
          video.className = 'message-attachment media-video';
          video.controls = true;
          video.preload = 'metadata';
          video.playsInline = true;
          const source = document.createElement('source');
          source.src = attachment.url;
          source.type = attachment.mimeType || 'video/mp4';
          video.appendChild(source);
          attachments.appendChild(video);
          return;
        }
        const image = document.createElement('img');
        image.className = 'message-attachment media-image';
        image.src = attachment.url;
        image.alt = 'Ảnh tin nhắn';
        image.loading = 'lazy';
        attachments.appendChild(image);
      });
      if (attachments.childElementCount > 0) {
        bubble.appendChild(attachments);
      }
    }
    if (message.content || !hasAttachments) {
      const content = document.createElement('p');
      content.className = 'message-content';
      content.textContent = message.content || 'Đã gửi tệp đính kèm';
      bubble.appendChild(content);
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
    return row;
  };

  const setFormFeedback = (form, message) => {
    const feedback = form.querySelector('#messageContentFeedback');
    if (feedback) {
      feedback.textContent = message || '';
      feedback.className = message
        ? 'invalid-feedback d-block field-feedback-slot'
        : 'form-text field-feedback-slot';
    }
  };

  const submitMessage = async (form) => {
    const conversationId = form.closest('[data-conversation-id]')?.dataset.conversationId;
    const content = form.querySelector('[name="content"]')?.value || '';
    const attachments = form.querySelector('[name="attachments"]')?.value || '[]';
    const currentUserId = document.body.dataset.currentUserId || '';
    let optimisticRow;

    try {
      let parsedAttachments;
      try {
        parsedAttachments = JSON.parse(attachments || '[]');
      } catch {
        parsedAttachments = [];
      }
      optimisticRow = appendMessage({
        id: `pending-${Date.now()}`,
        content: content.trim(),
        attachments: parsedAttachments,
        senderId: currentUserId,
        senderName: 'Bạn',
        createdAt: new Date().toISOString(),
      }, currentUserId);
      form.querySelector('[name="content"]').value = '';
      setFormFeedback(form, '');

      const response = await fetch(`/messages/${conversationId}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
          'X-CSRF-Token': getCsrfToken(form),
        },
        body: new URLSearchParams({ content, attachments }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.message || 'Không thể gửi tin nhắn.');
      }

      optimisticRow?.remove();
      appendMessage(payload.message, currentUserId);
      const attachmentField = form.querySelector('[name="attachments"]');
      const preview = form.querySelector('#messageComposePreview');
      if (attachmentField) {
        attachmentField.value = '[]';
      }
      if (preview) {
        preview.replaceChildren();
      }
      document.dispatchEvent(new CustomEvent('messageSent', {
        detail: {
          conversationId,
          preview: payload.message.content || (
            payload.message.attachments?.length ? 'Đã gửi ảnh/video' : 'Đã gửi tin nhắn'
          ),
          lastMessageAt: payload.message.createdAt,
          unreadDelta: 0,
          markLatest: true,
        },
      }));
    } catch (error) {
      optimisticRow?.remove();
      form.querySelector('[name="content"]').value = content;
      setFormFeedback(form, error.message || 'Không thể gửi tin nhắn.');
      showToast(error.message || 'Không thể gửi tin nhắn.', 'error');
    }
  };

  document.addEventListener('submit', (event) => {
    if (!event.target.matches('.message-compose-form')) return;
    event.preventDefault();
    void submitMessage(event.target);
  });

  document.addEventListener('change', async (event) => {
    if (!event.target.matches('#messageMediaInput')) return;
    const input = event.target;
    const form = input.closest('.message-compose-form');
    if (!form || !input.files?.length) return;

    const preview = form.querySelector('#messageComposePreview');
    try {
      const formData = new FormData();
      Array.from(input.files).forEach((file) => formData.append('files', file));
      const response = await fetch(
        `/messages/${form.closest('[data-conversation-id]').dataset.conversationId}/media`,
        {
          method: 'POST',
          body: formData,
          credentials: 'same-origin',
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            'X-CSRF-Token': getCsrfToken(form),
          },
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || 'Không thể tải ảnh/video lên.');
      form.querySelector('[name="attachments"]').value = JSON.stringify(payload.attachments || []);
      preview.innerHTML = '';
      (payload.attachments || []).forEach((attachment) => {
        const previewItem = document.createElement(
          attachment.type === 'video' ? 'video' : 'img',
        );
        previewItem.className = 'message-compose-preview__media';
        previewItem.src = attachment.url;
        if (attachment.type === 'video') {
          previewItem.controls = true;
          previewItem.muted = true;
          previewItem.preload = 'metadata';
        } else {
          previewItem.alt = 'Ảnh chuẩn bị gửi';
        }
        preview.appendChild(previewItem);
      });
    } catch (error) {
      preview.textContent = error.message || 'Không thể tải ảnh/video lên.';
      showToast(error.message || 'Không thể tải ảnh/video lên.', 'error');
    } finally {
      input.value = '';
    }
  });

  document.querySelectorAll('[data-id]').forEach((item) => {
    item.addEventListener('click', async (event) => {
      event.preventDefault();

      const response = await fetch(`/messages/${item.dataset.id}/panel`, {
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'fetch' },
      });

      if (!response.ok) {
        panel.textContent = 'Không thể tải cuộc trò chuyện.';
        return;
      }

      panel.innerHTML = await response.text();
      document.body.dataset.currentConversationId = item.dataset.id;
      const loadedThread = panel.querySelector('.message-thread');
      if (loadedThread) {
        scrollThreadToLatest(loadedThread);
        loadedThread.querySelectorAll('img, video').forEach((media) => {
          media.addEventListener('load', () => scrollThreadToLatest(loadedThread), {
            once: true,
          });
          media.addEventListener('loadedmetadata', () => scrollThreadToLatest(loadedThread), {
            once: true,
          });
        });
      }

      document.querySelectorAll('[data-conversation]').forEach((conversation) => {
        conversation.classList.toggle(
          'is-active',
          conversation.dataset.conversationId === item.dataset.id,
        );
      });

      document.dispatchEvent(new CustomEvent('conversationPanelLoaded', {
        detail: { conversationId: item.dataset.id },
      }));
      window.history.replaceState(
        null,
        '',
        `/messages#conversation=${encodeURIComponent(item.dataset.id)}`,
      );
    });
  });

  const selectedConversationId = new URLSearchParams(
    window.location.hash.replace(/^#/, ''),
  ).get('conversation');
  if (selectedConversationId) {
    const selected = Array.from(document.querySelectorAll('[data-id]'))
      .find((item) => item.dataset.id === selectedConversationId);
    selected?.click();
  }
});