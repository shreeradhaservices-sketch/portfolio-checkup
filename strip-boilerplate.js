/**
 * CDSL statements repeat certain boilerplate on every single page: the
 * company letterhead, the document title, the investor's own name (as a
 * running header), and page numbers. When a holding or scheme wraps across
 * a page break, this boilerplate sits right in the middle of it and was
 * leaking into captured names — causing both messy display text and, in
 * rarer cases, two adjacent holdings' text merging into one row.
 *
 * This is applied once, up front, by every parser that does line-based
 * name reconstruction, so the fix lives in one place rather than being
 * patched separately in each parser as new cases turn up.
 */
function stripBoilerplate(rawText) {
  const lines = rawText.split('\n');
  const filtered = lines.filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return true; // keep blank lines, they're harmless separators
    if (/Central Depository Services/i.test(trimmed)) return false;
    if (/Marathon Futurex|Mafatlal Mills|Lower Parel/i.test(trimmed)) return false;
    if (/CONSOLIDATED ACCOUNT STATEMENT|SECURITIES HELD IN DEMAT|FORM AND INVESTMENTS IN MUTUAL FUNDS/i.test(trimmed)) return false;
    if (/^Page\s+\d+\s+of\s+\d+/i.test(trimmed)) return false;
    if (/^CAS ID\s*:/i.test(trimmed)) return false;
    // A running header of the investor's own name repeats on every page,
    // typically as short ALL-CAPS text ending in a period, e.g.
    // "PARESH LAXMANBHAI CHAUDHARY ." — real scheme/company names almost
    // always contain a digit, lowercase word, or punctuation like "-" that
    // this narrow pattern won't match.
    if (/^[A-Z][A-Z\s]{5,60}\.\s*$/.test(trimmed)) return false;
    return true;
  });
  return filtered.join('\n');
}

module.exports = { stripBoilerplate };
