// Visão computacional com OpenCV.js: etiquetas, orientação da foto e placas (círculos).
// Todas as coordenadas retornadas estão na imagem de trabalho já girada (lado maior = WORK px).

export const WORK = 2000;

const ROT_CODES = (cv) => [null, cv.ROTATE_90_COUNTERCLOCKWISE, cv.ROTATE_180, cv.ROTATE_90_CLOCKWISE];

/** Máscara de "preto neutro" (etiqueta) — exclui folhas escuras pelo tom verde. */
function labelMask(cv, src) {
  const blur = new cv.Mat();
  cv.GaussianBlur(src, blur, new cv.Size(5, 5), 0);
  const mask = new cv.Mat(src.rows, src.cols, cv.CV_8UC1);
  const d = blur.data, m = mask.data;
  for (let i = 0, p = 0; i < m.length; i++, p += 4) {
    const r = d[p], g = d[p + 1], b = d[p + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    m[i] = (mx < 100 && g - (r + b) / 2 < 7 && mx - mn < 30) ? 255 : 0;
  }
  blur.delete();
  const k5 = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
  const k9 = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9));
  cv.morphologyEx(mask, mask, cv.MORPH_OPEN, k5);
  cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, k9);
  k5.delete(); k9.delete();
  return mask;
}

