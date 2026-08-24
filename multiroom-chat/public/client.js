(() => {
  const socket = io();

  // ---------- State ----------
  let me = { username: '', room: '' };
  let typingTimeout = null;

  // ---------- DOM refs ----------
  const loginScreen = document.getElementById('login-screen');
  const chatScreen = document.getElementById('chat-screen');
  const usernameInput = document.getElementById('username-input');
  const roomInput = document.getElementById('room-input');
  const joinBtn = document.getElementById('join-btn');
  const loginError = document.getElementById('login-error');

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

  // ---------- Helpers ----------
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
      li.innerHTML = `<span><span class="room-hash">#</span>${r.name}</span><span class="room-online">${r.online}</span>`;
      li.addEventListener('click', () => {
        if (r.name !== me.room) joinRoom(me.username, r.name);
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


  let isLoginMode = true;

  // Chuyển Tab Đăng nhập / Đăng ký
  document.getElementById('tab-login').addEventListener('click', () => {
    isLoginMode = true;
    document.getElementById('tab-login').classList.add('active');
    document.getElementById('tab-register').classList.remove('active');
    document.getElementById('submit-btn').textContent = 'Đăng nhập & Vào phòng';
  });
  
  document.getElementById('tab-register').addEventListener('click', () => {
    isLoginMode = false;
    document.getElementById('tab-register').classList.add('active');
    document.getElementById('tab-login').classList.remove('active');
    document.getElementById('submit-btn').textContent = 'Tạo tài khoản mới';
  });
  
  // Xử lý submit Form Auth
  document.getElementById('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = usernameInput.value.trim();
    const password = document.getElementById('password-input').value.trim();
    const room = roomInput.value.trim() || 'General';
  
    loginError.textContent = '';
    const endpoint = isLoginMode ? '/api/login' : '/api/register';
  
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
  
      if (!res.ok) throw new Error(data.error);
  
      // Lưu token phiên đăng nhập vào LocalStorage
      localStorage.setItem('chat_token', data.token);
  
      // Tiến hành join socket room
      joinRoom(data.username, room);
  
    } catch (err) {
      loginError.textContent = err.message;
    }
  });

  // ---------- Join flow ----------
  function joinRoom(username, room) {
    socket.emit('join', { username, room }, res => {
      if (!res || !res.ok) {
        loginError.textContent = 'Không thể tham gia phòng, thử lại.';
        return;
      }
      me.username = res.username;
      me.room = res.room;

      loginScreen.classList.add('hidden');
      chatScreen.classList.remove('hidden');

      meAvatar.textContent = initials(me.username);
      meName.textContent = me.username;
      currentRoomName.textContent = `#${me.room}`;
      currentRoomMeta.textContent = `Đã kết nối với vai trò ${me.username}`;

      clearMessages();
      res.history.forEach(appendChatMessage);
      appendSystemMessage(`Bạn đã tham gia #${me.room}`);
    });
  }

  joinBtn.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    if (!username) {
      loginError.textContent = 'Vui lòng nhập tên hiển thị.';
      return;
    }
    loginError.textContent = '';
    const room = roomInput.value.trim() || 'General';
    joinRoom(username, room);
  });

  [usernameInput, roomInput].forEach(inp => {
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') joinBtn.click();
    });
  });

  // ---------- Create room ----------
  createRoomBtn.addEventListener('click', () => {
    const name = newRoomInput.value.trim();
    if (!name) return;
    socket.emit('create-room', name, res => {
      if (res && res.ok) {
        newRoomInput.value = '';
      }
    });
  });

  newRoomInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') createRoomBtn.click();
  });

  // ---------- Sending messages ----------
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

  // ---------- File upload ----------
  attachBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;

    uploadStatus.textContent = `Đang tải lên ${file.name}...`;

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/upload', { method: 'POST', body: formData });
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

  // ---------- Socket listeners ----------
  socket.on('room-list', renderRoomList);
  socket.on('online-users', renderOnlineUsers);
  socket.on('chat-message', appendChatMessage);
  socket.on('system-message', msg => appendSystemMessage(msg.text));

  socket.on('typing', ({ username, isTyping }) => {
    if (username === me.username) return;
    typingIndicator.textContent = isTyping ? `${username} đang nhập...` : '';
  });

  socket.on('connect_error', () => {
    loginError.textContent = 'Không thể kết nối tới server.';
  });
})();
