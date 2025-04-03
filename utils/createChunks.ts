import { PineconeTextRecord } from "../seed-db";

export default function createChunks(
  array: PineconeTextRecord[],
  size: number
) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
