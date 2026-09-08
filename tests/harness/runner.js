'use strict';
/** Tiny zero-dependency test runner. */

const suites = [];
let current = null;

function describe(name, fn) {
  current = { name, tests: [] };
  suites.push(current);
  fn();
  current = null;
}

function it(name, fn) {
  if (!current) throw new Error('it() outside describe()');
  current.tests.push({ name, fn });
}

function fail(message) { throw new Error(message); }

const assert = {
  ok(v, msg) { if (!v) fail(msg || `expected truthy, got ${JSON.stringify(v)}`); },
  equal(a, b, msg) { if (a !== b) fail(msg || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); },
  notEqual(a, b, msg) { if (a === b) fail(msg || `expected not ${JSON.stringify(b)}`); },
  deepEqual(a, b, msg) {
    const sa = JSON.stringify(a), sb = JSON.stringify(b);
    if (sa !== sb) fail(msg || `expected ${sb}, got ${sa}`);
  },
  includes(haystack, needle, msg) {
    if (String(haystack).indexOf(needle) < 0) fail(msg || `expected to contain "${needle}" in:\n${haystack}`);
  },
  notIncludes(haystack, needle, msg) {
    if (String(haystack).indexOf(needle) >= 0) fail(msg || `expected NOT to contain "${needle}" in:\n${haystack}`);
  },
  throws(fn, msg) {
    try { fn(); } catch (e) { return e; }
    fail(msg || 'expected a throw');
  }
};

async function run(filter) {
  let passed = 0, failed = 0;
  const failures = [];
  for (const suite of suites) {
    let printedSuite = false;
    for (const t of suite.tests) {
      const full = `${suite.name} › ${t.name}`;
      if (filter && full.toLowerCase().indexOf(filter.toLowerCase()) < 0) continue;
      if (!printedSuite) { console.log(`\n${suite.name}`); printedSuite = true; }
      try {
        await t.fn();
        passed++;
        console.log(`  ok   ${t.name}`);
      } catch (e) {
        failed++;
        failures.push({ full, error: e });
        console.log(`  FAIL ${t.name}`);
        console.log(`       ${String(e && e.message ? e.message : e).split('\n').join('\n       ')}`);
      }
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length && process.env.TEST_STACK) {
    failures.forEach(f => console.log(`\n--- ${f.full}\n${f.error.stack}`));
  }
  return failed;
}

module.exports = { describe, it, assert, run };
