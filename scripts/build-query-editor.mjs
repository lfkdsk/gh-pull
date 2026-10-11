import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';

// The checked-in bundle keeps the runtime build independent of devDependencies.
const result = await build({
  entryPoints: ['scripts/query-editor.js'], outfile: 'public/query-editor.js',
  bundle: true, minify: true, format: 'esm', target: ['es2022'],
  metafile: true,
  plugins: [{ name: 'query-module', setup(build) {
    build.onResolve({ filter: /public\/query\.js$/ }, () => ({ path: './query.js', external: true }));
  } }],
  legalComments: 'external',
});
const packages = [...new Set(Object.keys(result.metafile.inputs).filter(path => path.startsWith('node_modules/'))
  .map(path => path.split('/').slice(0, path.startsWith('node_modules/@') ? 3 : 2).join('/')))];
const licenses = await Promise.all(packages.sort().map(async path => `${path.slice(13)}\n\n${await readFile(`${path}/LICENSE`, 'utf8')}`));
await writeFile('public/query-editor.LICENSE.txt', licenses.join('\n\n---\n\n'));
