const Campaign = require('../models/Campaign');
const Recipient = require('../models/Recipient');
const EmailConfig = require('../models/EmailConfig');
const User = require('../models/User');
const { listMessages, supportsMailbox } = require('./mailboxService');
const { mergeTags } = require('./emailService');
const logger = require('../utils/logger');

const MAX_MESSAGES_PER_ACCOUNT = 250;

const normalizeEmailAddress = (value = '') => {
  const match = String(value).match(/<([^>]+)>/);
  return (match ? match[1] : String(value)).trim().toLowerCase();
};

const normalizeSubject = (value = '') => String(value)
  .replace(/^(\s*(re|fw|fwd)\s*:\s*)+/i, '')
  .replace(/\[[^\]]+\]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

const subjectsMatch = (left, right) => {
  const a = normalizeSubject(left);
  const b = normalizeSubject(right);

  if (!a || !b) {
    return false;
  }

  return a === b || a.includes(b) || b.includes(a);
};

const buildMailboxConfigs = (user, configs) => {
  const mailboxConfigs = [];
  const seenEmails = new Set();

  if (user?.googleAccessToken && user?.email) {
    const primaryEmail = user.email.toLowerCase();
    seenEmails.add(primaryEmail);
    mailboxConfigs.push({
      _id: 'primary-gmail',
      provider: 'gmail',
      config: {
        email: user.email
      },
      email: user.email
    });
  }

  for (const config of configs) {
    if (!supportsMailbox(config)) {
      continue;
    }

    const accountEmail = (config.config?.email || config.email || '').toLowerCase();
    if (accountEmail && seenEmails.has(accountEmail)) {
      continue;
    }

    if (accountEmail) {
      seenEmails.add(accountEmail);
    }

    mailboxConfigs.push(config);
  }

  return mailboxConfigs;
};

const loadInboxMessagesForUser = async (user, configs) => {
  const mailboxConfigs = buildMailboxConfigs(user, configs);

  const results = await Promise.allSettled(
    mailboxConfigs.map(async (config) => {
      const result = await listMessages(config, user, {
        folder: 'inbox',
        limit: MAX_MESSAGES_PER_ACCOUNT,
        offset: 0
      });

      return result.messages.map((message) => ({
        senderEmail: normalizeEmailAddress(message.from?.[0]?.address || ''),
        subject: message.subject || '',
        date: message.date ? new Date(message.date) : null,
        accountEmail: config.config?.email || config.email || user.email || ''
      })).filter((message) => message.senderEmail && message.date);
    })
  );

  const messages = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      messages.push(...result.value);
    } else {
      logger.warn({ err: result.reason }, 'Reply tracking inbox fetch failed for one account');
    }
  }

  return messages;
};

const buildExpectedSubject = (campaign, recipient) => {
  if (recipient.sentSubject) {
    return recipient.sentSubject;
  }

  const mergeData = recipient.mergeData instanceof Map
    ? Object.fromEntries(recipient.mergeData)
    : (recipient.mergeData || {});

  return mergeTags(campaign.subject, mergeData);
};

const syncUserReplyStats = async (userId) => {
  const user = await User.findById(userId);
  if (!user) {
    return null;
  }

  const campaigns = await Campaign.find({ userId }).select('_id subject stats');
  if (!campaigns.length) {
    return {
      totalReplies: 0,
      campaignReplyCounts: new Map()
    };
  }

  const campaignMap = new Map(campaigns.map((campaign) => [String(campaign._id), campaign]));
  const recipients = await Recipient.find({
    campaignId: { $in: campaigns.map((campaign) => campaign._id) },
    status: 'sent',
    sentAt: { $ne: null }
  });

  if (!recipients.length) {
    await Campaign.updateMany(
      { userId, 'stats.replied': { $ne: 0 } },
      { $set: { 'stats.replied': 0 } }
    );

    return {
      totalReplies: 0,
      campaignReplyCounts: new Map()
    };
  }

  const configs = await EmailConfig.find({ userId });
  const inboxMessages = await loadInboxMessagesForUser(user, configs);
  const messagesBySender = new Map();

  for (const message of inboxMessages) {
    const existing = messagesBySender.get(message.senderEmail) || [];
    existing.push(message);
    messagesBySender.set(message.senderEmail, existing);
  }

  const recipientUpdates = [];
  const campaignReplyCounts = new Map();

  for (const recipient of recipients) {
    const campaign = campaignMap.get(String(recipient.campaignId));
    if (!campaign) {
      continue;
    }

    const candidateMessages = messagesBySender.get(String(recipient.email).toLowerCase()) || [];
    const expectedSubject = buildExpectedSubject(campaign, recipient);
    const sentAt = recipient.sentAt ? new Date(recipient.sentAt) : null;

    const matches = candidateMessages.filter((message) => {
      if (!message.date || !sentAt) {
        return false;
      }

      if (message.date.getTime() < sentAt.getTime()) {
        return false;
      }

      return subjectsMatch(message.subject, expectedSubject);
    }).sort((a, b) => a.date.getTime() - b.date.getTime());

    const existingReplyCount = recipient.replyCount || 0;
    const nextReplyCount = Math.max(existingReplyCount, matches.length);
    const firstReplyAt = recipient.repliedAt || (matches[0] ? matches[0].date : null);

    if (nextReplyCount !== existingReplyCount || (firstReplyAt && !recipient.repliedAt)) {
      recipientUpdates.push({
        updateOne: {
          filter: { _id: recipient._id },
          update: {
            $set: {
              replyCount: nextReplyCount,
              repliedAt: firstReplyAt || null
            }
          }
        }
      });
    }

    if (nextReplyCount > 0) {
      const key = String(recipient.campaignId);
      campaignReplyCounts.set(key, (campaignReplyCounts.get(key) || 0) + 1);
    }
  }

  if (recipientUpdates.length) {
    await Recipient.bulkWrite(recipientUpdates);
  }

  const campaignUpdates = campaigns
    .map((campaign) => {
      const replyCount = campaignReplyCounts.get(String(campaign._id)) || 0;
      return {
        campaignId: campaign._id,
        currentReplyCount: campaign.stats?.replied || 0,
        replyCount
      };
    })
    .filter((item) => item.currentReplyCount !== item.replyCount)
    .map((item) => ({
      updateOne: {
        filter: { _id: item.campaignId },
        update: { $set: { 'stats.replied': item.replyCount } }
      }
    }));

  if (campaignUpdates.length) {
    await Campaign.bulkWrite(campaignUpdates);
  }

  return {
    totalReplies: Array.from(campaignReplyCounts.values()).reduce((sum, count) => sum + count, 0),
    campaignReplyCounts
  };
};

module.exports = {
  normalizeEmailAddress,
  normalizeSubject,
  subjectsMatch,
  syncUserReplyStats
};
