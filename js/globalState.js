import config from '/js/config.js';
import { loadVariant, ensureDiffs, signIn, signOut } from '/js/github.js';

export default {
  modal: '',
  view: {
    viewport: 'desktop',
    theme: 'light',
    variant: 'desktop-light',
    mode: 'difference',
    onion: 50,
    split: 50,
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
  },
  auth: {
    authed: !!localStorage.getItem('overlens-token'),
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
  setViewport(viewport) {
    this.jumpVariant(`${viewport}-${this.view.theme}`);
  },
  setTheme(theme) {
    this.jumpVariant(`${this.view.viewport}-${theme}`);
  },
  setMode(mode) {
    this.view.mode = mode;
    if (mode === 'difference') ensureDiffs();
  },
  dragSplit(e) {
    e.preventDefault();
    const track = e.currentTarget.parentElement;
    const move = (ev) => {
      const r = track.getBoundingClientRect();
      $.view.split = Math.round(Math.min(100, Math.max(0, ((ev.clientX - r.left) / r.width) * 100)) * 10) / 10;
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    move(e);
  },
};
