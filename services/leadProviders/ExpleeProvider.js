const https = require('https');
const BaseLeadProvider = require('./BaseLeadProvider');

/**
 * Explee B2B Lead Intelligence Provider
 * Official documentation: https://api.explee.com/
 */
class ExpleeProvider extends BaseLeadProvider {
  constructor(apiKey = process.env.EXPLEE_API_KEY, baseUrl = 'https://api.explee.com') {
    super('Explee');
    this.apiKey = apiKey || '';
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = 25000;
  }

  isConfigured() {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  /**
   * Internal HTTP request helper with timeout and safe error handling
   */
  async _request(method, path, body = null, retries = 2) {
    if (!this.isConfigured()) {
      const err = new Error('EXPLEE_API_KEY is not configured on the server.');
      err.statusCode = 401;
      err.code = 'MISSING_API_KEY';
      throw err;
    }

    const url = new URL(`${this.baseUrl}${path}`);
    const postData = body ? JSON.stringify(body) : null;

    let attempt = 0;
    while (attempt <= retries) {
      attempt++;
      try {
        const response = await new Promise((resolve, reject) => {
          const req = https.request({
            hostname: url.hostname,
            port: url.port || 443,
            path: url.pathname + url.search,
            method,
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'X-API-Key': this.apiKey,
              ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {})
            },
            timeout: this.timeoutMs
          }, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
              let parsed = null;
              try {
                parsed = data ? JSON.parse(data) : {};
              } catch (e) {
                parsed = { raw: data };
              }

              if (res.statusCode >= 200 && res.statusCode < 300) {
                resolve({ statusCode: res.statusCode, data: parsed });
              } else {
                const errorObj = new Error(
                  parsed.detail || parsed.message || parsed.error || `Explee API returned HTTP ${res.statusCode}`
                );
                errorObj.statusCode = res.statusCode;
                errorObj.data = parsed;
                reject(errorObj);
              }
            });
          });

          req.on('timeout', () => {
            req.destroy();
            const timeoutErr = new Error(`Explee API request timed out after ${this.timeoutMs}ms`);
            timeoutErr.statusCode = 504;
            timeoutErr.code = 'TIMEOUT';
            reject(timeoutErr);
          });

          req.on('error', (err) => {
            reject(err);
          });

          if (postData) {
            req.write(postData);
          }
          req.end();
        });

        return response.data;
      } catch (err) {
        // Only retry on network errors, 500, 502, 503, 504
        const shouldRetry = attempt <= retries && (!err.statusCode || err.statusCode >= 500);
        if (shouldRetry) {
          const backoffMs = attempt * 800;
          await new Promise(r => setTimeout(r, backoffMs));
          continue;
        }
        throw err;
      }
    }
  }

  /**
   * Convert natural language prompt to structured filters using NL endpoint
   */
  async nlToFilters(query) {
    if (!query || !query.trim()) return null;
    try {
      const resp = await this._request('POST', '/public/api/v1/search/nl-to-filters', {
        query: query.trim()
      });
      return resp;
    } catch (err) {
      console.warn('Explee NL to filters fallback:', err.message);
      return null;
    }
  }

  /**
   * Search companies using POST /public/api/v1/search/companies
   */
  async searchCompanies(options = {}) {
    const {
      query = '',
      definition = '',
      criteria = [],
      geo = [],
      geoCity = '',
      size = [],
      traffic = [],
      isB2bScore = null,
      page = 1,
      pageSize = 20,
      excludeLists = null
    } = options;

    const effectiveDefinition = definition || query || 'B2B companies';
    const filters = {
      definition: effectiveDefinition
    };

    if (Array.isArray(criteria) && criteria.length > 0) {
      filters.criteria = criteria;
    }
    if (Array.isArray(geo) && geo.length > 0) {
      filters.geo = geo;
    }
    if (geoCity && typeof geoCity === 'string') {
      filters.geo_city = geoCity;
    }
    if (Array.isArray(size) && size.length > 0) {
      filters.size = size;
    }
    if (Array.isArray(traffic) && traffic.length > 0) {
      filters.traffic = traffic;
    }
    if (isB2bScore && typeof isB2bScore === 'object') {
      filters.is_b2b_score = isB2bScore;
    }

    const payload = {
      filters,
      page: Math.max(1, Number(page) || 1),
      page_size: Math.min(100, Math.max(1, Number(pageSize) || 20))
    };

    if (excludeLists && Array.isArray(excludeLists)) {
      payload.exclude_lists = excludeLists;
    }

    const rawResponse = await this._request('POST', '/public/api/v1/search/companies', payload);
    const normalizedCompanies = (rawResponse.companies || []).map(c => this._normalizeCompany(c));

    return {
      success: true,
      provider: 'explee',
      total: rawResponse.meta?.total || normalizedCompanies.length,
      page: rawResponse.meta?.page || payload.page,
      pageSize: rawResponse.meta?.page_size || payload.page_size,
      companies: normalizedCompanies,
      meta: rawResponse.meta || {}
    };
  }

  /**
   * Search companies by domain using POST /public/api/v1/search/companies-by-domains
   */
  async searchCompaniesByDomains(domains = [], criteria = []) {
    const domainList = Array.isArray(domains) ? domains : [domains];
    const cleanDomains = domainList
      .map(d => this._cleanDomain(d))
      .filter(Boolean)
      .slice(0, 100);

    if (cleanDomains.length === 0) {
      return { success: true, companies: [], meta: { total: 0 } };
    }

    const payload = {
      domains: cleanDomains
    };

    if (Array.isArray(criteria) && criteria.length > 0) {
      payload.criteria = criteria;
    }

    const rawResponse = await this._request('POST', '/public/api/v1/search/companies-by-domains', payload);
    const normalizedCompanies = (rawResponse.companies || []).map(c => this._normalizeCompany(c));

    return {
      success: true,
      provider: 'explee',
      total: rawResponse.meta?.total || normalizedCompanies.length,
      companies: normalizedCompanies,
      meta: rawResponse.meta || {}
    };
  }

  /**
   * Get single company profile by domain or ID
   */
  async getCompanyProfile(options = {}) {
    const { domain = '', companyId = '', criteria = [] } = options;
    const cleanDomain = this._cleanDomain(domain);

    if (cleanDomain) {
      const lookup = await this.searchCompaniesByDomains([cleanDomain], criteria);
      if (lookup.companies && lookup.companies.length > 0) {
        return {
          success: true,
          provider: 'explee',
          company: lookup.companies[0],
          meta: lookup.meta
        };
      }
    }

    // Fallback: search by query
    const searchResult = await this.searchCompanies({
      definition: domain || companyId,
      criteria,
      pageSize: 5
    });

    const company = searchResult.companies?.[0] || null;
    return {
      success: Boolean(company),
      provider: 'explee',
      company,
      meta: searchResult.meta
    };
  }

  /**
   * Search people using POST /public/api/v1/search/people or /public/api/v1/search/people-by-domains
   */
  async searchPeople(options = {}) {
    const {
      domain = '',
      companyDefinition = '',
      companyLinkedinIds = [],
      jobTitles = ['Founder', 'Co-Founder', 'CEO', 'CTO', 'Head of Engineering', 'VP Engineering', 'Product Manager'],
      geo = [],
      criteria = [],
      page = 1,
      pageSize = 10,
      peoplePerCompany = 3
    } = options;

    const cleanDomain = this._cleanDomain(domain);

    // If specific domain provided, use people-by-domains for exact company matching
    if (cleanDomain) {
      try {
        const payload = {
          domains: [cleanDomain],
          job_titles: Array.isArray(jobTitles) && jobTitles.length > 0 ? jobTitles : ['Founder', 'CEO', 'CTO'],
          people_per_company: peoplePerCompany
        };
        const rawResponse = await this._request('POST', '/public/api/v1/search/people-by-domains', payload);
        const normalizedPeople = (rawResponse.people || []).map(p => this._normalizePerson(p));

        return {
          success: true,
          provider: 'explee',
          total: rawResponse.meta?.total || normalizedPeople.length,
          people: normalizedPeople,
          meta: rawResponse.meta || {}
        };
      } catch (err) {
        console.warn('Explee people-by-domains failed, falling back to general people search:', err.message);
      }
    }

    // General people search
    const peopleFilters = {
      job_titles: jobTitles
    };
    if (Array.isArray(geo) && geo.length > 0) {
      peopleFilters.geo = geo;
    }
    if (Array.isArray(criteria) && criteria.length > 0) {
      peopleFilters.criteria = criteria;
    }

    const companyFilters = {
      definition: companyDefinition || (cleanDomain ? `Company at ${cleanDomain}` : 'Tech and B2B companies')
    };

    const payload = {
      people_filters: peopleFilters,
      company_filters: companyFilters,
      page: Math.max(1, Number(page) || 1),
      page_size: Math.min(100, Math.max(1, Number(pageSize) || 10))
    };

    if (Array.isArray(companyLinkedinIds) && companyLinkedinIds.length > 0) {
      payload.company_linkedin_ids = companyLinkedinIds;
    }

    const rawResponse = await this._request('POST', '/public/api/v1/search/people', payload);
    const normalizedPeople = (rawResponse.people || []).map(p => this._normalizePerson(p));

    return {
      success: true,
      provider: 'explee',
      total: rawResponse.meta?.total || normalizedPeople.length,
      page: rawResponse.meta?.page || payload.page,
      pageSize: rawResponse.meta?.page_size || payload.page_size,
      people: normalizedPeople,
      meta: rawResponse.meta || {}
    };
  }

  /**
   * Enrich email using POST /public/api/v1/enrich/email
   */
  async enrichEmail(firstName, lastName, domain, preset = 'basic') {
    const payload = {
      first_name: firstName,
      last_name: lastName,
      company_domain: this._cleanDomain(domain),
      preset: preset === 'premium' ? 'premium' : 'basic'
    };

    const resp = await this._request('POST', '/public/api/v1/enrich/email', payload);
    return {
      success: resp.success ?? true,
      email: resp.email || null,
      status: resp.status || (resp.email ? 'verified' : 'not_found'),
      creditsCharged: resp.credits_charged || 0
    };
  }

  /**
   * Enrich phone using POST /public/api/v1/enrich/phone
   */
  async enrichPhone(linkedinUrl, email = '', preset = 'basic_new') {
    const payload = {
      linkedin_url: linkedinUrl,
      ...(email ? { email } : {}),
      preset: preset === 'premium' ? 'premium' : 'basic_new'
    };

    const resp = await this._request('POST', '/public/api/v1/enrich/phone', payload);
    return {
      success: resp.success ?? true,
      phone: resp.phone || null,
      status: resp.status || (resp.phone ? 'verified' : 'not_found'),
      creditsCharged: resp.credits_charged || 0
    };
  }

  /**
   * Get balance using GET /public/api/v1/billing/balance
   */
  async checkHealth() {
    if (!this.isConfigured()) {
      return {
        available: false,
        name: this.name,
        error: 'EXPLEE_API_KEY is not configured on server'
      };
    }

    try {
      const resp = await this._request('GET', '/public/api/v1/billing/balance');
      return {
        available: true,
        name: this.name,
        remain: resp.remain,
        credits: resp.remain
      };
    } catch (err) {
      return {
        available: false,
        name: this.name,
        error: err.message,
        statusCode: err.statusCode
      };
    }
  }

  /**
   * Helpers for schema normalization
   */
  _cleanDomain(input) {
    if (!input || typeof input !== 'string') return '';
    let d = input.trim().toLowerCase();
    d = d.replace(/^https?:\/\//i, '');
    d = d.replace(/^www\./i, '');
    d = d.split('/')[0].split('?')[0].split('#')[0];
    return d;
  }

  _normalizeCompany(c) {
    if (!c) return null;
    const domain = c.domain || (c.url ? this._cleanDomain(c.url) : '');
    const locationParts = [c.geo_city, c.geo_subdivision, c.geo].filter(Boolean);
    const locationStr = locationParts.length > 0 ? locationParts.join(', ') : (c.geo || 'Global / Remote');

    return {
      id: String(c.linkedin_id || domain || c.name || Math.random().toString(36).substring(2)),
      name: c.name || domain || 'Unknown Company',
      domain: domain,
      website: c.url || (domain ? `https://${domain}` : ''),
      industry: c.industry || (c.industries_nace && c.industries_nace[0]) || 'Technology & B2B Services',
      location: locationStr,
      geoCity: c.geo_city || null,
      geoCountry: c.geo || null,
      size: c.size || (c.employees_by_department ? `${Object.values(c.employees_by_department).reduce((a, b) => a + b, 0)} employees` : '10-50 employees'),
      employeeCount: typeof c.size === 'number' ? c.size : null,
      description: c.description || c.description_website || 'Company profile and B2B services.',
      founded: c.founded || null,
      traffic: c.traffic || null,
      trafficGrowth: c.traffic_growth || null,
      revenueAnnual: c.revenue_annual || null,
      fundingStage: c.funding_stage || c.funding_last_round_stage || null,
      fundingAmount: c.funding_last_round_amount || null,
      hiring: Boolean(c.hiring || c.hiring_is),
      hiringByJobTitle: c.hiring_by_job_title || null,
      employeesByDepartment: c.employees_by_department || null,
      emails: Array.isArray(c.emails) ? c.emails : [],
      phones: Array.isArray(c.phones) ? c.phones : [],
      socials: {
        linkedin: c.linkedin_id ? `https://linkedin.com/company/${c.linkedin_id}` : (c.social_linkedin || null),
        twitter: (c.social_x_urls && c.social_x_urls[0]) || null,
        github: (c.social_github_urls && c.social_github_urls[0]) || null,
        facebook: (c.social_facebook_urls && c.social_facebook_urls[0]) || null,
        youtube: (c.social_youtube_urls && c.social_youtube_urls[0]) || null
      },
      marketingPixels: c.marketing_pixels || [],
      criteria: c.criteria || {},
      matchLevel: c.match || null,
      rawProviderData: c,
      source: 'Explee Verified API'
    };
  }

  _normalizePerson(p) {
    if (!p) return null;
    const firstName = p.first_name || '';
    const lastName = p.last_name || '';
    const fullName = [firstName, lastName].filter(Boolean).join(' ') || p.headline || 'Decision Maker';

    return {
      id: String(p.linkedin_url || `${p.company_domain}_${firstName}_${lastName}` || Math.random().toString(36).substring(2)),
      firstName,
      lastName,
      fullName,
      title: p.title || p.headline || 'Executive / Decision Maker',
      headline: p.headline || p.title || '',
      summary: p.summary || '',
      geo: p.geo || p.company_geo || '',
      linkedinUrl: p.linkedin_url || null,
      followerCount: p.follower_count || null,
      company: {
        name: p.company_name || '',
        domain: p.company_domain || '',
        website: p.company_url || (p.company_domain ? `https://${p.company_domain}` : ''),
        size: p.company_size || '',
        industry: p.company_industry || ''
      },
      email: (p.company_emails && p.company_emails[0]) || null,
      emailStatus: p.company_emails && p.company_emails.length > 0 ? 'verified' : 'unverified',
      criteria: p.criteria || {},
      rawProviderData: p,
      source: 'Explee Verified API'
    };
  }
}

module.exports = ExpleeProvider;
