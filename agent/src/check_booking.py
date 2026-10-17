"""Live end-to-end check of the Al Salam booking tool (`submit_appointment`).

Runs the same steps the voice agent does -- patient lookup, open slot,
booking -- against the hospital's live MCP server, builds the booking with the
agent's own `build_submit_appointment_payload`, and says whether it works.

Dry run (default) -- read-only, nothing is booked:

    uv run src/check_booking.py --mobile +96569020323 --patient-id 653445

Real booking -- creates an actual appointment that must be cancelled with the
hospital afterwards (there is no cancel tool):

    uv run src/check_booking.py --mobile +96569020323 --patient-id 653445 \\
        --date 19/10/2026 --time 09:15 --book

Add --direct to skip the live MCP server and POST straight to the hospital in
the format the updated mcp.js sends (SYSID, "User Id", ...), i.e. to test that
format before the updated mcp.js is deployed.
"""

import argparse
import asyncio
import json
import logging
import re
import sys
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import httpx
import jsonschema
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

import agent

for _name in ("httpx", "mcp", "alexa360-voice"):
    logging.getLogger(_name).setLevel(logging.WARNING)

KUWAIT_TZ = timezone(timedelta(hours=3))  # Asia/Kuwait, no DST
SLOT_FORMAT = "%d/%m/%Y %H:%M:%S"


class CheckError(Exception):
    """A step can't continue; the message says what to pass instead."""


def walk(node: object, key: str):
    """Yield every dict under `node` that has `key`. The hospital API's
    XML-style JSON returns one row as a dict and several as a list, so don't
    depend on the exact nesting."""
    if isinstance(node, dict):
        if key in node:
            yield node
        for value in node.values():
            yield from walk(value, key)
    elif isinstance(node, list):
        for value in node:
            yield from walk(value, key)


def pretty(value: object, limit: int = 3000) -> str:
    if not isinstance(value, str):
        value = json.dumps(value, ensure_ascii=False, indent=2)
    return value if len(value) <= limit else f"{value[:limit]}... [truncated]"


def profile_name(profile: dict) -> str:
    name = profile.get("COMPLETEPATNAME_EN") or profile.get("COMPLETEPATNAME_AR")
    return str(name or "").strip()


def upstream_body(payload: dict) -> dict:
    """What the updated mcp.js sends the hospital for these submit_appointment
    arguments (mirrors its handler) -- the body --direct POSTs."""
    tel = payload["patTel"]
    digits = re.sub(r"\D", "", tel)
    body = {
        "SERV_TYPE": agent.ALSALAM_SERV_TYPE,
        "buffer_status": "1",
        "INIT": "1",
        "COMPUTER_NAME": payload.get("computerName") or agent.ALSALAM_COMPUTER_NAME,
        "BRANCH_ID": payload["branchId"],
        "CLINIC_ID": payload["clinicId"],
        "DOC_ID": payload["docId"],
        "SCHED_SERIAL": payload["schedSerial"],
        "SHIFT_ID": payload["shiftId"],
        "dateDone": payload["dateDone"],
        "EXPECTED_END_DATE": payload["expectedEndDate"],
        "PAT_TEL": tel,
        "PAT_NAME": payload.get("patName", ""),
        "TELEPHONE_COUNTRY_CODE": "",
        "PATIENT_ID": payload.get("patientId", ""),
        "SYSID": "2",
        "User Id": int(digits) if digits else "",
        "User Number": tel,
        "Phone": tel,
    }
    if payload.get("gender"):
        body["GENDER"] = payload["gender"]
    if payload.get("specialtyId"):
        body["SPECIALTY_ID"] = payload["specialtyId"]
    return body


async def call_json(mcp_server, name: str, arguments: dict) -> dict:
    """Call a read-only MCP tool through the agent's own helper, parsed."""
    ok, text = await agent.call_mcp_tool(mcp_server, name, arguments)
    if not ok:
        raise CheckError(f"{name} was rejected by the MCP server: {text}")
    try:
        data = json.loads(text)
    except ValueError as e:
        raise CheckError(f"{name} returned non-JSON: {text[:300]}") from e
    if data.get("success") is False:
        raise CheckError(f"{name} failed: {data.get('error') or text[:300]}")
    return data


