import MP4Box from 'mp4box';


import { Parser as M3u8Parser } from "m3u8-parser";

const fetchText = async (fetcher, url) => {
  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(`请求失败: ${response.status} ${response.statusText}`);
  }
  return response.text();
};

const parseM3u8 = (content) => {
  const parser = new M3u8Parser();
  parser.push(content);
  parser.end();
  return parser.manifest;
};

const resolveUrl = (baseUrl, relativeUrl) =>
    new URL(relativeUrl, baseUrl).toString();

const selectLowestBandwidthVariant = (variants) => {
  if (!variants || variants.length === 0) {
    return null;
  }
  return [...variants].sort(
      (a, b) => (a.bandwidth || 0) - (b.bandwidth || 0)
  )[0];
};

const fetchAllVariantManifests = async (fetcher, masterUrl, variants) => {
  const manifestEntries = await Promise.all(
      variants.map(async (variant) => {
        const variantUrl = resolveUrl(masterUrl, variant.uri);
        const content = await fetchText(fetcher, variantUrl);
        return {
          url: variantUrl,
          manifest: parseM3u8(content),
        };
      })
  );

  return manifestEntries;
};

const collectSegmentUrls = (playlistUrl, manifest) => {
  if (!manifest.segments || manifest.segments.length === 0) {
    throw new Error("未找到可下载的分片。");
  }

  const urls = [];
  const mapUri = manifest.segments[0]?.map?.uri;

  if (mapUri) {
    urls.push(resolveUrl(playlistUrl, mapUri));
  }

  urls.push(
      ...manifest.segments.map((segment) =>
          resolveUrl(playlistUrl, segment.uri)
      )
  );

  return urls;
};

const guessMimeType = (segmentUrls) => {
  const lastUrl = segmentUrls[segmentUrls.length - 1] || "";
  if (lastUrl.includes(".m4s") || lastUrl.includes(".mp4")) {
    return "video/mp4";
  }
  if (lastUrl.includes(".ts")) {
    return "video/mp2t";
  }
  return "video/mp4";
};

const downloadSegments = async (fetcher, segmentUrls) => {
  const segments = [];
  for (const segmentUrl of segmentUrls) {
    const response = await fetcher(segmentUrl);
    if (!response.ok) {
      throw new Error(`分片下载失败: ${response.status} ${response.statusText}`);
    }
    segments.push(await response.arrayBuffer());
  }

  return segments;
};

export const downloadLowestQualityVideo = async (
    masterPlaylistUrl,
    fetcher = (input, init) => fetch(input, init)
) => {
  const masterContent = await fetchText(fetcher, masterPlaylistUrl);
  const masterManifest = parseM3u8(masterContent);

  if (masterManifest.playlists && masterManifest.playlists.length > 0) {
    const variantManifests = await fetchAllVariantManifests(
        fetcher,
        masterPlaylistUrl,
        masterManifest.playlists
    );
    const lowestVariant = selectLowestBandwidthVariant(masterManifest.playlists);

    if (!lowestVariant) {
      throw new Error("未找到可用的清晰度列表。");
    }

    const lowestVariantUrl = resolveUrl(masterPlaylistUrl, lowestVariant.uri);
    const lowestManifestEntry = variantManifests.find(
        (entry) => entry.url === lowestVariantUrl
    );

    if (!lowestManifestEntry) {
      throw new Error("无法读取最低清晰度的播放列表。");
    }

    const segmentUrls = collectSegmentUrls(
        lowestManifestEntry.url,
        lowestManifestEntry.manifest
    );

    const segments = await downloadSegments(fetcher, segmentUrls);
    const mimeType = guessMimeType(segmentUrls);
    return new Blob(segments, { type: mimeType });
  }

  const segmentUrls = collectSegmentUrls(masterPlaylistUrl, masterManifest);
  const segments = await downloadSegments(fetcher, segmentUrls);
  const mimeType = guessMimeType(segmentUrls);
  return new Blob(segments, { type: mimeType });
};
