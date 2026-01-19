# Frontend

This project uses React + TypeScript + Vite.

## Development

```bash
npm install
npm run dev
```

## Authentication

Authentication is handled by AWS Amplify (Cognito).

### Local Mock Mode
To develop without logging in to Cognito every time, set `VITE_NO_AUTH=true`:

```bash
VITE_NO_AUTH=true npm run dev
```
This mocks a logged-in user with ID `local-dev`.

## Deployment

The frontend is built by GitHub Actions and synced to an S3 bucket served by CloudFront.
Manual build:

```bash
npm run build
```