/** Retângulos (RotatedRect) das etiquetas pretas. */
export function detectLabels(cv, src) {
  const mask = labelMask(cv, src);
  const contours = new cv.MatVector(), hier = new cv.Mat();
  cv.findContours(mask, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  let out = [];
  for (let i = 0; i < contours.size(); i++) {
    const c = contours.get(i);
    const a = cv.contourArea(c);
    if (a >= 1500) {
      const r = cv.minAreaRect(c);
      const w = r.size.width, h = r.size.height;
      const L = Math.max(w, h), S = Math.min(w, h);
      if (S >= 15 && L / S > 2.0 && L / S < 5.5 && a / (w * h) > 0.75) out.push({ rect: r, area: a });
    }
    c.delete();
  }
  contours.delete(); hier.delete(); mask.delete();
  if (out.length) {
    const top = out.map(o => o.area).sort((x, y) => x - y).slice(-2);
    const med = top.length === 2 ? (top[0] + top[1]) / 2 : top[0];
    out = out.filter(o => o.area > 0.5 * med && o.area < 1.8 * med);
  }
  return out.map(o => o.rect);
}

/** Recorta a etiqueta com o lado longo na horizontal. Retorna { mat, ang }. */
function rectify(cv, src, r) {
  const pts = cv.RotatedRect.points(r);
  let best = null, bl = -1;
  for (let i = 0; i < 4; i++) {
    const p = pts[i], q = pts[(i + 1) % 4];
    const l = Math.hypot(q.x - p.x, q.y - p.y);
    if (l > bl) { bl = l; best = [p, q]; }
  }
  let ang = Math.atan2(best[1].y - best[0].y, best[1].x - best[0].x) * 180 / Math.PI;
  if (ang > 90) ang -= 180;
  if (ang < -90) ang += 180;
  const L = Math.round(Math.max(r.size.width, r.size.height));
  const S = Math.round(Math.min(r.size.width, r.size.height));
  const M = cv.getRotationMatrix2D(r.center, ang, 1.0);
  M.data64F[2] += L / 2 - r.center.x;
  M.data64F[5] += S / 2 - r.center.y;
  const out = new cv.Mat();
  cv.warpAffine(src, out, M, new cv.Size(L, S), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
  M.delete();
  // tira a borda da etiqueta
  const ix = Math.round(L * 0.015), iy = Math.round(S * 0.04);
  const roi = out.roi(new cv.Rect(ix, iy, L - 2 * ix, S - 2 * iy));
  const mat = roi.clone(); roi.delete(); out.delete();
  return { mat, ang };
}

/** Componente do número grande (o mais alto que não ocupa a etiqueta inteira). */
function digitComponent(cv, gray) {
  const bw = new cv.Mat();
  cv.threshold(gray, bw, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU); // texto branco
  const labels = new cv.Mat(), stats = new cv.Mat(), cents = new cv.Mat();
  const n = cv.connectedComponentsWithStats(bw, labels, stats, cents, 8, cv.CV_32S);
  const H = gray.rows, W = gray.cols;
  let best = -1, bh = 0;
  for (let j = 1; j < n; j++) {
    const w = stats.intAt(j, cv.CC_STAT_WIDTH), h = stats.intAt(j, cv.CC_STAT_HEIGHT);
    if (h < 0.95 * H && w < 0.4 * W && h > bh) { bh = h; best = j; }
  }
  const res = best < 0 ? null : {
    j: best,
    x: stats.intAt(best, cv.CC_STAT_LEFT), y: stats.intAt(best, cv.CC_STAT_TOP),
    w: stats.intAt(best, cv.CC_STAT_WIDTH), h: stats.intAt(best, cv.CC_STAT_HEIGHT),
    cx: cents.doubleAt(best, 0),
  };
  return { res, labels, cleanup: () => { bw.delete(); stats.delete(); cents.delete(); labels.delete(); } };
}

/** Rotação (graus, anti-horário) que deixa a etiqueta legível. */
function labelRotation(cv, src, r) {
  const { mat, ang } = rectify(cv, src, r);
  const gray = new cv.Mat();
  cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY);
  const dc = digitComponent(cv, gray);
  const flip = dc.res ? dc.res.cx < gray.cols / 2 : false;
  dc.cleanup(); gray.delete(); mat.delete();
  return ang + (flip ? 180 : 0);
}

/** Decide a rotação da foto (0..3 = múltiplos de 90° anti-horário) pela maioria das etiquetas. */
export function photoRotation(cv, src, rects) {
  const votes = [0, 0, 0, 0];
  for (const r of rects) {
    const a = ((labelRotation(cv, src, r) % 360) + 360) % 360;
    votes[Math.round(a / 90) % 4]++;
  }
  return votes.indexOf(Math.max(...votes));
}

export function rotate(cv, src, k) {
  const code = ROT_CODES(cv)[k];
  if (code === null) return src.clone();
  const dst = new cv.Mat();
  cv.rotate(src, dst, code);
  return dst;
}

/** Binariza, remove sujeira encostada nas bordas e recorta no texto. Retorna Mat 8U (texto preto). */
function cleanText(cv, gray3x) {
  const m = new cv.Mat();
  cv.threshold(gray3x, m, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU); // tinta = 255
  const H = m.rows, W = m.cols;
  const labels = new cv.Mat(), stats = new cv.Mat(), cents = new cv.Mat();
  const n = cv.connectedComponentsWithStats(m, labels, stats, cents, 8, cv.CV_32S);
  const keepLab = new Uint8Array(n);
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let j = 1; j < n; j++) {
    const x = stats.intAt(j, cv.CC_STAT_LEFT), y = stats.intAt(j, cv.CC_STAT_TOP);
    const w = stats.intAt(j, cv.CC_STAT_WIDTH), h = stats.intAt(j, cv.CC_STAT_HEIGHT);
    const a = stats.intAt(j, cv.CC_STAT_AREA);
    if (y <= 1 || y + h >= H - 1 || (x <= 1 && h > 0.6 * H) || a < 6) continue;
    keepLab[j] = 1;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h);
  }
  const out = new cv.Mat(H, W, cv.CV_8UC1, new cv.Scalar(255));
  const ld = labels.data32S, od = out.data;
  for (let i = 0; i < ld.length; i++) if (keepLab[ld[i]]) od[i] = 0;
  labels.delete(); stats.delete(); cents.delete(); m.delete();
  if (x1 < 0) return out;
  const p = 20;
  const rx = Math.max(0, x0 - p), ry = Math.max(0, y0 - p);
  const roi = out.roi(new cv.Rect(rx, ry, Math.min(W, x1 + p) - rx, Math.min(H, y1 + p) - ry));
  const res = new cv.Mat();
  cv.copyMakeBorder(roi, res, p, p, p, p, cv.BORDER_CONSTANT, new cv.Scalar(255));
  roi.delete(); out.delete();
  return res;
}

function matToCanvas(cv, mat) {
  const c = document.createElement('canvas');
  cv.imshow(c, mat);
  return c;
}

