"https://lnbpgnilxaaodowbetgg.supabase.co" | npx wrangler secret put SUPABASE_URL
"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxuYnBnbmlseGFhb2Rvd2JldGdnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzIzNjQwMywiZXhwIjoyMDkyODEyNDAzfQ.8R2-k2AnmV3HxVVg7Z1HG572IGbbkfhT1iy96qU_XZQ" | npx wrangler secret put SUPABASE_SERVICE_KEY
"005ddb9668a38680000000001" | npx wrangler secret put B2_KEY_ID
"K005wT9Vy+6fTmYmoQxrQYMxqkhZRAQ" | npx wrangler secret put B2_APP_KEY
"2d0d6b69e696c8ca93d80618" | npx wrangler secret put B2_BUCKET_ID
"kymacache" | npx wrangler secret put B2_BUCKET_NAME
"sk-kCOj6S5BJfEY67aR8QMtOKk8geIOVbjexzWn2MyaYmj694yt" | npx wrangler secret put KIMI_API_KEY
"https://kymacache-worker.ahmad-kymacache.workers.dev" | npx wrangler secret put WORKER_SELF_URL

npx wrangler secret delete "K005wT9Vy+6fTmYmoQxrQYMxqkhZRAQ"
npx wrangler secret delete "2d0d6b69e696c8ca93d80618"
npx wrangler secret delete "kymacache"
npx wrangler secret delete "sk-kCOj6S5BJfEY67aR8QMtOKk8geIOVbjexzWn2MyaYmj694yt"
npx wrangler secret delete "https://kymacache-worker.ahmad-kymacache.workers.dev"
