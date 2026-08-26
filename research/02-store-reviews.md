# PropApp — App Store & Play Store Research

Two apps, same developer (Propapp Pty Ltd): **PropApp** (iOS + Android, consumer-facing) and **ProspX** (iOS only, agent-facing bidding app). All data accessed 2026-08-25.

**Sample size warning**: this is a very small dataset — 27 iOS ratings + 11 Android ratings for PropApp, and ProspX has too few ratings to display an average at all. Treat the themes table as directional, not statistically reliable, and say so in the teardown.

---

## Themes table

| Theme | Mentions | Representative complaint/praise (paraphrased) | Platform(s) |
|---|---|---|---|
| Fast, effective connection to an agent/buyer's advocate | 6 | Reviewers describe being matched with a professional within a day and crediting the app with a fast, low-effort purchase or sale outcome | iOS ×4, Android ×2 |
| Easy shortlisting/comparison of agents | 3 | Reviewers liked being able to compare and shortlist multiple agents "on my terms" rather than cold-calling around | iOS ×3 |
| Listing/profile management bugs | 1 explicit + `[INFERRED]` possible contributor to unexplained 1★ cluster | One reviewer added a property, tried to delete it, found only the profile (not the property) could be removed, and the listing persisted even after uninstalling the app | Android ×1 |
| Unexplained negative ratings | 6 (no review text) | Android shows 7 one-star ratings but only 1 has visible text — the other 6 are silent | Android |

### Split by likely reviewer side

- **Reads as seller-side**: iOS reviews (cheddarz91, Ilan29, Sam_M6 — all describe finding/shortlisting an agent "for my property"); the one Android 1★ review with text (adding/removing a property listing).
- **Reads as buyer-side**: Android's two positive reviews (Matthew Poppell, Aaron Vinnell — both describe being connected with a "Buyers Advocate"/"buyers agent" to help them purchase).
- `[INFERRED]`: the visible reviews split roughly evenly seller vs buyer, but this is only 6 reviews with text total — not enough to conclude anything about the real user base mix.

---

## PropApp — iOS App Store

Source: apps.apple.com/au/app/propapp/id6475382641 and itunes.apple.com/au/lookup?id=6475382641 (both accessed 2026-08-25)

- **Rating**: 4.2 / 5 average (raw: 4.1852), **27 ratings total**
- **Current version**: 1.2.2, released 2026-06-21 ("Bug Fixes" release notes)
- **First release**: 2024-09-17 (per public iTunes lookup API `releaseDate` field)
- **Size**: 3.2 MB · **Category**: Lifestyle · **Age rating**: 4+ · **Compatibility**: iOS 15.0+
- **Full description** (verbatim): "PropApp was conceived by two people, who, like most Aussies, lead busy lives and found it unnecessarily painful and time consuming when finding an agent to sell their property. Welcome to PropApp! PropApp is a free and convenient app that flips the sale of your property on it's head by getting agent's to compete to win your listing! Once downloaded, you'll need to sign up and add your property. From there you can Get Agent Offers and watch the magic begin! Of course you'll have full control of the process, including all the data you need to make the best choice of agent for your property - right in the palm of your hands. Don't forget to use our in-app chat, so you can keep all those commitments in writing for future reference! We truly hope you love this as much as we do and of course - any feedback please hit us up, our contact details available via our website! Cheers, Zac + Joel"
- **App Privacy declarations**: Data used to track you across apps/websites: Usage Data. Data linked to identity: Contact Info, User Content, Identifiers, Usage Data, Diagnostics. Data not linked to identity: Diagnostics.
- **"You Might Also Like" / competitor set surfaced by Apple**: RateMyAgent, Artis Property, Anywhere Auctions, Realrun, Aussie for Agents, Cotality Valuation Assist, Viewy Real Estate, Homely — useful as an Apple-assigned peer set, not a claim about actual competitive overlap.

### ⚠️ Correction — version/release-note history

