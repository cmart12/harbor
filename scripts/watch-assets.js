const fs = require('fs');
const path = require('path');

const assets = ['index.html', 'styles.css', 'copilot.png'];
const srcDir = path.join(__dirname, '..', 'src', 'renderer');
const distDir = path.join(__dirname, '..', 'dist', 'renderer');

function copy() {
  for (const f of assets) {
    fs.copyFileSync(path.join(srcDir, f), path.join(distDir, f));
  }
}

// Initial copy
copy();

// Watch for changes
for (const f of assets) {
  fs.watchFile(path.join(srcDir, f), { interval: 300 }, () => {
    console.log(`[watch] ${f} changed, copying...`);
    copy();
  });
}

console.log('[watch] Watching renderer assets for changes...');
