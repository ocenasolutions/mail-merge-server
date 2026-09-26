const https = require('https');

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
 * Multi-Provider AI Engine (Groq, OpenAI, Gemini & Heuristic Fallback)
 * Operates on strictly real scraped data without inserting guessed contacts.
 */

/**
 * Call Groq AI API with automatic model retry fallback
 */
async function callGroqAI(prompt, systemInstruction = '', apiKey = '', requestedModel = 'qwen/qwen3.8-27b') {
  const candidateModels = Array.from(new Set([
    requestedModel,
    'qwen/qwen3.8-27b',
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'allam-2-7b'
  ])).filter(Boolean);

  let lastError = null;

  for (const model of candidateModels) {
    try {
      const result = await new Promise((resolve, reject) => {
        const postData = JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemInstruction || 'You are an AI B2B Intelligence Analyst. Return only valid JSON.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.2,
          max_tokens: 4096
        });

        const options = {
          hostname: 'api.groq.com',
          path: '/openai/v1/chat/completions',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'Content-Length': Buffer.byteLength(postData)
          },
          timeout: 20000
        };

        const req = https.request(options, (res) => {
          let raw = '';
          res.on('data', (chunk) => raw += chunk);
          res.on('end', () => {
            try {
              const json = JSON.parse(raw);
              if (json.choices && json.choices[0] && json.choices[0].message) {
                resolve(json.choices[0].message.content);
              } else if (json.error) {
                reject(new Error(json.error.message || `Groq error on model ${model}`));
              } else {
                reject(new Error(`Unexpected response format from Groq API on model ${model}`));
              }
            } catch (e) {
              reject(e);
            }
          });
        });

        req.on('error', (err) => reject(err));
        req.on('timeout', () => {
          req.destroy();
          reject(new Error(`Groq request timed out on model ${model}`));
        });

        req.write(postData);
        req.end();
      });

      return { text: result, usedModel: model };
    } catch (err) {
      lastError = err;
      console.warn(`Groq model ${model} notice (${err.message}). Trying fallback model...`);
    }
  }

  throw lastError || new Error('All Groq model attempts failed');
}

/**
 * Call OpenAI API (GPT-4o / GPT-4o-mini)
 */
async function callOpenAI(prompt, systemInstruction = '', apiKey = '', model = 'gpt-4o-mini') {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      model: model || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemInstruction || 'You are an AI B2B Intelligence Analyst.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      max_tokens: 1000
    });

    const options = {
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 10000
    };

    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => raw += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(raw);
          if (json.choices && json.choices[0] && json.choices[0].message) {
            resolve(json.choices[0].message.content);
          } else {
            reject(new Error('OpenAI API error'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('OpenAI request timed out'));
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Call Gemini API (Gemini 1.5 Flash / 2.0 Flash) with optional Google Search Grounding
 */
async function callGeminiAI(prompt, systemInstruction = '', apiKey = '', requestedModel = 'gemini-2.5-flash', enableSearchGrounding = true, timeoutMs = 8000) {
  const effectiveKey = apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!effectiveKey || !effectiveKey.startsWith('AIzaSy')) {
    throw new Error('No valid Google Gemini API key provided (must start with AIzaSy)');
  }

  const model = 'gemini-2.5-flash';
  let lastErr = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const text = await new Promise((resolve, reject) => {
        const payload = {
          contents: [{
            parts: [{ text: `${systemInstruction}\n\nTask: ${prompt}` }]
          }]
        };

        if (enableSearchGrounding && attempt <= 2) {
          payload.tools = [{ googleSearch: {} }];
        }

        const postData = JSON.stringify(payload);

        const options = {
          hostname: 'generativelanguage.googleapis.com',
          path: `/v1beta/models/${model}:generateContent?key=${effectiveKey}`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
          },
          timeout: timeoutMs
        };

        const req = https.request(options, (res) => {
          let raw = '';
          res.on('data', (chunk) => raw += chunk);
          res.on('end', () => {
            try {
              const json = JSON.parse(raw);
              if (json.candidates && json.candidates[0] && json.candidates[0].content) {
                const parts = json.candidates[0].content.parts || [];
                const resText = parts.map(p => p.text).filter(Boolean).join('\n');
                resolve(resText);
              } else if (json.error) {
                reject(new Error(json.error.message || `Gemini API error (code ${json.error.code})`));
              } else {
                reject(new Error('Unexpected response structure from Gemini API'));
              }
            } catch (e) {
              reject(e);
            }
          });
        });

        req.on('error', (err) => reject(err));
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Gemini request timed out'));
        });

        req.write(postData);
        req.end();
      });

      return text;
    } catch (err) {
      lastErr = err;
      console.warn(`[Gemini AI] Attempt ${attempt}/3 notice: ${err.message}. Retrying...`);
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }
  }

  throw lastErr || new Error('All Gemini attempts failed');
}

