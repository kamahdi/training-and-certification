// The TypeScript build emits only .js files. Copy what the compiled server reads at run time:
// the SQL migrations (server/db/migrate.ts) and the demo appointments file (server/seed.ts --demo).
import { cpSync } from 'node:fs';

cpSync('server/db/migrations', 'dist/server/server/db/migrations', { recursive: true });
cpSync('fixtures', 'dist/server/fixtures', { recursive: true });
console.log('copied migrations and fixtures into dist/server');
