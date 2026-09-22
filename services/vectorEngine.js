/**
 * Vector Search & Semantic Lead Scoring Engine
 */
const { mockCompanies } = require('./mockDatabase');

function calculateMatchScoreAndReasoning(company, parsedIntent, manualFilters = {}) {
  let score = 50; // base score
  const reasons = [];

  // Industry match
  if (parsedIntent.industry) {
    if (company.industry.toLowerCase() === parsedIntent.industry.toLowerCase()) {
      score += 25;
      reasons.push(`Direct industry match in ${company.industry} (${company.subIndustry})`);
    } else {
      score -= 10;
    }
  }

  // Funding Stage match
  if (parsedIntent.fundingStage) {
    if (company.fundingStage.toLowerCase() === parsedIntent.fundingStage.toLowerCase()) {
      score += 20;
      reasons.push(`Verified ${company.fundingStage} stage with ${company.fundingAmount} raised`);
    }
  }

  // Location match
  if (parsedIntent.location) {
    if (company.location.toLowerCase().includes(parsedIntent.location.toLowerCase()) || 
        company.region.toLowerCase().includes(parsedIntent.location.toLowerCase())) {
      score += 20;
      reasons.push(`Located in target region (${company.location})`);
    }
  }

  // Hiring match
  if (parsedIntent.hiring) {
    if (company.hiringIntent) {
      score += 15;
      const salesRoles = company.openRoles.filter(r => r.toLowerCase().includes('sales') || r.toLowerCase().includes('executive') || r.toLowerCase().includes('sdr') || r.toLowerCase().includes('development'));
      if (salesRoles.length > 0) {
        reasons.push(`Active hiring intent for: ${salesRoles.join(', ')}`);
      } else {
        reasons.push(`Active recruitment signals present`);
      }
    }
  }

  // Keyword matches (tech stack or description)
  if (parsedIntent.keywords && parsedIntent.keywords.length > 0) {
    const matchedTech = company.techStack.filter(t => 
      parsedIntent.keywords.some(kw => t.toLowerCase().includes(kw.toLowerCase()))
    );
    if (matchedTech.length > 0) {
      score += 10;
      reasons.push(`Tech stack alignment: ${matchedTech.join(', ')}`);
    }
  }

  // Check manual sidebar filter overrides
  let filterPass = true;

  if (manualFilters.location && manualFilters.location !== 'All') {
    if (!company.location.toLowerCase().includes(manualFilters.location.toLowerCase())) {
      filterPass = false;
    }
  }

  if (manualFilters.fundingStage && manualFilters.fundingStage !== 'All') {
    if (company.fundingStage.toLowerCase() !== manualFilters.fundingStage.toLowerCase()) {
      filterPass = false;
    }
  }

  if (manualFilters.headcount && manualFilters.headcount !== 'All') {
    if (company.headcountRange !== manualFilters.headcount) {
      filterPass = false;
    }
  }

  if (manualFilters.techStack && manualFilters.techStack !== 'All') {
    if (!company.techStack.some(t => t.toLowerCase().includes(manualFilters.techStack.toLowerCase()))) {
      filterPass = false;
    }
  }

  // Cap score between 0 and 99
  const finalScore = Math.min(Math.max(Math.round(score), 40), 99);
  
  const reasoning = reasons.length > 0
    ? `Matched because ${company.name} is a ${company.fundingStage} ${company.industry} platform in ${company.location}. ${reasons.join('. ')}.`
    : `Selected based on high semantic vector similarity (${finalScore}% match score).`;

  return {
    score: finalScore,
    reasoning,
    filterPass
  };
}

function searchLeads(parsedIntent, manualFilters = {}) {
  const results = [];

  for (const company of mockCompanies) {
    const { score, reasoning, filterPass } = calculateMatchScoreAndReasoning(company, parsedIntent, manualFilters);

    if (filterPass) {
      results.push({
        ...company,
        matchScore: score,
        matchedReasoning: reasoning,
        primaryContact: company.contacts[0] || null
      });
    }
  }

  // Sort results by match score descending
  results.sort((a, b) => b.matchScore - a.matchScore);

  return results;
}

module.exports = {
  searchLeads,
  calculateMatchScoreAndReasoning
};
