// Montagem da imagem final 2×2 e recorte das placas.

export const TILE = 800;

/**
 * Recorta uma placa da foto em resolução cheia, já girada.
 * full: canvas da foto girada; scale: fator imagem-de-trabalho -> full.
 */
export function cropPlate(full, circle, scale) {
  const hs = circle.r * 1.06 * scale;
  const sx = circle.x * scale - hs, sy = circle.y * scale - hs, side = 2 * hs;
  const c = document.createElement('canvas');
  c.width = c.height = TILE;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e8e8e8';
  ctx.fillRect(0, 0, TILE, TILE);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(full, sx, sy, side, side, 0, 0, TILE, TILE);
  return toBlob(c, 0.92);
}

export function toBlob(canvas, quality) {
  return new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
}

/** Imagem final: linha de cima = Dia 1 (a, b), linha de baixo = Dia 5 (a, b), título no topo. */
export async function renderPair(pair) {
  const c = document.createElement('canvas');
  c.width = c.height = 2 * TILE;
  const ctx = c.getContext('2d');
  const tiles = [pair.d1[0], pair.d1[1], pair.d5[0], pair.d5[1]];
  for (let i = 0; i < 4; i++) {
    const bmp = await createImageBitmap(tiles[i].cropBlob);
    ctx.drawImage(bmp, (i % 2) * TILE, Math.floor(i / 2) * TILE, TILE, TILE);
    bmp.close();
  }
  const text = pair.display;
  ctx.font = 'bold 46px Arial, "Helvetica Neue", Helvetica, sans-serif';
  const tw = ctx.measureText(text).width;
  const bw = tw + 50, bh = 70, x0 = (2 * TILE - bw) / 2;
  ctx.fillStyle = '#fff';
  ctx.fillRect(x0, 0, bw, bh);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3;
  ctx.strokeRect(x0 + 1.5, 1.5, bw - 3, bh - 3);
  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, TILE, bh / 2 + 2);
  return toBlob(c, 0.93);
}
