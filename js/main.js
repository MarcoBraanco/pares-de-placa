import { WORK, detectLabels, photoRotation, rotate, labelImages, platesForLabels } from './vision.js';
import { initOcr, readId, readDigit } from './ocr.js';
import { normalizeId } from './ids.js';
import { computePairs } from './pairing.js';
import { cropPlate, renderPair } from './render.js';

const LIBS = {
  tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
  opencv: 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js',
};

const $ = sel => document.querySelector(sel);
const state = { files: { 1: null, 5: null }, photos: [], plates: [], results: [], stale: false, busy: false };
window.__app = state; // útil para depuração no console

// ---------- carregamento das bibliotecas ----------
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('Falha ao carregar ' + src));
    document.head.appendChild(s);
  });
}

let cvReady = null;
function loadOpenCV() {
  if (!cvReady) {
    // O módulo do OpenCV.js é "thenable": resolver uma Promise com ele entra em laço infinito.
    // Por isso a Promise só sinaliza "pronto"; o módulo é lido de window.cv.
    cvReady = loadScript(LIBS.opencv).then(() => new Promise(res => {
      let done = false;
      const ok = () => { if (!done) { done = true; res(); } };
      const check = () => (window.cv && window.cv.Mat) ? ok() : setTimeout(check, 100);
      if (window.cv && !window.cv.Mat) window.cv.onRuntimeInitialized = ok;
      check();
    }));
  }
  return cvReady;
}

// ---------- interface: upload ----------
for (const day of [1, 5]) {
  const zone = $(`#drop${day}`), input = $(`#zip${day}`);
  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => input.files[0] && setFile(day, input.files[0]));
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('over');
    const f = e.dataTransfer.files[0];
    if (f) setFile(day, f);
  });
}

function setFile(day, file) {
  state.files[day] = file;
  $(`#drop${day} .fname`).textContent = `${file.name} (${(file.size / 1048576).toFixed(1)} MB)`;
  $(`#drop${day}`).classList.add('ok');
  $('#btnProcess').disabled = !(state.files[1] && state.files[5]) || state.busy;
}

$('#btnProcess').addEventListener('click', () => run());

function progress(text, frac) {
  $('#progress').hidden = false;
  $('#progText').textContent = text;
  if (frac != null) $('#progBar').value = frac;
}

// ---------- processamento ----------
async function listImages(file) {
  const zip = await JSZip.loadAsync(file);
  const entries = Object.values(zip.files).filter(f => !f.dir
    && /\.(jpe?g|png)$/i.test(f.name) && !/(^|\/)(__MACOSX|\.)/.test(f.name));
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return entries;
}

async function run() {
  state.busy = true;
  $('#btnProcess').disabled = true;
  state.photos = []; state.plates = []; state.results = [];
  $('#review').hidden = true; $('#gallerySec').hidden = true;
  try {
    progress('Carregando bibliotecas (OpenCV.js e Tesseract.js, só na primeira vez demora)…', 0);
    await loadScript(LIBS.tesseract);
    await loadOpenCV();
    const cv = window.cv;
    await initOcr();
    const lists = { 1: await listImages(state.files[1]), 5: await listImages(state.files[5]) };
    const total = lists[1].length + lists[5].length;
    let done = 0;
    for (const day of [1, 5]) {
      for (const entry of lists[day]) {
        progress(`Dia ${day}: ${entry.name} (${done + 1} de ${total})`, done / total);
        try {
          await processPhoto(cv, day, entry);
        } catch (err) {
          console.error(entry.name, err);
          state.photos.push({ day, name: entry.name, error: String(err), plates: [] });
        }
        done++;
      }
    }
    progress('Montando os pares…', 1);
    renderReview();
    await generateImages();
    progress(`Concluído: ${total} fotos, ${state.plates.length} placas, ${state.results.length} pares.`, 1);
  } catch (err) {
    console.error(err);
    progress('Erro: ' + err.message, null);
  } finally {
    state.busy = false;
    $('#btnProcess').disabled = false;
  }
}

