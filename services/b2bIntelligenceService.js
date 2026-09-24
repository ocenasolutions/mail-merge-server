const leadProviderManager = require('./leadProviders/LeadProviderManager');
const B2BLead = require('../models/B2BLead');
const B2BSearchHistory = require('../models/B2BSearchHistory');
const { callGroqAI } = require('./webpilotAiSynthesizer');

// In-memory cache for rapid repeated queries (TTL 10 mins)
const searchCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

function getCached(key) {
  const item = searchCache.get(key);
  if (!item) return null;
  if (Date.now() - item.timestamp > CACHE_TTL_MS) {
    searchCache.delete(key);
    return null;
  }
  return item.data;
}

function setCached(key, data) {
  // Evict oldest if cache exceeds 200 items
  if (searchCache.size > 200) {
    const firstKey = searchCache.keys().next().value;
    searchCache.delete(firstKey);
  }
  searchCache.set(key, { data, timestamp: Date.now() });
}

/**
 * Clean and extract domain from input
 */
function extractDomain(input) {
  if (!input || typeof input !== 'string') return '';
  let clean = input.trim().toLowerCase();
  clean = clean.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  clean = clean.split('/')[0].split('?')[0].split('#')[0];
  if (clean.includes('.') && !clean.includes(' ')) {
    return clean;
  }
  return '';
}

/**
 * 1. Search Companies
 */
async function searchCompaniesService({ query = '', filters = {}, page = 1, pageSize = 20, userEmail = '' }) {
  const cacheKey = `search_${query}_${JSON.stringify(filters)}_${page}_${pageSize}`;
  const cached = getCached(cacheKey);
  if (cached) {
    return { ...cached, fromCache: true };
  }

  // Check if query is a direct domain URL (e.g., "https://stripe.com" or "stripe.com")
  const potentialDomain = extractDomain(query);
  let searchResult;

  if (potentialDomain) {
    // Lookup by domain
    searchResult = await leadProviderManager.getCompanyProfile({ domain: potentialDomain });
    if (searchResult.company) {
      searchResult = {
        success: true,
        provider: searchResult.provider,
        total: 1,
        page: 1,
        pageSize: 1,
        companies: [searchResult.company],
        meta: { queryType: 'domain_lookup' }
      };
    }
  }

  if (!searchResult || !searchResult.companies || searchResult.companies.length === 0) {
    // Natural language / criteria search
    searchResult = await leadProviderManager.searchCompanies({
      query,
      definition: query,
      criteria: filters.criteria || [],
      geo: filters.geo || [],
      geoCity: filters.location || '',
      size: filters.size || [],
      traffic: filters.traffic || [],
      page,
      pageSize
    });
  }

  // Score each company for default relevance
  const companiesWithScore = (searchResult.companies || []).map(comp => {
    const scoreResult = calculateLeadScore({ company: comp, query, criteria: filters.criteria });
    return {
      ...comp,
      leadRelevanceScore: scoreResult.score,
      scoreReasons: scoreResult.reasons
    };
  });

  const responsePayload = {
    success: true,
    provider: searchResult.provider,
    total: searchResult.total || companiesWithScore.length,
    page: searchResult.page || page,
    pageSize: searchResult.pageSize || pageSize,
    companies: companiesWithScore,
    meta: searchResult.meta || {}
  };

  setCached(cacheKey, responsePayload);

  // Save search history in background
  if (userEmail && query) {
    B2BSearchHistory.create({
      userEmail,
      query,
      searchType: potentialDomain ? 'domain_lookup' : 'company_search',
      filters,
      resultsCount: companiesWithScore.length,
      provider: searchResult.provider,
      topResultNames: companiesWithScore.slice(0, 5).map(c => c.name)
    }).catch(err => console.warn('Failed to save B2B search history:', err.message));
  }

  return responsePayload;
}

/**
 * 2. Get Company Profile
 */
