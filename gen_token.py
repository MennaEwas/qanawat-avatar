from pathlib import Path
from dotenv import load_dotenv
from livekit import api

load_dotenv(Path("agent/src/.env.local"))

LIVEKIT_API_KEY = "APItif6KvigvQrF"
LIVEKIT_API_SECRET = "BimwW52ab7X1e7ny7ewlCUxFPgjkR7eprRu9tLvU5YCB"

token = api.AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
token.with_identity("tester")
token.with_name("Tester")
token.with_grants(api.VideoGrants(
    room_join=True,
    room="demo-room",
    can_publish=True,
    can_subscribe=True,
    can_publish_data=True,
))

print(token.to_jwt())