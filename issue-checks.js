/**
 * Purely factual observations extracted from the statement. Every check
 * here reports a count or a status already printed in the document itself
 * — none of them make a judgment call or a recommendation. This keeps the
 * tool squarely on the "distribution" side of the SEBI distributor/advisor
 * line, not the "advice" side.
 */

function checkNomineeNotRegistered(rawText) {
  const matches = rawText.match(/Nominee\s*:\s*Not Registered/gi) || [];
  return matches.length;
}

function checkKycNotOk(rawText) {
  const allKyc = rawText.match(/KYC of Investor\/s\s*:\s*(\S[^\n]*)/gi) || [];
  let notOkCount = 0;
  for (const line of allKyc) {
    if (!/KYC OK/i.test(line)) notOkCount++;
  }
  return notOkCount;
}

/**
 * Splits scheme names into Direct vs Regular plan, purely as a factual
 * count — not a suggestion to convert between them (that would be advice).
 */
function checkPlanTypeMix(schemeList) {
  let direct = 0, regular = 0, unspecified = 0;
  for (const s of schemeList) {
    const lower = s.scheme.toLowerCase();
    if (lower.includes('direct')) direct++;
    else if (lower.includes('regular')) regular++;
    else unspecified++;
  }
  return { direct, regular, unspecified };
}

/**
 * From the category classifier's fineSchemes map, surfaces categories
 * where more than one scheme is held — named explicitly, as a count only.
 */
function checkCategoryConcentration(fineSchemes) {
  return Object.entries(fineSchemes)
    .filter(([category, schemes]) => schemes.length > 1 && category !== 'Other / Unclassified')
    .map(([category, schemes]) => ({ category, count: schemes.length, schemes }));
}

function buildIssueChecks(rawText, schemeList, fineSchemes) {
  const issues = [];

  const nomineeCount = checkNomineeNotRegistered(rawText);
  if (nomineeCount > 0) {
    issues.push({
      type: 'nominee',
      text: nomineeCount === 1
        ? '1 account has no nominee registered.'
        : nomineeCount + ' accounts have no nominee registered.'
    });
  }

  const kycCount = checkKycNotOk(rawText);
  if (kycCount > 0) {
    issues.push({
      type: 'kyc',
      text: kycCount === 1
        ? '1 folio shows a KYC status other than OK.'
        : kycCount + ' folios show a KYC status other than OK.'
    });
  }

  if (schemeList && schemeList.length > 0) {
    const planMix = checkPlanTypeMix(schemeList);
    if (planMix.direct > 0 && planMix.regular > 0) {
      issues.push({
        type: 'plan-mix',
        text: 'You hold ' + planMix.direct + ' Direct Plan and ' + planMix.regular + ' Regular Plan scheme(s).'
      });
    }
  }

  if (fineSchemes) {
    const concentration = checkCategoryConcentration(fineSchemes);
    for (const c of concentration) {
      issues.push({
        type: 'concentration',
        text: 'You hold ' + c.count + ' schemes in the ' + c.category + ' category: ' + c.schemes.join(', ') + '.'
      });
    }
  }

  return issues;
}

module.exports = { checkNomineeNotRegistered, checkKycNotOk, checkPlanTypeMix, checkCategoryConcentration, buildIssueChecks };