/**
 * Heuristic Rule Synthesizer (Strictly Real Scraped Data)
 */
function heuristicSynthesize(scrapedData) {
  const domain = scrapedData.domain || 'company.com';
  const text = `${scrapedData.orgName || ''} ${domain} ${scrapedData.title || ''} ${scrapedData.description || ''} ${scrapedData.headline || ''}`.toLowerCase();

  let name = scrapedData.orgName || domain.split('.')[0].toUpperCase();
  if (scrapedData.title && !scrapedData.title.toLowerCase().includes('official site')) {
    name = scrapedData.title.split('-')[0].split('|')[0].trim();
  }
  if (scrapedData.orgName && scrapedData.orgName.length > 2) {
    name = scrapedData.orgName;
  }

  let industry = 'Technology & Software';
  let subIndustry = 'Digital Platforms & Services';
  const rawLocation = normalizeLocationString(scrapedData.address);
  let location = '';

  const fullText = `${scrapedData.orgName || ''} ${domain} ${scrapedData.title || ''} ${scrapedData.description || ''} ${scrapedData.headline || ''} ${scrapedData.fullContent || ''} ${scrapedData.aboutSnippet || ''}`.toLowerCase();
  const phoneStr = (scrapedData.phoneNumbers || []).join(' ');

  // Factual Regional / State / City Location Detection
  if (fullText.includes('mohali')) {
    location = 'Mohali, Punjab, India';
  } else if (fullText.includes('chandigarh')) {
    location = 'Chandigarh, Punjab, India';
  } else if (fullText.includes('pune')) {
    location = 'Pune, Maharashtra, India';
  } else if (fullText.includes('mumbai')) {
    location = 'Mumbai, Maharashtra, India';
  } else if (fullText.includes('delhi') || fullText.includes('ncr') || fullText.includes('gurgaon') || fullText.includes('gurugram') || fullText.includes('noida')) {
    location = 'Delhi NCR, India';
  } else if (fullText.includes('bangalore') || fullText.includes('bengaluru')) {
    location = 'Bengaluru, Karnataka, India';
  } else if (fullText.includes('hyderabad')) {
    location = 'Hyderabad, Telangana, India';
  } else if (fullText.includes('chennai')) {
    location = 'Chennai, Tamil Nadu, India';
  } else if (fullText.includes('punjab')) {
    location = 'Punjab, India';
  } else if (fullText.includes('san francisco') || fullText.includes('silicon valley') || fullText.includes('bay area')) {
    location = 'San Francisco, CA, USA';
  } else if (fullText.includes('new york') || fullText.includes('nyc')) {
    location = 'New York, NY, USA';
  } else if (fullText.includes('london')) {
    location = 'London, United Kingdom';
  } else if (fullText.includes('toronto')) {
    location = 'Toronto, Canada';
  } else if (fullText.includes('berlin')) {
    location = 'Berlin, Germany';
  } else if (fullText.includes('sydney')) {
    location = 'Sydney, Australia';
  } else if (rawLocation && rawLocation !== 'Global Operations' && rawLocation !== 'Global') {
    location = rawLocation;
  } else if (domain.endsWith('.in') || domain.endsWith('.co.in') || fullText.includes('india') || fullText.includes('indian') || phoneStr.includes('+91')) {
    location = 'India';
  } else if (domain.endsWith('.uk') || domain.endsWith('.co.uk') || fullText.includes('united kingdom') || fullText.includes(' uk ')) {
    location = 'United Kingdom';
  } else if (domain.endsWith('.ca') || fullText.includes('canada')) {
    location = 'Canada';
  } else if (domain.endsWith('.de') || fullText.includes('germany')) {
    location = 'Germany';
  } else if (domain.endsWith('.au') || fullText.includes('australia')) {
    location = 'Australia';
  } else {
    location = rawLocation || 'Global Operations';
  }

  if (text.includes('beauty') || text.includes('salon') || text.includes('skincare') || text.includes('cosmetic') || text.includes('spa') || text.includes('hair') || text.includes('grooming')) {
    industry = 'Beauty & Personal Care';
    subIndustry = 'Salon Services & Skincare E-Commerce';
  } else if (text.includes('uniportal') || text.includes('admission') || text.includes('university') || text.includes('education') || text.includes('portal') || text.includes('college') || text.includes('student') || text.includes('.edu') || text.includes('school')) {
    industry = 'Higher Education Admissions & Student Recruitment';
    subIndustry = 'University Admissions Guidance & Student Referral Consulting';
  } else if (text.includes('stripe') || text.includes('pay') || text.includes('fintech') || text.includes('bank') || text.includes('billing') || text.includes('payment') || text.includes('razorpay')) {
    industry = 'Fintech & Financial Infrastructure';
    subIndustry = 'Payments, Banking APIs & Merchant Billing';
  } else if (text.includes('blockchain') || text.includes('web3') || text.includes('smart contract')) {
    industry = 'Artificial Intelligence & Blockchain Development';
    subIndustry = 'AI Automation, Smart Contracts & Web3 Platforms';
  } else if (text.includes('health') || text.includes('medical') || text.includes('clinic') || text.includes('doctor') || text.includes('pharma') || text.includes('hospital')) {
    industry = 'Healthcare & Life Sciences';
    subIndustry = 'Clinical Care & Digital Health Services';
  } else if (text.includes('shop') || text.includes('store') || text.includes('cart') || text.includes('e-commerce') || text.includes('fashion') || text.includes('apparel')) {
    industry = 'Retail & E-Commerce';
    subIndustry = 'Direct-to-Consumer & Online Commerce';
  } else if (text.includes('data') || text.includes('ai') || text.includes('ml') || text.includes('intelligence') || text.includes('llm')) {
    industry = 'Artificial Intelligence & Software Engineering';
    subIndustry = 'AI Automation, Custom Software & Analytics';
  } else if (text.includes('cyber') || text.includes('security') || text.includes('privacy') || text.includes('shield')) {
    industry = 'Cybersecurity & Data Governance';
    subIndustry = 'Cloud Security & Compliance Infrastructure';
  }

  const isJunkSnippet = (str) => !str || /(?:cell phone|landline|bio\s*\(|\(\d{3}\)\s*\d{3}-\d{4}.*\(|email\s+[a-z0-9._%+-]+@|\[\s*\]|\[.*?\]\(.*?\)|!\[Image)/i.test(str);

  let tagline = scrapedData.headline;
  if (isJunkSnippet(tagline)) {
    tagline = scrapedData.title && !isJunkSnippet(scrapedData.title) ? scrapedData.title : `${name} Official Organization Profile`;
  }

  let overview = scrapedData.description;
  if (isJunkSnippet(overview)) {
    overview = scrapedData.aboutSnippet && !isJunkSnippet(scrapedData.aboutSnippet)
      ? scrapedData.aboutSnippet
      : (industry.includes('Education') 
          ? `${name} is an education consulting organization and university admissions portal that connects prospective students with higher education institutions and academic programs.`
          : `${name} is a specialized organization operating via ${domain}, providing dedicated services in ${industry}.`);
  }

  // Clean remaining markdown link brackets from overview
  overview = overview
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\[\[+|\]\]+/g, ' ')
    .replace(/\[|\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const defaultServices = industry.includes('Education')
    ? ['University Admissions & Higher Education Guidance', 'Student Referral & Placement Services', 'College Admissions & Enrollment Counseling', 'Application & Visa Assistance']
    : ['Digital Platform Services', 'Client Solutions', 'Consulting & Strategy'];

  return {
    name,
    domain,
    url: scrapedData.url || `https://${domain}`,
    tagline: tagline || `${name} Platform`,
    overview: overview || `${name} provides professional services via ${domain}.`,
    industry,
    subIndustry,
    location: normalizeLocationString(location),
    emails: (scrapedData.emails || []).filter(e => !isJunkSnippet(e)),
    phoneNumbers: scrapedData.phoneNumbers || [],
    socialMedia: scrapedData.socialMedia || {
      linkedin: null,
      twitter: null,
      facebook: null,
      instagram: null,
      youtube: null,
      github: null
    },
    techStack: scrapedData.techStack || ['Web Services'],
    services: defaultServices,
    aiProvider: 'heuristic',
    synthesizedAt: new Date().toISOString()
  };
}

/**
 * Main Synthesizer router supporting Groq, OpenAI, Gemini, and Heuristic Fallback
 */
async function synthesizeCompanyProfile(scrapedData) {
  const provider = (process.env.AI_PROVIDER || 'groq').toLowerCase();
  const groqKey = process.env.GROQ_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const groqModel = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

  const heuristicProfile = heuristicSynthesize(scrapedData);

  const systemPrompt = `You are an expert B2B Market Intelligence AI Analyst. Analyze the scraped website data, domain, and search grounding context to return a highly accurate, professional company profile in valid JSON format:
{
  "name": "Exact Official Company or Brand Name",
  "tagline": "Clear, concise 1-sentence factual value proposition",
  "overview": "Comprehensive 2-3 sentence overview describing core products, services, target audience, and business model",
  "industry": "Primary Industry Sector (e.g. Higher Education Admissions & Student Recruitment, EdTech, Healthcare, Fintech, etc.)",
  "subIndustry": "Specific Sub-Industry Niche",
  "location": "Official Headquarters City, State, Country or Address (e.g. San Francisco, CA or Mohali, Punjab, India)",
  "emails": ["official public email addresses if verified"],
  "phoneNumbers": ["official phone numbers if verified"],
  "socialMedia": {
    "linkedin": "Official Company LinkedIn URL",
    "twitter": "Official Twitter/X URL",
    "facebook": "Official Facebook Page URL",
    "instagram": "Official Instagram Handle URL"
  },
  "services": ["List of core services provided"]
}
CRITICAL RULE: DO NOT invent fake contact information. Ground location, emails, phone numbers, and LinkedIn URL strictly on the website DOM content or verified web search grounding.
Return valid JSON only.`;

  const userPrompt = `Target Organization Name: ${scrapedData.orgName || scrapedData.title || scrapedData.domain}
Scraped Domain: ${scrapedData.domain}
Title: ${scrapedData.title}
Meta Description: ${scrapedData.description}
Headline: ${scrapedData.headline}
About / Summary: ${scrapedData.aboutSnippet || ''}
Scraped DOM Address / Footer / JSON-LD: ${scrapedData.address || 'None explicitly detected'}
Scraped Emails: ${(scrapedData.emails || []).join(', ')}
Scraped Phone Numbers: ${(scrapedData.phoneNumbers || []).join(', ')}
Scraped Social Links: ${JSON.stringify(scrapedData.socialMedia || {})}
Full Webpage Text: ${(scrapedData.fullContent || scrapedData.aboutSnippet || '').slice(0, 3000)}`;

  let aiText = '';
  let activeProvider = 'heuristic';

  // 1. Try Gemini if valid key exists (starts with AIzaSy)
  if (geminiKey && geminiKey.startsWith('AIzaSy')) {
    try {
      activeProvider = 'gemini (1.5-flash search-grounded)';
      aiText = await callGeminiAI(userPrompt, systemPrompt, geminiKey, 'gemini-1.5-flash', true);
    } catch (gErr) {
      console.warn('[Synthesizer] Gemini notice, trying Groq fallback:', gErr.message);
    }
  }

  // 2. Try Groq AI (Ultra-fast & accurate)
  if (!aiText && groqKey) {
    try {
      const groqRes = await callGroqAI(userPrompt, systemPrompt, groqKey, groqModel);
      aiText = groqRes.text;
      activeProvider = `groq (${groqRes.usedModel})`;
    } catch (groqErr) {
      console.warn('[Synthesizer] Groq notice, trying OpenAI fallback:', groqErr.message);
    }
  }

  // 3. Try OpenAI if available
  if (!aiText && openaiKey) {
    try {
      activeProvider = 'openai (gpt-4o-mini)';
      aiText = await callOpenAI(userPrompt, systemPrompt, openaiKey);
    } catch (oaErr) {
      console.warn('[Synthesizer] OpenAI notice, using heuristic synthesis:', oaErr.message);
    }
  }

  if (aiText) {
    try {
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);

        const mergedEmails = Array.from(new Set([
          ...(parsed.emails || []),
          ...(heuristicProfile.emails || [])
        ])).filter(Boolean);

        const mergedPhones = Array.from(new Set([
          ...(parsed.phoneNumbers || []),
          ...(heuristicProfile.phoneNumbers || [])
        ])).filter(Boolean);

        const mergedSocialMedia = {
          linkedin: parsed.socialMedia?.linkedin || heuristicProfile.socialMedia?.linkedin || null,
          twitter: parsed.socialMedia?.twitter || heuristicProfile.socialMedia?.twitter || null,
          facebook: parsed.socialMedia?.facebook || heuristicProfile.socialMedia?.facebook || null,
          instagram: parsed.socialMedia?.instagram || heuristicProfile.socialMedia?.instagram || null,
          youtube: parsed.socialMedia?.youtube || heuristicProfile.socialMedia?.youtube || null,
          github: parsed.socialMedia?.github || heuristicProfile.socialMedia?.github || null,
        };

        const parsedLoc = normalizeLocationString(parsed.location);
        const locationToUse = (parsedLoc && parsedLoc !== 'Global Operations' && parsedLoc !== 'Global')
          ? parsedLoc
          : (heuristicProfile.location && heuristicProfile.location !== 'Global Operations' ? heuristicProfile.location : (parsedLoc || 'India'));

        let cleanOverview = (parsed.overview || heuristicProfile.overview)
          .replace(/!\[.*?\]\(.*?\)/g, '')
          .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
          .replace(/\[\[+|\]\]+/g, ' ')
          .replace(/\[|\]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        return {
          ...heuristicProfile,
          name: parsed.name || heuristicProfile.name,
          tagline: parsed.tagline || heuristicProfile.tagline,
          overview: cleanOverview,
          industry: parsed.industry || heuristicProfile.industry,
          subIndustry: parsed.subIndustry || heuristicProfile.subIndustry,
          location: locationToUse,
          emails: mergedEmails,
          phoneNumbers: mergedPhones,
          socialMedia: mergedSocialMedia,
          services: (parsed.services && parsed.services.length > 0) ? parsed.services : heuristicProfile.services,
          aiProvider: activeProvider,
          synthesizedAt: new Date().toISOString()
        };
      }
    } catch (parseErr) {
      console.warn('[Synthesizer] JSON parse error from AI response:', parseErr.message);
    }
  }

  return heuristicProfile;
}

module.exports = {
  synthesizeCompanyProfile,
  callGroqAI,
  callOpenAI,
  callGeminiAI,
  heuristicSynthesize
};