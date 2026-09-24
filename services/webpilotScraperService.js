const http = require('http');
const https = require('https');
const { URL } = require('url');
const { scrapeWithPlaywright } = require('./playwrightScraper');

function normalizeLocationString(loc) {
  if (!loc) return null;
  if (typeof loc === 'string') return loc;
  if (typeof loc === 'object') {
    const parts = [
      loc.address || loc.street || loc.cityState,
      loc.city,
      loc.state || loc.region,
      loc.country || loc.granularity
    ].filter(Boolean);
    if (parts.length > 0) {
      return Array.from(new Set(parts)).join(', ');
    }
    try {
      return Object.values(loc).filter(v => typeof v === 'string' || typeof v === 'number').join(', ');
    } catch {
      return String(loc);
    }
  }
  return String(loc);
}

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
  // 1. Try Serper.dev API first
  try {
    const serperData = await new Promise((resolve, reject) => {
      const postData = JSON.stringify({ q: `${domain} company overview contact phone email address headquarters` });
      const req = https.request({
        hostname: 'google.serper.dev',
        path: '/search',
        method: 'POST',
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 8000
      }, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(raw);
            if (json.knowledgeGraph || json.organic) {
              const kg = json.knowledgeGraph || {};
              const firstOrg = (json.organic && json.organic[0]) || {};
              const address = kg.attributes?.Headquarters || kg.attributes?.Address || kg.address || '';
              const rawDesc = kg.description || firstOrg.snippet || '';
              const isJunkSnippet = /(?:cell phone|landline|bio\s*\(|\(\d{3}\)\s*\d{3}-\d{4}.*\(|email\s+[a-z0-9._%+-]+@)/i.test(rawDesc);
              const cleanDesc = isJunkSnippet ? '' : rawDesc;

              resolve({
                domain,
                url: `https://${domain}`,
                title: kg.title || firstOrg.title || domain,
                description: cleanDesc,
                headline: kg.type || (kg.title || firstOrg.title || domain),
                address: normalizeLocationString(address),
                phoneNumbers: phone ? [phone] : [],
                socialMedia: {},
                techStack: ['Serper Verified Google Engine'],
                source: 'serper_dev_api',
                scrapedAt: new Date().toISOString()
              });
            } else {
              reject(new Error('Serper returned empty response'));
            }
          } catch (e) { reject(e); }
        });
      });
      req.on('error', err => reject(err));
      req.write(postData);
      req.end();
    });
    return serperData;
  } catch (err) {
    console.warn(`[Serper API] Notice: ${err.message}. Trying SerpAPI endpoint...`);
  }

  // 2. Fallback to SerpAPI endpoint
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
            address: normalizeLocationString(knowledgeGraph.headquarters || knowledgeGraph.address),
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
          const metaDescMatch = raw.match(/<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["']/i) ||
                                raw.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([\s\S]*?)["']/i) ||
                                raw.match(/<meta[^>]*name=["']twitter:description["'][^>]*content=["']([\s\S]*?)["']/i);
          const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : domain;
          const description = metaDescMatch ? metaDescMatch[1].replace(/\s+/g, ' ').trim() : '';

          const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
          const rawEmails = raw.match(emailRegex) || [];
          const validEmails = Array.from(new Set(
            rawEmails.map(e => e.toLowerCase()).filter(e => 
              !e.endsWith('.png') && !e.endsWith('.jpg') && !e.endsWith('.svg') &&
              !e.includes('sentry') && !e.includes('example.com') && !e.includes('w3.org')
            )
          )).slice(0, 5);

          const phones = new Set();
          const waMatches = raw.match(/wa\.me\/(\d{7,15})/gi) || [];
          waMatches.forEach(w => {
            const digits = w.replace(/\D/g, '');
            if (digits.length >= 10) phones.add(`+${digits}`);
          });

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
            phoneNumbers: Array.from(phones).slice(0, 4),
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
 * High-Fidelity Third-Party Reader API Scraper (Jina AI Reader)
 * Bypasses SPA hydration limits & Anti-Bot protections, extracting structured Markdown text
 */
async function fetchJinaReaderData(targetUrl, domain) {
  return new Promise((resolve) => {
    const jinaUrl = `https://r.jina.ai/${targetUrl}`;
    const req = https.get(jinaUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Web-Pilot Hybrid Scraper/2.0'
      },
      timeout: 12000
    }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(raw);
          if (json.code === 200 && json.data) {
            const data = json.data;
            const content = data.content || '';
            const title = data.title || domain;
            const description = data.description || '';

            // Extract emails from markdown content
            const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
            const rawEmails = content.match(emailRegex) || [];
            const validEmails = Array.from(new Set(
              rawEmails.map(e => e.toLowerCase()).filter(e =>
                !e.endsWith('.png') && !e.endsWith('.jpg') && !e.endsWith('.svg') &&
                !e.endsWith('.webp') && !e.includes('sentry') && !e.includes('example.com') && !e.includes('w3.org')
              )
            )).slice(0, 5);

            // Extract phone numbers (including WhatsApp wa.me links & international patterns)
            const phones = new Set();
            const waMatches = content.match(/wa\.me\/(\d{7,15})/gi) || [];
            waMatches.forEach(w => {
              const digits = w.replace(/\D/g, '');
              if (digits.length >= 10) phones.add(`+${digits}`);
            });

            const phonePattern = /(\+\d{1,3}[-.\s]?)?(\(?\d{2,5}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g;
            const rawPhones = content.match(phonePattern) || [];
            rawPhones.forEach(p => {
              const cleaned = p.trim();
              const digitsOnly = cleaned.replace(/\D/g, '');
              if ((digitsOnly.length >= 10 && digitsOnly.length <= 15) || cleaned.startsWith('+')) {
                if (!cleaned.includes('.jpg') && !cleaned.includes('.png') && !cleaned.includes('.webp')) {
                  phones.add(cleaned);
                }
              }
            });

            // Extract social links from markdown
            const socials = {
              linkedin: (content.match(/https?:\/\/(www\.)?linkedin\.com\/(company|in)\/[a-zA-Z0-9_-]+/i) || [])[0] || null,
              twitter: (content.match(/https?:\/\/(www\.)?(twitter|x)\.com\/[a-zA-Z0-9_-]+/i) || [])[0] || null,
              facebook: (content.match(/https?:\/\/(www\.)?facebook\.com\/[a-zA-Z0-9._-]+/i) || [])[0] || null,
              instagram: (content.match(/https?:\/\/(www\.)?instagram\.com\/[a-zA-Z0-9._-]+/i) || [])[0] || null,
              youtube: (content.match(/https?:\/\/(www\.)?youtube\.com\/@[a-zA-Z0-9._-]+/i) || [])[0] || null,
              github: (content.match(/https?:\/\/(www\.)?github\.com\/[a-zA-Z0-9._-]+/i) || [])[0] || null
            };

            // Extract high quality about snippet
            let aboutSnippet = description;
            if (!aboutSnippet || aboutSnippet.length < 20) {
              const paragraphs = content.split('\n\n').filter(p => p.trim().length > 40 && !p.startsWith('![Image'));
              aboutSnippet = paragraphs[0] ? paragraphs[0].replace(/\[.*?\]\(.*?\)/g, '').trim() : content.slice(0, 300);
            }

            resolve({
              domain,
              url: targetUrl,
              title,
              description: description || aboutSnippet,
              aboutSnippet: aboutSnippet.slice(0, 500),
              headline: title,
              emails: validEmails,
              phoneNumbers: Array.from(phones).slice(0, 5),
              socialMedia: socials,
              fullMarkdown: content.slice(0, 4000),
              techStack: ['Jina AI Reader'],
              source: 'jina_ai_reader',
              scrapedAt: new Date().toISOString()
            });
          } else {
            resolve(null);
          }
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
 * Scrapes a website URL using an Ensemble Multi-Source Engine (Jina AI Reader + Playwright + SerpApi + HTTP Fallback)
 */
async function scrapeWebsite(inputUrl) {
  const targetUrl = formatUrl(inputUrl);
  let domain = '';
  try {
    const parsedUrl = new URL(targetUrl);
    domain = parsedUrl.hostname.replace('www.', '');
  } catch (e) {
    domain = inputUrl.replace(/^https?:\/\//, '').split('/')[0];
  }

  // 1. Execute Jina AI Reader API & Playwright Scraper concurrently for maximum scraping fidelity
  const [jinaData, playwrightRes] = await Promise.allSettled([
    fetchJinaReaderData(targetUrl, domain),
    scrapeWithPlaywright(inputUrl)
  ]);

  const jina = jinaData.status === 'fulfilled' ? jinaData.value : null;
  const pw = (playwrightRes.status === 'fulfilled' && playwrightRes.value && playwrightRes.value.success) ? playwrightRes.value.data : null;

  // Merge findings cleanly across sources
  const emails = Array.from(new Set([
    ...(jina?.emails || []),
    ...(pw?.emails || [])
  ])).slice(0, 5);

  const phoneNumbers = Array.from(new Set([
    ...(jina?.phoneNumbers || []),
    ...(pw?.phoneNumbers || [])
  ])).slice(0, 5);

  const socialMedia = {
    linkedin: jina?.socialMedia?.linkedin || pw?.socialMedia?.linkedin || null,
    twitter: jina?.socialMedia?.twitter || pw?.socialMedia?.twitter || null,
    facebook: jina?.socialMedia?.facebook || pw?.socialMedia?.facebook || null,
    instagram: jina?.socialMedia?.instagram || pw?.socialMedia?.instagram || null,
    youtube: jina?.socialMedia?.youtube || pw?.socialMedia?.youtube || null,
    github: jina?.socialMedia?.github || pw?.socialMedia?.github || null
  };

  const title = (jina?.title && !jina.title.includes('403')) ? jina.title : (pw?.title || domain);
  const description = jina?.description || pw?.description || '';
  const aboutSnippet = jina?.aboutSnippet || pw?.aboutSnippet || description || `Platform operating at ${domain}`;
  const fullContent = (jina?.fullMarkdown || pw?.aboutSnippet || '').slice(0, 4000);

  if (jina || pw) {
    return {
      success: true,
      data: {
        domain,
        url: targetUrl,
        title,
        description,
        aboutSnippet,
        headline: jina?.headline || pw?.headline || title,
        address: pw?.address || null,
        emails,
        phoneNumbers,
        socialMedia,
        techStack: pw?.techStack || jina?.techStack || ['Web Stack'],
        fullContent,
        source: jina && pw ? 'jina_playwright_hybrid' : (jina ? 'jina_ai_reader' : 'playwright_headless'),
        scrapedAt: new Date().toISOString()
      }   
    };
  }

  // 2. Secondary Attempt: SerpApi + Direct HTTP Scraper Fallback
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

  // Check if prompt or any word inside prompt is a domain name
  const words = prompt.split(/\s+/);
  const firstDomainWord = words.find(w => isWebsiteUrl(w));

  if (firstDomainWord) {
    const formattedUrl = formatUrl(firstDomainWord);
    let domain = '';
    try {
      const u = new URL(formattedUrl);
      domain = u.hostname.replace(/^www\./i, '').toLowerCase();
    } catch (e) {
      domain = firstDomainWord.toLowerCase().replace(/^https?:\/\//i, '').split('/')[0];
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

