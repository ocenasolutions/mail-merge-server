const test = require('node:test');
const assert = require('node:assert/strict');

const { UNIPORTAL_TEST_DATA, OCENA_TEST_DATA } = require('../services/seedTestCompanies');
const { analyzeIndustrySector, processCompetitorAnalysis, generateICPProfile } = require('../services/webpilotCompetitorEngine');

test('Uniportal test company data structure and ICP decision makers validation', () => {
  assert.equal(UNIPORTAL_TEST_DATA.siteDomain, 'uniportal.co.in');
  assert.equal(UNIPORTAL_TEST_DATA.scrapedCompany.domain, 'uniportal.co.in');
  assert.equal(UNIPORTAL_TEST_DATA.scrapedCompany.industry, 'Education Technology (EdTech) & Institutional Software');
  
  // Competitor leads check
  assert.ok(UNIPORTAL_TEST_DATA.leads.length >= 3);
  assert.equal(UNIPORTAL_TEST_DATA.leads[0].isTargetCompany, true);
  
  // Verified ICP target buyer emails check
  assert.ok(UNIPORTAL_TEST_DATA.icpLeads.length >= 3);
  const emails = UNIPORTAL_TEST_DATA.icpLeads.map(l => l.primaryContact.email);
  assert.ok(emails.includes('testing.ocena@gmail.com'));
  assert.ok(emails.includes('testingaditya5@gmail.com'));
  assert.ok(emails.includes('adityathakur19200@gmail.com'));
});

test('Ocena test company data structure and ICP decision makers validation', () => {
  assert.equal(OCENA_TEST_DATA.siteDomain, 'ocena.in');
  assert.equal(OCENA_TEST_DATA.scrapedCompany.domain, 'ocena.in');
  assert.equal(OCENA_TEST_DATA.scrapedCompany.industry, 'Services-Based Tech & Software Consultancy');
  
  // Competitor leads check
  assert.ok(OCENA_TEST_DATA.leads.length >= 3);
  assert.equal(OCENA_TEST_DATA.leads[0].isTargetCompany, true);
  
  // Verified ICP target buyer emails check
  assert.ok(OCENA_TEST_DATA.icpLeads.length >= 3);
  const emails = OCENA_TEST_DATA.icpLeads.map(l => l.primaryContact.email);
  assert.ok(emails.includes('testing.ocena@gmail.com'));
  assert.ok(emails.includes('testingaditya5@gmail.com'));
  assert.ok(emails.includes('adityathakur19200@gmail.com'));
});

test('Competitor Engine generates 10 verified ICP target buyers for uniportal and ocena domains', () => {
  const uniportalScraped = {
    domain: 'uniportal.co.in',
    title: 'Uniportal University Portal',
    description: 'Higher education ERP and student management',
    address: 'Bengaluru, India',
    emails: ['contact@uniportal.co.in']
  };

  const uniportalAnalysis = processCompetitorAnalysis(uniportalScraped);
  assert.equal(uniportalAnalysis.sectorInfo.industry, 'Education Technology (EdTech) & Institutional Software');
  assert.ok(uniportalAnalysis.icpProfile.decisionMakerContacts.length >= 10);

  const ocenaScraped = {
    domain: 'ocena.in',
    title: 'Ocena Digital Consultancy',
    description: 'Custom cloud development and tech solutions',
    address: 'Mumbai, India',
    emails: ['hello@ocena.in']
  };

  const ocenaAnalysis = processCompetitorAnalysis(ocenaScraped);
  assert.equal(ocenaAnalysis.sectorInfo.industry, 'Services-Based Tech & Software Consultancy');
  assert.ok(ocenaAnalysis.icpProfile.decisionMakerContacts.length >= 10);
});
