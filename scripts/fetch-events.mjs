// Fetches upcoming events for each artist in data/artists.json from two
// sources — Bandsintown and Ticketmaster's Discovery API — keeps only
// events in cities listed in data/cities.json, merges + de-dupes across
// both sources, and writes data/events.json.
//
// Bandsintown's API accepts any app_id string for low-volume/testing use;
// for production reliability, register a free app_id at bandsintown.com
// and set it via the BANDSINTOWN_APP_ID env var / repo secret.
//
// Ticketmaster's Discovery API requires a real key — there's no
// keyless/anonymous tier. Get a free one at
// https://developer.ticketmaster.com/ (Consumer Key, under "My Apps")
// and set it via the TICKETMASTER_API_KEY env var / repo secret. If
// that variable is unset, this script just skips the Ticketmaster pass
// and runs on Bandsintown alone — it won't crash the build.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");

const BANDSINTOWN_APP_ID =
  process.env.BANDSINTOWN_APP_ID || "marquee-hiphop-rnb-aggregator";
const TICKETMASTER_API_KEY = process.env.TICKETMASTER_API_KEY || null;
const REQUEST_DELAY_MS = 250; // be polite to both APIs between calls

function normalizeCity(name) {
  return name.trim().toLowerCase().replace(/^st\.?\s/, "saint ");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchBandsintownArtistEvents(artist) {
  const url = `https://rest.bandsintown.com/artists/${encodeURIComponent(
    artist
  )}/events?app_id=${encodeURIComponent(BANDSINTOWN_APP_ID)}&date=upcoming`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status !== 404) {
        console.warn(`  [bandsintown:${artist}] HTTP ${res.status}`);
      }
      return [];
    }
    const body = await res.json();
    if (!Array.isArray(body)) return [];

    // Normalize to a common shape shared with the Ticketmaster fetcher.
    return body.map((ev) => ({
      source: "bandsintown",
      sourceId: ev.id,
      dateTime: ev.datetime,
      venueName: ev.venue?.name || "TBA",
      venueCity: ev.venue?.city || "",
      venueRegion: ev.venue?.region || "",
      venueCountry: ev.venue?.country || "",
      eventUrl: ev.url,
      lineup: Array.isArray(ev.lineup) && ev.lineup.length ? ev.lineup : [artist],
    }));
  } catch (err) {
    console.warn(`  [bandsintown:${artist}] fetch failed: ${err.message}`);
    return [];
  }
}

async function fetchTicketmasterArtistEvents(artist) {
  if (!TICKETMASTER_API_KEY) return [];

  const url =
    `https://app.ticketmaster.com/discovery/v2/events.json` +
    `?apikey=${encodeURIComponent(TICKETMASTER_API_KEY)}` +
    `&keyword=${encodeURIComponent(artist)}` +
    `&countryCode=US&classificationName=Music&size=200`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      // 401/403 almost always means a bad/missing key — worth surfacing.
      console.warn(`  [ticketmaster:${artist}] HTTP ${res.status}`);
      return [];
    }
    const body = await res.json();
    const events = body?._embedded?.events || [];

    return events.map((ev) => {
      const venue = ev._embedded?.venues?.[0] || {};
      return {
        source: "ticketmaster",
        sourceId: ev.id,
        dateTime: ev.dates?.start?.dateTime || ev.dates?.start?.localDate,
        venueName: venue.name || "TBA",
        venueCity: venue.city?.name || "",
        venueRegion: venue.state?.stateCode || venue.state?.name || "",
        venueCountry: venue.country?.countryCode === "US" ? "United States" : venue.country?.name || "",
        eventUrl: ev.url, // Ticketmaster's own event page
        lineup: ev._embedded?.attractions?.length
          ? ev._embedded.attractions.map((a) => a.name)
          : [artist],
      };
    });
  } catch (err) {
    console.warn(`  [ticketmaster:${artist}] fetch failed: ${err.message}`);
    return [];
  }
}

async function main() {
  const cities = JSON.parse(
    await readFile(path.join(DATA_DIR, "cities.json"), "utf8")
  );
  const artists = JSON.parse(
    await readFile(path.join(DATA_DIR, "artists.json"), "utf8")
  );

  const cityIndex = new Map();
  for (const c of cities) {
    cityIndex.set(`${normalizeCity(c.city)}|${c.state.toLowerCase()}`, c);
  }

  const events = [];
  const seenSourceIds = new Set(); // exact duplicate calls within one source
  const seenCrossSourceKeys = new Set(); // same real-world show seen via both APIs

  console.log(
    `Fetching events for ${artists.length} artists from Bandsintown` +
      (TICKETMASTER_API_KEY ? " + Ticketmaster..." : " (Ticketmaster skipped — no TICKETMASTER_API_KEY set)...")
  );

  for (const artist of artists) {
    const [bandsintownEvents, ticketmasterEvents] = await Promise.all([
      fetchBandsintownArtistEvents(artist),
      fetchTicketmasterArtistEvents(artist),
    ]);

    // Ticketmaster's venue/date data tends to be cleaner (it's the venue's
    // own ticketing partner), so process it first — when both sources
    // report the same real-world show, the Ticketmaster version wins.
    for (const ev of [...ticketmasterEvents, ...bandsintownEvents]) {
      const region = (ev.venueRegion || "").trim();
      const stateAbbrevGuess = region.length === 2 ? region.toUpperCase() : null;
      const key1 = `${normalizeCity(ev.venueCity)}|${(stateAbbrevGuess || "").toLowerCase()}`;

      let matchedCity = cityIndex.get(key1);
      if (!matchedCity) {
        for (const c of cities) {
          if (normalizeCity(c.city) === normalizeCity(ev.venueCity)) {
            matchedCity = c;
            break;
          }
        }
      }
      if (!matchedCity) continue;
      if (ev.venueCountry && ev.venueCountry !== "United States") continue;

      const sourceKey = `${ev.source}:${ev.sourceId}`;
      if (seenSourceIds.has(sourceKey)) continue;
      seenSourceIds.add(sourceKey);

      // Cross-source de-dupe: same artist, same day, same city is almost
      // certainly the same show reported by both APIs.
      const dayKey = (ev.dateTime || "").slice(0, 10);
      const crossKey = `${normalizeCity(artist)}|${dayKey}|${matchedCity.slug}`;
      if (seenCrossSourceKeys.has(crossKey)) continue;
      seenCrossSourceKeys.add(crossKey);

      events.push({
        id: sourceKey,
        source: ev.source,
        artist,
        date: ev.dateTime,
        venueName: ev.venueName,
        venueCity: matchedCity.city,
        venueState: matchedCity.state,
        citySlug: matchedCity.slug,
        eventUrl: ev.eventUrl, // official event page, not a "buy tickets" deep link
        lineup: ev.lineup?.length ? ev.lineup : [artist],
      });
    }

    await sleep(REQUEST_DELAY_MS);
  }

  events.sort((a, b) => new Date(a.date) - new Date(b.date));

  await writeFile(
    path.join(DATA_DIR, "events.json"),
    JSON.stringify(
      { generatedAt: new Date().toISOString(), events },
      null,
      2
    )
  );

  console.log(`Wrote ${events.length} matched events to data/events.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
