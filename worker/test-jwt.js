async function base64UrlToUint8Array(base64Url) {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  const padded = pad ? base64 + '='.repeat(4 - pad) : base64;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function verifyJwt(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return { error: 'invalid format' };
  const [headerB64, payloadB64, signatureB64] = parts;
  
  const encoder = new TextEncoder();
  const data = encoder.encode(`${headerB64}.${payloadB64}`);
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const signature = await base64UrlToUint8Array(signatureB64);
  const isValid = await crypto.subtle.verify('HMAC', key, signature, data);
  
  if (!isValid) return { error: 'signature mismatch' };
  
  const payload = JSON.parse(new TextDecoder().decode(await base64UrlToUint8Array(payloadB64)));
  return { payload };
}

const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxuYnBnbmlseGFhb2Rvd2JldGdnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMzY0MDMsImV4cCI6MjA5MjgxMjQwM30.poQH_5Rol_dcdKVLKUa6d__YpZhQ4V4KtNmu6vGFfh8";
const secret = "5IRfvp/YqOP1JAUAi3s4fluJ6UebjDPXLToAl93Zxit2dafba4nHZuBDMYTRwr1Kx4QwdOxsgSYtvmD8x83n1Q==";

verifyJwt(token, secret).then(console.log).catch(console.error);
