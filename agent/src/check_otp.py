"""Live check of the agent's WhatsApp OTP step -- the exact code path the
voice agent's send_otp_whatsapp / verify_otp tools use: normalize the number,
get a code from the hospital's generate_otp (via the live MCP server), send it
through Meta's WhatsApp API, then verify what you type back.

This sends a REAL WhatsApp message to the number you pass:

    uv run src/check_otp.py +96569020323
"""

import asyncio
import json
import logging
import sys

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

import agent

for _name in ("httpx", "mcp", "alexa360-voice"):
    logging.getLogger(_name).setLevel(logging.WARNING)


async def main(raw_mobile: str) -> int:
    number = agent.normalize_mobile(raw_mobile)
    if not number:
        print(f"STOPPED: {raw_mobile!r} isn't a usable mobile number")
        return 1
    print(f"Number: {raw_mobile!r} -> {number}")
    print(f"MCP server: {agent.ALSALAM_MCP_URL}")
    print(
        f"WhatsApp: phone number id {agent.WHATSAPP_PHONE_NUMBER_ID or '<NOT SET>'}"
        f", template {agent.WHATSAPP_OTP_TEMPLATE!r}"
        f", token {'set' if agent.WHATSAPP_ACCESS_TOKEN else '<NOT SET>'}"
    )
    async with (
        streamablehttp_client(agent.ALSALAM_MCP_URL, timeout=60) as (read, write, _),
        ClientSession(read, write) as session,
    ):
        await session.initialize()
        # agent's helpers only need an object with a connected `_client`.
        server = type("Server", (), {"_client": session})()
        try:
            message_id = await agent.generate_and_send_otp(number, server)
        except Exception as e:  # noqa: BLE001 -- report whatever broke
            print(f"\nSEND FAILED: {e}")
            return 1
        print(f"\nSENT: Meta accepted the message (id {message_id}).")
        print("Check WhatsApp on that phone -- it should arrive within seconds.")

        code = input("Code you received (Enter to skip verifying): ")
        if not agent._ascii_digits(code):
            print("Skipped verification.")
            return 0
        ok, text = await agent.call_mcp_tool(
            server,
            "verify_otp",
            {"mobile": number, "otpCode": agent._ascii_digits(code)},
        )
        verified = ok and json.loads(text).get("verified") is True
        print("VERIFIED" if verified else f"NOT VERIFIED: {text}")
        return 0 if verified else 1


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(asyncio.run(main(sys.argv[1])))
