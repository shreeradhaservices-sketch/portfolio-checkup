/**
 * Parser for CDSL-issued Consolidated CAS (the combined Demat + Mutual Fund
 * statement). This is different from a plain CAMS/KFintech MF-only CAS.
 *
 * Strategy: we deliberately do NOT try to recompute asset allocation
 * ourselves. CDSL already publishes an authoritative "Consolidated Portfolio"
 * table with exact values and percentages. We extract that directly —
 * it's more accurate than any categorization we could do, and safer from a
 * distributor-compliance standpoint since we're just reporting facts CDSL
 * itself already calculated, not our own judgment.
 */

const ASSET_CLASS_NAMES = [
  'Mutual Funds Held in Demat Form', // must come before "Mutual Fund Folios" check due to overlap risk
  'Mutual Fund Folios',
  'Preference Shares',
  'Debts',
  'Equity',
  'Others'
];

function isCdslCas(rawText) {
  return rawText.includes('AMC Name') && rawText.includes('Folio No');
}

function parseAssetAllocation(rawText) {
  const lines = rawText.split('\n');
  const allocation = [];
  const seen = new Set();

  for (const line of lines) {
    for (const className of ASSET_CLASS_NAMES) {
      if (seen.has(className)) continue;
      if (!line.trim().startsWith(className)) continue;

      const rest = line.trim().slice(className.length).trim();
      const numbers = rest.match(/[\d,]+\.\d+/g);
      if (numbers && numbers.length >= 2) {
        const value = parseFloat(numbers[0].replace(/,/g, ''));
        const percent = parseFloat(numbers[1].replace(/,/g, ''));
        allocation.push({ category: className, value, percent });
        seen.add(className);
      }
      break;
    }
  }

  return allocation.sort((a, b) => b.value - a.value);
}

function parseTotalPortfolioValue(rawText) {
  const match = rawText.match(/Total Portfolio Value across investments\s*[₹`]\s*([\d,]+\.\d+)/i)
    || rawText.match(/CONSOLIDATED\s+PORTFOLIO VALUE\s*[₹`]\s*([\d,]+\.\d+)/i);
  return match ? parseFloat(match[1].replace(/,/g, '')) : null;
}

/**
 * Extracts each MF folio entry from the "MF Folios" section, which follows
 * a clean, repeatable pattern:
 *   AMC Name : <amc>
 *   Scheme Name : <scheme, may wrap to next line>   Scheme Code : <code>
 *   Folio No : <folio>   ...
 */
function parseMfFolios(rawText) {
  const chunks = rawText.split(/(?=AMC Name\s*:)/);
  const folios = [];

  for (const chunk of chunks) {
    if (!chunk.trim().startsWith('AMC Name')) continue;

    const amcMatch = chunk.match(/AMC Name\s*:\s*(.+)/);
    const blockMatch = chunk.match(/Scheme Name\s*:\s*([\s\S]*?)Folio No\s*:/);
    const folioMatch = chunk.match(/Folio No\s*:\s*([^\s]+)/);

    if (!amcMatch || !blockMatch || !folioMatch) continue;

    // Scheme name can wrap across lines with "Scheme Code : XXX" sitting
    // in the middle (a side-by-side column artifact from PDF text extraction).
    // Strip that label out, then collapse remaining whitespace/newlines.
    const schemeName = blockMatch[1]
      .replace(/Scheme Code\s*:\s*\S+/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    folios.push({
      amc: amcMatch[1].trim(),
      scheme: schemeName,
      folio: folioMatch[1].trim()
    });
  }

  return folios;
}

function buildCdslSummary(rawText) {
  const allocation = parseAssetAllocation(rawText);
  const totalValue = parseTotalPortfolioValue(rawText);
  const folios = parseMfFolios(rawText);

  const amcSet = new Set(folios.map(f => f.amc));

  // Detect the same scheme held across multiple separate folios — a purely
  // factual, non-judgmental observation.
  const schemeCounts = {};
  for (const f of folios) {
    schemeCounts[f.scheme] = (schemeCounts[f.scheme] || 0) + 1;
  }
  const duplicateSchemes = Object.entries(schemeCounts)
    .filter(([, count]) => count > 1)
    .map(([scheme, count]) => ({ scheme, count }));

  return {
    format: 'cdsl',
    totalValue,
    schemeCount: folios.length,
    amcCount: amcSet.size,
    allocation,
    duplicateSchemes,
    folios
  };
}

module.exports = { isCdslCas, parseAssetAllocation, parseTotalPortfolioValue, parseMfFolios, buildCdslSummary };
