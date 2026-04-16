const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';
// Handle both hex strings (64 chars) and regular strings (32 chars)
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY 
  ? (process.env.ENCRYPTION_KEY.length === 64 
      ? Buffer.from(process.env.ENCRYPTION_KEY, 'hex')
      : Buffer.from(process.env.ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32), 'utf8'))
  : Buffer.alloc(32); // Fallback for development
const IV_LENGTH = 16;

const encrypt = (text) => {
  if (!text) return null;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
};

const decrypt = (text) => {
  if (!text) return null;
  const parts = text.split(':');
  const iv = Buffer.from(parts.shift(), 'hex');
  const encryptedText = parts.join(':');
  const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
};

module.exports = { encrypt, decrypt };
