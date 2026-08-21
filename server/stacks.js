// Stack profiles — the one place that knows how a given technology stack is written,
// syntax-checked, installed, started and probed. CORE-8 always intended the stack to be
// DATA ("MERN by default; a brief-named stack wins because Agent 1 writes it into
// stack.default — Agent 2 obeys data, not a hardcode"), but the prompt, gates and runner
// had Express/Mongoose/npm baked in. This table is what makes that promise real: adding
// a stack is one config object, exactly like adapters/registry.js.
//
// `runnable` is deliberately honest. A profile is only marked runnable when its toolchain
// is actually present on this machine and PACT can boot it end to end; anything else can
// still be GENERATED and inspected, but we say plainly that we can't start it rather
// than shipping a boot path that fails at demo time.

/** Escape a string for use inside a RegExp. */
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const STACKS = {
  node: {
    id: 'node',
    label: 'Node · Express',
    specificity: 10,
    aliases: ['mern', 'node', 'nodejs', 'express', 'javascript', 'js', 'mean'],
    languages: ['js', 'json'],
    entryDefault: 'server.js',
    manifestFile: 'package.json',
    install: { cmd: 'npm', args: ['install', '--no-audit', '--no-fund'] },
    start: (entry) => ({ cmd: 'node', args: [entry] }),
    env: ({ port, mongoUri }) => ({
      PORT: String(port),
      MONGO_URL: mongoUri, MONGO_URI: mongoUri, MONGODB_URI: mongoUri,
    }),
    db: 'mongo',
    syntax: 'esbuild',
    runnable: true,
    // Express: `router.get('/x')` or `app.get('/x')`.
    routeRe: [/\b(?:router|app)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/gi],
    deps: { express: '^5.1.0' },
    promptRules: [
      'Use CommonJS `require`, Express 5, and Mongoose if the contract declares collections.',
      'The HTTP port comes from `process.env.PORT`; the MongoDB URL from `process.env.MONGO_URL` — those exact names, no hardcoded fallback host.',
      'Register every route with Express Router syntax the gate can find: `router.get(\'/path\', ...)`.',
    ],
  },

  python: {
    id: 'python',
    label: 'Python · FastAPI',
    specificity: 10,
    aliases: ['python', 'py', 'fastapi', 'uvicorn'],
    languages: ['py', 'json', 'txt'],
    entryDefault: 'main.py',
    manifestFile: 'requirements.txt',
    // A venv per preview would be cleaner but costs ~20s; --user keeps the demo fast and
    // the generated tree self-contained on disk either way.
    install: { cmd: 'py', args: ['-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', '-r', 'requirements.txt'] },
    start: (entry) => ({ cmd: 'py', args: [entry] }),
    env: ({ port, dbPath }) => ({ PORT: String(port), DATABASE_URL: `sqlite:///${dbPath}`, SQLITE_PATH: dbPath }),
    db: 'sqlite',
    syntax: 'py_compile',
    runnable: true,
    // FastAPI/Flask decorators: @app.get("/x") / @router.post("/x") / @app.route("/x")
    routeRe: [
      /@(?:app|router)\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/gi,
      /@(?:app|bp)\.route\(\s*['"]([^'"]+)['"][^)]*methods\s*=\s*\[\s*['"](GET|POST|PUT|PATCH|DELETE)['"]/gi,
    ],
    deps: { fastapi: '', uvicorn: '' },
    promptRules: [
      'Use FastAPI with Pydantic models, and the sqlite3 module from the standard library for persistence (no external DB server).',
      'The HTTP port comes from `os.environ["PORT"]`; the SQLite file path from `os.environ["SQLITE_PATH"]`.',
      'The entry module MUST end with a `if __name__ == "__main__":` block that runs `uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PORT", 8000)))` so the process starts a real server when executed directly.',
      'Declare dependencies one-per-line in requirements.txt (at minimum fastapi and uvicorn).',
    ],
  },

  django: {
    id: 'django',
    label: 'Python · Django',
    // Outranks `python`: a contract saying "Python / Django" means Django, not FastAPI.
    specificity: 20,
    aliases: ['django'],
    languages: ['py', 'json', 'txt'],
    entryDefault: 'manage.py',
    manifestFile: 'requirements.txt',
    install: { cmd: 'py', args: ['-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', '-r', 'requirements.txt'] },
    // Django's ORM has no tables until this runs; every model-backed endpoint would 500
    // on first boot without it. Runs once per boot (runner.js's runPostInstall), always —
    // migrate is itself idempotent, so this isn't hash-cached the way installDeps is.
    postInstall: (entry) => ({ cmd: 'py', args: [entry, 'migrate', '--noinput'] }),
    start: (entry, { port }) => ({ cmd: 'py', args: [entry, 'runserver', `127.0.0.1:${port}`, '--noreload'] }),
    env: ({ port }) => ({ PORT: String(port), DJANGO_DEBUG: '1' }),
    db: 'sqlite',
    syntax: 'py_compile',
    runnable: true,
    // urls.py: path('books/', ...) / re_path(...) — Django's URLconf genuinely does not
    // encode the HTTP method (that lives in the view function's dispatch, e.g. a
    // `request.method == 'POST'` check or a DRF `@api_view(['GET','POST'])`), so unlike
    // every other stack here this regex has no method group to capture. methodInRoute:
    // false tells extractRoutes/checkConformance not to guess GET for the missing group —
    // a guess would (and, live, did: a real Django run showed every declared POST/PATCH
    // falsely rejected as CONFORMANCE_MISMATCH because the same path()-registered route
    // was always read back as GET) reject perfectly conforming code.
    methodInRoute: false,
    routeRe: [/\b(?:path|re_path)\(\s*['"]([^'"]*)['"]/gi],
    deps: { django: '' },
    promptRules: [
      'Use Django with its default SQLite database and the built-in ORM.',
      'Include manage.py, a settings module, and urls.py wiring every endpoint with `path(...)`.',
      'Run migrations at startup if needed; the server is started with `manage.py runserver` and must not require an interactive prompt.',
      'Declare dependencies one-per-line in requirements.txt (at minimum django).',
    ],
  },

  java: {
    id: 'java',
    label: 'Java',
    specificity: 10,
    aliases: ['java', 'spring', 'springboot', 'spring-boot'],
    languages: ['java', 'json', 'xml'],
    entryDefault: 'Main.java',
    manifestFile: 'pom.xml',
    install: null,
    start: (entry) => ({ cmd: 'java', args: [entry] }),
    env: ({ port }) => ({ PORT: String(port) }),
    db: 'none',
    syntax: 'javac',
    // javac/java 21 are present, but there is no Maven or Gradle on this machine, so a
    // Spring Boot tree cannot be resolved or built here. Single-file Java runs via the
    // JEP-330 launcher; anything needing dependency resolution cannot be started, and we
    // say so instead of failing at boot.
    runnable: false,
    runnableNote: 'Java generates and syntax-checks here, but no Maven/Gradle is installed, so a dependency-based project cannot be built or started on this machine.',
    routeRe: [
      /@(Get|Post|Put|Patch|Delete)Mapping\(\s*(?:value\s*=\s*)?['"]([^'"]+)['"]/gi,
      /@RequestMapping\(\s*(?:value\s*=\s*)?['"]([^'"]+)['"]/gi,
    ],
    deps: {},
    promptRules: [
      'Use plain Java 21 with com.sun.net.httpserver.HttpServer — do NOT use Spring Boot, Maven or Gradle, because no build tool is available to resolve dependencies.',
      'The HTTP port comes from `System.getenv("PORT")`.',
      'Keep the whole service runnable from a single entry class so `java Main.java` starts it.',
    ],
  },
};

export const DEFAULT_STACK = 'node';

/**
 * Resolve a contract's declared stack to a profile. The contract is model-authored free
 * text ("MERN", "Django", "python/fastapi"), so this matches on aliases and falls back
 * to Node rather than throwing — an unrecognised stack must not break a run.
 */
export function resolveStack(contract) {
  const declared = [contract?.stack?.default, contract?.stack?.api, contract?.stack?.db]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (!declared) return STACKS[DEFAULT_STACK];
  // Most specific first: a framework profile outranks the language it runs on (Django
  // over Python), and within equal specificity the longer alias wins ('spring-boot'
  // over a bare 'spring').
  const candidates = Object.values(STACKS).flatMap((s) => s.aliases.map((a) => ({ a, s })));
  candidates.sort((x, y) => (y.s.specificity ?? 10) - (x.s.specificity ?? 10) || y.a.length - x.a.length);
  for (const { a, s } of candidates) {
    if (new RegExp(`\\b${esc(a)}\\b`).test(declared)) return s;
  }
  return STACKS[DEFAULT_STACK];
}

/** Every language any stack can emit — the backend/frontend schemas validate against this. */
export const ALL_LANGUAGES = [...new Set(Object.values(STACKS).flatMap((s) => s.languages))];

/** Extract {method, path} route registrations from one module, per the stack's patterns. */
export function extractRoutes(stack, code) {
  const out = [];
  for (const re of stack.routeRe ?? []) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(code))) {
      // Patterns capture (method, path) or (path, method) or just (path) — normalise.
      const groups = m.slice(1).filter(Boolean);
      const methodish = groups.find((g) => /^(get|post|put|patch|delete)$/i.test(g));
      const pathish = groups.find((g) => g.startsWith('/') || !/^(get|post|put|patch|delete)$/i.test(g));
      if (!pathish) continue;
      // A route pattern with no method group and a stack that says method isn't part of
      // its route registration syntax (Django) is genuinely unknown — `null`, not a
      // guessed GET (see the django profile's methodInRoute comment for why that guess is
      // actively wrong, not just imprecise).
      const method = methodish ? methodish.toUpperCase() : stack.methodInRoute === false ? null : 'GET';
      out.push({ method, path: pathish.startsWith('/') ? pathish : `/${pathish}` });
    }
  }
  return out;
}
