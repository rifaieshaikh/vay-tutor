"""Start a one-member replica set on the local MongoDB, if it is not already initiated."""

from pymongo import MongoClient
from pymongo.errors import OperationFailure

client = MongoClient("mongodb://127.0.0.1:27017/?directConnection=true", serverSelectionTimeoutMS=5000)
try:
    status = client.admin.command("replSetGetStatus")
    print(f"Replica set {status.get('set')} is already initiated.")
except OperationFailure:
    client.admin.command(
        "replSetInitiate",
        {"_id": "rs0", "members": [{"_id": 0, "host": "127.0.0.1:27017"}]},
    )
    print("Initiated replica set rs0.")
