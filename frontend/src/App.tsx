import { useEffect, useState } from 'react';
import { Amplify } from 'aws-amplify';
import { Authenticator } from '@aws-amplify/ui-react';
import { Routes, Route } from 'react-router-dom';
import '@aws-amplify/ui-react/styles.css';
import './App.css';
import { apiFetch } from './api';
import { Navigation } from './components/Navigation';
import { Ledger } from './pages/Ledger';
import { FinancialReports } from './pages/FinancialReports';
import { Reimbursements } from './pages/Reimbursements';
import { Documents } from './pages/Documents';

import { useAuth } from './auth-hook';

// Configure Amplify
Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: import.meta.env.VITE_USER_POOL_ID || '',
      userPoolClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID || '',
    }
  }
});
import { ProtectedRoute } from './components/ProtectedRoute';

function Home() {
  const [message, setMessage] = useState<string>('Loading...');
  const { user, role, isLoading } = useAuth();

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await apiFetch('/hello');
        const data = await res.json();
        setMessage(data.body || data.message || JSON.stringify(data));
      } catch (err: any) {
        setMessage(`Error: ${err.message}`);
      }
    }

    if (user && (role === 'committee' || role === 'treasurer')) {
      fetchData();
    }
  }, [user, role]);

  const hasAccess = role === 'committee' || role === 'treasurer';

  if (isLoading) {
    return (
      <div className="page-container">
        <div className="loading">Checking permissions...</div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <h1>Welcome, {user?.signInDetails?.loginId || 'User'}</h1>

      {!hasAccess ? (
        <div className="card info-card">
          <p>You are logged in as a <strong>{role}</strong>.</p>
          <p>Committee features are only available to committee members and the treasurer.</p>
        </div>
      ) : (
        <div className="card">
          <p>Role: <strong>{role}</strong></p>
          <p><strong>Backend Message:</strong> {message}</p>
        </div>
      )}
    </div>
  );
}

function MainLayout() {
  return (
    <>
      <Navigation />
      <Routes>
        <Route path="/" element={<Home />} />

        {/* Committee & Treasurer access */}
        <Route path="/reports" element={
          <ProtectedRoute allowedRoles={['committee', 'treasurer']}>
            <FinancialReports />
          </ProtectedRoute>
        } />
        <Route path="/reimbursements" element={
          <ProtectedRoute allowedRoles={['committee', 'treasurer']}>
            <Reimbursements />
          </ProtectedRoute>
        } />
        <Route path="/documents" element={
          <ProtectedRoute allowedRoles={['committee', 'treasurer']}>
            <Documents />
          </ProtectedRoute>
        } />

        {/* Treasurer only access */}
        <Route path="/ledger" element={
          <ProtectedRoute allowedRoles={['treasurer']}>
            <Ledger />
          </ProtectedRoute>
        } />
      </Routes>
    </>
  );
}

function App() {
  const useMockAuth = import.meta.env.VITE_NO_AUTH === 'true';

  if (useMockAuth) {
    return <MainLayout />;
  }

  return (
    <Authenticator hideSignUp>
      <MainLayout />
    </Authenticator>
  );
}

export default App;
