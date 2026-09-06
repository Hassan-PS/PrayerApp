#!/usr/bin/env node
/**
 * Render the site's translated pages, and keep every page's language
 * picker and hreflang block identical.
 *
 *   node scripts/build-site.js          # write docs/<lang>/index.html
 *   node scripts/build-site.js --check  # exit 1 if anything is out of date
 *
 * ── WHY A GENERATOR ───────────────────────────────────────────────────
 *
 * The app speaks thirteen languages and the site spoke one. A translated
 * page is not a nicety here: Google classifies a page by its language, so
 * "Gebetszeiten" and "namaz vakitleri" are queries an English page does
 * not win, however many German words are sprinkled through it.
 *
 * Thirteen hand-written pages, though, is thirteen pages that drift — and
 * the ones that drift silently are the ones nobody on the project can
 * read. So the eleven translations are rendered from ONE template and one
 * strings file. English and Swedish stay hand-written, because they carry
 * content the others do not (the feature list written out in full and the
 * support section; the Islamiska Förbundet timetable and its 108 towns,
 * which is a Swedish answer to a Swedish question and belongs on no other
 * page). The screenshots are NOT one of those things — they were, for a
 * while, and a page describing an app it never shows is a page asking to
 * be taken on faith — so the gallery is generated into all thirteen from
 * the SHOTS list below.
 *
 * What every page must agree about — which languages exist, where they
 * live, and that each declares all the others — is generated into all
 * thirteen, hand-written ones included, between markers. Add a language
 * to strings.json and every page learns about it.
 *
 * ── AND WHY THERE IS NO JAVASCRIPT ────────────────────────────────────
 *
 * The obvious way to send a visitor to their own language is a script
 * that reads navigator.language and redirects. This site does not ship
 * JavaScript, and says so on the privacy section as a claim someone can
 * check. So the picker is a <details> element — a native disclosure, no
 * script — and search engines are told about the translations through
 * reciprocal hreflang, which is how a visitor arriving from a search
 * lands on their own language anyway.
 */
const fs = require('fs');
const path = require('path');
const { shippedVersion } = require('./sync-version');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const STRINGS = path.join(__dirname, 'site', 'strings.json');
const ORIGIN = `https://${fs.readFileSync(path.join(DOCS, 'CNAME'), 'utf-8').trim()}`;

/**
 * Every channel the app ships through, in the order the English page lists
 * them. ONE list, because the translated pages were written with four of
 * the five and quietly dropped Obtainium — the channel that matters most
 * to exactly the audience an F-Droid-friendly app reaches.
 */
const BADGES = [
  {
    img: 'appstore',
    alt: 'App Store',
    href: 'https://apps.apple.com/us/app/prayer-salah-times-qibla/id6762085256',
  },
  {
    img: 'googleplay',
    alt: 'Google Play',
    href: 'https://play.google.com/store/apps/details?id=com.prayer_times',
  },
  {
    img: 'fdroid',
    alt: 'F-Droid',
    href: 'https://f-droid.org/packages/com.prayer_times/',
  },
  {
    img: 'github',
    alt: 'GitHub',
    href: 'https://github.com/Hassan-PS/Mihrab/releases/latest',
  },
  {
    img: 'obtainium',
    alt: 'Obtainium',
    href: 'https://apps.obtainium.imranr.dev/redirect?r=obtainium://app/%7B%22id%22%3A%22com.prayer_times%22%2C%22url%22%3A%22https%3A%2F%2Fgithub.com%2FHassan-PS%2FMihrab%22%2C%22author%22%3A%22Hassan-PS%22%2C%22name%22%3A%22Mihrab%22%7D',
  },
];

/**
 * The screenshot gallery, in the order the English page shows it.
 *
 * The pictures were the one thing the translations did not get: a reader
 * arriving on /tr/ was asked to believe a description of an app nobody had
 * shown them. The images carry no words of ours — the app in the shots
 * speaks English, and that is worth saying rather than hiding — so the
 * only thing a translation has to supply is the alt text and the caption,
 * keyed here so a missing one is an error and not a silently English page.
 */
/*
 * Bumped whenever a shot is retaken, INCLUDING a retake on the same day as
 * the last one — a browser holding the old picture has no way to know the
 * bytes moved under an unchanged URL, and the widget shots have now been
 * retaken twice on 2026-09-06.
 */
const SHOT_V = '?v=2026-09-06.2';
const SHOTS = [
  'home',
  'home-maliki',
  'home-dark',
  'tilawah',
  'reciters',
  'mushaf',
  'mushaf-dark',
  'memorize',
  'quran',
  'qibla',
  'month',
  'month-share',
  'duas',
  'tasbih',
  'log',
  'fasting',
  'widgets',
  'widgets-android',
];

