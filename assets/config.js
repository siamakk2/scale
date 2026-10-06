// Client-side Supabase config.
//
// The publishable key is designed to be public: it carries no privileges of
// its own and every table is behind RLS, so what it reaches is exactly what
// the signed-in user owns. The SERVICE ROLE key is a different animal and
// never appears here -- it lives only in Vercel's environment, read by
// api/scan.js on the server.
window.SCALE_CONFIG = {
  supabaseUrl: 'https://jbsofdayfdqaccntmlxa.supabase.co',
  supabaseKey: 'sb_publishable_d0GlM48sk-0xJvxLD-PQ2Q_NaDryCuH',
};
