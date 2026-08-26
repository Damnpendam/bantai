# PropApp — Product Surface (propapp.com.au)

Scope note: per instruction, this pack focuses on the **webapp** (propapp.com.au) as the primary subject. App Store / Play Store data is covered in [02-store-reviews.md](02-store-reviews.md). Competitor/market/founder deep-dives were intentionally dropped from this pass.

All claims below were read on the cited page on 2026-08-25. `[INFERRED]` = my interpretation, not stated text. `[UNKNOWN — needs manual check]` = flagged for you to verify hands-on (see [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md)).

---

## 1. Headline finding: the web product has pivoted away from the "agents bid for your listing" pitch

This is the single most important thing this research surfaced, and it's directly evidenced across four separate pages:

| Surface | Mechanic described | Source |
|---|---|---|
| iOS/Android app store descriptions (both still current) | "flips the sale of your property on its head by getting agent's to compete to win your listing" | apps.apple.com/au/app/propapp/id6475382641 (accessed 2026-08-25) |
| Homepage (propapp.com.au) | "Properties before they hit the market" / "The easier way to buy property" — a **buyer**-side off-market discovery product. 3-step flow: Search → Match ("Enquire directly with agents") → Move | propapp.com.au (accessed 2026-08-25) |
| /agents (agent marketing page) | "Turn buyer demand into your next listing win" — pitched as a **demand-intelligence tool agents use to win appraisals**, not a bidding marketplace. 3-step flow: "Start with demand" → "Make the case" → "Keep exploring". No mention of "bid," "bidding," or ProspX anywhere on this page. | propapp.com.au/agents (accessed 2026-08-25) |
| /download page | "Match, bid, and buy before the portals" (buyer-facing tagline — ambiguous, possibly legacy copy) + "Listing properties as an agent? Get ProspX →" | propapp.com.au/download (accessed 2026-08-25) |

**`[INFERRED]`**: PropApp appears to have split into two products under one company:
1. **PropApp** (the web app + consumer mobile app) — now primarily a **buyer** off-market/pre-market property discovery tool. The "Sell" tab on the homepage leads to a lead-gen "free instant estimate" flow, not directly to the agent-bidding mechanic the app description still advertises.
2. **ProspX** — a *separate*, iOS-only app (same developer, Propapp Pty Ltd) that is the one still explicitly built around agents "bid[ding] on new Pre-listings" from motivated sellers. It is not cross-linked from the main `/agents` marketing page — only from the `/download` page.

This is a real product-strategy signal worth building the teardown around: the flagship web/consumer product has moved from "seller lists → agents compete" to "buyer browses off-market inventory," while the original bidding mechanic has been pushed into a lower-profile, unrated, iOS-only sibling app. **You should confirm this hands-on** — see Q1–Q3 in OPEN-QUESTIONS.md.

---

## 2. Homepage (propapp.com.au)

- Hero: "Properties before they hit the market" / "The easier way to buy property."
- Search bar: "Search suburbs"
- Three mode toggles: **Buy** (default/active), **Sell**, **Buyer Demand** (tagged "SOON — Coming soon")
- Stat shown: "Over 20,000 matches"
- "Latest Properties" and "Most Viewed" grids — every visible listing on 2026-08-25 was in Melbourne's outer-north growth corridor: Thomastown, Epping, Wollert, Craigieburn, Lalor, South Morang, Bundoora (all VIC 30xx/31xx postcodes). Prices ranged ~$346K–$3.4M, mostly $450K–$900K houses/units. `[INFERRED]` this suggests current live inventory is geographically concentrated in Melbourne's north, not "nationwide across Australia's major cities" as the About page claims (see §5).
- "How It Works": **Search** (draw/search suburbs) → **Match** ("Enquire directly with agents as new opportunities appear") → **Move** ("When the right property comes along, you're ready to make your move")
- CTA: "Ready to find your place? Join our platform and see what's available in your area off-market and pre-market" → "Join PropApp now"

Source: propapp.com.au (accessed 2026-08-25)

### Clicking "Sell"

Clicking the **Sell** toggle opens a 4-step modal flow (I stopped at step 1 without submitting data, per research rules):