let uidSeq = 0;
async function processPhoto(cv, day, entry) {
  const blob = await entry.async('blob');
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const s = WORK / Math.max(bmp.width, bmp.height);
  const work = document.createElement('canvas');
  work.width = Math.round(bmp.width * s); work.height = Math.round(bmp.height * s);
  work.getContext('2d').drawImage(bmp, 0, 0, work.width, work.height);

  const src = cv.imread(work);
  const rects0 = detectLabels(cv, src);
  const k = rects0.length ? photoRotation(cv, src, rects0) : 0;
  const rot = rotate(cv, src, k);
  src.delete();
  const rects = detectLabels(cv, rot);
  const circles = rects.length ? platesForLabels(cv, rot, rects) : [];

  // foto girada em resolução cheia (para os recortes)
  const full = document.createElement('canvas');
  const swap = k % 2 === 1;
  full.width = swap ? bmp.height : bmp.width; full.height = swap ? bmp.width : bmp.height;
  const fctx = full.getContext('2d');
  fctx.translate(full.width / 2, full.height / 2);
  fctx.rotate(-k * Math.PI / 2); // k = quartos de volta anti-horários
  fctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
  bmp.close();

  const thumbC = document.createElement('canvas');
  cv.imshow(thumbC, rot);
  const photo = { day, name: entry.name.split('/').pop(), rotation: k * 90, plates: [], thumb: scaledDataUrl(thumbC, 420) };

  for (let i = 0; i < rects.length; i++) {
    const imgs = labelImages(cv, rot, rects[i]);
    const id = await readId(imgs.idCanvas);
    const dg = await readDigit(imgs.digitCanvas);
    const n = normalizeId(id.text);
    const cropBlob = await cropPlate(full, circles[i], 1 / s);
    const plate = {
      uid: ++uidSeq, day, photo, rawId: id.text, idConf: id.confidence,
      idDisplay: n.display, idKey: n.key, valid: n.valid,
      num: dg.num, numConf: dg.confidence,
      labelUrl: scaledDataUrl(imgs.preview, 360),
      cropBlob, cropUrl: URL.createObjectURL(cropBlob),
      center: circles[i], estimated: circles[i].estimated, flags: [],
    };
    if (circles[i].estimated) plate.flags.push('placa estimada');
    photo.plates.push(plate);
    state.plates.push(plate);
  }
  rot.delete();
  fixWithinPhoto(photo);
  // ordem de leitura: linha a linha, da esquerda para a direita
  photo.plates.sort((a, b) => {
    const dy = a.center.y - b.center.y;
    return Math.abs(dy) > 0.5 * a.center.r ? dy : a.center.x - b.center.x;
  });
  state.photos.push(photo);
}

function scaledDataUrl(canvas, maxSide) {
  const s = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
  const c = document.createElement('canvas');
  c.width = Math.round(canvas.width * s); c.height = Math.round(canvas.height * s);
  c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}

/** Etiqueta ilegível herda o ID da placa vizinha mais próxima (a mesma amostra fica lado a lado). */
function fixWithinPhoto(photo) {
  for (const p of photo.plates) {
    if (p.valid) continue;
    const near = photo.plates.filter(q => q !== p && q.valid && q.num !== p.num)
      .sort((a, b) => dist(a, p) - dist(b, p))[0];
    if (near) {
      p.idDisplay = near.idDisplay; p.idKey = near.idKey; p.valid = true;
      p.flags.push(`ID ilegível ("${p.rawId}"), copiado da vizinha`);
    } else {
      p.flags.push('ID fora do padrão');
    }
  }
  // número ilegível: se a amostra tem uma única outra placa na foto, é a parceira dela (1↔2, 3↔4)
  for (const p of photo.plates) {
    if (p.num != null) continue;
    const sib = photo.plates.filter(q => q !== p && q.idKey === p.idKey && q.num != null);
    const partner = sib.length === 1 ? (sib[0].num % 2 ? sib[0].num + 1 : sib[0].num - 1) : null;
    if (partner) {
      p.num = partner;
      p.flags.push('número deduzido pela placa vizinha');
    } else {
      p.flags.push('número não lido');
    }
  }
}
const dist = (a, b) => Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y);

// ---------- revisão ----------
function renderReview() {
  $('#review').hidden = false;
  for (const day of [1, 5]) {
    const box = $(`#photos${day}`);
    box.innerHTML = '';
    for (const ph of state.photos.filter(p => p.day === day)) box.appendChild(photoCard(ph));
  }
  renderSummary();
}

function photoCard(ph) {
  const card = document.createElement('div');
  card.className = 'photo';
  const flagged = ph.error || ph.plates.some(p => p.flags.length) || !ph.plates.length;
  if (flagged) card.classList.add('warn');
  card.innerHTML = `
    <div class="photo-head"><strong>${esc(ph.name)}</strong>
      <span class="muted">${ph.plates.length} placas${ph.rotation ? ` · girada ${ph.rotation}°` : ''}</span></div>
    ${ph.thumb ? `<img class="thumb" src="${ph.thumb}" alt="">` : ''}
    ${ph.error ? `<p class="err">Erro: ${esc(ph.error)}</p>` : ''}
    ${!ph.error && !ph.plates.length ? '<p class="err">Nenhuma etiqueta encontrada.</p>' : ''}
    <div class="plates"></div>`;
  const list = card.querySelector('.plates');
  for (const p of ph.plates) {
    const row = document.createElement('div');
    row.className = 'plate' + (p.flags.length ? ' warn' : '');
    row.innerHTML = `
      <img class="label" src="${p.labelUrl}" alt="etiqueta">
      <div class="fields">
        <label>ID <input class="id" value="${esc(p.idDisplay)}" spellcheck="false"></label>
        <label>Placa <input class="num" type="number" min="1" max="9" value="${p.num ?? ''}"></label>
        ${p.flags.map(f => `<span class="flag">${esc(f)}</span>`).join('')}
      </div>`;
    row.querySelector('.id').addEventListener('change', e => {
      const n = normalizeId(e.target.value);
      Object.assign(p, { idDisplay: n.display, idKey: n.key, valid: n.valid });
      e.target.value = n.display;
      edited();
    });
    row.querySelector('.num').addEventListener('change', e => {
      p.num = e.target.value ? Number(e.target.value) : null;
      edited();
    });
    list.appendChild(row);
  }
  return card;
}

