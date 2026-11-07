import { handler } from '@/server/http';
import * as V from '@/server/vendor';
export const runtime = 'nodejs';
export const GET = handler(async (_r, { params }) => { const p = await V.getPortal(params.slug); return { displayName: p.displayName, primaryColour: p.primaryColour }; }, { public: true });
