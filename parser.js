const categoryMap = require('./category-map.json');

// Known AMC names that appear as their own line in CAS statements.
// Used to detect the "scheme name" line that always follows.
const KNOWN_AMCS = [
  'HDFC Mutual Fund', 'ICICI Prudential Mutual Fund', 'SBI Mutual Fund',
  'Axis Mutual Fund', 'Nippon India Mutual Fund', 'Kotak Mahindra Mutual Fund',
  'Aditya Birla Sun Life Mutual Fund', 'UTI Mutual Fund', 'Franklin Templeton Mutual Fund',
  'DSP Mutual Fund', 'Tata Mutual Fund', 'Mirae Asset Mutual Fund',
  'Motilal Oswal Mutual Fund', 'Quant Mutual Fund', 'PPFAS Mutual Fund',
  'Edelweiss Mutual Fund', 'Invesco Mutual Fund', 'Canara Robeco Mutual Fund',
  'Bandhan Mutual Fund', 'HSBC Mutual Fund', 'L&T Mutual Fund'
];

function classifyScheme(schemeName) {
  const lower = schemeName.toLowerCase();
  for (const [category, keywords] of Object.entries(categoryMap)) {
    if (keywords.some(k => lower.includes(k))) {
      return category;
    }
  }
  return 'other';
}

/**
 * Parses raw decrypted CAS text into structured holdings.
 * Works on the standard CAMS/KFintech layout:
 *   Folio No: XXXXXXXX / 0
 *   <AMC Name>
 *   <Scheme Name> - Growth/IDCW
 *   Closing Unit Balance: 000.000   NAV: 00.00   Value: 000000.00
 */
function parseCasText(rawText) {
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
  const holdings = [];
  let currentFolio = null;
  let currentAmc = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const folioMatch = line.match(/Folio No:\s*([\w\/\s-]+)/i);
    if (folioMatch) {
      currentFolio = folioMatch[1].trim();
      continue;
    }

    if (KNOWN_AMCS.some(amc => line.includes(amc))) {
      currentAmc = line;
      continue;
    }

    // A scheme line typically follows the AMC line and precedes the value line.
    // Value can be on the same line or the next one depending on PDF wrapping.
    const valueMatch = line.match(/Value:\s*([\d,]+\.\d+)/i);
    if (valueMatch && currentAmc) {
      // scheme name is the most recent non-value, non-folio, non-amc line before this
      let schemeName = null;
      for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
        const candidate = lines[j];
        if (candidate === currentAmc) continue;
        if (candidate.match(/Folio No:/i)) continue;
        if (candidate.match(/Value:/i)) continue;
        schemeName = candidate;
        break;
      }
      if (!schemeName) continue;

      const value = parseFloat(valueMatch[1].replace(/,/g, ''));
      const unitsMatch = line.match(/Closing Unit Balance:\s*([\d,]+\.\d+)/i);
      const navMatch = line.match(/NAV:\s*([\d,]+\.\d+)/i);

      holdings.push({
        folio: currentFolio,
        amc: currentAmc,
        scheme: schemeName.replace(/\s*-\s*(Growth|IDCW|Dividend).*/i, '').trim(),
        planType: (line.match(/Growth|IDCW|Dividend/i) || schemeName.match(/Growth|IDCW|Dividend/i) || [''])[0],
        units: unitsMatch ? parseFloat(unitsMatch[1].replace(/,/g, '')) : null,
        nav: navMatch ? parseFloat(navMatch[1].replace(/,/g, '')) : null,
        value: value,
        category: classifyScheme(schemeName)
      });
    }
  }

  return holdings;
}

/**
 * Builds the factual summary — allocation %, scheme count, category
 * concentration. Deliberately produces NO judgments, no "you should switch",
 * no expense-ratio or "loss" figures. Distribution-safe by design.
 */
function buildSummary(holdings) {
  const totalValue = holdings.reduce((sum, h) => sum + (h.value || 0), 0);
  const byCategory = {};
  const byAmc = {};
  const schemesByCategory = {};

  for (const h of holdings) {
    byCategory[h.category] = (byCategory[h.category] || 0) + h.value;
    byAmc[h.amc] = (byAmc[h.amc] || 0) + h.value;
    if (!schemesByCategory[h.category]) schemesByCategory[h.category] = [];
    schemesByCategory[h.category].push(h.scheme);
  }

  const allocation = Object.entries(byCategory).map(([category, value]) => ({
    category,
    value: Math.round(value),
    percent: totalValue > 0 ? Math.round((value / totalValue) * 1000) / 10 : 0
  })).sort((a, b) => b.value - a.value);

  const concentrationNotes = Object.entries(schemesByCategory)
    .filter(([, schemes]) => schemes.length > 1)
    .map(([category, schemes]) => ({
      category,
      count: schemes.length,
      schemes
    }));

  return {
    totalValue: Math.round(totalValue),
    schemeCount: holdings.length,
    amcCount: new Set(holdings.map(h => h.amc)).size,
    allocation,
    concentrationNotes,
    holdings
  };
}

module.exports = { parseCasText, buildSummary, classifyScheme };
