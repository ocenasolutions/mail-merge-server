const SavedSearch = require('../models/SavedSearch');

const UNIPORTAL_TEST_DATA = {
  prompt: "uniportal.co.in",
  siteName: "Uniportal Campus Solutions",
  siteDomain: "uniportal.co.in",
  searchType: "url_scraper",
  scrapedCompany: {
    name: "Uniportal Campus Solutions",
    domain: "uniportal.co.in",
    url: "https://uniportal.co.in",
    tagline: "Next-Generation University ERP & Student Management Portal",
    overview: "Uniportal provides unified cloud ERP, student admissions, examination administration, and campus communication portals for Indian universities and higher education institutions.",
    title: "Uniportal Campus Solutions — Higher Education Portal",
    description: "Cloud-native university ERP platform automating student lifecycle, admissions, and campus operations.",
    industry: "Education Technology (EdTech) & Institutional Software",
    subIndustry: "University & Higher Education Management Portal",
    location: "Bengaluru, Karnataka, India",
    address: "Bengaluru, Karnataka, India",
    emails: ["contact@uniportal.co.in", "admissions@uniportal.co.in", "testing.ocena@gmail.com"],
    phoneNumbers: ["+91-80-4567-8900", "+91-98765-43210"],
    socialMedia: {
      linkedin: "https://linkedin.com/company/uniportal-india",
      twitter: "https://twitter.com/uniportal_in",
      facebook: "https://facebook.com/uniportal.india",
      instagram: null,
      youtube: null,
      github: null
    },
    techStack: ["React.js", "Node.js", "PostgreSQL", "AWS Cloud", "Redis"],
    source: "serp_api_fallback"
  },
  parsedIntent: {
    industry: "Education Technology (EdTech) & Institutional Software",
    subIndustry: "University & Higher Education Management Portal",
    location: "India",
    targetDomain: "uniportal.co.in"
  },
  icpProfile: {
    targetBuyerPersona: "Deans of Admissions, University Chancellors, Vice Presidents of International Admissions & Campus IT Directors",
    idealCompanySize: "Higher Education Institutions, Universities & EdTech Firms (100 - 5,000 Staff)",
    locationDetails: {
      cityState: "Bengaluru, Karnataka, India",
      granularity: "Bengaluru, Karnataka, India (Target Buyer State / City Region)"
    },
    keyPainPoints: [
      "Manual paper-based student admission & registration bottlenecks",
      "Managing international student recruitment & multi-campus compliance",
      "Lack of centralized digital student information systems (SIS)"
    ],
    decisionMakerRoles: [
      "Director of International Admissions",
      "Dean of Academic Affairs & Student Success",
      "Vice President of Higher Education Partnerships",
      "Head of Campus IT & Digital Transformation"
    ],
    valueProposition: "Streamlining campus ERP, international student admissions, and institutional software workflows for higher education."
  },
  workflowSteps: [
    {
      step: 1,
      title: "Phase 1: Target Company Scraping & Intelligence",
      description: "Extracted live HTML, about snippet & DOM contacts for uniportal.co.in. Address: Bengaluru, Karnataka, India",
      status: "completed",
      timestamp: new Date(Date.now() - 1200).toISOString()
    },
    {
      step: 2,
      title: "Phase 2: Local & Global Competitor Mining",
      description: "Discovered 5 competitors (CollegeDekho, CollPoll, Shiksha, Blackboard, Instructure)",
      status: "completed",
      timestamp: new Date(Date.now() - 800).toISOString()
    },
    {
      step: 3,
      title: "Phase 3: Ideal Customer Profile (ICP) Synthesis",
      description: "Identified target buyer personas & decision-maker roles for Education Technology (EdTech)",
      status: "completed",
      timestamp: new Date(Date.now() - 400).toISOString()
    },
    {
      step: 4,
      title: "Phase 4: Verified Decision Maker Lead Matching",
      description: "Synthesized 10 verified university decision-maker contacts & campus IT leaders",
      status: "completed",
      timestamp: new Date().toISOString()
    }
  ],
  leads: [
    {
      id: "comp-target-uniportal",
      name: "Uniportal Campus Solutions",
      domain: "uniportal.co.in",
      website: "https://uniportal.co.in",
      industry: "Education Technology (EdTech) & Institutional Software",
      subIndustry: "University & Higher Education Management Portal",
      location: "Bengaluru, Karnataka, India",
      description: "Cloud-native university ERP platform automating student lifecycle and campus operations.",
      techStack: ["React.js", "Node.js", "PostgreSQL", "AWS Cloud"],
      emails: ["contact@uniportal.co.in", "admissions@uniportal.co.in"],
      phoneNumbers: ["+91-80-4567-8900"],
      socialMedia: { linkedin: "https://linkedin.com/company/uniportal-india" },
      matchScore: 99,
      matchedReasoning: "Scraped Target Domain (uniportal.co.in). Next-Generation University ERP & Student Management Portal.",
      isTargetCompany: true,
      primaryContact: {
        id: "cnt-target-uniportal-1",
        name: "Aditya Sharma",
        title: "Director of International Admissions",
        email: "testing.ocena@gmail.com",
        linkedin: "https://linkedin.com/in/adityasharma-uniportal",
        verified: true,
        score: 99
      }
    },
    {
      id: "comp-collegedekho",
      name: "CollegeDekho",
      domain: "collegedekho.com",
      website: "https://collegedekho.com",
      industry: "EdTech & College Admissions",
      subIndustry: "Higher Education Portal & Student Counseling",
      location: "Gurugram, Haryana, India",
      region: "India & South Asia",
      employeeCount: 1800,
      headcountRange: "1000+",
      fundingStage: "Series B",
      fundingAmount: "$53M",
      techStack: ["React", "Node.js", "MySQL", "AWS"],
      hiringIntent: true,
      openRoles: ["Institutional Sales Manager", "Head of Admissions Growth"],
      description: "Leading Indian higher education portal facilitating student recruitment, college applications, and institutional ERP software.",
      matchScore: 95,
      matchedReasoning: "Regional Rival (Same Location - India): Competing with uniportal.co.in in University & Higher Education Management Portal.",
      primaryContact: {
        id: "cnt-cd-1",
        name: "Ruchir Arora",
        title: "Co-Founder & CEO",
        email: "ruchir.arora@collegedekho.com",
        linkedin: "https://linkedin.com/in/ruchirarora",
        verified: true,
        score: 99
      }
    },
    {
      id: "comp-collpoll",
      name: "CollPoll",
      domain: "collpoll.com",
      website: "https://collpoll.com",
      industry: "EdTech & Institutional Software",
      subIndustry: "Campus Automation & Educational ERP",
      location: "Bengaluru, Karnataka, India",
      region: "India & South Asia",
      employeeCount: 220,
      headcountRange: "201-500",
      fundingStage: "Series A",
      fundingAmount: "$8M",
      techStack: ["Java", "Angular", "PostgreSQL", "Cloud"],
      hiringIntent: true,
      openRoles: ["VP of University Enterprise Sales", "Product Manager"],
      description: "AI-powered campus automation and learning management platform built specifically for Indian universities and colleges.",
      matchScore: 92,
      matchedReasoning: "Regional Rival (Same Location - India): Direct competitor in campus ERP & university portal space.",
      primaryContact: {
        id: "cnt-cp-1",
        name: "Hemant Sahal",
        title: "Founder & CEO",
        email: "hemant@collpoll.com",
        linkedin: "https://linkedin.com/in/hemantsahal",
        verified: true,
        score: 97
      }
    }
  ],
  icpLeads: [
    {
      id: "icp-lead-uni-0",
      name: "Amity International University",
      website: "https://amity.edu",
      domain: "amity.edu",
      industry: "Education Technology (EdTech) & Institutional Software",
      subIndustry: "University & Higher Education Management Portal",
      location: "Noida, Uttar Pradesh, India",
      region: "India & South Asia",
      employeeCount: 3500,
      headcountRange: "1000+",
      fundingStage: "Private University",
      fundingAmount: "N/A",
      investors: [],
      techStack: ["ERP", "Student Information System", "Web Portal"],
      hiringIntent: true,
      openRoles: ["Director of International Admissions"],
      description: "Amity International University — Ideal customer account for uniportal.co.in. Contact: Director of International Admissions.",
      isIcpLead: true,
      matchScore: 98,
      matchedReasoning: "ICP Target Buyer: Amity International University matches ideal customer profile for EdTech & Institutional Software. Decision maker: Aditya Sharma (Director of International Admissions).",
      contacts: [
        {
          id: "icp-cnt-uni-0",
          name: "Aditya Sharma",
          title: "Director of International Admissions",
          email: "testing.ocena@gmail.com",
          linkedin: "https://linkedin.com/in/adityasharma-amity",
          verified: true,
          score: 98
        }
      ],
      primaryContact: {
        id: "icp-cnt-uni-0",
        name: "Aditya Sharma",
        title: "Director of International Admissions",
        email: "testing.ocena@gmail.com",
        linkedin: "https://linkedin.com/in/adityasharma-amity",
        verified: true,
        score: 98
      },
      emails: ["testing.ocena@gmail.com"],
      phoneNumbers: ["+91-9811200192"],
      socialMedia: { linkedin: "https://linkedin.com/in/adityasharma-amity" }
    },
    {
      id: "icp-lead-uni-1",
      name: "Manipal Academy of Higher Education",
      website: "https://manipal.edu",
      domain: "manipal.edu",
      industry: "Education Technology (EdTech) & Institutional Software",
      subIndustry: "University & Higher Education Management Portal",
      location: "Manipal, Karnataka, India",
      region: "India & South Asia",
      employeeCount: 4200,
      headcountRange: "1000+",
      fundingStage: "Deemed University",
      fundingAmount: "N/A",
      investors: [],
      techStack: ["ERP", "Student Information System", "Web Portal"],
      hiringIntent: true,
      openRoles: ["Head of Campus IT & Digital Transformation"],
      description: "Manipal Academy of Higher Education — Ideal customer account for uniportal.co.in. Contact: Head of Campus IT.",
      isIcpLead: true,
      matchScore: 95,
      matchedReasoning: "ICP Target Buyer: Manipal Academy matches ideal customer profile for campus ERP. Decision maker: Aditya Ocena (Head of Campus IT).",
      contacts: [
        {
          id: "icp-cnt-uni-1",
          name: "Aditya Ocena",
          title: "Head of Campus IT & Digital Transformation",
          email: "testingaditya5@gmail.com",
          linkedin: "https://linkedin.com/in/adityaocena-manipal",
          verified: true,
          score: 96
        }
      ],
      primaryContact: {
        id: "icp-cnt-uni-1",
        name: "Aditya Ocena",
        title: "Head of Campus IT & Digital Transformation",
        email: "testingaditya5@gmail.com",
        linkedin: "https://linkedin.com/in/adityaocena-manipal",
        verified: true,
        score: 96
      },
      emails: ["testingaditya5@gmail.com"],
      phoneNumbers: ["+91-9845012390"],
      socialMedia: { linkedin: "https://linkedin.com/in/adityaocena-manipal" }
    },
    {
      id: "icp-lead-uni-2",
      name: "Lovely Professional University (LPU)",
      website: "https://lpu.co.in",
      domain: "lpu.co.in",
      industry: "Education Technology (EdTech) & Institutional Software",
      subIndustry: "University & Higher Education Management Portal",
      location: "Phagwara, Punjab, India",
      region: "India & South Asia",
      employeeCount: 5000,
      headcountRange: "1000+",
      fundingStage: "Private University",
      fundingAmount: "N/A",
      investors: [],
      techStack: ["ERP", "Campus Cloud", "Web Portal"],
      hiringIntent: true,
      openRoles: ["Dean of Academic Affairs & Student Success"],
      description: "LPU — Ideal customer account for uniportal.co.in. Contact: Aditya Thakur.",
      isIcpLead: true,
      matchScore: 92,
      matchedReasoning: "ICP Target Buyer: LPU matches ideal customer profile. Decision maker: Aditya Thakur (Dean of Academic Affairs).",
      contacts: [
        {
          id: "icp-cnt-uni-2",
          name: "Aditya Thakur",
          title: "Dean of Academic Affairs & Student Success",
          email: "adityathakur19200@gmail.com",
          linkedin: "https://linkedin.com/in/adityathakur-lpu",
          verified: true,
          score: 94
        }
      ],
      primaryContact: {
        id: "icp-cnt-uni-2",
        name: "Aditya Thakur",
        title: "Dean of Academic Affairs & Student Success",
        email: "adityathakur19200@gmail.com",
        linkedin: "https://linkedin.com/in/adityathakur-lpu",
        verified: true,
        score: 94
      },
      emails: ["adityathakur19200@gmail.com"],
      phoneNumbers: ["+91-9876043210"],
      socialMedia: { linkedin: "https://linkedin.com/in/adityathakur-lpu" }
    }
  ]
};

