const { callGroqAI, callGeminiAI, callOpenAI } = require('./webpilotAiSynthesizer');

/**
 * Transparent Weighted Competitor Scoring Engine
 */
function scoreCompetitorHeuristic(candidate, targetCompany, radiusKm = 25) {
  let locationScore = 0;
  let industryScore = 0;
  let serviceScore = 0;
  let targetMarketScore = 0;
  let techScore = 0;
  const reasons = [];

  const distanceKm = candidate.distanceKm;
  const targetIndustry = (targetCompany.industry || 'Software Development').toLowerCase();
  const candidateCategory = (candidate.category || '').toLowerCase();
  const candidateName = (candidate.name || '').toLowerCase();
  const targetServices = (targetCompany.services || ['Web Development', 'Mobile App Development', 'UI/UX']).map(s => s.toLowerCase());

  // 1. Location Similarity (20%)
  if (distanceKm != null) {
    if (distanceKm <= 10) {
      locationScore = 100;
      reasons.push(`Located within ${distanceKm} km (close local proximity)`);
    } else if (distanceKm <= radiusKm) {
      locationScore = Math.max(40, Math.round(100 - (distanceKm / radiusKm) * 60));
      reasons.push(`Located within ${distanceKm} km of target company`);
    } else {
      locationScore = 20;
    }
  } else {
    locationScore = 50;
  }

  // 2. Industry Similarity (25%)
  const isDirectTech = candidate.candidateType === 'competitor' ||
                       /software|it|web|mobile|tech|app|digital|saas|agency/i.test(candidateCategory) ||
                       /infotech|technologies|solutions|software|systems|labs/i.test(candidateName);

  if (isDirectTech) {
    industryScore = 95;
    reasons.push(`Operates in the same ${targetCompany.industry || 'Software & IT Solutions'} industry`);
  } else {
    industryScore = 25;
  }

  // 3. Service Overlap (30%)
  let matchedServicesCount = 0;
  const candidateServices = candidate.services || [];
  const candidateText = `${candidateCategory} ${candidateName} ${candidateServices.join(' ')}`.toLowerCase();

  targetServices.forEach(srv => {
    if (candidateText.includes(srv) || srv.split(' ').some(w => w.length > 3 && candidateText.includes(w))) {
      matchedServicesCount++;
    }
  });

  if (matchedServicesCount >= 2) {
    serviceScore = 95;
    reasons.push(`Multiple overlapping services (${targetCompany.services.slice(0, 3).join(', ')})`);
  } else if (matchedServicesCount === 1) {
    serviceScore = 70;
    reasons.push('Overlapping core digital services');
  } else if (isDirectTech) {
    serviceScore = 60;
    reasons.push('Similar technical service offerings');
  } else {
    serviceScore = 15;
  }

  // 4. Target Market Similarity (15%)
  if (isDirectTech) {
    targetMarketScore = 85;
    reasons.push('Serves similar B2B and enterprise client markets');
  } else {
    targetMarketScore = 30;
  }

  // 5. Tech & Scale Similarity (10%)
  if (isDirectTech) {
    techScore = 80;
  } else {
    techScore = 20;
  }

  // Calculate Weighted Score
  // Weights: Location (20%), Industry (25%), Services (30%), Target Market (15%), Tech (10%)
  const totalScore = Math.round(
    (locationScore * 0.20) +
    (industryScore * 0.25) +
    (serviceScore * 0.30) +
    (targetMarketScore * 0.15) +
    (techScore * 0.10)
  );

  let classification = 'low';
  if (totalScore >= 75) {
    classification = 'high';
  } else if (totalScore >= 50) {
    classification = 'medium';
  }

  return {
    competitorScore: totalScore,
    classification,
    isPotentialCompetitor: totalScore >= 45,
    reasons: Array.from(new Set(reasons))
  };
}

/**
 * Transparent Weighted ICP Scoring Engine
 */
