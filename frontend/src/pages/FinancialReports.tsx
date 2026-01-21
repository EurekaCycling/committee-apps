import { usePageTitle } from '../hooks/usePageTitle';

export function FinancialReports() {
    usePageTitle('Financial Reports');
    return (
        <div className="page-container">
            <h1>Financial Reports</h1>
            <p>View statements, balance sheets, and other reports.</p>
        </div>
    );
}
