const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/env');

// Xac thuc JWT tu header "Authorization: Bearer <token>"
function verifyAuthHeader(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  try {
    return jwt.verify(token, JWT_SECRET); // { id, username, iat, exp }
  } catch (err) {
    return null;
  }
}

function requireAuth(req, res, next) {
  const decoded = verifyAuthHeader(req);
  if (!decoded) return res.status(401).json({ error: 'Chua dang nhap hoac phien da het han' });
  req.user = decoded;
  next();
}

module.exports = { verifyAuthHeader, requireAuth };
