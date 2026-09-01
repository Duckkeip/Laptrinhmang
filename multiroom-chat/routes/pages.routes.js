const path = require('path');
const express = require('express');
const router = express.Router();

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Route mac dinh: chuyen huong sang /login
router.get('/', (req, res) => {
  res.redirect('/login');
});

router.get('/login', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

router.get('/chat', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'chat.html'));
});

module.exports = router;