function scoreICPHeuristic(candidate, targetCompany, radiusKm = 25) {
  let industryFitScore = 0;
  let locationFitScore = 0;
  let serviceNeedScore = 0;
  let businessTypeScore = 0;
  const reasons = [];

  const distanceKm = candidate.distanceKm;
  const candidateCategory = (candidate.category || '').toLowerCase();
  const candidateName = (candidate.name || '').toLowerCase();
  const candidateText = `${candidateCategory} ${candidateName}`.toLowerCase();

  // Target company services (e.g. custom software, web dev, mobile app, UI/UX)
  const isSoftwareProvider = true; // Target provides software/tech solutions

  // 1. Location Fit (20%)
  if (distanceKm != null) {
    if (distanceKm <= radiusKm) {
      locationFitScore = 95;
      reasons.push(`Located within target geographic market (${distanceKm} km)`);
    } else {
      locationFitScore = 40;
    }
  } else {
    locationFitScore = 70;
  }

  // 2. Industry Fit & Business Type (30% + 20%)
  const isSoftwareCompetitor = /\b(software|it|web|mobile|tech|app|digital|saas|agency)\b/i.test(candidateCategory) ||
                               /\b(infotech|technologies|solutions|software|systems)\b/i.test(candidateName);

  if (isSoftwareCompetitor) {
    // Other software companies are usually competitors, not primary target buyers (unless sub-contracting)
    industryFitScore = 20;
    businessTypeScore = 25;
  } else if (/hospital|health|clinic|doctor|pharma|medical/i.test(candidateText)) {
    industryFitScore = 90;
    businessTypeScore = 85;
    serviceNeedScore = 90;
    reasons.push('Healthcare industry with high demand for custom software, patient portals & digitised systems');
  } else if (/real estate|builder|property|developer|infrastructure|construction/i.test(candidateText)) {
    industryFitScore = 88;
    businessTypeScore = 80;
    serviceNeedScore = 85;
    reasons.push('Real estate enterprise requiring custom Web/Mobile CRM and project management platforms');
  } else if (/retail|store|milk|dairy|fmcg|e-commerce|shop|manufacturing|factory|logistics|transport/i.test(candidateText)) {
    industryFitScore = 92;
    businessTypeScore = 90;
    serviceNeedScore = 90;
    reasons.push('FMCG & Logistics enterprise needing ERP, E-Commerce, mobile ordering & workflow automation');
  } else if (/bank|finance|capital|investment|credit|school|college|university|education|hotel|resort/i.test(candidateText)) {
    industryFitScore = 85;
    businessTypeScore = 85;
    serviceNeedScore = 85;
    reasons.push('Established service enterprise requiring web development, mobile apps and cloud modernization');
  } else {
    // General local business
    industryFitScore = 65;
    businessTypeScore = 60;
    serviceNeedScore = 65;
    reasons.push('Local business type commonly requiring custom software and web development');
  }

  // Calculate Weighted Score
  // Weights: Industry Fit (30%), Location (20%), Service Need (30%), Business Type (20%)
  const totalScore = Math.round(
    (industryFitScore * 0.30) +
    (locationFitScore * 0.20) +
    (serviceNeedScore * 0.30) +
    (businessTypeScore * 0.20)
  );

  let classification = 'low';
  if (totalScore >= 75) {
    classification = 'high';
  } else if (totalScore >= 50) {
    classification = 'medium';
  }

  return {
    icpScore: totalScore,
    classification,
    isPotentialICP: !isSoftwareCompetitor && totalScore >= 50,
    reasons: Array.from(new Set(reasons))
  };
}

/**
 * Step 9: LLM Classification & Pipeline Refinement
 * Passes deduplicated candidates to LLM for refined scoring and reasoning
 */
