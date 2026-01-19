import { useEffect, useState } from 'react';
import { Amplify } from 'aws-amplify';
import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react';
import { Routes, Route } from 'react-router-dom';
import '@aws-amplify/ui-react/styles.css';
import './App.css';
import { apiFetch } from './api';
import { Navigation } from './components/Navigation';
import { Ledger } from './pages/Ledger';
import { FinancialReports } from './pages/FinancialReports';
import { Reimbursements } from './pages/Reimbursements';
import { Documents } from './pages/Documents';

// Configure Amplify
Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: import.meta.env.VITE_USER_POOL_ID || '',
      userPoolClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID || '',
    }
  }
});

function Home() {
  const [message, setMessage] = useState<string>('Loading...');
  const { user } = useAuthenticator((context) => [context.user]);

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

    if (user) {
      fetchData();
    }
  }, [user]);

  return (
    <div className="page-container">
      <h1>Welcome, {user?.signInDetails?.loginId}</h1>
      <div className="card">
        <p><strong>Backend Message:</strong> {message}</p>
      </div>
    </div>
  );
}

function App() {
  return (
    <Authenticator>
      <Navigation />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/ledger" element={<Ledger />} />
        <Route path="/reports" element={<FinancialReports />} />
        <Route path="/reimbursements" element={<Reimbursements />} />
        <Route path="/documents" element={<Documents />} />
      </Routes>
    </Authenticator>
  );
}

export default App;
