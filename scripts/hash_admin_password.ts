#!/usr/bin/env node
import crypto from 'node:crypto';

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, KEY_LEN, SCRYPT_PARAMS);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

const inputPassword = process.argv[2];

if (!inputPassword) {
  console.error('Usage: npx tsx scripts/hash_admin_password.ts <your_plain_password>');
  console.error('Example: npx tsx scripts/hash_admin_password.ts MySuperSecretAdminPass123!');
  process.exit(1);
}

if (inputPassword.length < 8) {
  console.warn('⚠️ Warning: Admin password should be at least 8 characters long for strong security.');
}

const hashed = hashPassword(inputPassword);
console.log('\n======================================================');
console.log('✅ Generated Secure Admin Password Hash (scrypt):');
console.log('------------------------------------------------------');
console.log(hashed);
console.log('------------------------------------------------------');
console.log('Add the following to your environment variables on Render / .env:');
console.log(`ADMIN_PASSWORD_HASH="${hashed}"`);
console.log('======================================================\n');
