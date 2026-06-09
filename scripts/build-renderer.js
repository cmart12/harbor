const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const watch = process.argv.includes('--watch');
const minify = !watch;

const rendererOptions = {
  entryPoints: [path.join(__dirname, '..', 'src', 'renderer', 'app.ts')],
  bundle: true,
  outfile: path.join(__dirname, '..', 'dist', 'renderer', 'app.js'),
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
  minify,
  jsx: 'automatic',
  loader: {
    '.ts': 'ts',
    '.tsx': 'tsx',
  },
  alias: {
    'react': path.resolve(__dirname, '..', 'node_modules', 'react'),
    'react-dom': path.resolve(__dirname, '..', 'node_modules', 'react-dom'),
    'react/jsx-dev-runtime': path.resolve(__dirname, 'jsx-dev-shim.js'),
    'react/jsx-runtime': path.resolve(__dirname, '..', 'node_modules', 'react', 'jsx-runtime.js'),
  },
  logLevel: 'info',
};

const webOptions = {
  ...rendererOptions,
  entryPoints: [path.join(__dirname, '..', 'src', 'web', 'index.tsx')],
  outfile: path.join(__dirname, '..', 'dist', 'web', 'app.js'),
};

function copyWebAssets() {
  const srcDir = path.join(__dirname, '..', 'src', 'web');
  const distDir = path.join(__dirname, '..', 'dist', 'web');
  fs.mkdirSync(distDir, { recursive: true });
  for (const asset of ['index.html', 'styles.css']) {
    fs.copyFileSync(path.join(srcDir, asset), path.join(distDir, asset));
  }
}

async function main() {
  if (watch) {
    copyWebAssets();
    const rendererCtx = await esbuild.context(rendererOptions);
    const webCtx = await esbuild.context(webOptions);
    await Promise.all([rendererCtx.watch(), webCtx.watch()]);
    for (const asset of ['index.html', 'styles.css']) {
      fs.watchFile(path.join(__dirname, '..', 'src', 'web', asset), { interval: 300 }, copyWebAssets);
    }
    console.log('[esbuild] Watching renderer and web remote...');
  } else {
    await Promise.all([
      esbuild.build(rendererOptions),
      esbuild.build(webOptions),
    ]);
    copyWebAssets();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
