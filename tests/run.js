'use strict';
/**
 * Test entry point:  node tests/run.js [name filter]
 * Every spec file registers its cases with the shared runner.
 */
const fs = require('fs');
const path = require('path');
const { run } = require('./harness/runner');

const specDir = path.join(__dirname, 'specs');
fs.readdirSync(specDir).filter(f => f.endsWith('.js')).sort().forEach(f => require(path.join(specDir, f)));

run(process.argv[2]).then(failed => { process.exit(failed ? 1 : 0); });
