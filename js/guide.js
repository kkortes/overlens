import codie from '/node_modules/@ape-egg/codie/codie.js';

// Snippets either sit inline in their <template> or load from /templates/ —
// the npm package's own templates. The compiler mirrors only web assets, so
// they ride along via the deploy's build command (and dev.js serves them
// straight from package/templates).
export default () =>
  document.querySelectorAll('[codie]').forEach(async (el) => {
    const editor = codie(el);
    if (el.dataset.src) editor.code = await (await fetch(`/templates/${el.dataset.src}`)).text();
  });
