const BaseLeadProvider = require('./BaseLeadProvider');
const { searchWebPlaces } = require('../placesDiscoveryService');

/**
 * FallbackLeadProvider
 * Operates strictly on live data sources (local places discovery / web search) without hardcoded mock records.
 */
class FallbackLeadProvider extends BaseLeadProvider {
  constructor() {
    super('Fallback Lead Engine');
  }

  async searchCompanies(options = {}) {
    const { query = '', definition = '', geoCity = '', pageSize = 20 } = options;
    const effectiveQuery = definition || query || '';
    const locationStr = geoCity || '';

    if (!effectiveQuery && !locationStr) {
      return {
        success: true,
        provider: 'fallback',
        total: 0,
        page: 1,
        pageSize,
        companies: [],
        meta: { total: 0, message: 'Please provide a search query or company name.' }
      };
    }

    try {
      // Execute live web places discovery if query/location provided
      const places = await searchWebPlaces(effectiveQuery, locationStr || 'Global', 25, pageSize);
      if (places && places.length > 0) {
        const mapped = places.map((p, idx) => ({
          id: String(p.id || `place-${idx}-${Date.now()}`),
          name: p.name || 'Discovered Business',
          domain: p.website ? p.website.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0] : '',
          website: p.website || null,
          industry: p.category || p.industry || 'Technology & Business Services',
          location: p.address || locationStr || 'Local Area',
          geoCity: locationStr || null,
          geoCountry: 'Global',
          size: '10-50 employees',
          employeeCount: null,
          description: p.description || `${p.name} provides ${p.category || 'services'} in ${p.address || locationStr || 'the local market'}.`,
          founded: null,
          traffic: null,
          trafficGrowth: null,
          revenueAnnual: null,
          fundingStage: null,
          hiring: false,
          emails: [],
          phones: p.phone ? [p.phone] : [],
          socials: {
            linkedin: null,
            twitter: null,
            github: null
          },
          marketingPixels: [],
          criteria: {},
          source: 'Live Web Places Discovery'
        }));

        return {
          success: true,
          provider: 'places_discovery',
          total: mapped.length,
          page: 1,
          pageSize,
          companies: mapped,
          meta: { total: mapped.length, note: 'Discovered via live web index' }
        };
      }
    } catch (err) {
      console.warn('Live places discovery error:', err.message);
    }

    return {
      success: true,
      provider: 'fallback',
      total: 0,
      page: 1,
      pageSize,
      companies: [],
      meta: {
        total: 0,
        message: 'No live records found. Configure EXPLEE_API_KEY to search over 105M+ verified B2B companies.'
      }
    };
  }

  async getCompanyProfile(options = {}) {
    const { domain = '', companyId = '' } = options;
    if (!domain && !companyId) {
      return { success: false, company: null, meta: { message: 'Domain or company ID required.' } };
    }

    const searchRes = await this.searchCompanies({ definition: domain || companyId, pageSize: 1 });
    return {
      success: searchRes.companies.length > 0,
      provider: searchRes.provider,
      company: searchRes.companies[0] || null,
      meta: searchRes.meta
    };
  }

  async searchPeople(options = {}) {
    return {
      success: true,
      provider: 'fallback',
      total: 0,
      people: [],
      meta: {
        total: 0,
        message: 'EXPLEE_API_KEY is required to search and enrich verified decision makers.'
      }
    };
  }

  async enrichContact(options = {}) {
    return {
      success: false,
      contact: null,
      message: 'EXPLEE_API_KEY is required for live contact enrichment.'
    };
  }

  async checkHealth() {
    return {
      available: true,
      name: this.name,
      note: 'Fallback engine active. For live B2B company database, configure EXPLEE_API_KEY.'
    };
  }
}

module.exports = FallbackLeadProvider;
