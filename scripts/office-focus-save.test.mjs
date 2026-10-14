// Real Office client callbacks with synthetic transport only; no network or database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const host = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(resolve(host, 'package.json'));
const ts = require('typescript');
const A = { tenantId: 'tenant-a', actorId: 'profile-a', readOnly: false };
const B = { ...A, tenantId: 'tenant-b' };
const tick = () => new Promise(done => setImmediate(done));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : !tree || typeof tree !== 'object' ? [] : [tree, ...nodes(tree.props?.children), ...nodes(tree.props?.headerSecondary)];

async function harness({ readOnly = false, locale = 'cs' } = {}) {
  const cache = new Map(), state = [], memos = [], effects = [], events = new Map(), documentEvents = new Map();
  const actions = [], probes = [], uploads = [], timers = new Map();
  let stateIndex = 0, memoIndex = 0, effectIndex = 0, scheduled = [], probeContext = { ...A, readOnly };
  let probeResult = true, probeGate = null, actionGate = null, actionError = null, uploadResponse = null, timerIndex = 0, loading;
  const equal = (a, b) => a?.length === b?.length && a.every((value, i) => value === b[i]);
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const react = {
    useState(initial) { const i = stateIndex++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial; return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next; }]; },
    useMemo(make, deps) { const i = memoIndex++; if (!memos[i] || !equal(memos[i].deps, deps)) memos[i] = { deps, value: make() }; return memos[i].value; },
    useEffect(make, deps) { const i = effectIndex++; if (!effects[i] || !equal(effects[i].deps, deps)) { const old = effects[i]; effects[i] = { deps }; scheduled.push(() => { old?.cleanup?.(); effects[i].cleanup = make(); }); } },
  };
  const mocks = {
    'react': react,
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
    'next/dynamic': { __esModule: true, default: (_loader, options) => { if(options.loading) { loading = options.loading; return 'Workspace'; } return 'Assistant'; } },
    './OfficeNavigation': { __esModule: true, default: 'Navigation' },
    './actions': {
      officeAction: async (tenant, request) => { actions.push({ tenant, request }); if (actionGate) await actionGate.promise; return actionError ? { ok: false, error: actionError } : { ok: true, result: { file: { id: 'fixture-file', revision: 2 } } }; },
      officeTemplateVariables: async () => ({}),
    },
    '@diriqo/office/styles.css': {},
    './office.module.css': {},
  };
  const globals = {
    Error, URL, TextEncoder, File, AbortController, setTimeout, clearTimeout, Event,
    window: {
      addEventListener: (name, callback) => events.set(name, callback), removeEventListener: name => events.delete(name),
      setInterval: callback => { const id = ++timerIndex; timers.set(id, callback); return id; }, clearInterval: id => timers.delete(id),
    },
    document: { visibilityState: 'visible', addEventListener: (name, callback) => documentEvents.set(name, callback), removeEventListener: name => documentEvents.delete(name) },
    fetch: async (url, options) => {
      if (url === '/api/office/files') {
        uploads.push({ url, options });
        assert.ok(uploadResponse, 'Each upload must explicitly provide its synthetic response');
        const response = uploadResponse; uploadResponse = null;
        return response;
      }
      assert.equal(url, '/api/office/context', 'No unmocked request may escape the client harness');
      probes.push({ url, options });
      const context = probeContext, ok = probeResult, gate = probeGate;
      if (gate) await gate.promise;
      return { ok, redirected: false, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ ok, context }) };
    },
  };
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const mod = { exports: {} }; cache.set(filename, mod);
    const output = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const localRequire = id => {
      if (Object.hasOwn(mocks, id)) return mocks[id];
      const base = id.startsWith('@/') ? resolve(host, id.slice(2)) : id.startsWith('.') ? resolve(dirname(filename), id) : null;
      assert.ok(base, 'Unmocked import: ' + id);
      const path = [base, base + '.ts', base + '.tsx'].find(existsSync); assert.ok(path, 'Missing module: ' + id);
      return load(path);
    };
    vm.runInNewContext('(function(require,module,exports){' + output + '\n})', globals, { filename })(localRequire, mod, mod.exports);
    return mod.exports;
  }
  const Component = load(resolve(host, 'app/office/OfficeClient.tsx')).default;
  const props = { ...A, readOnly, locale, companyName: 'Company A', navigation: { role: 'manager', activeModules: ['gastro'], menuItemVisibility: null, assistantEnabled: true } };
  function render() { stateIndex = memoIndex = effectIndex = 0; const tree = Component(props), pending = scheduled; scheduled = []; pending.forEach(run => run()); return nodes(tree); }
  const workspace = render().find(node => node.type === 'Workspace'), transport = workspace.props.transport;
  await tick();
  return {
    transport, actions, probes, uploads, render, loading: () => loading(),
    respondUpload(response) { uploadResponse = response; },
    context(value) { probeContext = value; probeResult = true; },
    failProbe() { probeResult = false; },
    holdProbe() { probeGate = deferred(); return () => { probeGate.resolve(); probeGate = null; }; },
    holdAction() { actionGate = deferred(); return () => { actionGate.resolve(); actionGate = null; }; },
    denyAction(code) { actionError = code; },
    emit(name, event = {}) { const callback = name === 'visibilitychange' ? documentEvents.get(name) : events.get(name); assert.ok(callback, name); callback(event); },
    poll() { for (const callback of timers.values()) callback(); },
    cleanup() { effects.forEach(effect => effect.cleanup?.()); },
  };
}

