#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const files = [
  'dist/generated/prisma/client.js',
  'dist/generated/prisma/browser.js',
];

const replacements = [
  [/from "\.\/enums"/g, 'from "./enums.js"'],
  [/from '\.\/enums'/g, "from './enums.js'"],
  [/from "\.\/internal\/class"/g, 'from "./internal/class.js"'],
  [/from "\.\/internal\/prismaNamespace"/g, 'from "./internal/prismaNamespace.js"'],
  [/from '\.\/internal\/prismaNamespaceBrowser'/g, "from './internal/prismaNamespaceBrowser.js'"],
];

for (const file of files) {
  if (!existsSync(file)) continue;
  let text = readFileSync(file, 'utf8');
  const original = text;
  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }
  if (text !== original) {
    writeFileSync(file, text);
  }
}
