import { useEffect } from 'react';

const SITE_SUFFIX = ' - Eureka Cycling';

export function usePageTitle(title: string) {
    useEffect(() => {
        document.title = title + SITE_SUFFIX;
    }, [title]);
}
