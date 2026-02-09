/**
 * Authentication Middleware
 * Protects routes that require authentication
 */

import { Context, Next } from 'hono';
import { verifyJWT } from '../services/auth';

type Env = {
  JWT_SECRET: string;
};

export interface AuthContext {
  user_id: string;
  display_name: string;
  telegram_id: number;
  device_id?: string;
  device_name?: string;
  device_type?: string;
}

/**
 * Extract JWT from Authorization header or query parameter
 */
function extractToken(header: string | undefined, queryToken?: string): string | null {
  // Check query parameter first (for stream/download URLs)
  if (queryToken) {
    return queryToken;
  }
  
  // Then check Authorization header
  if (!header) return null;
  
  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }
  
  return parts[1];
}

/**
 * Auth middleware - verifies JWT and adds user context
 */
export async function authMiddleware(
  c: Context<{ Bindings: Env }>,
  next: Next
) {
  const authHeader = c.req.header('Authorization');
  const queryToken = c.req.query('token');
  const token = extractToken(authHeader, queryToken);

  if (!token) {
    return c.json({ error: 'Unauthorized - No token provided' }, 401);
  }

  try {
    const payload = await verifyJWT(token, c.env.JWT_SECRET);
    
    // Add user context to request
    c.set('user', {
      user_id: payload.user_id,
      display_name: payload.display_name,
      telegram_id: payload.telegram_id,
      device_id: payload.device_id,
      device_name: payload.device_name,
      device_type: payload.device_type,
    } as AuthContext);

    await next();
  } catch (error) {
    return c.json({ 
      error: 'Unauthorized - Invalid token',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 401);
  }
}

/**
 * Optional auth middleware - adds user context if token present, but doesn't require it
 */
export async function optionalAuthMiddleware(
  c: Context<{ Bindings: Env }>,
  next: Next
) {
  const authHeader = c.req.header('Authorization');
  const queryToken = c.req.query('token');
  const token = extractToken(authHeader, queryToken);

  if (token) {
    try {
      const payload = await verifyJWT(token, c.env.JWT_SECRET);
      c.set('user', {
        user_id: payload.user_id,
        display_name: payload.display_name,
        telegram_id: payload.telegram_id,
        device_id: payload.device_id,
        device_name: payload.device_name,
        device_type: payload.device_type,
      } as AuthContext);
    } catch (error) {
      // Ignore invalid tokens in optional auth
    }
  }

  await next();
}
