/**
 * Shared Response Utility
 * Handles CORS and JSON formatting
 */

/**
 * Creates a JSON response with proper CORS headers
 * @param {object} data 
 * @param {number} status 
 * @param {Request} request 
 * @param {object} env 
 * @returns {Response}
 */
export function json(data, status = 200, request = null, env = {}) {
  const headers = {
    'Content-Type': 'application/json',
  };

  // CORS Logic
  if (request) {
    const origin = request.headers.get('Origin');
    
    // Whitelist: Allow localhost in dev, or env.FRONTEND_URL
    if (origin) {
      const isLocal = origin.includes('localhost') || origin.includes('127.0.0.1');
      const isAllowed = env.FRONTEND_URL && origin === env.FRONTEND_URL;
      
      if (isLocal || isAllowed || !env.FRONTEND_URL) {
        headers['Access-Control-Allow-Origin'] = origin;
      } else {
        headers['Access-Control-Allow-Origin'] = env.FRONTEND_URL;
      }
    } else {
      headers['Access-Control-Allow-Origin'] = env.FRONTEND_URL || '*';
    }
    
    headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, apikey';
    headers['Access-Control-Allow-Credentials'] = 'true';
  } else {
    headers['Access-Control-Allow-Origin'] = env.FRONTEND_URL || '*';
  }

  console.log(`[response] Generated headers for ${status}:`, JSON.stringify(headers));
  
  const body = status === 204 ? null : JSON.stringify(data);
  return new Response(body, { status, headers });
}