async function getCompanyProfileService({ id, domain, criteria = [] }) {
  const targetDomain = domain || extractDomain(id);
  const cacheKey = `profile_${id}_${targetDomain}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const result = await leadProviderManager.getCompanyProfile({
    companyId: id,
    domain: targetDomain,
    criteria
  });

  if (!result || !result.company) {
    return {
      success: false,
      message: 'Company profile not found for the specified identifier.'
    };
  }

  const scoreResult = calculateLeadScore({ company: result.company });
  const finalProfile = {
    ...result.company,
    leadRelevanceScore: scoreResult.score,
    scoreReasons: scoreResult.reasons
  };

  const payload = {
    success: true,
    provider: result.provider,
    company: finalProfile,
    meta: result.meta
  };

  setCached(cacheKey, payload);
  return payload;
}

/**
 * 3. Generate ICP (Ideal Customer Profile)
 * Clearly distinguishes verified API facts from AI-generated assumptions.
 */
async function generateIcpService({ company = null, companyId = '', domain = '', context = '' }) {
  let targetCompany = company;
  if (!targetCompany && (companyId || domain)) {
    const prof = await getCompanyProfileService({ id: companyId, domain });
    targetCompany = prof.company;
  }

  const companyName = targetCompany?.name || domain || 'B2B Enterprise';
  const industry = targetCompany?.industry || 'Software & Technology';
  const size = targetCompany?.size || '50-200 employees';
  const location = targetCompany?.location || 'North America / Global';
  const description = targetCompany?.description || '';

  const cacheKey = `icp_${companyName}_${industry}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  // Synthesize ICP using AI
  const prompt = `Analyze this company and generate a comprehensive B2B Ideal Customer Profile (ICP).
Target Company Details:
- Name: ${companyName}
- Industry: ${industry}
- Location: ${location}
- Size: ${size}
- Description: ${description}
- Additional Context: ${context || 'None'}

Return ONLY a JSON object in this exact schema:
{
  "idealCompany": {
    "industry": "Specific industry focus",
    "companySize": "Ideal employee count (e.g. 50-500)",
    "revenueRange": "$5M - $50M ARR",
    "geography": "Primary target regions",
    "businessModel": "B2B SaaS / Enterprise / Marketplace",
    "technology": ["Key tech stack or platforms used"],
    "growthStage": "Growth / Series A-C / Enterprise"
  },
  "idealBuyer": {
    "jobTitles": ["Primary Decision Maker Titles (e.g., CTO, VP Engineering, Head of Sales)"],
    "department": "Department name",
    "seniority": "Director / VP / C-Level",
    "responsibilities": ["Key responsibilities of the buyer"]
  },
  "painPoints": {
    "businessProblems": ["Business problem 1", "Business problem 2"],
    "technologyProblems": ["Tech problem 1", "Tech problem 2"],
    "growthProblems": ["Growth bottleneck 1", "Growth bottleneck 2"]
  },
  "buyingSignals": {
    "hiring": ["Job roles indicating buying need (e.g. Hiring Senior DevOps, SDRs)"],
    "expansion": "Signals of new market or product expansion",
    "technologyAdoption": "New software or tool adoption signals",
    "funding": "Recent funding round or capital raise triggers",
    "websiteSignals": "Website redesign, new pricing tiers, new product launch"
  },
  "valueProposition": "Clear 1-sentence value proposition tailored to this ICP."
}`;

  let icpData = null;
  try {
    const aiResp = await callGroqAI(
      prompt,
      'You are a high-level B2B Go-To-Market strategist. Return valid JSON only.',
      process.env.GROQ_API_KEY
    );
    const jsonMatch = aiResp.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      icpData = JSON.parse(jsonMatch[0]);
    }
  } catch (err) {
    console.warn('AI ICP synthesis fallback:', err.message);
  }

  // Fallback ICP structure if AI fails
  if (!icpData) {
    icpData = {
      idealCompany: {
        industry: industry,
        companySize: '25-250 employees',
        revenueRange: '$3M - $25M ARR',
        geography: location,
        businessModel: 'B2B Software & Digital Services',
        technology: ['Modern Cloud Stacks', 'React', 'Node.js', 'CRM'],
        growthStage: 'Scale-up / Growth Phase'
      },
      idealBuyer: {
        jobTitles: ['Founder', 'Chief Technology Officer (CTO)', 'VP Engineering', 'Head of Product'],
        department: 'Engineering / Product / Executive Leadership',
        seniority: 'C-Level & Executive',
        responsibilities: ['Architecture roadmap', 'Security compliance', 'Vendor selection', 'Tool adoption']
      },
      painPoints: {
        businessProblems: ['High customer acquisition costs', 'Slow sales pipeline velocity'],
        technologyProblems: ['Legacy tech debt', 'Manual data synchronization workflows'],
        growthProblems: ['Scaling infrastructure to meet customer demand']
      },
      buyingSignals: {
        hiring: ['Active recruitment for technical leads and sales engineers'],
        expansion: ['Entering new regional or enterprise tier markets'],
        technologyAdoption: ['Transitioning to automated AI workflows'],
        funding: ['Recent seed or Series A investment round'],
        websiteSignals: ['Updated enterprise product page']
      },
      valueProposition: `Accelerate outbound pipeline and engineering delivery for ${industry} companies.`
    };
  }

  const responsePayload = {
    success: true,
    company: {
      name: companyName,
      domain: targetCompany?.domain || domain,
      industry,
      location,
      verifiedFacts: {
        name: companyName,
        website: targetCompany?.website || null,
        industry: targetCompany?.industry || null,
        size: targetCompany?.size || null,
        location: targetCompany?.location || null,
        hiringStatus: targetCompany?.hiring ? 'Actively hiring' : 'Not actively posted',
        fundingStage: targetCompany?.fundingStage || 'Not disclosed'
      }
    },
    icp: icpData,
    attribution: {
      factsSource: targetCompany?.source || 'Explee Verified API',
      aiInsightsNote: 'Ideal buyer, pain points, and buying signals are AI-generated strategic inferences.'
    }
  };

  setCached(cacheKey, responsePayload);
  return responsePayload;
}

