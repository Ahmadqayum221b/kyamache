/**
 * Authentication Utility for Cloudflare Workers
 * 
 * Instead of manual JWT verification (which requires the JWT secret),
 * we validate the token by calling Supabase's /auth/v1/user endpoint.
 * This is more robust as it works with both HS256 and ES256 tokens.
 */

/**
 * Extracts and verifies the user by calling Supabase Auth API
 * @param {Request} request 
 * @param {object} env 
 * @returns {Promise<object|null>} Verified user payload or null
 */
export async function getUser(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.split(' ')[1];
  
  if (!env.SUPABASE_URL) {
    console.error('[auth] SUPABASE_URL is not set in environment');
    return null;
  }

  try {
    // Call Supabase /auth/v1/user to verify the token
    const res = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey':        env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_KEY || ''
      }
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.warn(`[auth] Token verification failed for ${env.SUPABASE_URL}:`, res.status, errorText);
      return null;
    }

    const userData = await res.json();
    
    // Return a payload compatible with what the app expects
    // Usually contains 'id' (or 'sub'), 'email', etc.
    return {
      sub: userData.id,
      id:  userData.id,
      email: userData.email,
      ...userData
    };
  } catch (err) {
    console.error('[auth] Error verifying token with Supabase:', err);
    return null;
  }
}