const OCENA_TEST_DATA = {
  prompt: "ocena.in",
  siteName: "Ocena Tech & Consulting",
  siteDomain: "ocena.in",
  searchType: "url_scraper",
  scrapedCompany: {
    name: "Ocena Tech & Consulting",
    domain: "ocena.in",
    url: "https://ocena.in",
    tagline: "AI-Powered Enterprise Cloud Solutions & Software Delivery Consultancy",
    overview: "Ocena Tech delivers end-to-end digital transformation, custom cloud microservices engineering, dedicated developer teams, and AI-driven automation systems.",
    title: "Ocena Tech — Cloud & Software Consultancy",
    description: "Services-based tech consultancy engineering custom AI software, cloud microservices, and enterprise developer teams.",
    industry: "Services-Based Tech & Software Consultancy",
    subIndustry: "Custom Engineering, Cloud Solutions & Developer Outsourcing",
    location: "Mumbai & Bengaluru, India",
    address: "Mumbai & Bengaluru, India",
    emails: ["hello@ocena.in", "contact@ocena.in", "testing.ocena@gmail.com"],
    phoneNumbers: ["+91-22-6789-0123", "+91-98200-11223"],
    socialMedia: {
      linkedin: "https://linkedin.com/company/ocena-tech",
      twitter: "https://twitter.com/ocena_tech",
      facebook: null,
      instagram: null,
      youtube: null,
      github: null
    },
    techStack: ["Next.js", "Python AI/ML", "Node.js", "Kubernetes", "AWS", "Docker"],
    source: "serp_api_fallback"
  },
  parsedIntent: {
    industry: "Services-Based Tech & Software Consultancy",
    subIndustry: "Custom Engineering, Cloud Solutions & Developer Outsourcing",
    location: "India & Global",
    targetDomain: "ocena.in"
  },
  icpProfile: {
    targetBuyerPersona: "Chief Technology Officers, VP of Software Engineering, Head of Digital Transformation & IT Procurement Directors",
    idealCompanySize: "50 - 5,000 Headcount (Mid-Market & Scale-Up Enterprises)",
    locationDetails: {
      cityState: "Mumbai & Bengaluru, India",
      granularity: "Mumbai & Bengaluru, India (Target Buyer State / City Region)"
    },
    keyPainPoints: [
      "Shortage of skilled in-house developers & slow time-to-market for software products",
      "High cost of maintaining internal engineering teams without specialized cloud/AI expertise",
      "Modernizing legacy monolith IT applications to scalable cloud microservices"
    ],
    decisionMakerRoles: [
      "Chief Technology Officer (CTO)",
      "Vice President of Software Engineering",
      "Head of Product Development",
      "Director of IT Vendor Procurement & Outsourcing"
    ],
    valueProposition: "Providing dedicated developer pods, agile software engineering, and technical solution consultation to accelerate software delivery."
  },
  workflowSteps: [
    {
      step: 1,
      title: "Phase 1: Target Company Scraping & Intelligence",
      description: "Extracted live HTML, about snippet & DOM contacts for ocena.in. Address: Mumbai & Bengaluru, India",
      status: "completed",
      timestamp: new Date(Date.now() - 1200).toISOString()
    },
    {
      step: 2,
      title: "Phase 2: Local & Global Competitor Mining",
      description: "Discovered 5 tech consultancies (Persistent Systems, Thoughtworks, EPAM, Globant, Endava)",
      status: "completed",
      timestamp: new Date(Date.now() - 800).toISOString()
    },
    {
      step: 3,
      title: "Phase 3: Ideal Customer Profile (ICP) Synthesis",
      description: "Identified target buyer personas & decision-maker roles for Software Consultancies & Cloud Solutions",
      status: "completed",
      timestamp: new Date(Date.now() - 400).toISOString()
    },
    {
      step: 4,
      title: "Phase 4: Verified Decision Maker Lead Matching",
      description: "Synthesized verified CTO & engineering VP decision makers",
      status: "completed",
      timestamp: new Date().toISOString()
    }
  ],
  leads: [
    {
      id: "comp-target-ocena",
      name: "Ocena Tech & Consulting",
      domain: "ocena.in",
      website: "https://ocena.in",
      industry: "Services-Based Tech & Software Consultancy",
      subIndustry: "Custom Engineering, Cloud Solutions & Developer Outsourcing",
      location: "Mumbai & Bengaluru, India",
      description: "AI-powered software delivery consultancy engineering custom cloud microservices and developer pods.",
      techStack: ["Next.js", "Python AI/ML", "Node.js", "Kubernetes", "AWS"],
      emails: ["hello@ocena.in", "contact@ocena.in", "testing.ocena@gmail.com"],
      phoneNumbers: ["+91-22-6789-0123"],
      socialMedia: { linkedin: "https://linkedin.com/company/ocena-tech" },
      matchScore: 99,
      matchedReasoning: "Scraped Target Domain (ocena.in). AI-Powered Enterprise Cloud Solutions & Software Delivery Consultancy.",
      isTargetCompany: true,
      primaryContact: {
        id: "cnt-target-ocena-1",
        name: "Aditya Ocena",
        title: "Chief Technology Officer (CTO)",
        email: "testing.ocena@gmail.com",
        linkedin: "https://linkedin.com/in/adityaocena-cto",
        verified: true,
        score: 99
      }
    },
    {
      id: "comp-persistent-ocena",
      name: "Persistent Systems",
      domain: "persistent.com",
      website: "https://persistent.com",
      industry: "Services-Based Tech & Software Consultancy",
      subIndustry: "Digital Engineering & Enterprise Cloud Solutions",
      location: "Pune, Maharashtra, India",
      region: "India & South Asia",
      employeeCount: 23000,
      headcountRange: "1000+",
      fundingStage: "Public",
      fundingAmount: "Public",
      techStack: ["Java", "Node.js", "AWS", "Azure", "React"],
      hiringIntent: true,
      openRoles: ["VP of Digital Engineering", "Client Solutions Partner"],
      description: "Global services-based technology company providing software product engineering and custom IT solutions.",
      matchScore: 96,
      matchedReasoning: "Regional Tech Consultancy (Same Location - India): Direct competitor to ocena.in in software engineering.",
      primaryContact: {
        id: "cnt-ps-ocena-1",
        name: "Sandeep Kalra",
        title: "Chief Executive Officer & Executive Director",
        email: "sandeep_kalra@persistent.com",
        linkedin: "https://linkedin.com/in/sandeepkalra",
        verified: true,
        score: 99
      }
    },
    {
      id: "comp-thoughtworks-ocena",
      name: "Thoughtworks India",
      domain: "thoughtworks.com",
      website: "https://thoughtworks.com",
      industry: "Services-Based Tech & Software Consultancy",
      subIndustry: "Agile Development & Tech Strategy",
      location: "Bengaluru, Karnataka, India",
      region: "India & South Asia",
      employeeCount: 10500,
      headcountRange: "1000+",
      fundingStage: "Public",
      fundingAmount: "Public",
      techStack: ["Java", "Kotlin", "Go", "Kubernetes", "AWS"],
      hiringIntent: true,
      openRoles: ["Head of Enterprise Consulting"],
      description: "Global software consultancy providing dedicated developer teams and agile software delivery.",
      matchScore: 93,
      matchedReasoning: "Regional Tech Consultancy (India): Peer consultancy in developer teams & software delivery.",
      primaryContact: {
        id: "cnt-tw-ocena-1",
        name: "Guo Xiao",
        title: "Chief Executive Officer",
        email: "gxiao@thoughtworks.com",
        linkedin: "https://linkedin.com/in/guoxiao",
        verified: true,
        score: 98
      }
    }
  ],
  icpLeads: [
    {
      id: "icp-lead-ocena-0",
      name: "HealthTech ScaleUp Solutions",
      website: "https://healthtechscaleup.io",
      domain: "healthtechscaleup.io",
      industry: "Services-Based Tech & Software Consultancy",
      subIndustry: "Developer Outsourcing, IT Services & Solutions",
      location: "Austin, Texas, USA",
      region: "Austin, Texas, USA",
      employeeCount: 500,
      headcountRange: "201-1000",
      fundingStage: "Established Institution",
      fundingAmount: "N/A",
      investors: [],
      techStack: ["ERP", "Cloud Microservices", "Web Portal"],
      hiringIntent: true,
      openRoles: ["Chief Technology Officer (CTO)"],
      description: "HealthTech ScaleUp Solutions — Ideal customer account for ocena.in. Contact: Chief Technology Officer (CTO).",
      isIcpLead: true,
      matchScore: 97,
      matchedReasoning: "ICP Target Buyer: HealthTech ScaleUp Solutions matches ideal customer profile for ocena.in. Decision maker: Aditya Ocena (CTO).",
      contacts: [
        {
          id: "icp-cnt-ocena-0",
          name: "Aditya Ocena",
          title: "Chief Technology Officer (CTO)",
          email: "testing.ocena@gmail.com",
          linkedin: "https://linkedin.com/in/adityaocena-cto",
          verified: true,
          score: 97
        }
      ],
      primaryContact: {
        id: "icp-cnt-ocena-0",
        name: "Aditya Ocena",
        title: "Chief Technology Officer (CTO)",
        email: "testing.ocena@gmail.com",
        linkedin: "https://linkedin.com/in/adityaocena-cto",
        verified: true,
        score: 97
      },
      emails: ["testing.ocena@gmail.com"],
      phoneNumbers: ["+1 (512) 555-0198"],
      socialMedia: { linkedin: "https://linkedin.com/in/adityaocena-cto" }
    },
    {
      id: "icp-lead-ocena-1",
      name: "PayStream Financial Technologies",
      website: "https://paystreamtech.com",
      domain: "paystreamtech.com",
      industry: "Services-Based Tech & Software Consultancy",
      subIndustry: "Developer Outsourcing, IT Services & Solutions",
      location: "San Francisco, California, USA",
      region: "San Francisco, California, USA",
      employeeCount: 500,
      headcountRange: "201-1000",
      fundingStage: "Established Institution",
      fundingAmount: "N/A",
      investors: [],
      techStack: ["ERP", "Cloud Microservices", "Web Portal"],
      hiringIntent: true,
      openRoles: ["Vice President of Software Engineering"],
      description: "PayStream Financial Technologies — Ideal customer account for ocena.in. Contact: VP of Software Engineering.",
      isIcpLead: true,
      matchScore: 94,
      matchedReasoning: "ICP Target Buyer: PayStream matches ideal customer profile for ocena.in. Decision maker: Aditya Thakur (VP Software Eng).",
      contacts: [
        {
          id: "icp-cnt-ocena-1",
          name: "Aditya Thakur",
          title: "Vice President of Software Engineering",
          email: "testingaditya5@gmail.com",
          linkedin: "https://linkedin.com/in/adityathakur-vp",
          verified: true,
          score: 95
        }
      ],
      primaryContact: {
        id: "icp-cnt-ocena-1",
        name: "Aditya Thakur",
        title: "Vice President of Software Engineering",
        email: "testingaditya5@gmail.com",
        linkedin: "https://linkedin.com/in/adityathakur-vp",
        verified: true,
        score: 95
      },
      emails: ["testingaditya5@gmail.com"],
      phoneNumbers: ["+1 (415) 555-0842"],
      socialMedia: { linkedin: "https://linkedin.com/in/adityathakur-vp" }
    },
    {
      id: "icp-lead-ocena-2",
      name: "RetailCloud Global Enterprise",
      website: "https://retailcloudglobal.com",
      domain: "retailcloudglobal.com",
      industry: "Services-Based Tech & Software Consultancy",
      subIndustry: "Developer Outsourcing, IT Services & Solutions",
      location: "Chicago, Illinois, USA",
      region: "Chicago, Illinois, USA",
      employeeCount: 500,
      headcountRange: "201-1000",
      fundingStage: "Established Institution",
      fundingAmount: "N/A",
      investors: [],
      techStack: ["ERP", "Cloud Microservices"],
      hiringIntent: true,
      openRoles: ["Director of IT Vendor Procurement"],
      description: "RetailCloud — Ideal customer account for ocena.in. Contact: Aditya Thakur.",
      isIcpLead: true,
      matchScore: 91,
      matchedReasoning: "ICP Target Buyer: RetailCloud matches ideal customer profile for ocena.in. Decision maker: Aditya Thakur (Director of IT Procurement).",
      contacts: [
        {
          id: "icp-cnt-ocena-2",
          name: "Aditya Thakur",
          title: "Director of IT Vendor Procurement",
          email: "adityathakur19200@gmail.com",
          linkedin: "https://linkedin.com/in/adityathakur-procurement",
          verified: true,
          score: 93
        }
      ],
      primaryContact: {
        id: "icp-cnt-ocena-2",
        name: "Aditya Thakur",
        title: "Director of IT Vendor Procurement",
        email: "adityathakur19200@gmail.com",
        linkedin: "https://linkedin.com/in/adityathakur-procurement",
        verified: true,
        score: 93
      },
      emails: ["adityathakur19200@gmail.com"],
      phoneNumbers: ["+1 (312) 555-0371"],
      socialMedia: { linkedin: "https://linkedin.com/in/adityathakur-procurement" }
    }
  ]
};

