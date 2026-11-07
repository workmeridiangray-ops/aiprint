// Go-live check for object storage: writes, reads back, compares and deletes a probe object using the configured driver.
import { checkStorage } from '../src/server/storage';
try { const r = await checkStorage(); console.log(`storage OK (driver: ${r.driver})`); process.exit(0); }
catch (e: any) { console.error('storage check FAILED:', e.message); process.exit(1); }
