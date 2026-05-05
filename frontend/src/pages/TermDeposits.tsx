import { useEffect, useState } from 'react';
import { fetchTermDeposits, saveTermDeposits } from '../api';
import type { TermDepositYear } from '../api';
import { usePageTitle } from '../hooks/usePageTitle';
import './TermDeposits.css';

function getCurrentFYEnd() {
    const now = new Date();
    return now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();
}

function fyLabel(fy: number) {
    return `FY ${fy - 1}/${fy}`;
}

function buildDefaultYears(existing: TermDepositYear[]): TermDepositYear[] {
    const currentFY = getCurrentFYEnd();
    const fys = [currentFY, currentFY - 1, currentFY - 2];
    return fys.map(fy => {
        const found = existing.find(e => e.fy === fy);
        return found ?? { fy, balance: 0, interest: 0, maturityDate: '' };
    });
}

export function TermDeposits() {
    usePageTitle('Term Deposits');
    const [years, setYears] = useState<TermDepositYear[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    useEffect(() => {
        fetchTermDeposits()
            .then(data => setYears(buildDefaultYears(data)))
            .catch(err => setError(err.message))
            .finally(() => setLoading(false));
    }, []);

    const handleSave = async () => {
        setError(null);
        setMessage(null);
        setSaving(true);
        try {
            const saved = await saveTermDeposits(years);
            setYears(buildDefaultYears(saved));
            setMessage('Saved.');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save.');
        } finally {
            setSaving(false);
        }
    };

    const updateField = (fy: number, field: keyof TermDepositYear, value: string | number) => {
        setYears(prev => prev.map(y => y.fy === fy ? { ...y, [field]: value } : y));
        setMessage(null);
    };

    if (loading) {
        return <div className="page-container"><div className="loading">Loading...</div></div>;
    }

    return (
        <div className="page-container term-deposits-page">
            <h1>Term Deposit</h1>

            {error && (
                <div className="td-alert error" role="status">
                    <span>{error}</span>
                    <button type="button" className="td-alert-close" onClick={() => setError(null)}>×</button>
                </div>
            )}
            {message && (
                <div className="td-alert success" role="status">
                    <span>{message}</span>
                    <button type="button" className="td-alert-close" onClick={() => setMessage(null)}>×</button>
                </div>
            )}

            <table className="td-table">
                <thead>
                    <tr>
                        <th>Financial Year</th>
                        <th>Balance ($)</th>
                        <th>Interest Earned ($)</th>
                        <th>Maturity Date</th>
                    </tr>
                </thead>
                <tbody>
                    {years.map(year => (
                        <tr key={year.fy}>
                            <td className="td-fy-label">{fyLabel(year.fy)}</td>
                            <td>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={year.balance || ''}
                                    onChange={e => updateField(year.fy, 'balance', Number(e.target.value))}
                                />
                            </td>
                            <td>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={year.interest || ''}
                                    onChange={e => updateField(year.fy, 'interest', Number(e.target.value))}
                                />
                            </td>
                            <td>
                                <input
                                    type="date"
                                    value={year.maturityDate}
                                    onChange={e => updateField(year.fy, 'maturityDate', e.target.value)}
                                />
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>

            <div className="td-form-actions">
                <button type="button" className="td-save-btn" onClick={handleSave} disabled={saving}>
                    {saving ? 'Saving...' : 'Save'}
                </button>
            </div>
        </div>
    );
}
