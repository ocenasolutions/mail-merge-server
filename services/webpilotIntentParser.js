/**
 * Intent Parser Service
 * Converts natural language query into structured parameters for vector search
 */
function parseNaturalLanguageIntent(prompt = '') {
  const lowerPrompt = prompt.toLowerCase();

  // Extract Industry
  let industry = null;
  if (lowerPrompt.includes('fintech') || lowerPrompt.includes('banking') || lowerPrompt.includes('payment') || lowerPrompt.includes('remittance') || lowerPrompt.includes('insurance')) {
    industry = 'Fintech';
  } else if (lowerPrompt.includes('cyber') || lowerPrompt.includes('security') || lowerPrompt.includes('privacy') || lowerPrompt.includes('compliance')) {
    industry = 'Cybersecurity';
  } else if (lowerPrompt.includes('health') || lowerPrompt.includes('medical') || lowerPrompt.includes('clinical') || lowerPrompt.includes('care')) {
    industry = 'Healthcare';
  } else if (lowerPrompt.includes('devops') || lowerPrompt.includes('cloud') || lowerPrompt.includes('kubernetes') || lowerPrompt.includes('infrastructure')) {
    industry = 'DevOps & Cloud';
  } else if (lowerPrompt.includes('sales') || lowerPrompt.includes('crm') || lowerPrompt.includes('sdr') || lowerPrompt.includes('prospecting')) {
    industry = 'Sales Tech';
  } else if (lowerPrompt.includes('supply') || lowerPrompt.includes('logistics') || lowerPrompt.includes('fulfillment') || lowerPrompt.includes('inventory')) {
    industry = 'Supply Chain';
  }

  // Extract Funding Stage
  let fundingStage = null;
  if (lowerPrompt.includes('series a')) {
    fundingStage = 'Series A';
  } else if (lowerPrompt.includes('series b')) {
    fundingStage = 'Series B';
  } else if (lowerPrompt.includes('seed')) {
    fundingStage = 'Seed';
  }

  // Extract Location / Region
  let location = null;
  if (lowerPrompt.includes('london') || lowerPrompt.includes('uk') || lowerPrompt.includes('united kingdom') || lowerPrompt.includes('england')) {
    location = 'London, UK';
  } else if (lowerPrompt.includes('san francisco') || lowerPrompt.includes('sf') || lowerPrompt.includes('bay area') || lowerPrompt.includes('california')) {
    location = 'San Francisco, CA';
  } else if (lowerPrompt.includes('new york') || lowerPrompt.includes('ny') || lowerPrompt.includes('nyc')) {
    location = 'New York, NY';
  } else if (lowerPrompt.includes('berlin') || lowerPrompt.includes('germany') || lowerPrompt.includes('europe')) {
    location = 'Berlin, Germany';
  } else if (lowerPrompt.includes('austin') || lowerPrompt.includes('texas')) {
    location = 'Austin, TX';
  }

  // Extract Hiring Intent & Roles
  const hiring = lowerPrompt.includes('hiring') || lowerPrompt.includes('remote sales') || lowerPrompt.includes('reps') || lowerPrompt.includes('hiring sales');
  
  // Extract Target Roles
  let targetRole = 'Sales Leadership / Founders';
  if (lowerPrompt.includes('sales') || lowerPrompt.includes('account executive') || lowerPrompt.includes('sdr') || lowerPrompt.includes('business development')) {
    targetRole = 'Head of Sales / VP Sales / CRO';
  } else if (lowerPrompt.includes('ceo') || lowerPrompt.includes('founder')) {
    targetRole = 'CEO / Co-Founder';
  }

  // Extract Tech Stack keywords
  const keywords = [];
  const techKeywords = ['react', 'next.js', 'node.js', 'python', 'aws', 'gcp', 'kubernetes', 'graphql', 'fastapi', 'stripe', 'ai'];
  techKeywords.forEach(tech => {
    if (lowerPrompt.includes(tech)) {
      keywords.push(tech);
    }
  });

  return {
    originalPrompt: prompt,
    industry,
    fundingStage,
    location,
    hiring,
    targetRole,
    keywords,
    parsedAt: new Date().toISOString()
  };
}

module.exports = {
  parseNaturalLanguageIntent
};
