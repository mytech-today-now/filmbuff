#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const cliEntrypoint = path.join(__dirname, "..", "cli", "dist", "cli.js");

if (!fs.existsSync(cliEntrypoint)) {
    console.error("FilmBuff CLI is missing cli/dist/cli.js. Reinstall the package or rebuild the prebuilt dist artifacts.");
    process.exit(1);
}

require(cliEntrypoint);