for (const event of ['focus', 'pageshow', 'online', 'visibilitychange']) {
  test('Office ' + event + ' revalidation preserves an in-flight create/save in the same company', async () => {
    const h = await harness();
    try {
      for (const op of ['create', 'save']) {
        const release = h.holdAction(), response = h.transport.request({ op }).then(value => ({ value }), error => ({ error }));
        h.emit(event); await tick(); release();
        const result = await response;
        assert.equal(result.error, undefined, 'Revalidating the same context must not discard a committed ' + op);
        assert.equal(result.value.file.id, 'fixture-file');
        assert.equal(h.actions.at(-1).tenant, A.tenantId);
        assert.equal(h.render().some(node => node.props['data-office-context']), false);
      }
      assert.equal(h.actions.length, 2, 'No automatic retry of an already committed operation');
    } finally { h.cleanup(); }
  });
}

test('Office same-company response remains valid while a routine focus probe is pending', async () => {
  const h = await harness();
  const releaseProbe = h.holdProbe();
  try {
    const release = h.holdAction(), response = h.transport.request({ op: 'save' }).then(value => ({ value }), error => ({ error }));
    h.emit('focus'); release();
    const result = await response;
    assert.equal(result.error, undefined);
    assert.equal(result.value.file.revision, 2);
    assert.equal(h.actions.length, 1);
  } finally { releaseProbe(); await tick(); h.cleanup(); }
});

function uploadFixture() {
  const data = new FormData();
  data.append('file', new File(['synthetic original bytes'], 'synthetic.odt', { type: 'application/vnd.oasis.opendocument.text' }));
  data.append('parentId', 'synthetic-folder');
  return data;
}

const uploadMessages = {
  cs: {
    OFFICE_HOST_LIMIT: 'Soubor nebo jeho rozbalený obsah překračuje limit tohoto nasazení. Pro nahrání použijte soubor do 3 MiB nebo menší dokument.',
    OFFICE_IMPORT_LIMIT: 'Dokument překračuje bezpečné limity zpracování. Zmenšete jej nebo rozdělte na menší soubory.',
    OFFICE_IMPORT_FORMAT: 'Soubor je poškozený nebo obsahuje nepodporovanou variantu formátu. Zkuste jej otevřít v původním editoru a uložit novou kopii jako DOCX, ODT nebo XLSX.',
    OFFICE_IMPORT_PROTECTED: 'Import byl odmítnut kvůli šifrování, makrům nebo jinému aktivnímu obsahu. Použijte zkontrolovanou kopii bez ochrany a aktivních prvků.',
  },
  en: {
    OFFICE_HOST_LIMIT: 'The file or its expanded content exceeds this deployment limit. Upload a file of up to 3 MiB or a smaller document.',
    OFFICE_IMPORT_LIMIT: 'The document exceeds safe processing limits. Reduce it or split it into smaller files.',
    OFFICE_IMPORT_FORMAT: 'The file is damaged or uses an unsupported format variant. Open it in its original editor and save a new copy as DOCX, ODT or XLSX.',
    OFFICE_IMPORT_PROTECTED: 'Import was rejected because of encryption, macros or other active content. Use a reviewed copy without protection or active elements.',
  },
};

