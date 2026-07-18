const pptxgen = require("pptxgenjs");

const pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.title = "Sameer Chavan Presentation";

// ─── PALETTE ───────────────────────────────────────────────────────────────
const C = {
    navy: "0D1B3E",   // dark bg
    indigo: "1A2E6B",   // section headers
    blue: "1E4DB7",   // accent
    skyBlue: "3B82F6",   // lighter accent
    lightBg: "F0F4FF",   // content slide bg
    white: "FFFFFF",
    offWhite: "F8FAFF",
    text: "1E293B",
    muted: "475569",
    gold: "F59E0B",
    green: "10B981",
    cardBg: "EEF2FF",
    divider: "C7D2FE",
};

// ─── HELPERS ───────────────────────────────────────────────────────────────
const makeShadow = () => ({ type: "outer", color: "000000", blur: 8, offset: 3, angle: 45, opacity: 0.12 });

function sectionDividerSlide(label, subtitle) {
    const s = pres.addSlide();
    s.background = { color: C.navy };

    // Big section tag
    s.addText(label, {
        x: 0, y: 1.8, w: 10, h: 0.6,
        align: "center", fontSize: 11, color: C.skyBlue,
        bold: true, charSpacing: 8, fontFace: "Calibri",
    });

    s.addText(subtitle, {
        x: 0.5, y: 2.5, w: 9, h: 1.5,
        align: "center", fontSize: 36, color: C.white,
        bold: true, fontFace: "Cambria",
    });

    // subtle decorative dots
    for (let i = 0; i < 5; i++) {
        s.addShape(pres.shapes.OVAL, {
            x: 1.5 + i * 1.5, y: 4.3, w: 0.1, h: 0.1,
            fill: { color: i === 2 ? C.skyBlue : C.indigo },
        });
    }
    return s;
}

function titleSlide(name, role, theme, optional) {
    const s = pres.addSlide();
    s.background = { color: C.navy };

    // top accent area
    s.addShape(pres.shapes.RECTANGLE, {
        x: 0, y: 0, w: 10, h: 1.5,
        fill: { color: C.indigo },
    });

    s.addText("SPEAKER PROFILE", {
        x: 0.5, y: 0.1, w: 9, h: 0.45,
        fontSize: 9, color: C.skyBlue, bold: true, charSpacing: 6, fontFace: "Calibri",
    });

    s.addText(name, {
        x: 0.5, y: 0.55, w: 9, h: 0.75,
        fontSize: 28, color: C.white, bold: true, fontFace: "Cambria",
    });

    // role pill
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
        x: 0.5, y: 1.65, w: 8.5, h: 0.5,
        fill: { color: C.blue }, rectRadius: 0.05,
    });
    s.addText(role, {
        x: 0.5, y: 1.65, w: 8.5, h: 0.5,
        fontSize: 12, color: C.white, align: "center", fontFace: "Calibri", margin: 0,
    });

    // theme card
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
        x: 0.5, y: 2.35, w: 9, h: 1.1,
        fill: { color: C.cardBg }, rectRadius: 0.1,
        shadow: makeShadow(),
    });
    s.addText("Theme", {
        x: 0.7, y: 2.42, w: 1.2, h: 0.3,
        fontSize: 8, color: C.skyBlue, bold: true, charSpacing: 4, fontFace: "Calibri",
    });
    s.addText(theme, {
        x: 0.7, y: 2.72, w: 8.4, h: 0.6,
        fontSize: 13, color: C.text, fontFace: "Calibri", bold: true,
    });

    if (optional) {
        s.addText(optional, {
            x: 0.5, y: 3.65, w: 9, h: 1.5,
            fontSize: 12, color: C.muted, fontFace: "Calibri", italic: true,
        });
    }
    return s;
}

function contentSlide(title, sections) {
    // sections: [{header, bullets: [{bold?, text}]}]
    const s = pres.addSlide();
    s.background = { color: C.offWhite };

    // Header bar
    s.addShape(pres.shapes.RECTANGLE, {
        x: 0, y: 0, w: 10, h: 1.1,
        fill: { color: C.indigo },
    });
    s.addText(title, {
        x: 0.4, y: 0.12, w: 9.2, h: 0.85,
        fontSize: 22, color: C.white, bold: true, fontFace: "Cambria", valign: "middle",
    });

    const colCount = sections.length <= 2 ? sections.length : sections.length;
    const totalW = 9.2;
    const gap = 0.25;
    const colW = (totalW - gap * (colCount - 1)) / colCount;

    sections.forEach((sec, i) => {
        const cx = 0.4 + i * (colW + gap);
        const cy = 1.25;

        // Card bg
        s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
            x: cx, y: cy, w: colW, h: 4.0,
            fill: { color: C.white }, rectRadius: 0.1,
            shadow: makeShadow(),
        });

        // Section header strip
        s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
            x: cx, y: cy, w: colW, h: 0.52,
            fill: { color: C.blue }, rectRadius: 0.1,
        });
        s.addText(sec.header, {
            x: cx + 0.1, y: cy, w: colW - 0.2, h: 0.52,
            fontSize: 11, color: C.white, bold: true, fontFace: "Calibri",
            valign: "middle", margin: 0,
        });

        // Bullets
        const bulletItems = sec.bullets.map((b, bi) => [
            {
                text: "▸  ",
                options: { color: C.blue, bold: true, fontSize: 11, breakLine: false },
            },
            {
                text: b.text,
                options: {
                    color: b.bold ? C.text : C.muted,
                    bold: !!b.bold,
                    fontSize: b.bold ? 12 : 11,
                    breakLine: bi < sec.bullets.length - 1,
                    fontFace: "Calibri",
                },
            },
        ]).flat();

        s.addText(bulletItems, {
            x: cx + 0.12, y: cy + 0.6, w: colW - 0.24, h: 3.3,
            fontFace: "Calibri", valign: "top", paraSpaceAfter: 6,
        });
    });

    return s;
}

function newsSlide(type, title, content1Label, content1Bullets, content2Label, content2Bullets, takeaway) {
    // type = "title" | "content"
}

