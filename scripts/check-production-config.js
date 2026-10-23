import { configurationIssues } from '../lib/server/configuration.js';
const issues = configurationIssues();
if (issues.length) {
  console.error(JSON.stringify({ event: 'configuration.invalid', issues }));
  process.exitCode = 1;
} else {
  console.log('Required environment values are present. This does not verify credentials, database schema, provider access, or the deployed environment.');
}
