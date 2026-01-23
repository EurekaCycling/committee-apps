import { useState, useEffect, useMemo } from 'react';
import { fetchLedger, saveLedger } from '../api';
import type { MonthlyLedger, TransactionType, Transaction } from '../mocks/ledgerData';
import { CATEGORIES } from '../mocks/ledgerData';
import { FaMoneyBillWave, FaUniversity, FaCreditCard, FaPlus, FaUnlock, FaLock } from 'react-icons/fa';
import './Ledger.css';

const ICONS = {
    CASH: <FaMoneyBillWave />,
    BANK: <FaUniversity />,
    CARD: <FaCreditCard />
};

import { usePageTitle } from '../hooks/usePageTitle';

export function Ledger() {
    usePageTitle('Ledger');
    const [type, setType] = useState<TransactionType>('BANK');
    const [data, setData] = useState<MonthlyLedger[]>([]);
    const [loading, setLoading] = useState(false);
    const [openMonths, setOpenMonths] = useState<Set<string>>(new Set());
    const [categories, setCategories] = useState<string[]>(CATEGORIES);

    // New transaction forms state: month -> transaction fields
    const [newTxDrafts, setNewTxDrafts] = useState<Record<string, Partial<Transaction>>>({});

    // Fetch data when Type toggles
    useEffect(() => {
        async function load() {
            setLoading(true);
            try {
                const result = await fetchLedger(type);
                setData(result);
                // Open the last month by default
                if (result.length > 0) {
                    setOpenMonths(new Set([result[result.length - 1].month]));
                }
            } catch (err) {
                console.error(err);
                alert('Failed to load ledger');
            } finally {
                setLoading(false);
            }
        }
        load();
    }, [type]);

    const toggleOpenMonth = (month: string) => {
        setOpenMonths(prev => {
            const next = new Set(prev);
            if (next.has(month)) {
                next.delete(month);
            } else {
                next.add(month);
            }
            return next;
        });
    };

    const handleDraftUpdate = (month: string, field: keyof Transaction, value: any) => {
        setNewTxDrafts(prev => ({
            ...prev,
            [month]: {
                ...prev[month],
                [field]: value
            }
        }));
    };

    const handleAddTransaction = async (monthStr: string) => {
        const draft = newTxDrafts[monthStr];
        if (!draft?.date || !draft?.category || draft?.amount === undefined) {
            alert('Please fill in all fields (description is optional)');
            return;
        }

        const newTx: Transaction = {
            id: crypto.randomUUID(),
            date: draft.date,
            category: draft.category,
            description: draft.description || '',
            amount: Number(draft.amount),
            runningBalance: 0, // Will be recalculated
        };

        const updatedData = data.map(m => {
            if (m.month !== monthStr) return m;
            return {
                ...m,
                transactions: [...m.transactions, newTx]
            };
        });

        // Optimistically update local state
        setData(updatedData);

        // Save to backend
        try {
            await saveLedger(type, updatedData);
        } catch (err) {
            console.error(err);
            alert('Failed to save ledger to server. Please try again.');
            // Revert on failure might be complex, but at least user knows
        }

        // Reset draft
        setNewTxDrafts(prev => ({
            ...prev,
            [monthStr]: {}
        }));
    };

    const handleCategoryChange = (month: string, val: string) => {
        if (val === 'ADD_NEW') {
            const newCat = prompt('Enter new category name:');
            if (newCat && !categories.includes(newCat)) {
                setCategories(prev => [...prev, newCat]);
                handleDraftUpdate(month, 'category', newCat);
            }
        } else {
            handleDraftUpdate(month, 'category', val);
        }
    };

    const getDaysOptions = (monthStr: string) => {
        const [year, month] = monthStr.split('-').map(Number);
        const daysInMonth = new Date(year, month, 0).getDate();
        const options = [];
        for (let d = 1; d <= daysInMonth; d++) {
            const date = new Date(year, month - 1, d);
            const dayName = date.toLocaleDateString('en-AU', { weekday: 'long' });
            const value = `${monthStr}-${String(d).padStart(2, '0')}`;
            options.push({ value, label: `${d} - ${dayName}` });
        }
        return options;
    };

    // Helper to get sorted transactions and recalculated balances
    const getProcessedData = useMemo(() => {
        if (data.length === 0 && !loading) return [];

        // 1. Ensure current month is included
        const today = new Date();
        const currentMonthStr = today.toISOString().slice(0, 7);

        let processedMonths = [...data];
        if (!processedMonths.some(m => m.month === currentMonthStr)) {
            processedMonths.push({
                pk: `TEMP#${type}#${currentMonthStr}`,
                month: currentMonthStr,
                type,
                openingBalance: 0,
                closingBalance: 0,
                transactions: [],
                isOpen: true
            });
        }

        // 2. Sort months chronologically for calculation
        processedMonths.sort((a, b) => a.month.localeCompare(b.month));

        // 3. Propagate balances
        let carryOverBalance = processedMonths[0]?.openingBalance || 0;

        const results = processedMonths.map((month) => {
            const currentOpeningBalance = carryOverBalance;
            const sortedTxs = [...month.transactions].sort((a, b) => {
                const dateComp = a.date.localeCompare(b.date);
                return dateComp !== 0 ? dateComp : 0; // Stability handles sequence
            });

            let running = currentOpeningBalance;
            const txsWithBal = sortedTxs.map(tx => {
                running = Number((running + tx.amount).toFixed(2));
                return { ...tx, runningBalance: running };
            });

            const currentClosingBalance = running;
            carryOverBalance = currentClosingBalance;

            return {
                ...month,
                openingBalance: currentOpeningBalance,
                closingBalance: currentClosingBalance,
                transactions: txsWithBal
            };
        });

        // 4. Return results (chronological order)
        return results;
    }, [data, loading, type]);

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

            {loading ? (
                <div className="loading">Loading...</div>
            ) : (
                <div className="ledger-content">
                    {getProcessedData.map(month => {
                        const isOpen = openMonths.has(month.month);
                        const draft = newTxDrafts[month.month] || {};

                        return (
                            <div key={month.month} className={`month-block ${isOpen ? 'is-open' : ''}`}>
                                <div className="month-header" onClick={() => toggleOpenMonth(month.month)} title="Click to toggle open/closed for editing">
                                    <div className="month-title">
                                        <span className="lock-icon">{isOpen ? <FaUnlock /> : <FaLock />}</span>
                                        <h3>{month.month}</h3>
                                    </div>
                                    <div className="month-summary">
                                        <span>Opening: ${month.openingBalance.toFixed(2)}</span>
                                        <span>Closing: ${month.closingBalance.toFixed(2)}</span>
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
                                            {month.transactions.map(tx => (
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

                                            {isOpen && (
                                                <tr className="add-transaction-row">
                                                    <td>
                                                        <select
                                                            value={draft.date || ''}
                                                            onChange={e => handleDraftUpdate(month.month, 'date', e.target.value)}
                                                        >
                                                            <option value="">Day...</option>
                                                            {getDaysOptions(month.month).map(opt => (
                                                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                            ))}
                                                        </select>
                                                    </td>
                                                    <td>
                                                        <select
                                                            value={draft.category || ''}
                                                            onChange={e => handleCategoryChange(month.month, e.target.value)}
                                                        >
                                                            <option value="">Select...</option>
                                                            {categories.map(c => <option key={c} value={c}>{c}</option>)}
                                                            <option value="ADD_NEW">+ Add New...</option>
                                                        </select>
                                                    </td>
                                                    <td>
                                                        <input
                                                            type="text"
                                                            placeholder="Description"
                                                            value={draft.description || ''}
                                                            onChange={e => handleDraftUpdate(month.month, 'description', e.target.value)}
                                                        />
                                                    </td>
                                                    <td className="right">
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            placeholder="0.00"
                                                            className="amount-input"
                                                            value={draft.amount ?? ''}
                                                            onChange={e => handleDraftUpdate(month.month, 'amount', e.target.value)}
                                                        />
                                                    </td>
                                                    <td className="right">
                                                        <button className="add-btn" onClick={() => handleAddTransaction(month.month)}>
                                                            <FaPlus /> Add
                                                        </button>
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