// ───────────────────────────────────────────────────────────────────────────
//  SECTION DIVIDER: WE LOUNGE
// ───────────────────────────────────────────────────────────────────────────
sectionDividerSlide("SECTION 01  ·  WE LOUNGE", "Speaker Sessions & Leadership Insights");

// ─── MAHESH BAPAT ──────────────────────────────────────────────────────────

titleSlide(
    "Mahesh Bapat",
    "Managing Director, Thread Technology (India) Pvt. Ltd.",
    "From ₹3,000 to a Growing Industrial Textile Enterprise",
    "An inspiring entrepreneurial journey built on technical expertise, ethics, and a long-term vision to transform industrial textile manufacturing in India."
);

contentSlide("Mahesh Bapat — Entrepreneurial Journey & Business Insights", [
    {
        header: "Entrepreneurial Journey",
        bullets: [
            { bold: true, text: "Started with an initial capital of just ₹3,000 — a testament to vision over resources." },
            { text: "Acquired 5 years of hands-on industry experience before launching his own venture." },
            { text: "Established manufacturing units in Ahmednagar and Palghar to build regional manufacturing strength." },
            { bold: true, text: "Current production capacity of approximately 30 tons of industrial textiles per month." },
        ],
    },
    {
        header: "Industries Served & Strategic Vision",
        bullets: [
            { bold: true, text: "Key Industries: Defense · Automotive · Cement · Agriculture" },
            { text: "These sectors demand high-durability, specification-grade textiles — a high-barrier, specialized market." },
            { bold: true, text: "Target: Scale production to 100 tons per month." },
            { text: "Plans to expand into medical textiles — a fast-growing, compliance-heavy sector." },
            { bold: true, text: "Long-term goal: IPO valued at ₹300–400 crore." },
        ],
    },
]);

contentSlide("Mahesh Bapat — Leadership Lessons & My Takeaways", [
    {
        header: "Leadership Principles",
        bullets: [
            { bold: true, text: "Ethics and integrity are the non-negotiable foundation of any sustainable business." },
            { text: "Building strong relationships with customers and suppliers creates long-term trust and loyalty." },
            { text: "Continuous technology upgrades are essential to stay competitive in manufacturing." },
            { bold: true, text: "Detailed planning combined with disciplined execution is what separates growth companies from stagnant ones." },
        ],
    },
    {
        header: "Social Responsibility & My Takeaways",
        bullets: [
            { bold: true, text: "Adopted 100 schools as part of educational CSR initiatives." },
            { text: "Organised medical camps in the Konkan region, demonstrating that business success carries social obligation." },
            { bold: true, text: "A small investment can yield large achievements when backed by knowledge and perseverance." },
            { text: "Practical industry experience before starting a business is invaluable." },
            { text: "Ethical decision-making builds reputation — the true currency of long-term success." },
        ],
    },
]);

// ─── CHETAN INDAP ──────────────────────────────────────────────────────────

titleSlide(
    "Chetan Indap",
    "Founder & CEO, On Contract",
    "From Corporate Leadership to Startup Entrepreneurship",
    "A powerful journey of unlearning, resilience, and building a scalable technology-driven business in India's largely unorganised staffing industry."
);

contentSlide("Chetan Indap — Entrepreneurial Journey & Business Strategy", [
    {
        header: "Professional Background",
        bullets: [
            { bold: true, text: "18+ years of experience with marquee organisations including CK Birla Group and L&T Infotech." },
            { text: "Rose to become Country Head for UK & Europe at age 34 — a rare achievement in a corporate career." },
            { bold: true, text: "Made the bold transition from a stable senior corporate role to building a startup from zero." },
        ],
    },
    {
        header: "Business Idea, Funding & Growth",
        bullets: [
            { bold: true, text: "Founded On Contract — an online marketplace for contract staffing solutions." },
            { text: "Created to address deep inefficiencies in India's largely unorganised staffing industry." },
            { text: "Rebranded from 'Staff on Contract' to 'On Contract' to widen scope beyond staffing to any contract-based service." },
            { bold: true, text: "Secured investment after 7–8 months of continuous pitching." },
            { text: "Backed by marquee investors including Ronnie Screwvala and Vishal Gondal." },
            { text: "Focused on SMEs, which are the backbone of India's economy and require flexible workforce solutions." },
        ],
    },
]);

contentSlide("Chetan Indap — Leadership Lessons & My Takeaways", [
    {
        header: "Key Leadership Insights",
        bullets: [
            { bold: true, text: "Unlearn, Learn, Relearn — growth demands letting go of old habits and adapting continuously to new realities." },
            { text: "Focus energy on the 20% early adopters rather than being discouraged by the 80% who reject you." },
            { bold: true, text: "Build businesses with scalability and flexibility embedded from day one." },
            { text: "Treat the business model as a work in progress and maintain willingness to pivot." },
        ],
    },
    {
        header: "Personal Lessons & Memorable Advice",
        bullets: [
            { bold: true, text: "Entrepreneurship demands both conviction and emotional resilience in equal measure." },
            { text: "A strong support system — family, mentors, co-founders — is crucial during periods of uncertainty." },
            { text: "Success often comes only after persistence through repeated rejection." },
            { bold: true, text: "Practical knowledge and execution matter far more than waiting for the perfect moment." },
            { bold: true, text: "\"Start now. Believe in yourself. Be shameless.\"" },
        ],
    },
]);

// ─── AMISHA VORA ───────────────────────────────────────────────────────────

titleSlide(
    "Amisha Vora",
    "Chairperson & Managing Director, PL Capital Group",
    "Leading an 80-Year Financial Legacy with Innovation, Trust and Vision",
    "A remarkable journey from a Research Analyst earning ₹1,800 per month to leading one of India's most respected financial services groups."
);