async def pick_patient(mcp_server, args) -> tuple[str, str, str]:
    """(patient_id, patient_name, gender), filled in the way the agent would."""
    data = await call_json(
        mcp_server, "check_patient_whatsapp", {"mobile": args.mobile}
    )
    profiles = list(walk(data.get("data"), "PATIENTID"))
    print(f"Profiles under {args.mobile}: {len(profiles)}")
    for p in profiles:
        pid = str(p.get("PATIENTID", "")).strip()
        gender = p.get("PATIENT_GENDER_EN") or "?"
        print(f"  - {pid:<10} {profile_name(p)} ({gender})")

    if args.patient_id:
        wanted = args.patient_id.strip()
        match = next(
            (p for p in profiles if str(p.get("PATIENTID", "")).strip() == wanted),
            None,
        )
        if match is None:
            raise CheckError(
                f"patient {wanted} isn't one of the profiles under {args.mobile}"
            )
        return wanted, (args.name or profile_name(match)), ""
    if args.name:
        return "", args.name.strip(), args.gender
    if len(profiles) == 1:
        only = profiles[0]
        return str(only.get("PATIENTID", "")).strip(), profile_name(only), ""
    raise CheckError(
        "pass --patient-id for one of the profiles above, "
        "or --name and --gender for a new patient"
    )


async def day_slots(mcp_server, args, date: str) -> list[dict]:
    """Every slot (any status) the schedule lists for this doctor on `date`."""
    data = await call_json(
        mcp_server,
        "get_doc_next_availble_slot",
        {
            "branchId": args.branch,
            "clinicId": args.clinic,
            "docId": args.doctor,
            "scheduleDaysOnly": "0",
            "webFromDate": date,
        },
    )
    slots = [
        s
        for s in walk(data.get("data"), "SCHED_SER")
        if str(s.get("ID", "")).startswith(date)
    ]
    return sorted(slots, key=slot_time)


def is_open(slot: dict) -> bool:
    return str(slot.get("SLOT_STATUS", "")).strip().lower() == "empty"


def slot_time(slot: dict) -> datetime:
    """A slot's start ("DD/MM/YYYY HH:mm:ss", hospital-local) as Kuwait time."""
    return datetime.strptime(slot["ID"], SLOT_FORMAT).replace(tzinfo=KUWAIT_TZ)


async def schedule_dates(mcp_server, args) -> list[str]:
    data = await call_json(
        mcp_server,
        "get_doc_next_availble_slot",
        {
            "branchId": args.branch,
            "clinicId": args.clinic,
            "docId": args.doctor,
            "scheduleDaysOnly": "1",
        },
    )
    dates = [
        str(d["SCHEDULE_DATE"]).split()[0]
        for d in walk(data.get("data"), "SCHEDULE_DATE")
    ]
    if not dates:
        raise CheckError("the schedule has no days for this branch/clinic/doctor")
    return dates


async def pick_slot(mcp_server, args) -> dict:
    """The requested open slot, or the first open one at least an hour out."""
    dates = [args.date] if args.date else await schedule_dates(mcp_server, args)
    earliest = datetime.now(KUWAIT_TZ) + timedelta(hours=1)
    for date in dates:
        slots = await day_slots(mcp_server, args, date)
        open_slots = [s for s in slots if is_open(s)]
        if args.time:
            clock = args.time if args.time.count(":") == 2 else f"{args.time}:00"
            wanted = f"{date} {clock}"
            match = next((s for s in open_slots if s["ID"] == wanted), None)
            if match is None:
                times = ", ".join(s["ID"].split()[1][:5] for s in open_slots[:12])
                raise CheckError(
                    f"{wanted} isn't an open slot. Open on {date}: {times or 'none'}"
                )
            return match
        upcoming = [s for s in open_slots if slot_time(s) >= earliest]
        if upcoming:
            return upcoming[0]
    raise CheckError("no open slot found for this doctor")


async def slot_taken(mcp_server, args, slot: dict) -> bool | None:
    """True once the slot is gone from (or no longer open in) the schedule --
    independent proof a booking landed, whatever the reply looked like."""
    try:
        slots = await day_slots(mcp_server, args, slot["ID"].split()[0])
    except Exception as e:  # noqa: BLE001
        print(f"  (couldn't re-check the schedule: {e})")
        return None
    if not slots:
        # An empty day says nothing about this one slot -- don't count it
        # as booked.
        print("  (the schedule came back empty for that day)")
        return None
    same = next(
        (
            s
            for s in slots
            if s["ID"] == slot["ID"]
            and str(s.get("SCHED_SER")) == str(slot.get("SCHED_SER"))
        ),
        None,
    )
    return same is None or not is_open(same)


