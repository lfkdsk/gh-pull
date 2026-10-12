import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { parseArgs, serve, runCLI } from '../cli/launcher.js';
import { createApp } from '../server.js';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'gh-pull-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const instance = await serve({ dir, port: 0 }, { makeApp: options => createApp({ ...options, list: async () => ({ items: [], viewer: 'fixture' }) }) });
  t.after(instance.stop);
  return { dir, instance, url: `http://127.0.0.1:${instance.port}` };
}

test('CLI validates commands and ports without silently accepting mistakes', () => {
  assert.deepEqual(parseArgs([]), { command: 'start', open: true, foreground: false });
  assert.deepEqual(parseArgs(['--no-open', '--port', '3456']), { command: 'start', open: false, foreground: false, port: 3456 });
  for (const args of [['--port'], ['--port', '0'], ['--port', '65536'], ['--port', '12abc'], ['stop', '--port', '3000'], ['status', 'stop'], ['--serve']]) assert.throws(() => parseArgs(args));
});

test('local control needs a private token and rejects cross-origin shutdown', async t => {
  const { dir, instance, url } = await fixture(t);
  const state = JSON.parse(await readFile(join(dir, 'instance.json')));
  assert.equal(instance.app.address().address, '127.0.0.1');
  assert.equal((await fetch(url + '/api/cli')).status, 403);
  const headers = { Authorization: `Bearer ${state.token}` };
  assert.equal((await fetch(url + '/api/cli', { headers: { ...headers, Origin: 'https://evil.example' }, method: 'POST' })).status, 403);
  assert.equal((await fetch(url + '/api/cli', { headers, method: 'DELETE' })).status, 405);
  assert.equal((await (await fetch(url + '/api/cli', { headers })).json()).app, 'gh-pull');
  assert.equal((await fetch(url + '/')).status, 200);
});

test('launcher reuses the running app, opens its URL, and stops only the authenticated instance', async t => {
  const { dir, instance, url } = await fixture(t);
  const output = [], opened = [];
  const options = { dir, output: line => output.push(line), open: async url => opened.push(url), authenticate: () => { throw new Error('Existing instance must be reused'); } };
  await runCLI([], options);
  assert.deepEqual(opened, [url]);
  await runCLI(['--no-open'], options);
  assert.equal(opened.length, 1);
  await assert.rejects(runCLI(['--port', String(instance.port === 3001 ? 3002 : 3001)], options), /Already running/);
  await runCLI(['status'], options);
  assert.match(output.at(-1), /running at/);
  await runCLI(['stop'], options);
  assert.equal(output.at(-1), 'gh-pull stopped.');
  await runCLI(['status'], options);
  assert.equal(output.at(-1), 'gh-pull is not running.');
});

test('an occupied explicit port is never stolen or stopped', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'gh-pull-busy-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const other = createServer((req, res) => res.end('unrelated'));
  await new Promise(resolve => other.listen(0, '127.0.0.1', resolve));
  t.after(() => { other.close(); other.closeAllConnections(); });
  await assert.rejects(serve({ dir, port: other.address().port }), { code: 'EADDRINUSE' });
  assert.equal(await (await fetch(`http://127.0.0.1:${other.address().port}`)).text(), 'unrelated');
});

test('missing credentials produce actionable instructions without starting a server', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'gh-pull-login-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await assert.rejects(runCLI(['--no-open'], { dir, authenticate: () => { throw new Error('Run gh auth login'); } }), /gh auth login/);
  await assert.rejects(readFile(join(dir, 'instance.json')), { code: 'ENOENT' });
});
