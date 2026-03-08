import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const srcDir = path.join(repoRoot, 'wordnet');
const outFile = path.join(repoRoot, 'generated', 'wordnet-index.json');

const files = fs
  .readdirSync(srcDir)
  .filter((name) => /^entries-[a-z0-9]\.json$/i.test(name))
  .sort();

const seen = new Set();

for (const file of files) {
  const fullPath = path.join(srcDir, file);
  const raw = fs.readFileSync(fullPath, 'utf8');
  const data = JSON.parse(raw);
  for (const key of Object.keys(data)) {
    const lower = key.toLowerCase();
    if (!/^[a-z]+$/.test(lower)) continue;
    if (lower.length < 3 || lower.length > 24) continue;
    seen.add(lower);
  }
}

const byInitial = {};
for (const word of seen) {
  const initial = word[0];
  if (!byInitial[initial]) byInitial[initial] = [];
  byInitial[initial].push(word);
}

for (const initial of Object.keys(byInitial)) {
  byInitial[initial].sort();
}

const payload = {
  generated_at: new Date().toISOString(),
  total_words: seen.size,
  by_initial: byInitial,
};

fs.writeFileSync(outFile, JSON.stringify(payload));
console.log(`Wrote ${outFile} with ${seen.size} words from ${files.length} files.`);
