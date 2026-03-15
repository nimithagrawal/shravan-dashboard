#!/usr/bin/env python3
"""
Backfill Call Label for existing Airtable records.
Uses new 11-label taxonomy (first match wins):

  1. Activated        — subscriber sent Hi + welcome confirmed
  2. Webinar Confirmed — link received + will join
  3. Complaint        — dispute, wrong cashback, order issue
  4. Medicine Lead    — subscriber mentioned ongoing medicine need
  5. Lab Lead         — subscriber mentioned diagnostic/lab test
  6. Callback Set     — subscriber gave specific callback time
  7. Not Interested   — explicit rejection
  8. No Connect       — IVR/voicemail/busy/STT Failed/duration<20s
  9. Wrong Number     — reached wrong person
  10. Busy / Later    — connected briefly, busy, no specific time
  11. Engaged         — real conversation, positive, no specific outcome
"""

import os, time, math
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

FLD_SUMMARY = 'fldo69WtAnqeHnAMc'
FLD_CALL_LABEL = 'fld6fMsEezSvHf5B8'
FLD_OUTCOME = 'fldlcUwZdB9ev0ITa'
FLD_DURATION = 'fldi3cMh4gkeat5gx'


def classify(summary, outcome='', duration=0):
    """Classify a call summary into one of 11 labels. First match wins."""
    if not summary:
        return 'No Connect'
    s = summary.lower()

    # ── No Connect: IVR/voicemail/busy/STT Failed/short ──
    no_connect_phrases = [
        'stt failed', 'no transcript', 'did not connect', 'no interaction',
        'no human interaction', 'busy tone', 'number was busy',
        'not answering', 'not picking up', 'automated message',
        'ivr message', 'voicemail', 'voice mail', 'exotel',
        'no response from the subscriber', 'no discernible interaction',
        'no meaningful interaction', 'automated busy',
    ]
    if duration and duration < 20:
        return 'No Connect'
    if any(p in s for p in no_connect_phrases) and len(summary) < 150:
        return 'No Connect'

    # ── Wrong Number: reached wrong person ──
    wrong_kw = ['wrong number', 'wrong person', 'denied having',
                'denied purchasing', 'not the actual', 'not the subscriber',
                'denied having taken any such plan', 'no such plan',
                'customer denied', 'subscriber denied']
    if any(k in s for k in wrong_kw):
        return 'Wrong Number'

    # ── Not Interested: explicit rejection ──
    reject_kw = ['not interested', 'refused', 'declined', 'do not call',
                  'mujhe nahi chahiye', 'mat karo', 'rejected the',
                  'hung up', 'immediately terminated', 'hostile',
                  'permanently refused']
    if any(k in s for k in reject_kw):
        return 'Not Interested'

    # ── Complaint: dispute, issue, complaint ──
    complaint_kw = ['complaint', 'dispute', 'dissatisfied', 'frustrated',
                     'angry', 'upset', 'wrong cashback', 'cashback not',
                     'not received cashback', 'refund', 'order issue',
                     'delivery problem', 'wrong product', 'not delivered']
    if any(k in s for k in complaint_kw):
        return 'Complaint'

    # ── Activated: subscriber sent Hi + welcome confirmed ──
    activated_kw = ['sent hi', 'send hi', "send 'hi'", 'sent a hi',
                     'subscriber successfully', 'which the subscriber successfully did',
                     'successfully activated', 'activation complete',
                     'confirmed receipt', 'wallet activated']
    if any(k in s for k in activated_kw):
        return 'Activated'

    # ── Webinar Confirmed: link received + will join ──
    if 'webinar' in s:
        confirm_kw = ['confirmed', 'will join', 'agreed to join', 'attend',
                       'confirmed receiving', 'confirmed they would',
                       'reply ok', 'confirmed their attendance']
        if any(k in s for k in confirm_kw):
            return 'Webinar Confirmed'
        return 'Webinar Confirmed'  # all webinar calls are confirmations

    # ── Medicine Lead: subscriber mentioned ongoing medicine need ──
    med_kw = ['medicine order', 'medicine need', 'medication', 'prescription',
               'tablet order', 'dawa', 'refill', 'pharma', 'buy medicine',
               'order medicine', 'ongoing medicine']
    if any(k in s for k in med_kw):
        return 'Medicine Lead'

    # ── Lab Lead: subscriber mentioned diagnostic/lab test ──
    lab_kw = ['lab test', 'blood test', 'diagnostic', 'pathology', 'test report',
               'health check', 'checkup', 'check-up', 'thyroid', 'sugar test',
               'diabetes test', 'x-ray', 'mri', 'ct scan', 'ultrasound',
               'urine test', 'lab report']
    if any(k in s for k in lab_kw):
        return 'Lab Lead'

    # ── Callback Set: subscriber gave specific callback time ──
    callback_specific = ['callback after', 'call back after', 'call back at',
                          'callback in', 'call back in', 'callback at',
                          'call later at', 'call tomorrow', 'callback tomorrow',
                          'call back tomorrow', 'next day', 'callback for',
                          'requested a callback after', 'agreed to a callback']
    if any(k in s for k in callback_specific):
        # Must have a time/day reference, not just vague "call back"
        has_time = any(t in s for t in ['pm', 'am', 'minute', 'hour',
                                          'tomorrow', 'monday', 'tuesday',
                                          'wednesday', 'thursday', 'friday',
                                          'saturday', 'sunday', 'kal',
                                          '30 min', 'half an hour',
                                          'after 5', 'after 4', 'after 3',
                                          'after 6', 'after 2', 'after 1',
                                          'few days', 'next day'])
        if has_time:
            return 'Callback Set'

    # ── Busy / Later: connected but busy, no specific time ──
    busy_kw = ['busy', 'stated they were busy', 'subscriber was busy',
                'minimal response', 'could not establish', 'disengaged',
                'early termination', 'communication issue',
                'no clear interaction', 'call later']
    if any(k in s for k in busy_kw):
        return 'Busy / Later'

    # ── Engaged: real conversation, positive engagement ──
    engage_kw = ['explained the benefits', 'guided the subscriber',
                  'confirmed the purchase', 'confirmed they are a customer',
                  'check whatsapp', 'portal login', 'plan explanation',
                  'informed about', 'cashback', 'medical wallet',
                  'health plan', 'welcome call', 'ayushpay',
                  'recently activated', 'plan activated']
    if any(k in s for k in engage_kw):
        return 'Engaged'

    # Fallback: if there's a meaningful summary
    if len(summary) > 80:
        return 'Engaged'

    return 'No Connect'


