(function () {
  const SUPPORTED = ['fr', 'en'];
  const DEFAULT_LANG = 'fr';

  function detectLang() {
    const stored = localStorage.getItem('preferred-lang');
    if (stored && SUPPORTED.includes(stored)) return stored;

    const c = navigator.languages ? [...navigator.languages] : [navigator.language || DEFAULT_LANG];
    for (const l of c) {
      const code = l.split('-')[0].toLowerCase();
      if (SUPPORTED.includes(code)) return code;
    }
    return DEFAULT_LANG;
  }

  async function applyLang(lang) {
    let dict;
    try {
      const res = await fetch('./locales/' + lang + '.json');
      if (!res.ok) throw new Error();
      dict = await res.json();
    } catch {
      try {
        dict = await (await fetch('./locales/' + DEFAULT_LANG + '.json')).json();
      } catch {
        return;
      }
    }

    function get(key) {
      return key.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : null), dict);
    }

    document.querySelectorAll('[data-i18n]').forEach(el => {
      const v = get(el.getAttribute('data-i18n'));
      if (v !== null && !el.hasAttribute('data-i18n-html') && !el.hasAttribute('data-i18n-attr')) {
        el.textContent = v;
      }
    });

    document.querySelectorAll('[data-i18n-html]').forEach(el => {
      const v = get(el.getAttribute('data-i18n-html'));
      if (v !== null) el.innerHTML = v;
    });

    document.querySelectorAll('[data-i18n-attr]').forEach(el => {
      const attr = el.getAttribute('data-i18n-attr');
      const v = get(el.getAttribute('data-i18n'));
      if (attr && v !== null) el.setAttribute(attr, v);
    });

    document.querySelectorAll('[data-i18n-video]').forEach(el => {
      const v = get(el.getAttribute('data-i18n-video'));
      if (v !== null) {
        const source = el.querySelector('source');
        if (source) {
          source.setAttribute('src', v);
        }
        el.load();
      }
    });

    document.documentElement.lang = dict.lang || lang;

    const t = document.querySelector('title');
    if (t && dict.meta?.title) t.textContent = dict.meta.title;

    const d = document.querySelector('meta[name="description"]');
    if (d && dict.meta?.description) d.content = dict.meta.description;

    localStorage.setItem('preferred-lang', lang);

    const nextLang = lang === 'fr' ? 'en' : 'fr';
    document.querySelectorAll('.lang-toggle').forEach(btn => {
      btn.setAttribute('data-lang', nextLang);
      btn.textContent = nextLang.toUpperCase();
    });
  }

  window.switchLang = function (newLang) {
    if (SUPPORTED.includes(newLang)) {
      applyLang(newLang);
    }
  };

  const initialLang = detectLang();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => applyLang(initialLang));
  } else {
    applyLang(initialLang);
  }
})();
