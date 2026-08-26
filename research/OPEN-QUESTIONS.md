# Open Questions — do these hands-on, in this order, in one sitting

Everything below cannot be answered from public marketing pages. Work top to bottom — later questions depend on impressions from earlier ones. For each, capture the artefact listed (screenshot unless stated otherwise) and jot the number in brackets.

---

### 1. Does the seller flow ever deliver the "agents compete" mechanic the app stores promise?
**Side:** Seller. **Why it matters:** This is the whole teardown. The app description says "getting agent's to compete to win your listing." The webapp's `/agents` page and `/learn` content never mention bidding at all — only ProspX (a separate, unrated, iOS-only app) does. If the seller flow dead-ends into a single-agent referral or a "free estimate" lead-gen form instead of a visible multi-agent competition, that's the finding.
**Capture:** Complete the Sell flow from propapp.com.au (Step 1 of 4 is "What's the property address?"). Screenshot every step. At the end: do you see multiple agent offers side by side, one agent, or no agent — just a confirmation/"we'll be in touch"? Note field count, whether phone/email is required, and total elapsed time.

### 2. What exactly is asked in Sell steps 2–4, and when does contact info get captured?
**Side:** Seller. **Why it matters:** The privacy policy states seller data becomes subject to the receiving agent's own privacy policy once transferred — worth knowing exactly which step triggers that handoff.
**Capture:** Field-by-field list for steps 2, 3, 4 (screenshot each). Note the exact step where phone number / email is first requested, and whether there's any explicit "we'll share your details with agents" consent checkbox or text at that point — quote it exactly if present.

### 3. Buyer brief signup: friction and payoff
**Side:** Buyer. **Why it matters:** Content investment (6 Learn articles, live listing feed, Buyer Hub) suggests buyer is now the primary acquisition funnel. Need a comparable friction number to the seller flow in Q1.
**Capture:** Complete a buyer signup/brief from the homepage "Buy" flow. Screenshot each step, count fields and taps, note elapsed time. Does it return any real matches for your test suburb, or just "we'll notify you"?

### 4. Off-market listing detail level on /map (Explore)
**Side:** Buyer. **Why it matters:** Determines how much value a buyer gets before signing in — a core piece of "is this actually off-market access, or a lead funnel disguised as a listing feed."
**Capture:** Screenshot the map/list view signed-out, then signed-in. Is full address shown? Photos? Agent name/contact? Price? What's gated behind sign-in vs visible to anyone?

### 5. Geography check: is "nationwide" real?
**Side:** Buyer/Seller. **Why it matters:** Every listing on the homepage during this research was in Melbourne's outer-north corridor, despite the About page's "nationwide across Australia's major cities" claim.
**Capture:** Search 2–3 non-VIC suburbs (e.g. a Sydney and Brisbane suburb) on both Buy and Sell. Screenshot results (or empty states). Note if Sell/estimate flow even accepts a non-VIC address.

### 6. Agent-side Free tier: what do you actually see?
**Side:** Agent. **Why it matters:** `/agents` pitches "see buyer demand in your patch before your next appraisal" but discloses no specifics. Determines whether the free tier is a real teaser or vapourware.
**Capture:** Sign up as an agent (free tier). Screenshot the demand dashboard/data for a test suburb. Is it real numbers or placeholder/blurred data pending payment?

### 7. Where does a lead fee amount ever get disclosed?
**Side:** Agent. **Why it matters:** Agent Terms say Lead Fees are set per "Order Form or SOW" — not published anywhere public. If the actual signup/"Talk to sales" flow never reveals a number either, that's a real transparency gap worth naming.
**Capture:** Go as far as possible into "Sign up free" and "Talk to sales" without submitting payment info. Screenshot any pricing/fee screen you reach. Note if you hit a wall requiring a sales call before any number appears.

### 8. Does the in-app/on-web chat feature exist and work?
**Side:** Either. **Why it matters:** The app description highlights in-app chat as a way to "keep commitments in writing." Also a live support widget ("Chat with PropApp support — we're online") appears on the homepage.
**Capture:** Click the support chat bubble. Screenshot the opening message. Is it a bot, a real person, or a dead end? Ask it one direct question ("How does agent bidding work?") and record the answer verbatim.

