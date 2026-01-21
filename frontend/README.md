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

## Roles & Permissions

Access to features is controlled by the `custom:role` attribute in Cognito.

| Role | Permissions |
| :--- | :--- |
| `none` | Home only (Default). |
| `member` | Home only. |
| `committee` | Home, Reports, Reimbursements, Documents. |
| `treasurer` | All features (including Ledger). |

### Role Mocking (Local Dev)
When running with `VITE_NO_AUTH=true`, the default role is `none`. You can override your role in the browser console for testing:

```javascript
// Set role to treasurer
localStorage.setItem('mock_role', 'treasurer');
location.reload();

// Set role to committee
localStorage.setItem('mock_role', 'committee');
location.reload();

// Reset role
localStorage.removeItem('mock_role');
location.reload();
```

## Deployment

The frontend is built by GitHub Actions and synced to an S3 bucket served by CloudFront.
Manual build:

```bash
npm run build
```
