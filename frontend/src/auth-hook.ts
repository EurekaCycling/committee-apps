import { useState, useEffect } from 'react';
import { useAuthenticator } from '@aws-amplify/ui-react';
import { fetchUserAttributes } from 'aws-amplify/auth';

export type Role = 'none' | 'member' | 'committee' | 'treasurer';

export const useAuth = () => {
    const [role, setRole] = useState<Role>('none');
    const [isLoading, setIsLoading] = useState(true);

    if (import.meta.env.VITE_NO_AUTH === 'true') {
        const mockRole = (localStorage.getItem('mock_role') as Role) || 'none';
        return {
            user: { signInDetails: { loginId: 'local-dev' } },
            role: mockRole,
            isLoading: false,
            signOut: () => {
                console.log('Mock Sign Out');
                localStorage.removeItem('mock_role');
                window.location.reload();
            }
        };
    }

    const { user, signOut } = useAuthenticator((context) => [context.user]);

    useEffect(() => {
        async function getAttributes() {
            if (user) {
                setIsLoading(true);
                try {
                    const attributes = await fetchUserAttributes();
                    const userRole = (attributes['custom:role'] as Role) || 'none';
                    setRole(userRole);
                } catch (err) {
                    console.error('Error fetching user attributes:', err);
                    setRole('none');
                } finally {
                    setIsLoading(false);
                }
            } else {
                setRole('none');
                setIsLoading(false);
            }
        }
        getAttributes();
    }, [user]);

    return {
        user,
        role,
        isLoading,
        signOut
    };
};
