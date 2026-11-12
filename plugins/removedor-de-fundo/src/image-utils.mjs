export function clampByte(value) {
  return Math.min(255, Math.max(0, Math.round(value)));
}

export function refineAlpha(imageData, amount = 0) {
  const factor = 1 + amount / 200;
  const data = new Uint8ClampedArray(imageData.data);

  for (let index = 3; index < data.length; index += 4) {
    data[index] = clampByte((data[index] - 128) * factor + 128);
  }

  return { ...imageData, data };
}

export function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const size = bytes / 1024 ** unitIndex;
  return `${Number(size.toFixed(1))} ${units[unitIndex]}`;
}

