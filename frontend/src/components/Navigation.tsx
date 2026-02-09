import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth-hook';
import './Navigation.css';

export function Navigation() {
    const { signOut, role } = useAuth();
    const location = useLocation();
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    const isActive = (path: string) => location.pathname === path ? 'active' : '';

    const isTreasurer = role === 'treasurer';
    const isCommitteeOrTreasurer = role === 'committee' || role === 'treasurer';

    const closeMenu = () => setIsMenuOpen(false);

    return (
        <nav className="navbar">
            <div className="nav-header">
                <div className="nav-brand">Eureka Cycling</div>
                <button
                    type="button"
                    className="nav-toggle"
                    aria-expanded={isMenuOpen}
                    aria-controls="main-navigation"
                    onClick={() => setIsMenuOpen((prev) => !prev)}
                >
                    Menu
                </button>
            </div>
            <div className={`nav-actions ${isMenuOpen ? 'is-open' : ''}`} id="main-navigation">
                <ul className="nav-links">
                    <li><Link to="/" className={isActive('/')} onClick={closeMenu}>Home</Link></li>

                    {isTreasurer && (
                        <li><Link to="/ledger" className={isActive('/ledger')} onClick={closeMenu}>Ledger</Link></li>
                    )}

                    {isCommitteeOrTreasurer && (
                        <>
                            <li><Link to="/reports" className={isActive('/reports')} onClick={closeMenu}>Reports</Link></li>
                            <li><Link to="/reimbursements" className={isActive('/reimbursements')} onClick={closeMenu}>Reimbursements</Link></li>
                            <li><Link to="/documents" className={isActive('/documents')} onClick={closeMenu}>Documents</Link></li>
                        </>
                    )}
                </ul>
                <button onClick={() => {
                    closeMenu();
                    signOut();
                }} className="sign-out-btn">Sign Out</button>
            </div>
        </nav>
    );
}
