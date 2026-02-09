/**
 * Authentication Service
 * Handles Telegram Login, JWT tokens, QR sessions
 */

import { SignJWT, jwtVerify } from 'jose';

const JWT_EXPIRY_DAYS = 30;
const QR_SESSION_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

interface TelegramLoginData {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

interface JWTPayload {
  user_id: string;
  display_name: string;
  telegram_id: number;
  device_id?: string;
  device_name?: string;
  device_type?: string;
  iat: number;
  exp: number;
}

/**
 * Hash string using SHA-256 (Web Crypto API)
 */
async function sha256(message: string): Promise<ArrayBuffer> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return hashBuffer;
}

/**
 * Convert ArrayBuffer to hex string
 */
function arrayBufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * HMAC-SHA256 using Web Crypto API
 */
async function hmacSha256(key: ArrayBuffer, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const msgBuffer = new TextEncoder().encode(message);
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, msgBuffer);
  return arrayBufferToHex(signature);
}

/**
 * Verify Telegram Login Widget data
 * https://core.telegram.org/widgets/login#checking-authorization
 */
export async function verifyTelegramLogin(
  data: TelegramLoginData,
  botToken: string
): Promise<boolean> {
  const { hash, ...userData } = data;
  
  // Create data-check-string
  const dataCheckString = Object.keys(userData)
    .sort()
    .map(key => `${key}=${userData[key as keyof typeof userData]}`)
    .join('\n');

  // Create secret key from bot token (SHA-256 of bot token)
  const secretKey = await sha256(botToken);
  
  // Calculate HMAC-SHA256
  const calculatedHash = await hmacSha256(secretKey, dataCheckString);

  // Compare hashes
  if (calculatedHash !== hash) {
    return false;
  }

  // Check auth_date (should be within 5 minutes)
  const authDate = data.auth_date * 1000; // Convert to milliseconds
  const now = Date.now();
  const fiveMinutes = 5 * 60 * 1000;

  if (now - authDate > fiveMinutes) {
    return false; // Too old
  }

  return true;
}

/**
 * Create JWT token
 */
export async function createJWT(
  secret: string,
  payload: {
    user_id: string;
    display_name: string;
    telegram_id: number;
    device_id?: string;
    device_name?: string;
    device_type?: string;
  }
): Promise<string> {
  const secretKey = new TextEncoder().encode(secret);
  
  const jwt = await new SignJWT({
    user_id: payload.user_id,
    display_name: payload.display_name,
    telegram_id: payload.telegram_id,
    device_id: payload.device_id,
    device_name: payload.device_name,
    device_type: payload.device_type,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${JWT_EXPIRY_DAYS}d`)
    .sign(secretKey);

  return jwt;
}

/**
 * Verify JWT token
 */
export async function verifyJWT(
  token: string,
  secret: string
): Promise<JWTPayload> {
  const secretKey = new TextEncoder().encode(secret);
  
  const { payload } = await jwtVerify(token, secretKey, {
    algorithms: ['HS256'],
  });

  return payload as JWTPayload;
}

/**
 * Generate QR session ID
 */
export function generateQRSessionId(): string {
  return `qr_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Hash JWT for storage (to invalidate tokens)
 */
export async function hashJWT(token: string): Promise<string> {
  const hash = await sha256(token);
  return arrayBufferToHex(hash);
}

/**
 * Check if QR session is expired
 */
export function isQRSessionExpired(createdAt: number): boolean {
  return Date.now() - createdAt > QR_SESSION_EXPIRY_MS;
}
