const http = require('http');
const https = require('https');
const { URL } = require('url');
const { scrapeWithPlaywright } = require('./playwrightScraper');

/**
 * Check if input is a Website URL or Domain
 */
function isWebsiteUrl(input = '') {
  const trimmed = input.trim().toLowerCase();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return true;
  
  const domainPattern = /^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(\/.*)?$/;
  return domainPattern.test(trimmed);
}

/**
 * Format input string into a standard valid URL
 */
function formatUrl(input = '') {
  let trimmed = input.trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    trimmed = `https://${trimmed}`;
  }
  return trimmed;
}

/**
 * SERP API Integration helper (Real Google Search Data)
 */
async function fetchSerpApiData(domain, apiKey) {
  return new Promise((resolve, reject) => {
    const serpUrl = `https://serpapi.com/search.json?q=${encodeURIComponent(domain + ' company overview contact phone email address')}&api_key=${apiKey}&engine=google`;
    
    https.get(serpUrl, (res) => {
      let raw = '';
      res.on('data', (chunk) => raw += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(raw);
          const knowledgeGraph = json.knowledge_graph || {};
          const firstResult = (json.organic_results && json.organic_results[0]) || {};

          const socials = {
            linkedin: null,
            twitter: null,
            facebook: null,
            instagram: null,
            youtube: null,
            github: null
          };

          if (knowledgeGraph.profiles) {
            knowledgeGraph.profiles.forEach(p => {
              const link = p.link || '';
              const lower = link.toLowerCase();
              if (lower.includes('linkedin')) socials.linkedin = link;
              if (lower.includes('twitter') || lower.includes('x.com')) socials.twitter = link;
              if (lower.includes('facebook')) socials.facebook = link;
              if (lower.includes('instagram')) socials.instagram = link;
              if (lower.includes('youtube')) socials.youtube = link;
              if (lower.includes('github')) socials.github = link;
            });
          }

          resolve({
            domain,
            url: `https://${domain}`,
            title: knowledgeGraph.title || firstResult.title || domain,
            description: knowledgeGraph.description || firstResult.snippet || '',
            headline: knowledgeGraph.type || '',
            address: knowledgeGraph.headquarters || knowledgeGraph.address || null,
            phoneNumbers: knowledgeGraph.phone ? [knowledgeGraph.phone] : [],
            socialMedia: socials,
            techStack: ['SERP Verified Engine'],
            source: 'serp_api',
            organicResults: (json.organic_results || []).slice(0, 5),
            scrapedAt: new Date().toISOString()
          });
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', (err) => reject(err));
  });
}

async function fetchHttpFallbackData(targetUrl, domain) {
  return new Promise((resolve) => {
    const lib = targetUrl.startsWith('https') ? https : http;
    const req = lib.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 10000
    }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
          const metaDescMatch = raw.match(/<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["']/i);
          const title = titleMatch ? titleMatch[1].trim() : domain;
          const description = metaDescMatch ? metaDescMatch[1].trim() : '';

          const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
          const rawEmails = raw.match(emailRegex) || [];
          const validEmails = Array.from(new Set(
            rawEmails.map(e => e.toLowerCase()).filter(e => 
              !e.endsWith('.png') && !e.endsWith('.jpg') && !e.endsWith('.svg') &&
              !e.includes('sentry') && !e.includes('example.com') && !e.includes('w3.org')
            )
          )).slice(0, 5);

          const socials = {
            linkedin: (raw.match(/https?:\/\/(www\.)?linkedin\.com\/(company|in)\/[a-zA-Z0-9_-]+/i) || [])[0] || null,
            twitter: (raw.match(/https?:\/\/(www\.)?(twitter|x)\.com\/[a-zA-Z0-9_-]+/i) || [])[0] || null,
            facebook: (raw.match(/https?:\/\/(www\.)?facebook\.com\/[a-zA-Z0-9._-]+/i) || [])[0] || null,
            instagram: (raw.match(/https?:\/\/(www\.)?instagram\.com\/[a-zA-Z0-9._-]+/i) || [])[0] || null,
            youtube: (raw.match(/https?:\/\/(www\.)?youtube\.com\/@[a-zA-Z0-9._-]+/i) || [])[0] || null,
            github: (raw.match(/https?:\/\/(www\.)?github\.com\/[a-zA-Z0-9._-]+/i) || [])[0] || null
          };

          resolve({
            domain,
            url: targetUrl,
            title,
            description,
            aboutSnippet: description || `Platform operating at ${domain}`,
            headline: title,
            emails: validEmails,
            phoneNumbers: [],
            socialMedia: socials,
            techStack: ['Web Stack'],
            source: 'http_fallback_scraper',
            scrapedAt: new Date().toISOString()
          });
        } catch (e) {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

/**
 * Scrapes a website URL using Playwright Headless Browser with SerpApi/HTTP fallback
 */
async function scrapeWebsite(inputUrl) {
  // 1. Primary Attempt: Playwright Headless Browser Scraper
  try {
    const playwrightResult = await scrapeWithPlaywright(inputUrl);
    if (playwrightResult && playwrightResult.success) {
      return playwrightResult;
    }
  } catch (err) {
    console.warn(`[Playwright] Headless browser notice, using HTTP/SerpApi fallback:`, err.message);
  }

  // 2. Secondary Attempt: SerpApi + Direct HTTP Scraper Fallback
  const targetUrl = formatUrl(inputUrl);
  let domain = '';
  try {
    const parsedUrl = new URL(targetUrl);
    domain = parsedUrl.hostname.replace('www.', '');
  } catch (e) {
    domain = inputUrl.replace(/^https?:\/\//, '').split('/')[0];
  }

  let serpData = null;
  const serpApiKey = process.env.SERPAPI_KEY;
  if (serpApiKey) {
    try {
      serpData = await fetchSerpApiData(domain, serpApiKey);
      return {
        success: true,
        data: {
          domain,
          url: targetUrl,
          title: serpData.title || domain,
          description: serpData.description || '',
          aboutSnippet: serpData.description || '',
          headline: serpData.headline || '',
          address: serpData.address || null,
          emails: [],
          phoneNumbers: serpData.phoneNumbers || [],
          socialMedia: serpData.socialMedia || {},
          techStack: serpData.techStack,
          source: 'serp_api_fallback',
          scrapedAt: new Date().toISOString()
        }
      };
    } catch (e) {
    }
  }

  // 3. Direct HTTP Scraper Fallback
  const httpFallback = await fetchHttpFallbackData(targetUrl, domain);
  if (httpFallback) {
    return {
      success: true,
      data: httpFallback
    };
  }

  return {
    success: true,
    data: {
      domain,
      url: targetUrl,
      title: domain,
      description: '',
      aboutSnippet: '',
      headline: '',
      address: null,
      emails: [],
      phoneNumbers: [],
      socialMedia: { linkedin: null, twitter: null, facebook: null, instagram: null, youtube: null, github: null },
      techStack: ['Web Stack'],
      source: 'domain_fallback',
      scrapedAt: new Date().toISOString()
    }
  };
}

/**
 * Resolves an input prompt (URL, domain, or organization/company name)
 * into a clean domain, website URL, and organization brand name.
 */
async function resolveOrganizationDomain(inputPrompt = '') {
  const prompt = (inputPrompt || '').trim();
  if (!prompt) return { isWebsite: false, searchQuery: '' };

  // 1. If input is explicitly a website URL or domain (e.g. husnbeautycompany.com, uniportal.co.in, https://...)
  if (isWebsiteUrl(prompt)) {
    const formattedUrl = formatUrl(prompt);
    let domain = '';
    try {
      const u = new URL(formattedUrl);
      domain = u.hostname.replace(/^www\./i, '').toLowerCase();
    } catch (e) {
      domain = prompt.toLowerCase().replace(/^https?:\/\//i, '').split('/')[0];
    }
    
    // Clean brand name from domain
    const rawBrand = domain.split('.')[0];
    const formattedBrand = rawBrand.charAt(0).toUpperCase() + rawBrand.slice(1);

    return {
      isWebsite: true,
      domain,
      url: formattedUrl,
      orgName: formattedBrand,
      searchQuery: prompt
    };
  }

  // 2. If input is an organization name or brand search (e.g. "Husn Beauty", "Uniportal India", "Razorpay", "Zomato", "Swiggy", "Urban Company")
  const groqApiKey = process.env.GROQ_API_KEY;
  if (groqApiKey) {
    try {
      const { callGroqAI } = require('./webpilotAiSynthesizer');
      const sysPrompt = `You are a corporate intelligence domain resolver.
Analyze the user search input and determine if it refers to a specific organization, company, business, startup, or brand (e.g. "Husn Beauty", "Uniportal", "Razorpay", "Swiggy", "Zomato", "Nykaa", "Urban Company", "Glossier", "Treatwell", "LeapScholar").
If YES, identify its official primary domain (e.g. "husnbeautycompany.com", "uniportal.co.in", "razorpay.com", "swiggy.com", "zomato.com") and official company name.
Return strictly valid JSON:
{
  "isOrganization": true,
  "companyName": "Official Company Name",
  "domain": "primarydomain.com"
}
If NO (if it is a generic query like "Find SaaS leads in London" or "Sales managers in Delhi"), return:
{
  "isOrganization": false
}`;

      const aiResult = await callGroqAI(`User Search Input: "${prompt}"`, sysPrompt, groqApiKey, 'qwen/qwen3.8-27b');
      if (aiResult && aiResult.text) {
        const match = aiResult.text.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (parsed.isOrganization && parsed.domain) {
            const cleanDomain = parsed.domain.toLowerCase().replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].trim();
            return {
              isWebsite: true,
              domain: cleanDomain,
              url: `https://${cleanDomain}`,
              orgName: parsed.companyName || prompt,
              searchQuery: prompt
            };
          }
        }
      }
    } catch (err) {
      console.warn('AI Domain resolution notice:', err.message);
    }
  }

  // 3. Fallback heuristic: if input has no spaces and ends with common words or looks like a company name
  const stripped = prompt.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (stripped.length >= 3 && !prompt.includes(' ')) {
    return {
      isWebsite: true,
      domain: `${stripped}.com`,
      url: `https://${stripped}.com`,
      orgName: prompt,
      searchQuery: prompt
    };
  }

  return {
    isWebsite: false,
    searchQuery: prompt
  };
}

module.exports = {
  isWebsiteUrl,
  formatUrl,
  scrapeWebsite,
  fetchSerpApiData,
  resolveOrganizationDomain
};

