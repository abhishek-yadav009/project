const { User } = require('../models');
const { HttpError } = require('../utils/http');

async function requireAuth(req, _res, next) {
  const userId = req.session?.userId;
  if (!userId) throw new HttpError(401, 'Please log in');
  const user = await User.findById(userId).lean();
  if (!user) {
    req.session.destroy(() => {});
    throw new HttpError(401, 'Session is no longer valid; please log in again');
  }
  req.user = user;
  next();
}

const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user || !roles.includes(req.user.role)) throw new HttpError(403, `This action requires role: ${roles.join(' or ')}`);
  next();
};

module.exports = { requireAuth, requireRole };
