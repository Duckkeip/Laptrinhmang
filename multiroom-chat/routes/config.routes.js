const express = require('express');
const router = express.Router();
const { MAX_FILE_SIZE_MB } = require('../config/env');

// Cho client biet cac gioi han hien hanh (vd dung luong file toi da), tranh
// phai go cung 1 con so o ca server lan client de gay lech nhau ve sau.
router.get('/api/config', (req, res) => {
  res.json({ maxFileSizeMB: MAX_FILE_SIZE_MB });
});

module.exports = router;
