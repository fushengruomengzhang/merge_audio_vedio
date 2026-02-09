import { writeFile } from 'node:fs/promises';

export async function muxFragments({ initSegment, segments, outputPath }) {
  const buffers = [];

  if (initSegment) {
    buffers.push(initSegment);
  }

  for (const segment of segments) {
    buffers.push(segment);
  }

  const combined = Buffer.concat(buffers);
  await writeFile(outputPath, combined);
  return {
    outputPath,
    size: combined.length,
  };
}
