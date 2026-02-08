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

const buildOutputFile = (videoTrack, videoSamples, audioTrack, audioSamples) => {
  const outputFile = MP4Box.createFile();
  const outputVideoId = outputFile.addTrack(videoTrack);
  const outputAudioId = outputFile.addTrack(audioTrack);

  videoSamples.forEach((sample) => outputFile.addSample(outputVideoId, sample));
  audioSamples.forEach((sample) => outputFile.addSample(outputAudioId, sample));

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
