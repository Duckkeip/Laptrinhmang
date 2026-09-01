const { AI_SERVICE_URL } = require('../config/env');

// Nhan biet lenh goi AI: "/ai <cau hoi>" hoac chua "@AI <cau hoi>" o bat ky dau trong tin nhan
function extractAIPrompt(text) {
  const trimmed = text.trim();
  if (trimmed.toLowerCase().startsWith('/ai ')) {
    return trimmed.slice(4).trim();
  }
  const mentionMatch = trimmed.match(/@AI\b[:,]?\s*(.*)/i);
  if (mentionMatch) {
    return (mentionMatch[1] || '').trim() || trimmed.replace(/@AI\b[:,]?/i, '').trim();
  }
  return null;
}

// Goi service inference (model da finetune) va tra ve cau tra loi dang text
async function askAIBot(prompt, room, username) {
  const res = await fetch(`${AI_SERVICE_URL}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, room, username })
  });
  if (!res.ok) throw new Error(`AI service tra ve loi ${res.status}`);
  const data = await res.json();
  return data.reply || 'Xin loi, minh chua nghi ra cau tra loi.';
}

module.exports = { extractAIPrompt, askAIBot };