### 9. "Buyer Demand" tab — real feature or empty teaser?
**Side:** Either. **Why it matters:** It's the third homepage toggle, marked "Coming Soon." Might reveal roadmap direction (e.g. a rebuilt seller-facing demand/bidding tool).
**Capture:** Click it. Screenshot whatever appears (waitlist form, teaser copy, nothing).

### 10. Mobile app vs webapp: same product or stale UI?
**Side:** Either. **Why it matters:** The app description text is unchanged since near-launch (still says "compete to win your listing"), but the webapp has clearly moved on. If the actual mobile app UI still shows old bidding screens, that's evidence the pivot happened on web first and the app is lagging — a concrete "what would I fix first" answer for the interview.
**Capture:** Install the iOS or Android app (whichever you have). Screenshot the onboarding/Sell flow inside the app and compare directly against your Q1 screenshots from the webapp. Note any UI/wording differences.

### 11. ProspX: what does agent bidding actually look like?
**Side:** Agent. **Why it matters:** This is the only place the original "agents compete" mechanic still lives. If you can get past signup without a real estate licence check, seeing the actual bid UI (bid amount? per-lead cost? how many "pre-listings" visible for your area?) is the single most valuable screenshot in this whole exercise.
**Capture:** Attempt ProspX signup (iOS only — apps.apple.com/us/app/prospx/id6499192850). Screenshot the bidding screen for any pre-listing you can see. If blocked by licence verification, screenshot exactly where it stops you and what it asks for.

### 12. Consent wording at the moment data is shared with agents
**Side:** Seller. **Why it matters:** Ties directly to the Australian Privacy Principles constraint — does the product get explicit, informed consent before handing a seller's phone number to an agent, or is it implied through "continued use of our Services" as the privacy policy's overseas-transfer clause suggests?
**Capture:** During the Sell flow (Q1/Q2), screenshot and quote verbatim any consent checkbox, disclosure text, or terms-acceptance step that appears before your contact details are collected.

### 13. Review-prompt timing
**Side:** Either. **Why it matters:** Explains the review pattern — iOS reviews cluster right at Oct–Nov 2024 launch and are uniformly positive; Android reviews are recent (2025–2026) and split hard between glowing and "garbage." If the app prompts for a rating at a specific success moment (e.g. right after an agent match), that would explain why negative experiences before that moment go unrated while good ones get 5 stars.
**Capture:** Note whether you're ever prompted to rate the app during your walkthrough, and at what step.

---

## Synthesis — three friction points the research points at (confidence-tagged)

**1. The core "agents compete to win your listing" promise may no longer be delivered by the flagship product.** *(Medium-high confidence.)* Evidenced by three independent pages (`/agents`, `/learn`, homepage) that never mention bidding, plus the discovery that the actual bidding mechanic now lives only in ProspX, a separate iOS-only app with essentially zero reviews. **To confirm or kill: Q1, Q2, Q11.** If the Sell flow does surface real agent competition, this collapses; if it dead-ends into a single-agent referral, this is your headline finding.

**2. Seller-side friction/investment looks meaningfully behind buyer-side.** *(Medium confidence.)* Content (`/learn` = 6 buyer articles, 0 seller articles), success stories (4 buyer : 2 seller), and the observed Sell flow stopping at a bare "enter your address" step all point the same way, but I only saw step 1 of 4 — the remaining steps could reverse this. **To confirm or kill: Q1, Q2, Q3 (direct comparison).**

**3. Agent-side monetisation is opaque even to a prospective agent user.** *(Medium confidence, lower stakes for the teardown.)* Lead Fees are contractually real (Agent Terms) but the amount is never published — set per private "Order Form or SOW." Whether that opacity persists all the way through a real signup, or just isn't on the public marketing page, is untested. **To confirm or kill: Q6, Q7.**

I would not stretch to a fourth friction point — the geography claim (Q5) and data-consent flow (Q12) are worth checking but the public evidence for them is thinner (one day's snapshot of listings, one clause of boilerplate privacy language) and I'd rather flag them as open than dress them up as a third finding.
