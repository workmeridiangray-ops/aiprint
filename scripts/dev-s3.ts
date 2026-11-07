// A local S3-compatible server for development only (data in .data/dev-s3). Point the app at it with the S3_* values in .env.example.
import S3rver from 's3rver';
const port = Number(process.env.DEV_S3_PORT ?? 4572);
const s = new S3rver({ port, address: '127.0.0.1', silent: true, directory: './.data/dev-s3', configureBuckets: [{ name: process.env.S3_BUCKET ?? 'artwork-dev', configs: [] }] });
await s.run(); console.log(`dev S3 on http://127.0.0.1:${port} (bucket ${process.env.S3_BUCKET ?? 'artwork-dev'}, key S3RVER/S3RVER)`);
process.on('SIGINT', async () => { await s.close(); process.exit(0); });