/** Pages written by hand, which the generator only patches between markers. */
const HAND_WRITTEN = {
  en: path.join(DOCS, 'index.html'),
  sv: path.join(DOCS, 'sv', 'index.html'),
};

const esc = s =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The picker: every language, the current one marked, no script. */
function picker(langs, current) {
  const label = langs[current].labels
    ? langs[current].labels.lang
    : current === 'sv'
      ? 'Språk'
      : 'Language';
  const items = Object.entries(langs)
    .map(([code, l]) => {
      const here = code === current;
      const href = l.path;
      return (
        `      <li><a href="${href}" hreflang="${code}" lang="${code}"` +
        (here ? ' aria-current="true"' : '') +
        `>${esc(l.name)}</a></li>`
      );
    })
    .join('\n');
  return `<details class="langpicker">
  <summary>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18"/></svg>
    <span class="lang-label">${esc(label)}</span>
  </summary>
  <ul>
${items}
  </ul>
</details>`;
}

/**
 * The gallery itself — the same pictures in the same order on every page,
 * each with the words of the page it is on. English sits at the root and
 * every other language a directory down, so the only thing that differs
 * between them is how far back up to the assets.
 */
function gallery(code, t) {
  const at = code === 'en' ? 'assets' : '../assets';
  const shot = (id, w, h, alt, cap, cls) =>
    `<figure${cls ? ` class="${cls}"` : ''}>
        <img src="${at}/img/shot-${id}.png${SHOT_V}" width="${w}" height="${h}" loading="lazy" decoding="async"
          alt="${esc(alt)}">
        <figcaption>${esc(cap)}</figcaption>
      </figure>`;
  const items = SHOTS.map(id => {
    const s = t.shots.items[id];
    if (!s) throw new Error(`${code}: no strings for the "${id}" screenshot`);
    return `      <li>${shot(id, 810, 1800, s.alt, s.cap)}</li>`;
  }).join('\n');
  return `    <ul class="gallery">
${items}
    </ul>
    ${shot('spread', 1600, 878, t.shots.spread.alt, t.shots.spread.cap, 'spread')}`;
}

/** Reciprocal hreflang: a page that names only itself is ignored. */
function hreflang(langs) {
  const lines = Object.entries(langs).map(
    ([code, l]) =>
      `<link rel="alternate" hreflang="${code}" href="${ORIGIN}${l.path}">`,
  );
  lines.push(`<link rel="alternate" hreflang="x-default" href="${ORIGIN}/">`);
  return lines.join('\n');
}

/** Replace what is between `<!-- name:start -->` and `<!-- name:end -->`. */
function patchBlock(text, name, body) {
  const re = new RegExp(
    `(<!-- ${name}:start -->\\n)[\\s\\S]*?(<!-- ${name}:end -->)`,
  );
  if (!re.test(text)) throw new Error(`no ${name} markers in the page`);
  return text.replace(re, `$1${body}\n$2`);
}

function ld(obj) {
  return JSON.stringify(obj, null, 2);
}

