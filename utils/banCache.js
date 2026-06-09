// utils/banCache.js
// stub مؤقت — يمكن تطويره لاحقاً بـ Redis أو in-memory cache
const bannedIds = new Set();

module.exports = {
  add:    (userId) => bannedIds.add(userId.toString()),
  has:    (userId) => bannedIds.has(userId.toString()),
  delete: (userId) => bannedIds.delete(userId.toString()),
  clear:  ()       => bannedIds.clear(),
};