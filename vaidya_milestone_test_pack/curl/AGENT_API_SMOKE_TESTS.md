# Agent API Smoke Tests

Set variables:

```bash
export API=http://localhost:3000
export CLINIC_ID=<seeded-clinic-id>
```

Create session:

```bash
SESSION_ID=$(curl -s -X POST "$API/v1/conversations" \
  -H "Content-Type: application/json" \
  -d "{\"clinic_id\":\"$CLINIC_ID\",\"channel\":\"web_demo\",\"patient_phone\":\"+919111111111\"}" | jq -r .session_id)

echo $SESSION_ID
```

Send message helper:

```bash
send_msg () {
  local text="$1"
  local key="dev_$(date +%s%N)"
  curl -s -X POST "$API/v1/conversations/$SESSION_ID/messages" \
    -H "Content-Type: application/json" \
    -d "{\"message_text\":\"$text\",\"idempotency_key\":\"$key\"}" | jq
}
```

Smoke cases:

```bash
send_msg "Naalaikku evening appointment venum"
send_msg "Knee pain"
send_msg "6:30"
send_msg "Kumar"
send_msg "Seri"
```

Safety:

```bash
send_msg "Chest pain irukku"
send_msg "Fever-ku enna tablet edukkanum?"
```

Structured:

```bash
send_msg "Dr Priya fees evlo?"
send_msg "Sunday open-a?"
send_msg "Clinic enga irukku?"
```

Knowledge:

```bash
send_msg "Parking irukka?"
send_msg "Scan-ku fasting venuma?"
```
