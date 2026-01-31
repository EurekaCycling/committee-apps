import { useState } from 'react';
import { usePageTitle } from '../hooks/usePageTitle';
import './Reimbursements.css';

type MemberMode = 'existing' | 'new';
type PaymentMethod = 'payid' | 'bank';

const buildRequestId = () => crypto.randomUUID();

export function Reimbursements() {
    usePageTitle('Reimbursements');
    const [requestId, setRequestId] = useState(buildRequestId);
    const [memberMode, setMemberMode] = useState<MemberMode>('existing');
    const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('payid');
    const [receiptName, setReceiptName] = useState<string>('');

    const handleReceiptChange = (file?: File | null) => {
        if (file) {
            setReceiptName(file.name);
        }
    };

    const handleReceiptInput = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        handleReceiptChange(file);
    };

    const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        const file = event.dataTransfer.files?.[0];
        handleReceiptChange(file);
    };

    const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setRequestId(buildRequestId());
        setReceiptName('');
    };

    return (
        <div className="page-container reimbursements-page">
            <div className="reimbursements-header">
                <div>
                    <h1>Reimbursements</h1>
                    <p>Submit and view reimbursement requests.</p>
                </div>
                <div className="request-id">
                    <span>Request ID</span>
                    <strong>{requestId}</strong>
                </div>
            </div>

            <div className="reimbursements-list card">
                <div className="list-header">
                    <h2>Recent requests</h2>
                    <span className="list-note">Pending approval, payments, and reconciliations appear here.</span>
                </div>
                <div className="list-empty">
                    <p>No reimbursement requests yet.</p>
                    <p>Create one below to get started.</p>
                </div>
            </div>

            <div className="reimbursements-form card">
                <form onSubmit={handleSubmit}>
                    <div className="form-section">
                        <div className="section-header">
                            <h2>Receipt</h2>
                            <span>PDF, JPG, or PNG</span>
                        </div>
                        <div
                            className="receipt-dropzone"
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={handleDrop}
                        >
                            <div className="receipt-actions">
                                <label className="btn-outline" htmlFor="receipt-upload">
                                    Upload receipt
                                </label>
                                <label className="btn-secondary" htmlFor="receipt-camera">
                                    Take photo
                                </label>
                            </div>
                            <p className="receipt-hint">Drag and drop a file here or use the buttons above.</p>
                            <p className="receipt-filename">{receiptName || 'No receipt selected yet.'}</p>
                            <input
                                id="receipt-upload"
                                type="file"
                                accept="application/pdf,image/jpeg,image/png"
                                onChange={handleReceiptInput}
                                hidden
                            />
                            <input
                                id="receipt-camera"
                                type="file"
                                accept="image/*"
                                capture="environment"
                                onChange={handleReceiptInput}
                                hidden
                            />
                        </div>
                    </div>

                    <div className="form-section">
                        <div className="section-header">
                            <h2>Request details</h2>
                            <span>Describe the purchase and attach the receipt.</span>
                        </div>
                        <div className="form-grid">
                            <label className="field">
                                <span>Category</span>
                                <input
                                    type="text"
                                    name="category"
                                    placeholder="Equipment, Event Fee, Membership"
                                    data-testid="reimbursement-category"
                                />
                            </label>
                            <label className="field">
                                <span>Purchase date</span>
                                <input
                                    type="date"
                                    name="purchaseDate"
                                    data-testid="reimbursement-purchase-date"
                                />
                            </label>
                            <label className="field">
                                <span>Amount</span>
                                <input
                                    type="number"
                                    name="amount"
                                    step="0.01"
                                    placeholder="0.00"
                                    data-testid="reimbursement-amount"
                                />
                            </label>
                            <label className="field span-2">
                                <span>Description</span>
                                <textarea
                                    name="description"
                                    rows={3}
                                    placeholder="What was purchased and why?"
                                    data-testid="reimbursement-description"
                                />
                            </label>
                        </div>
                    </div>

                    <div className="form-section">
                        <div className="section-header">
                            <h2>Member</h2>
                            <span>Select an existing member or add a new one with bank details.</span>
                        </div>
                        <div className="member-toggle">
                            <label>
                                <input
                                    type="radio"
                                    name="memberMode"
                                    checked={memberMode === 'existing'}
                                    onChange={() => setMemberMode('existing')}
                                />
                                Existing member
                            </label>
                            <label>
                                <input
                                    type="radio"
                                    name="memberMode"
                                    checked={memberMode === 'new'}
                                    onChange={() => setMemberMode('new')}
                                />
                                Add new member
                            </label>
                        </div>

                        {memberMode === 'existing' ? (
                            <div className="form-grid">
                                <label className="field span-2">
                                    <span>Member on file</span>
                                    <input
                                        type="text"
                                        name="memberSearch"
                                        placeholder="Start typing a member name"
                                        data-testid="reimbursement-member-search"
                                    />
                                </label>
                                <p className="field-note span-2">Selected members should already have payout details on file.</p>
                            </div>
                        ) : (
                            <div className="form-grid">
                                <label className="field">
                                    <span>Full name</span>
                                    <input
                                        type="text"
                                        name="memberName"
                                        placeholder="Member name"
                                        data-testid="reimbursement-member-name"
                                    />
                                </label>
                                <label className="field">
                                    <span>Email</span>
                                    <input
                                        type="email"
                                        name="memberEmail"
                                        placeholder="member@email.com"
                                        data-testid="reimbursement-member-email"
                                    />
                                </label>
                                <label className="field">
                                    <span>Phone</span>
                                    <input
                                        type="tel"
                                        name="memberPhone"
                                        placeholder="0400 000 000"
                                        data-testid="reimbursement-member-phone"
                                    />
                                </label>
                                <div className="field span-2">
                                    <span>Payment method</span>
                                    <div className="member-toggle">
                                        <label>
                                            <input
                                                type="radio"
                                                name="paymentMethod"
                                                checked={paymentMethod === 'payid'}
                                                onChange={() => setPaymentMethod('payid')}
                                            />
                                            PayID (phone or email)
                                        </label>
                                        <label>
                                            <input
                                                type="radio"
                                                name="paymentMethod"
                                                checked={paymentMethod === 'bank'}
                                                onChange={() => setPaymentMethod('bank')}
                                            />
                                            BSB + account number
                                        </label>
                                    </div>
                                </div>
                                {paymentMethod === 'payid' ? (
                                    <label className="field span-2">
                                        <span>PayID</span>
                                        <input
                                            type="text"
                                            name="payId"
                                            placeholder="Phone number or email"
                                            data-testid="reimbursement-payid"
                                        />
                                    </label>
                                ) : (
                                    <>
                                        <label className="field">
                                            <span>BSB</span>
                                            <input
                                                type="text"
                                                name="bsb"
                                                placeholder="123-456"
                                                data-testid="reimbursement-bsb"
                                            />
                                        </label>
                                        <label className="field">
                                            <span>Account number</span>
                                            <input
                                                type="text"
                                                name="accountNumber"
                                                placeholder="12345678"
                                                data-testid="reimbursement-account-number"
                                            />
                                        </label>
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="form-actions">
                        <button type="submit" className="btn-primary" data-testid="reimbursement-submit">Submit request</button>
                        <button type="button" className="btn-secondary" data-testid="reimbursement-save-draft">Save draft</button>
                    </div>
                </form>
            </div>
        </div>
    );
}
