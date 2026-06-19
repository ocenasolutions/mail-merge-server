const chunkBase64 = (value) => value.match(/.{1,76}/g)?.join('\r\n') || '';

const appendMimePartHeader = (lines, boundary, headers, body) => {
  lines.push(`--${boundary}`);
  headers.forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      lines.push(`${key}: ${value}`);
    }
  });
  lines.push('');
  if (body !== undefined) {
    lines.push(body || '');
  }
};

const appendMultipartAlternative = (lines, boundary, textBody, htmlBody) => {
  appendMimePartHeader(lines, boundary, [
    ['Content-Type', 'text/plain; charset=utf-8'],
    ['Content-Transfer-Encoding', '7bit']
  ], textBody);
  appendMimePartHeader(lines, boundary, [
    ['Content-Type', 'text/html; charset=utf-8'],
    ['Content-Transfer-Encoding', '7bit']
  ], htmlBody);
  lines.push(`--${boundary}--`);
};

const appendAttachmentPart = (lines, boundary, attachment) => {
  const disposition = attachment.disposition || (attachment.cid ? 'inline' : 'attachment');
  appendMimePartHeader(lines, boundary, [
    ['Content-Type', `${attachment.contentType}; name="${attachment.filename}"`],
    ...(attachment.cid ? [['Content-ID', `<${attachment.cid}>`]] : []),
    ['Content-Disposition', `${disposition}; filename="${attachment.filename}"`],
    ['Content-Transfer-Encoding', 'base64']
  ], chunkBase64(Buffer.from(attachment.content).toString('base64')));
};

const buildRawMimeMessage = ({ from, to, subject, textBody, htmlBody, trackingId, cc, bcc, attachments = [] }) => {
  const mixedBoundary = `emaildrop_mixed_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const relatedBoundary = `emaildrop_related_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const alternativeBoundary = `emaildrop_alternative_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const inlineAttachments = attachments.filter((attachment) => attachment.cid);
  const regularAttachments = attachments.filter((attachment) => !attachment.cid);
  const hasInlineAttachments = inlineAttachments.length > 0;
  const hasRegularAttachments = regularAttachments.length > 0;
  const outerBoundary = hasRegularAttachments ? mixedBoundary : hasInlineAttachments ? relatedBoundary : alternativeBoundary;
  const outerType = hasRegularAttachments ? 'multipart/mixed' : hasInlineAttachments ? 'multipart/related' : 'multipart/alternative';
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: ${outerType}; boundary="${outerBoundary}"`
  ];

  if (trackingId) lines.push(`X-Entity-Ref-ID: ${trackingId}`);
  if (cc) lines.push(`Cc: ${cc}`);
  if (bcc) lines.push(`Bcc: ${bcc}`);

  lines.push('');

  if (hasRegularAttachments) {
    if (hasInlineAttachments) {
      appendMimePartHeader(lines, mixedBoundary, [
        ['Content-Type', `multipart/related; boundary="${relatedBoundary}"`]
      ]);
      appendMimePartHeader(lines, relatedBoundary, [
        ['Content-Type', `multipart/alternative; boundary="${alternativeBoundary}"`]
      ]);
      appendMultipartAlternative(lines, alternativeBoundary, textBody, htmlBody);
      inlineAttachments.forEach((attachment) => appendAttachmentPart(lines, relatedBoundary, attachment));
      lines.push(`--${relatedBoundary}--`);
    } else {
      appendMimePartHeader(lines, mixedBoundary, [
        ['Content-Type', `multipart/alternative; boundary="${alternativeBoundary}"`]
      ]);
      appendMultipartAlternative(lines, alternativeBoundary, textBody, htmlBody);
    }

    regularAttachments.forEach((attachment) => appendAttachmentPart(lines, mixedBoundary, attachment));
    lines.push(`--${mixedBoundary}--`);
  } else if (hasInlineAttachments) {
    appendMimePartHeader(lines, relatedBoundary, [
      ['Content-Type', `multipart/alternative; boundary="${alternativeBoundary}"`]
    ]);
    appendMultipartAlternative(lines, alternativeBoundary, textBody, htmlBody);
    inlineAttachments.forEach((attachment) => appendAttachmentPart(lines, relatedBoundary, attachment));
    lines.push(`--${relatedBoundary}--`);
  } else {
    appendMultipartAlternative(lines, alternativeBoundary, textBody, htmlBody);
  }

  lines.push('');

  return Buffer.from(lines.join('\r\n'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
};

module.exports = {
  buildRawMimeMessage
};
