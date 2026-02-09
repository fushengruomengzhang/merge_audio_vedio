#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseM3U8 } from './m3u8-parse.js';
import { muxFragments } from './mp4box.js';

const DEFAULT_URL =
  'https://video.twimg.com/ext_tw_video/2019181308287807490/pu/pl/CkeCypAx89LKucYL.m3u8?variant_version=1&tag=12&v=cfc';

function proxyFetch(url, proxy = true) {
  if (!proxy) {
    return fetch(url);
  }
  const params = { method: 'GET', url };
  const proxyUrl = 'https://fetch-help.fushengruomengzhang.workers.dev';
  const init = { method: 'POST', body: JSON.stringify(params) };
  return fetch(proxyUrl, init);
}

function toAbsoluteUrl(baseUrl, relative) {
  try {
    return new URL(relative, baseUrl).toString();
  } catch {
    return relative;
  }
}

async function fetchText(url) {
  const response = await proxyFetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

async function fetchBinary(url) {
  const response = await proxyFetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function pickHighestBandwidth(playlists) {
  if (!playlists.length) {
    return null;
  }
  const sorted = [...playlists].sort((a, b) => {
    const bandwidthA = Number(a.attributes?.BANDWIDTH ?? 0);
    const bandwidthB = Number(b.attributes?.BANDWIDTH ?? 0);
    return bandwidthB - bandwidthA;
  });
  return sorted[0];
}

async function resolveMediaPlaylist(url) {
  const playlistText = await fetchText(url);
  const parsed = parseM3U8(playlistText);
  if (parsed.isMaster) {
    const picked = pickHighestBandwidth(parsed.playlists);
    if (!picked) {
      throw new Error('No media playlists found in master playlist.');
    }
    const nextUrl = toAbsoluteUrl(url, picked.uri);
    return resolveMediaPlaylist(nextUrl);
  }
  return { url, parsed };
}

async function downloadSegments({ playlistUrl, parsed }) {
  const segmentUrls = parsed.segments.map((segment) =>
    toAbsoluteUrl(playlistUrl, segment.uri)
  );

  const initSegmentUrl = parsed.map?.uri
    ? toAbsoluteUrl(playlistUrl, parsed.map.uri)
    : null;

  const initSegment = initSegmentUrl ? await fetchBinary(initSegmentUrl) : null;
  const segments = [];

  for (const segmentUrl of segmentUrls) {
    segments.push(await fetchBinary(segmentUrl));
  }

  return { initSegment, segments };
}

async function main() {
  const inputUrl = process.argv[2] ?? DEFAULT_URL;
  const outputPath = process.argv[3] ?? 'output.mp4';
  const resolvedOutputPath = resolve(outputPath);

  const { url: mediaPlaylistUrl, parsed } = await resolveMediaPlaylist(inputUrl);
  const { initSegment, segments } = await downloadSegments({
    playlistUrl: mediaPlaylistUrl,
    parsed,
  });

  await mkdir(dirname(resolvedOutputPath), { recursive: true });

  if (initSegment) {
    const { size } = await muxFragments({
      initSegment,
      segments,
      outputPath: resolvedOutputPath,
    });
    console.log(`Saved MP4 (fMP4) to ${resolvedOutputPath} (${size} bytes).`);
    return;
  }

  const combined = Buffer.concat(segments);
  await writeFile(resolvedOutputPath, combined);
  console.log(`Saved TS to ${resolvedOutputPath} (${combined.length} bytes).`);
}

const runningAsScript = fileURLToPath(import.meta.url) === process.argv[1];
if (runningAsScript) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
