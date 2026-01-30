import { useEffect, useState } from 'react';
import { FaMoneyBillWave, FaUniversity, FaCreditCard } from 'react-icons/fa';
import { apiFetch, fetchCategories } from '../api';
import type { MonthlyLedger, TransactionType } from '../mocks/ledgerData';
import { usePageTitle } from '../hooks/usePageTitle';
import './Ledger.css';

const ICONS = {
    CASH: <FaMoneyBillWave />,
    BANK: <FaUniversity />,
    CARD: <FaCreditCard />
};

const getMonthKey = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
};

const getDateKey = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const getDaysOptions = (monthStr: string) => {
    const [year, month] = monthStr.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    const options = [] as { value: string; label: string }[];
    for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(year, month - 1, d);
        const dayName = date.toLocaleDateString('en-AU', { weekday: 'long' });
        const value = `${monthStr}-${String(d).padStart(2, '0')}`;
        options.push({ value, label: `${d} - ${dayName}` });
    }
    return options;
};

export function Ledger() {
    usePageTitle('Ledger');
    const [type, setType] = useState<TransactionType>('CASH');
    const [ledgers, setLedgers] = useState<MonthlyLedger[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [categories, setCategories] = useState<string[]>([]);
    const [draft, setDraft] = useState({
        date: getDateKey(new Date()),
        category: '',
        description: '',
        amount: ''
    });

    useEffect(() => {
        async function loadCategories() {
            try {
                const cats = await fetchCategories();
                setCategories(cats);
            } catch (err) {
                console.error('Failed to load categories', err);
            }
        }

        loadCategories();
    }, []);

    useEffect(() => {
        let isActive = true;

        async function load() {
            const currentDate = new Date();
            currentDate.setDate(1);
            const monthsToFetch: string[] = [];
            for (let i = 12; i >= 0; i--) {
                const date = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
                monthsToFetch.push(getMonthKey(date));
            }
            setLoading(true);
            setError(null);
            setDraft(prev => ({
                ...prev,
                date: getDateKey(new Date())
            }));
            try {
                const results = await Promise.all(
                    monthsToFetch.map(async month => {
                        const res = await apiFetch(`/ledger?type=${type}&month=${month}`);
                        const ledger = (await res.json()) as MonthlyLedger;
                        return { ...ledger, month: ledger.month || month };
                    })
                );
                if (isActive) {
                    setLedgers(results);
                }
            } catch (err) {
                console.error(err);
                if (isActive) {
                    setError('Failed to load ledger data. Please refresh and try again.');
                }
            } finally {
                if (isActive) {
                    setLoading(false);
                }
            }
        }

        load();

        return () => {
            isActive = false;
        };
    }, [type]);

    const handleDraftUpdate = (field: 'date' | 'category' | 'description' | 'amount', value: string) => {
        setDraft(prev => ({
            ...prev,
            [field]: value
        }));
    };

    const handleAddTransaction = () => {
        const currentMonth = getMonthKey(new Date());
        const currentLedger = ledgers.find(ledger => ledger.month === currentMonth);
        if (!currentLedger) {
            setError('Current month ledger not found.');
            return;
        }
        if (!draft.date || !draft.category || draft.amount === '') {
            setError('Please fill in date, category, and amount.');
            return;
        }

        const amountValue = Number(draft.amount);
        if (Number.isNaN(amountValue)) {
            setError('Amount must be a number.');
            return;
        }

        const transactions = currentLedger.transactions ?? [];
        const previousBalance = transactions.length > 0
            ? transactions[transactions.length - 1].runningBalance
            : currentLedger.openingBalance;
        const runningBalance = Number((previousBalance + amountValue).toFixed(2));

        const newTransaction = {
            id: crypto.randomUUID(),
            date: draft.date,
            category: draft.category,
            description: draft.description,
            amount: amountValue,
            runningBalance
        };

        setLedgers(prev => prev.map(ledger => {
            if (ledger.month !== currentMonth) return ledger;
            const updatedTransactions = [...transactions, newTransaction];
            return {
                ...ledger,
                transactions: updatedTransactions,
                closingBalance: runningBalance
            };
        }));

        setDraft({
            date: getDateKey(new Date()),
            category: '',
            description: '',
            amount: ''
        });
    };

    useEffect(() => {
        if (loading || ledgers.length === 0) {
            return;
        }

        const currentMonth = getMonthKey(new Date());
        const target = document.querySelector(`[data-ledger-month="${currentMonth}"]`);
        if (target) {
            target.scrollIntoView({ block: 'end', behavior: 'smooth' });
        }
    }, [loading, ledgers]);

    return (
        <div className="page-container ledger-page">
            <div className="ledger-header">
                <h1>Ledger</h1>
                <div className="type-toggle">
                    {(['BANK', 'CASH', 'CARD'] as TransactionType[]).map(t => (
                        <button
                            key={t}
                            className={`toggle-btn ${type === t ? 'active' : ''}`}
                            onClick={() => setType(t)}
                        >
                            <span className="icon">{ICONS[t]}</span>
                            {t}
                        </button>
                    ))}
                </div>
            </div>

            {error && (
                <div className="ledger-alert error" role="status">
                    <span>{error}</span>
                </div>
            )}

            {loading ? (
                <div className="loading">Loading...</div>
            ) : (
                <div className="ledger-content">
                    {ledgers.length === 0 ? (
                        <div className="loading">No ledger data available.</div>
                    ) : (
                        ledgers.map(ledger => {
                            const currentMonth = getMonthKey(new Date());
                            const monthLabel = ledger.month;
                            const transactions = ledger.transactions ?? [];
                            const isCurrentMonth = monthLabel === currentMonth;
                            return (
                                <div key={monthLabel} className="month-block" data-ledger-month={monthLabel}>
                                    <div className="month-header">
                                        <div className="month-title">
                                            <h3>{monthLabel}</h3>
                                        </div>
                                        <div className="month-actions">
                                            <div className="month-summary">
                                                <span>Opening: ${ledger.openingBalance.toFixed(2)}</span>
                                                <span>Closing: ${ledger.closingBalance.toFixed(2)}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="transactions-list">
                                        <table className="transactions-table">
                                            <thead>
                                                <tr>
                                                    <th>Date</th>
                                                    <th>Category</th>
                                                    <th>Description</th>
                                                    <th className="right">Amount</th>
                                                    <th className="right">Balance</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {transactions.map(tx => (
                                                    <tr key={tx.id}>
                                                        <td>{tx.date}</td>
                                                        <td>{tx.category}</td>
                                                        <td>{tx.description}</td>
                                                        <td className={`right ${tx.amount < 0 ? 'neg' : 'pos'}`}>
                                                            {tx.amount.toFixed(2)}
                                                        </td>
                                                        <td className="right">{tx.runningBalance.toFixed(2)}</td>
                                                    </tr>
                                                ))}
                                                {isCurrentMonth && (
                                                    <tr className="add-transaction-row">
                                                        <td>
                                                            <select
                                                                value={draft.date}
                                                                onChange={event => handleDraftUpdate('date', event.target.value)}
                                                            >
                                                                {getDaysOptions(monthLabel).map(option => (
                                                                    <option key={option.value} value={option.value}>{option.label}</option>
                                                                ))}
                                                            </select>
                                                        </td>
                                                        <td>
                                                            <select
                                                                value={draft.category}
                                                                onChange={event => handleDraftUpdate('category', event.target.value)}
                                                            >
                                                                <option value="">Select...</option>
                                                                {categories.map(category => (
                                                                    <option key={category} value={category}>{category}</option>
                                                                ))}
                                                            </select>
                                                        </td>
                                                        <td>
                                                            <input
                                                                type="text"
                                                                placeholder="Description"
                                                                value={draft.description}
                                                                onChange={event => handleDraftUpdate('description', event.target.value)}
                                                            />
                                                        </td>
                                                        <td className="right">
                                                            <input
                                                                type="number"
                                                                step="0.01"
                                                                placeholder="0.00"
                                                                className="amount-input"
                                                                value={draft.amount}
                                                                onChange={event => handleDraftUpdate('amount', event.target.value)}
                                                            />
                                                        </td>
                                                        <td className="right">
                                                            <button type="button" className="add-btn" onClick={handleAddTransaction}>
                                                                Add
                                                            </button>
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            )}
        </div>
    );
}
