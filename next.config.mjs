import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
export default {
  poweredByHeader: false,
  serverExternalPackages: ['sharp', 'pg'],
  webpack(config) { config.resolve.alias['@'] = path.join(here, 'src'); return config; },
};