async def book_via_mcp(mcp_server, payload: dict) -> tuple[str, object, object]:
    """Book exactly the way the agent's submit_appointment tool does, and read
    the reply the way it does."""
    ok, text = await agent.call_mcp_tool(mcp_server, "submit_appointment", payload)
    if not ok:
        return "failed", text, None
    try:
        data = json.loads(text)
    except ValueError:
        return "uncertain", text, None
    if not isinstance(data, dict):
        return "uncertain", text, None
    if data.get("success") is False:
        return "failed", data.get("error") or text, data.get("request")
    response = data.get("response")
    outcome = agent.classify_appointment_response(response)
    return outcome, response, data.get("request")


async def book_direct(payload: dict) -> tuple[str, object, object]:
    """POST the updated mcp.js format straight to the hospital."""
    body = upstream_body(payload)
    async with httpx.AsyncClient(timeout=150) as client:
        r = await client.post(
            f"{agent.ALSALAM_RAW_API_BASE}/submit_appointment", json=body
        )
    try:
        response = r.json()
    except ValueError:
        response = r.text
    return agent.classify_appointment_response(response), response, body


def book_command(args, patient: tuple[str, str, str], slot: dict) -> str:
    patient_id, name, gender = patient
    date, clock = slot["ID"].split()
    parts = ["uv run src/check_booking.py", f"--mobile {args.mobile}"]
    if patient_id:
        parts.append(f"--patient-id {patient_id}")
    else:
        parts.append(f'--name "{name}" --gender {gender}')
    parts.append(
        f"--branch {args.branch} --clinic {args.clinic} --doctor {args.doctor}"
    )
    if args.specialty:
        parts.append(f"--specialty {args.specialty}")
    parts.append(f"--date {date} --time {clock[:5]} --book")
    if args.direct:
        parts.append("--direct")
    return " ".join(parts)


def verdict(outcome: str, taken: bool | None, direct: bool) -> int:
    if outcome == "success" and taken is not False:
        print("\nVERDICT: WORKS -- booked, and the agent would confirm it.")
        return 0
    if taken:
        print(
            "\nVERDICT: BOOKED, but the agent would tell the caller it FAILED "
            "-- classify_appointment_response doesn't recognize this success "
            "reply. Share the reply above so the agent can be taught it."
        )
        return 2
    if outcome == "success":
        print(
            "\nVERDICT: UNCLEAR -- the reply says success but the slot still "
            "shows open. Check with the hospital whether it exists."
        )
        return 2
    hint = "" if direct else " Re-run with --direct to test the updated mcp.js."
    print(f"\nVERDICT: DOES NOT WORK -- nothing was booked.{hint}")
    return 1


async def book(mcp_server, args, payload: dict, slot: dict) -> int:
    route = (
        "a direct POST to the hospital (updated mcp.js format)"
        if args.direct
        else "the live MCP server (what the agent does today)"
    )
    print(f"\nBOOKING FOR REAL via {route} ...")
    try:
        if args.direct:
            outcome, response, sent = await book_direct(payload)
        else:
            outcome, response, sent = await book_via_mcp(mcp_server, payload)
    except Exception as e:  # noqa: BLE001 -- e.g. a timeout; may still have booked
        outcome, response, sent = "uncertain", f"{type(e).__name__}: {e}", None
    if sent:
        print("Body the hospital received:")
        print(pretty(sent))
    print("Hospital reply:")
    print(pretty(response))

    print(f"\n[2] The agent reads this reply as: {outcome.upper()}")
    taken = await slot_taken(mcp_server, args, slot)
    status = {True: "YES", False: "NO", None: "UNKNOWN"}[taken]
    print(f"[3] Slot now taken in the schedule: {status}")
    code = verdict(outcome, taken, args.direct)
    if taken or outcome == "success":
        print("Remember to cancel this test appointment with the hospital.")
    return code


