// Fails when a translation key used with t('...') is missing, or when ar/en do not have the same keys.
import fs from 'node:fs';
const keys = (f) => new Set([...fs.readFileSync(f, 'utf8').matchAll(/'([a-zA-Z0-9_.\-]+)':/g)].map((m) => m[1]));
const ar = keys('apps/web/src/lang/ar.ts'), en = keys('apps/web/src/lang/en.ts');
const used = new Set();
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
  const p = `${d}/${e.name}`;
  if (e.isDirectory()) { if (e.name !== 'lang') walk(p); }
  else if (/\.tsx?$/.test(e.name)) for (const m of fs.readFileSync(p, 'utf8').matchAll(/\bt\(\s*'([^']+)'/g)) used.add(m[1]);
});
walk('apps/web/src');
// keys built from a prefix (t('cat.' + x)) end with a dot; they are checked by their full names in the dictionaries
const missing = [...used].filter((k) => !k.endsWith('.') && (!ar.has(k) || !en.has(k)));
const onlyAr = [...ar].filter((k) => !en.has(k)), onlyEn = [...en].filter((k) => !ar.has(k));
if (missing.length || onlyAr.length || onlyEn.length) {
  console.error({ missing, onlyAr, onlyEn });
  process.exit(1);
}
console.log(`i18n ok: ${used.size} keys used, ${ar.size} per language`);
