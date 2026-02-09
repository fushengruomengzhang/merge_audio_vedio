export function parseAttributes(attributeLine) {
  const attributes = {};
  const regex = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  let match = null;
  while ((match = regex.exec(attributeLine)) !== null) {
    const key = match[1];
    let value = match[2];
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    attributes[key] = value;
  }
  return attributes;
}

export function parseM3U8(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#EXT-X-SESSION-DATA'));

  const playlists = [];
  const segments = [];
  let map = null;
  let isMaster = false;
  let pendingStreamInfo = null;
  let pendingDuration = null;

  for (const line of lines) {
    if (line.startsWith('#EXT-X-STREAM-INF')) {
      isMaster = true;
      const attributes = parseAttributes(line.split(':')[1] ?? '');
      pendingStreamInfo = attributes;
      continue;
    }

    if (line.startsWith('#EXTINF')) {
      const duration = Number(line.split(':')[1]?.split(',')[0] ?? 0);
      pendingDuration = Number.isNaN(duration) ? null : duration;
      continue;
    }

    if (line.startsWith('#EXT-X-MAP')) {
      const attributes = parseAttributes(line.split(':')[1] ?? '');
      if (attributes.URI) {
        map = { uri: attributes.URI, byterange: attributes.BYTERANGE ?? null };
      }
      continue;
    }

    if (line.startsWith('#')) {
      continue;
    }

    if (pendingStreamInfo) {
      playlists.push({
        uri: line,
        attributes: pendingStreamInfo,
      });
      pendingStreamInfo = null;
      continue;
    }

    segments.push({
      uri: line,
      duration: pendingDuration,
    });
    pendingDuration = null;
  }

  return {
    isMaster,
    playlists,
    segments,
    map,
  };
}
