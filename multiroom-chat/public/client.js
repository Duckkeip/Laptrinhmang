(() => {
  // Check trang hiện tại
  const isChatPage = window.location.pathname === '/chat';
  const isLoginPage = window.location.pathname === '/login' || window.location.pathname === '/';

  // State
  let me = { username: '', room: '' };
  let typingTimeout = null;
  let socket = null;

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
      const wrap = document.createElement('div');
      wrap.className = 'msg' + (isMe ? ' me' : '');

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

      uploadStatus.textContent = `Đang tải lên ${file.name}...`;

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

    socket.on('typing', ({ username, isTyping }) => {
      if (username === me.username) return;
      typingIndicator.textContent = isTyping ? `${username} đang nhập...` : '';
    });

    socket.on('connect_error', (err) => {
      if (err.message === 'AUTH_REQUIRED' || err.message === 'AUTH_INVALID') {
        localStorage.clear();
        window.location.href = '/login';
      }
    });
  }
})();