async def check(mcp_server, schema: dict, args) -> int:
    try:
        patient = await pick_patient(mcp_server, args)
        slot = await pick_slot(mcp_server, args)
    except CheckError as e:
        print(f"\nSTOPPED: {e}")
        return 1
    patient_id, name, gender = patient

    payload = agent.build_submit_appointment_payload(
        branch_id=args.branch,
        clinic_id=args.clinic,
        doc_id=args.doctor,
        sched_serial=slot["SCHED_SER"],
        shift_id=slot["SHIFT_ID"],
        date_done=slot["ID"],
        expected_end_date=slot["TIME_SLOT_END"],
        pat_tel=args.mobile,
        telephone_country_code="",
        specialty_id=args.specialty,
        patient_id=patient_id,
        pat_name=name,
        gender=gender,
    )
    print(
        f"\nSlot: {slot['ID']} -> {slot['TIME_SLOT_END']} "
        f"(SCHED_SER {slot['SCHED_SER']}, SHIFT {slot['SHIFT_ID']}, open)"
    )
    print(f"Patient: {name or '?'} (patient id {patient_id or 'none -- new'})")
    print("\nArguments the agent sends to submit_appointment:")
    print(pretty(payload))

    validator = jsonschema.Draft7Validator(schema)
    errors = [e.message for e in validator.iter_errors(payload)]
    accepted = "YES" if not errors else "NO"
    print(f"\n[1] Live MCP server accepts these arguments: {accepted}")
    for message in errors:
        print(f"    - {message}")
    if errors and not args.direct:
        return 1
    if args.direct:
        print("\nBody --direct sends to the hospital (updated mcp.js format):")
        print(pretty(upstream_body(payload)))

    if not args.book:
        print("\nDRY RUN -- nothing was booked. To book this slot for real")
        print("(a real appointment you'll need to cancel with the hospital):")
        print(f"  {book_command(args, patient, slot)}")
        return 0
    return await book(mcp_server, args, payload, slot)


async def run(args) -> int:
    print(f"MCP server: {agent.ALSALAM_MCP_URL}")
    async with (
        streamablehttp_client(agent.ALSALAM_MCP_URL, timeout=150) as (read, write, _),
        ClientSession(read, write) as session,
    ):
        await session.initialize()
        tools = {t.name: t for t in (await session.list_tools()).tools}
        if "submit_appointment" not in tools:
            print("STOPPED: the live MCP server has no submit_appointment.")
            return 1
        # agent.call_mcp_tool only needs an object with a connected `_client`.
        mcp_server = SimpleNamespace(_client=session)
        schema = tools["submit_appointment"].inputSchema
        return await check(mcp_server, schema, args)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    add = parser.add_argument
    add("--mobile", required=True, help="caller's mobile, e.g. +96569020323")
    add("--patient-id", default="", help="existing patient profile id")
    add("--name", default="", help="patient full name (new patient, or override)")
    add("--gender", default="", help="M or F (new patients only)")
    add("--branch", default="1", help="branch / hospital_id (default: 1)")
    add("--clinic", default="23", help="clinic_id (default: 23)")
    add("--doctor", default="1001044", help="doctor_id (default: 1001044)")
    add("--specialty", default="", help="specialty_id (optional)")
    add("--date", default="", help="DD/MM/YYYY (default: first open day)")
    add("--time", default="", help="HH:MM, needs --date")
    add("--book", action="store_true", help="really book it (default: dry run)")
    add(
        "--direct",
        action="store_true",
        help="skip the MCP server; POST the updated mcp.js format directly",
    )
    args = parser.parse_args()

    args.mobile = re.sub(r"[\s-]", "", args.mobile)
    if not re.fullmatch(r"\+\d{8,15}", args.mobile):
        parser.error("--mobile must be international, e.g. +96569020323")
    if args.date and not re.fullmatch(r"\d{2}/\d{2}/\d{4}", args.date):
        parser.error("--date must be DD/MM/YYYY")
    if args.time and not args.date:
        parser.error("--time needs --date")
    if args.time and not re.fullmatch(r"\d{2}:\d{2}(:\d{2})?", args.time):
        parser.error("--time must be HH:MM")
    args.gender = args.gender.strip().upper()
    if args.name and not args.patient_id and args.gender not in ("M", "F"):
        parser.error("a new patient (no --patient-id) needs --gender M or F")
    return args


def main() -> None:
    args = parse_args()
    try:
        code = asyncio.run(asyncio.wait_for(run(args), timeout=600))
    except Exception as e:  # noqa: BLE001 -- connection failures, timeouts
        inner = getattr(e, "exceptions", None) or [e]
        details = "; ".join(f"{type(x).__name__}: {x}" for x in inner)
        print(f"STOPPED: couldn't complete the check -- {details}")
        code = 1
    sys.exit(code)


if __name__ == "__main__":
    main()
