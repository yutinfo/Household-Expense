'use strict';
/**
 * Loads every apps-script/*.gs file into one vm context that exposes the
 * mocked Apps Script services, mirroring the shared global scope of a real
 * Apps Script project.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createEnvironment } = require('./gas-mock');

const APPS_SCRIPT_DIR = path.resolve(__dirname, '..', '..', 'apps-script');

function loadProject(options) {
  const env = createEnvironment(options);
  const context = vm.createContext(Object.assign({}, env, {
    JSON, Math, Date, RegExp, Error, Object, Array, String, Number, Boolean, parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent, setTimeout
  }));
  const files = fs.readdirSync(APPS_SCRIPT_DIR).filter(f => f.endsWith('.gs')).sort();
  for (const f of files) {
    const code = fs.readFileSync(path.join(APPS_SCRIPT_DIR, f), 'utf8');
    vm.runInContext(code, context, { filename: f });
  }
  context.__mock = env.__mock;
  context.__env = env;
  return context;
}

/** Fresh project with the spreadsheet already set up and two members registered. */
function bootProject(options) {
  const ctx = loadProject(options);
  ctx.setupSpreadsheet();
  ctx.setupAddMember('yut', 'Uyut', 'ยุทธ', 'ยุทธ,ผม,สามี,พี่');
  ctx.setupAddMember('wife', 'Uwife', 'ภรรยา', 'เมีย,ภรรยา,แฟน,เธอ');
  ctx.repoInvalidate();
  return ctx;
}

module.exports = { loadProject, bootProject, APPS_SCRIPT_DIR };
