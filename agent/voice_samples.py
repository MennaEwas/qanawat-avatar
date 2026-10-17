"""Render the same Arabic line with several Cartesia voices via LiveKit
Inference, so the voices can be compared by ear before picking TTS_VOICE.

    uv run voice_samples.py <output-dir>
"""

import asyncio
import sys
import wave
from pathlib import Path

import aiohttp
from dotenv import load_dotenv
from livekit.agents import inference

load_dotenv(Path(__file__).parent / "src" / ".env.local")

TEXT = (
    "مرحبا معك المساعد الذكي من مستشفيات السلام. "
    "عندنا موعد متوفر مع الدكتور إبراهيم السيد، استشاري القلب، "
    "يوم الأحد الساعة عشرة الصبح. تبي أحجز لك؟"
)

VOICES = {
    "walid": "f1cdfb4a-bf7d-4e83-916e-8f0802278315",
    "tariq": "db873303-3a70-4d9d-867a-0d70a6377195",
    "zain": "40f9b5d1-bc79-43a6-b5cc-1c692b3b40d2",
    "youssef": "9cbad5f7-fbf6-4416-a22f-1ecc75ad40a2",
    "hassan": "664aec8a-64a4-4437-8a0b-a61aa4f51fe6",
    "current-grant-english": "d46abd1d-2d02-43e8-819f-51fb652c1c61",
}


async def render(session: aiohttp.ClientSession, name: str, voice: str, out: Path) -> None:
    tts = inference.TTS("cartesia/sonic-3", voice=voice, language="ar", http_session=session)
    frames = []
    async with tts.synthesize(TEXT) as stream:
        async for ev in stream:
            frames.append(ev.frame)
    if not frames:
        print(f"{name}: no audio")
        return
    path = out / f"{name}.wav"
    with wave.open(str(path), "wb") as w:
        w.setnchannels(frames[0].num_channels)
        w.setsampwidth(2)
        w.setframerate(frames[0].sample_rate)
        for f in frames:
            w.writeframes(bytes(f.data))
    print(f"{name}: {path}")


async def main() -> None:
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    async with aiohttp.ClientSession() as session:
        for name, voice in VOICES.items():
            try:
                await render(session, name, voice, out)
            except Exception as e:  # noqa: BLE001
                print(f"{name}: FAILED {e}")


asyncio.run(main())
