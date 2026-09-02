const { classifyFine, classifyBroad } = require('./category-classifier');
const { stripBoilerplate } = require('./strip-boilerplate');

/**
 * Parses direct demat holdings (shares, ETFs, SGBs) and bonds from a CDSL
 * CAS. Anchored on ISIN (a fixed token) rather than the security name,
 * which wraps unpredictably before AND after the data row — the same
 * approach used for the mutual fund gain/loss table.
 *
 * Classification logic — this is the important part:
 *   - ISIN prefix "INE" -> a genuine individual company share
 *   - ISIN prefix "INF" -> a mutual fund/ETF UNIT held in demat form, not
 *     an individual company. CDSL's own official summary already counts
 *     this separately under "Mutual Funds Held in Demat Form" — so these
 *     must NEVER be added to direct equity value or the company count,
 *     or that figure gets inflated above CDSL's own reported Equity total.
 *   - Sovereign Gold Bonds (GOVT OF INDIA ... SGB) -> Commodity
 *   - The separate Bonds table -> always Debt (that's what the table is)
 */

function parseHoldingRows(sectionText) {
  const lines = stripBoilerplate(sectionText).split('\n').filter(l =>
    l.trim() && !l.match(/Current\s+Frozen|Pledge|Free Bal|Market|Price|Face|Value \(`\)|^\s*Bal\s*$|Security$|HOLDING STATEMENT/)
  );
  const isinRegex = /\bIN[A-Z0-9]{10}\b/;
  const holdings = [];
  let precedingText = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isinMatch = line.match(isinRegex);
    if (isinMatch) {
      const isinIndex = line.indexOf(isinMatch[0]);
      const beforeIsin = line.slice(0, isinIndex).trim();
      const afterIsin = line.slice(isinIndex + isinMatch[0].length);
      const numbers = afterIsin.match(/[\d,]+\.\d+/g) || [];
      const afterIsinText = afterIsin.split(/\s+-?[\d,]+\.\d+/)[0].trim();
      const nextLine = (i + 1 < lines.length && !lines[i + 1].match(isinRegex)) ? lines[i + 1].trim() : '';

      if (numbers.length >= 1) {
        const value = parseFloat(numbers[numbers.length - 1].replace(/,/g, ''));
        const name = [...precedingText, beforeIsin, afterIsinText, nextLine].join(' ').replace(/\s+/g, ' ').trim();
        if (name && !isNaN(value) && value > 0) {
          holdings.push({ isin: isinMatch[0], name, value });
        }
      }
      precedingText = [];
    } else if (line.trim() && !line.match(/Portfolio Value|Page \d/)) {
      precedingText.push(line.trim());
      if (precedingText.length > 2) precedingText.shift();
    }
  }
  return holdings;
}

/**
 * Returns { broadCategory, isCompanyShare }. Only a genuine "INE" company
 * share with no matching fund/commodity keyword is treated as an
 * individual company for the direct-equity total and company count.
 */
function classifyDematHolding(isin, name) {
  if (/GOVT OF INDIA.*SGB|SOVEREIGN GOLD BOND/i.test(name)) {
    return { broadCategory: 'Commodity', isCompanyShare: false };
  }
  const fine = classifyFine(name);
  if (fine !== 'Other / Unclassified') {
    return { broadCategory: classifyBroad(fine), isCompanyShare: false };
  }
  if (isin.startsWith('INE')) {
    return { broadCategory: 'Equity', isCompanyShare: true };
  }
  // An "INF"-prefixed fund/ETF unit that didn't match a specific keyword —
  // still equity-natured in most cases (e.g. a broad index ETF), but NOT
  // an individual company.
  return { broadCategory: 'Equity', isCompanyShare: false };
}

function parseDematHoldings(rawText) {
  const blocks = rawText.match(/HOLDING STATEMENT AS ON[\s\S]*?(?=HOLDING STATEMENT|Portfolio Value for Bond|DP Name|$)/g) || [];
  const allHoldings = [];
  for (const block of blocks) {
    allHoldings.push(...parseHoldingRows(block));
  }

  const bondBlocks = rawText.match(/HOLDING STATEMENT OF BONDS AS ON[\s\S]*?(?=Portfolio Value for Bond|DP Name|$)/g) || [];
  const bondHoldings = [];
  for (const block of bondBlocks) {
    bondHoldings.push(...parseHoldingRows(block));
  }

  let directEquityValue = 0, directCommodityValue = 0, directOtherValue = 0, dematFundUnitsValue = 0;
  const companyIsins = new Set();
  const classified = [];

  for (const h of allHoldings) {
    const { broadCategory, isCompanyShare } = classifyDematHolding(h.isin, h.name);
    classified.push({ ...h, category: broadCategory, isCompanyShare });

    if (isCompanyShare) {
      directEquityValue += h.value;
      companyIsins.add(h.isin);
    } else if (broadCategory === 'Commodity') {
      directCommodityValue += h.value;
    } else if (broadCategory === 'Equity') {
      // A fund/ETF unit that IS equity-natured but not an individual company —
      // counted toward broad equity exposure, kept out of "direct equity".
      dematFundUnitsValue += h.value;
    } else {
      directOtherValue += h.value;
    }
  }

  const directDebtValue = bondHoldings.reduce((sum, b) => sum + b.value, 0);
  for (const b of bondHoldings) classified.push({ ...b, category: 'Debt', isCompanyShare: false });

  return {
    directEquityValue: Math.round(directEquityValue),
    dematFundUnitsValue: Math.round(dematFundUnitsValue),
    directCommodityValue: Math.round(directCommodityValue),
    directDebtValue: Math.round(directDebtValue),
    directOtherValue: Math.round(directOtherValue),
    companyCount: companyIsins.size,
    holdings: classified
  };
}

module.exports = { parseDematHoldings, parseHoldingRows, classifyDematHolding };
