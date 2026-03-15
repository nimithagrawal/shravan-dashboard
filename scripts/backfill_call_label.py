#!/usr/bin/env python3
"""
Backfill Call Label for existing Airtable records.
Classifies calls based on Summary content into one of 10 labels.

Labels (priority order — first match wins):
  1. Webinar Confirm — webinar invitation/confirmation calls
  2. Med Reorder    — medicine order or reorder discussion
  3. Doc Consult    — doctor consultation inquiry
  4. Surgery/Hosp   — surgery or hospitalization mentioned
  5. Lab Lead       — lab test / diagnostic interest
  6. Loan Need      — loan / EMI / credit discussed
  7. Cashback Issue  — cashback problem / complaint
  8. Order Complaint — order issue / complaint / refund
  9. Activation     — welcome call with successful activation / plan explanation
  10. Info Only      — general info call, no specific action

Calls without meaningful interaction (dropped, busy, no transcript) are SKIPPED.
"""

import os, time, json, math
import requests

# ── Config ──
PAT = os.environ.get('AIRTABLE_PAT', '')
if not PAT:
    raise SystemExit('Error: Set AIRTABLE_PAT environment variable')
BASE = 'appC3a0Xi7ecuoAwC'
TABLE = 'tbl4DUqAL8U7f5snL'
API = f'https://api.airtable.com/v0/{BASE}/{TABLE}'
HEADERS = {
    'Authorization': f'Bearer {PAT}',
    'Content-Type': 'application/json',
}

# Field IDs
FLD_SUMMARY = 'fldo69WtAnqeHnAMc'
FLD_CALL_LABEL = 'fld6fMsEezSvHf5B8'
FLD_OUTCOME = 'fldlcUwZdB9ev0ITa'
FLD_DURATION = 'fldi3cMh4gkeat5gx'

def classify(summary):
    """Classify a call summary into a Call Label. Returns None to skip."""
    if not summary:
        return None
    s = summary.lower()

    # Skip non-interaction summaries
    skip_phrases = [
        'no transcript', 'stt failed', 'did not connect', 'no interaction',
        'no human interaction', 'busy tone', 'number was busy',
        'not answering', 'not picking up', 'call dropped after',
        'no meaningful interaction', 'no discernible interaction',
        'automated message', 'ivr message', 'voicemail',
        'no response from the subscriber',
    ]
    # If summary is dominated by skip phrases and short, skip
    if any(p in s for p in skip_phrases):
        # But if there's also meaningful content (long summary), still try to classify
        if len(summary) < 120:
            return None

    # 1. Webinar Confirm
    if 'webinar' in s or ('webinar' in s and 'link' in s):
        return 'Webinar Confirm'

    # 2. Med Reorder — medicine order, prescription, refill
    med_keywords = ['medicine order', 'med order', 'reorder', 'refill', 'prescription',
                     'pharma order', 'tablet order', 'buy medicine', 'order medicine',
                     'medicine purchase', 'medicine delivery']
    if any(k in s for k in med_keywords):
        return 'Med Reorder'

    # 3. Doc Consult — doctor, consultation, OPD, specialist
    doc_keywords = ['doctor consult', 'doctor appointment', 'opd', 'specialist',
                     'consult a doctor', 'see a doctor', 'medical consultation',
                     'tele-consult', 'teleconsult', 'video consult',
                     'free doctor', 'doctor visit']
    if any(k in s for k in doc_keywords):
        return 'Doc Consult'

    # 4. Surgery/Hosp — surgery, hospitalization, admission
    surg_keywords = ['surgery', 'hospitalization', 'hospital admission', 'operation',
                      'admitted', 'icu', 'inpatient', 'surgical']
    if any(k in s for k in surg_keywords):
        return 'Surgery/Hosp'

    # 5. Lab Lead — lab test, diagnostic, blood test, pathology
    lab_keywords = ['lab test', 'blood test', 'diagnostic', 'pathology', 'test report',
                     'medical test', 'health check', 'check-up', 'checkup',
                     'lab report', 'thyroid', 'sugar test', 'diabetes test',
                     'urine test', 'x-ray', 'mri', 'ct scan', 'ultrasound']
    if any(k in s for k in lab_keywords):
        return 'Lab Lead'

    # 6. Loan Need — loan, EMI, credit, finance
    loan_keywords = ['loan', 'emi', 'credit', 'finance', 'borrow', 'installment']
    # Exclude "mistaking it for a bank loan" type contexts
    if any(k in s for k in loan_keywords):
        # Check it's a genuine loan inquiry, not confusion
        if 'mistaking' not in s and 'confused' not in s:
            return 'Loan Need'

    # 7. Cashback Issue — cashback with problem/complaint context
    if 'cashback' in s:
        issue_ctx = ['issue', 'problem', 'not received', 'not credited', 'denied',
                      'complaint', 'where is', 'how to get', 'haven\'t received',
                      'didn\'t receive', 'not showing', 'missing']
        if any(k in s for k in issue_ctx):
            return 'Cashback Issue'

    # 8. Order Complaint — complaint, delivery issue, refund
    complaint_keywords = ['complaint', 'order issue', 'delivery problem', 'refund',
                           'wrong product', 'return', 'damaged', 'not delivered',
                           'order cancelled', 'dissatisfied']
    if any(k in s for k in complaint_keywords):
        return 'Order Complaint'

    # 9. Activation — welcome call with successful activation/plan explanation
    activation_keywords = ['welcome call', 'recently activated', 'plan activated',
                            'health plan', 'ayushpay', 'medical wallet',
                            'send hi', 'send \'hi\'', 'activate', 'portal link',
                            'whatsapp link', 'cashback', 'plan purchase',
                            'plan explanation', 'benefits']
    if any(k in s for k in activation_keywords):
        # Check it's not a denied/rejected call
        denied = ['denied', 'not interested', 'refused', 'rejected', 'wrong number',
                   'no such plan']
        if any(d in s for d in denied):
            return 'Info Only'
        return 'Activation'

    # 10. If we have a meaningful summary but it doesn't match any specific label
    if len(summary) > 60:
        return 'Info Only'

    return None

