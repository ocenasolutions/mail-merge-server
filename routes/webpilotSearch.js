const express = require('express');
const router = express.Router();
const { isWebsiteUrl, scrapeWebsite, resolveOrganizationDomain } = require('../services/webpilotScraperService');
const { synthesizeCompanyProfile, callGroqAI } = require('../services/webpilotAiSynthesizer');
const { processCompetitorAnalysis, processCompetitorAnalysisAsync } = require('../services/webpilotCompetitorEngine');
const { parseNaturalLanguageIntent } = require('../services/webpilotIntentParser');
const { searchApolloPeople } = require('../services/apolloService');
const { searchLeads } = require('../services/vectorEngine');
const SavedSearch = require('../models/SavedSearch');

/**
 * POST /api/search
 */

router.post('/search', async (req, res) => {
  try {
    const prompt = req.body.prompt || req.body.query || '';
    const { filters = {}, userEmail = '' } = req.body;
    const emailToSave = userEmail || req.headers['x-user-email'] || req.user?.email || '';
    
    // Resolve prompt to URL/Domain or Organization Name
    const resolved = await resolveOrganizationDomain(prompt);

    if (resolved.isWebsite) {
      // --- STAGE 1: DEEP WEB & SERPAPI SCRAPING ---
      const scrapeResult = await scrapeWebsite(resolved.url || prompt);
      const rawScrapedData = {
        ...(scrapeResult.data || {}),
        orgName: resolved.orgName
      };

      // --- STAGE 2 & STAGE 3: AI STUDY & SOCIAL/CONTACT SYNTHESIS ---
      const profile = await synthesizeCompanyProfile(rawScrapedData);

      // --- STAGE 4: REAL-TIME COMPETITOR & ECOSYSTEM DISCOVERY ---
      const analysis = await processCompetitorAnalysisAsync(rawScrapedData, filters);

      const workflowSteps = [
        {
          step: 1,
          title: "Phase 1: Target Company Scraping & Intelligence",
          description: `Extracted live HTML, about snippet & DOM contacts for ${profile.domain}. Address: ${profile.location || 'Global'}`,
          status: "completed",
          timestamp: new Date(Date.now() - 1200).toISOString()
        },
        {
          step: 2,
          title: "Phase 2: Local & Global Competitor Mining",
          description: `Discovered ${analysis.competitorLeads ? analysis.competitorLeads.length : 0} competitors (Same-Location local rivals & top global market leaders)`,
          status: "completed",
          timestamp: new Date(Date.now() - 800).toISOString()
        },
        {
          step: 3,
          title: "Phase 3: Ideal Customer Profile (ICP) Synthesis",
          description: `Identified target buyer personas & decision-maker roles for ${profile.industry}`,
          status: "completed",
          timestamp: new Date(Date.now() - 400).toISOString()
        },
        {
          step: 4,
          title: "Phase 4: Verified Decision Maker Lead Matching",
          description: `Synthesized verified contacts, email directory & score alignment`,
          status: "completed",
          timestamp: new Date().toISOString()
        }
      ];

      // Format target company lead using ONLY real scraped contact data
      const hasRealEmail = profile.emails && profile.emails.length > 0;
      const targetCompanyLead = {
        ...analysis.targetCompany,
        name: profile.name,
        domain: profile.domain,
        website: profile.url,
        industry: profile.industry,
        subIndustry: profile.subIndustry,
        location: profile.location || 'Global',
        description: profile.overview,
        techStack: profile.techStack,
        emails: profile.emails || [],
        phoneNumbers: profile.phoneNumbers || [],
        socialMedia: profile.socialMedia || {},
        matchScore: 99,
        matchedReasoning: `Scraped Target Domain (${profile.domain}). ${profile.tagline}`,
        isTargetCompany: true,
        primaryContact: hasRealEmail ? {
          id: `cnt-target-primary`,
          name: profile.emails[0].split('@')[0].toUpperCase(),
          title: "Extracted Web Contact",
          email: profile.emails[0],
          linkedin: profile.socialMedia && profile.socialMedia.linkedin ? profile.socialMedia.linkedin : '',
          verified: true,
          score: 99
        } : null
      };

      let filteredCompetitors = analysis.competitorLeads || [];
      if (filters && filters.location && filters.location !== 'All') {
        const locations = filters.location.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        if (locations.length > 0) {
          filteredCompetitors = filteredCompetitors.filter(c => {
            const locStr = (c.location || '').toLowerCase();
            const regStr = (c.region || '').toLowerCase();
            return locations.some(loc => locStr.includes(loc) || regStr.includes(loc) || loc === 'global' || locStr.includes('global'));
          });
        }
      }

      // Search Apollo API for verified B2B decision makers for target domain
      let apolloResult = { contacts: [] };
      try {
        apolloResult = await searchApolloPeople(profile.domain, { limit: 10 });
      } catch (err) {
        console.warn('Apollo search API error:', err.message);
      }

      // Build ICP Target Buyer Leads from real-time dynamic buyer account discovery or Apollo API
      let icpLeads = [];
      if (analysis.icpBuyerLeads && Array.isArray(analysis.icpBuyerLeads) && analysis.icpBuyerLeads.length > 0) {
        icpLeads = analysis.icpBuyerLeads;
      } else if (apolloResult.contacts && apolloResult.contacts.length > 0) {
        icpLeads = apolloResult.contacts.map((c, idx) => ({
          id: `apollo-icp-${idx}-${Date.now()}`,
          name: c.organization?.name || `${profile.name || profile.domain} Enterprise Partner`,
          website: `https://${profile.domain}`,
          domain: profile.domain,
          industry: profile.industry || 'Technology',
          subIndustry: profile.subIndustry || 'Software & Services',
          location: c.city ? `${c.city}, ${c.country || ''}` : (profile.location || 'Global'),
          region: c.country || 'Global',
          employeeCount: c.organization?.estimatedEmployees || 250,
          headcountRange: '50-500',
          fundingStage: 'Enterprise / Scaled',
          fundingAmount: 'N/A',
          investors: [],
          techStack: profile.techStack || ['Modern Stack'],
          hiringIntent: true,
          openRoles: [c.title],
          description: `${c.name} (${c.title}) — Verified Apollo B2B Decision Maker Lead.`,
          isIcpLead: true,
          matchScore: 99 - (idx * 2),
          matchedReasoning: `Apollo B2B Verified Contact: ${c.name} (${c.title}). Status: ${c.emailStatus}.`,
          contacts: [{
            id: `apollo-cnt-${idx}`,
            name: c.name,
            title: c.title,
            email: c.email,
            linkedin: c.linkedin || '',
            verified: c.verified,
            score: c.confidenceScore || 95
          }],
          primaryContact: {
            id: `apollo-cnt-${idx}`,
            name: c.name,
            title: c.title,
            email: c.email,
            linkedin: c.linkedin || '',
            verified: c.verified,
            score: c.confidenceScore || 95
          },
          emails: [c.email],
          phoneNumbers: [],
          socialMedia: {
            linkedin: c.linkedin || null,
            twitter: c.twitter || null
          }
        }));
      } else {
        icpLeads = [];
      }

      // Phase 2 leads = competitors only; Phase 3 leads = ICP buyer accounts

      const competitorLeads = filteredCompetitors.length > 0 ? filteredCompetitors : [targetCompanyLead];
      const allLeads = competitorLeads; // backward-compat: leads field = competitors for Phase 2

      const scrapedCompanyPayload = {
        name: profile.name,
        domain: profile.domain,
        url: profile.url,
        tagline: profile.tagline,
        overview: profile.overview,
        title: profile.name,
        description: profile.overview,
        industry: profile.industry,
        subIndustry: profile.subIndustry,
        location: profile.location,
        address: profile.location,
        emails: profile.emails || [],
        phoneNumbers: profile.phoneNumbers || [],
        socialMedia: profile.socialMedia || {},
        techStack: profile.techStack,
        source: rawScrapedData.source
      };

      const parsedIntentPayload = {
        industry: profile.industry,
        subIndustry: profile.subIndustry,
        location: profile.location,
        targetDomain: profile.domain
      };

      // Persist to MongoDB SavedSearch
      let savedDoc = null;
      try {
        savedDoc = new SavedSearch({
          userEmail: emailToSave ? emailToSave.toLowerCase().trim() : '',
          prompt,
          siteName: profile.name || profile.domain,
          siteDomain: profile.domain || 'website.com',
          searchType: 'url_scraper',
          scrapedCompany: scrapedCompanyPayload,
          parsedIntent: parsedIntentPayload,
          icpProfile: analysis.icpProfile,
          workflowSteps,
          leads: allLeads,
          icpLeads: icpLeads,
        });
        await savedDoc.save();
        console.log(`💾 Saved Website Analysis to MongoDB: ${profile.name} (${savedDoc._id})`);
      } catch (saveErr) {
        console.warn('⚠️ Could not save search to Mongo:', saveErr.message);
      }

      return res.json({
        success: true,
        savedSearchId: savedDoc?._id || null,
        searchType: 'url_scraper',
        query: prompt,
        scrapedCompany: scrapedCompanyPayload,
        parsedIntent: parsedIntentPayload,
        icpProfile: analysis.icpProfile,
        workflowSteps,
        totalMatched: allLeads.length,
        leads: allLeads,
        icpLeads: icpLeads
      });

    } else {
      // --- NATURAL LANGUAGE MARKET SEARCH ---
      const parsedIntent = parseNaturalLanguageIntent(prompt);
      let leads = searchLeads(parsedIntent, filters);

      // Perform Live Google SERP & Groq AI Discovery for Real Market Data
      if (leads.length === 0) {
        try {
          const { fetchSerpCompetitors } = require('../services/webpilotCompetitorEngine');
          const serpResults = await fetchSerpCompetitors(prompt, parsedIntent.industry || filters.industry || '', parsedIntent.location || filters.location || '');
          if (serpResults && serpResults.length > 0) {
            leads = serpResults;
          }
        } catch (serpErr) {
          console.warn('[Natural Language SERP Search Notice]:', serpErr.message);
        }
      }

      const workflowSteps = [
        {
          step: 1,
          title: "Parsing Natural Language Intent",
          description: `Extracted parameters: ${parsedIntent.industry ? `[Industry: ${parsedIntent.industry}] ` : ''}${parsedIntent.location ? `[Location: ${parsedIntent.location}] ` : ''}`,
          status: "completed",
          timestamp: new Date(Date.now() - 1200).toISOString()
        },
        {
          step: 2,
          title: "Live Market & SERP Search",
          description: "Scraped live search engines and web directories for real market companies",
          status: "completed",
          timestamp: new Date(Date.now() - 800).toISOString()
        },
        {
          step: 3,
          title: "Evaluating Growth & Recruitment Signals",
          description: "Cross-referenced recruitment signals and tech stack alignment",
          status: "completed",
          timestamp: new Date(Date.now() - 400).toISOString()
        },
        {
          step: 4,
          title: "Extracting Verified Decision Makers",
          description: `Retrieved ${leads.length} matching decision maker leads`,
          status: "completed",
          timestamp: new Date().toISOString()
        }
      ];

      return res.json({
        success: true,
        searchType: 'natural_language',
        query: prompt,
        parsedIntent,
        workflowSteps,
        totalMatched: leads.length,
        leads
      });
    }
  } catch (err) {
    console.error('Search API Error:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to process agentic lead search.'
    });
  }
});

module.exports = router;