def fetch_all_records():
    """Fetch ALL records (including already-labeled ones for re-classification)."""
    all_records = []
    offset = None
    while True:
        params = {
            'pageSize': '100',
            'fields[]': [FLD_SUMMARY, FLD_CALL_LABEL, FLD_OUTCOME, FLD_DURATION],
        }
        if offset:
            params['offset'] = offset
        resp = requests.get(API, headers=HEADERS, params=params)
        if resp.status_code != 200:
            print(f'Error fetching: {resp.status_code} {resp.text}')
            break
        data = resp.json()
        all_records.extend(data.get('records', []))
        print(f'  Fetched {len(all_records)} records...')
        offset = data.get('offset')
        if not offset:
            break
    return all_records


def update_batch(updates):
    resp = requests.patch(API, headers=HEADERS, json={
        'records': updates,
        'typecast': True,
    })
    if resp.status_code != 200:
        print(f'  Error: {resp.status_code} {resp.text[:200]}')
        return False
    return True


def main():
    print('=== Call Label Backfill (v2 — 11 labels) ===\n')

    print('Fetching ALL records...')
    records = fetch_all_records()
    print(f'Found {len(records)} total records\n')

    to_update = []
    label_counts = {}

    for r in records:
        fields = r.get('fields', {})
        summary = fields.get('Summary', '')
        outcome = fields.get('Call Outcome', '')
        duration = fields.get('Duration Seconds', 0) or 0

        label = classify(summary, outcome, duration)
        current = fields.get('Call Label', '')
        # Convert Airtable singleSelect object to string if needed
        if isinstance(current, dict):
            current = current.get('name', '')

        if label and label != current:
            to_update.append({
                'id': r['id'],
                'fields': {'Call Label': label},
            })
            label_counts[label] = label_counts.get(label, 0) + 1

    print('Classification results:')
    for label, count in sorted(label_counts.items(), key=lambda x: -x[1]):
        print(f'  {label}: {count}')
    unchanged = len(records) - len(to_update)
    print(f'  (Unchanged: {unchanged})')
    print(f'Total to update: {len(to_update)}\n')

    if not to_update:
        print('Nothing to update!')
        return

    batches = math.ceil(len(to_update) / 10)
    print(f'Updating in {batches} batches...')

    success = 0
    for i in range(0, len(to_update), 10):
        batch = to_update[i:i+10]
        batch_num = i // 10 + 1
        if update_batch(batch):
            success += len(batch)
            if batch_num % 10 == 0 or batch_num == batches:
                print(f'  Batch {batch_num}/{batches}: ✓ ({success} done)')
        else:
            print(f'  Batch {batch_num}/{batches}: ✗ FAILED')
        if batch_num < batches:
            time.sleep(0.25)

    print(f'\n=== Done! Updated {success}/{len(to_update)} records ===')


if __name__ == '__main__':
    main()
