// Run against a RESTORED environment: signs in with the original password and downloads an output. Prints sha256 of the bytes.
import { createHash } from 'node:crypto';
import { login, resolveActor } from '../src/server/auth';
import { readOutput } from '../src/server/worker';
const [email, password, tenantId, outputId] = process.argv.slice(2);
const { token } = await login(email, password); const actor = await resolveActor(token!, tenantId);
const { buf } = await readOutput(actor, outputId);
console.log(createHash('sha256').update(buf).digest('hex')); process.exit(0);
