import fs from 'fs';
import path from 'path';

const versionFilePath = path.join(process.cwd(), 'build-version.json');

fs.readFile(versionFilePath, 'utf8', (err, data) => {
  if (err) {
    console.error('Error reading build-version.json:', err);
    process.exit(1);
  }

  const versionData = JSON.parse(data);
  versionData.build += 1;

  fs.writeFile(versionFilePath, JSON.stringify(versionData, null, 2), 'utf8', err => {
    if (err) {
      console.error('Error writing build-version.json:', err);
      process.exit(1);
    }
    console.log(`\t⬆️ Build number incremented to #️ ${versionData.build}`);
  });
});
