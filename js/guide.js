import codie from '/node_modules/@ape-egg/codie/codie.js';

// The compiler mirrors only web assets, so /templates/ rides along via the
// deploy's build command (and dev.js serves it straight from source).
export default () =>
  document.querySelectorAll('[codie][data-src]').forEach(async (el) => {
    const editor = codie(el);
    editor.code = await (await fetch(`/templates/${el.dataset.src}`)).text();
  });
