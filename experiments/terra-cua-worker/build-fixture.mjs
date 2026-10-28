/** Build a standalone file without opening a browser, starting a server or loading a driver. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function buildFixture(output = new URL('./artifacts/fixture.html', import.meta.url)) {
  const state = (await readFile(new URL('./fixture-state.mjs', import.meta.url), 'utf8')).replace(/^export /gm, '');
  const template = await readFile(new URL('./page.template.html', import.meta.url), 'utf8');
  await mkdir(new URL('.', output), { recursive: true });
  await writeFile(output, template.replace('/* STATE_ENGINE */', state));
  return output;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(fileURLToPath(await buildFixture()));
}
