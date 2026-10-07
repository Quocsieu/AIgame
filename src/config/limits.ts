import dotenv from 'dotenv';
dotenv.config();

export const LIMITS = {
  MAX_URLS_PER_REQUEST: parseInt(process.env.MAX_URLS_PER_REQUEST || '5', 10),
  MAX_WEBSITE_RESPONSE_BYTES: parseInt(process.env.MAX_WEBSITE_RESPONSE_BYTES || '2097152', 10), // 2 MB
  MAX_FILE_BYTES: parseInt(process.env.MAX_FILE_BYTES || '10485760', 10), // 10 MB
  MAX_EXTRACTED_TEXT_LENGTH: parseInt(process.env.MAX_EXTRACTED_TEXT_LENGTH || '100000', 10), // 100,000 characters
  HTTP_REQUEST_TIMEOUT_MS: parseInt(process.env.HTTP_REQUEST_TIMEOUT_MS || '10000', 10), // 10 seconds
  AI_GENERATION_TIMEOUT_MS: parseInt(process.env.AI_GENERATION_TIMEOUT_MS || '60000', 10),
  MAX_FILES_PER_REQUEST: 5,
};

