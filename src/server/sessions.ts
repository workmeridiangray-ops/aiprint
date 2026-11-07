import { randomBytes, createHash } from 'node:crypto';
import { getPool } from './db';
export const sha = (t: string) => createHash('sha256').update(t).digest('hex');
export async function issueSession(userId: string, enrolOnly = false) {
  const token = randomBytes(32).toString('base64url'); const ttl = Number(process.env.SESSION_TTL_HOURS ?? 12);
  await getPool().query("insert into sessions(token_hash,user_id,expires_at,enrol_only) values($1,$2, now() + ($3 || ' hours')::interval,$4)", [sha(token), userId, String(ttl), enrolOnly]);
  await getPool().query("insert into audit_log(actor_user_id,action,object_type,outcome) values($1,'auth.session_issued','session',$2)", [userId, enrolOnly ? 'enrol_only' : 'ok']); // never the token or the email
  return token;
}
