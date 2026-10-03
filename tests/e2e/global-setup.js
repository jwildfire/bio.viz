import { execSync } from 'node:child_process';

// Builds the site once, before any browser test. Several spec files open pages
// under _site/, and they run in parallel: a build inside each would have one
// spec deleting the folder another is reading.
export default function globalSetup() {
  execSync('npm run site', { stdio: 'inherit', cwd: new URL('../..', import.meta.url) });
}