- **Step 1 of 4**: "What's the property address?" / "Type your address for a free instant estimate." — a single address-search field, "Continue" button.
- Steps 2–4: **`[UNKNOWN — needs manual check]`** — not observed. This is the actual seller onboarding funnel and should be your first hands-on task (Q1 in OPEN-QUESTIONS.md).

Source: propapp.com.au, Sell modal (accessed 2026-08-25)

---

## 3. Buyer Hub (/buyer-hub)

- Shows a live list of buyer "briefs" — "40 of 1189 active buyers" at time of access, sortable by Newest / Budget high-to-low / Most active.
- Brief details (area, budget, timeline) are gated: "sign in to see budget and timeline."
- CTAs are agent-facing: "Sign in to get in touch," "I'm an agent."
- No pricing shown on this page for either side.

Source: propapp.com.au/buyer-hub (accessed 2026-08-25)

**`[INFERRED]`**: This page is effectively a buyer-lead marketplace for agents — consistent with the Agent Terms fee model below (§6), where agents pay when a matched buyer purchases, not when they win a seller's listing.

---

## 4. Learn (/learn)

Six articles, all buyer-facing, none seller-facing:
- "What is an off-market property?" (Off-Market 101, 4 min)
- "Why agents share off-market listings" (Off-Market 101, 5 min) — states three reasons: "Vendors who want privacy. Vendors who want speed. Vendors who don't want to pay marketing."
- "How to write a brief that gets matches" (Buyer Playbook, 6 min)
- "How to talk to a listing agent" (Buyer Playbook, 7 min)
- "Pre-approval before you brief" (Finance, 5 min)
- "Stamp duty by state, 2026" (Finance, 8 min)

Tagline: "Short reads on off-market property, buyer playbooks, and finance. No SEO fluff, no sales pitches."

`[INFERRED]`: The complete absence of seller-facing content here (no "how to choose an agent," no "how bidding works" articles) is a second independent signal that the current content/marketing investment is buyer-weighted, not seller-weighted — despite the original seller-facing pitch.

Source: propapp.com.au/learn (accessed 2026-08-25)

---

## 5. About (/about)

- Mission: "create more opportunities for buyers and property professionals to connect"
- Founders: **Zac Burd** — Founder & CEO; **Christian Angelo Umali** — CTO
- Team members named on page: Zac Burd, Christian Angelo Umali, Liza Eagleton, Trevor Anderson, Otman Heddouch, Nicole Balaaldia, Kenneth Infante, Taige Alhadweh, Andrea Vignali (9 people)
- Claims "nationwide across Australia's major cities" — contrast with §2's observation that live homepage listings were 100% Melbourne outer-north on the day of access. `[INFERRED]` — could mean agent/buyer sign-ups are nationwide even if live off-market stock is VIC-concentrated; worth checking other states manually.
- "$0 upfront cost with fixed fees, payable only on success," "No lock-in contracts"
- One customer quote: saved "$50,000" (no name, no date, no verification given)
- Contact: hello@propapp.com.au, 0488 743 023, 5/150 Albert Rd, South Melbourne VIC 3205
- Legal entity: **PropApp Trading Pty Ltd**, ABN 58 677 053 128 (Privacy Policy separately names **PropApp Pty Ltd**, ACN 667 930 412 — two related entity names appear across pages, see §6)

Source: propapp.com.au/about (accessed 2026-08-25)

---

## 6. Legal pages

### Privacy Policy (propapp.com.au/legal/privacy, "Effective August 2026")
- Entities named: "PropApp Pty Ltd (ACN 667 930 412)" in the body; footer copyright says "© 2026 PropApp Trading Pty Ltd... ABN 58 677 053 128." `[UNKNOWN — needs manual check]` whether these are parent/subsidiary or a copy-paste inconsistency.
- Collects: name, DOB, address, phone, email, occupation, financial/payment details, property ownership documentation, third-party login profile images.
- Discloses to "approved users or business partners, contractors, suppliers and agents." Once a lead is transferred, "that data becomes subject to the respective third party's privacy policy" — i.e., PropApp's own privacy commitments stop applying once your details reach an agent.
- Overseas transfer to "United States of America, the European Union (including Germany), India and the Philippines."
- Deleted accounts: profile photo/link identifiers removed from active systems "within 30 days" (does not explicitly promise full data deletion).
- States commitment to the Australian Privacy Principles (Privacy Act 1988 (Cth)).