contentSlide("Amisha Vora — Career Journey & Strategic Insights", [
    {
        header: "Professional Journey",
        bullets: [
            { bold: true, text: "Chartered Accountant and Gold Medalist with 30+ years of experience in financial services." },
            { text: "Started her career as a Research Analyst at JM Financial on a salary of ₹1,800 per month." },
            { bold: true, text: "Took ownership and leadership of PL Capital Group, now serving 1.5 lakh+ clients with a team of 600+ professionals." },
        ],
    },
    {
        header: "Organisation & Forward Strategy",
        bullets: [
            { bold: true, text: "PL Capital Group traces its legacy to 1944 — an 80+ year heritage in Indian capital markets." },
            { text: "Expanded into investment banking, wealth management, institutional broking, and funds management." },
            { bold: true, text: "Business reportedly grew nearly 100× in five years through focused sector conferences and strategic expansion." },
            { text: "Embracing Quant Investing and AI-driven research as the next frontier." },
            { text: "Achieved 76% return in the first year of a quant-based PMS strategy." },
            { bold: true, text: "Strong belief that 2020–2030 is India's Golden Decade for financial services growth." },
        ],
    },
]);

contentSlide("Amisha Vora — Leadership Philosophy & My Takeaways", [
    {
        header: "Leadership Philosophy",
        bullets: [
            { bold: true, text: "Build trust through Transparency, Truthfulness and Integrity (TTI) — the three pillars of her leadership." },
            { text: "Lead by example rather than micromanaging — empowerment over control." },
            { bold: true, text: "Remove organisational bottlenecks caused by what she calls 'the cholesterol of ego'." },
            { text: "Treat compliance as a strategic advantage, not a regulatory burden." },
            { bold: true, text: "Memorable: 'Shortcut is the longest cut in life.' | 'Do not let fear sacrifice your dreams.'" },
        ],
    },
    {
        header: "My Key Takeaways",
        bullets: [
            { bold: true, text: "Strong technical knowledge, especially financial analysis, creates durable competitive advantage." },
            { text: "Positive attitude and courage are essential for making major career decisions." },
            { text: "Continuous learning and technological adaptation are not optional in a changing industry." },
            { bold: true, text: "Ethical leadership and client trust are the true, long-lasting foundations of business success." },
        ],
    },
]);

// ───────────────────────────────────────────────────────────────────────────
//  SECTION DIVIDER: WE TUBE
// ───────────────────────────────────────────────────────────────────────────
sectionDividerSlide("SECTION 02  ·  WE TUBE", "Video Learning & Academic Concepts");

// ─── MICROFINANCE ──────────────────────────────────────────────────────────

{
    const s = pres.addSlide();
    s.background = { color: C.navy };
    s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 1.5, fill: { color: C.indigo } });
    s.addText("WE TUBE", { x: 0.5, y: 0.1, w: 9, h: 0.4, fontSize: 9, color: C.skyBlue, bold: true, charSpacing: 6, fontFace: "Calibri" });
    s.addText("The Basics of Micro Finance", { x: 0.5, y: 0.52, w: 9, h: 0.85, fontSize: 26, color: C.white, bold: true, fontFace: "Cambria" });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 1.65, w: 9, h: 0.55, fill: { color: C.blue }, rectRadius: 0.05 });
    s.addText("Financial Inclusion Through Small Loans and Social Trust", { x: 0.5, y: 1.65, w: 9, h: 0.55, fontSize: 13, color: C.white, align: "center", fontFace: "Calibri", margin: 0 });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 2.35, w: 9, h: 2.9, fill: { color: C.cardBg }, rectRadius: 0.12, shadow: makeShadow() });
    s.addText("Microfinance provides collateral-free financial services to low-income individuals and communities. It operates on the principle that the poor can be reliable borrowers when given the right support structure. By leveraging social trust and group accountability, microfinance converts financial assistance into a sustainable and scalable business model that simultaneously creates social impact.\n\nIt is a powerful tool for financial inclusion and Base of the Pyramid strategies, demonstrating that innovative credit assessment and risk management can empower millions while maintaining commercial viability.",
        { x: 0.7, y: 2.5, w: 8.6, h: 2.6, fontSize: 12, color: C.text, fontFace: "Calibri", valign: "top", paraSpaceAfter: 6 });
}

contentSlide("Microfinance — Key Concepts and Success Factors", [
    {
        header: "Core Features of Microfinance",
        bullets: [
            { bold: true, text: "Provides small loans to people who lack access to traditional banking systems." },
            { text: "Loans are given without physical collateral or security — a fundamental departure from conventional banking." },
            { bold: true, text: "Borrowers form groups of 5–6 members who act as mutual guarantors for each other." },
            { text: "Repayment rates are exceptionally high, often reaching 97% — proving the poor are creditworthy." },
            { bold: true, text: "Pioneer: Grameen Bank | India Example: SKS Microfinance" },
            { text: "Women are the primary beneficiaries, leading to improvements in education, health, and family income." },
        ],
    },
    {
        header: "Key Learnings & Business Applications",
        bullets: [
            { bold: true, text: "Group accountability can effectively replace traditional collateral — a revolutionary insight." },
            { text: "Social enterprises can achieve both profitability and meaningful social impact simultaneously." },
            { bold: true, text: "Useful model for financial inclusion and Base of the Pyramid (BoP) strategies." },
            { text: "Demonstrates innovative approaches to credit assessment and risk management in underserved markets." },
            { bold: true, text: "My Takeaway: Trust, community support, and thoughtful design empower people economically while creating long-term social value." },
        ],
    },
]);

// ─── FUNDAMENTALS OF FINANCE ───────────────────────────────────────────────

{
    const s = pres.addSlide();
    s.background = { color: C.navy };
    s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 1.5, fill: { color: C.indigo } });
    s.addText("WE TUBE", { x: 0.5, y: 0.1, w: 9, h: 0.4, fontSize: 9, color: C.skyBlue, bold: true, charSpacing: 6, fontFace: "Calibri" });
    s.addText("Fundamentals of Finance for Recording Business Transactions", { x: 0.5, y: 0.5, w: 9, h: 0.9, fontSize: 22, color: C.white, bold: true, fontFace: "Cambria" });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 1.65, w: 9, h: 0.55, fill: { color: C.blue }, rectRadius: 0.05 });
    s.addText("Understanding How Every Business Transaction is Recorded Systematically", { x: 0.5, y: 1.65, w: 9, h: 0.55, fontSize: 12, color: C.white, align: "center", fontFace: "Calibri", margin: 0 });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 2.35, w: 9, h: 2.9, fill: { color: C.cardBg }, rectRadius: 0.12, shadow: makeShadow() });
    s.addText("Accounting is the systematic process of recording, classifying, and summarising business transactions. Every transaction is supported by source documents such as vouchers, invoices, and receipts, and the objective is to prepare financial statements like the Profit & Loss Account and Balance Sheet.\n\nThe Dual Effect Concept is foundational: every transaction affects at least two accounts, and total debits always equal total credits. This forms the bedrock of the double-entry accounting system, the language of all modern business.",
        { x: 0.7, y: 2.5, w: 8.6, h: 2.6, fontSize: 12, color: C.text, fontFace: "Calibri", valign: "top", paraSpaceAfter: 6 });
}

