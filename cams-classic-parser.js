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

  const allNames = Object.keys(counts).map(isin => nameForIsin[isin]).filter(Boolean);

  return { totalSchemeRows: matches.length, duplicates, allNames };
}

/**
 * Counts how many schemes fall under each AMC by splitting the document
 * into blocks at each "AMC - Total" boundary (the block ending at that
 * line is that AMC's own section) and counting ISINs within each block.
 */
function parseSchemeCountPerAmc(rawText) {
  const beforeTransactions = rawText.split(/Transaction Details/)[0];
  const totalLineRegex = /^(.+?)\s*-\s*Total\s+[\d,]+\.\d+\s*$/;
  const isinRegex = /\bIN[A-Z0-9#]{10}\b/g;
  const lines = beforeTransactions.split('\n');

  const results = [];
  let blockLines = [];
  for (const line of lines) {
    const match = line.trim().match(totalLineRegex);
    blockLines.push(line);
    if (match) {
      const blockText = blockLines.join('\n');
      const isins = new Set(blockText.match(isinRegex) || []);
      results.push({ amc: match[1].trim(), schemeCount: isins.size });
      blockLines = [];
    }
  }
  return results;
}

const { classifyFine, classifyBroad } = require('./category-classifier');
const { buildIssueChecks, checkPlanTypeMix, checkCategoryConcentration, checkAmcConcentration } = require('./issue-checks');
const { buildPersonalization } = require('./personalization');
const { findSipProgress } = require('./sip-footprint');

/**
 * Category breakdown BY SCHEME COUNT (not rupee value) — we don't have
 * reliable per-scheme values in this format, only AMC-level totals, so
 * we count how many schemes fall in each category instead.
 */
function buildCategoryByCount(duplicates, allSchemeNames) {
  const fineCounts = {};
  const fineSchemes = {};
  for (const name of allSchemeNames) {
    const fine = classifyFine(name);
    fineCounts[fine] = (fineCounts[fine] || 0) + 1;
    if (!fineSchemes[fine]) fineSchemes[fine] = [];
    fineSchemes[fine].push(name);
  }
  const fine = Object.entries(fineCounts)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
  return { fine, fineSchemes };
}

const DIVERSIFICATION_NOTE = 'True diversification depends on how different the underlying holdings are, not just the number of schemes, categories, or fund houses held.';

function buildCamsClassicSummary(rawText) {
  const amcTotals = parseAmcTotals(rawText);
  const grandTotal = parseGrandTotal(rawText);
  const { totalSchemeRows, duplicates, allNames } = parseIsinOccurrences(rawText);
  const { fine, fineSchemes } = buildCategoryByCount(duplicates, allNames);
  const planMix = checkPlanTypeMix(allNames.map(n => ({ scheme: n })));
  const concentration = checkCategoryConcentration(fineSchemes);
  const amcSchemeCounts = parseSchemeCountPerAmc(rawText);
  const amcConcentration = amcSchemeCounts.filter(a => a.schemeCount >= 3);
  const personalization = buildPersonalization(rawText, grandTotal);
  const sipProgress = findSipProgress(rawText);

  const issues = [];
  let hasConcentrationConcern = false;
  if (planMix.direct > 0 && planMix.regular > 0) {
    issues.push({ type: 'plan-mix', text: 'You hold ' + planMix.direct + ' Direct Plan and ' + planMix.regular + ' Regular Plan scheme(s).' });
  }
  for (const c of concentration) {
    issues.push({ type: 'concentration', text: 'You hold ' + c.count + ' schemes in the ' + c.category + ' category: ' + c.schemes.join(', ') + '.' });
    hasConcentrationConcern = true;
  }
  for (const a of amcConcentration) {
    issues.push({ type: 'amc-concentration', text: 'You hold ' + a.schemeCount + ' schemes from ' + a.amc + '.' });
    hasConcentrationConcern = true;
  }
  for (const d of duplicates) {
    issues.push({ type: 'duplicate', text: 'You hold the same scheme across ' + d.count + ' separate folios: ' + d.scheme + '.' });
  }

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
    categoryBreakdown: { fine, fineSchemes },
    duplicateSchemes: duplicates.map(d => ({ scheme: d.scheme, count: d.count })),
    issues,
    diversificationNote: hasConcentrationConcern ? DIVERSIFICATION_NOTE : null,
    personalization,
    sipProgress,
    footprint: { amcs: amcTotals.length }
  };
}

module.exports = { isCamsClassicCas, parseAmcTotals, parseGrandTotal, parseIsinOccurrences, buildCamsClassicSummary };
