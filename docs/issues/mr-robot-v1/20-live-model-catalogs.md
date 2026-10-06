# 20: Live model catalogs from configured providers

**Parent:** mr-robot-v1 (../mr-robot-v1.md) — stories robot-d994, robot-3f4i, robot-mx6s

**What to build:** The Model control in advanced settings lists exactly the models of the providers the Home has credentials for, read from each provider's live catalog and cached in the Home with a fetched-at time; the admin view refreshes catalogs. A robot cannot be created or switched to a model whose provider has no credential; with no provider configured the app sends the Member to provider setup instead of failing a turn. Replaces the static catalog list.

**Blocked by:** 13 Providers, subscriptions and per-robot model

**Status:** done

- [x] Adding an OpenRouter key makes OpenRouter's current model list appear in the Model control; removing it removes them
- [x] Catalog refresh in admin updates the list and the fetched-at time
- [x] A Home with no credentials cannot create a robot; the creation flow links to provider setup
- [x] A robot's current model stays selected across a refresh; a model that disappeared is flagged, not silently replaced
- [x] No static model list remains in the bundle

Verified 2026-10-06 on the live deployment: Claude (13 models) and Workers AI (20) listed from the Providers themselves; Mr. Robot switched to Claude Sonnet 5.5 in Settings and answered a message on it. Tests: live-catalog.test.ts (response shapes captured from the live endpoints), real-adapters.test.ts (a Turn through each adapter and DSH), settings-flow.test.ts.