function edited() {
  state.stale = true;
  renderSummary();
}

function renderSummary() {
  const r = computePairs(state.plates);
  state.pairing = r;
  const box = $('#summary');
  const unpaired = (list, day, other) => list.map(g => `
    <li><strong>${esc(g.display)}</strong> <span class="muted">(placas ${[...g[day].keys()].sort().join(', ')})</span>
    ${g.suggestions.map(s => `<button class="link" data-from="${esc(g.key)}" data-to="${esc(s)}" data-day="${day}">
      parecido com ${esc(s)} (Dia ${other}) — unificar</button>`).join('')}</li>`).join('');
  box.innerHTML = `
    <p><strong>${r.pairs.length}</strong> pares prontos.
      ${state.stale ? '<button id="btnRegen" class="primary">Atualizar imagens</button>' : ''}</p>
    ${r.onlyDay1.length ? `<h4>Só no Dia 1 (sem par)</h4><ul>${unpaired(r.onlyDay1, 1, 5)}</ul>` : ''}
    ${r.onlyDay5.length ? `<h4>Só no Dia 5 (sem par)</h4><ul>${unpaired(r.onlyDay5, 5, 1)}</ul>` : ''}
    ${r.issues.length ? `<h4>Avisos</h4><ul>${r.issues.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}`;
  box.querySelectorAll('button.link').forEach(b => b.addEventListener('click', () => {
    const target = r.groups.get(b.dataset.to);
    for (const p of state.plates) {
      if (p.idKey === b.dataset.from && p.day === Number(b.dataset.day)) {
        p.idKey = target.key; p.idDisplay = target.display; p.valid = true;
      }
    }
    renderReview(); edited();
  }));
  const regen = $('#btnRegen');
  if (regen) regen.addEventListener('click', generateImages);
}

// ---------- imagens finais ----------
async function generateImages() {
  const { pairs } = computePairs(state.plates);
  for (const old of state.results) URL.revokeObjectURL(old.url);
  state.results = [];
  for (let i = 0; i < pairs.length; i++) {
    progress(`Gerando imagens ${i + 1} de ${pairs.length}…`, (i + 1) / pairs.length);
    const blob = await renderPair(pairs[i]);
    state.results.push({ ...pairs[i], blob, url: URL.createObjectURL(blob) });
  }
  state.stale = false;
  renderSummary();
  renderGallery();
  progress(`${state.results.length} pares gerados.`, 1);
}

function renderGallery() {
  $('#gallerySec').hidden = false;
  const g = $('#gallery');
  g.innerHTML = '';
  for (const r of state.results) {
    const fig = document.createElement('figure');
    fig.innerHTML = `<img src="${r.url}" alt="${esc(r.fileName)}" loading="lazy"><figcaption>${esc(r.fileName)}</figcaption>`;
    fig.addEventListener('click', () => openModal(r));
    g.appendChild(fig);
  }
}

function openModal(r) {
  $('#modalImg').src = r.url;
  $('#modalCap').textContent = r.fileName;
  $('#modalDl').href = r.url;
  $('#modalDl').download = r.fileName;
  $('#modal').hidden = false;
}
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal' || e.target.id === 'modalClose') $('#modal').hidden = true; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#modal').hidden = true; });

$('#btnZip').addEventListener('click', async () => {
  const zip = new JSZip();
  const dir = zip.folder('Pares');
  for (const r of state.results) dir.file(r.fileName, r.blob);
  const p = state.pairing || computePairs(state.plates);
  const lines = ['Amostras sem par', '================', ''];
  lines.push('Só no Dia 1:', ...(p.onlyDay1.length ? p.onlyDay1.map(g => '  ' + g.display) : ['  (nenhuma)']), '');
  lines.push('Só no Dia 5:', ...(p.onlyDay5.length ? p.onlyDay5.map(g => '  ' + g.display) : ['  (nenhuma)']));
  if (p.issues.length) lines.push('', 'Avisos:', ...p.issues.map(i => '  ' + i));
  dir.file('sem_par.txt', lines.join('\r\n'));
  const blob = await zip.generateAsync({ type: 'blob' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'Pares.zip';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
});

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- teste: ?d1=dia1.zip&d5=dia5.zip carrega e processa automaticamente ----------
(async () => {
  const q = new URLSearchParams(location.search);
  if (!q.get('d1') || !q.get('d5')) return;
  for (const day of [1, 5]) {
    const url = q.get('d' + day);
    const b = await (await fetch(url)).blob();
    setFile(day, new File([b], url.split('/').pop()));
  }
  run();
})();
