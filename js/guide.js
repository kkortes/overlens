import codie from '/node_modules/@ape-egg/codie/codie.js';

// The compiler mirrors only web assets, so the integration templates aren't
// part of the build — they're read from this site's own repo, the same way
// the inspector reads everything else.
export default () =>
  document.querySelectorAll('[codie][data-src]').forEach(async (el) => {
    const editor = codie(el);
    const res = await fetch(`https://raw.githubusercontent.com/kkortes/overlens/main/templates/${el.dataset.src}`);
    editor.code = await res.text();
  });
