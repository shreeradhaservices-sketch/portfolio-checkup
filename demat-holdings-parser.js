const { classifyFine, classifyBroad } = require('./category-classifier');

/**
 * Parses direct demat holdings (shares, ETFs, SGBs) and bonds from a CDSL
 * CAS. Anchored on ISIN (a fixed token) rather than the security name,
 * which wraps unpredictably before AND after the data row — the same
 * approach used for the mutual fund gain/loss table.
 *
 * Classification logic:
 *   - Sovereign Gold Bonds (GOVT OF INDIA ... SGB) -> Commodity
 *   - ETFs/instruments matching our category keywords (gold, liquid, debt
 *     index) -> classified the same way a scheme name would be
 *   - Everything else with an "INE" ISIN prefix -> plain Equity share
 *   - The separate Bonds table -> always Debt (that's what the table is)
 */

function parseHoldingRows(sectionText) {
  const lines = sectionText.split('\n').filter(l =>
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
      // Text after the ISIN but before the numeric columns start (if any) —
      // relevant for rows like "INF...  LTD#NIPPON INDIA MF-NIPPON  100.000 ...".
      const afterIsinText = afterIsin.split(/\s+-?[\d,]+\.\d+/)[0].trim();
      // One line of lookahead — some identifying keywords (e.g. "GOLD BEES")
      // sit on a trailing continuation line after the numeric row.
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

function classifyDematHolding(name) {
  if (/GOVT OF INDIA.*SGB|SOVEREIGN GOLD BOND/i.test(name)) return 'Commodity';
  const fine = classifyFine(name);
  if (fine !== 'Other / Unclassified') return classifyBroad(fine);
  return 'Equity'; // default: an individual company share
}

function parseDematHoldings(rawText) {
  // Every "HOLDING STATEMENT AS ON <date>" block (one per demat account)
  const blocks = rawText.match(/HOLDING STATEMENT AS ON[\s\S]*?(?=HOLDING STATEMENT|Portfolio Value for Bond|DP Name|$)/g) || [];
  const allHoldings = [];
  for (const block of blocks) {
    allHoldings.push(...parseHoldingRows(block));
  }

  // Bonds table(s) — always Debt, regardless of name.
  const bondBlocks = rawText.match(/HOLDING STATEMENT OF BONDS AS ON[\s\S]*?(?=Portfolio Value for Bond|DP Name|$)/g) || [];
  const bondHoldings = [];
  for (const block of bondBlocks) {
    bondHoldings.push(...parseHoldingRows(block));
  }

  let directEquityValue = 0, directCommodityValue = 0, directOtherValue = 0;
  const companyIsins = new Set();
  const classified = [];

  for (const h of allHoldings) {
    const category = classifyDematHolding(h.name);
    classified.push({ ...h, category });
    if (category === 'Equity') {
      directEquityValue += h.value;
      companyIsins.add(h.isin);
    } else if (category === 'Commodity') {
      directCommodityValue += h.value;
    } else {
      directOtherValue += h.value;
    }
  }

  const directDebtValue = bondHoldings.reduce((sum, b) => sum + b.value, 0);
  for (const b of bondHoldings) classified.push({ ...b, category: 'Debt' });

  return {
    directEquityValue: Math.round(directEquityValue),
    directCommodityValue: Math.round(directCommodityValue),
    directDebtValue: Math.round(directDebtValue),
    directOtherValue: Math.round(directOtherValue),
    companyCount: companyIsins.size,
    holdings: classified
  };
}

module.exports = { parseDematHoldings, parseHoldingRows, classifyDematHolding };
