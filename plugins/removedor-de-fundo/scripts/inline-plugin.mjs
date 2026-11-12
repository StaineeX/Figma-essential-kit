import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const dist = resolve('dist');
const source = await readFile(resolve(dist, 'index.html'), 'utf8');
const stylesheet = source.match(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"[^>]*>/i)?.[1];
const script = source.match(/<script[^>]+src="([^"]+)"[^>]*><\/script>/i)?.[1];

if (!stylesheet || !script) {
  throw new Error('Vite output is missing the stylesheet or application script.');
}

const css = await readFile(resolve(dist, stylesheet), 'utf8');
const js = (await readFile(resolve(dist, script), 'utf8')).replace(/<\/script/gi, '<\\u002fscript');
const pluginHtml = source
  .replace(/<link[^>]+rel="icon"[^>]*>/i, '')
  .replace(/<link[^>]+rel="stylesheet"[^>]+>/i, () => `<style>${css}</style>`)
  .replace(/<script[^>]+src="[^"]+"[^>]*><\/script>/i, '');

const finalHtml = pluginHtml.replace(/<\/body>/i, () => `<script>${js}</script></body>`);

await writeFile(resolve(dist, 'plugin.html'), finalHtml);
