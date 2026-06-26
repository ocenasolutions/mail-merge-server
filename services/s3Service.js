const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');
const logger = require('../utils/logger');

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

/**
 * Uploads a file to AWS S3 and returns its public URL
 * @param {Buffer} buffer 
 * @param {string} originalname 
 * @param {string} mimetype 
 * @returns {Promise<string>} S3 Object URL
 */
const uploadToS3 = async (buffer, originalname, mimetype) => {
  const fileExtension = originalname.split('.').pop() || '';
  const uniqueKey = `attachments/${crypto.randomUUID()}.${fileExtension}`;
  const bucketName = process.env.AWS_S3_BUCKET;

  const params = {
    Bucket: bucketName,
    Key: uniqueKey,
    Body: buffer,
    ContentType: mimetype,
    ACL: 'public-read'
  };

  logger.info({ bucket: bucketName, key: uniqueKey }, 'Uploading file to S3...');
  
  try {
    await s3Client.send(new PutObjectCommand(params));
  } catch (error) {
    // If the bucket has ACLs disabled (BucketOwnerEnforced), public-read ACL will fail.
    // Retry uploading without the ACL parameter.
    if (
      error.name === 'AccessControlListNotSupported' || 
      error.name === 'InvalidBucketOwner' || 
      error.message?.includes('ACL') ||
      error.code === 'AccessControlListNotSupported'
    ) {
      logger.warn({ error: error.message }, 'ACLs are disabled on S3 bucket. Retrying upload without ACL...');
      delete params.ACL;
      await s3Client.send(new PutObjectCommand(params));
    } else {
      throw error;
    }
  }
  
  const fileUrl = `https://${bucketName}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${uniqueKey}`;
  logger.info({ fileUrl }, 'S3 upload successful');
  return fileUrl;
};

module.exports = {
  uploadToS3,
  isConfigured: () => !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.AWS_S3_BUCKET)
};
