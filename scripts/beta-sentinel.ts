#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { main } from "../src/lib/beta-sentinel.js";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