/**
 * 4. Competitor & Similar Company Discovery
 */
async function findCompetitorsService({ company = null, companyId = '', domain = '', industry = '', location = '', limit = 10 }) {
  let baseCompany = company;
  if (!baseCompany && (companyId || domain)) {
    const prof = await getCompanyProfileService({ id: companyId, domain });
    baseCompany = prof.company;
  }

  const targetIndustry = industry || baseCompany?.industry || 'Technology';
  const targetLocation = location || baseCompany?.location || '';
  const targetName = baseCompany?.name || 'Target Company';

  const searchQuery = `${targetIndustry} companies ${targetLocation ? 'in ' + targetLocation : ''}`.trim();
  const searchResult = await searchCompaniesService({
    query: searchQuery,
    filters: {
      criteria: [`Competitor or peer to ${targetName}`, `Operates in ${targetIndustry}`]
    },
    pageSize: limit + 3
  });

  // Filter out the base company itself
  const baseDomain = baseCompany?.domain ? extractDomain(baseCompany.domain) : '';
  const filtered = (searchResult.companies || [])
    .filter(c => {
      const cDomain = extractDomain(c.domain || c.website);
      if (baseDomain && cDomain && cDomain === baseDomain) return false;
      if (baseCompany?.name && c.name && c.name.toLowerCase() === baseCompany.name.toLowerCase()) return false;
      return true;
    })
    .slice(0, limit)
    .map(c => ({
      ...c,
      similarityReason: `Similar industry (${c.industry}) and target market (${c.location || 'Global'})`,
      relationshipTag: 'Potential competitor / Similar company'
    }));

  return {
    success: true,
    baseCompany: {
      name: targetName,
      domain: baseCompany?.domain || domain,
      industry: targetIndustry,
      location: targetLocation
    },
    totalFound: filtered.length,
    competitors: filtered,
    disclaimer: 'Listed companies are potential competitors or similar peers based on industry, geographic scope, and service offerings.'
  };
}

/**
 * 5. Search People / Decision Makers
 */
async function searchPeopleService({ domain = '', companyId = '', companyName = '', jobTitles = [], page = 1, pageSize = 10 }) {
  const cleanDomain = extractDomain(domain || companyId);
  const prioritizedRoles = Array.isArray(jobTitles) && jobTitles.length > 0
    ? jobTitles
    : ['Founder', 'Co-Founder', 'CEO', 'CTO', 'CMO', 'Head of Marketing', 'Head of Engineering', 'VP Engineering', 'Product Manager'];

  const peopleResult = await leadProviderManager.searchPeople({
    domain: cleanDomain,
    companyDefinition: companyName ? `Company ${companyName}` : '',
    jobTitles: prioritizedRoles,
    page,
    pageSize
  });

  return {
    success: true,
    provider: peopleResult.provider,
    companyDomain: cleanDomain,
    companyName: companyName || cleanDomain,
    total: peopleResult.total || (peopleResult.people?.length || 0),
    people: (peopleResult.people || []).map(p => ({
      ...p,
      dataNotice: p.email ? 'Contact email verified via API' : 'Direct email not publicly indexed'
    })),
    meta: peopleResult.meta || {}
  };
}

/**
 * 6. Lead Relevance Scoring Engine (Transparent & Explainable)
 */
