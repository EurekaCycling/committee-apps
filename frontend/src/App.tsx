import { useEffect, useState } from 'react';
import './App.css';

function App() {
  const [message, setMessage] = useState<string>('Loading...');

  useEffect(() => {
    // In production, use the custom domain. In dev, use local SAM API.
    const apiUrl = import.meta.env.PROD
      ? 'https://api.committee.eurekacycling.org.au/hello'
      : 'http://127.0.0.1:3000/hello';

    fetch(apiUrl)
      .then((res) => res.json())
      .then((data) => setMessage(data.body || data.message || JSON.stringify(data)))
      .catch((err) => setMessage(`Error: ${err.message}`));
  }, []);

  return (
    <div className="container">
      <h1>Eureka Committee Apps</h1>
      <div className="card">
        <h2>Backend Status</h2>
        <p>{message}</p>
      </div>
    </div>
  );
}

export default App;
