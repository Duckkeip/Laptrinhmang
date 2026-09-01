const DirectMessage = require('../db/models/DirectMessage');

// Dam bao conversationId luon giong nhau du ai nhan tin truoc: sap xep 2 ten
// theo alphabet roi noi lai, vi du "alice::bob"
function getConversationId(userA, userB) {
  return [userA, userB].sort((a, b) => a.localeCompare(b)).join('::');
}

async function loadDMHistory(conversationId, limit = 50) {
  const docs = await DirectMessage.find({ conversationId })
    .sort({ time: -1 })
    .limit(limit)
    .lean();
  return docs.reverse();
}

module.exports = { getConversationId, loadDMHistory };