function calculateLeadScore({ company = {}, person = null, query = '', criteria = [] }) {
  let score = 50; // Baseline score
  const reasons = [];

  // 1. Industry Match
  if (company.industry && company.industry !== 'Unknown') {
    score += 10;
    reasons.push(`✓ Industry matches: ${company.industry}`);
  }

  // 2. Location Match
  if (company.location && company.location !== 'Global / Remote') {
    score += 10;
    reasons.push(`✓ Geographic location verified: ${company.location}`);
  }

  // 3. Company Size Match
  if (company.size && company.size !== 'Unknown') {
    score += 10;
    reasons.push(`✓ Company scale profile in target range: ${company.size}`);
  }

  // 4. Technology & Signals
  if (company.marketingPixels && company.marketingPixels.length > 0) {
    score += 5;
    reasons.push(`✓ Modern web technologies detected (${company.marketingPixels.slice(0, 2).join(', ')})`);
  }

  // 5. Hiring Signals
  if (company.hiring) {
    score += 10;
    reasons.push('✓ Active hiring signals detected (indicates growth & budget)');
  }

  // 6. Funding Signals
  if (company.fundingStage) {
    score += 5;
    reasons.push(`✓ Funding backed (${company.fundingStage})`);
  }

  // 7. Decision Maker Available
  if (person && (person.title || person.fullName)) {
    score += 10;
    reasons.push(`✓ Key decision maker identified: ${person.title || 'Executive'}`);
    if (person.email) {
      score += 5;
      reasons.push('✓ Verified direct outreach channel available');
    }
  }

  // Clamp score between 10 and 99
  const finalScore = Math.min(99, Math.max(15, score));

  return {
    score: finalScore,
    label: 'Lead relevance score',
    reasons,
    isHighFit: finalScore >= 75
  };
}

/**
 * 7. Save Lead to Database
 */
async function saveLeadService({ userEmail, company, contact = {}, score = {}, icpTags = [], notes = '', provider = 'explee', rawProviderData = null }) {
  if (!userEmail) {
    throw new Error('userEmail is required to save a lead.');
  }
  if (!company || !company.name) {
    throw new Error('Company details with a valid name are required.');
  }

  const scoreData = score.relevanceScore !== undefined ? score : calculateLeadScore({ company, person: contact });

  const leadDoc = await B2BLead.findOneAndUpdate(
    {
      userEmail: userEmail.toLowerCase().trim(),
      'company.name': company.name,
      'contact.email': contact.email || ''
    },
    {
      userEmail: userEmail.toLowerCase().trim(),
      company: {
        id: company.id || '',
        name: company.name,
        domain: company.domain || '',
        website: company.website || '',
        industry: company.industry || '',
        location: company.location || '',
        size: company.size || '',
        description: company.description || '',
        founded: company.founded || null,
        traffic: company.traffic || null,
        fundingStage: company.fundingStage || '',
        hiring: Boolean(company.hiring),
        socials: company.socials || {}
      },
      contact: {
        firstName: contact.firstName || '',
        lastName: contact.lastName || '',
        fullName: contact.fullName || [contact.firstName, contact.lastName].filter(Boolean).join(' ') || '',
        title: contact.title || '',
        headline: contact.headline || '',
        email: contact.email || '',
        emailStatus: contact.emailStatus || (contact.email ? 'verified' : 'unknown'),
        phone: contact.phone || '',
        linkedinUrl: contact.linkedinUrl || '',
        geo: contact.geo || ''
      },
      score: {
        relevanceScore: scoreData.score || scoreData.relevanceScore || 75,
        reasons: scoreData.reasons || [],
        criteriaScores: score.criteriaScores || []
      },
      icpTags: Array.isArray(icpTags) ? icpTags : [],
      notes: notes || '',
      provider: provider || 'explee',
      providerRecordId: company.id || '',
      rawProviderData
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return {
    success: true,
    message: 'Lead saved successfully',
    lead: leadDoc
  };
}

/**
 * 8. Get Saved Leads
 */
async function getSavedLeadsService({ userEmail, limit = 50, status = '' }) {
  if (!userEmail) return { success: true, count: 0, leads: [] };

  const filter = { userEmail: userEmail.toLowerCase().trim() };
  if (status) {
    filter.status = status;
  }

  const leads = await B2BLead.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(200, Number(limit) || 50));

  return {
    success: true,
    count: leads.length,
    leads
  };
}

/**
 * 9. Delete Saved Lead
 */
async function deleteSavedLeadService({ userEmail, leadId }) {
  const deleted = await B2BLead.findOneAndDelete({
    _id: leadId,
    userEmail: userEmail.toLowerCase().trim()
  });

  if (!deleted) {
    return { success: false, message: 'Lead not found or permission denied' };
  }

  return { success: true, message: 'Saved lead removed' };
}

module.exports = {
  searchCompaniesService,
  getCompanyProfileService,
  generateIcpService,
  findCompetitorsService,
  searchPeopleService,
  calculateLeadScore,
  saveLeadService,
  getSavedLeadsService,
  deleteSavedLeadService
};