/**
 * Prepara as imagens de OCR de uma etiqueta (já na foto girada).
 * Retorna { preview, idCanvas, digitCanvas } (canvases).
 */
export function labelImages(cv, src, r) {
  let { mat } = rectify(cv, src, r);
  let gray = new cv.Mat();
  cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY);
  let dc = digitComponent(cv, gray);
  if (dc.res && dc.res.cx < gray.cols / 2) { // ainda de cabeça para baixo
    dc.cleanup();
    cv.rotate(mat, mat, cv.ROTATE_180);
    cv.rotate(gray, gray, cv.ROTATE_180);
    dc = digitComponent(cv, gray);
  }
  const preview = matToCanvas(cv, mat);
  const H = gray.rows, W = gray.cols;
  let idCanvas = null, digitCanvas = null;
  if (dc.res) {
    const { x, y, w, h, j } = dc.res;
    // linha do identificador: metade de baixo, à esquerda do número
    const top = Math.round(H * 0.45);
    const idRoi = gray.roi(new cv.Rect(0, top, Math.max(1, x - 3), H - top));
    const inv = new cv.Mat(), big = new cv.Mat();
    cv.bitwise_not(idRoi, inv);
    cv.resize(inv, big, new cv.Size(0, 0), 3, 3, cv.INTER_CUBIC);
    const idClean = cleanText(cv, big);
    idCanvas = matToCanvas(cv, idClean);
    idRoi.delete(); inv.delete(); big.delete(); idClean.delete();
    // dígito: só o componente (sem o sublinhado), preto no branco
    const dm = new cv.Mat(h, w, cv.CV_8UC1);
    const ld = dc.labels.data32S, dd = dm.data;
    for (let yy = 0; yy < h; yy++)
      for (let xx = 0; xx < w; xx++)
        dd[yy * w + xx] = ld[(y + yy) * W + (x + xx)] === j ? 0 : 255;
    const p = Math.round(h * 0.3);
    const padded = new cv.Mat(), big2 = new cv.Mat();
    cv.copyMakeBorder(dm, padded, p, p, p, p, cv.BORDER_CONSTANT, new cv.Scalar(255));
    cv.resize(padded, big2, new cv.Size(0, 0), 2, 2, cv.INTER_NEAREST);
    digitCanvas = matToCanvas(cv, big2);
    dm.delete(); padded.delete(); big2.delete();
  }
  dc.cleanup(); gray.delete(); mat.delete();
  return { preview, idCanvas, digitCanvas };
}

/** Detecta as placas e associa um círculo a cada etiqueta. Retorna [{x,y,r,estimated}]. */
export function platesForLabels(cv, src, rects) {
  const lw = median(rects.map(r => Math.max(r.size.width, r.size.height)));
  const s = 1000 / Math.max(src.cols, src.rows);
  const small = new cv.Mat(), gray = new cv.Mat(), circles = new cv.Mat();
  cv.resize(src, small, new cv.Size(0, 0), s, s, cv.INTER_AREA);
  cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY);
  cv.medianBlur(gray, gray, 5);
  cv.HoughCircles(gray, circles, cv.HOUGH_GRADIENT, 1, Math.round(1.6 * lw * s), 80, 30,
    Math.round(1.0 * lw * s), Math.round(1.8 * lw * s));
  const cs = [];
  for (let i = 0; i < circles.cols; i++) {
    const d = circles.data32F;
    cs.push({ x: d[i * 3] / s, y: d[i * 3 + 1] / s, r: d[i * 3 + 2] / s });
  }
  small.delete(); gray.delete(); circles.delete();
  const chosen = rects.map(r => {
    const { x: lx, y: ly } = r.center;
    return cs.find(c => Math.hypot(lx - c.x, ly - c.y) < 0.85 * c.r && ly < c.y + 0.2 * c.r) || null;
  });
  const rs = chosen.filter(Boolean).map(c => c.r);
  const rmed = rs.length ? median(rs) : 1.3 * lw;
  return chosen.map((c, i) => c ? { ...c, estimated: false }
    : { x: rects[i].center.x, y: rects[i].center.y + 0.6 * rmed, r: rmed, estimated: true });
}

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
