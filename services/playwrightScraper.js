let chromium = null;
try {
  chromium = require('playwright').chromium;
} catch (e) {
  console.warn('Playwright not installed, fallback to HTTP/cheerio scraping.');
}
const { URL } = require('url');

/**
 * Robust Email Regex Extractor
 */
function extractEmailsFromText(text = '') {
  const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
  const matches = text.match(emailRegex) || [];
  const validEmails = new Set();
  
  matches.forEach(e => {
    const lower = e.toLowerCase();
    if (!lower.endsWith('.png') && !lower.endsWith('.jpg') && !lower.endsWith('.svg') &&
        !lower.endsWith('.webp') && !lower.endsWith('.gif') && !lower.endsWith('.js') &&
        !lower.endsWith('.css') && !lower.includes('sentry') && !lower.includes('w3.org') &&
        !lower.includes('example.com') && !lower.includes('bootstrap') && !lower.includes('schema.org')) {
      validEmails.add(lower);
    }
  });

  return Array.from(validEmails).slice(0, 5);
}

/**
 * Robust Phone Number Regex Extractor (filters short numbers < 7 digits)
 */
function extractPhonesFromText(text = '') {
  const phones = new Set();
  
  // Regex pattern for international & local phone formats (+91, +1, 1800, (xxx)...)
  const phonePattern = /(\+\d{1,3}[-.\s]?)?(\(?\d{2,5}\)?[-.\s]?)?\d{3,5}[-.\s]?\d{3,5}/g;
  const matches = text.match(phonePattern) || [];
  
  matches.forEach(p => {
    const cleaned = p.trim();
    const digitsOnly = cleaned.replace(/\D/g, '');
    // Filter out short strings that aren't real numbers (< 7 digits)
    if (digitsOnly.length >= 7 && digitsOnly.length <= 15) {
      phones.add(cleaned);
    }
  });

  return Array.from(phones).slice(0, 4);
}

/**
 * Format string to valid HTTPS URL
 */
function formatUrl(input = '') {
  let trimmed = input.trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    trimmed = `https://${trimmed}`;
  }
  return trimmed;
}

/**
 * Playwright Headless Browser Scraper
 */
