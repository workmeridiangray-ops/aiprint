// Usage: DATABASE_URL=... STORAGE_...=... npx tsx scripts/backup.ts <new-empty-directory>
import { backup } from './lib/backup';
const dir = process.argv[2]; if (!dir) { console.error('usage: backup.ts <directory>'); process.exit(2); }
try { const m = await backup(dir); console.log(`backup OK: ${m.files.length} files, ${m.missingAtBackup.length} missing at backup time`); if (m.missingAtBackup.length) { console.error('MISSING:', m.missingAtBackup.join(', ')); process.exit(3); } }
catch (e: any) { console.error('backup FAILED:', e.message); process.exit(1); }
