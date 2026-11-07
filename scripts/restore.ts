// Usage: DATABASE_URL=<EMPTY target db> STORAGE_...=<target storage> npx tsx scripts/restore.ts <backup-directory> [--keep-sessions]
import { restore } from './lib/backup';
const dir = process.argv[2]; if (!dir) { console.error('usage: restore.ts <backup-directory>'); process.exit(2); }
try {
  const r = await restore(dir, { keepSessions: process.argv.includes('--keep-sessions') });
  console.log(`restore finished: ${r.filesChecked} files checked. ${r.problems.length ? 'PROBLEMS:\n' + r.problems.join('\n') : 'consistent with the backup manifest.'} ${r.note}`);
  process.exit(r.problems.length ? 3 : 0);
} catch (e: any) { console.error('restore FAILED:', e.message); process.exit(1); }