for (const locale of ['cs', 'en']) {
  test('Office import maps a platform HTML 413 to a safe localized host limit (' + locale + ')', async () => {
    const h = await harness({ locale });
    try {
      h.respondUpload(new Response('<html>RAW_PLATFORM_TRACE synthetic-secret.odt</html>', { status: 413, headers: { 'content-type': 'text/html' } }));
      await assert.rejects(h.transport.importFile(uploadFixture()), error => {
        assert.equal(error.message, 'OFFICE_HOST_LIMIT');
        assert.equal(error.userMessage, uploadMessages[locale].OFFICE_HOST_LIMIT);
        assert.doesNotMatch(error.message + error.userMessage, /RAW_PLATFORM_TRACE|synthetic-secret/);
        return true;
      });
      assert.equal(h.uploads.length, 1, 'An unsuccessful upload is not automatically retried');
    } finally { h.cleanup(); }
  });

  test('Office import retains the host limit for platform or malformed JSON 413 (' + locale + ')', async () => {
    const h = await harness({ locale });
    try {
      for (const body of ['{"error":"FUNCTION_PAYLOAD_TOO_LARGE"}', '{invalid', 'null', '[]', '{}']) {
        h.respondUpload(new Response(body, { status: 413, headers: { 'content-type': 'application/json' } }));
        await assert.rejects(h.transport.importFile(uploadFixture()), error => {
          assert.equal(error.message, 'OFFICE_HOST_LIMIT');
          assert.equal(error.userMessage, uploadMessages[locale].OFFICE_HOST_LIMIT);
          return true;
        });
      }
    } finally { h.cleanup(); }
  });

  for (const [code, status] of [['OFFICE_IMPORT_LIMIT', 413], ['OFFICE_IMPORT_FORMAT', 422], ['OFFICE_IMPORT_PROTECTED', 422]]) {
    test('Office import preserves ' + code + ' and its localized explanation (' + locale + ')', async () => {
      const h = await harness({ locale });
      try {
        h.respondUpload(Response.json({ error: code, message: 'RAW_PARSER_TRACE synthetic-secret.odt', userMessage: 'UNTRUSTED_SERVER_EXPLANATION' }, { status }));
        await assert.rejects(h.transport.importFile(uploadFixture()), error => {
          assert.equal(error.message, code, 'A JSON parser limit must not become the HTTP host limit');
          assert.equal(error.userMessage, uploadMessages[locale][code]);
          assert.doesNotMatch(error.message + error.userMessage, /RAW_PARSER_TRACE|synthetic-secret|UNTRUSTED_SERVER_EXPLANATION/);
          return true;
        });
        assert.equal(h.uploads.length, 1);
      } finally { h.cleanup(); }
    });
  }
}

test('Office import discards unknown raw server diagnostics and response-provided user messages', async () => {
  const h = await harness();
  try {
    for (const raw of ['Parser failed at synthetic-secret.odt: confidential contents', 'OFFICE_IMPORT_FORMAT: confidential contents', '<script>confidential contents</script>']) {
      h.respondUpload(Response.json({ error: raw, userMessage: raw, details: raw }, { status: 422 }));
      await assert.rejects(h.transport.importFile(uploadFixture()), error => {
        assert.equal(error.message, 'OFFICE_REQUEST_FAILED');
        assert.equal(error.userMessage, undefined);
        assert.doesNotMatch(String(error) + JSON.stringify(error), /confidential|synthetic-secret|script/);
        return true;
      });
    }
    assert.equal(h.uploads.length, 3);
  } finally { h.cleanup(); }
});

