# Bug report: `SUBMIT_APPOINTMENT` fails for every request

## Summary

The appointment booking endpoint (`DoctorController.SUBMIT_APPOINTMENT`) currently throws
an unhandled `System.FormatException` on every call, regardless of what data is sent. No
appointment can currently be booked through this endpoint — not via the MCP integration,
not via a direct call to the same backend endpoint, and (based on your own WhatsApp bot's
prompt already containing defensive language for this exact failure) apparently not
through your own WhatsApp bot integration either.

## Evidence

Direct POST to `https://salemuatapi.alsalamhosp.com:446/submit_appointment` with a
complete, valid payload (real branch/clinic/doctor IDs, a real open schedule slot, a
correctly formatted date, a valid phone number) returns HTTP 200 with this body:

```json
{
  "ClassName": "System.FormatException",
  "Message": "Input string was not in a correct format.",
  "Data": null,
  "InnerException": null,
  "HelpURL": null,
  "StackTraceString": "   at System.Number.StringToNumber(String str, NumberStyles options, NumberBuffer& number, NumberFormatInfo info, Boolean parseDecimal)\r\n   at System.Number.ParseInt32(String s, NumberStyles style, NumberFormatInfo info)\r\n   at System.Int16.Parse(String s, NumberStyles style, NumberFormatInfo info)\r\n   at System.Convert.ToInt16(String value)\r\n   at MobileApi.Controllers.DoctorController.SUBMIT_APPOINTMENT(Reserve reservation) in F:\\primecare19062023\\PrimeCare\\PrimeCareSolution\\MobileApi\\MobileApi\\Controllers\\MedicalRecord\\DoctorController.cs:line 1458",
  "RemoteStackTraceString": null,
  "RemoteStackIndex": 0,
  "ExceptionMethod": "8\nStringToNumber\nmscorlib, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089\nSystem.Number\nVoid StringToNumber(String, System.Globalization.NumberStyles, NumberBuffer ByRef, System.Globalization.NumberFormatInfo, Boolean)",
  "HResult": -2146233033,
  "Source": "mscorlib",
  "WatsonBuckets": null
}
```

- **File / line**: `DoctorController.cs:1458` (path on your server:
  `F:\primecare19062023\PrimeCare\PrimeCareSolution\MobileApi\MobileApi\Controllers\MedicalRecord\DoctorController.cs`)
- **Root cause**: `Convert.ToInt16(string)` is being called on some field in the
  `Reserve` reservation object, and the value being converted doesn't fit — either
  because it's an empty string, or because it's a numeric value larger than
  `Int16.MaxValue` (32,767). Several of the fields a real booking must send are
  routinely larger than that (a schedule serial like `105657`, a doctor ID like
  `2000017`, an 8-digit local phone number like `66777907`), so if any of those is
  the field being parsed as `Int16` instead of `Int32`/`Int64`, this will fail for
  every real booking, unconditionally.

## What was ruled out on our end

To confirm this isn't something wrong with what we're sending, we varied every field in
isolation across multiple calls: real vs. small dummy `DOC_ID`, real vs. small dummy
`SCHED_SERIAL`, real vs. small dummy `PAT_TEL`, empty vs. populated `PATIENT_ID`, present
vs. absent optional `SPECIALTY_ID`, and explicit vs. default `buffer_status` / `INIT` /
`COMPUTER_NAME`. Every combination produced the **exact same exception at the exact same
line**. We also called the backend endpoint directly over HTTP, bypassing our MCP
integration entirely — same exception, same line. This rules out anything specific to our
integration; the bug is unconditional inside `SUBMIT_APPOINTMENT` itself.

## Suggested fix

Check every `Convert.ToInt16(...)` call inside `DoctorController.SUBMIT_APPOINTMENT`
(around line 1458) against the `Reserve` object's fields. The likely candidates, given
their typical real-world value ranges, are `SCHED_SERIAL`, `DOC_ID`, or `PAT_TEL` — any of
these should be `Int32` or `Int64`, not `Int16`. It's also worth checking whether
`PATIENT_ID` is unconditionally parsed even when empty (for new/unregistered patients, it
arrives as an empty string), since `Convert.ToInt16("")` throws this exact exception too.

## Verified working, for context (not part of this bug)

- `generate_otp`, `verify_otp`, and `send_whatsapp_message` are confirmed working
  correctly and unaffected by this issue.
- `search_individual` / `search_bio_all` currently report `clinic_id: 0` for every
  doctor (a separate, already-reported issue) — this was worked around on our side and
  is not related to the `SUBMIT_APPOINTMENT` crash above.

---
Report generated 2026-09-28.