async function scrapeWithPlaywright(inputUrl) {
  const targetUrl = formatUrl(inputUrl);
  let domain = '';
  try {
    const parsedUrl = new URL(targetUrl);
    domain = parsedUrl.hostname.replace('www.', '');
  } catch (e) {
    domain = inputUrl.replace(/^https?:\/\//, '').split('/')[0];
  }

  let browser = null;
  try {
    // 1. Launch Headless Chromium Browser
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Web-Pilot Playwright Scraper/1.0',
      viewport: { width: 1280, height: 800 }
    });

    const page = await context.newPage();

    // Block heavy image/font resources to speed up crawling
    await page.route('**/*.{png,jpg,jpeg,svg,gif,webp,woff,woff2,ttf,eot,mp4}', route => route.abort());

    // 2. Visit Homepage URL
    console.log(`[Playwright] Navigating to: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

    // Extract Homepage Data
    const homepageData = await extractPageIntelligence(page, domain);

    // 3. Check if contacts or about summary are missing; if so, find internal links (/contact, /about)
    const needsFallback = homepageData.emails.length === 0 || homepageData.phoneNumbers.length === 0 || !homepageData.aboutSnippet;
    
    let secondaryPageData = { emails: [], phoneNumbers: [], socials: {}, aboutSnippet: '' };
    
    if (needsFallback) {
      const internalContactLink = await findInternalLink(page, targetUrl, ['contact', 'contact-us', 'about', 'about-us']);
      if (internalContactLink) {
        console.log(`[Playwright] Navigating to internal link: ${internalContactLink}`);
        try {
          await page.goto(internalContactLink, { waitUntil: 'domcontentloaded', timeout: 10000 });
          secondaryPageData = await extractPageIntelligence(page, domain);
        } catch (e) {
          console.warn(`[Playwright] Secondary page navigation warning:`, e.message);
        }
      }
    }

    await browser.close();

    // 4. Merge Homepage + Internal Link Data
    const mergedEmails = Array.from(new Set([...homepageData.emails, ...secondaryPageData.emails]));
    const mergedPhones = Array.from(new Set([...homepageData.phoneNumbers, ...secondaryPageData.phoneNumbers]));
    const mergedSocials = {
      linkedin: homepageData.socials.linkedin || secondaryPageData.socials.linkedin || null,
      twitter: homepageData.socials.twitter || secondaryPageData.socials.twitter || null,
      facebook: homepageData.socials.facebook || secondaryPageData.socials.facebook || null,
      instagram: homepageData.socials.instagram || secondaryPageData.socials.instagram || null,
      youtube: homepageData.socials.youtube || secondaryPageData.socials.youtube || null,
      github: homepageData.socials.github || secondaryPageData.socials.github || null
    };
    const aboutSnippet = homepageData.aboutSnippet || secondaryPageData.aboutSnippet || homepageData.description || '';

    return {
      success: true,
      data: {
        domain,
        url: targetUrl,
        title: homepageData.title || domain,
        description: homepageData.description || aboutSnippet,
        aboutSnippet: aboutSnippet || `Platform operating at ${domain}`,
        headline: homepageData.headline || '',
        emails: mergedEmails,
        phoneNumbers: mergedPhones,
        socialMedia: mergedSocials,
        techStack: homepageData.techStack,
        source: 'playwright_headless_scraper',
        scrapedAt: new Date().toISOString()
      }
    };
  } catch (err) {
    if (browser) await browser.close();
    console.warn(`[Playwright] Scraper notice: ${err.message}`);
    throw err;
  }
}

/**
 * Extracts DOM Intelligence (Emails, Phones, Socials, About Snippet, Title)
 */
async function extractPageIntelligence(page, domain) {
  return await page.evaluate((currDomain) => {
    const fullText = document.body ? document.body.innerText : '';
    const fullHtml = document.documentElement ? document.documentElement.outerHTML : '';

    // Title & Meta Description
    const title = document.title ? document.title.trim() : currDomain;
    const metaDesc = document.querySelector('meta[name="description"]') || document.querySelector('meta[property="og:description"]');
    const description = metaDesc ? metaDesc.getAttribute('content') : '';

    // Headline (H1)
    const h1 = document.querySelector('h1');
    const headline = h1 ? h1.innerText.trim() : '';

    // 1. Social Media Links from href attributes
    const socials = {
      linkedin: null,
      twitter: null,
      facebook: null,
      instagram: null,
      youtube: null,
      github: null
    };

    const anchors = Array.from(document.querySelectorAll('a[href]'));
    anchors.forEach(a => {
      const href = a.getAttribute('href') || '';
      const lower = href.toLowerCase();
      if (!socials.linkedin && (lower.includes('linkedin.com/company/') || lower.includes('linkedin.com/in/'))) {
        socials.linkedin = href;
      } else if (!socials.twitter && (lower.includes('twitter.com/') || lower.includes('x.com/'))) {
        socials.twitter = href;
      } else if (!socials.facebook && lower.includes('facebook.com/')) {
        socials.facebook = href;
      } else if (!socials.instagram && lower.includes('instagram.com/')) {
        socials.instagram = href;
      } else if (!socials.youtube && lower.includes('youtube.com/')) {
        socials.youtube = href;
      } else if (!socials.github && lower.includes('github.com/')) {
        socials.github = href;
      }
    });

    // 2. Extract "About Us" summary snippet from paragraph (<p>) tags containing keywords
    const paragraphs = Array.from(document.querySelectorAll('p'));
    let aboutSnippet = '';
    const keywords = ['mission', 'founded', 'we are', 'about us', 'our platform', 'leading provider', 'helping businesses'];

    for (const p of paragraphs) {
      const pText = p.innerText.trim();
      const lowerP = pText.toLowerCase();
      if (pText.length >= 30 && keywords.some(kw => lowerP.includes(kw))) {
        aboutSnippet = pText;
        break;
      }
    }

    if (!aboutSnippet && paragraphs.length > 0) {
      const firstLongP = paragraphs.find(p => p.innerText.trim().length >= 40);
      if (firstLongP) aboutSnippet = firstLongP.innerText.trim();
    }

    // Tech Stack signatures
    const techStack = [];
    if (fullHtml.includes('_next') || fullHtml.includes('react')) techStack.push('Next.js / React');
    if (fullHtml.includes('stripe')) techStack.push('Stripe API');
    if (fullHtml.includes('tailwind')) techStack.push('Tailwind CSS');
    if (fullHtml.includes('graphql')) techStack.push('GraphQL');

    return {
      title,
      description,
      headline,
      aboutSnippet,
      socials,
      fullText,
      techStack: techStack.length > 0 ? techStack : ['Web Stack']
    };
  }, domain).then(res => {
    // Process RegEx on server side
    const emails = extractEmailsFromText(res.fullText);
    const phoneNumbers = extractPhonesFromText(res.fullText);

    return {
      title: res.title,
      description: res.description,
      headline: res.headline,
      aboutSnippet: res.aboutSnippet,
      socials: res.socials,
      emails,
      phoneNumbers,
      techStack: res.techStack
    };
  });
}

/**
 * Finds internal links matching target keywords (/about, /contact, etc.)
 */
async function findInternalLink(page, baseUrl, keywords) {
  try {
    return await page.evaluate(({ base, keys }) => {
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      for (const a of anchors) {
        const href = a.getAttribute('href') || '';
        const lowerHref = href.toLowerCase();
        const text = a.innerText.toLowerCase();

        if (keys.some(k => lowerHref.includes(k) || text.includes(k))) {
          try {
            const resolved = new URL(href, base).href;
            if (resolved.startsWith('http') && resolved.includes(new URL(base).hostname)) {
              return resolved;
            }
          } catch (e) {
            // Ignore invalid URL resolution
          }
        }
      }
      return null;
    }, { base: baseUrl, keys: keywords });
  } catch (e) {
    return null;
  }
}

module.exports = {
  scrapeWithPlaywright,
  extractEmailsFromText,
  extractPhonesFromText
};