async function classifyCandidatesWithLLM(candidates, targetCompany, radiusKm = 25) {
  const groqKey = process.env.GROQ_API_KEY || process.env.LLM_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!groqKey && !geminiKey && !openaiKey) {
    // Return heuristic classification
    return candidates.map(c => {
      const compScore = scoreCompetitorHeuristic(c, targetCompany, radiusKm);
      const icpScore = scoreICPHeuristic(c, targetCompany, radiusKm);
      return {
        ...c,
        competitorScore: compScore.competitorScore,
        competitorClassification: compScore.classification,
        isPotentialCompetitor: compScore.isPotentialCompetitor,
        competitorReasons: compScore.reasons,
        icpScore: icpScore.icpScore,
        icpClassification: icpScore.classification,
        isPotentialICP: icpScore.isPotentialICP,
        icpReasons: icpScore.reasons
      };
    });
  }

  // Prepare lightweight batch for LLM (max 15 candidates)
  const candidateBatch = candidates.slice(0, 15).map((c, idx) => ({
    id: c.providerId || `cand-${idx}`,
    name: c.name,
    category: c.category || 'General Business',
    distanceKm: c.distanceKm,
    address: c.address
  }));

  const systemPrompt = `You are a B2B Market Intelligence AI Analyst. Evaluate candidate businesses against the Target Company:
Target Company: ${targetCompany.name}
Industry: ${targetCompany.industry || 'Software Development'}
Services: ${(targetCompany.services || []).join(', ')}
Location: ${targetCompany.location || 'India'}

Return a strict JSON array of objects for each candidate ID:
[
  {
    "id": "candidate_id",
    "isPotentialCompetitor": true/false,
    "competitorScore": 0-100,
    "competitorClassification": "high"/"medium"/"low",
    "competitorReasons": ["reason 1", "reason 2"],
    "isPotentialICP": true/false,
    "icpScore": 0-100,
    "icpClassification": "high"/"medium"/"low",
    "icpReasons": ["reason 1", "reason 2"]
  }
]
Rules:
- DO NOT invent missing facts.
- A competitor provides similar services to similar clients.
- An ICP is a non-tech business (e.g. Healthcare, Real Estate, E-Commerce, Logistics, FMCG) that needs custom software/web/mobile development.
- Return valid JSON array only.`;

  const userPrompt = `Candidates: ${JSON.stringify(candidateBatch, null, 2)}`;

  try {
    let rawText = '';
    if (groqKey) {
      const res = await callGroqAI(userPrompt, systemPrompt, groqKey, 'qwen/qwen3.8-27b');
      rawText = res.text;
    } else if (geminiKey) {
      rawText = await callGeminiAI(userPrompt, systemPrompt, geminiKey);
    } else if (openaiKey) {
      rawText = await callOpenAI(userPrompt, systemPrompt, openaiKey);
    }

    const jsonMatch = rawText.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (jsonMatch) {
      const llmResults = JSON.parse(jsonMatch[0]);
      const resultMap = new Map(llmResults.map(item => [item.id, item]));

      return candidates.map(c => {
        const id = c.providerId;
        const llmItem = resultMap.get(id);
        const compHeuristic = scoreCompetitorHeuristic(c, targetCompany, radiusKm);
        const icpHeuristic = scoreICPHeuristic(c, targetCompany, radiusKm);

        if (llmItem && typeof llmItem.competitorScore === 'number') {
          return {
            ...c,
            competitorScore: llmItem.competitorScore,
            competitorClassification: llmItem.competitorClassification || compHeuristic.classification,
            isPotentialCompetitor: !!llmItem.isPotentialCompetitor,
            competitorReasons: (llmItem.competitorReasons && llmItem.competitorReasons.length > 0) ? llmItem.competitorReasons : compHeuristic.reasons,
            icpScore: llmItem.icpScore,
            icpClassification: llmItem.icpClassification || icpHeuristic.classification,
            isPotentialICP: !!llmItem.isPotentialICP,
            icpReasons: (llmItem.icpReasons && llmItem.icpReasons.length > 0) ? llmItem.icpReasons : icpHeuristic.reasons
          };
        }

        return {
          ...c,
          competitorScore: compHeuristic.competitorScore,
          competitorClassification: compHeuristic.classification,
          isPotentialCompetitor: compHeuristic.isPotentialCompetitor,
          competitorReasons: compHeuristic.reasons,
          icpScore: icpHeuristic.icpScore,
          icpClassification: icpHeuristic.classification,
          isPotentialICP: icpHeuristic.isPotentialICP,
          icpReasons: icpHeuristic.reasons
        };
      });
    }
  } catch (err) {
    console.warn('[Company Scoring] LLM Batch Notice (using heuristic fallback):', err.message);
  }

  // Fallback to transparent heuristic scoring
  return candidates.map(c => {
    const compScore = scoreCompetitorHeuristic(c, targetCompany, radiusKm);
    const icpScore = scoreICPHeuristic(c, targetCompany, radiusKm);
    return {
      ...c,
      competitorScore: compScore.competitorScore,
      competitorClassification: compScore.classification,
      isPotentialCompetitor: compScore.isPotentialCompetitor,
      competitorReasons: compScore.reasons,
      icpScore: icpScore.icpScore,
      icpClassification: icpScore.classification,
      isPotentialICP: icpScore.isPotentialICP,
      icpReasons: icpScore.reasons
    };
  });
}

module.exports = {
  scoreCompetitorHeuristic,
  scoreICPHeuristic,
  classifyCandidatesWithLLM
};
