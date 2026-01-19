import { useAuthenticator } from '@aws-amplify/ui-react';

export const useAuth = () => {
    if (import.meta.env.VITE_NO_AUTH === 'true') {
        return {
            user: { signInDetails: { loginId: 'local-dev' } },
            signOut: () => console.log('Mock Sign Out')
        };
    }
    return useAuthenticator((context) => [context.user]);
};
