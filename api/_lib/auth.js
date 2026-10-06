'use strict';
// Resolve the signed-in user from the Authorization header. Uses Supabase's
// own token check rather than decoding the JWT ourselves.
const { createClient } = require('@supabase/supabase-js');

async function userFrom(req) {
  const h = req.headers && (req.headers.authorization || req.headers.Authorization);
  const token = h && /^Bearer\s+(.+)$/i.test(h) ? h.replace(/^Bearer\s+/i, '') : null;
  if (!token) return null;
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false } });
  const { data, error } = await sb.auth.getUser(token);
  return error || !data || !data.user ? null : data.user;
}

// Fixed, not taken from the Host header, so a spoofed header can't send
// someone's checkout return to another site.
const SITE = process.env.SITE_URL || 'https://scale.siamakconsulting.com';

module.exports = { userFrom, SITE };
