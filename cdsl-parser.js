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

function parseStatementDate(rawText) {
  const match = rawText.match(/Total Portfolio Value across investments\s*[₹`]\s*[\d,]+\.\d+\s*as on\s*(\d{2}-\d{2}-\d{4})/i);
  return match ? match[1] : null;
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

/**
 * Extracts the "MUTUAL FUND UNITS HELD AS ON <date>" table, which contains
 * per-scheme Cumulative Amount Invested, Valuation, and Unrealised Profit/
 * Loss. We use this purely to total up invested-vs-current and the overall
 * gain/loss — this is arithmetic on numbers CDSL already printed per
 * scheme, not our own valuation or recommendation.
 */
function parseGainLoss(rawText) {
  const sectionMatch = rawText.match(/MUTUAL FUND UNITS HELD AS ON[\s\S]*?(?=Load Structures|NOTES TO CAS|$)/);
  if (!sectionMatch) return null;
  const section = sectionMatch[0];

  const grandTotalMatch = section.match(/Grand Total\s+([\d,]+\.\d+)\s+([\d,]+\.\d+)/);
  if (grandTotalMatch) {
    const invested = parseFloat(grandTotalMatch[1].replace(/,/g, ''));
    const valuation = parseFloat(grandTotalMatch[2].replace(/,/g, ''));
    const gain = Math.round((valuation - invested) * 100) / 100;
    const gainPercent = invested > 0 ? Math.round((gain / invested) * 10000) / 100 : null;
    return { totalInvested: invested, totalValuation: valuation, totalGain: gain, totalGainPercent: gainPercent };
  }
  return null;
}

/**
 * Extracts per-scheme rows (name + valuation) from the gain/loss table,
 * anchored on the ISIN (a fixed, reliable token) rather than the scheme
 * name text, which wraps unpredictably before AND after the data row.
 * The name captured is best-effort (text preceding the ISIN on the same
 * logical row) — good enough to identify the scheme for category
 * classification and charting, even if not word-perfect.
 */
function parseSchemeValues(rawText) {
  const sectionMatch = rawText.match(/MUTUAL FUND UNITS HELD AS ON[\s\S]*?(?=Load Structures|NOTES TO CAS|$)/);
  if (!sectionMatch) return [];
  // The column header block repeats on every page of a multi-page statement,
  // and wraps across several lines ("Cumulative" / "Amount" / "Invested (in"
  // / "INR)" / "Unrealised" / "Profit/Loss" / "sed" / "Profit/" / "Loss(%)"
  // etc). We filter out every fragment of it so none of it leaks into a
  // scheme name.
  const headerFilter = /Cumulative|Amount|Invested|Unrealised|Profit|Loss\s*\(%\)|Scheme Name|Folio No|^\s*ISIN\s*$|Closing|^\s*Bal\s*$|NAV\s*\(|Valuation\s*\(|\(Units\)|^\s*INR\s*\)|MUTUAL FUND UNITS HELD|^\s*sed\s*$/i;
  const lines = sectionMatch[0].split('\n').filter(l => l.trim() && !headerFilter.test(l));
  const isinRegex = /\bIN[A-Z0-9]{10}\b/;
  const schemes = [];
  let precedingText = [];

  for (const line of lines) {
    const isinMatch = line.match(isinRegex);
    if (isinMatch) {
      const isinIndex = line.indexOf(isinMatch[0]);
      const beforeIsin = line.slice(0, isinIndex).trim();
      const afterIsin = line.slice(isinIndex + isinMatch[0].length);

      // Numbers after the ISIN: unit balance, NAV, invested, valuation, gain, gain%
      // (6 total) — valuation is 3rd-from-end.
      const numbers = afterIsin.match(/[\d,]+\.\d+/g) || [];
      if (numbers.length >= 3) {
        const valuation = parseFloat(numbers[numbers.length - 3].replace(/,/g, ''));
        const fullName = [...precedingText, beforeIsin].join(' ')
          .replace(/^[A-Z0-9]{2,6}\s*-\s*/, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (fullName && !isNaN(valuation)) {
          schemes.push({ scheme: fullName, value: valuation });
        }
      }
      precedingText = [];
    } else if (line.trim() && !line.includes('Grand Total')) {
      precedingText.push(line.trim());
      if (precedingText.length > 2) precedingText.shift();
    }
  }

  return schemes;
}

const { buildCategoryBreakdown, classifyBroad } = require('./category-classifier');
const { buildIssueChecks } = require('./issue-checks');
const { buildPersonalization } = require('./personalization');
const { buildFootprint } = require('./sip-footprint');
const { parseDematHoldings } = require('./demat-holdings-parser');

/**
 * Builds ONE unified broad-category view across everything the statement
 * covers — direct equity shares, direct bonds, gold/SGB, AND mutual fund
 * schemes — rather than looking at mutual funds alone. This is what makes
 * the broad chart actually reflect the whole portfolio.
 */
function buildUnifiedBroadCategory(mfBroad, demat) {
  const totals = {};
  for (const b of mfBroad) totals[b.category] = (totals[b.category] || 0) + b.value;
  totals['Equity'] = (totals['Equity'] || 0) + demat.directEquityValue;
  totals['Debt'] = (totals['Debt'] || 0) + demat.directDebtValue;
  totals['Commodity'] = (totals['Commodity'] || 0) + demat.directCommodityValue;
  if (demat.directOtherValue > 0) totals['Others'] = (totals['Others'] || 0) + demat.directOtherValue;

  const grandTotal = Object.values(totals).reduce((a, b) => a + b, 0);
  return Object.entries(totals)
    .filter(([, value]) => value > 0)
    .map(([category, value]) => ({
      category,
      value: Math.round(value),
      percent: grandTotal > 0 ? Math.round((value / grandTotal) * 1000) / 10 : 0
    }))
    .sort((a, b) => b.value - a.value);
}

function buildTopHoldings(schemeValues, dematHoldings) {
  const all = [
    ...schemeValues.map(s => ({ name: s.scheme, value: s.value })),
    ...dematHoldings.holdings.map(h => ({ name: h.name, value: h.value }))
  ];
  return all.sort((a, b) => b.value - a.value).slice(0, 5);
}

function buildCdslSummary(rawText) {
  const allocation = parseAssetAllocation(rawText);
  const totalValue = parseTotalPortfolioValue(rawText);
  const statementDate = parseStatementDate(rawText);
  const folios = parseMfFolios(rawText);
  const gainLoss = parseGainLoss(rawText);
  const schemeValues = parseSchemeValues(rawText);
  const demat = parseDematHoldings(rawText);

  const mfCategoryBreakdown = buildCategoryBreakdown(schemeValues.length > 0 ? schemeValues : folios.map(f => ({ scheme: f.scheme, value: 0 })));
  const broadCategory = buildUnifiedBroadCategory(mfCategoryBreakdown.broad, demat);
  const { issues, diversificationNote } = buildIssueChecks(rawText, schemeValues.length > 0 ? schemeValues : folios, mfCategoryBreakdown.fineSchemes, folios);
  const personalization = buildPersonalization(rawText, totalValue);
  const footprint = buildFootprint(rawText);
  const topHoldings = buildTopHoldings(schemeValues, demat);

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
    statementDate,
    schemeCount: folios.length,
    amcCount: amcSet.size,
    allocation,
    duplicateSchemes,
    gainLoss,
    categoryBreakdown: { fine: mfCategoryBreakdown.fine, fineSchemes: mfCategoryBreakdown.fineSchemes, broad: broadCategory },
    directEquity: { value: demat.directEquityValue, companyCount: demat.companyCount },
    topHoldings,
    issues,
    diversificationNote,
    personalization,
    footprint,
    folios
  };
}

module.exports = { isCdslCas, parseAssetAllocation, parseTotalPortfolioValue, parseStatementDate, parseMfFolios, parseGainLoss, parseSchemeValues, buildCdslSummary };
