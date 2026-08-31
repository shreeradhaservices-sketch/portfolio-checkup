/**
 * Parser for the classic CAMS-issued "Mutual Fund Consolidated Account
 * Statement" format — organized by AMC, with a per-AMC subtotal line and
 * a grand "Portfolio Value" total. This differs from both the simple
 * CAMS-folio format and the CDSL combined Demat+MF format.
 *
 * Strategy: rather than trying to reassemble each wrapped multi-line
 * scheme row (fragile), we extract the two things that are genuinely
 * reliable and valuable:
 *   1. Per-AMC subtotal lines (explicitly printed by CAMS) — gives an
 *      exact, authoritative fund-house-wise breakdown.
 *   2. The scheme-code-prefixed lines (e.g. "MAGP-UTI Multi Cap...") to
 *      detect the same scheme appearing more than once (multiple folios
 *      or multiple SIP-linked rows in the same scheme).
 *   3. The single grand total ("Portfolio Value").
 */

function isCamsClassicCas(rawText) {
  return rawText.includes('Summary of Holdings') && / - Total\s/.test(rawText);
}

function parseAmcTotals(rawText) {
  const lines = rawText.split('\n');
  const totals = [];
  const totalLineRegex = /^(.+?)\s*-\s*Total\s+([\d,]+\.\d+)\s*$/;

  for (const line of lines) {
    const match = line.trim().match(totalLineRegex);
    if (match) {
      totals.push({
        amc: match[1].trim(),
        value: parseFloat(match[2].replace(/,/g, ''))
      });
    }
  }
  return totals.sort((a, b) => b.value - a.value);
}

function parseGrandTotal(rawText) {
  // The grand total line is literally "Portfolio Value" followed by a number,
  // appearing after all the AMC subtotal lines and before "Transaction Details".
  const beforeTransactions = rawText.split(/Transaction Details/)[0];
  const lines = beforeTransactions.split('\n').reverse(); // search from the end backward
  for (const line of lines) {
    const match = line.trim().match(/^Portfolio Value\s+([\d,]+\.\d+)\s*$/);
    if (match) return parseFloat(match[1].replace(/,/g, ''));
  }
  return null;
}

/**
 * The scheme NAME wraps unpredictably across lines (sometimes fully on its
 * own line, sometimes starting inline with the folio/ISIN row) depending on
 * how long the code+name text is — this is a PDF column-layout artifact and
 * isn't reliably parseable line-by-line. The ISIN, however, always appears
 * in a fixed position on the main data row. We anchor on ISIN instead: same
 * ISIN appearing more than once means the same scheme is held via multiple
 * rows (typically multiple folios or multiple SIP registrations).
 */
function parseIsinOccurrences(rawText) {
  const beforeTransactions = rawText.split(/Transaction Details/)[0];
  const isinRegex = /\bIN[A-Z0-9#]{10}\b/g;
  const matches = beforeTransactions.match(isinRegex) || [];
  const counts = {};
  for (const isin of matches) counts[isin] = (counts[isin] || 0) + 1;

  // Best-effort: find a scheme-code+name snippet near each ISIN's first
  // occurrence, by scanning forward a few lines for a "CODE-Name" pattern.
  const lines = beforeTransactions.split('\n');
  const nameForIsin = {};
  lines.forEach((line, i) => {
    const isinMatch = line.match(isinRegex);
    if (!isinMatch) return;
    for (let j = i; j < Math.min(i + 4, lines.length); j++) {
      const codeMatch = lines[j].trim().match(/[A-Z0-9#]{3,6}-([A-Za-z][A-Za-z&()\s]{3,60})/);
      if (codeMatch) {
        const isin = isinMatch[0];
        if (!nameForIsin[isin]) nameForIsin[isin] = codeMatch[1].replace(/[-\s]+$/, '').trim();
        break;
      }
    }
  });

  const duplicates = Object.entries(counts)
    .filter(([, count]) => count > 1)
    .map(([isin, count]) => ({ isin, count, scheme: nameForIsin[isin] || ('Scheme with ISIN ' + isin) }));

  return { totalSchemeRows: matches.length, duplicates };
}

function buildCamsClassicSummary(rawText) {
  const amcTotals = parseAmcTotals(rawText);
  const grandTotal = parseGrandTotal(rawText);
  const { totalSchemeRows, duplicates } = parseIsinOccurrences(rawText);

  return {
    format: 'cams-classic',
    totalValue: grandTotal,
    schemeCount: totalSchemeRows,
    amcCount: amcTotals.length,
    allocation: amcTotals.map(a => ({
      category: a.amc,
      value: a.value,
      percent: grandTotal ? Math.round((a.value / grandTotal) * 1000) / 10 : null
    })),
    duplicateSchemes: duplicates.map(d => ({ scheme: d.scheme, count: d.count }))
  };
}

module.exports = { isCamsClassicCas, parseAmcTotals, parseGrandTotal, parseIsinOccurrences, buildCamsClassicSummary };
