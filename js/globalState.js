import config from '/js/config.js';
import { loadVariant, ensureDiffs, signIn, signOut, signedIn } from '/js/github.js';

export default {
  modal: '',
  view: {
    viewport: '',
    theme: '',
    variant: '',
    mode: 'difference',
    blend: 50,
    fit: localStorage.getItem('overlens-fit') !== 'scroll',
  },
  inspector: {
    phase: 'idle',
    error: '',
    owner: '',
    repo: '',
    pr: 0,
    headSha: '',
    baseSha: '',
    drift: false,
    report: null,
    pages: [],
    passes: [],
    viewports: [],
    themes: [],
  },
  auth: {
    authed: signedIn(),
    configured: !!config.clientId,
    appSlug: config.appSlug,
    error: '',
  },

  signIn() {
    signIn();
  },
  signOut() {
    signOut();
  },
  jumpVariant(variant) {
    const [viewport, theme] = variant.split('-');
    Object.assign(this.view, { viewport, theme, variant });
    loadVariant(variant);
  },
  jumpDevice(name, viewport) {
    const { variants } = this.inspector.pages.find((p) => p.name === name);
    const same = `${viewport}-${this.view.theme}`;
    this.jumpVariant(variants[same] ? same : Object.keys(variants).find((k) => k.startsWith(viewport)));
  },
  // A pass grid can be sparse (desktop-dark + desktop-light + mobile-light):
  // when the straight swap doesn't exist, land on that axis' first pass.
  setViewport(viewport) {
    const { passes } = this.inspector;
    const same = `${viewport}-${this.view.theme}`;
    this.jumpVariant(passes.includes(same) ? same : passes.find((p) => p.startsWith(`${viewport}-`)));
  },
  setTheme(theme) {
    const { passes } = this.inspector;
    const same = `${this.view.viewport}-${theme}`;
    this.jumpVariant(passes.includes(same) ? same : passes.find((p) => p.endsWith(`-${theme}`)));
  },
  setMode(mode) {
    this.view.mode = mode;
    this.view.blend = 50;
    if (mode === 'difference') ensureDiffs();
  },
  toggleFit() {
    this.view.fit = !this.view.fit;
    localStorage.setItem('overlens-fit', this.view.fit ? 'fit' : 'scroll');
  },
  // Anywhere on the stack drives the blend. A mouse press lands on the spot
  // it clicked; a finger has to travel sideways first, since the same surface
  // pans the page vertically and touch-action hands us the gesture mid-swipe.
  dragBlend(e) {
    e.preventDefault();
    const track = e.currentTarget;
    let sliding = e.pointerType === 'mouse';
    const move = (ev) => {
      if (!sliding && Math.abs(ev.clientX - e.clientX) < 4) return;
      sliding = true;
      const r = track.getBoundingClientRect();
      $.view.blend = Math.round(Math.min(100, Math.max(0, ((ev.clientX - r.left) / r.width) * 100)) * 10) / 10;
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
    if (sliding) move(e);
  },
};
