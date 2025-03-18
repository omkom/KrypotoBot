// save as check-key.js
import { Keypair } from '@solana/web3.js';
import dotenv from 'dotenv';
import fs from 'fs';

// Load environment variables
dotenv.config();

// Get the private key from env
const privateKeyBase64 = process.env.SOLANA_PRIVATE_KEY_PROD;

if (!privateKeyBase64) {
  console.error('Error: SOLANA_PRIVATE_KEY_PROD not found in .env file');
  process.exit(1);
}

console.log('Key length (encoded):', privateKeyBase64.length);

try {
  // Try to decode from base64
  const privateKeyBytes = Buffer.from(privateKeyBase64, 'base64');
  console.log('Decoded byte length:', privateKeyBytes.length);
  
  // Solana requires exactly 64 bytes for a private key
  if (privateKeyBytes.length !== 64) {
    console.error(`Error: Decoded key is ${privateKeyBytes.length} bytes. It should be 64 bytes.`);
    process.exit(1);
  }
  
  // Try to create a keypair
  const keypair = Keypair.fromSecretKey(privateKeyBytes);
  console.log('Success! Public key:', keypair.publicKey.toString());
} catch (error) {
  console.error('Error processing the key:', error.message);
  
  // Additional diagnostics
  console.log('\nKey might be in wrong format. Here are some suggestions:');
  console.log('1. If your key starts with [1,2,3,...], it\'s a JSON array and needs to be converted to Base64.');
  console.log('2. If your key looks like XYZ123... (no spaces or brackets), it might be Base58 encoded.');
}