#!/usr/bin/env node
/**
 * Copy a Cloudinary media backup into backend/uploads folders.
 *
 * DB photo URLs stay as https://res.cloudinary.com/... — do not rewrite them.
 * This script only places files where the API already maps those URLs:
 *   res.cloudinary.com/.../crm/inward_images/FILE  →  uploads/crm/inward_images/FILE
 *
 * Usage:
 *   node scripts/import-cloudinary-backup.js "C:\path\to\cloudinary-backup"
 *   npm run uploads:import-cloudinary -- "C:\path\to\unzipped-backup"
 *
 * Accepts an unzipped folder (or zip if you extract first). Walks recursively
 * and copies files found under:
 *   inward_images / outward_images / daily_temp_monitor_images
 * (with or without a parent crm/ folder).
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { UPLOAD_FOLDERS, ensureUploadFolders, getUploadFolderPath } = require('../utils/uploadsDir');

const FOLDER_SET = new Set(UPLOAD_FOLDERS.map((f) => f.toLowerCase()));

function walk(dir, onFile) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.warn('Skip unreadable dir:', dir, err.message);
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, onFile);
    else if (entry.isFile()) onFile(full);
  }
}

function detectFolder(filePath) {
  const parts = filePath.replace(/\\/g, '/').split('/');
  for (let i = parts.length - 2; i >= 0; i -= 1) {
    const name = String(parts[i] || '').toLowerCase();
    if (FOLDER_SET.has(name)) return name;
  }
  return null;
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

async function main() {
  const srcRoot = process.argv[2];
  if (!srcRoot || !fs.existsSync(srcRoot)) {
    console.error('Cloudinary backup folder not found.');
    console.error('Usage: node scripts/import-cloudinary-backup.js "C:\\path\\to\\unzipped-backup"');
    process.exit(1);
  }

  const uploadsRoot = ensureUploadFolders();
  console.log('Source:', path.resolve(srcRoot));
  console.log('Target:', uploadsRoot);

  const counts = Object.fromEntries(UPLOAD_FOLDERS.map((f) => [f, 0]));
  let skipped = 0;

  walk(path.resolve(srcRoot), (filePath) => {
    const folder = detectFolder(filePath);
    if (!folder) {
      skipped += 1;
      return;
    }
    const dest = path.join(getUploadFolderPath(folder), path.basename(filePath));
    copyFile(filePath, dest);
    counts[folder] += 1;
  });

  console.log('\nCopied:');
  for (const folder of UPLOAD_FOLDERS) {
    console.log(`  ${folder}: ${counts[folder]}`);
  }
  console.log(`Skipped (not in known folders): ${skipped}`);
  console.log('\nDone. Files are in uploads/crm/<folder>/ (Cloudinary public_id layout).');
  console.log('Later Cloudinary import: folder = crm/<folder>, public_id = filename without extension.');
}

main().catch((err) => {
  console.error('Import failed:', err.message);
  process.exit(1);
});