contentSlide("Fundamentals of Finance — Types of Accounts & Key Learnings", [
    {
        header: "Types of Accounts & Golden Rules",
        bullets: [
            { bold: true, text: "Personal Accounts — Individuals, companies, debtors, and creditors." },
            { bold: true, text: "Real Accounts — Assets: cash, machinery, patents, and goodwill." },
            { bold: true, text: "Nominal Accounts — Expenses, incomes, gains, and losses." },
            { text: "Golden Rule 1: Debit the Receiver, Credit the Giver (Personal A/c)." },
            { text: "Golden Rule 2: Debit What Comes In, Credit What Goes Out (Real A/c)." },
            { text: "Golden Rule 3: Debit Expenses & Losses, Credit Incomes & Gains (Nominal A/c)." },
            { bold: true, text: "The business is treated as a separate entity from its owner." },
        ],
    },
    {
        header: "Key Learnings & My Takeaway",
        bullets: [
            { bold: true, text: "Accounting is the language of business — it converts transactions into meaningful financial information." },
            { text: "Every financial entry must be backed by verifiable source evidence." },
            { bold: true, text: "Intangible assets like trademarks and goodwill are real, valuable business resources." },
            { text: "Understanding debit and credit is essential for reading and interpreting financial statements." },
            { text: "Forms the foundation for accounting software like TallyPrime and supports budgeting, auditing, and taxation." },
            { bold: true, text: "My Takeaway: This topic revealed the logic behind accounting entries and how raw financial data becomes decision-making intelligence." },
        ],
    },
]);

// ─── WORKING CAPITAL ───────────────────────────────────────────────────────

{
    const s = pres.addSlide();
    s.background = { color: C.navy };
    s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 1.5, fill: { color: C.indigo } });
    s.addText("WE TUBE", { x: 0.5, y: 0.1, w: 9, h: 0.4, fontSize: 9, color: C.skyBlue, bold: true, charSpacing: 6, fontFace: "Calibri" });
    s.addText("Mastering Working Capital Management", { x: 0.5, y: 0.52, w: 9, h: 0.85, fontSize: 26, color: C.white, bold: true, fontFace: "Cambria" });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 1.65, w: 9, h: 0.55, fill: { color: C.blue }, rectRadius: 0.05 });
    s.addText("Fueling Business Success Through Effective Cash Flow Management", { x: 0.5, y: 1.65, w: 9, h: 0.55, fontSize: 13, color: C.white, align: "center", fontFace: "Calibri", margin: 0 });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 2.35, w: 9, h: 2.9, fill: { color: C.cardBg }, rectRadius: 0.12, shadow: makeShadow() });
    s.addText("Working Capital = Current Assets – Current Liabilities. It represents the funds available to manage day-to-day business operations and is often called the financial 'lifeblood' of a business.\n\nTypes include Permanent Working Capital (minimum required throughout the year), Temporary Working Capital (additional funds for seasonal peaks), and Reserve Working Capital (an emergency buffer). Effective management ensures liquidity, operational stability, and provides flexibility to capture growth opportunities.",
        { x: 0.7, y: 2.5, w: 8.6, h: 2.6, fontSize: 12, color: C.text, fontFace: "Calibri", valign: "top", paraSpaceAfter: 6 });
}

contentSlide("Working Capital Management — Key Drivers & Learnings", [
    {
        header: "Cash Conversion Cycle & Key Metrics",
        bullets: [
            { bold: true, text: "Cash Conversion Cycle: measures the time to convert inventory and receivables back into cash." },
            { text: "A lower cycle time improves liquidity and reduces borrowing needs." },
            { bold: true, text: "Days Sales Outstanding (DSO): tracks customer collection efficiency — a critical KPI." },
            { text: "Poor planning can lead to 20–30% inventory obsolescence, destroying working capital silently." },
            { text: "Delayed invoicing directly slows cash inflows — discipline in billing is non-negotiable." },
        ],
    },
    {
        header: "Improvement Strategies & My Takeaway",
        bullets: [
            { bold: true, text: "Offer 1–2% early payment discounts to accelerate customer payments." },
            { text: "Negotiate 60–90 day credit terms with suppliers to extend the payable window." },
            { text: "Use inventory techniques such as JIT (Just-in-Time) and DDMRP for lean operations." },
            { bold: true, text: "Automation and AI improve cash forecasting and real-time liquidity monitoring." },
            { bold: true, text: "My Takeaway: Efficient working capital management can enhance enterprise value by up to 50% through better cash flow and financial discipline." },
        ],
    },
]);

// ─── BANK ANALYSIS ─────────────────────────────────────────────────────────

{
    const s = pres.addSlide();
    s.background = { color: C.navy };
    s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 1.5, fill: { color: C.indigo } });
    s.addText("WE TUBE", { x: 0.5, y: 0.1, w: 9, h: 0.4, fontSize: 9, color: C.skyBlue, bold: true, charSpacing: 6, fontFace: "Calibri" });
    s.addText("How to Analyse Financial Institutions and Banks", { x: 0.5, y: 0.52, w: 9, h: 0.85, fontSize: 24, color: C.white, bold: true, fontFace: "Cambria" });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 1.65, w: 9, h: 0.55, fill: { color: C.blue }, rectRadius: 0.05 });
    s.addText("Understanding the Financial Structure and Risk Profile of Banks", { x: 0.5, y: 1.65, w: 9, h: 0.55, fontSize: 13, color: C.white, align: "center", fontFace: "Calibri", margin: 0 });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 2.35, w: 9, h: 2.9, fill: { color: C.cardBg }, rectRadius: 0.12, shadow: makeShadow() });
    s.addText("Bank analysis differs fundamentally from analysing other businesses because banks deal primarily in money — deposits, loans, and investments — rather than physical assets. Fixed assets such as buildings and equipment typically account for less than 1% of total assets.\n\nBanks borrow through deposits and lend to individuals and businesses, generating profit from Net Interest Income (NII) — the spread between interest earned and interest paid. A key challenge is managing the maturity gap between short-term deposits and long-term loans.",
        { x: 0.7, y: 2.5, w: 8.6, h: 2.6, fontSize: 12, color: C.text, fontFace: "Calibri", valign: "top", paraSpaceAfter: 6 });
}