function renderPage(code, langs, version) {
  const t = langs[code];
  const v = `${version.versionName} (${version.versionCode})`;
  const app = {
    '@context': 'https://schema.org',
    '@type': 'MobileApplication',
    name: 'Mihrab: The Muslim Companion',
    alternateName: 'Mihrab',
    applicationCategory: 'LifestyleApplication',
    operatingSystem: 'Android, iOS, iPadOS, macOS',
    softwareVersion: version.versionName,
    url: `${ORIGIN}${t.path}`,
    inLanguage: code,
    image: `${ORIGIN}/assets/img/og-hero.png?v=2026-09-03`,
    description: t.description,
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    license: 'https://www.gnu.org/licenses/agpl-3.0.html',
    author: {
      '@type': 'Person',
      name: 'Hassan El Ghamri',
      url: 'https://github.com/Hassan-PS',
    },
    sameAs: [
      'https://play.google.com/store/apps/details?id=com.prayer_times',
      'https://apps.apple.com/us/app/prayer-salah-times-qibla/id6762085256',
      'https://f-droid.org/packages/com.prayer_times/',
      'https://github.com/Hassan-PS/Mihrab',
    ],
  };
  const faq = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    inLanguage: code,
    mainEntity: t.faq.items.map(i => ({
      '@type': 'Question',
      name: i.q,
      acceptedAnswer: { '@type': 'Answer', text: i.a },
    })),
  };
  const check =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

  return `<!DOCTYPE html>
<html lang="${code}" dir="${t.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t.title)}</title>
<meta name="description" content="${esc(t.description)}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#1F5F4A" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0E1815" media="(prefers-color-scheme: dark)">
<link rel="canonical" href="${ORIGIN}${t.path}">
<!-- hreflang:start -->
${hreflang(langs)}
<!-- hreflang:end -->
<link rel="icon" href="../assets/img/icon.png" type="image/png">
<link rel="apple-touch-icon" href="../assets/img/icon.png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Mihrab">
<meta property="og:title" content="${esc(t.title)}">
<meta property="og:description" content="${esc(t.description)}">
<meta property="og:url" content="${ORIGIN}${t.path}">
<meta property="og:image" content="${ORIGIN}/assets/img/og-hero.png?v=2026-09-03">
<meta property="og:image:width" content="1600">
<meta property="og:image:height" content="900">
<meta property="og:locale" content="${code}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(t.title)}">
<meta name="twitter:description" content="${esc(t.description)}">
<meta name="twitter:image" content="${ORIGIN}/assets/img/og-hero.png?v=2026-09-03">
<script type="application/ld+json">
${ld(app)}
</script>
<script type="application/ld+json">
${ld(faq)}
</script>
<link rel="stylesheet" href="../assets/site.css">
</head>
<body>
<a class="skip" href="#main">${esc(t.labels.skip)}</a>

<a class="solidarity" href="https://github.com/Safouene1/support-palestine-banner/blob/master/Markdown-pages/Support.md">
  <svg class="flag" width="27" height="18" viewBox="0 0 30 20" aria-hidden="true" focusable="false">
    <rect width="30" height="20" fill="#FFFFFF"/>
    <rect width="30" height="6.67" fill="#000000"/>
    <rect y="13.33" width="30" height="6.67" fill="#007A3D"/>
    <path d="M0 0 L13 10 L0 20 Z" fill="#CE1126"/>
  </svg>
  <span><b>${esc(t.labels.banner)}</b><span class="wide"> ${esc(t.labels.bannerMore)}</span></span>
  <span class="go" aria-hidden="true">&rarr;</span>
</a>

<header class="hero">
  <svg class="hero-art" viewBox="0 0 1200 600" preserveAspectRatio="xMaxYMid slice" aria-hidden="true" focusable="false">
    <g fill="currentColor" opacity=".07">
      <g transform="translate(1010 450)">
        <rect x="-148" y="-148" width="296" height="296" rx="6"/>
        <rect x="-148" y="-148" width="296" height="296" rx="6" transform="rotate(45)"/>
      </g>
    </g>
    <g fill="none" stroke="currentColor" stroke-width="2" opacity=".16">
      <path d="M745 600 V335 Q745 152 905 88 Q1065 152 1065 335 V600"/>
      <path d="M779 600 V344 Q779 186 905 132 Q1031 186 1031 344 V600"/>
    </g>
  </svg>
  <div class="wrap">
    <div class="brandline">
      <img src="../assets/img/icon.png" width="62" height="62" alt="Mihrab">
      <span class="wordmark">Mihrab</span>
<!-- langpicker:start -->
${picker(langs, code)}
<!-- langpicker:end -->
    </div>
    <h1>${esc(t.h1)}</h1>
    <p class="sub">${esc(t.sub)}</p>
    <ul class="trust">
${t.chips.map(c => `      <li>${check}${esc(c)}</li>`).join('\n')}
    </ul>
    <p class="meta">
      <span>${esc(t.labels.version)} ${v}</span> <span class="dot" aria-hidden="true">•</span>
      <span>iOS, Android, macOS</span> <span class="dot" aria-hidden="true">•</span>
      <span>AGPL-3.0-or-later</span> <span class="dot" aria-hidden="true">•</span>
      <a href="https://github.com/Hassan-PS/Mihrab">${esc(t.labels.source)}</a>
    </p>
  </div>
</header>

<main id="main">
<section class="install">
  <div class="wrap">
    <p class="eyebrow">${esc(t.install.eyebrow)}</p>
    <h2>${esc(t.install.h2)}</h2>
    <p class="lede">${esc(t.install.lede)}</p>
    <ul class="badges">
${BADGES.map(
  ba => `      <li><a href="${ba.href}"><img src="../assets/img/badges/${ba.img}.png" width="564" height="168" alt="${ba.alt}"></a></li>`,
).join('\n')}
    </ul>
    <p class="note">${esc(t.install.brew)} <code>brew install --cask hassan-ps/tap/mihrab</code></p>
  </div>
</section>

<section class="features">
  <div class="wrap">
    <p class="eyebrow">${esc(t.features.eyebrow)}</p>
    <h2>${esc(t.features.h2)}</h2>
    <div class="cols">
${t.features.cards
  .map(
    c => `      <article class="card">
        <h3>${esc(c.h3)}</h3>
        <p>${esc(c.p)}</p>
      </article>`,
  )
  .join('\n')}
    </div>
  </div>
</section>

<section class="shots" id="screenshots">
  <div class="wrap">
    <p class="eyebrow">${esc(t.shots.eyebrow)}</p>
    <h2>${esc(t.shots.h2)}</h2>
    <p class="lede">${esc(t.shots.lede)}</p>
${gallery(code, t)}
  </div>
</section>

<section class="privacy">
  <div class="wrap">
    <p class="eyebrow">${esc(t.privacy.eyebrow)}</p>
    <h2>${esc(t.privacy.h2)}</h2>
    <p class="lede">${esc(t.privacy.lede)}</p>
    <div class="cols">
${t.privacy.cards
  .map(
    c => `      <article class="card">
        <h3>${esc(c.h3)}</h3>
        <p>${esc(c.p)}</p>
      </article>`,
  )
  .join('\n')}
    </div>
  </div>
</section>

<section class="faq">
  <div class="wrap">
    <p class="eyebrow">${esc(t.faq.eyebrow)}</p>
    <h2>${esc(t.faq.h2)}</h2>
    <div class="cols">
${t.faq.items
  .map(
    i => `      <article class="card">
        <h3>${esc(i.q)}</h3>
        <p>${esc(i.a)}</p>
      </article>`,
  )
  .join('\n')}
    </div>
  </div>
</section>
</main>

<footer>
  <div class="wrap">
    <div class="foot-grid">
      <div>
        <h2>${esc(t.footer.licence.h2)}</h2>
        <p>${esc(t.footer.licence.p)}</p>
      </div>
      <div>
        <h2>${esc(t.footer.content.h2)}</h2>
        <p>${esc(t.footer.content.p)}</p>
      </div>
      <div>
        <h2>${esc(t.footer.project.h2)}</h2>
        <ul>
          <li><a href="https://github.com/Hassan-PS/Mihrab/issues">${esc(t.footer.project.issues)}</a></li>
          <li><a href="https://github.com/Hassan-PS/Mihrab/blob/main/CHANGELOG.md">${esc(t.footer.project.changelog)}</a></li>
        </ul>
      </div>
    </div>
    <p class="colophon">${esc(t.labels.built.replace('{v}', v))}</p>
  </div>
</footer>
</body>
</html>
`;
}

