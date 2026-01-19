import { useEffect, useState } from 'react';
import { Amplify } from 'aws-amplify';
import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react';
import { fetchAuthSession } from 'aws-amplify/auth';
import '@aws-amplify/ui-react/styles.css';
import './App.css';

// Configure Amplify
// Note: In a real app, these values should come from environment variables.
// Since we are deploying via SAM, we might need a way to inject them or fetch a config.json.
// For now, placeholders or manual replacement will be needed until we automate config injection.
// We will assume environment variables VITE_USER_POOL_ID and VITE_USER_POOL_CLIENT_ID are set in the build.
Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: import.meta.env.VITE_USER_POOL_ID || '',
      userPoolClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID || '',
    }
  }
});

function MainContent() {
  const [message, setMessage] = useState<string>('Loading...');
  const { user, signOut } = useAuthenticator((context) => [context.user]);

  useEffect(() => {
    async function fetchData() {
      try {
        const session = await fetchAuthSession();
        const token = session.tokens?.idToken?.toString();

        // In production, use the custom domain. In dev, use local SAM API.
        const apiUrl = import.meta.env.PROD
          ? 'https://api.committee.eurekacycling.org.au/hello'
          : 'http://127.0.0.1:3000/hello';

        const res = await fetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });

        if (res.status === 401) {
          setMessage("Unauthorized: Please login.");
          return;
        }

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
    <div className="container">
      <h1>Eureka Committee Apps</h1>
      <div className="card">
        <h2>Welcome, {user?.signInDetails?.loginId}</h2>
        <p><strong>Backend Message:</strong> {message}</p>
        <button onClick={signOut}>Sign Out</button>
      </div>
    </div>
  );
}

function App() {
  return (
    <Authenticator>
      <MainContent />
    </Authenticator>
  );
}

export default App;
