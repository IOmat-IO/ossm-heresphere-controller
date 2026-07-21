'use strict';

const fs = require('fs/promises');
const path = require('path');

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function videoNamesFromSource(source) {
  let cleaned = String(source || '').trim();
  if (!cleaned) return { fileName: '', stem: '' };

  cleaned = cleaned.split('#')[0].split('?')[0].replace(/\\/g, '/');
  cleaned = safeDecode(cleaned);
  const segments = cleaned.split('/').filter(Boolean);
  const fileName = segments.at(-1) || '';
  const extension = path.posix.extname(fileName);
  const stem = extension ? fileName.slice(0, -extension.length) : fileName;
  return { fileName, stem };
}

async function scanFunscriptFolder(rootPath) {
  const root = path.resolve(String(rootPath || ''));
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) throw new Error('Le chemin sélectionné n’est pas un dossier.');

  const entries = [];
  async function walk(directory) {
    const children = await fs.readdir(directory, { withFileTypes: true });
    for (const child of children) {
      const fullPath = path.join(directory, child.name);
      if (child.isDirectory()) {
        await walk(fullPath);
      } else if (child.isFile() && child.name.toLowerCase().endsWith('.funscript')) {
        const stem = child.name.slice(0, -'.funscript'.length);
        entries.push({
          path: fullPath,
          relativePath: path.relative(root, fullPath),
          name: child.name,
          stem,
          stemLower: stem.toLocaleLowerCase('fr-FR')
        });
      }
    }
  }

  await walk(root);
  entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'fr', { sensitivity: 'base' }));
  return { root, entries };
}

function resolveFunscript(entries, videoSource) {
  const { fileName, stem } = videoNamesFromSource(videoSource);
  if (!fileName) return { status: 'no-video-name', fileName: '', stem: '', matches: [] };

  const fileNameLower = fileName.toLocaleLowerCase('fr-FR');
  const stemLower = stem.toLocaleLowerCase('fr-FR');
  const exactWithExtension = entries.filter((entry) => entry.stemLower === fileNameLower);
  const exactWithoutExtension = entries.filter((entry) => entry.stemLower === stemLower);
  const matches = exactWithExtension.length > 0 ? exactWithExtension : exactWithoutExtension;
  const priority = exactWithExtension.length > 0 ? 'video-filename' : 'video-stem';

  if (matches.length === 0) return { status: 'none', fileName, stem, priority, matches: [] };
  if (matches.length > 1) return { status: 'ambiguous', fileName, stem, priority, matches };
  return { status: 'match', fileName, stem, priority, match: matches[0], matches };
}

module.exports = {
  videoNamesFromSource,
  scanFunscriptFolder,
  resolveFunscript
};