An earlier automated fetch of this page returned what looked like a complete 20-row version-history table (v1.0.0 "Initial release" 17/09/2024 through v1.2.2, including entries like "1.0.5 — Agent bids & shortlist," "1.1.6 — Buyer's advocacy features," "1.1.2 — UI Refresh, appraisal & chat," "1.1.12 — Introducing the 'express lane'"). **I could not reproduce this on the live page** — the current App Store listing (both the rendered page and Apple's public lookup API) only exposes the *current* version's release notes ("Bug Fixes," v1.2.2), not a history. I'm not able to verify that table against a real source, so I'm retracting it rather than including it as fact.

If you want that roadmap signal (it would be a genuinely useful one — it maps neatly onto the pivot described in [01-product-surface.md](01-product-surface.md), e.g. "Agent bids & shortlist" → "Buyer's advocacy features" → "UI Refresh, appraisal & chat" tracks a seller-bidding → buyer-advocacy → agent-demand-tool progression), you'd need a source I can't access here — e.g. App Store Connect (if you or PropApp has access), or a third-party ASO tracker like AppFigures/Sensor Tower/data.ai (most require a paid account or login). `[UNKNOWN — needs manual check]`.

### iOS written reviews (4 of 27 ratings have visible text)

| Reviewer | Date | Title | Text (verbatim) |
|---|---|---|---|
| cheddarz91 | 2024-10-22 | Great Experience | "I own multiple properties and in some locations I don't know who the best agents are. Prop App has been great for me, I've been able to find the best agents and get the best advice. I feel in control. Thank you Team and I am looking forward to more successful sales." |
| Jai Fresche | 2024-10-31 | Easy as! | "An awesome idea and well executed. I have been looking for something like this for a while that does the bulk of the heavy lifting in working with an agent and the process couldn't have been smoother. Loving it and will hopefully use it again soon." |
| Ilan29 | 2024-11-27 | Great idea, easy to use | "This was a really handy way to find the right agent for my property, on my terms. The process was quick and straightforward, and I've already got a couple of agents that I have shortlisted" |
| Sam_M6 | 2024-10-23 | Easy to shortlist local agents | "PropApp made it simple for us to shortlist excellent real estate agents in the area and helped us decide who we would use to sell our property. The whole process was so easy and efficient." |

All 4 visible written reviews are from October–November 2024 (near launch) and are seller-framed and positive. No visible written reviews are dated after Nov 2024, despite the app receiving updates through June 2026 — `[INFERRED]` the 27 ratings likely include unwritten star-only ratings from later periods not represented here.

---

## PropApp — Google Play

Source: play.google.com/store/apps/details?id=au.com.propapp.app&hl=en_AU (accessed 2026-08-25)

- **Rating**: 2.5 / 5, **11 reviews total**, **5,000+ downloads**
- **Rating distribution** (confirmed via page's aria-labels): 5★ ×4, 4★ ×0, 3★ ×0, 2★ ×0, **1★ ×7**
- **Last updated**: 2026-06-16
- **Data safety**: developer declares "No data shared with third parties," collects "Personal info, Financial info and 5 others," data encrypted in transit, deletion requestable
- **Description**: identical text to iOS listing (see above)

Only 3 of the 11 reviews render their text on the public page; I was unable to expand the "See all reviews" panel in this session. The 6 additional 1★ ratings exist (per the aria-label counts above) but their text is `[UNKNOWN — needs manual check]`.

### Android written reviews (3 of 11)

| Reviewer | Date | Stars | Text |
|---|---|---|---|
| Matthew Poppell | 2026-02-10 | 5★ (inferred from content/position, not explicitly labelled in scrape) | "After seeing the other reviews, I thought I'd jump in from the other side. For me, it's hard to think of PropApp as just an app. PropApps team were very responsive supporting me on the initial sign up part, and it quickly got me in touch with a Buyers Advocate (within a day). As a whole, they were instrumental in helping me purchase my first home within a couple of months. Using it saved me time immediately, and a lot money in the end. Give it a go!" |
| Kima Downing | 2025-08-31 | 1★ | "Garbage, created a part profile to add pictures tomorrow, went through the skip and such, then just lists the property. Can't delete the property only your profile. Have removed and deleted the app but it still shows as being there...." — **PropApp replied same day**: "Thanks for reaching out - we note this concern and will have your property removed accordingly. Apologies and thanks again - Team PropApp" |
| Aaron Vinnell | 2026-02-10 | not stated in scrape | "Helped us find a home! We were looking on our own for months and then found this solution. It connected us with a buyers agent who navigated the real estate agent BS and locked in our offer." |

Notably, Matthew Poppell's review opens with "After seeing the other reviews, I thought I'd jump in from the other side" — direct evidence the reviewer was aware of a run of negative reviews at the time of writing (2026-02-10), consistent with the 7-of-11 one-star distribution.

---

## ProspX — iOS App Store (agent-side bidding app)

Source: apps.apple.com/us/app/prospx/id6499192850 (accessed 2026-08-25)

- **Rating**: "hasn't received enough ratings or reviews to display an overview" — effectively no review data available
- **Current version**: 1.1.21, released 2026-03-26
- **Price**: Free · **Category**: Lifestyle · **Developer**: Propapp Pty Ltd
- **Full description** (verbatim): "ACCESS TO EXCLUSIVE LISTINGS ProspX does just that. Connect to owners who are motivated to sell. Get access to owners who are ready and serious about selling. Simply sign up today and start bidding! COMPETITIVE BIDDING The sky's the limit when it comes to bidding with ProspX. Submit personalized bids to stand out from the crowd and win actionable leads. QUALIFIED LEADS Don't wait by the phone for aggregation sites to spam you with phone numbers that lead nowhere. Bid on new Pre-listings everyday without limit and get in front of owners genuinely looking to sell. STREAMLINE YOUR SALES ProspX makes things simple by organizing and recording all of your bids and other important documents in one place. ProspX also keeps a record of your sales, so that next time you need to wow your clients, you'll have everything you need right at your fingertips."
- No Android listing found for ProspX (searched, not found under `au.com.propapp.prospx` or similar).

This confirms the pivot flagged in [01-product-surface.md](01-product-surface.md): the "agents bid to win your listing" mechanic is alive, but has moved to an essentially unreviewed, low-visibility sibling app rather than the flagship PropApp product.
