import MP4Box from 'mp4box';


import { Parser as M3u8Parser } from "m3u8-parser";

const readSamplesFromBuffer = (buffer) =>
    new Promise((resolve, reject) => {
      const mp4boxfile = MP4Box.createFile();
      let info = null;
      const samplesByTrack = new Map();
      const expectedSamples = new Map();
      const receivedSamples = new Map();
      let pendingTracks = 0;

      mp4boxfile.onError = (error) => reject(error);

      mp4boxfile.onReady = (readyInfo) => {
        info = readyInfo;
        readyInfo.tracks.forEach((track) => {
          samplesByTrack.set(track.id, []);
          expectedSamples.set(track.id, track.nb_samples || 0);
          receivedSamples.set(track.id, 0);
          pendingTracks += 1;
          mp4boxfile.setExtractionOptions(track.id, null, {
            nbSamples: track.nb_samples || 0,
          });
        });
        mp4boxfile.start();
      };

      mp4boxfile.onSamples = (id, _user, samples) => {
        const stored = samplesByTrack.get(id) ?? [];
        stored.push(...samples);
        samplesByTrack.set(id, stored);

        const updatedCount = (receivedSamples.get(id) || 0) + samples.length;
        receivedSamples.set(id, updatedCount);

        const expected = expectedSamples.get(id) || 0;
        if (expected === 0 || updatedCount >= expected) {
          pendingTracks = Math.max(0, pendingTracks - 1);
        }

        if (pendingTracks === 0 && info) {
          resolve({ info, samplesByTrack });
        }
      };

      const arrayBuffer = buffer;
      arrayBuffer.fileStart = 0;
      mp4boxfile.appendBuffer(arrayBuffer);
      mp4boxfile.flush();

      setTimeout(() => {
        if (info && pendingTracks === 0) {
          resolve({ info, samplesByTrack });
        }
      }, 0);
    });

const findTrack = (info, type) =>
    info.tracks.find((track) => track.type === type);

const addSampleToFile = (outputFile, trackId, sample) => {
  if (!sample || !sample.data) {
    throw new Error("样本数据缺失，无法写入输出文件。");
  }

  if (outputFile.addSample.length >= 3) {
    const data =
        sample.data instanceof Uint8Array
            ? sample.data
            : new Uint8Array(sample.data);
    outputFile.addSample(trackId, data, {
      duration: sample.duration,
      dts: sample.dts,
      cts: sample.cts,
      is_sync: sample.is_sync,
      size: sample.size,
      flags: sample.flags,
    });
    return;
  }

  outputFile.addSample(trackId, sample);
};

const buildOutputFile = (videoTrack, videoSamples, audioTrack, audioSamples) => {
  const outputFile = MP4Box.createFile();
  const outputVideoId = outputFile.addTrack(videoTrack);
  const outputAudioId = outputFile.addTrack(audioTrack);

  videoSamples.forEach((sample) =>
      addSampleToFile(outputFile, outputVideoId, sample)
  );
  audioSamples.forEach((sample) =>
      addSampleToFile(outputFile, outputAudioId, sample)
  );

  if (typeof outputFile.write === "function") {
    return outputFile.write();
  }
  if (typeof outputFile.save === "function") {
    return outputFile.save();
  }
  throw new Error("当前 mp4box.js 版本未提供输出接口。");
};

export const mergeAudioIntoVideo = async (videoBuffer, audioBuffer) => {
  if (typeof MP4Box === "undefined") {
    throw new Error("MP4Box.js 未加载，请确认已引入 mp4box.all.min.js。");
  }

  const [videoResult, audioResult] = await Promise.all([
    readSamplesFromBuffer(videoBuffer),
    readSamplesFromBuffer(audioBuffer),
  ]);

  const videoTrack = findTrack(videoResult.info, "video");
  const audioTrack = findTrack(audioResult.info, "audio");

  if (!videoTrack || !audioTrack) {
    throw new Error("未检测到视频或音频轨道，请检查文件格式。");
  }

  const videoSamples = videoResult.samplesByTrack.get(videoTrack.id) || [];
  const audioSamples = audioResult.samplesByTrack.get(audioTrack.id) || [];

  const outputBuffer = buildOutputFile(
      videoTrack,
      videoSamples,
      audioTrack,
      audioSamples
  );

  return new Blob([outputBuffer], { type: "video/mp4" });
};

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
