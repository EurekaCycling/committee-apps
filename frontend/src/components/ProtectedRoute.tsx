import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth-hook';
import type { Role } from '../auth-hook';

interface ProtectedRouteProps {
    children: React.ReactNode;
    allowedRoles: Role[];
}

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
    const { role, user, isLoading } = useAuth();
    const location = useLocation();

    if (isLoading) {
        return (
            <div className="page-container">
                <div className="loading">Loading permissions...</div>
            </div>
        );
    }

    if (!user) {
        // Not logged in, although Authenticator usually handles this, 
        // it's good for robustness.
        return <Navigate to="/" state={{ from: location }} replace />;
    }

    if (!allowedRoles.includes(role)) {
        // Role not allowed
        return (
            <div className="page-container">
                <div className="card error-card">
                    <h2>Access Denied</h2>
                    <p>You do not have the required permissions to view this page.</p>
                    <p>Current Role: <strong>{role}</strong></p>
                    <p>Required Roles: {allowedRoles.join(', ')}</p>
                </div>
            </div>
        );
    }

    return children;
}
