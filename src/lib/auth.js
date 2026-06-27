const jwt = require('jsonwebtoken');
const cookie = require('cookie');

function verifyToken(event) {
  let token = null;

  // Tentar pegar do Cookie
  if (event.headers.cookie) {
    const cookies = cookie.parse(event.headers.cookie);
    token = cookies.token;
  }

  // Se não tiver no cookie, tentar pegar do Header Authorization
  if (!token && event.headers.authorization) {
    const authHeader = event.headers.authorization;
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }
  }

  if (!token) {
    return null;
  }

  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return null;
  }
}

function checkPermission(user, allowedRoles) {
  if (!user) return false;
  if (user.role === 'Admin') return true; // Admin sempre tem acesso
  return allowedRoles.includes(user.role);
}

module.exports = { verifyToken, checkPermission };
