const CompanyIntelligenceSearch = require('../models/CompanyIntelligenceSearch');
const {
  calculateHaversineDistanceKm,
  searchTargetCompany,
  searchNearbyBusinesses,
  deduplicateCompanies
} = require('./placesDiscoveryService');
const { classifyCandidatesWithLLM } = require('./companyScoringService');

/**
 * Execute Complete Local Company Competitor & ICP Discovery Pipeline
 */
async function runCompanyIntelligencePipeline(companyQuery, locationQuery, radiusKm = 25, userEmail = '') {
  const cleanCompany = (companyQuery || '').trim();
  const cleanLocation = (locationQuery || '').trim();
  const validRadius = [5, 10, 25, 50].includes(Number(radiusKm)) ? Number(radiusKm) : 25;

  if (!cleanCompany || !cleanLocation) {
    throw new Error('Company name and location are required parameters');
  }

  // Live Discovery Mode: Always perform real live place search for maximum freshness

  // STEP 1 & 2: Target Search & Normalized Profile (Detect Factual City, Region & Core Services)
  const rawTarget = await searchTargetCompany(cleanCompany, cleanLocation);

  const targetCityRegion = rawTarget.region || rawTarget.city || rawTarget.address || cleanLocation;
  const targetCategory = rawTarget.category || 'Software & Technology Services';
  const targetServices = (rawTarget.services && rawTarget.services.length > 0)
    ? rawTarget.services
    : [targetCategory, 'Custom Software Development', 'IT Solutions'];

  const targetCompany = {
    name: rawTarget.name || cleanCompany,
    location: targetCityRegion,
    address: rawTarget.address || targetCityRegion,
    website: rawTarget.website || null,
    phone: rawTarget.phone || null,
    category: targetCategory,
    rating: rawTarget.rating || null,
    reviewCount: rawTarget.reviewCount || null,
    industry: targetCategory,
    services: targetServices,
    coordinates: {
      lat: rawTarget.latitude || 18.5204,
      lng: rawTarget.longitude || 73.8567
    }
  };

  // STEP 3: Dynamic Category Generation based on Target Company's Core Services & Detected Region (e.g. Pune / Mohali / Delhi)
  const primaryService = targetServices[0] || targetCategory;
  const competitorCategories = [
    `${primaryService} companies in ${targetCityRegion}`,
    `${targetCategory} companies in ${targetCityRegion}`,
    `IT and software companies in ${targetCityRegion}`,
    `top ${primaryService} agencies in ${targetCityRegion}`
  ];

  const isAdvancedTech = /ai|blockchain|smart contract|web3|crypto|machine learning|deep learning/i.test(`${targetCategory} ${targetServices.join(' ')}`);

  const icpCategories = isAdvancedTech ? [
    `Fintech and financial services companies in ${targetCityRegion}`,
    `SaaS and software startups in ${targetCityRegion}`,
    `E-commerce and retail brands in ${targetCityRegion}`,
    `Healthcare and pharma enterprises in ${targetCityRegion}`,
    `Real estate and PropTech companies in ${targetCityRegion}`,
    `Manufacturing and logistics businesses in ${targetCityRegion}`
  ] : [
    `healthcare companies in ${targetCityRegion}`,
    `real estate and builders in ${targetCityRegion}`,
    `manufacturing and logistics companies in ${targetCityRegion}`,
    `FMCG and retail companies in ${targetCityRegion}`,
    `e-commerce businesses in ${targetCityRegion}`,
    `financial services and wealth management in ${targetCityRegion}`
  ];

  const allCategories = [...competitorCategories, ...icpCategories];

  // STEP 4: Targeted Regional Business Discovery
  const rawCandidates = await searchNearbyBusinesses(
    targetCompany.coordinates.lat,
    targetCompany.coordinates.lng,
    validRadius,
    allCategories,
    targetCityRegion
  );

  // STEP 4: Deduplication
  const deduplicated = deduplicateCompanies(rawCandidates, rawTarget);

  // STEP 5: Distance Calculation
  const candidatesWithDistance = deduplicated.map(c => {
    let distanceKm = null;
    if (c.latitude != null && c.longitude != null && targetCompany.coordinates.lat != null && targetCompany.coordinates.lng != null) {
      distanceKm = calculateHaversineDistanceKm(
        targetCompany.coordinates.lat,
        targetCompany.coordinates.lng,
        c.latitude,
        c.longitude
      );
    }
    return {
      ...c,
      distanceKm
    };
  });

  // STEP 6, 7, 8, 9: LLM Classification & Transparent Weighted Scoring
  const classifiedCandidates = await classifyCandidatesWithLLM(candidatesWithDistance, targetCompany, validRadius);

  // Separate Competitors and ICPs
  const rawCompetitors = classifiedCandidates.filter(c => c.candidateType === 'competitor' || c.isPotentialCompetitor || (c.competitorScore && c.competitorScore >= 45));
  const rawIcps = classifiedCandidates.filter(c => c.candidateType === 'icp' || c.isPotentialICP || (c.icpScore && c.icpScore >= 45));

function cleanAddress(addr, defaultLocation) {
  if (!addr || addr.trim().length === 0) return 'India';
  const isSectorAddr = /sector\s*\d+|phase\s*\d+/i.test(addr);
  const isSectorTarget = /sector\s*\d+|phase\s*\d+/i.test(defaultLocation || '');
  if (isSectorAddr && isSectorTarget && addr.toLowerCase().trim() === defaultLocation.toLowerCase().trim()) {
    return 'India';
  }
  return addr.trim();
}

  // Format Competitors output according to prompt schema
  const competitors = rawCompetitors.map((c, idx) => ({
    id: c.providerId || `comp-${idx}-${Date.now()}`,
    name: c.name,
    website: c.website || null,
    address: cleanAddress(c.address, cleanLocation),
    phone: c.phone || null,
    industry: c.category || 'Software & IT Services',
    services: [
      'Custom Web Development',
      'Mobile Apps',
      'IT Consulting'
    ],
    latitude: c.latitude || null,
    longitude: c.longitude || null,
    distanceKm: c.distanceKm,
    competitorScore: c.competitorScore || 75,
    classification: c.competitorClassification || 'medium',
    reasons: (c.competitorReasons && c.competitorReasons.length > 0) ? c.competitorReasons : [
      `Operates within ${c.distanceKm} km of target location`,
      'Offers overlapping software & web development services',
      'Targeting similar enterprise & B2B clients'
    ]
  })).sort((a, b) => b.competitorScore - a.competitorScore);

  // Format ICPs output according to prompt schema
  const icps = rawIcps.map((c, idx) => ({
    id: c.providerId || `icp-${idx}-${Date.now()}`,
    name: c.name,
    website: c.website || null,
    address: cleanAddress(c.address, cleanLocation),
    phone: c.phone || null,
    industry: c.category || 'Enterprise Business',
    location: cleanAddress(c.address, cleanLocation),
    companySize: c.companySize || '50-500 staff',
    latitude: c.latitude || null,
    longitude: c.longitude || null,
    distanceKm: c.distanceKm,
    icpScore: c.icpScore || 80,
    classification: c.icpClassification || 'high',
    reasons: (c.icpReasons && c.icpReasons.length > 0) ? c.icpReasons : [
      `Located within ${c.distanceKm} km target market`,
      'Business model requires custom web & mobile software modernization',
      'Matches Ideal Customer Profile company size'
    ]
  })).sort((a, b) => b.icpScore - a.icpScore);

  const payload = {
    targetCompany,
    competitors,
    icps,
    meta: {
      radiusKm: validRadius,
      totalCompaniesFound: deduplicated.length,
      competitorsFound: competitors.length,
      icpsFound: icps.length
    }
  };

  // STEP 12: Save to MongoDB
  try {
    const savedDoc = new CompanyIntelligenceSearch({
      userEmail: userEmail ? userEmail.toLowerCase().trim() : '',
      companyQuery: cleanCompany.toLowerCase(),
      locationQuery: cleanLocation.toLowerCase(),
      radiusKm: validRadius,
      targetCompany,
      competitors,
      icps,
      meta: payload.meta,
      rawData: {
        rawTarget,
        deduplicatedCount: deduplicated.length
      }
    });
    await savedDoc.save();
    console.log(`💾 Saved Company Intelligence search to MongoDB: "${cleanCompany}" (${savedDoc._id})`);
  } catch (err) {
    console.warn('⚠️ Mongo save notice for Company Intelligence search:', err.message);
  }

  return payload;
}

module.exports = {
  runCompanyIntelligencePipeline
};
