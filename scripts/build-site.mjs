import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const DOCS_DIR = path.join(ROOT, "docs");

const SITE_NAME = "MARQUEE";
const SITE_TAGLINE =
  "Every hip hop and R&B show worth catching, city by city. We link straight to the show — never a ticket funnel.";
const SITE_URL = "https://example.github.io/marquee"; // replace after you know your repo's Pages URL

const MONTHS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

function escapeHtml(str = "") {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDateParts(iso) {
  const d = new Date(iso);
  return { day: d.getDate(), month: MONTHS[d.getMonth()] };
}

function layout({ title, description, canonical, bodyClass = "", content }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${canonical}">
<link rel="stylesheet" href="/assets/style.css">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:type" content="website">
</head>
<body class="${bodyClass}">
<header class="site-header">
  <div class="wrap">
    <a class="wordmark" href="/">MAR<span>QUEE</span></a>
    <nav class="site-nav">
      <a href="/">Cities</a>
    </nav>
  </div>
</header>
${content}
<footer class="site-footer">
  <div class="wrap">
    <p>${SITE_NAME} aggregates publicly listed show dates. Always confirm details on the venue or artist's own event page before you go.</p>
  </div>
</footer>
</body>
</html>`;
}

function adSlot(label) {
  return `<div class="ad-slot">${escapeHtml(label)}</div>`;
}

function showRow(ev) {
  const { day, month } = formatDateParts(ev.date);
  const artistLine =
    ev.lineup && ev.lineup.length > 1
      ? ev.lineup.join(", ")
      : ev.artist;

  return `<div class="show-row">
    <div class="show-date"><span class="day">${day}</span><span class="month">${month}</span></div>
    <div class="show-main">
      <p class="artist">${escapeHtml(artistLine)}</p>
      <p class="venue">${escapeHtml(ev.venueName)} — ${escapeHtml(ev.venueCity)}, ${escapeHtml(ev.venueState)}</p>
    </div>
    <a class="show-link" href="${ev.eventUrl}" rel="nofollow">See event</a>
  </div>`;
}

async function buildHomepage(cities, eventsByCity) {
  const byState = new Map();
  for (const c of cities) {
    if (!byState.has(c.state)) byState.set(c.state, []);
    byState.get(c.state).push(c);
  }

  const states = [...byState.keys()].sort();

  const groups = states
    .map((state) => {
      const citiesInState = byState.get(state);
      const links = citiesInState
        .map(
          (c) =>
            `<a href="/cities/${c.slug}/">${escapeHtml(c.city)}${
              eventsByCity.get(c.slug)?.length
                ? ` (${eventsByCity.get(c.slug).length})`
                : ""
            }</a>`
        )
        .join("");
      return `<div class="state-group">
        <div class="state-name">${state}</div>
        <div class="cities">${links}</div>
      </div>`;
    })
    .join("\n");

  const content = `
<section class="hero">
  <div class="wrap">
    <h1>Find the <em>show</em>, skip the checkout page.</h1>
    <p>${SITE_TAGLINE}</p>
  </div>
</section>
<section class="directory">
  <div class="wrap">
    <h2>Pick a city</h2>
    ${groups}
    ${adSlot("Ad space — homepage, below city directory")}
  </div>
</section>`;

  const html = layout({
    title: `${SITE_NAME} — Hip Hop & R&B Shows Across the US`,
    description: SITE_TAGLINE,
    canonical: `${SITE_URL}/`,
    content,
  });

  await writeFile(path.join(DOCS_DIR, "index.html"), html);
}

async function buildCityPage(city, events) {
  const dir = path.join(DOCS_DIR, "cities", city.slug);
  await mkdir(dir, { recursive: true });

  const rows =
    events.length > 0
      ? events.map(showRow).join("\n")
      : `<div class="empty-state">No upcoming shows matched for ${escapeHtml(
          city.city
        )} right now — check back soon, or <a href="/">browse another city</a>.</div>`;

  const content = `
<section class="city-head">
  <div class="wrap">
    <p class="eyebrow">${city.state}</p>
    <h1>${escapeHtml(city.city)}</h1>
  </div>
</section>
<section class="listing">
  <div class="wrap">
    ${rows}
    ${events.length > 4 ? adSlot("Ad space — mid-listing") : ""}
  </div>
</section>`;

  const html = layout({
    title: `Hip Hop & R&B Shows in ${city.city}, ${city.state} — ${SITE_NAME}`,
    description: `Upcoming hip hop and R&B concerts in ${city.city}, ${city.state}. Direct links to each show.`,
    canonical: `${SITE_URL}/cities/${city.slug}/`,
    content,
  });

  await writeFile(path.join(dir, "index.html"), html);
}

async function buildSitemap(cities) {
  const urls = [
    `${SITE_URL}/`,
    ...cities.map((c) => `${SITE_URL}/cities/${c.slug}/`),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n")}
</urlset>`;
  await writeFile(path.join(DOCS_DIR, "sitemap.xml"), xml);
  await writeFile(
    path.join(DOCS_DIR, "robots.txt"),
    `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`
  );
}

async function main() {
  const cities = JSON.parse(
    await readFile(path.join(DATA_DIR, "cities.json"), "utf8")
  );

  let eventsData = { events: [] };
  try {
    eventsData = JSON.parse(
      await readFile(path.join(DATA_DIR, "events.json"), "utf8")
    );
  } catch {
    console.warn("No data/events.json yet — run fetch-events.mjs first. Building empty shell.");
  }

  const eventsByCity = new Map();
  for (const ev of eventsData.events) {
    if (!eventsByCity.has(ev.citySlug)) eventsByCity.set(ev.citySlug, []);
    eventsByCity.get(ev.citySlug).push(ev);
  }

  await mkdir(DOCS_DIR, { recursive: true });
  await mkdir(path.join(DOCS_DIR, "assets"), { recursive: true });

  await buildHomepage(cities, eventsByCity);
  for (const city of cities) {
    await buildCityPage(city, eventsByCity.get(city.slug) || []);
  }
  await buildSitemap(cities);

  console.log(`Built homepage + ${cities.length} city pages.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