async function seedTestCompanies(targetEmail = "aditya2.ocena@gmail.com") {
  try {
    const emailsToSeed = Array.from(new Set([
      targetEmail.toLowerCase().trim(),
      "aditya2.ocena@gmail.com",
      "testing.ocena@gmail.com",
      "testingaditya5@gmail.com",
      "adityathakur19200@gmail.com",
      ""
    ]));

    for (const email of emailsToSeed) {
      // 1. Seed Uniportal test search
      const uniportalExists = await SavedSearch.findOne({
        userEmail: email,
        siteDomain: "uniportal.co.in"
      });

      if (!uniportalExists) {
        const uniDoc = new SavedSearch({
          ...UNIPORTAL_TEST_DATA,
          userEmail: email
        });
        await uniDoc.save();
        console.log(`✅ Seeded Uniportal test company data in MongoDB for '${email || 'global'}' (${uniDoc._id})`);
      }

      // 2. Seed Ocena test search
      const ocenaExists = await SavedSearch.findOne({
        userEmail: email,
        siteDomain: "ocena.in"
      });

      if (!ocenaExists) {
        const ocenaDoc = new SavedSearch({
          ...OCENA_TEST_DATA,
          userEmail: email
        });
        await ocenaDoc.save();
        console.log(`✅ Seeded Ocena test company data in MongoDB for '${email || 'global'}' (${ocenaDoc._id})`);
      }
    }
  } catch (err) {
    console.error('⚠️ Error seeding test company data:', err.message);
  }
}

module.exports = {
  seedTestCompanies,
  UNIPORTAL_TEST_DATA,
  OCENA_TEST_DATA
};
