/**
 * Purely factual, personal-touch features. Every number here is read
 * directly from the statement or is simple arithmetic/date comparison —
 * nothing here is a judgment or recommendation.
 */

function extractInvestorName(rawText) {
  const lines = rawText.split('\n');

  // CDSL format: "PARESH LAXMANBHAI CHAUDHARY . ( PAN :AGXPC1234G )"
  // Searched line-by-line (not across the whole text) so we never
  // accidentally span into unrelated header/footer text above it.
  for (const line of lines) {
    const match = line.match(/([A-Z][A-Z\s.]{3,60}?)\.?\s*\(\s*PAN\s*:/);
    if (match) return titleCase(match[1].trim());
  }

  // CAMS classic format: name appears alone on its own line, followed by
  // an address line starting with S/O or W/O.
  for (let i = 0; i < lines.length - 1; i++) {
    const candidate = lines[i].trim();
    const nextLine = lines[i + 1];
    if (/^[A-Z][A-Z\s.()]{4,60}$/.test(candidate) && /S\/O|W\/O|D\/O/.test(nextLine)) {
      return titleCase(candidate);
    }
  }

  return null;
}

function titleCase(str) {
  return str.split(' ').map(w => w.length > 2 ? w[0] + w.slice(1).toLowerCase() : w).join(' ').trim();
}

const MILESTONES = [100000, 500000, 1000000, 2500000, 5000000, 10000000, 25000000, 50000000, 100000000];

function nearestMilestone(totalValue) {
  if (!totalValue) return null;
  // Find the highest milestone that has been crossed.
  const crossed = MILESTONES.filter(m => totalValue >= m);
  if (crossed.length === 0) return null;
  return crossed[crossed.length - 1];
}

function formatIndianCurrency(value) {
  if (value >= 10000000) return '₹' + (value / 10000000).toFixed(value % 10000000 === 0 ? 0 : 1) + ' Crore';
  if (value >= 100000) return '₹' + (value / 100000).toFixed(value % 100000 === 0 ? 0 : 1) + ' Lakh';
  return '₹' + value.toLocaleString('en-IN');
}

/**
 * Finds the earliest date mentioned in an allotment/transaction context,
 * to spotlight how long someone has been investing. Looks for common
 * date formats used across CAS statements (DD-Mon-YYYY, DD/MM/YYYY).
 */
/**
 * Finds the earliest date associated with an actual transaction or
 * allotment — restricted to lines containing transaction-context keywords,
 * so we never accidentally pick up an unrelated date from legal/regulatory
 * boilerplate text (e.g. a SEBI circular date) elsewhere in the document.
 */
function findEarliestDate(rawText) {
  const dateRegex = /\b(\d{1,2})[-\/](Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d{1,2})[-\/](\d{4})\b/gi;
  const monthMap = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
  const contextKeywords = /Systematic|Purchase|Allotment|Opening Balance|SIP|Instalment|Transaction/i;

  let earliest = null;
  const lines = rawText.split('\n');

  for (const line of lines) {
    if (!contextKeywords.test(line)) continue;
    let match;
    dateRegex.lastIndex = 0;
    while ((match = dateRegex.exec(line)) !== null) {
      const day = parseInt(match[1], 10);
      const monthRaw = match[2].toLowerCase();
      const month = isNaN(monthRaw) ? monthMap[monthRaw.slice(0, 3)] : parseInt(monthRaw, 10) - 1;
      const year = parseInt(match[3], 10);
      if (month === undefined || year < 2000 || year > 2030) continue;
      const date = new Date(year, month, day);
      if (!earliest || date < earliest) earliest = date;
    }
  }
  return earliest;
}

function yearsAndMonthsSince(date) {
  if (!date) return null;
  const now = new Date();
  let months = (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth());
  const years = Math.floor(months / 12);
  const remMonths = months % 12;
  return { years, months: remMonths, date };
}

function buildPersonalization(rawText, totalValue) {
  const name = extractInvestorName(rawText);
  const milestone = nearestMilestone(totalValue);
  const earliestDate = findEarliestDate(rawText);
  const journeyLength = yearsAndMonthsSince(earliestDate);

  return {
    investorName: name,
    milestone: milestone ? { value: milestone, formatted: formatIndianCurrency(milestone) } : null,
    journey: journeyLength ? {
      startDate: journeyLength.date.toISOString().slice(0, 10),
      years: journeyLength.years,
      months: journeyLength.months
    } : null
  };
}

module.exports = { extractInvestorName, nearestMilestone, formatIndianCurrency, findEarliestDate, yearsAndMonthsSince, buildPersonalization };
