const esbuild = require('esbuild');
const path = require('path');

const watch = process.argv.includes('--watch');
const minify = !watch;

const buildOptions = {
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
  },
  logLevel: 'info',
};

async function main() {
  if (watch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log('[esbuild] Watching renderer...');
  } else {
    await esbuild.build(buildOptions);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
