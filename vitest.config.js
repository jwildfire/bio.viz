import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// src/main.js reads its version from a build-time constant (see
// scripts/build-lib.mjs); unit tests importing the source get the same value.
const { version, bioviz } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
);

export default defineConfig({
  define: {
    __BIO_VIZ_VERSION__: JSON.stringify(version),
    __BIO_VIZ_DEVELOPMENT__: JSON.stringify(Boolean(bioviz && bioviz.development))
  },
  test: {
    include: ['tests/unit/**/*.test.js'],
    environment: 'node'
  }
});
