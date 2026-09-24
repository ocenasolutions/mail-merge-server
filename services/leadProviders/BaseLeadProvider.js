/**
 * BaseLeadProvider interface
 * Abstract base class for B2B data providers (Explee, Apollo, fallback, etc.)
 */
class BaseLeadProvider {
  constructor(name) {
    this.name = name;
  }

  /**
   * Search companies using natural language definition or structured filters
   * @param {Object} options - { query, filters, page, pageSize, criteria }
   * @returns {Promise<{ success: boolean, companies: Array, total: number, meta: Object }>}
   */
  async searchCompanies(options) {
    throw new Error(`searchCompanies not implemented in ${this.name}`);
  }

  /**
   * Lookup company profile by domain or identifier
   * @param {Object} options - { domain, companyId, criteria }
   * @returns {Promise<{ success: boolean, company: Object, meta: Object }>}
   */
  async getCompanyProfile(options) {
    throw new Error(`getCompanyProfile not implemented in ${this.name}`);
  }

  /**
   * Search people / decision makers for a company or criteria
   * @param {Object} options - { domain, companyLinkedinId, definition, jobTitles, geo, page, pageSize }
   * @returns {Promise<{ success: boolean, people: Array, total: number, meta: Object }>}
   */
  async searchPeople(options) {
    throw new Error(`searchPeople not implemented in ${this.name}`);
  }

  /**
   * Enrich email or contact details
   * @param {Object} options - { firstName, lastName, domain, linkedinUrl, email }
   * @returns {Promise<{ success: boolean, contact: Object }>}
   */
  async enrichContact(options) {
    throw new Error(`enrichContact not implemented in ${this.name}`);
  }

  /**
   * Check balance / health of provider
   * @returns {Promise<{ available: boolean, remain?: number, details?: string }>}
   */
  async checkHealth() {
    return { available: true, name: this.name };
  }
}

module.exports = BaseLeadProvider;
