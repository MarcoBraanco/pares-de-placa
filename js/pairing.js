// Pareamento Dia 1 × Dia 5 por identificador e número da placa.
import { fileNameFor, levenshtein } from './ids.js';

/**
 * plates: [{ uid, day: 1|5, num, idKey, idDisplay }]
 * Retorna { pairs, onlyDay1, onlyDay5, issues }.
 *  pairs: [{ key, display, a, b, fileName, d1: [plateA, plateB], d5: [plateA, plateB] }]
 */
export function computePairs(plates) {
  const groups = new Map();
  for (const p of plates) {
    if (!p.idKey) continue;
    let g = groups.get(p.idKey);
    if (!g) groups.set(p.idKey, g = { key: p.idKey, display: p.idDisplay, 1: new Map(), 5: new Map() });
    if (p.day === 1 && g.display !== p.idDisplay && !g.fromDay1) { g.display = p.idDisplay; g.fromDay1 = true; }
    if (p.num == null) continue;
    const m = g[p.day];
    if (!m.has(p.num)) m.set(p.num, []);
    m.get(p.num).push(p);
  }

  const pairs = [], issues = [], onlyDay1 = [], onlyDay5 = [];
  for (const g of groups.values()) {
    for (const day of [1, 5]) {
      for (const [num, list] of g[day]) {
        if (list.length > 1) issues.push(`${g.display}: placa ${num} aparece ${list.length}× no Dia ${day}`);
      }
    }
    const n1 = [...g[1].keys()], n5 = [...g[5].keys()];
    if (!n1.length && !n5.length) continue;
    if (!n5.length) { onlyDay1.push(g); continue; }
    if (!n1.length) { onlyDay5.push(g); continue; }
    const common = n1.filter(n => g[5].has(n)).sort((x, y) => x - y);
    const missing = [...n1.filter(n => !g[5].has(n)).map(n => `placa ${n} só no Dia 1`),
                     ...n5.filter(n => !g[1].has(n)).map(n => `placa ${n} só no Dia 5`)];
    if (missing.length) issues.push(`${g.display}: ${missing.join(', ')}`);
    const split = common.length > 2;
    for (let i = 0; i + 1 < common.length; i += 2) {
      const a = common[i], b = common[i + 1];
      pairs.push({
        key: g.key, display: g.display, a, b,
        fileName: fileNameFor(g.display, split ? `${a}-${b}` : ''),
        d1: [g[1].get(a)[0], g[1].get(b)[0]],
        d5: [g[5].get(a)[0], g[5].get(b)[0]],
      });
    }
    if (common.length % 2) issues.push(`${g.display}: placa ${common[common.length - 1]} ficou sem parceira para formar o par`);
  }
  pairs.sort((x, y) => x.fileName.localeCompare(y.fileName, undefined, { numeric: true }));

  // sugestões: IDs sem par muito parecidos com IDs sem par do outro dia
  for (const g of onlyDay1) {
    g.suggestions = onlyDay5.filter(h => levenshtein(g.key, h.key) <= 2).map(h => h.key);
  }
  for (const g of onlyDay5) {
    g.suggestions = onlyDay1.filter(h => levenshtein(g.key, h.key) <= 2).map(h => h.key);
  }
  return { pairs, onlyDay1, onlyDay5, issues, groups };
}
