const test = require('node:test');
const assert = require('node:assert');

const {
  calculateHaversineDistanceKm,
  deduplicateCompanies,
  searchTargetCompany
} = require('../services/placesDiscoveryService');

const {
  scoreCompetitorHeuristic,
  scoreICPHeuristic
} = require('../services/companyScoringService');

const {
  runCompanyIntelligencePipeline
} = require('../services/companyIntelligenceService');

test('1. Haversine Distance Calculation', () => {
  // Distance between Mohali Sector 74 (30.7046, 76.7179) and Chandigarh Sector 17 (30.7333, 76.7794) is ~6.8 km
  const dist = calculateHaversineDistanceKm(30.7046, 76.7179, 30.7333, 76.7794);
  assert.strictEqual(typeof dist, 'number');
  assert.ok(dist >= 5 && dist <= 10, `Expected distance ~6.8km, got ${dist}`);
});

test('2. Deduplication Engine', () => {
  const target = {
    name: 'Sagmetic Infotech',
    website: 'https://sagmetic.com',
    providerId: 'target-01'
  };

  const rawList = [
    { providerId: 'target-01', name: 'Sagmetic Infotech', website: 'sagmetic.com' },
    { providerId: 'p1', name: 'Netsmartz Infotech', website: 'https://netsmartz.com' },
    { providerId: 'p1', name: 'Netsmartz Infotech Duplicate', website: 'https://netsmartz.com' },
    { providerId: 'p2', name: 'Seasia Infotech', website: 'https://seasiainfotech.com' }
  ];

  const unique = deduplicateCompanies(rawList, target);
  assert.strictEqual(unique.length, 2, 'Should deduplicate target company and duplicate place IDs');
  assert.strictEqual(unique[0].name, 'Netsmartz Infotech');
  assert.strictEqual(unique[1].name, 'Seasia Infotech');
});

test('3. Transparent Competitor Scoring Engine', () => {
  const targetCompany = {
    name: 'Sagmetic Infotech',
    industry: 'Software Development',
    services: ['Web Development', 'Mobile App Development', 'UI/UX']
  };

  const competitorCandidate = {
    name: 'Seasia Infotech',
    category: 'IT Consulting & Web Development',
    distanceKm: 4.5
  };

  const result = scoreCompetitorHeuristic(competitorCandidate, targetCompany, 25);
  assert.ok(result.competitorScore >= 60, `Competitor score should be >= 60, got ${result.competitorScore}`);
  assert.ok(result.reasons.length > 0, 'Competitor score should include reasons');
});

test('4. Transparent ICP Scoring Engine', () => {
  const targetCompany = {
    name: 'Sagmetic Infotech',
    industry: 'Software Development',
    services: ['Web Development', 'Mobile App Development', 'UI/UX']
  };

  const icpCandidate = {
    name: 'Fortis Healthcare Mohali',
    category: 'Healthcare & Hospital Chain',
    distanceKm: 3.2
  };

  const result = scoreICPHeuristic(icpCandidate, targetCompany, 25);
  assert.ok(result.icpScore >= 70, `ICP score should be >= 70, got ${result.icpScore}`);
  assert.strictEqual(result.isPotentialICP, true);
  assert.ok(result.reasons.length > 0, 'ICP score should include reasons');
});

test('5. Full Company Intelligence Pipeline with Sagmetic Infotech, Mohali, Punjab', async () => {
  const res = await runCompanyIntelligencePipeline('Sagmetic Infotech', 'Mohali, Punjab, India', 25);

  assert.ok(res.targetCompany, 'Result should include targetCompany');
  assert.strictEqual(res.targetCompany.name, 'Sagmetic Infotech');
  assert.ok(Array.isArray(res.competitors), 'Result should include competitors array');
  assert.ok(Array.isArray(res.icps), 'Result should include icps array');
  assert.ok(res.meta, 'Result should include meta');
  assert.strictEqual(res.meta.radiusKm, 25);

  if (res.competitors.length > 0) {
    const comp = res.competitors[0];
    assert.ok(comp.name, 'Competitor must have a name');
    assert.ok(typeof comp.competitorScore === 'number', 'Competitor must have numeric competitorScore');
    assert.ok(Array.isArray(comp.reasons), 'Competitor must have reasons array');
  }

  if (res.icps.length > 0) {
    const icp = res.icps[0];
    assert.ok(icp.name, 'ICP must have a name');
    assert.ok(typeof icp.icpScore === 'number', 'ICP must have numeric icpScore');
    assert.ok(Array.isArray(icp.reasons), 'ICP must have reasons array');
  }
});
