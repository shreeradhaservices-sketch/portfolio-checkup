/**
 * Category classification for mutual fund schemes, based purely on
 * keyword matching against standard AMFI scheme-naming conventions.
 * This is descriptive categorization, not a recommendation — we are
 * simply grouping schemes by their stated type, the same way any
 * factsheet does.
 */

const FINE_CATEGORIES = {
  'Large Cap': ['large cap', 'largecap', 'bluechip', 'blue chip', 'top 100', 'top 200'],
  'Mid Cap': ['mid cap', 'midcap'],
  'Small Cap': ['small cap', 'smallcap'],
  'Multicap / Flexicap / Large & Mid': ['flexi cap', 'flexicap', 'multicap', 'multi cap', 'large & mid', 'large and mid', 'focused fund', 'value fund', 'elss', 'tax saver', 'contra fund', 'dividend yield'],
  'Hybrid': ['hybrid fund', 'balanced advantage', 'balanced fund', 'equity savings', 'arbitrage fund'],
  'Multi-Asset': ['multi asset', 'multi-asset'],
  'Gold / Silver': ['gold fund', 'gold savings', 'gold etf', 'gold and silver', 'silver etf'],
  'Debt': ['debt fund', 'short term', 'long term bond', 'gilt fund', 'liquid fund', 'liquid etf', 'liquid bees', 'corporate bond', 'banking and psu', 'banking fd', 'credit risk', 'money market', 'ultra short', 'low duration', 'dynamic bond', 'income fund']
};

const BROAD_CATEGORIES = {
  'Equity': ['Large Cap', 'Mid Cap', 'Small Cap', 'Multicap / Flexicap / Large & Mid'],
  'Hybrid': ['Hybrid'],
  'Multi-Asset': ['Multi-Asset'],
  'Commodity': ['Gold / Silver'],
  'Debt': ['Debt']
};

function classifyFine(schemeName) {
  const lower = schemeName.toLowerCase();
  for (const [category, keywords] of Object.entries(FINE_CATEGORIES)) {
    if (keywords.some(k => lower.includes(k))) return category;
  }
  return 'Other / Unclassified';
}

function classifyBroad(fineCategory) {
  for (const [broad, fineList] of Object.entries(BROAD_CATEGORIES)) {
    if (fineList.includes(fineCategory)) return broad;
  }
  return 'Other';
}

/**
 * Takes a list of {scheme, value} objects and returns both a fine-grained
 * and a broad category breakdown with totals and percentages.
 */
function buildCategoryBreakdown(schemeList) {
  const totalValue = schemeList.reduce((sum, s) => sum + (s.value || 0), 0);
  const fineTotals = {};
  const broadTotals = {};
  const fineSchemes = {};

  for (const s of schemeList) {
    const fine = classifyFine(s.scheme);
    const broad = classifyBroad(fine);
    fineTotals[fine] = (fineTotals[fine] || 0) + (s.value || 0);
    broadTotals[broad] = (broadTotals[broad] || 0) + (s.value || 0);
    if (!fineSchemes[fine]) fineSchemes[fine] = [];
    fineSchemes[fine].push(s.scheme);
  }

  const toArray = (totals) => Object.entries(totals)
    .map(([category, value]) => ({
      category,
      value: Math.round(value),
      percent: totalValue > 0 ? Math.round((value / totalValue) * 1000) / 10 : 0
    }))
    .sort((a, b) => b.value - a.value);

  return {
    fine: toArray(fineTotals),
    broad: toArray(broadTotals),
    fineSchemes
  };
}

module.exports = { classifyFine, classifyBroad, buildCategoryBreakdown };