def fetch_all_records():
    """Fetch all records with Summary, excluding those already labeled."""
    all_records = []
    offset = None

    while True:
        params = {
            'pageSize': '100',
            'fields[]': [FLD_SUMMARY, FLD_CALL_LABEL, FLD_OUTCOME, FLD_DURATION],
            'filterByFormula': f'AND({{Summary}}!="", {{Call Label}}="")',
        }
        if offset:
            params['offset'] = offset

        resp = requests.get(API, headers=HEADERS, params=params)
        if resp.status_code != 200:
            print(f'Error fetching: {resp.status_code} {resp.text}')
            break

        data = resp.json()
        records = data.get('records', [])
        all_records.extend(records)
        print(f'  Fetched {len(all_records)} records so far...')

        offset = data.get('offset')
        if not offset:
            break

    return all_records

def update_batch(updates):
    """Update up to 10 records at a time."""
    resp = requests.patch(API, headers=HEADERS, json={
        'records': updates,
        'typecast': True,
    })
    if resp.status_code != 200:
        print(f'  Error updating batch: {resp.status_code} {resp.text}')
        return False
    return True

def main():
    print('=== Call Label Backfill ===')
    print()

    # 1. Fetch all unlabeled records with summaries
    print('Fetching records without Call Label...')
    records = fetch_all_records()
    print(f'Found {len(records)} records to classify')
    print()

    # 2. Classify each record
    to_update = []
    label_counts = {}

    for r in records:
        summary = r.get('fields', {}).get('Summary', '')
        label = classify(summary)
        if label:
            to_update.append({
                'id': r['id'],
                'fields': {'Call Label': label},
            })
            label_counts[label] = label_counts.get(label, 0) + 1

    print(f'Classification results:')
    for label, count in sorted(label_counts.items(), key=lambda x: -x[1]):
        print(f'  {label}: {count}')
    skipped = len(records) - len(to_update)
    print(f'  (Skipped/no-label: {skipped})')
    print(f'Total to update: {len(to_update)}')
    print()

    if not to_update:
        print('Nothing to update!')
        return

    # 3. Update in batches of 10
    batches = math.ceil(len(to_update) / 10)
    print(f'Updating in {batches} batches...')

    success = 0
    for i in range(0, len(to_update), 10):
        batch = to_update[i:i+10]
        batch_num = i // 10 + 1
        if update_batch(batch):
            success += len(batch)
            print(f'  Batch {batch_num}/{batches}: ✓ ({success} done)')
        else:
            print(f'  Batch {batch_num}/{batches}: ✗ FAILED')

        # Rate limit: Airtable allows 5 requests/sec
        if batch_num < batches:
            time.sleep(0.25)

    print()
    print(f'=== Done! Updated {success}/{len(to_update)} records ===')

if __name__ == '__main__':
    main()
