/**
 * B2B Lead Database Storage
 * Starts with an empty database array (no mock data pre-populated)
 */
const mockCompanies = [];

function getCompanies() {
  return mockCompanies;
}

function addCompany(companyData) {
  const newCompany = {
    id: `comp-${Date.now()}`,
    name: companyData.name || "Untitled Company",
    website: companyData.website || "",
    domain: companyData.domain || companyData.website || "",
    industry: companyData.industry || "General",
    subIndustry: companyData.subIndustry || "",
    location: companyData.location || "Unknown",
    region: companyData.region || "Global",
    employeeCount: companyData.employeeCount || 0,
    headcountRange: companyData.headcountRange || "1-10",
    fundingStage: companyData.fundingStage || "Unfunded",
    fundingAmount: companyData.fundingAmount || "$0",
    investors: companyData.investors || [],
    techStack: companyData.techStack || [],
    hiringIntent: Boolean(companyData.hiringIntent),
    openRoles: companyData.openRoles || [],
    description: companyData.description || "",
    contacts: companyData.contacts || []
  };
  mockCompanies.push(newCompany);
  return newCompany;
}

function clearCompanies() {
  mockCompanies.length = 0;
}

module.exports = {
  mockCompanies,
  getCompanies,
  addCompany,
  clearCompanies
};
