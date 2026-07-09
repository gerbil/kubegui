# E2E tests

This folder contains Playwright smoke tests for the v2 UI.

## Run locally

```bash
npm run test:e2e
```

## Notes

- Tests run against `vite preview` started automatically by Playwright.
- The init-page test only checks UI rendering and does not require a live Kubernetes backend.