contentSlide("Bank Analysis — Key Concepts & Learnings", [
    {
        header: "Key Risk Indicators & Regulatory Framework",
        bullets: [
            { bold: true, text: "Liquidity Mismatch: funding long-term loans with short-term deposits — a structural vulnerability." },
            { bold: true, text: "Loan Loss Provisions: reserves created to absorb potential loan defaults." },
            { text: "Contingent Liabilities: off-balance-sheet items such as guarantees and letters of credit." },
            { text: "Systemic Risk: bank failures can destabilise the broader economy and erode public confidence." },
            { bold: true, text: "In India, banks are primarily regulated by the Reserve Bank of India (RBI)." },
        ],
    },
    {
        header: "Key Learnings & My Takeaway",
        bullets: [
            { bold: true, text: "Analyse banks with an economy-first approach — banks are exposed to every sector simultaneously." },
            { text: "Asset quality and provisioning levels are the most critical indicators of a bank's financial health." },
            { bold: true, text: "Public trust and prudent risk management are the true foundation of banking success." },
            { text: "Helps compare institutions like HDFC Bank, ICICI Bank, and State Bank of India with analytical rigour." },
            { bold: true, text: "My Takeaway: Bank analysis goes beyond profitability — it requires understanding regulation, liquidity, and the institution's ability to protect public deposits." },
        ],
    },
]);

// ─── AUDITING ──────────────────────────────────────────────────────────────

{
    const s = pres.addSlide();
    s.background = { color: C.navy };
    s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 1.5, fill: { color: C.indigo } });
    s.addText("WE TUBE", { x: 0.5, y: 0.1, w: 9, h: 0.4, fontSize: 9, color: C.skyBlue, bold: true, charSpacing: 6, fontFace: "Calibri" });
    s.addText("Auditing and Assurance Standards: An Overview", { x: 0.5, y: 0.52, w: 9, h: 0.85, fontSize: 24, color: C.white, bold: true, fontFace: "Cambria" });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 1.65, w: 9, h: 0.55, fill: { color: C.blue }, rectRadius: 0.05 });
    s.addText("Ensuring Transparency, Reliability and Trust in Financial Reporting", { x: 0.5, y: 1.65, w: 9, h: 0.55, fontSize: 13, color: C.white, align: "center", fontFace: "Calibri", margin: 0 });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 2.35, w: 9, h: 2.9, fill: { color: C.cardBg }, rectRadius: 0.12, shadow: makeShadow() });
    s.addText("Auditing provides an independent opinion on whether financial statements present a true and fair view. It offers reasonable assurance that reports are free from material misstatements and strengthens investor confidence and corporate credibility.\n\nIndian auditing standards are aligned with international standards through the Clarity Project. Major scandals such as Enron and WorldCom led to significantly stricter global regulations, establishing modern risk-based auditing as the standard approach.",
        { x: 0.7, y: 2.5, w: 8.6, h: 2.6, fontSize: 12, color: C.text, fontFace: "Calibri", valign: "top", paraSpaceAfter: 6 });
}

contentSlide("Auditing & Assurance — Key Concepts & Learnings", [
    {
        header: "Core Audit Principles & Fraud Framework",
        bullets: [
            { bold: true, text: "Professional Skepticism: maintaining a questioning mindset at all times to detect errors and fraud." },
            { text: "Materiality: focusing audit effort on errors significant enough to influence user decisions." },
            { bold: true, text: "Engagement Letter: formally defines audit scope, responsibilities, and fees before work begins." },
            { text: "Audit Documentation: working papers that provide evidence supporting the auditor's conclusions." },
            { bold: true, text: "Fraud Triangle: Pressure + Opportunity + Rationalisation — strong internal controls reduce all three." },
        ],
    },
    {
        header: "Key Learnings & My Takeaway",
        bullets: [
            { bold: true, text: "Management prepares financial statements; auditors independently verify them — a critical separation." },
            { text: "Ethics, confidentiality, and objectivity are non-negotiable pillars of audit quality." },
            { bold: true, text: "Modern auditing follows a risk-based approach tailored to each client's specific business environment." },
            { text: "Helps organisations improve internal controls, compliance posture, and reduce reputational risk." },
            { bold: true, text: "My Takeaway: Auditing is far more than checking numbers — it is a disciplined process that combines ethics, analysis, and professional judgment to build trust in financial reporting." },
        ],
    },
]);

// ───────────────────────────────────────────────────────────────────────────
//  SECTION DIVIDER: NEWSWIRE
// ───────────────────────────────────────────────────────────────────────────
sectionDividerSlide("SECTION 03  ·  NEWSWIRE", "Current Affairs, Business News & Market Insights");

// ─── NEWS HELPER ───────────────────────────────────────────────────────────
function newsTitle(headline, subhead) {
    const s = pres.addSlide();
    s.background = { color: C.navy };
    s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 1.5, fill: { color: C.indigo } });
    s.addText("NEWSWIRE", { x: 0.5, y: 0.12, w: 9, h: 0.4, fontSize: 9, color: C.gold, bold: true, charSpacing: 8, fontFace: "Calibri" });
    s.addText(headline, { x: 0.5, y: 0.52, w: 9, h: 0.85, fontSize: 20, color: C.white, bold: true, fontFace: "Cambria" });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 1.65, w: 9, h: 0.55, fill: { color: "B45309" }, rectRadius: 0.05 });
    s.addText(subhead, { x: 0.5, y: 1.65, w: 9, h: 0.55, fontSize: 12, color: C.white, align: "center", fontFace: "Calibri", margin: 0 });
    return s;
}

function newsContent(title, col1, col2) {
    return contentSlide(title, [col1, col2]);
}

