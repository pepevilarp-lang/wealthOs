// Comprueba la sintaxis de /api/*.js y de los <script> en línea de las páginas HTML.
// Uso: node tests/check-syntax.mjs [archivo.html …]   (por defecto index.html e instinct.html)
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

let errores = 0;
for (const f of fs.readdirSync('api').filter(f => f.endsWith('.js'))) {
  try { execFileSync(process.execPath, ['--check', `api/${f}`], { stdio: 'pipe' }); }
  catch (e) { errores++; console.log(`api/${f}:`, String(e.stderr).split('\n').slice(0, 4).join(' ')); }
}
const files = process.argv.slice(2).length ? process.argv.slice(2) : ['index.html', 'instinct.html'];
for (const file of files) {
  const html = fs.readFileSync(file, 'utf8');
  const re = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi;
  let m, i = 0, bad = 0;
  while ((m = re.exec(html))) {
    i++;
    if (/type=["'](?!text\/javascript|module)/.test(m[1])) continue;
    try { new vm.Script(m[2], { filename: `${file}#${i}` }); }
    catch (e) { bad++; console.log(file, 'script', i, e.message); }
  }
  console.log(`${file}: ${i} scripts, ${bad} errores`);
  errores += bad;
}
console.log(errores ? `✗ ${errores} errores de sintaxis` : '✓ Sintaxis correcta en /api y en las páginas');
if (errores) process.exitCode = 1;
