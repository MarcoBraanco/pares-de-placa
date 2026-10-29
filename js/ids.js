// Normalização dos identificadores lidos por OCR.
// Formato esperado: TT-EDG-ddd[.d]_[-]X.Y[=N]  (ex.: TT-EDG-035_12.1, TT_EDG-006.2_1.2=10)
// ou códigos curtos (PWU, BtMAX, VIP3A, B104).

const PREFIX = /^T\s*T\s*([-_ ]?)\s*E\s*D\s*[GC6]\s*[-_ ]?/i;

function digitsOnly(s) {
  return s.replace(/[Oo]/g, '0').replace(/[lI|]/g, '1').replace(/[^0-9]/g, '');
}

// Coloca o ponto antes do último dígito: "121" -> "12.1"
function decimal(d) {
  return d.length >= 2 ? d.slice(0, -1) + '.' + d.slice(-1) : d;
}

/**
 * Normaliza um texto de etiqueta.
 * Retorna { display, key, valid }:
 *  - display: texto para mostrar no título (mantém "TT_" se assim estiver escrito);
 *  - key: chave usada para parear (sem ambiguidades de prefixo/separador);
 *  - valid: se o texto bate com um formato conhecido.
 */
export function normalizeId(raw) {
  let s = (raw || '').replace(/[×xX](?=\d+\W*$)/, '=').trim();
  const pm = s.match(PREFIX);
  if (pm) {
    const underscorePrefix = pm[1] === '_';
    let rest = s.slice(pm[0].length);
    // sufixo "=N" (às vezes lido como "-N") no final
    let tail = '';
    const tm = rest.match(/(?<=[0-9Oo])\s*[=\-–]\s*(\d+)\W*$/);
    if (tm) { tail = '=' + tm[1]; rest = rest.slice(0, tm.index + 0); }
    rest = rest.replace(/[^0-9A-Za-z]+$/, '');
    // separa base e sufixo: primeiro "_" ou ":"; senão o primeiro espaço após 3 dígitos
    let base, suf;
    const sm = rest.match(/[_:]/);
    if (sm) {
      base = rest.slice(0, sm.index);
      suf = rest.slice(sm.index + 1);
    } else {
      const m2 = rest.match(/^([0-9Oo]{3}(?:\.[0-9])?)[\s.]+(.*)$/);
      if (!m2) return { display: raw.trim(), key: raw.trim().toUpperCase(), valid: false };
      base = m2[1]; suf = m2[2];
    }
    const neg = /^\s*[-–]/.test(suf);
    const bd = digitsOnly(base);
    const sd = digitsOnly(suf);
    if (bd.length < 3 || bd.length > 4 || sd.length < 2) {
      return { display: raw.trim(), key: raw.trim().toUpperCase(), valid: false };
    }
    const b = bd.length === 4 ? bd.slice(0, 3) + '.' + bd[3] : bd;
    const core = `EDG-${b}_${neg ? '-' : ''}${decimal(sd)}${tail}`;
    return { display: (underscorePrefix ? 'TT_' : 'TT-') + core, key: 'TT-' + core, valid: true };
  }
  const short = s.replace(/\s+/g, '').replace(/[^0-9A-Za-z]+$/, '').replace(/^[^0-9A-Za-z]+/, '');
  const valid = /^[A-Za-z0-9]{2,10}$/.test(short);
  return { display: short, key: short.toUpperCase(), valid };
}

/** Nome de arquivo a partir do identificador (":" e caracteres inválidos -> "_"). */
export function fileNameFor(display, suffix = '') {
  return display.replace(/[:\\/*?"<>|]/g, '_') + (suffix ? '_' + suffix : '') + '.jpg';
}

export function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}
