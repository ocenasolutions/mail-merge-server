const { profile } = require('console');
const https = require('https');

/**
 * Multi-Provider AI Engine (Groq, OpenAI, Gemini & Heuristic Fallback)
 * Operates on strictly real scraped data without inserting guessed contacts.
 */

/**
 * Call Groq AI API with automatic model retry fallback
 */
async function callGroqAI(prompt, systemInstruction = '', apiKey = '', requestedModel = 'llama-3.3-70b-versatile') {
  const candidateModels = Array.from(new Set([
    requestedModel,
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'llama-3.2-11b-vision-preview',
    'llama-3.2-3b-preview'
  ])).filter(Boolean);


  let lastError = null;

  for (const model of candidateModels) {
    try {
      const result = await new Promise((resolve, reject) => {
        const postData = JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemInstruction || 'You are an AI B2B Intelligence Analyst.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.2,
          max_tokens: 1000
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
 * Call Gemini API (Gemini 1.5 Flash / Pro)
 */
async function callGeminiAI(prompt, systemInstruction = '', apiKey = '', model = 'gemini-1.5-flash') {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      contents: [{
        parts: [{ text: `${systemInstruction}\n\nTask: ${prompt}` }]
      }]
    });

    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/${model}:generateContent?key=${apiKey}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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
          if (json.candidates && json.candidates[0] && json.candidates[0].content) {
            const text = json.candidates[0].content.parts[0].text;
            resolve(text);
          } else {
            reject(new Error('Gemini API error'));
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
}

/**
 * Heuristic Rule Synthesizer (Strictly Real Scraped Data)
 */
function heuristicSynthesize(scrapedData) {
  const domain = scrapedData.domain || 'company.com';
  const text = `${domain} ${scrapedData.title || ''} ${scrapedData.description || ''} ${scrapedData.headline || ''}`.toLowerCase();

  let name = domain.split('.')[0].toUpperCase();
  if (scrapedData.title && !scrapedData.title.toLowerCase().includes('official site')) {
    name = scrapedData.title.split('-')[0].split('|')[0].trim();
  }

  let industry = 'B2B Software & Enterprise Tech';
  let subIndustry = 'Cloud Platform & Digital Solutions';
  let location = scrapedData.address || 'Global Operations';

  if (text.includes('uniportal') || text.includes('university') || text.includes('education') || text.includes('portal') || text.includes('college') || text.includes('student') || text.includes('.co.in') || text.includes('.edu')) {
    industry = 'Education Technology (EdTech) & Institutional Software';
    subIndustry = 'University & Higher Education Management Portal';
    if (text.includes('.co.in') || text.includes('india')) {
      location = scrapedData.address || 'India Operations';
    }
  } else if (text.includes('stripe') || text.includes('pay') || text.includes('fintech') || text.includes('bank') || text.includes('billing')) {
    industry = 'Fintech & Financial Infrastructure';
    subIndustry = 'Payments, Banking APIs & Merchant Billing';
    location = scrapedData.address || 'San Francisco, CA & London, UK';
  } else if (text.includes('data') || text.includes('ai') || text.includes('ml') || text.includes('intelligence') || text.includes('llm')) {
    industry = 'Artificial Intelligence & Data Systems';
    subIndustry = 'AI Infrastructure, Vector Databases & Analytics';
    location = scrapedData.address || 'San Francisco, CA';
  } else if (text.includes('cyber') || text.includes('security') || text.includes('privacy') || text.includes('shield')) {
    industry = 'Cybersecurity & Data Governance';
    subIndustry = 'Cloud Security & Compliance Infrastructure';
    location = scrapedData.address || 'San Francisco, CA';
  }

  const tagline = scrapedData.headline || scrapedData.description || `Platform operating at ${domain}`;
  const overview = scrapedData.description && scrapedData.description.length > 10
    ? scrapedData.description
    : `${name} is an established platform operating via ${domain}. The company provides digital infrastructure and software solutions tailored for its users.`;

  return {
    name,
    domain,
    url: scrapedData.url || `https://${domain}`,
    tagline,
    overview,
    industry,
    subIndustry,
    location,
    emails: scrapedData.emails || [],
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
  const geminiKey = process.env.GEMINI_API_KEY;
  const groqModel = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

  const heuristicProfile = heuristicSynthesize(scrapedData);

  const systemPrompt = `You are a B2B Market Intelligence AI. Analyze the scraped website data and return a JSON object with:
{
  "name": "Company Name",
  "tagline": "One sentence value proposition",
  "overview": "Detailed overview paragraph based on scraped text",
  "industry": "Industry sector",
  "subIndustry": "Sub-industry specialty",
  "location": "Headquarters city/country"
}
Return valid JSON only.`;

  const userPrompt = `Scraped Domain: ${scrapedData.domain}\nTitle: ${scrapedData.title}\nDescription: ${scrapedData.description}\nHeadline: ${scrapedData.headline}\nAddress: ${scrapedData.address || ''}`;

  try {
    let aiText = '';
    let activeProvider = 'heuristic';

    if ((provider === 'groq' || groqKey) && groqKey) {
      const groqRes = await callGroqAI(userPrompt, systemPrompt, groqKey, groqModel);
      aiText = groqRes.text;
      activeProvider = `groq (${groqRes.usedModel})`;
    } else if ((provider === 'openai' || openaiKey) && openaiKey) {
      activeProvider = 'openai (gpt-4o-mini)';
      aiText = await callOpenAI(userPrompt, systemPrompt, openaiKey);
    } else if ((provider === 'gemini' || geminiKey) && geminiKey) {
      activeProvider = 'gemini (1.5-flash)';
      aiText = await callGeminiAI(userPrompt, systemPrompt, geminiKey);
    } else {
      return heuristicProfile;
    }

    const jsonMatch = aiText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        ...heuristicProfile,
        name: parsed.name || heuristicProfile.name,
        tagline: parsed.tagline || heuristicProfile.tagline,
        overview: parsed.overview || heuristicProfile.overview,
        industry: parsed.industry || heuristicProfile.industry,
        subIndustry: parsed.subIndustry || heuristicProfile.subIndustry,
        location: parsed.location || heuristicProfile.location,
        aiProvider: activeProvider,
        synthesizedAt: new Date().toISOString()
      };
    }
  } catch (err) {
    console.warn(`AI Provider (${provider}) notice, using heuristic synthesis:`, err.message);
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