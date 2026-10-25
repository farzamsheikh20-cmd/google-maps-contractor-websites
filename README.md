# Fortify Google Maps Contractor Websites

GitHub-ready Apify Actor for collecting construction-company websites from public Google Maps profiles. It combines construction trades with locations, discovers Maps profiles, visits each profile, saves valid external websites and public profile data, and prevents duplicate profiles and domains across continuation runs.

## Recommended first test

```json
{
  "startUrls": [],
  "searchTerms": ["commercial general contractors"],
  "locations": ["Los Angeles, California"],
  "maximumNewCompanies": 20,
  "maximumProfilesVisited": 50,
  "maximumResultsPerSearch": 50,
  "requireWebsite": true,
  "collectEmailsFromCompanyWebsites": false,
  "useResidentialProxy": true,
  "proxyCountryCode": "US",
  "campaignName": "maps-los-angeles-test",
  "resetProgress": true,
  "pageTimeoutSecs": 60,
  "delayMillis": 900
}
```

Use 2 GB memory, a 1,800-second timeout, and a $1 maximum cost for the first test. After it succeeds, use a new production campaign name, set `resetProgress` true only on its first run, and then keep it false.

## Collecting 500 websites

One Maps search rarely provides 500 unique results. Supply several trades and cities. Use `maximumNewCompanies: 500`, `maximumProfilesVisited: 1000`, and `maximumResultsPerSearch: 120`. Keep the campaign name unchanged across runs so previously processed companies are skipped.

This Actor accesses public pages only. It does not solve CAPTCHAs or bypass access controls. Residential proxy rotation retries access challenges, but Google may still limit individual searches.
