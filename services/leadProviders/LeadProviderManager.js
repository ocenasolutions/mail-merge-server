const ExpleeProvider = require('./ExpleeProvider');
const FallbackLeadProvider = require('./FallbackLeadProvider');

class LeadProviderManager {
  constructor() {
    this.providers = new Map();
    this.initProviders();
  }

  initProviders() {
    this.explee = new ExpleeProvider(process.env.EXPLEE_API_KEY);
    this.fallback = new FallbackLeadProvider();

    this.providers.set('explee', this.explee);
    this.providers.set('fallback', this.fallback);
  }

  /**
   * Reload configuration if environment variables change
   */
  reload() {
    this.explee = new ExpleeProvider(process.env.EXPLEE_API_KEY);
    this.providers.set('explee', this.explee);
  }

  /**
   * Get preferred active provider
   */
  getPreferredProvider() {
    if (this.explee.isConfigured()) {
      return this.explee;
    }
    return this.fallback;
  }

  /**
   * Execute search with primary provider and automatic fallback
   */
  async searchCompanies(options = {}) {
    const primary = this.getPreferredProvider();
    try {
      const result = await primary.searchCompanies(options);
      if (result && result.companies && result.companies.length > 0) {
        return result;
      }
    } catch (err) {
      console.warn(`Primary provider (${primary.name}) failed in searchCompanies:`, err.message);
      if (primary === this.fallback) {
        throw err;
      }
    }

    // Fallback to secondary provider if primary returned 0 results or threw
    console.info('Using fallback provider for searchCompanies');
    return this.fallback.searchCompanies(options);
  }

  /**
   * Execute domain search / lookup
   */
  async getCompanyProfile(options = {}) {
    const primary = this.getPreferredProvider();
    try {
      const result = await primary.getCompanyProfile(options);
      if (result && result.company) {
        return result;
      }
    } catch (err) {
      console.warn(`Primary provider (${primary.name}) failed in getCompanyProfile:`, err.message);
      if (primary === this.fallback) {
        throw err;
      }
    }

    return this.fallback.getCompanyProfile(options);
  }

  /**
   * Execute people / decision makers search
   */
  async searchPeople(options = {}) {
    const primary = this.getPreferredProvider();
    try {
      const result = await primary.searchPeople(options);
      if (result && result.people && result.people.length > 0) {
        return result;
      }
    } catch (err) {
      console.warn(`Primary provider (${primary.name}) failed in searchPeople:`, err.message);
      if (primary === this.fallback) {
        throw err;
      }
    }

    return this.fallback.searchPeople(options);
  }

  /**
   * Check status of all configured providers
   */
  async getStatus() {
    const expleeHealth = await this.explee.checkHealth();
    const fallbackHealth = await this.fallback.checkHealth();

    return {
      activeProvider: this.explee.isConfigured() ? 'explee' : 'fallback',
      isExpleeConfigured: this.explee.isConfigured(),
      explee: expleeHealth,
      fallback: fallbackHealth
    };
  }
}

// Export singleton instance
module.exports = new LeadProviderManager();
