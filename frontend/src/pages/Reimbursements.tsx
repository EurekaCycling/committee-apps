import { usePageTitle } from '../hooks/usePageTitle';

export function Reimbursements() {
    usePageTitle('Reimbursements');
    return (
        <div className="page-container">
            <h1>Reimbursements</h1>
            <p>Submit and view reimbursement requests.</p>
        </div>
    );
}
