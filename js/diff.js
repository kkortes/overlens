// Client-side pixel diff over the union canvas of both images: mismatching
// pixels (per-channel tolerance ~2%, like the workflow's fuzz) paint red over
// a dimmed base. Areas only one image covers — height or width deltas — are
// no comparison at all: they render dimmed like matching pixels, so only
// overlapping content can go red — mirroring the workflow's diffPercent,
// which counts mismatches within the shared area only.
const TOLERANCE = 255 * 0.02;

export default async (baseBlob, headBlob) => {
  const [base, head] = await Promise.all([createImageBitmap(baseBlob), createImageBitmap(headBlob)]);
  const w = Math.max(base.width, head.width);
  const h = Math.max(base.height, head.height);
  const minW = Math.min(base.width, head.width);
  const minH = Math.min(base.height, head.height);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  ctx.drawImage(base, 0, 0);
  const a = ctx.getImageData(0, 0, w, h);
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(head, 0, 0);
  const b = ctx.getImageData(0, 0, w, h);
  base.close();
  head.close();

  const A = a.data;
  const B = b.data;
  for (let i = 0; i < A.length; i += 4) {
    const p = i / 4;
    const inBoth = p % w < minW && p / w < minH;
    const differs =
      inBoth &&
      (Math.abs(A[i] - B[i]) > TOLERANCE ||
        Math.abs(A[i + 1] - B[i + 1]) > TOLERANCE ||
        Math.abs(A[i + 2] - B[i + 2]) > TOLERANCE ||
        Math.abs(A[i + 3] - B[i + 3]) > TOLERANCE);
    if (differs) {
      A[i] = 255;
      A[i + 1] = 43;
      A[i + 2] = 43;
      A[i + 3] = 255;
    } else {
      const S = A[i + 3] ? A : B;
      const dim = 255 - (255 - (S[i] * 0.299 + S[i + 1] * 0.587 + S[i + 2] * 0.114)) * 0.25;
      A[i] = A[i + 1] = A[i + 2] = dim;
      A[i + 3] = 255;
    }
  }
  ctx.putImageData(a, 0, 0);
  return URL.createObjectURL(await canvas.convertToBlob({ type: 'image/png' }));
};
