(() => {
  // Check trang hiện tại
  const isChatPage = window.location.pathname === '/chat';
  const isLoginPage = window.location.pathname === '/login' || window.location.pathname === '/';

  // State
  let me = { username: '', room: '' };
  let typingTimeout = null;
  let socket = null;
  let editMessageId = null;
  let editMessageText = '';

  // Global Helpers
  function initials(name) {
    return (name || '?').trim().slice(0, 2).toUpperCase();
  }

  function formatTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  }

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  // ==========================================
  // 1. LOGIC DÀNH CHO TRANG ĐĂNG NHẬP (/login)
  // ==========================================
  if (isLoginPage) {
    const authForm = document.getElementById('auth-form');
    const usernameInput = document.getElementById('username-input');
    const passwordInput = document.getElementById('password-input');
    const roomInput = document.getElementById('room-input');
    const loginError = document.getElementById('login-error');
    const tabLogin = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');
    const submitBtn = document.getElementById('submit-btn');

    let isLoginMode = true;

    if (tabLogin && tabRegister) {
      tabLogin.addEventListener('click', () => {
        isLoginMode = true;
        tabLogin.classList.add('active');
        tabRegister.classList.remove('active');
        if (submitBtn) submitBtn.querySelector('span').textContent = 'Đăng nhập';
      });

      tabRegister.addEventListener('click', () => {
        isLoginMode = false;
        tabRegister.classList.add('active');
        tabLogin.classList.remove('active');
        if (submitBtn) submitBtn.querySelector('span').textContent = 'Tạo tài khoản';
      });
    }

    if (authForm) {
      authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = usernameInput.value.trim();
        const password = passwordInput.value.trim();
        const room = roomInput ? roomInput.value.trim() || 'General' : 'General';

        if (loginError) loginError.textContent = '';
        const endpoint = isLoginMode ? '/api/login' : '/api/register';

        try {
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
          });

          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Đã xảy ra lỗi');

          // Lưu token và thông tin vào LocalStorage
          localStorage.setItem('chat_token', data.token);
          localStorage.setItem('chat_username', data.username);
          localStorage.setItem('chat_room', room);

          // Chuyển hướng tới route /chat
          window.location.href = '/chat';
        } catch (err) {
          if (loginError) loginError.textContent = err.message;
        }
      });
    }
    return; // Dừng lại, không chạy logic trang Chat
  }

  // ==========================================
  // 2. LOGIC DÀNH CHO TRANG CHAT (/chat)
  // ==========================================
  if (isChatPage) {
    const token = localStorage.getItem('chat_token');
    const savedUsername = localStorage.getItem('chat_username');
    const savedRoom = localStorage.getItem('chat_room') || 'General';

    // Nếu không có token -> Bắt buộc về /login
    if (!token || !savedUsername) {
      window.location.href = '/login';
      return;
    }

    // Khởi tạo Socket kèm Token xác thực JWT
    socket = io({
      auth: { token }
    });

    // DOM Refs cho trang Chat
    const roomListEl = document.getElementById('room-list');
    const newRoomInput = document.getElementById('new-room-input');
    const createRoomBtn = document.getElementById('create-room-btn');
    const onlineListEl = document.getElementById('online-list');
    const onlineCountEl = document.getElementById('online-count');
    const meAvatar = document.getElementById('me-avatar');
    const meName = document.getElementById('me-name');

    const currentRoomName = document.getElementById('current-room-name');
    const currentRoomMeta = document.getElementById('current-room-meta');
    const messagesEl = document.getElementById('messages');
    const typingIndicator = document.getElementById('typing-indicator');
    const messageForm = document.getElementById('message-form');
    const messageInput = document.getElementById('message-input');
    const attachBtn = document.getElementById('attach-btn');
    const fileInput = document.getElementById('file-input');
    const uploadStatus = document.getElementById('upload-status');

    // Edit message modal refs
    const editMessageModal = document.getElementById('edit-message-modal');
    const editMessageInput = document.getElementById('edit-message-input');
    const editMessageCloseBtn = document.getElementById('edit-message-close-btn');
    const editMessageCancelBtn = document.getElementById('edit-message-cancel-btn');
    const editMessageSaveBtn = document.getElementById('edit-message-save-btn');

    // Lay gioi han dung luong file tu server (tranh go cung 1 con so o 2 noi)
    let maxFileSizeMB = 15; // gia tri du phong, se duoc ghi de ngay khi fetch xong
    fetch('/api/config')
      .then(r => r.json())
      .then(cfg => {
        maxFileSizeMB = cfg.maxFileSizeMB;
        uploadStatus.textContent = `Có thể gửi file tối đa ${maxFileSizeMB}MB`;
        setTimeout(() => { if (uploadStatus.textContent.startsWith('Có thể gửi')) uploadStatus.textContent = ''; }, 4000);
      })
      .catch(() => {});

    function scrollToBottom() {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function clearMessages() {
      messagesEl.innerHTML = '';
    }

    function appendSystemMessage(text) {
      const div = document.createElement('div');
      div.className = 'system-msg';
      div.textContent = text;
      messagesEl.appendChild(div);
      scrollToBottom();
    }

    function appendChatMessage(msg) {
      const isMe = msg.username === me.username;
      const isAIBot = msg.username === 'AI Bot';
      const wrap = document.createElement('div');
      wrap.className = 'msg' + (isMe ? ' me' : '') + (isAIBot ? ' ai-bot' : '');
      if (msg.id) wrap.dataset.id = msg.id;

      const avatar = document.createElement('div');
      avatar.className = 'msg-avatar';
      avatar.textContent = initials(msg.username);

      const body = document.createElement('div');
      body.className = 'msg-body';

      const meta = document.createElement('div');
      meta.className = 'msg-meta';
      const uname = document.createElement('span');
      uname.className = 'msg-username';
      uname.textContent = msg.username;
      const time = document.createElement('span');
      time.className = 'msg-time';
      time.textContent = formatTime(msg.time);
      meta.appendChild(uname);
      meta.appendChild(time);

      // Chi cho phep xoa/sua tin nhan CUA CHINH MINH (khong xoa/sua duoc tin AI Bot/nguoi khac)
      if (isMe && msg.id) {
        // Nút sửa tin nhắn
        const editBtn = document.createElement('button');
        editBtn.className = 'msg-edit-btn';
        editBtn.title = 'Sửa tin nhắn';
        editBtn.type = 'button';
        editBtn.textContent = '✏️';
        editBtn.addEventListener('click', () => {
          editMessageId = msg.id;
          editMessageInput.value = msg.text;
          editMessageModal.classList.remove('hidden');
          editMessageInput.focus();
        });
        meta.appendChild(editBtn);

        // Nút xóa tin nhắn
        const delBtn = document.createElement('button');
        delBtn.className = 'msg-delete-btn';
        delBtn.title = 'Xóa tin nhắn';
        delBtn.type = 'button';
        delBtn.textContent = '🗑';
        delBtn.addEventListener('click', () => {
          if (!confirm('Xóa tin nhắn này?')) return;
          socket.emit('delete-message', msg.id, res => {
            if (!res || !res.ok) alert(res?.error || 'Không thể xóa tin nhắn');
          });
        });
        meta.appendChild(delBtn);
      }

      body.appendChild(meta);

      if (msg.type === 'text') {
        const bubble = document.createElement('div');
        bubble.className = 'msg-bubble';
        bubble.textContent = msg.text;
        body.appendChild(bubble);
      } else if (msg.type === 'file') {
        if (msg.isImage) {
          const img = document.createElement('img');
          img.className = 'msg-image';
          img.src = msg.url;
          img.alt = msg.name;
          const link = document.createElement('a');
          link.href = msg.url;
          link.target = '_blank';
          link.rel = 'noopener';
          link.appendChild(img);
          body.appendChild(link);
        } else {
          const link = document.createElement('a');
          link.className = 'msg-file';
          link.href = msg.url;
          link.target = '_blank';
          link.rel = 'noopener';
          link.innerHTML = `<span class="msg-file-icon">📄</span>
            <span>
              <div class="msg-file-name"></div>
              <div class="msg-file-size">${formatSize(msg.size || 0)}</div>
            </span>`;
          link.querySelector('.msg-file-name').textContent = msg.name;
          body.appendChild(link);
        }
      }

      wrap.appendChild(avatar);
      wrap.appendChild(body);
      messagesEl.appendChild(wrap);
      scrollToBottom();
    }

    function renderRoomList(rooms) {
      roomListEl.innerHTML = '';
      rooms.forEach(r => {
        const li = document.createElement('li');
        li.className = r.name === me.room ? 'active' : '';

        const nameSpan = document.createElement('span');
        const hash = document.createElement('span');
        hash.className = 'room-hash';
        hash.textContent = '#';
        nameSpan.appendChild(hash);
        nameSpan.appendChild(document.createTextNode(r.name));

        const onlineSpan = document.createElement('span');
        onlineSpan.className = 'room-online';
        onlineSpan.textContent = r.online;

        li.appendChild(nameSpan);
        li.appendChild(onlineSpan);
        li.addEventListener('click', () => {
          if (r.name !== me.room) joinRoom(r.name);
        });
        roomListEl.appendChild(li);
      });
    }

    function renderOnlineUsers(usernames) {
      onlineCountEl.textContent = usernames.length;
      onlineListEl.innerHTML = '';
      usernames.forEach(name => {
        const li = document.createElement('li');
        li.innerHTML = `<span class="dot online"></span><span></span>`;
        li.querySelector('span:last-child').textContent = name;
        if (name !== me.username) {
          li.title = `Nhắn riêng cho ${name}`;
          li.addEventListener('click', () => openDM(name));
        }
        onlineListEl.appendChild(li);
      });
    }

    function joinRoom(room) {
      socket.emit('join', { room }, res => {
        if (!res || !res.ok) {
          alert('Không thể tham gia phòng');
          return;
        }
        me.username = res.username;
        me.room = res.room;
        localStorage.setItem('chat_room', me.room);

        meAvatar.textContent = initials(me.username);
        meName.textContent = me.username;
        currentRoomName.textContent = `#${me.room}`;
        currentRoomMeta.textContent = `Đã kết nối với vai trò ${me.username}`;

        clearMessages();
        res.history.forEach(appendChatMessage);
        appendSystemMessage(`Bạn đã tham gia #${me.room}`);
      });
    }

    // Tự động join phòng khi kết nối thành công
    socket.on('connect', () => {
      joinRoom(savedRoom);
    });

    // Tạo phòng
    createRoomBtn.addEventListener('click', () => {
      const name = newRoomInput.value.trim();
      if (!name) return;
      socket.emit('create-room', name, res => {
        if (res && res.ok) {
          newRoomInput.value = '';
          joinRoom(name);
        }
      });
    });

    newRoomInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') createRoomBtn.click();
    });

    // Gửi tin nhắn
    messageForm.addEventListener('submit', e => {
      e.preventDefault();
      const text = messageInput.value.trim();
      if (!text) return;
      socket.emit('chat-message', { text });
      messageInput.value = '';
      socket.emit('typing', false);
    });

    let typingActive = false;
    messageInput.addEventListener('input', () => {
      if (!typingActive) {
        typingActive = true;
        socket.emit('typing', true);
      }
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => {
        typingActive = false;
        socket.emit('typing', false);
      }, 1200);
    });

    // File upload (Cần truyền Bearer Token)
    attachBtn.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;

      // Kiem tra kich thuoc NGAY TREN TRINH DUYET truoc khi upload - phan hoi
      // tuc thi, khong can cho round-trip mang roi moi biet file qua lon.
      const maxBytes = maxFileSizeMB * 1024 * 1024;
      if (file.size > maxBytes) {
        uploadStatus.textContent = `File "${file.name}" (${formatSize(file.size)}) vượt quá giới hạn ${maxFileSizeMB}MB. Vui lòng chọn file nhỏ hơn.`;
        fileInput.value = '';
        return;
      }

      uploadStatus.textContent = `Đang tải lên ${file.name} (${formatSize(file.size)})...`;

      const formData = new FormData();
      formData.append('file', file);

      try {
        const res = await fetch('/upload', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          },
          body: formData
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Lỗi tải file');

        socket.emit('file-message', data);
        uploadStatus.textContent = '';
      } catch (err) {
        uploadStatus.textContent = `Lỗi: ${err.message}`;
      } finally {
        fileInput.value = '';
      }
    });

    // Socket Listeners
    socket.on('room-list', renderRoomList);
    socket.on('online-users', renderOnlineUsers);
    socket.on('chat-message', appendChatMessage);
    socket.on('system-message', msg => appendSystemMessage(msg.text));

    socket.on('message-deleted', ({ id }) => {
      const el = messagesEl.querySelector(`[data-id="${id}"]`);
      if (el) el.remove();
    });

    socket.on('typing', ({ username, isTyping }) => {
      if (username === me.username) return;
      const label = username === 'AI Bot' ? '🤖 AI Bot đang trả lời...' : `${username} đang nhập...`;
      typingIndicator.textContent = isTyping ? label : '';
    });

    socket.on('connect_error', (err) => {
      if (err.message === 'AUTH_REQUIRED' || err.message === 'AUTH_INVALID') {
        localStorage.clear();
        window.location.href = '/login';
      }
    });

    // ---------- Direct Message (nhan tin rieng 1-1) ----------
    const dmModal = document.getElementById('dm-modal');
    const dmMessagesEl = document.getElementById('dm-messages');
    const dmForm = document.getElementById('dm-form');
    const dmInput = document.getElementById('dm-input');
    const dmUsernameEl = document.getElementById('dm-username');
    const dmAvatarEl = document.getElementById('dm-avatar');
    const dmOnlineStatusEl = document.getElementById('dm-online-status');
    const dmCloseBtn = document.getElementById('dm-close-btn');
    const dmToast = document.getElementById('dm-toast');

    let currentDMUser = null;

    function appendDMMessage(msg) {
      const isMe = msg.from === me.username;
      const wrap = document.createElement('div');
      wrap.className = 'msg' + (isMe ? ' me' : '');
      if (msg._id || msg.id) wrap.dataset.id = msg._id || msg.id;

      const avatar = document.createElement('div');
      avatar.className = 'msg-avatar';
      avatar.textContent = initials(msg.from);

      const body = document.createElement('div');
      body.className = 'msg-body';

      const bubble = document.createElement('div');
      bubble.className = 'msg-bubble';

      if (msg.type === 'file') {
        if (msg.isImage) {
          const img = document.createElement('img');
          img.src = msg.url;
          img.className = 'msg-image';
          bubble.appendChild(img);
        } else {
          const link = document.createElement('a');
          link.href = msg.url;
          link.target = '_blank';
          link.textContent = `📎 ${msg.name}`;
          bubble.appendChild(link);
        }
      } else {
        bubble.textContent = msg.text;
      }

      body.appendChild(bubble);

      if (isMe && (msg._id || msg.id)) {
        const delBtn = document.createElement('button');
        delBtn.className = 'msg-delete-btn dm-delete-btn';
        delBtn.title = 'Xóa tin nhắn';
        delBtn.type = 'button';
        delBtn.textContent = '🗑';
        delBtn.addEventListener('click', () => {
          if (!confirm('Xóa tin nhắn này?')) return;
          socket.emit('delete-dm-message', msg._id || msg.id, res => {
            if (!res || !res.ok) alert(res?.error || 'Không thể xóa tin nhắn');
          });
        });
        body.appendChild(delBtn);
      }

      wrap.appendChild(avatar);
      wrap.appendChild(body);
      dmMessagesEl.appendChild(wrap);
      dmMessagesEl.scrollTop = dmMessagesEl.scrollHeight;
    }

    function openDM(username) {
      currentDMUser = username;
      dmUsernameEl.textContent = username;
      dmAvatarEl.textContent = initials(username);
      dmMessagesEl.innerHTML = '';
      dmModal.classList.remove('hidden');

      socket.emit('join-dm', username, res => {
        if (!res || !res.ok) {
          alert(res?.error || 'Không thể mở đoạn chat riêng');
          dmModal.classList.add('hidden');
          return;
        }
        dmOnlineStatusEl.textContent = res.online ? 'Đang online' : 'Offline';
        dmOnlineStatusEl.classList.toggle('online', res.online);
        res.history.forEach(appendDMMessage);
        dmInput.focus();
      });
    }

    dmCloseBtn.addEventListener('click', () => {
      dmModal.classList.add('hidden');
      currentDMUser = null;
    });

    dmForm.addEventListener('submit', e => {
      e.preventDefault();
      const text = dmInput.value.trim();
      if (!text || !currentDMUser) return;
      socket.emit('dm-message', { to: currentDMUser, text, type: 'text' });
      dmInput.value = '';
    });

    socket.on('dm-message', msg => {
      // Chi ve vao khung chat neu dang mo DUNG cuoc tro chuyen nay
      const otherParty = msg.from === me.username ? msg.to : msg.from;
      if (currentDMUser === otherParty) {
        appendDMMessage(msg);
      }
    });

    socket.on('dm-message-deleted', ({ id }) => {
      const el = dmMessagesEl.querySelector(`[data-id="${id}"]`);
      if (el) el.remove();
    });

    let dmToastTimer = null;
    socket.on('dm-notify', ({ from, text }) => {
      // Neu dang mo dung DM voi nguoi nay thi khong can toast, tin da hien roi
      if (currentDMUser === from) return;
      dmToast.innerHTML = `<strong>${from}</strong>: ${text}`;
      dmToast.classList.remove('hidden');
      dmToast.onclick = () => { openDM(from); dmToast.classList.add('hidden'); };
      clearTimeout(dmToastTimer);
      dmToastTimer = setTimeout(() => dmToast.classList.add('hidden'), 5000);
    });

    // Edit message modal events
    editMessageCloseBtn.addEventListener('click', () => {
      editMessageModal.classList.add('hidden');
      editMessageInput.value = '';
      editMessageId = null;
    });

    editMessageCancelBtn.addEventListener('click', () => {
      editMessageModal.classList.add('hidden');
      editMessageInput.value = '';
      editMessageId = null;
    });

    editMessageSaveBtn.addEventListener('click', () => {
      const newText = editMessageInput.value.trim();
      if (newText && editMessageId) {
        socket.emit('edit-message', { messageId: editMessageId, text: newText }, res => {
          if (!res || !res.ok) {
            alert(res?.error || 'Không thể sửa tin nhắn');
          }
          editMessageModal.classList.add('hidden');
          editMessageInput.value = '';
          editMessageId = null;
        });
      }
    });

    // Handle message updated from server (for edit-message)
    socket.on('message-updated', (msg) => {
      const el = messagesEl.querySelector(`[data-id="${msg.id}"]`);
      if (el) {
        // Update the text of the message bubble
        const bubble = el.querySelector('.msg-bubble');
        if (bubble) {
          bubble.textContent = msg.text;
        }

        // Update the edited indicator in the meta
        const meta = el.querySelector('.msg-meta');
        if (meta) {
          // Remove any existing edited indicator
          const existingEdited = meta.querySelector('.msg-edited');
          if (existingEdited) {
            existingEdited.remove();
          }
          if (msg.edited) {
            const editedSpan = document.createElement('span');
            editedSpan.className = 'msg-edited';
            editedSpan.textContent = '(đã chỉnh sửa)';
            editedSpan.style.fontSize = '0.75em';
            editedSpan.style.color = 'var(--text-3)';
            editedSpan.style.marginLeft = '6px';
            meta.appendChild(editedSpan);
          }
        }
      }
    });
  }
})();