/** The sitemap: every language, each naming all the others. */
function sitemap(langs) {
  const alts = Object.entries(langs)
    .map(
      ([code, l]) =>
        `    <xhtml:link rel="alternate" hreflang="${code}" href="${ORIGIN}${l.path}"/>`,
    )
    .join('\n');
  const entries = Object.entries(langs)
    .map(
      ([code, l]) => `  <url>
    <loc>${ORIGIN}${l.path}</loc>
${alts}
    <xhtml:link rel="alternate" hreflang="x-default" href="${ORIGIN}/"/>
    <changefreq>weekly</changefreq>
    <priority>${code === 'en' ? '1.0' : '0.9'}</priority>
  </url>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries}
</urlset>
`;
}

function build() {
  const langs = JSON.parse(fs.readFileSync(STRINGS, 'utf-8'));
  const version = shippedVersion();
  const files = new Map();

  for (const [code, l] of Object.entries(langs)) {
    if (HAND_WRITTEN[code]) {
      const file = HAND_WRITTEN[code];
      let text = fs.readFileSync(file, 'utf-8');
      text = patchBlock(text, 'hreflang', hreflang(langs));
      text = patchBlock(text, 'langpicker', picker(langs, code));
      text = patchBlock(text, 'gallery', gallery(code, l));
      files.set(file, text);
      continue;
    }
    if (!l.h1) throw new Error(`${code}: no strings, and no hand-written page`);
    files.set(
      path.join(DOCS, code, 'index.html'),
      renderPage(code, langs, version),
    );
  }
  files.set(path.join(DOCS, 'sitemap.xml'), sitemap(langs));
  return files;
}

if (require.main === module) {
  const check = process.argv.includes('--check');
  const files = build();
  const stale = [];
  for (const [file, text] of files) {
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null;
    if (current === text) continue;
    stale.push(path.relative(ROOT, file));
    if (!check) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    }
  }
  if (!stale.length) {
    console.log(`✓ site is current (${files.size} files)`);
  } else if (check) {
    console.error(`✗ out of date: ${stale.join(', ')}`);
    console.error('  Fix with: node scripts/build-site.js');
    process.exit(1);
  } else {
    console.log(`✓ wrote ${stale.length} file(s):`);
    for (const s of stale) console.log(`  ${s}`);
  }
}

module.exports = { build, picker, hreflang, gallery, ORIGIN, SHOTS, SHOT_V };
