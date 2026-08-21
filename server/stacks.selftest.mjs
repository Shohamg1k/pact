import assert from 'node:assert';
import { resolveStack, extractRoutes, STACKS, ALL_LANGUAGES } from './stacks.js';

const s = (stack) => resolveStack({ stack });

// Alias resolution, including the overlap cases that a naive substring match gets wrong.
assert.strictEqual(s({ default: 'MERN' }).id, 'node');
assert.strictEqual(s({ default: 'Node.js', api: 'express' }).id, 'node');
assert.strictEqual(s({ default: 'Python', api: 'FastAPI' }).id, 'python');
assert.strictEqual(s({ default: 'Django' }).id, 'django', 'django must win over a bare python match');
assert.strictEqual(s({ default: 'Python', api: 'Django' }).id, 'django');
assert.strictEqual(s({ default: 'Java', api: 'Spring Boot' }).id, 'java');
assert.strictEqual(s({ default: 'Rust' }).id, 'node', 'unknown stack falls back to node, never throws');
assert.strictEqual(resolveStack({}).id, 'node');
assert.strictEqual(resolveStack(null).id, 'node');

// Express
const express = "const router = require('express').Router();\nrouter.post('/api/books', h);\napp.get('/health', h);";
const e = extractRoutes(STACKS.node, express);
assert.ok(e.some((r) => r.method === 'POST' && r.path === '/api/books'), 'express router.post');
assert.ok(e.some((r) => r.method === 'GET' && r.path === '/health'), 'express app.get');

// FastAPI
const fastapi = '@app.get("/books")\nasync def list_books():\n    ...\n@router.post("/books")\nasync def create():\n    ...';
const f = extractRoutes(STACKS.python, fastapi);
assert.ok(f.some((r) => r.method === 'GET' && r.path === '/books'), 'fastapi @app.get');
assert.ok(f.some((r) => r.method === 'POST' && r.path === '/books'), 'fastapi @router.post');

// Django urls.py
const dj = "urlpatterns = [ path('books/', views.list_books), path('books/<int:pk>/', views.detail) ]";
const d = extractRoutes(STACKS.django, dj);
assert.ok(d.some((r) => r.path === '/books/'), 'django path()');
assert.strictEqual(d.length, 2);

// Spring-style annotations
const java = '@GetMapping("/books")\npublic List<Book> all() {}\n@PostMapping(value = "/books")\npublic Book add() {}';
const j = extractRoutes(STACKS.java, java);
assert.ok(j.some((r) => r.method === 'GET' && r.path === '/books'), 'java @GetMapping');
assert.ok(j.some((r) => r.method === 'POST' && r.path === '/books'), 'java @PostMapping');

// Every profile is internally coherent, so a half-declared stack can't reach the runner.
for (const [id, st] of Object.entries(STACKS)) {
  assert.strictEqual(st.id, id, `${id}: id matches its key`);
  assert.ok(st.languages.length, `${id}: declares languages`);
  assert.ok(st.entryDefault, `${id}: declares an entry`);
  assert.strictEqual(typeof st.start, 'function', `${id}: start is a function`);
  assert.strictEqual(typeof st.env, 'function', `${id}: env is a function`);
  assert.ok(Array.isArray(st.promptRules) && st.promptRules.length, `${id}: has prompt rules`);
  // A non-runnable stack must explain itself rather than silently failing at boot.
  if (!st.runnable) assert.ok(st.runnableNote, `${id}: non-runnable stacks must carry a note`);
}

assert.ok(ALL_LANGUAGES.includes('js') && ALL_LANGUAGES.includes('py') && ALL_LANGUAGES.includes('java'));

console.log(`stacks.selftest.mjs — all checks passed (${Object.keys(STACKS).length} profiles)`);
