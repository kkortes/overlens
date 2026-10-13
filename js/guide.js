import codie from '/node_modules/@ape-egg/codie/codie.js';

// Snippets either sit inline in their <template> or load from /templates/.
// The compiler mirrors only web assets, so /templates/ rides along via the
// deploy's build command (and dev.js serves it straight from source).
export default () =>
  document.querySelectorAll('[codie]').forEach(async (el) => {
    const editor = codie(el);
    if (el.dataset.src) editor.code = await (await fetch(`/templates/${el.dataset.src}`)).text();
  });