// ─── STORY 1: PE OFFICE ASSETS ─────────────────────────────────────────────

newsTitle(
    "Office Assets Anchor Institutional Confidence",
    "Private Equity Investments Rise Sharply in Q1 2026"
);

newsContent("PE Investments — News Summary & Business Impact", {
    header: "Investment Highlights & Geography",
    bullets: [
        { bold: true, text: "Private equity inflows into Indian real estate: $637 million across 9 transactions in Q1 2026." },
        { bold: true, text: "A 2.1× increase compared to $300 million in Q1 2025 — a dramatic acceleration." },
        { text: "Office assets attracted $529 million (83% of total); residential contributed $108 million (17%)." },
        { bold: true, text: "NCR led with $411 million (65%); Pune followed with $203 million (32%)." },
        { text: "Domestic investors contributed $510 million, representing 80% of total capital deployed." },
    ],
}, {
    header: "Strategic Implications & My Takeaway",
    bullets: [
        { bold: true, text: "Investors preferred leased and near-stabilised office assets offering predictable rental income." },
        { text: "Equity-based office deals indicate strong confidence in commercial real estate fundamentals." },
        { bold: true, text: "Residential investments were largely debt-funded, reflecting a more cautious, downside-protected approach." },
        { text: "Domestic capital is becoming a major force in India's institutional investment landscape." },
        { text: "Geographic concentration highlights the importance of selecting high-growth regional markets." },
        { bold: true, text: "My Takeaway: Investors balance risk and return by focusing on income-generating assets — consistent cash flow matters more than speculative gains." },
    ],
});

// ─── STORY 2: WIPRO HYDRAULICS ─────────────────────────────────────────────

newsTitle(
    "Wipro Hydraulics Acquires Majority Stake in Indeco Ind Spa",
    "Strategic Expansion into Global Hydraulic Attachments Market"
);

newsContent("Wipro–Indeco Acquisition — News Summary & Business Impact", {
    header: "Transaction Highlights",
    bullets: [
        { bold: true, text: "Wipro Infrastructure Engineering, via its Wipro Hydraulics division, signed to acquire a majority stake in Indeco Ind Spa." },
        { text: "Expands Wipro from hydraulic cylinders into high-value hydraulic attachments: hammers, shears, and mulching heads." },
        { bold: true, text: "Indeco was founded in 1976 and operates 8 manufacturing facilities — 7 in Italy and 1 in the United States." },
        { text: "Combines two engineering businesses each with nearly 50 years of industry experience." },
        { text: "The Vitulano family will continue participating in operations, ensuring business and cultural continuity." },
    ],
}, {
    header: "Business Impact & My Takeaway",
    bullets: [
        { bold: true, text: "Broadens Wipro's product portfolio into high-value hydraulic attachments for global markets." },
        { text: "Accelerates global expansion into Europe and North America without building new facilities from scratch." },
        { bold: true, text: "Enhances R&D capabilities through combined technical expertise of both organisations." },
        { text: "Demonstrates the value of inorganic growth — how companies can diversify into adjacent markets using existing competencies." },
        { text: "Retaining founders helps preserve culture, innovation, and customer relationships through the transition." },
        { bold: true, text: "My Takeaway: A well-planned M&A strategy can rapidly expand market reach, strengthen capabilities, and position a company for long-term global growth." },
    ],
});

// ─── STORY 3: HDFC BANK ────────────────────────────────────────────────────

newsTitle(
    "HDFC Bank to Invest ₹1,000 Crore in HDFC Life",
    "Capital Infusion to Strengthen Solvency and Support Future Growth"
);

newsContent("HDFC Bank–HDFC Life — News Summary & Business Impact", {
    header: "Transaction & Solvency Details",
    bullets: [
        { bold: true, text: "HDFC Bank announced a ₹1,000 crore investment in HDFC Life Insurance via preferential allotment of shares." },
        { text: "HDFC Life will issue 1.45 crore equity shares at ₹688.52 per share." },
        { bold: true, text: "HDFC Bank's shareholding will increase from 50.21% to 50.54%, reinforcing majority control." },
        { text: "Solvency ratio had declined from 194% to 177% over the past year." },
        { bold: true, text: "The infusion is expected to raise the solvency ratio to approximately 186% — well above the regulatory minimum of 150%." },
    ],
}, {
    header: "Strategic Importance & My Takeaway",
    bullets: [
        { bold: true, text: "Provides capital to support business expansion and future policy growth at HDFC Life." },
        { text: "Prepares HDFC Life for the upcoming Risk-Based Capital (RBC) regulatory framework." },
        { bold: true, text: "Strong companies raise capital proactively rather than waiting for regulatory pressure to force their hand." },
        { text: "A healthy capital buffer improves both financial stability and investor confidence." },
        { text: "Parent companies play a crucial role in supporting subsidiary growth in critical capital-intensive phases." },
        { bold: true, text: "My Takeaway: Proactive capital management and early regulatory preparedness keep financial institutions stable, competitive, and well-positioned for long-term growth." },
    ],
});

// ─── STORY 4: RBI REMITTANCE ───────────────────────────────────────────────

newsTitle(
    "RBI's Outward Remittance Easing May Boost Fintech Partnerships",
    "Regulatory Reform to Accelerate Cross-Border Digital Payments"
);

newsContent("RBI Remittance Reform — News Summary & Business Impact", {
    header: "Key Regulatory Change",
    bullets: [
        { bold: true, text: "RBI removed the requirement for prior approval for partnerships between Authorised Dealer (AD) banks and fintech platforms." },
        { text: "Enables faster launch of digital outward remittance services for education, travel, freelancer payouts, and SME transactions." },
        { bold: true, text: "Replaces the restrictive 2016 framework that significantly slowed fintech onboarding with banks." },
        { text: "Banks remain fully responsible for compliance with FEMA, KYC, and Anti-Money Laundering (AML) regulations." },
        { text: "Platforms must clearly disclose forex rates, charges, and settlement timelines to customers." },
        { bold: true, text: "Benefits companies such as BookMyForex, Niyo, and Skydo." },
    ],
}, {
    header: "Business Impact & My Takeaway",
    bullets: [
        { bold: true, text: "Reduces regulatory friction and dramatically speeds up bank–fintech partnership launches." },
        { text: "Creates more competition, leading to lower fees and a better customer experience across the board." },
        { bold: true, text: "Helps SMEs and startups access efficient, cost-effective cross-border payment solutions." },
        { text: "Compliance responsibility remaining with regulated banks increases accountability and trust." },
        { text: "Transparency and customer protection are becoming major competitive differentiators in fintech." },
        { bold: true, text: "My Takeaway: Regulatory reform can unlock innovation while maintaining accountability — successful partnerships require both speed and rigorous compliance standards." },
    ],
});

