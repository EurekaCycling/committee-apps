import { Link, useLocation } from 'react-router-dom';
import { useAuthenticator } from '@aws-amplify/ui-react';
import './Navigation.css';

export function Navigation() {
    const { signOut } = useAuthenticator((context) => [context.user]);
    const location = useLocation();

    const isActive = (path: string) => location.pathname === path ? 'active' : '';

    return (
        <nav className="navbar">
            <div className="nav-brand">Eureka Cycling</div>
            <ul className="nav-links">
                <li><Link to="/" className={isActive('/')}>Home</Link></li>
                <li><Link to="/ledger" className={isActive('/ledger')}>Ledger</Link></li>
                <li><Link to="/reports" className={isActive('/reports')}>Reports</Link></li>
                <li><Link to="/reimbursements" className={isActive('/reimbursements')}>Reimbursements</Link></li>
                <li><Link to="/documents" className={isActive('/documents')}>Documents</Link></li>
            </ul>
            <button onClick={signOut} className="sign-out-btn">Sign Out</button>
        </nav>
    );
}