### Terms (propapp.com.au/legal/terms, "Effective May 2026")
- "We do not vet or exhaustively evaluate listings or user profiles. It remains the sole responsibility of each user to conduct their own due diligence."
- Fees "non-cancelable and non-refundable"; company can change fees or withdraw services "without notice."
- Liability capped to "the last subscription Term"; excludes loss of income/profits.
- Governed by Victoria, Australia law; exclusive jurisdiction of Victorian courts.

### Agent Terms (propapp.com.au/legal/agent-terms, "Effective May 2026")
- Two fee types: **AS Fees** (Additional Services / subscription) and **Lead Fees**, both "non-refundable and non-cancellable," amounts set per "Order Form or SOW" (not published on the page).
- **Lead Fee trigger**: "You must pay us a Lead Fee if the Property is Bought while you are Engaged" — i.e., the fee is tied to a buyer purchasing, not to winning a seller's listing. Agents can claim a prior-engagement exemption within 5 business days.
- Non-exclusive: "our services are provided on a non-exclusive basis."
- Agents are explicitly barred from passing subscription fees to vendors: "you cannot pass on any AS Fees to that Vendor."
- Suspension is at PropApp's "sole and absolute discretion" for standards breaches.

Sources: propapp.com.au/legal/privacy, /legal/terms, /legal/agent-terms (all accessed 2026-08-25)

---

## 7. Agents page (/agents) and pricing

- Positioning: **"Turn buyer demand into your next listing win"** — a pre-appraisal intelligence tool, not a bidding marketplace. "See buyer demand in your patch before your next appraisal."
- Three tiers:
  - **Free**: $0, off-market listing access, buyer demand preview, team role allocation.
  - **Agent Pro**: normally $99, currently offered free — address-level demand checks, "appraisal mode" with PDF reports, buyer-demand reports.
  - **Agency Team**: custom/contact sales — adds team admin & permissions.
- No bidding, matching mechanics, or lead-cost figures disclosed on this page (those live in the separate, non-public Order Form / SOW referenced in the Agent Terms).
- CTAs: "Sign up free" (×4), "Talk to sales."

Source: propapp.com.au/agents (accessed 2026-08-25)

---

## 8. Success Stories (/success-stories)

All six items are video-thumbnail links out to Instagram, with short captions and no names, dollar figures, or dates on the page itself:
1. "Another happy vendor — knowing PropApp is helping them find the best agent for their sale" (seller)
2. "Imagine buying property before the first open home" (buyer)
3. "He's not the only one.." (buyer)
4. "In a matter of weeks their headaches were gone" (seller, sourced to "7 News Melbourne" per caption)
5. "He didn't think he'd get the same outcome by himself" (buyer)
6. "Can we check out your house? 👀" (buyer)

`[INFERRED]`: 4 of 6 stories are buyer-framed, 2 are seller-framed — roughly consistent with the buyer-weighted content pattern seen in §4.

Source: propapp.com.au/success-stories (accessed 2026-08-25)

---

## 9. Data handed over, and when (seller funnel as observed)

| Step | What's asked | Where |
|---|---|---|
| Homepage → Sell → Step 1 of 4 | Property address only | Observed directly, 2026-08-25 |
| Steps 2–4 | `[UNKNOWN — needs manual check]` | Not observed — see OPEN-QUESTIONS Q1 |
| Buyer Hub sign-in gate | Full buyer brief (budget, timeline) hidden until agent signs in | propapp.com.au/buyer-hub |
| Privacy Policy | Ultimately: name, DOB, address, phone, email, occupation, financial/payment info, property ownership docs | propapp.com.au/legal/privacy |

The privacy policy's disclosure clause (§6) is the key seller-risk finding: once a seller's details are passed to an agent as a "lead," PropApp's own privacy obligations end and the agent's own policy takes over — worth flagging in the teardown as a trust/consent design point, since it's stated plainly in the policy text rather than inferred.
