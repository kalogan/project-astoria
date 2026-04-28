// copy-client.js — copies the client/ directory into dist/client/
// The game has no build step (native ES modules), so we just copy the files.

import { cpSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const src  = resolve(root, 'client');
const dest = resolve(root, 'dist', 'client');

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });

console.log(`[build:client] Copied client/ → dist/client/`);
