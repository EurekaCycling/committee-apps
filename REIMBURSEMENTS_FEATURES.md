# Reimbursements Features

## Goals
- Make expenses easy to submit, review, approve, and report.

## Roles
- Requester: creates and edits reimbursement requests, uploads receipts.
- Approvers: 2x signs off on eligible reimbursements.
- Treasurer/Finance: triggers payouts and reconciles payments.
- Admin: manages policies, categories, and permissions.

## Request Creation
- Upload, Drag in or take photo (Mobile) to upload a receipt.
- Create UUID for each
- Category/Description
- Select member if they are already on file, add member with bank details
  - PayId (Phone Number/Email)
  - or BSB/Account Number
- Purchase Date and amount

## Receipt Handling
- Accept PDF, JPG, and PNG receipts with file size limits.

## Approval Workflow
- Send SMS to treasurer with direct link to reimbursement.
- Mark as approved
- Create Payment in Bank
- Mark as payment pending
- Once 2 signers approve payment mark as paid

## Statuses
- Pending Approval, Approved, Pending Payment, Paid, Reconciled, Rejected
- Record each transition with time and user who actioned it.

## Admin
- Main page list by time, filter out Reconciled and Rejected (no-action required)
- Bank/Cash transactions in ledgers can be linked to paid reimbursement to reconcile.
- Form to create new is below the list.

# Data
- stored in s3 data bucket
- folder per year
- /reimbursement/YYYY/UUID-metadata.json
- /reimbursement/YYYY/UUID-receipt.ext
- /reimbursement/list.json Reference (YYYY/UUID), Status, Title (Text: Member Category Desc), Amount
- /reimbursement/members.json