// ─── STORY 5: AIR INDIA ────────────────────────────────────────────────────

newsTitle(
    "Tata Sons and Singapore Airlines Plan Funding Roadmap for Air India",
    "Strategic Response to Rising Losses and Leadership Transition"
);

newsContent("Air India Turnaround — News Summary & Business Impact", {
    header: "Key Developments & Current Challenges",
    bullets: [
        { bold: true, text: "Tata Sons and Singapore Airlines are discussing a new funding plan for Air India." },
        { text: "Air India's projected net loss for FY26 is expected to exceed ₹20,000 crore, vs. ₹9,568 crore in FY25." },
        { bold: true, text: "The partners have already invested ₹9,500 crore to support the airline's transformation journey." },
        { text: "Singapore Airlines holds a 25.1% stake in Air India." },
        { text: "Rising jet fuel prices and airspace disruptions due to conflicts in West Asia are adding pressure." },
        { bold: true, text: "Search is underway for a new CEO following the resignation of Campbell Wilson." },
        { text: "Intense competition from IndiGo, which controls over 60% of the domestic market." },
    ],
}, {
    header: "Business Impact & My Takeaway",
    bullets: [
        { bold: true, text: "Additional funding is essential to sustain Air India's turnaround and fleet expansion plans." },
        { text: "The Tata–SIA partnership combines financial strength with global aviation expertise." },
        { bold: true, text: "Air India's success is strategically vital for India's ambition to become a major global aviation hub." },
        { text: "Large-scale turnarounds require patience, disciplined execution, and significant ongoing capital support." },
        { text: "Leadership continuity is absolutely critical during periods of organisational transformation." },
        { bold: true, text: "My Takeaway: Rebuilding a legacy business demands long-term commitment, strong partnerships, and the ability to manage both operational challenges and external shocks simultaneously." },
    ],
});

// ─── STORY 6: PE OFFICE ASSETS (REPEAT/DETAILED) ──────────────────────────

newsTitle(
    "Private Equity Funds Increase Office Asset Investments in Q1 2026",
    "Growing Preference for Predictable Returns in Commercial Real Estate"
);

newsContent("PE Office Assets — Detailed Analysis & Implications", {
    header: "Investment Highlights & Market Trends",
    bullets: [
        { bold: true, text: "PE investment in Indian real estate: $637 million in Q1 2026 — a 2.1× increase over Q1 2025." },
        { text: "Office assets attracted $529 million (83% of total); all major office transactions involved leased or near-stabilised properties." },
        { bold: true, text: "Residential real estate received $108 million (17%), with most deals structured as debt." },
        { text: "Investors preferred equity investments in office assets due to higher confidence in long-term cash flows." },
        { text: "Structured credit was used in residential projects to reduce downside risk exposure." },
        { bold: true, text: "The trend confirms increasing institutional confidence in India's commercial leasing market." },
    ],
}, {
    header: "Business Impact & My Takeaway",
    bullets: [
        { bold: true, text: "Developers are pivoting toward leasing and asset stabilisation to attract institutional capital." },
        { text: "Commercial properties are being increasingly managed professionally under PE ownership." },
        { bold: true, text: "Predictable cash flows are being valued more than speculative development gains in the current environment." },
        { text: "In uncertain markets, investors consistently prioritise stable and income-generating assets." },
        { text: "Deal structure reveals risk appetite: equity signals confidence, debt signals protection-seeking." },
        { bold: true, text: "My Takeaway: Consistent cash flow and lower execution risk often matter more than aggressive growth opportunities in professional institutional investing." },
    ],
});

// ─── STORY 7: NDR INVIT ────────────────────────────────────────────────────

newsTitle(
    "NDR InvIT Acquires Grade-A Warehousing Assets",
    "₹260 Crore Investment to Expand Logistics Presence in South India"
);

newsContent("NDR InvIT Acquisition — News Summary & Business Impact", {
    header: "Acquisition Highlights",
    bullets: [
        { bold: true, text: "NDR InvIT Trust acquired two Grade-A warehousing assets in Kochi and Coimbatore for approximately ₹260 crore." },
        { text: "The acquisition adds 0.79 million sq. ft. of leasable area to the portfolio." },
        { bold: true, text: "Total operating portfolio increased to 22.96 million sq. ft. across 18 cities." },
        { text: "Assets are fully occupied with a Weighted Average Lease Expiry (WALE) of 5.2 years." },
        { bold: true, text: "Marks NDR InvIT's entry into Kochi and strengthens its presence in Coimbatore." },
        { text: "Targets rising demand from e-commerce and third-party logistics (3PL) companies." },
        { text: "Transaction was funded through a mix of cash and unit swap — efficient capital deployment." },
    ],
}, {
    header: "Business Impact & My Takeaway",
    bullets: [
        { bold: true, text: "Generates stable and predictable rental income through long-term Grade-A leases." },
        { text: "Expands NDR InvIT's pan-India logistics footprint and improves portfolio diversification." },
        { bold: true, text: "Grade-A assets attract high-quality tenants and significantly reduce operational risk." },
        { text: "WALE is a key indicator of income visibility and overall portfolio stability for InvIT investors." },
        { text: "Combining cash with unit swaps enables efficient, non-dilutive capital deployment." },
        { bold: true, text: "My Takeaway: Infrastructure-focused investment vehicles use strategic acquisitions, high-quality assets, and long-term leases to create sustainable, compounding value for investors." },
    ],
});

// ─── STORY 8: ADITYA BIRLA HOUSING FINANCE ────────────────────────────────

