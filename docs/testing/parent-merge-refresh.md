# Temporary parent-merge preview test

This PR exists only to test dependency updates after merging its parent, #45.

1. Open the real-data dashboard with both PRs visible.
2. Merge #45 from the dashboard.
3. Confirm this PR updates automatically: its parent chip should say `merged`, or disappear if GitHub retargets it to `main`.
4. Close this test PR without merging after checking the result.
