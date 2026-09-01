/**
 * SIP progress: looks for "Instalment No - X/Y" patterns which some RTAs
 * print directly in transaction descriptions. Purely descriptive — shows
 * how far into a committed SIP schedule someone is.
 */
function findSipProgress(rawText) {
  const regex = /Instalment No\s*[-:]?\s*(\d+)\s*\/\s*(\d+)/gi;
  const results = [];
  const seen = new Set();
  let match;
  while ((match = regex.exec(rawText)) !== null) {
    const key = match[0];
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ completed: parseInt(match[1], 10), total: parseInt(match[2], 10) });
  }
  return results;
}

/**
 * Investment footprint: counts distinct DP/broker names, AMCs, and RTAs
 * mentioned in the statement — purely a count of how many separate
 * institutions someone's money is spread across.
 */
function buildFootprint(rawText) {
  const dpMatches = rawText.match(/DP Name\s*:\s*([^\n]+)/gi) || [];
  const dps = new Set(dpMatches.map(m => m.replace(/DP Name\s*:\s*/i, '').trim().split(/\s{2,}/)[0]));

  const amcMatches = rawText.match(/AMC Name\s*:\s*([^\n]+)/gi) || [];
  const amcs = new Set(amcMatches.map(m => m.replace(/AMC Name\s*:\s*/i, '').trim()));

  const rtaMatches = rawText.match(/RTA\s*:\s*(CAMS|KFIN|KFINTECH)/gi) || [];
  const rtas = new Set(rtaMatches.map(m => m.split(':')[1].trim().toUpperCase()));

  return {
    brokers: dps.size,
    amcs: amcs.size,
    rtas: rtas.size
  };
}

module.exports = { findSipProgress, buildFootprint };