newsTitle(
    "Aditya Birla Housing Finance Raises ₹2,750 Crore",
    "Stake Sale to Advent International's Indriya Ltd to Fund Growth"
);

newsContent("ABHFL Capital Raise — News Summary & Business Impact", {
    header: "Transaction Highlights & Post-Deal Position",
    bullets: [
        { bold: true, text: "Aditya Birla Housing Finance raised ₹2,750 crore by selling a 14.29% stake to Indriya Ltd." },
        { text: "Executed through a preferential issue of 12.32 crore shares at ₹223.12 per share." },
        { bold: true, text: "Advent International becomes a strategic investor in the company through Indriya Ltd." },
        { text: "Aditya Birla Capital Limited continues as majority shareholder with an 85.505% stake." },
        { bold: true, text: "ABHFL reported ₹2,655 crore revenue and a ₹3,783 crore net worth in FY25." },
    ],
}, {
    header: "Business Impact & My Takeaway",
    bullets: [
        { bold: true, text: "Provides substantial growth capital to scale lending operations and increase housing finance market share." },
        { text: "Brings global private equity expertise and strategic advisory support from Advent International." },
        { bold: true, text: "Unlocks the value of the housing finance business while the parent retains management control." },
        { text: "Equity dilution through preferential allotment is an effective tool for raising capital without losing ownership majority." },
        { text: "Strong brands and solid financial performance are what secure large institutional investments." },
        { bold: true, text: "My Takeaway: Strategic stake sales enable companies to raise growth capital, improve valuation, and partner with world-class investors while maintaining long-term control." },
    ],
});

// ─── STORY 9: INSTAFIX ─────────────────────────────────────────────────────

newsTitle(
    "Instafix Raises ₹7.55 Crore to Scale 30-Minute Phone Repair Service",
    "Quick-Commerce Model Applied to Smartphone Repairs"
);

newsContent("Instafix — News Summary & Business Impact", {
    header: "Startup Highlights & Growth Strategy",
    bullets: [
        { bold: true, text: "Instafix raised ₹7.55 crore in a pre-seed funding round led by Titan Capital and 8i Ventures." },
        { text: "Founded in 2025 by former Blinkit executives Aniket Kale and Chetan Chauhan." },
        { bold: true, text: "Offers doorstep smartphone repair within 30 minutes at home or office — applying quick-commerce logistics to repairs." },
        { text: "Provides warranties of up to 12 months and pricing lower than many authorised service centres." },
        { bold: true, text: "Currently operates in Gurugram with an initial focus on iPhones." },
        { text: "Plans to expand into premium Android devices and other consumer electronics." },
    ],
}, {
    header: "Business Impact & My Takeaway",
    bullets: [
        { bold: true, text: "Applies the quick-commerce logistics model to a highly fragmented, largely unorganised repair market." },
        { text: "Improves customer convenience through faster, transparent, and standardised service delivery." },
        { bold: true, text: "Encourages formalisation of an industry dominated by unorganised local repair shops." },
        { text: "Proven operational experience (Blinkit) successfully transferred to a completely new industry vertical." },
        { text: "Warranties and transparent pricing build trust in a historically low-trust, opaque market." },
        { bold: true, text: "My Takeaway: Instafix shows how operational excellence and customer-centric innovation can transform an everyday service into a scalable, investment-worthy business opportunity." },
    ],
});

// ─── STORY 10: RBI BANK-FINTECH ────────────────────────────────────────────

newsTitle(
    "RBI Removes Approval Requirement for Bank–Fintech Remittance Tie-Ups",
    "Faster Cross-Border Payments with Greater Compliance Responsibility"
);

newsContent("RBI Fintech Policy — Detailed Analysis & Implications", {
    header: "Key Regulatory Change & Customer Protection",
    bullets: [
        { bold: true, text: "RBI removed the need for prior approval before banks partner with fintech platforms for outward remittances." },
        { text: "Applies to non-trade current account transactions: education fees, gifts, and family maintenance abroad." },
        { bold: true, text: "Banks remain fully responsible for compliance with FEMA, KYC, AML, and the Digital Personal Data Protection Act." },
        { text: "Customers must receive full disclosure of exchange rates, mark-ups, and service charges." },
        { bold: true, text: "Fintech partners are not permitted to hold customer funds in their own accounts." },
        { text: "Banks must ring-fence funds to protect customers in the event of partner insolvency." },
    ],
}, {
    header: "Business Impact & My Takeaway",
    bullets: [
        { bold: true, text: "Fintechs can launch services faster without waiting for extended regulatory approval cycles." },
        { text: "Banks gain access to innovative digital platforms and higher transaction volumes." },
        { bold: true, text: "Consumers benefit from greater transparency, lower fees, and a significantly improved user experience." },
        { text: "Reduced approvals increase accountability for banks — compliance and third-party risk management become core strategic capabilities." },
        { text: "Transparency and customer protection are fast becoming the key competitive advantages in the fintech space." },
        { bold: true, text: "My Takeaway: This policy demonstrates how regulators can encourage innovation while ensuring strong safeguards — successful partnerships require both speed and rigorous compliance." },
    ],
});

// ─── CLOSING SLIDE ─────────────────────────────────────────────────────────
{
    const s = pres.addSlide();
    s.background = { color: C.navy };
    s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 5.625, fill: { color: C.indigo } });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
        x: 1.5, y: 1.5, w: 7, h: 2.8,
        fill: { color: C.navy }, rectRadius: 0.2,
        shadow: { type: "outer", color: "000000", blur: 20, offset: 8, angle: 45, opacity: 0.4 },
    });
    s.addText("Thank You", {
        x: 1.5, y: 2.0, w: 7, h: 1.0,
        align: "center", fontSize: 40, color: C.white, bold: true, fontFace: "Cambria",
    });
    s.addText("Sections Covered: We Lounge  ·  We Tube  ·  Newswire", {
        x: 1.5, y: 3.15, w: 7, h: 0.5,
        align: "center", fontSize: 11, color: C.skyBlue, fontFace: "Calibri", charSpacing: 2,
    });
}

pres.writeFile({ fileName: "/home/claude/Sameer_Chavan_Enhanced.pptx" })
    .then(() => console.log("DONE"))
    .catch(e => { console.error(e); process.exit(1); });