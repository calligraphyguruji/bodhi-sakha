import { initDb } from '../server/endpoints/lib/db.js';
try { await initDb(); console.log('Database schema is ready.'); }
catch { console.error('Database migration failed. Check DATABASE_URL and database permissions.'); process.exitCode=1; }
