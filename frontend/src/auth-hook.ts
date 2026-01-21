import { useAuthenticator } from '@aws-amplify/ui-react';

export type Role = 'none' | 'member' | 'committee' | 'treasurer';

export const useAuth = () => {
    if (import.meta.env.VITE_NO_AUTH === 'true') {
        // Allow overriding role via localStorage for testing: localStorage.setItem('mock_role', 'treasurer')
        const mockRole = (localStorage.getItem('mock_role') as Role) || 'none';
        return {
            user: { signInDetails: { loginId: 'local-dev' } },
            role: mockRole,
            signOut: () => {
                console.log('Mock Sign Out');
                localStorage.removeItem('mock_role');
                window.location.reload();
            }
        };
    }

    const { user, signOut } = useAuthenticator((context) => [context.user]);

    // In Amplify v6, custom attributes are often under user.getAttributes() or user.userId
    // but with useAuthenticator, it's usually available in the user object if configured.
    // For custom attributes, they are prefixed with custom:
    const role = (user?.userId ? (user as any).attributes?.['custom:role'] : 'none') as Role || 'none';

    return {
        user,
        role,
        signOut
    };
};
