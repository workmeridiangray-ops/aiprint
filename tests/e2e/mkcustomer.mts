// Creates a throwaway verified customer in the dev DB: npx tsx tests/e2e/mkcustomer.mts <email> <password> <tenantId>
import { createUser } from '../../src/server/auth';
await createUser(process.argv[2], process.argv[3], process.argv[4], 'customer'); process.exit(0);
