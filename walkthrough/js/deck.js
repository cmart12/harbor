import Reveal from '../node_modules/reveal.js/dist/reveal.esm.js';

// ── Mockup registry ──────────────────────────────────────────────
// Each module in js/mockups/<name>.js exports `init(element)` which renders
// (or re-renders) the interactive widget into the given container element.
// init() must be idempotent — it is called every time the slide is shown so
// animations restart cleanly.
const MOCKUPS = {
  'setup': () => import('./mockups/setup.js'),
  'capture': () => import('./mockups/capture.js'),
  'personas': () => import('./mockups/personas.js'),
  'canvas-comment': () => import('./mockups/canvas-comment.js'),
  'standalone-agent': () => import('./mockups/standalone-agent.js'),
  'skill-editor': () => import('./mockups/skill-editor.js'),
  'scheduler': () => import('./mockups/scheduler.js'),
  'spaces-board': () => import('./mockups/spaces-board.js'),
};

const moduleCache = new Map();

async function activateMockups(slide) {
  if (!slide) return;
  const containers = slide.querySelectorAll('.mockup[data-mockup]');
  for (const el of containers) {
    const name = el.getAttribute('data-mockup');
    const loader = MOCKUPS[name];
    if (!loader) continue;
    try {
      let mod = moduleCache.get(name);
      if (!mod) {
        mod = await loader();
        moduleCache.set(name, mod);
      }
      if (typeof mod.init === 'function') {
        mod.init(el);
      }
    } catch (err) {
      el.innerHTML = `<div class="mockup-error">Widget "${name}" failed to load.</div>`;
      console.error(`[walkthrough] failed to init mockup "${name}"`, err);
    }
  }
}

const deck = new Reveal({
  hash: true,
  history: true,
  controls: true,
  controlsTutorial: true,
  progress: true,
  slideNumber: 'c/t',
  center: false,
  transition: 'slide',
  backgroundTransition: 'fade',
  width: 1280,
  height: 720,
  margin: 0.04,
  minScale: 0.2,
  maxScale: 1.6,
  help: true,
});

deck.initialize().then(() => {
  activateMockups(deck.getCurrentSlide());
});

deck.on('slidechanged', (event) => {
  activateMockups(event.currentSlide);
});
