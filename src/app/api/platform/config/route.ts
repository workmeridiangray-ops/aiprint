import { handler } from '@/server/http';
import * as A from '@/server/platformadmin';
export const runtime = 'nodejs';
export const GET = handler(async (_r, { actor }) => A.configStatus(actor));
export const POST = handler(async (_r, { actor }) => A.sendTestEmail(actor));
