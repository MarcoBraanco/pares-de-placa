// OCR com Tesseract.js: um worker para a linha do identificador e outro para o número da placa.

let idWorker = null, digitWorker = null;

export async function initOcr(onLog) {
  if (idWorker) return;
  const T = window.Tesseract;
  const logger = m => onLog && m.status && onLog(m.status, m.progress);
  idWorker = await T.createWorker('eng', 1, { logger });
  await idWorker.setParameters({
    tessedit_pageseg_mode: '7', // uma linha
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._:-= ',
  });
  digitWorker = await T.createWorker('eng', 1, { logger });
  await digitWorker.setParameters({
    tessedit_pageseg_mode: '10', // um caractere
    tessedit_char_whitelist: '123456789',
  });
}

export async function readId(canvas) {
  if (!canvas) return { text: '', confidence: 0 };
  const { data } = await idWorker.recognize(canvas);
  return { text: data.text.trim(), confidence: data.confidence };
}

export async function readDigit(canvas) {
  if (!canvas) return { num: null, confidence: 0 };
  const { data } = await digitWorker.recognize(canvas);
  let m = data.text.match(/\d/);
  if (m) return { num: Number(m[0]), confidence: data.confidence };
  // segunda tentativa tratando o recorte como uma palavra
  await digitWorker.setParameters({ tessedit_pageseg_mode: '8' });
  const retry = (await digitWorker.recognize(canvas)).data;
  await digitWorker.setParameters({ tessedit_pageseg_mode: '10' });
  m = retry.text.match(/\d/);
  return { num: m ? Number(m[0]) : null, confidence: m ? retry.confidence : 0 };
}