test('Office import sends the original FormData once with its pinned company header', async () => {
  const h = await harness();
  try {
    const data = uploadFixture();
    const imported = { file: { id: 'imported-fixture', tenantId: A.tenantId, revision: 1 }, warnings: ['fixture warning'] };
    h.respondUpload(Response.json(imported));
    assert.deepEqual(await h.transport.importFile(data), imported);
    assert.equal(h.uploads.length, 1);
    const { url, options } = h.uploads[0];
    assert.equal(url, '/api/office/files');
    assert.equal(options.method, 'POST');
    assert.equal(new Headers(options.headers).get('X-Office-Tenant'), A.tenantId);
    assert.equal(new Headers(options.headers).has('content-type'), false, 'The browser must supply the multipart boundary');
    assert.equal(options.body, data, 'Do not stringify or rebuild the caller multipart body');
    assert.ok(options.body instanceof FormData);
    assert.equal(options.body.get('parentId'), 'synthetic-folder');
    assert.equal(await options.body.get('file').text(), 'synthetic original bytes');
    h.context(B); h.emit('focus'); await tick();
    await assert.rejects(h.transport.importFile(uploadFixture()), /OFFICE_TENANT_CHANGED/);
    assert.equal(h.uploads.length, 1, 'A changed company cannot start another upload under the old document context');
  } finally { h.cleanup(); }
});

for (const event of ['diriqo-office-context-changed', 'storage']) {
  test('Office ' + event + ' invalidates prior replies even if the verified company returns to A', async () => {
    const h = await harness();
    try {
      const release = h.holdAction(), response = h.transport.request({ op: 'save' }).then(value => ({ value }), error => ({ error }));
      h.emit(event, { key: 'diriqo-office-context-revision' });
      await assert.rejects(h.transport.request({ op: 'create' }), /OFFICE_CONTEXT_UNAVAILABLE/);
      await tick(); release();
      assert.match((await response).error?.message ?? '', /OFFICE_CONTEXT_UNAVAILABLE/);
      assert.equal(h.actions.length, 1);
      await h.transport.request({ op: 'listFiles' });
      assert.equal(h.actions.length, 2);
    } finally { h.cleanup(); }
  });
}

test('Office confirmed A to B to A changes never revive a response started in A', async () => {
  const h = await harness();
  try {
    const release = h.holdAction(), response = h.transport.request({ op: 'save' }).then(value => ({ value }), error => ({ error }));
    h.context(B); h.emit('focus'); await tick();
    await assert.rejects(h.transport.request({ op: 'create' }), /OFFICE_TENANT_CHANGED/);
    h.context(A); h.emit('focus'); await tick(); release();
    assert.match((await response).error?.message ?? '', /OFFICE_CONTEXT_UNAVAILABLE/);
    assert.equal(h.actions.length, 1);
  } finally { h.cleanup(); }
});

test('Office unsuccessful verification, changed actor and revoked write role still discard prior replies', async () => {
  for (const variant of ['failure', 'actor', 'role', 'offline']) {
    const h = await harness();
    try {
      const release = h.holdAction(), response = h.transport.request({ op: 'save' }).then(value => ({ value }), error => ({ error }));
      if (variant === 'offline') h.emit('offline');
      else {
        if (variant === 'failure') h.failProbe();
        else h.context({ ...A, ...(variant === 'actor' ? { actorId: 'other-profile' } : { readOnly: true }) });
        h.emit('focus'); await tick();
      }
      h.context(A); h.emit('focus'); await tick(); release();
      assert.match((await response).error?.message ?? '', /OFFICE_CONTEXT_UNAVAILABLE/, variant);
      assert.equal(h.actions.length, 1);
    } finally { h.cleanup(); }
  }
});

test('Office stale focus probe cannot reopen the panel after a later company-change signal', async () => {
  const h = await harness();
  const releaseProbe = h.holdProbe();
  try {
    h.emit('focus');
    h.context(B); h.emit('diriqo-office-context-changed');
    releaseProbe(); await tick();
    await assert.rejects(h.transport.request({ op: 'save' }), /OFFICE_TENANT_CHANGED/);
    assert.equal(h.actions.length, 0);
  } finally { h.cleanup(); }
});

test('Office server denial is preserved and never retried as another create', async () => {
  const h = await harness();
  try {
    h.denyAction('OFFICE_TENANT_CHANGED');
    await assert.rejects(h.transport.request({ op: 'create' }), /OFFICE_TENANT_CHANGED/);
    assert.equal(h.actions.length, 1);
  } finally { await tick(); h.cleanup(); }
});

