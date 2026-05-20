const Campaign = require('../models/Campaign');
const Recipient = require('../models/Recipient');
const EmailConfig = require('../models/EmailConfig');
const User = require('../models/User');
const { listMessages, getMessageDetail, supportsMailbox } = require('./mailboxService');
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

const stripHtml = (value = '') => String(value)
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<\/?[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/\s+/g, ' ')
  .trim();

const cleanReplySnippet = (value = '') => {
  const normalized = stripHtml(value)
    .replace(/&#x202f;|&#8239;|&nbsp;/gi, ' ')
    .replace(/\s*On .*?wrote:\s*/i, ' ')
    .replace(/\s*>+\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return '';
  }

  const cutMarkers = [
    /\s+on\s.+?wrote:/i,
    /\s+from:\s/i,
    /\s+sent:\s/i,
    /\s+subject:\s/i
  ];

  let snippet = normalized;
  for (const marker of cutMarkers) {
    snippet = snippet.split(marker)[0].trim();
  }

  return snippet || normalized;
};

const scoreReplyText = (text = '') => {
  const normalized = String(text).toLowerCase();

  const positiveSignals = [
    { pattern: /\b(interested|sounds good|looks good|let's talk|lets talk|book a call|schedule|demo|pricing|price|quote|proposal|next week|available|yes)\b/i, score: 35, reason: 'Strong buying intent detected' },
    { pattern: /\b(send details|share details|more information|tell me more|brochure|deck|case study)\b/i, score: 20, reason: 'Asked for more details' },
    { pattern: /\b(call me|phone|zoom|meet|meeting)\b/i, score: 25, reason: 'Conversation intent detected' }
  ];

  const negativeSignals = [
    { pattern: /\b(not interested|no thanks|remove me|unsubscribe|stop emailing|wrong person)\b/i, score: -60, reason: 'Negative reply detected' },
    { pattern: /\b(not now|later|busy right now|circle back)\b/i, score: -10, reason: 'Delayed interest detected' }
  ];

  let score = 0;
  let reason = 'Reply detected';

  for (const signal of positiveSignals) {
    if (signal.pattern.test(normalized)) {
      score += signal.score;
      reason = signal.reason;
    }
  }

  for (const signal of negativeSignals) {
    if (signal.pattern.test(normalized)) {
      score += signal.score;
      reason = signal.reason;
    }
  }

  let status = 'cold';
  if (score >= 45) status = 'hot';
  else if (score >= 15) status = 'warm';
  else if (score <= -30) status = 'not_interested';
  else if (score <= 0) status = 'cold';

  return {
    score,
    status,
    reason
  };
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

    // Configured Gmail accounts are not mailbox-sync capable here because
    // the app only stores OAuth tokens for the signed-in primary Google user.
    if (config.provider === 'gmail') {
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
        uid: message.uid,
        senderEmail: normalizeEmailAddress(message.from?.[0]?.address || ''),
        subject: message.subject || '',
        date: message.date ? new Date(message.date) : null,
        accountEmail: config.config?.email || config.email || user.email || '',
        mailboxConfig: config
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
    const latestMatch = matches[matches.length - 1];
    let latestReplySnippet = recipient.latestReplySnippet || '';
    let leadStatus = recipient.leadStatus || 'unknown';
    let leadScore = recipient.leadScore || 0;
    let leadReason = recipient.leadReason || '';

    if (latestMatch && (nextReplyCount !== existingReplyCount || !recipient.latestReplySnippet)) {
      try {
        const detail = await getMessageDetail(latestMatch.mailboxConfig, user, {
          folder: 'inbox',
          uid: latestMatch.uid
        });
        const rawReplyText = stripHtml(detail?.text || detail?.html || latestMatch.subject || '');
        latestReplySnippet = cleanReplySnippet(detail?.text || detail?.html || rawReplyText).slice(0, 280);
        const classification = scoreReplyText(rawReplyText);
        leadStatus = classification.status;
        leadScore = classification.score;
        leadReason = classification.reason;
      } catch (error) {
        logger.warn({ err: error, recipientId: recipient._id, uid: latestMatch.uid }, 'Could not fetch reply detail for lead scoring');
      }
    }

    if (
      nextReplyCount !== existingReplyCount
      || (firstReplyAt && !recipient.repliedAt)
      || latestReplySnippet !== (recipient.latestReplySnippet || '')
      || leadStatus !== (recipient.leadStatus || 'unknown')
      || leadScore !== (recipient.leadScore || 0)
      || leadReason !== (recipient.leadReason || '')
    ) {
      recipientUpdates.push({
        updateOne: {
          filter: { _id: recipient._id },
          update: {
            $set: {
              replyCount: nextReplyCount,
              repliedAt: firstReplyAt || null,
              latestReplySnippet,
              leadStatus,
              leadScore,
              leadReason
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
  scoreReplyText,
  syncUserReplyStats
};
